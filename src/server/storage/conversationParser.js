const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const { normalizeInteger } = require("../../normalize");

function parseConversationMarkdown(markdown) {
  const source = normalizeString(markdown);
  const frontmatterMatch = source.match(FRONTMATTER_PATTERN);
  const frontmatter = frontmatterMatch
    ? parseYamlSubset(frontmatterMatch[1])
    : {};
  const body = frontmatterMatch
    ? source.slice(frontmatterMatch[0].length)
    : source;

  const messages = extractBlocks(body, "th1nk-message").map((block, index) => ({
    id: normalizeString(block.meta.id) || `message-${index + 1}`,
    role: normalizeString(block.meta.role) || "assistant",
    kind: normalizeMessageKind(block.meta.kind),
    agentName: normalizeString(block.meta.agentName),
    botId: normalizeString(block.meta.botId),
    layerId: normalizeString(block.meta.layerId),
    meta: normalizeString(block.meta.meta),
    title: normalizeString(block.meta.title),
    status: block.meta.status === "running" ? "running" : "complete",
    createdAt: normalizeString(block.meta.createdAt),
    updatedAt: normalizeString(block.meta.updatedAt),
    content: block.content
  }));
  const checkpoints = extractBlocks(body, "th1nk-checkpoint").map((block, index) => ({
    id: normalizeString(block.meta.id) || `checkpoint-${index + 1}`,
    arbitrationIndex: normalizeInteger(block.meta.arbitrationIndex, index + 1),
    arbiterId: normalizeString(block.meta.arbiterId),
    arbiterName: normalizeString(block.meta.arbiterName),
    conversationTurnIndex: normalizeInteger(block.meta.conversationTurnIndex, 0),
    currentTask: normalizeString(block.meta.currentTask),
    createdAt: normalizeString(block.meta.createdAt),
    updatedAt: normalizeString(block.meta.updatedAt),
    title: normalizeString(block.meta.title),
    userTurnId: normalizeString(block.meta.userTurnId),
    content: block.content
  }));
  const initialRequest =
    extractSingleBlock(body, "th1nk-initial") ||
    extractSection(body, "Question initiale");

  return {
    id: normalizeString(frontmatter.id),
    title: normalizeString(frontmatter.title),
    createdAt: normalizeString(frontmatter.createdAt),
    updatedAt: normalizeString(frontmatter.updatedAt),
    status: normalizeString(frontmatter.status) || "running",
    models: normalizeModels(frontmatter.models),
    tags: normalizeStringArray(frontmatter.tags),
    initialRequest,
    messages,
    checkpoints
  };
}

function serializeConversationMarkdown(conversation) {
  const normalized = normalizeConversation(conversation);
  const lines = [
    "---",
    ...serializeYamlSubset({
      id: normalized.id,
      title: normalized.title,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
      status: normalized.status,
      models: normalized.models,
      tags: normalized.tags
    }),
    "---",
    "",
    "## Question initiale",
    "",
    "<!-- th1nk-initial:start -->",
    normalized.initialRequest,
    "<!-- th1nk-initial:end -->",
    "",
    "## Messages"
  ];

  for (const message of normalized.messages) {
    lines.push("", formatBlock("th1nk-message", message, message.content));
  }

  lines.push("", "## Checkpoints");

  for (const checkpoint of normalized.checkpoints) {
    lines.push("", formatBlock("th1nk-checkpoint", checkpoint, checkpoint.content));
  }

  lines.push("");
  return lines.join("\n");
}

function normalizeConversation(conversation) {
  return {
    id: normalizeString(conversation?.id),
    title: normalizeString(conversation?.title),
    createdAt: normalizeString(conversation?.createdAt),
    updatedAt: normalizeString(conversation?.updatedAt),
    status: normalizeString(conversation?.status) || "running",
    models: normalizeModels(conversation?.models),
    tags: normalizeStringArray(conversation?.tags),
    initialRequest: normalizeString(conversation?.initialRequest),
    messages: Array.isArray(conversation?.messages)
      ? conversation.messages.map(normalizeMessage)
      : [],
    checkpoints: Array.isArray(conversation?.checkpoints)
      ? conversation.checkpoints.map(normalizeCheckpoint)
      : []
  };
}

function normalizeMessage(message) {
  return {
    id: normalizeString(message?.id),
    role: normalizeString(message?.role) || "assistant",
    kind: normalizeMessageKind(message?.kind),
    agentName: normalizeString(message?.agentName),
    botId: normalizeString(message?.botId),
    layerId: normalizeString(message?.layerId),
    meta: normalizeString(message?.meta),
    title: normalizeString(message?.title),
    status: message?.status === "running" ? "running" : "complete",
    createdAt: normalizeString(message?.createdAt),
    updatedAt: normalizeString(message?.updatedAt),
    content: normalizeString(message?.content)
  };
}

