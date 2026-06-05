const {
  createArbiterAgents,
  createDefaultArbiterProfiles,
  createDefaultSlaveProfiles,
  createSlaveAgents
} = require("./agents");

const CHATBOT_PURPOSES = new Set(["debate", "arbitrate"]);

function createDefaultLayers({ arbiterCount, slaveCount }) {
  return [
    {
      id: "layer-debate",
      name: "Layer 1 - Chatbots",
      type: "chatbots",
      enabled: true,
      config: {
        purpose: "debate"
      },
      bots: createDefaultSlaveProfiles({ count: slaveCount })
    },
    {
      id: "layer-arbitrate",
      name: "Layer 2 - Arbitres",
      type: "chatbots",
      enabled: true,
      config: {
        purpose: "arbitrate"
      },
      bots: createDefaultArbiterProfiles({ count: arbiterCount })
    }
  ];
}

function normalizeLayers({ inputLayers, sessionDefaults }) {
  const fallbackLayers = createDefaultLayers({
    arbiterCount: sessionDefaults.arbiterCount,
    slaveCount: sessionDefaults.slaveCount
  });

  if (!Array.isArray(inputLayers)) {
    return fallbackLayers;
  }

  const normalized = inputLayers
    .map((layer, index) => normalizeLayer(layer, index))
    .filter(Boolean);

  ensureUniqueIdentifiers(normalized);
  return normalized;
}

function normalizeLayer(layer, index) {
  if (!layer || typeof layer !== "object") {
    return null;
  }

  const type = normalizeText(layer.type, "custom");
  const id = normalizeIdentifier(layer.id, `layer-${index + 1}`);
  const base = {
    id,
    name: normalizeText(layer.name, `Layer ${index + 1}`),
    type,
    enabled: layer.enabled !== false
  };

  if (type === "retrieval") {
    return {
      ...base,
      config: normalizeRetrievalConfig(layer.config),
      bots: []
    };
  }

  if (type !== "chatbots") {
    return {
      ...base,
      config: cloneJsonObject(layer.config),
      bots: normalizeBots(layer.bots, id)
    };
  }

  return {
    ...base,
    config: {
      purpose: CHATBOT_PURPOSES.has(layer.config?.purpose)
        ? layer.config.purpose
        : "debate"
    },
    bots: normalizeBots(layer.bots, id)
  };
}

function normalizeBots(bots, layerId) {
  if (!Array.isArray(bots)) {
    return [];
  }

  return bots
    .map((bot, index) => normalizeBot(bot, layerId, index))
    .filter(Boolean);
}

function normalizeBot(bot, layerId, index) {
  if (!bot || typeof bot !== "object") {
    return null;
  }

  const name = normalizeText(bot.name, normalizeText(bot.persona, `Bot ${index + 1}`));

  return {
    id: normalizeIdentifier(bot.id, `${layerId}-bot-${index + 1}`),
    name,
    persona: name,
    systemPrompt: normalizeText(bot.systemPrompt, "")
  };
}

function normalizeRetrievalConfig(config) {
  return {
    directory: normalizeText(config?.directory, ""),
    chunkSize: clampInteger(config?.chunkSize, 1600, 200, 12000),
    chunkOverlap: clampInteger(config?.chunkOverlap, 200, 0, 4000),
    topK: clampInteger(config?.topK, 5, 1, 30)
  };
}

function createRuntimeFromLayers(layers) {
  const debateProfiles = [];
  const arbiterProfiles = [];
  const retrievalLayers = [];

  for (const layer of layers) {
    if (!layer.enabled) {
      continue;
    }

    if (layer.type === "retrieval") {
      retrievalLayers.push(layer);
      continue;
    }

    if (layer.type !== "chatbots") {
      continue;
    }

    if (layer.config.purpose === "arbitrate") {
      arbiterProfiles.push(...layer.bots);
    } else {
      debateProfiles.push(...layer.bots);
    }
  }

  const slaveAgents = createSlaveAgents({
    count: debateProfiles.length,
    profiles: debateProfiles
  });
  const arbiterAgents = createArbiterAgents({
    count: arbiterProfiles.length,
    profiles: arbiterProfiles
  });

  return {
    arbiterAgents,
    retrievalLayers,
    slaveAgents
  };
}

function ensureUniqueIdentifiers(layers) {
  const usedIds = new Set();

  for (const [layerIndex, layer] of layers.entries()) {
    layer.id = createUniqueIdentifier(layer.id, `layer-${layerIndex + 1}`, usedIds);

    for (const [botIndex, bot] of layer.bots.entries()) {
      bot.id = createUniqueIdentifier(
        bot.id,
        `${layer.id}-bot-${botIndex + 1}`,
        usedIds
      );
    }
  }
}

function createUniqueIdentifier(value, fallback, usedIds) {
  const base = normalizeIdentifier(value, fallback);
  let candidate = base;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }

  usedIds.add(candidate);
  return candidate;
}

function normalizeIdentifier(value, fallback) {
  const normalized = normalizeText(value, fallback)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function normalizeText(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  return trimmed || fallback;
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function cloneJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

module.exports = {
  createDefaultLayers,
  createRuntimeFromLayers,
  normalizeLayers
};
