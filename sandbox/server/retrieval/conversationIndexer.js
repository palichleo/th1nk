const fs = require("node:fs/promises");

const {
  nonNegativeInteger,
  positiveInteger
} = require("../../normalize");
const { buildRetrievalContext } = require("../../retrievalLayer");

const DEFAULT_OPTIONS = {
  chunkSize: 1200,
  chunkOverlap: 160,
  topK: 4
};

function createConversationRetrievalLayer({ conversationDirectory, options = {} }) {
  return {
    id: "conversation-history",
    name: "Historique conversations",
    type: "retrieval",
    enabled: true,
    config: {
      directory: conversationDirectory,
      chunkSize: positiveInteger(options.chunkSize, DEFAULT_OPTIONS.chunkSize),
      chunkOverlap: nonNegativeInteger(options.chunkOverlap, DEFAULT_OPTIONS.chunkOverlap),
      topK: positiveInteger(options.topK, DEFAULT_OPTIONS.topK)
    },
    bots: []
  };
}

async function buildConversationRetrievalContext({
  conversationDirectory,
  dataDirectory,
  excludeConversationId,
  options,
  query
}) {
  if (!(await directoryExists(conversationDirectory))) {
    return {
      layer: createConversationRetrievalLayer({
        conversationDirectory,
        options
      }),
      result: emptyResult(conversationDirectory)
    };
  }

  const layer = createConversationRetrievalLayer({
    conversationDirectory,
    options
  });

  return {
    layer,
    result: await buildRetrievalContext({
      dataDirectory,
      excludeRelativePaths: excludeConversationId ? [`${excludeConversationId}.md`] : [],
      layer,
      query
    })
  };
}

async function directoryExists(directory) {
  try {
    const stat = await fs.stat(directory);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function emptyResult(directory) {
  return {
    context: "",
    sources: [],
    stats: {
      directory,
      filesIndexed: 0,
      chunksIndexed: 0,
      chunksSelected: 0,
      cacheHit: false,
      databaseHit: false,
      durationMs: 0,
      errors: []
    }
  };
}

module.exports = {
  buildConversationRetrievalContext,
  createConversationRetrievalLayer
};
