const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  parseConversationMarkdown,
  serializeConversationMarkdown
} = require("./conversationParser");
const {
  normalizeContent,
  normalizeInteger,
  normalizeText
} = require("../../normalize");

const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_STATUS = "running";

function createConversationMarkdownStore({ directory }) {
  const conversationDirectory = path.resolve(
    directory || path.join(process.cwd(), "data", "conversations")
  );
  const writeQueues = new Map();

  async function listConversations() {
    await ensureDirectory();

    const entries = await fs.readdir(conversationDirectory, {
      withFileTypes: true
    });
    const conversations = [];

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
        continue;
      }

      try {
        const filePath = path.join(conversationDirectory, entry.name);
        const conversation = await readConversationFile(filePath);

        if (conversation.id) {
          conversations.push(toConversationSummary(conversation));
        }
      } catch {
        // A malformed file should not make the whole history disappear.
      }
    }

    conversations.sort((left, right) =>
      normalizeDateString(right.updatedAt).localeCompare(normalizeDateString(left.updatedAt))
    );

    return conversations;
  }

  async function createConversation(initialMessage, config = {}) {
    const now = new Date().toISOString();
    const id = createConversationId(now);
    const title = createTitle(initialMessage);
    const conversation = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      status: DEFAULT_STATUS,
      models: normalizeModels(config.models),
      tags: normalizeTags(config.tags),
      initialRequest: normalizeContent(initialMessage).trim(),
      messages: [],
      checkpoints: []
    };

    if (!conversation.initialRequest) {
      throw new TypeError("Le premier message est requis pour creer une conversation.");
    }

    await ensureDirectory();
    await writeConversation(conversation);

    return toStoredConversation(conversation);
  }

  async function appendMessage(conversationId, message) {
    return enqueue(conversationId, async () => {
      const conversation = await readConversation(conversationId);
      const now = new Date().toISOString();
      const normalizedMessage = normalizeMessage(message, now);
      const existingIndex = conversation.messages.findIndex(
        (candidate) => candidate.id === normalizedMessage.id
      );

      conversation.updatedAt = now;

      if (existingIndex === -1) {
        conversation.messages.push(normalizedMessage);
      } else {
        conversation.messages[existingIndex] = {
          ...conversation.messages[existingIndex],
          ...normalizedMessage,
          createdAt: conversation.messages[existingIndex].createdAt || normalizedMessage.createdAt
        };
      }

      await writeConversation(conversation);
      return normalizedMessage;
    });
  }

  async function appendCheckpoint(conversationId, checkpoint) {
    return enqueue(conversationId, async () => {
      const conversation = await readConversation(conversationId);
      const now = new Date().toISOString();
      const normalizedCheckpoint = normalizeCheckpoint(checkpoint, now);
      const existingIndex = conversation.checkpoints.findIndex(
        (candidate) => candidate.id === normalizedCheckpoint.id
      );

      conversation.updatedAt = now;

      if (existingIndex === -1) {
        conversation.checkpoints.push(normalizedCheckpoint);
      } else {
        conversation.checkpoints[existingIndex] = {
          ...conversation.checkpoints[existingIndex],
          ...normalizedCheckpoint,
          createdAt:
            conversation.checkpoints[existingIndex].createdAt ||
            normalizedCheckpoint.createdAt
        };
      }

      await writeConversation(conversation);
      return normalizedCheckpoint;
    });
  }

  async function getConversation(conversationId) {
    return toStoredConversation(await readConversation(conversationId));
  }

  async function deleteConversation(conversationId) {
    return enqueue(conversationId, async () => {
      const filePath = getConversationPath(conversationId);

      try {
        await fs.unlink(filePath);
        return true;
      } catch (error) {
        if (error.code === "ENOENT") {
          return false;
        }

        throw error;
      }
    });
  }

  async function updateConversationStatus(conversationId, status) {
    return enqueue(conversationId, async () => {
      const conversation = await readConversation(conversationId);
      const now = new Date().toISOString();

      conversation.status = normalizeStatus(status);
      conversation.updatedAt = now;
      await writeConversation(conversation);

      return toConversationSummary(conversation);
    });
  }

  async function readConversation(conversationId) {
    return readConversationFile(getConversationPath(conversationId));
  }

  async function readConversationFile(filePath) {
    const markdown = await fs.readFile(filePath, "utf8");
    const conversation = parseConversationMarkdown(markdown);
    const idFromFile = path.basename(filePath, ".md");

    return {
      ...conversation,
      id: conversation.id || idFromFile,
      title: conversation.title || createTitle(conversation.initialRequest),
      createdAt: conversation.createdAt || "",
      updatedAt: conversation.updatedAt || conversation.createdAt || "",
      status: conversation.status || DEFAULT_STATUS,
      models: normalizeModels(conversation.models),
      tags: normalizeTags(conversation.tags),
      messages: Array.isArray(conversation.messages) ? conversation.messages : [],
      checkpoints: Array.isArray(conversation.checkpoints) ? conversation.checkpoints : []
    };
  }

  async function writeConversation(conversation) {
    const filePath = getConversationPath(conversation.id);
    const temporaryPath = `${filePath}.${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}.tmp`;
    const markdown = serializeConversationMarkdown(conversation);

    try {
      await ensureDirectory();
      await fs.writeFile(temporaryPath, markdown, "utf8");
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      await removeTemporaryFile(temporaryPath);
      throw error;
    }
  }

  function enqueue(conversationId, operation) {
    const id = normalizeConversationId(conversationId);
    const previous = writeQueues.get(id) || Promise.resolve();
    const next = previous.then(operation, operation);

    const storedQueue = next.catch(() => {});

    writeQueues.set(id, storedQueue);
    next.finally(() => {
      if (writeQueues.get(id) === storedQueue) {
        writeQueues.delete(id);
      }
    }).catch(() => {});

    return next;
  }

  function getConversationPath(conversationId) {
    const id = normalizeConversationId(conversationId);
    const filePath = path.resolve(conversationDirectory, `${id}.md`);

    if (!filePath.startsWith(`${conversationDirectory}${path.sep}`)) {
      throw new TypeError("Identifiant de conversation invalide.");
    }

    return filePath;
  }

  function ensureDirectory() {
    return fs.mkdir(conversationDirectory, { recursive: true });
  }

  return {
    appendCheckpoint,
    appendMessage,
    createConversation,
    deleteConversation,
    directory: conversationDirectory,
    getConversation,
    listConversations,
    updateConversationStatus
  };
}

