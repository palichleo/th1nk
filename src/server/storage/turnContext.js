const { randomBytes } = require("node:crypto");

const {
  normalizeContent,
  normalizeInteger,
  normalizeText
} = require("../../normalize");

function prepareConversationTurn({
  conversation,
  rawUserMessage,
  userTurnId = ""
}) {
  const messages = getConversationMessages(conversation);
  const latestCheckpoint = getLatestCheckpoint(conversation);
  const recentMessages = getRecentVisibleMessages(messages);
  const currentTask = deriveCurrentTask({
    rawUserMessage
  });

  return {
    id: normalizeText(userTurnId) || `turn-${Date.now()}-${randomBytes(3).toString("hex")}`,
    agentResponses: [],
    conversationTurnIndex: getConversationTurnIndex(messages),
    currentTask,
    latestCheckpoint,
    latestCheckpointId: latestCheckpoint?.id || "",
    rawUserMessage: normalizeContent(rawUserMessage).trim(),
    recentMessages,
    userTurnId: normalizeText(userTurnId)
  };
}

function buildTurnContext({ conversation, retrievedChunks, turn }) {
  const messages = getConversationMessages(conversation);
  const latestCheckpoint = turn?.latestCheckpoint || getLatestCheckpoint(conversation);
  const checkpointData = parseCheckpointData(latestCheckpoint?.content);
  const decisions = getValidatedDecisions({ checkpointData, conversation });
  const disagreements = getCheckpointList(checkpointData, "disagreements", "desaccords");
  const risks = getCheckpointList(checkpointData, "risks", "risques");
  const pointsToVerify = getCheckpointList(
    checkpointData,
    "pointsToVerify",
    "pointsAVerifier",
    "points_a_verifier"
  );

  return [
    "# Contexte du tour courant",
    "",
    "## Requete initiale fondatrice",
    normalizeContent(conversation?.initialRequest).trim() || "Non renseignee.",
    "",
    "## Dernier checkpoint interne",
    formatCheckpointForPrompt(latestCheckpoint),
    "",
    "## Decisions deja validees",
    formatBullets(decisions),
    "",
    "## Hypotheses, risques et points ouverts",
    "### Desaccords",
    formatBullets(disagreements),
    "",
    "### Risques",
    formatBullets(risks),
    "",
    "### Points a verifier",
    formatBullets(pointsToVerify),
    "",
    "## Derniers echanges visibles",
    formatMessages(getRecentVisibleMessages(messages).slice(-6)),
    "",
    "## Chunks recuperes par le retriever",
    formatRetrievedChunks(retrievedChunks),
    "",
    "## Nouveau message utilisateur brut",
    normalizeContent(turn?.rawUserMessage).trim(),
    "",
    "## Tache actuelle obligatoire",
    normalizeContent(turn?.currentTask).trim(),
    "",
    "Regle de priorite: traite la tache actuelle obligatoire maintenant. Le checkpoint precedent sert de memoire, pas de consigne dominante."
  ].join("\n");
}

function parseArbiterDecision(content, { arbiter, runId, turn } = {}) {
  const parsed = extractJsonObject(content);
  const rawCheckpoint = getParsedCheckpoint(parsed);
  const explicitAnswer = isCheckpointOnlyObject(parsed)
    ? ""
    : normalizeContent(parsed?.answerToUser).trim();
  const answerToUser = sanitizeAnswerToUser(
    explicitAnswer ||
      extractMarkdownSection(content, "Réponse utilisateur") ||
      extractMarkdownSection(content, "Reponse utilisateur") ||
      (parsed ? "" : normalizeContent(content).trim()),
    { turn }
  ) || createFallbackAnswerToUser({ turn });
  const checkpointId = normalizeText(rawCheckpoint.checkpointId) ||
    createCheckpointId({
      arbiterId: arbiter?.id,
      localArbitrationIndex: rawCheckpoint.arbitrationIndex,
      runId,
      turn
    });

  return {
    answerToUser,
    checkpoint: {
      checkpointId,
      userTurnId: normalizeText(rawCheckpoint.userTurnId) ||
        turn?.userTurnId ||
        turn?.id ||
        "",
      conversationTurnIndex: normalizeInteger(
        rawCheckpoint.conversationTurnIndex,
        turn?.conversationTurnIndex || 0
      ),
      currentTask: normalizeContent(rawCheckpoint.currentTask).trim() ||
        turn?.currentTask ||
        "",
      validatedDecisions: normalizeStringArray(rawCheckpoint.validatedDecisions),
      hypotheses: normalizeStringArray(rawCheckpoint.hypotheses),
      proposedIdeas: normalizeStringArray(rawCheckpoint.proposedIdeas),
      disagreements: normalizeStringArray(rawCheckpoint.disagreements),
      risks: normalizeStringArray(rawCheckpoint.risks),
      pointsToVerify: normalizeStringArray(rawCheckpoint.pointsToVerify),
      openQuestions: normalizeStringArray(rawCheckpoint.openQuestions),
      nextUsefulStep: normalizeContent(rawCheckpoint.nextUsefulStep).trim()
    }
  };
}

