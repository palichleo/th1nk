const path = require("path");

const CONFIG = {
  conversationDirectory: path.join(__dirname, "..", "data", "conversations"),
  dataDirectory: path.join(__dirname, "..", ".th1nk"),
  ollamaBaseUrl: "http://localhost:11434",

  models: {
    slave: "qwen3:4b",
    arbiter: "deepseek-r1:8b"
  },

  sessionDefaults: {
    slaveCount: 3,
    arbiterCount: 1,
    agentRoundsPerArbitration: 3,
    maxArbitrations: 2,
    initialRequest:
      "Concevoir une architecture multi-agent locale ou de petits modeles debattent d'une question, puis un arbitre synthetise l'etat de travail."
  },

  limits: {
    minSlaveAgents: 1,
    maxSlaveAgents: 12,
    minArbiters: 1,
    maxArbiters: 8,
    minRoundsPerArbitration: 1,
    maxRoundsPerArbitration: 10,
    minArbitrations: 1,
    maxArbitrations: 20
  },

  context: {
    recentResponsesForAgents: 9,
    recentResponsesForArbiter: 9
  },

  conversationHistory: {
    enabled: true,
    chunkSize: 1200,
    chunkOverlap: 160,
    topK: 4
  },

  ollamaOptions: {
    slave: {
      temperature: 0.8,
      num_ctx: 4096,
      num_predict: 600
    },
    arbiter: {
      temperature: 0.3,
      num_ctx: 32768,
      num_predict: 1000
    }
  },

  ollamaThink: {
    slave: false,
    arbiter: false
  }
};

module.exports = {
  CONFIG
};
