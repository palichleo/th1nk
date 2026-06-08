const { createDebateState } = require("./debateState");
const { askAgentStreaming } = require("./ollamaClient");
const {
  buildArbiterPrompt,
  buildSlaveDebatePrompt
} = require("./prompts");
const {
  formatCheckpointContent,
  parseArbiterDecision
} = require("./server/storage/turnContext");

async function runDebate({
  config,
  session,
  slaveAgents,
  arbiterAgent,
  arbiterAgents,
  referenceContext = "",
  retrieveReferenceContext,
  signal,
  ui
}) {
  const activeArbiters = Array.isArray(arbiterAgents)
    ? arbiterAgents.filter(Boolean)
    : arbiterAgent
      ? [arbiterAgent]
      : [];
  const debateState = createDebateState({
    initialRequest: session.initialRequest,
    previousCheckpoint: session.turn?.latestCheckpoint,
    turn: session.turn
  });

  if (typeof ui.setSessionIntro === "function") {
    ui.setSessionIntro(formatSessionIntro({ session, slaveAgents, activeArbiters, config }));
  } else {
    ui.appendDebate(formatSessionIntro({ session, slaveAgents, activeArbiters, config }));
    ui.appendArbiter("L'arbitre interviendra apres les tours d'agents configures.\n");
  }

  let globalResponseIndex = 0;
  let activeReferenceContext = referenceContext;

  for (
    let localArbitrationIndex = 1;
    localArbitrationIndex <= session.maxArbitrations;
    localArbitrationIndex++
  ) {
    throwIfAborted(signal);
    const arbitrationIndex = getDisplayArbitrationIndex({
      localArbitrationIndex,
      session
    });

    for (
      let roundIndex = 1;
      roundIndex <= session.agentRoundsPerArbitration;
      roundIndex++
    ) {
      throwIfAborted(signal);

      activeReferenceContext = await resolveReferenceContext({
        fallback: activeReferenceContext,
        query: debateState.getCurrentTask(),
        retrieveReferenceContext
      });

      for (const agent of slaveAgents) {
        throwIfAborted(signal);
        globalResponseIndex++;

        const prompt = buildSlaveDebatePrompt({
          initialRequest: debateState.getInitialRequest(),
          previousState: debateState.getPreviousArbitrationText(),
          currentTask: debateState.getCurrentTask(),
          recentResponses: debateState.getRecentAgentResponses(
            config.context.recentResponsesForAgents
          ),
          agent,
          referenceContext: activeReferenceContext,
          turn: session.turn
        });

        ui.setStatus(
          `Arbitrage ${localArbitrationIndex}/${session.maxArbitrations} (global ${arbitrationIndex}) - Tour ${roundIndex}/${session.agentRoundsPerArbitration} - ${agent.name} reflechit...`
        );
        ui.addAgentTurnHeader({
          agent,
          arbitrationIndex,
          roundIndex,
          responseIndex: globalResponseIndex
        });

        const content = await askAgentStreaming({
          baseUrl: config.ollamaBaseUrl,
        debugMetadata: {
          arbitrationIndex,
          conversationTurnIndex: session.turn?.conversationTurnIndex,
          kind: "agent",
          responseIndex: globalResponseIndex,
          roundIndex
          },
          model: config.models.slave,
          options: config.ollamaOptions.slave,
          think: config.ollamaThink.slave,
          agent,
          input: prompt,
          onToken: (token) => appendAgentToken(ui, agent, token),
          signal
        });

        appendAgentToken(ui, agent, "\n");
        completeUiTurn(ui);

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
      throwIfAborted(signal);
      await runArbitration({
        arbitrationIndex,
        localArbitrationIndex,
        arbiterAgent: activeArbiterAgent,
        arbiterIndex,
        config,
        debateState,
        referenceContext: activeReferenceContext,
        signal,
        session,
        ui
      });
    }
  }

  return debateState.getStats();
}

async function runArbitration({
  arbitrationIndex,
  localArbitrationIndex,
  arbiterAgent,
  arbiterIndex,
  config,
  debateState,
  referenceContext,
  signal,
  session,
  ui
}) {
  throwIfAborted(signal);

  const recentResponses = debateState.getRecentAgentResponses(
    config.context.recentResponsesForArbiter
  );

  const prompt = buildArbiterPrompt({
    arbiter: arbiterAgent,
    initialRequest: debateState.getInitialRequest(),
    previousState: debateState.getPreviousArbitrationText(),
    recentResponses,
    referenceContext,
    turn: session.turn
  });

  ui.setStatus(
    `Arbitrage ${localArbitrationIndex}/${session.maxArbitrations} (global ${arbitrationIndex}) - ${arbiterAgent.name} synthetise...`
  );
  ui.addArbiterHeader({
    arbiter: arbiterAgent,
    arbiterIndex,
    arbitrationIndex,
    internal: true
  });

  const content = await askAgentStreaming({
    baseUrl: config.ollamaBaseUrl,
    debugMetadata: {
      arbitrationIndex,
      arbiterIndex,
      conversationTurnIndex: session.turn?.conversationTurnIndex,
      kind: "arbiter"
    },
    model: config.models.arbiter,
    options: config.ollamaOptions.arbiter,
    think: config.ollamaThink.arbiter,
    agent: arbiterAgent,
    input: prompt,
    onToken: () => {},
    signal
  });

  const decision = parseArbiterDecision(content, {
    arbiter: arbiterAgent,
    runId: session.runId,
    turn: {
      ...session.turn,
      localArbitrationIndex
    }
  });
  const checkpointContent = formatCheckpointContent(decision.checkpoint);

  if (typeof ui.completeInternalArbiter === "function") {
    ui.completeInternalArbiter({
      arbiter: arbiterAgent,
      arbitrationIndex,
      answerToUser: decision.answerToUser,
      checkpoint: decision.checkpoint
    });
  }

  debateState.addArbitration({
    arbiterId: arbiterAgent.id,
    arbiterName: arbiterAgent.name,
    arbitrationIndex,
    content: checkpointContent
  });
  addUiAnswer(ui, {
    content: decision.answerToUser,
    meta: `Tour utilisateur ${session.turn?.conversationTurnIndex || "?"} · Arbitrage ${arbitrationIndex}`,
    title: "Réponse",
    turn: session.turn
  });
  addUiCheckpoint(ui, {
    id: decision.checkpoint.checkpointId,
    arbitrationIndex,
    arbiterId: arbiterAgent.id,
    arbiterName: arbiterAgent.name,
    conversationTurnIndex: decision.checkpoint.conversationTurnIndex,
    currentTask: decision.checkpoint.currentTask,
    title: `Checkpoint ${arbitrationIndex} - ${arbiterAgent.name}`,
    userTurnId: decision.checkpoint.userTurnId,
    content: checkpointContent
  });
}

async function resolveReferenceContext({ fallback, query, retrieveReferenceContext }) {
  if (typeof retrieveReferenceContext !== "function") {
    return fallback;
  }

  const nextContext = await retrieveReferenceContext(query);

  if (typeof nextContext !== "string") {
    return fallback;
  }

  return nextContext;
}

function formatSessionIntro({ session, slaveAgents, activeArbiters, config }) {
  return [
    "Session multi-agent",
    "",
    `Question initiale : ${session.initialRequest}`,
    session.turn?.currentTask ? `Tache actuelle : ${session.turn.currentTask}` : "",
    `Modele slaves : ${config.models.slave}`,
    `Modele arbitre : ${activeArbiters.length ? config.models.arbiter : "Non utilise"}`,
    `Agents slaves : ${slaveAgents.map((agent) => agent.name).join(", ")}`,
    `Arbitres : ${activeArbiters.length ? activeArbiters.map((agent) => agent.name).join(", ") : "Aucun"}`,
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

function completeUiTurn(ui) {
  if (typeof ui.completeCurrentTurn === "function") {
    ui.completeCurrentTurn();
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Run annulé.");
  error.name = "AbortError";
  throw error;
}

function addUiCheckpoint(ui, checkpoint) {
  if (typeof ui.addCheckpoint === "function") {
    ui.addCheckpoint(checkpoint);
  }
}

function addUiAnswer(ui, answer) {
  if (typeof ui.addAssistantAnswer === "function") {
    ui.addAssistantAnswer(answer);
  }
}

function getDisplayArbitrationIndex({ localArbitrationIndex, session }) {
  const baseIndex = Number(session.checkpointBaseIndex);

  if (!Number.isInteger(baseIndex) || baseIndex < 0) {
    return localArbitrationIndex;
  }

  return baseIndex + localArbitrationIndex;
}

module.exports = {
  runDebate
};
