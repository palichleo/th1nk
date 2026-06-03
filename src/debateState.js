function createDebateState({ initialRequest }) {
  const agentResponses = [];
  const arbitrations = [];

  return {
    addAgentResponse(response) {
      agentResponses.push({
        ...response,
        createdAt: new Date().toISOString()
      });
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

      return lastArbitration?.content || "Aucun etat precedent.";
    },

    getCurrentTask() {
      const lastArbitration = arbitrations.at(-1);

      if (!lastArbitration) {
        return initialRequest;
      }

      return (
        extractMarkdownSection(lastArbitration.content, "Prochaine tâche des agents") ||
        extractMarkdownSection(lastArbitration.content, "Prochaine tache des agents") ||
        lastArbitration.content
      ).trim();
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

function extractMarkdownSection(markdown, heading) {
  const expectedHeading = `## ${heading}`.toLowerCase();
  const lines = markdown.split(/\r?\n/);
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

  return sectionLines.join("\n");
}

module.exports = {
  createDebateState
};