function normalizeCheckpoint(checkpoint) {
  return {
    id: normalizeString(checkpoint?.id),
    arbitrationIndex: normalizeInteger(checkpoint?.arbitrationIndex, 0),
    arbiterId: normalizeString(checkpoint?.arbiterId),
    arbiterName: normalizeString(checkpoint?.arbiterName),
    conversationTurnIndex: normalizeInteger(checkpoint?.conversationTurnIndex, 0),
    currentTask: normalizeString(checkpoint?.currentTask),
    createdAt: normalizeString(checkpoint?.createdAt),
    updatedAt: normalizeString(checkpoint?.updatedAt),
    title: normalizeString(checkpoint?.title),
    userTurnId: normalizeString(checkpoint?.userTurnId),
    content: normalizeString(checkpoint?.content)
  };
}

function normalizeMessageKind(kind) {
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

function formatBlock(marker, value, content) {
  const metadata = { ...value };
  delete metadata.content;

  return [
    `<!-- ${marker}:start ${JSON.stringify(metadata)} -->`,
    normalizeString(content),
    `<!-- ${marker}:end -->`
  ].join("\n");
}

function extractBlocks(body, marker) {
  const blocks = [];
  const pattern = new RegExp(
    `<!--\\s*${escapeRegExp(marker)}:start\\s*([\\s\\S]*?)-->\\r?\\n?([\\s\\S]*?)\\r?\\n?<!--\\s*${escapeRegExp(marker)}:end\\s*-->`,
    "g"
  );
  let match;

  while ((match = pattern.exec(body)) !== null) {
    blocks.push({
      meta: parseJsonObject(match[1]),
      content: normalizeBlockContent(match[2])
    });
  }

  return blocks;
}

function extractSingleBlock(body, marker) {
  const block = extractBlocks(body, marker)[0];
  return block ? block.content : "";
}

function extractSection(body, heading) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    line.trim().toLowerCase() === `## ${heading}`.toLowerCase()
  );

  if (start === -1) {
    return "";
  }

  const sectionLines = [];
  for (let index = start + 1; index < lines.length; index++) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }

    sectionLines.push(lines[index]);
  }

  return sectionLines.join("\n").trim();
}

function normalizeBlockContent(value) {
  return normalizeString(value).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(normalizeString(value).trim() || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function parseYamlSubset(yaml) {
  const result = {};
  const lines = normalizeString(yaml).split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);

    if (!match) {
      index++;
      continue;
    }

    const key = match[1];
    const inlineValue = match[2] || "";

    if (inlineValue.trim()) {
      result[key] = parseYamlScalar(inlineValue);
      index++;
      continue;
    }

    const nested = [];
    index++;
    while (index < lines.length && /^\s+/.test(lines[index])) {
      nested.push(lines[index]);
      index++;
    }
    result[key] = parseYamlNested(nested);
  }

  return result;
}

function parseYamlNested(lines) {
  const meaningful = lines.filter((line) => line.trim());

  if (!meaningful.length) {
    return {};
  }

  if (meaningful.every((line) => /^\s*-\s+/.test(line))) {
    return meaningful.map((line) => parseYamlScalar(line.replace(/^\s*-\s+/, "")));
  }

  const object = {};
  for (const line of meaningful) {
    const match = line.match(/^\s+([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (match) {
      object[match[1]] = parseYamlScalar(match[2] || "");
    }
  }

  return object;
}

function parseYamlScalar(value) {
  const trimmed = normalizeString(value).trim();

  if (trimmed === "[]") {
    return [];
  }
  if (trimmed === "{}") {
    return {};
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed.startsWith("'")
        ? `"${trimmed.slice(1, -1).replace(/"/g, "\\\"")}"`
        : trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function serializeYamlSubset(value) {
  const lines = [];

  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      if (!item.length) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const entry of item) {
          lines.push(`  - ${formatYamlScalar(entry)}`);
        }
      }
      continue;
    }

    if (item && typeof item === "object") {
      const entries = Object.entries(item);
      if (!entries.length) {
        lines.push(`${key}: {}`);
      } else {
        lines.push(`${key}:`);
        for (const [nestedKey, nestedValue] of entries) {
          lines.push(`  ${nestedKey}: ${formatYamlScalar(nestedValue)}`);
        }
      }
      continue;
    }

    lines.push(`${key}: ${formatYamlScalar(item)}`);
  }

  return lines;
}

function formatYamlScalar(value) {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "null";
  }

  return JSON.stringify(String(value));
}

function normalizeModels(models) {
  if (Array.isArray(models)) {
    return models.map((model) => normalizeString(model)).filter(Boolean);
  }

  if (models && typeof models === "object") {
    return Object.fromEntries(
      Object.entries(models)
        .map(([key, value]) => [key, normalizeString(value)])
        .filter(([, value]) => value)
    );
  }

  return {};
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  parseConversationMarkdown,
  serializeConversationMarkdown
};