function getParsedCheckpoint(parsed) {
  if (parsed?.checkpoint && typeof parsed.checkpoint === "object") {
    return parsed.checkpoint;
  }

  if (isCheckpointObject(parsed)) {
    return parsed;
  }

  return {};
}

function sanitizeAnswerToUser(answer, { turn } = {}) {
  const text = normalizeContent(answer).trim();

  if (!text || isInternalStateText(text)) {
    return "";
  }

  if (isCheckpointObject(extractJsonObject(text))) {
    return "";
  }

  const currentTask = normalizeContent(turn?.currentTask).trim();
  if (currentTask && text === currentTask) {
    return createFallbackAnswerToUser({ turn });
  }

  return text;
}

function createFallbackAnswerToUser({ turn } = {}) {
  const usefulPoints = extractUsefulAgentPoints(turn?.agentResponses);
  const currentTask = normalizeContent(turn?.currentTask || turn?.rawUserMessage).trim();

  if (usefulPoints.length) {
    return [
      currentTask
        ? `Pour "${currentTask}", les points exploitables du tour sont :`
        : "Les points exploitables du tour sont :",
      "",
      ...usefulPoints.map((point) => `- ${point}`)
    ].join("\n");
  }

  return currentTask
    ? `Je traite la demande actuelle : ${currentTask}`
    : "Je n'ai pas reçu de réponse visible exploitable pour ce tour.";
}

function extractUsefulAgentPoints(agentResponses) {
  if (!Array.isArray(agentResponses)) {
    return [];
  }

  return agentResponses
    .map((response) => normalizeContent(response?.content).trim())
    .filter((content) => content && !isInternalStateText(content))
    .flatMap((content) => content.split(/\r?\n/))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) =>
      line &&
      !/^```/.test(line) &&
      !/^[[\]{}:,"]+$/.test(line) &&
      !isInternalStateText(line)
    )
    .slice(0, 4)
    .map((line) => truncate(line, 260));
}

function isCheckpointOnlyObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  if (value.checkpoint && typeof value.checkpoint === "object") {
    return !normalizeContent(value.answerToUser).trim();
  }

  return isCheckpointObject(value);
}

function isCheckpointObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Boolean(
    value.checkpointId ||
      value.userTurnId ||
      value.currentTask ||
      value.validatedDecisions ||
      value.hypotheses ||
      value.proposedIdeas ||
      value.disagreements ||
      value.risks ||
      value.pointsToVerify ||
      value.openQuestions ||
      value.nextUsefulStep
  );
}

function isInternalStateText(value) {
  const text = normalizeContent(value).trim();
  if (!text) {
    return false;
  }

  const parsed = extractJsonObject(text);
  if (isCheckpointObject(parsed) || isCheckpointOnlyObject(parsed)) {
    return true;
  }

  return (
    /"checkpointId"\s*:/.test(text) &&
    /"currentTask"\s*:/.test(text) &&
    /"validatedDecisions"\s*:/.test(text)
  );
}

function formatCheckpointContent(checkpoint) {
  return [
    "```json",
    JSON.stringify(checkpoint, null, 2),
    "```"
  ].join("\n");
}

function createCheckpointId({
  arbiterId,
  localArbitrationIndex,
  runId,
  turn
} = {}) {
  return [
    "checkpoint",
    normalizeText(runId) || Date.now(),
    `turn-${turn?.conversationTurnIndex || "x"}`,
    localArbitrationIndex || "x",
    normalizeText(arbiterId) || "arbiter",
    randomBytes(3).toString("hex")
  ].join("-");
}

function getConversationTurnIndex(messages) {
  return 1 + getConversationMessages({ messages }).filter(isUserMessage).length;
}

