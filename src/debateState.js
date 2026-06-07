const { normalizeText } = require("./normalize");

function createDebateState({ initialRequest, previousCheckpoint, turn }) {
  const agentResponses = [];
  const arbitrations = [];
  const currentTask = normalizeText(turn?.currentTask) || initialRequest;
  const previousCheckpointText =
    normalizeText(previousCheckpoint?.content) ||
    normalizeText(turn?.latestCheckpoint?.content) ||
    "Aucun etat precedent.";

  return {
    addAgentResponse(response) {
      const storedResponse = {
        ...response,
        createdAt: new Date().toISOString()
      };

      agentResponses.push(storedResponse);
      if (Array.isArray(turn?.agentResponses)) {
        turn.agentResponses.push(storedResponse);
      }
    },

    addArbitration(arbitration) {
      arbitrations.push({
        ...arbitration,
        createdAt: new Date().toISOString()
      });
    },

    getInitialRequest() {
      return initialRequest;
    },

    getPreviousArbitrationText() {
      const lastArbitration = arbitrations.at(-1);

      return lastArbitration?.content || previousCheckpointText;
    },

    getCurrentTask() {
      return currentTask;
    },

    getRecentAgentResponses(limit) {
      return agentResponses.slice(Math.max(0, agentResponses.length - limit));
    },

    getStats() {
      return {
        agentResponseCount: agentResponses.length,
        arbitrationCount: arbitrations.length
      };
    }
  };
}

module.exports = {
  createDebateState
};
