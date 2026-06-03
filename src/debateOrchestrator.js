const { createDebateState } = require("./debateState");
const { askAgentStreaming } = require("./ollamaClient");
const {
  buildArbiterPrompt,
  buildSlaveDebatePrompt
} = require("./prompts");

async function runDebate({ config, session, slaveAgents, arbiterAgent, ui }) {
  const debateState = createDebateState({
    initialRequest: session.initialRequest
  });

  ui.appendDebate(formatSessionIntro({ session, slaveAgents, config }));
  ui.appendArbiter("L'arbitre interviendra apres les tours d'agents configures.\n");

  let globalResponseIndex = 0;

  for (
    let arbitrationIndex = 1;
    arbitrationIndex <= session.maxArbitrations;
    arbitrationIndex++
  ) {
    for (
      let roundIndex = 1;
      roundIndex <= session.agentRoundsPerArbitration;
      roundIndex++
    ) {
      for (const agent of slaveAgents) {
        globalResponseIndex++;

        const prompt = buildSlaveDebatePrompt({
          initialRequest: debateState.getInitialRequest(),
          previousState: debateState.getPreviousArbitrationText(),
          currentTask: debateState.getCurrentTask(),
          recentResponses: debateState.getRecentAgentResponses(
            config.context.recentResponsesForAgents
          ),
          agent
        });

        ui.setStatus(
          `Arbitrage ${arbitrationIndex}/${session.maxArbitrations} - Tour ${roundIndex}/${session.agentRoundsPerArbitration} - ${agent.name} reflechit...`
        );
        ui.addAgentTurnHeader({
          agent,
          arbitrationIndex,
          roundIndex,
          responseIndex: globalResponseIndex
        });

        const content = await askAgentStreaming({
          baseUrl: config.ollamaBaseUrl,
          model: config.models.slave,
          options: config.ollamaOptions.slave,
          think: config.ollamaThink.slave,
          agent,
          input: prompt,
          onToken: (token) => ui.appendDebate(token)
        });

        ui.appendDebate("\n");

        debateState.addAgentResponse({
          agentId: agent.id,
          agentName: agent.name,
          arbitrationIndex,
          roundIndex,
          responseIndex: globalResponseIndex,
          content
        });
      }
    }

    await runArbitration({
      arbitrationIndex,
      arbiterAgent,
      config,
      debateState,
      session,
      ui
    });
  }

  return debateState.getStats();
}

async function runArbitration({
  arbitrationIndex,
  arbiterAgent,
  config,
  debateState,
  session,
  ui
}) {
  const recentResponses = debateState.getRecentAgentResponses(
    config.context.recentResponsesForArbiter
  );

  const prompt = buildArbiterPrompt({
    initialRequest: debateState.getInitialRequest(),
    previousState: debateState.getPreviousArbitrationText(),
    recentResponses
  });

  ui.setStatus(
    `Arbitrage ${arbitrationIndex}/${session.maxArbitrations} - l'arbitre synthetise...`
  );
  ui.addArbiterHeader({ arbitrationIndex });

  const content = await askAgentStreaming({
    baseUrl: config.ollamaBaseUrl,
    model: config.models.arbiter,
    options: config.ollamaOptions.arbiter,
    think: config.ollamaThink.arbiter,
    agent: arbiterAgent,
    input: prompt,
    onToken: (token) => ui.appendArbiter(token)
  });

  ui.appendArbiter("\n");

  debateState.addArbitration({
    arbitrationIndex,
    content
  });
}

function formatSessionIntro({ session, slaveAgents, config }) {
  return [
    "Session multi-agent",
    "",
    `Question initiale : ${session.initialRequest}`,
    `Modele slaves : ${config.models.slave}`,
    `Modele arbitre : ${config.models.arbiter}`,
    `Agents slaves : ${slaveAgents.map((agent) => agent.name).join(", ")}`,
    `Tours complets avant arbitrage : ${session.agentRoundsPerArbitration}`,
    `Nombre d'arbitrages : ${session.maxArbitrations}`,
    ""
  ].join("\n");
}

module.exports = {
  runDebate
};