function getConversationMessages(conversation) {
  if (Array.isArray(conversation?.messages)) {
    return conversation.messages;
  }
  if (Array.isArray(conversation?.turns)) {
    return conversation.turns;
  }

  return [];
}

function getLatestCheckpoint(conversation) {
  const checkpoints = Array.isArray(conversation?.checkpoints)
    ? conversation.checkpoints
    : [];

  return checkpoints.at(-1) || null;
}

function getRecentVisibleMessages(messages) {
  return getConversationMessages({ messages })
    .filter((message) =>
      isUserMessage(message) ||
      message.kind === "answer" ||
      message.kind === "arbiter"
    )
    .filter((message) => normalizeContent(message.content).trim())
    .slice(-10);
}

function getValidatedDecisions({ checkpointData, conversation }) {
  const fromCheckpoint = getCheckpointList(
    checkpointData,
    "validatedDecisions",
    "decisionsValidees",
    "decisions"
  );

  if (fromCheckpoint.length) {
    return fromCheckpoint;
  }

  const checkpoints = Array.isArray(conversation?.checkpoints)
    ? conversation.checkpoints
    : [];

  return checkpoints
    .flatMap((checkpoint) =>
      getCheckpointList(parseCheckpointData(checkpoint.content), "validatedDecisions")
    )
    .slice(-8);
}

function getCheckpointList(checkpointData, ...keys) {
  if (!checkpointData || typeof checkpointData !== "object") {
    return [];
  }

  for (const key of keys) {
    const value = checkpointData[key];
    if (Array.isArray(value)) {
      return value.map(normalizeContent).map((item) => item.trim()).filter(Boolean);
    }
  }

  return [];
}

function parseCheckpointData(content) {
  const parsed = extractJsonObject(content);

  if (parsed?.checkpoint && typeof parsed.checkpoint === "object") {
    return parsed.checkpoint;
  }

  return parsed && typeof parsed === "object" ? parsed : {};
}

function extractJsonObject(content) {
  const text = normalizeContent(content).trim();
  if (!text) {
    return null;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [
    fenced?.[1],
    text,
    text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Continue with the next candidate.
    }
  }

  return null;
}

function deriveCurrentTask({ rawUserMessage }) {
  return ensureSentence(rawUserMessage);
}

function formatCheckpointForPrompt(checkpoint) {
  if (!checkpoint) {
    return "Aucun checkpoint precedent.";
  }

  return [
    `ID: ${checkpoint.id || "checkpoint-sans-id"}`,
    truncate(normalizeContent(checkpoint.content).trim(), 2400)
  ].join("\n");
}

function formatRetrievedChunks(retrievedChunks) {
  const text = typeof retrievedChunks === "string"
    ? retrievedChunks.trim()
    : normalizeContent(retrievedChunks?.context).trim();

  return text || "Aucun chunk pertinent retrouve.";
}

function formatMessages(messages) {
  if (!messages.length) {
    return "Aucun echange visible precedent.";
  }

  return messages
    .map((message) => {
      const label = isUserMessage(message)
        ? "Utilisateur"
        : message.kind === "answer"
          ? "Assistant"
          : message.agentName || "Synthese";

      return [
        `### ${label}`,
        truncate(normalizeContent(message.content).trim(), 1000)
      ].join("\n");
    })
    .join("\n\n");
}

function formatBullets(items) {
  if (!items.length) {
    return "- Aucun element explicite.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function extractMarkdownSection(markdown, heading) {
  const expectedHeading = `## ${heading}`.toLowerCase();
  const lines = normalizeContent(markdown).split(/\r?\n/);
  const startIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === expectedHeading
  );

  if (startIndex === -1) {
    return "";
  }

  const sectionLines = [];
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (/^##\s+/.test(lines[index].trim())) {
      break;
    }

    sectionLines.push(lines[index]);
  }

  return sectionLines.join("\n").trim();
}

function isUserMessage(message) {
  return message?.role === "user" || message?.kind === "user";
}

function ensureSentence(value) {
  const text = normalizeContent(value).trim();
  if (!text) {
    return "";
  }

  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function truncate(value, maxLength) {
  const text = normalizeContent(value);
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeContent).map((item) => item.trim()).filter(Boolean);
}

module.exports = {
  buildTurnContext,
  formatCheckpointContent,
  parseArbiterDecision,
  prepareConversationTurn
};