async function removeTemporaryFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // Nothing to clean up.
  }
}

function normalizeConversationId(value) {
  const id = normalizeText(value);

  if (!CONVERSATION_ID_PATTERN.test(id)) {
    throw new TypeError("Identifiant de conversation invalide.");
  }

  return id;
}

function createConversationId(isoDate) {
  const timestamp = isoDate
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");

  return `conv-${timestamp}-${randomBytes(4).toString("hex")}`;
}

function createTitle(initialMessage) {
  const firstLine = normalizeText(initialMessage)
    .replace(/\s+/g, " ")
    .slice(0, 80);

  return firstLine || "Nouvelle conversation";
}

function normalizeMessage(message, now) {
  const id = normalizeText(message?.id) || `message-${now}-${randomBytes(3).toString("hex")}`;

  return {
    id,
    role: normalizeText(message?.role) || "assistant",
    kind: normalizeKind(message?.kind),
    agentName: normalizeText(message?.agentName),
    botId: normalizeText(message?.botId),
    layerId: normalizeText(message?.layerId),
    meta: normalizeText(message?.meta),
    title: normalizeText(message?.title),
    status: message?.status === "running" ? "running" : "complete",
    createdAt: normalizeText(message?.createdAt) || now,
    updatedAt: now,
    content: normalizeContent(message?.content)
  };
}

function normalizeCheckpoint(checkpoint, now) {
  const arbitrationIndex = normalizeInteger(checkpoint?.arbitrationIndex, 0);
  const arbiterId = normalizeText(checkpoint?.arbiterId);
  const id = normalizeText(checkpoint?.id) ||
    `checkpoint-${arbitrationIndex || "x"}-${arbiterId || randomBytes(3).toString("hex")}`;

  return {
    id,
    arbitrationIndex,
    arbiterId,
    arbiterName: normalizeText(checkpoint?.arbiterName),
    conversationTurnIndex: normalizeInteger(checkpoint?.conversationTurnIndex, 0),
    currentTask: normalizeText(checkpoint?.currentTask),
    createdAt: normalizeText(checkpoint?.createdAt) || now,
    updatedAt: now,
    title: normalizeText(checkpoint?.title) || `Checkpoint ${arbitrationIndex || ""}`.trim(),
    userTurnId: normalizeText(checkpoint?.userTurnId),
    content: normalizeContent(checkpoint?.content)
  };
}

function normalizeKind(kind) {
  if (
    kind === "answer" ||
    kind === "arbiter" ||
    kind === "checkpoint" ||
    kind === "debug" ||
    kind === "internal_state" ||
    kind === "metadata" ||
    kind === "retrieval" ||
    kind === "user"
  ) {
    return kind;
  }

  return "agent";
}

function normalizeStatus(status) {
  if (
    status === "complete" ||
    status === "error" ||
    status === "archived" ||
    status === "cancelled"
  ) {
    return status;
  }

  return DEFAULT_STATUS;
}

function normalizeModels(models) {
  if (Array.isArray(models)) {
    return models.map(normalizeText).filter(Boolean);
  }

  if (models && typeof models === "object") {
    return Object.fromEntries(
      Object.entries(models)
        .map(([key, value]) => [key, normalizeText(value)])
        .filter(([, value]) => value)
    );
  }

  return {};
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags.map(normalizeText).filter(Boolean);
}

function normalizeDateString(value) {
  return normalizeText(value) || "0000-00-00T00:00:00.000Z";
}

function toStoredConversation(conversation) {
  return {
    ...conversation,
    summary: toConversationSummary(conversation),
    turns: conversation.messages
  };
}

function toConversationSummary(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    status: conversation.status,
    models: conversation.models,
    tags: conversation.tags,
    messageCount: conversation.messages.length,
    checkpointCount: conversation.checkpoints.length
  };
}

module.exports = {
  createConversationMarkdownStore
};
