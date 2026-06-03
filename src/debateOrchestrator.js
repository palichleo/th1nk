const { createDebateState } = require("./debateState");
const { askAgentStreaming } = require("./ollamaClient");
const {
  buildArbiterPrompt,
  buildSlaveDebatePrompt
} = require("./prompts");

async function runDebate({ config, session, slaveAgents, arbiterAgent, arbiterAgents, ui }) {
  const activeArbiters = arbiterAgents || [arbiterAgent];
  const debateState = createDebateState({
    initialRequest: session.initialRequest
  });

  if (typeof ui.setSessionIntro === "function") {
    ui.setSessionIntro(formatSessionIntro({ session, slaveAgents, activeArbiters, config }));
  } else {
    ui.appendDebate(formatSessionIntro({ session, slaveAgents, activeArbiters, config }));
    ui.appendArbiter("L'arbitre interviendra apres les tours d'agents configures.\n");
  }

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
          onToken: (token) => appendAgentToken(ui, agent, token)
        });

        appendAgentToken(ui, agent, "\n");

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

    for (const [arbiterIndex, activeArbiterAgent] of activeArbiters.entries()) {
      await runArbitration({
        arbitrationIndex,
        arbiterAgent: activeArbiterAgent,
        arbiterIndex,
        config,
        debateState,
        session,
        ui
      });
    }
  }

  return debateState.getStats();
}

async function runArbitration({
  arbitrationIndex,
  arbiterAgent,
  arbiterIndex,
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
    `Arbitrage ${arbitrationIndex}/${session.maxArbitrations} - ${arbiterAgent.name} synthetise...`
  );
  ui.addArbiterHeader({ arbitrationIndex, arbiter: arbiterAgent, arbiterIndex });

  const content = await askAgentStreaming({
    baseUrl: config.ollamaBaseUrl,
    model: config.models.arbiter,
    options: config.ollamaOptions.arbiter,
    think: config.ollamaThink.arbiter,
    agent: arbiterAgent,
    input: prompt,
    onToken: (token) => appendArbiterToken(ui, arbiterAgent, token)
  });

  appendArbiterToken(ui, arbiterAgent, "\n");

  debateState.addArbitration({
    arbiterId: arbiterAgent.id,
    arbiterName: arbiterAgent.name,
    arbitrationIndex,
    content
  });
}

function formatSessionIntro({ session, slaveAgents, activeArbiters, config }) {
  return [
    "Session multi-agent",
    "",
    `Question initiale : ${session.initialRequest}`,
    `Modele slaves : ${config.models.slave}`,
    `Modele arbitre : ${config.models.arbiter}`,
    `Agents slaves : ${slaveAgents.map((agent) => agent.name).join(", ")}`,
    `Arbitres : ${activeArbiters.map((agent) => agent.name).join(", ")}`,
    `Tours complets avant arbitrage : ${session.agentRoundsPerArbitration}`,
    `Nombre d'arbitrages : ${session.maxArbitrations}`,
    ""
  ].join("\n");
}

function appendAgentToken(ui, agent, token) {
  if (typeof ui.appendAgent === "function") {
    ui.appendAgent({ agentId: agent.id, text: token });
    return;
  }

  ui.appendDebate(token);
}

function appendArbiterToken(ui, arbiterAgent, token) {
  if (typeof ui.appendArbiterToPanel === "function") {
    ui.appendArbiterToPanel({ arbiterId: arbiterAgent.id, text: token });
    return;
  }

  ui.appendArbiter(token);
}

module.exports = {
  runDebate
};
