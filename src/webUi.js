const { normalizeText } = require("./normalize");

function createWebUi({
  conversation,
  conversationStore,
  initialTurns = [],
  layers,
  sendEvent,
  session
}) {
  const state = {
    conversation: conversation || null,
    layers: layers.map((layer) => createLayerState(layer)),
    session,
    status: "Demarrage...",
    turns: normalizeInitialTurns(initialTurns)
  };
  let activeTurnId = null;
  const pendingPersistence = [];
  let turnSequence = getInitialTurnSequence(state.turns);

  function createLayerState(layer) {
    return {
      ...layer,
      config: {
        ...layer.config
      },
      bots: layer.bots.map((bot) => ({
        ...bot,
        content: ""
      }))
    };
  }

  function emit(type, payload) {
    sendEvent({
      type,
      payload
    });
  }

  function appendToBot({ botId, text }) {
    for (const layer of state.layers) {
      const bot = layer.bots.find((candidate) => candidate.id === botId);

      if (!bot) {
        continue;
      }

      bot.content += text;

      const turn = state.turns.find((candidate) => candidate.id === activeTurnId);
      if (turn && turn.botId === botId) {
        turn.content += text;
      }

      emit("token", {
        botId,
        id: botId,
        layerId: layer.id,
        turnId: turn?.id || null,
        text
      });
      return;
    }
  }

  function addAgentTurnHeader({ agent, arbitrationIndex, roundIndex, responseIndex }) {
    startTurn({
      agent,
      kind: "agent",
      meta: `Arbitrage ${arbitrationIndex} · Tour ${roundIndex} · Réponse ${responseIndex}`,
      title: `Thinking about ${formatAgentLabel(agent)}...`
    });
  }

  function addArbiterHeader({ arbitrationIndex, arbiter, internal = false }) {
    if (internal) {
      emit("arbiter_started", {
        arbiterId: arbiter.id,
        arbiterName: arbiter.name,
        arbitrationIndex,
        internal: true
      });
      return;
    }

    startTurn({
      agent: arbiter,
      kind: "arbiter",
      meta: `Arbitrage ${arbitrationIndex} · Synthèse`,
      title: `Arbitrage par ${formatAgentLabel(arbiter)}`
    });
  }

  function addRetrievalTurn({ index, layer, result, total }) {
    completeCurrentTurn();

    const stats = result?.stats || {};
    const directory = stats.directory || layer.config?.directory || "Répertoire non défini";
    const errorCount = Array.isArray(stats.errors) ? stats.errors.length : 0;
    const turn = {
      id: `turn-${++turnSequence}`,
      layerId: layer.id,
      botId: "",
      agentName: layer.name,
      kind: "retrieval",
      meta: `${layer.name} · Position ${index}/${total}`,
      title: "Retrieval",
      content: [
        `Répertoire : ${directory}`,
        `Chunks sélectionnés : ${stats.chunksSelected || 0}`,
        `Chunks indexés : ${stats.chunksIndexed || 0}`,
        `Avertissements : ${errorCount}`
      ].join("\n"),
      status: "complete"
    };

    state.turns.push(turn);

    emit("retrieval_started", {
      turn
    });
    persistTurn(turn, "retrieval_done");
  }

  function startTurn({ agent, kind, meta, title }) {
    const target = findLayerAndBot(agent.id);
    if (!target) {
      return;
    }

    completeCurrentTurn();

    const turn = {
      id: `turn-${++turnSequence}`,
      layerId: target.layer.id,
      botId: target.bot.id,
      agentName: agent.name,
      kind,
      meta,
      title,
      content: "",
      status: "running"
    };

    state.turns.push(turn);
    activeTurnId = turn.id;

    emit(kind === "arbiter" ? "arbiter_started" : "agent_started", {
      turn
    });
  }

  function addAssistantAnswer({ content, meta, title, turn }) {
    completeCurrentTurn();

    const answerTurn = {
      id: `answer-${turn?.conversationTurnIndex || ++turnSequence}-${Date.now()}`,
      layerId: "",
      botId: "",
      agentName: "th1nk",
      kind: "answer",
      meta: normalizeText(meta),
      role: "assistant",
      title: normalizeText(title) || "Réponse",
      content: "",
      status: "running"
    };

    state.turns.push(answerTurn);
    activeTurnId = answerTurn.id;

    emit("agent_started", {
      turn: answerTurn
    });
    appendToActiveTurn({
      kind: "answer",
      text: content
    });
    completeCurrentTurn();
  }

  function completeCurrentTurn() {
    if (!activeTurnId) {
      return;
    }

    const turn = state.turns.find((candidate) => candidate.id === activeTurnId);
    if (turn && turn.status !== "complete") {
      turn.status = "complete";
      persistTurn(turn, turn.kind === "arbiter" ? "arbiter_done" : "agent_done");
    }

    activeTurnId = null;
  }

  function addCheckpoint(checkpoint) {
    if (!conversationStore || !state.conversation?.id) {
      return;
    }

    trackPersistence(
      conversationStore
        .appendCheckpoint(state.conversation.id, checkpoint)
        .then(() => emitConversationEvent("checkpoint_saved", { checkpoint }))
    );
  }

  function findLayerAndBot(botId) {
    for (const layer of state.layers) {
      const bot = layer.bots.find((candidate) => candidate.id === botId);

      if (bot) {
        return {
          bot,
          layer
        };
      }
    }

    return null;
  }

  function appendAgent({ agentId, text }) {
    appendToBot({
      botId: agentId,
      text
    });
  }

  function appendArbiterToPanel({ arbiterId, text }) {
    appendToBot({
      botId: arbiterId,
      text
    });
  }

  function appendArbiter(text) {
    const firstArbiterLayer = state.layers.find(
      (layer) =>
        layer.enabled &&
        layer.type === "chatbots" &&
        layer.config.purpose === "arbitrate"
    );
    const firstArbiter = firstArbiterLayer?.bots[0];

    if (!firstArbiter) {
      return;
    }

    appendArbiterToPanel({
      arbiterId: firstArbiter.id,
      text
    });
  }

  function appendToActiveTurn({ kind, text }) {
    const turn = state.turns.find((candidate) => candidate.id === activeTurnId);

    if (!turn) {
      return;
    }

    const chunk = typeof text === "string" ? text : "";
    turn.content += chunk;
    emit("token", {
      id: turn.id,
      kind,
      text: chunk,
      turnId: turn.id
    });
  }

  function formatAgentLabel(agent) {
    const name = typeof agent.name === "string" ? agent.name.trim() : "";
    const persona = typeof agent.persona === "string" ? agent.persona.trim() : "";

    if (!persona || persona === name) {
      return agent.name;
    }

    return `${agent.name} (${persona})`;
  }

  function render() {
    emit("run_started", {
      snapshot: getSnapshot()
    });
  }

  function setSessionIntro(intro) {
    emit("run_started", {
      intro
    });
  }

  function setStatus(text) {
    state.status = text;
  }

  function completeInternalArbiter({ answerToUser, arbiter, arbitrationIndex, checkpoint }) {
    emit("arbiter_done", {
      answerToUser,
      arbiterId: arbiter?.id || "",
      arbiterName: arbiter?.name || "",
      arbitrationIndex,
      checkpoint,
      internal: true
    });
  }

  function getSnapshot() {
    return {
      conversation: state.conversation,
      layers: state.layers,
      session: state.session,
      status: state.status,
      turns: state.turns
    };
  }

  async function flushPersistence() {
    while (pendingPersistence.length) {
      await Promise.all(pendingPersistence.splice(0));
    }
  }

  async function setConversationStatus(status) {
    if (!conversationStore || !state.conversation?.id) {
      return null;
    }

    const summary = await conversationStore.updateConversationStatus(
      state.conversation.id,
      status
    );

    state.conversation = {
      ...state.conversation,
      ...summary
    };

    return summary;
  }

  function persistTurn(turn, doneType = null) {
    if (!conversationStore || !state.conversation?.id || !turn) {
      return;
    }

    trackPersistence(
      conversationStore
        .appendMessage(state.conversation.id, {
          ...turn,
          role: turn.kind === "user" ? "user" : "assistant"
        })
        .then(() => {
          if (!doneType) {
            return null;
          }

          return emitConversationEvent(doneType, {
            turn,
            turnId: turn.id
          });
        })
    );
  }

  async function emitConversationEvent(type, payload = {}) {
    if (!conversationStore || !state.conversation?.id) {
      return;
    }

    const conversation = await conversationStore.getConversation(state.conversation.id);

    state.conversation = conversation.summary;
    emit(type, {
      ...payload,
      conversation
    });
  }

  function trackPersistence(promise) {
    pendingPersistence.push(
      promise.catch((error) => {
        throw new Error(
          `Erreur de sauvegarde de conversation : ${error.message || error}`
        );
      })
    );
  }

  return {
    addAssistantAnswer,
    addCheckpoint,
    addAgentTurnHeader,
    addArbiterHeader,
    addRetrievalTurn,
    appendAgent,
    appendArbiter,
    appendArbiterToPanel,
    completeCurrentTurn,
    flushPersistence,
    getSnapshot,
    completeInternalArbiter,
    render,
    setConversationStatus,
    setSessionIntro,
    setStatus
  };
}

function normalizeInitialTurns(turns) {
  if (!Array.isArray(turns)) {
    return [];
  }

  return turns
    .filter((turn) => turn && typeof turn === "object")
    .map((turn) => ({ ...turn }));
}

function getInitialTurnSequence(turns) {
  return turns.reduce((highest, turn) => {
    const match = typeof turn.id === "string" ? turn.id.match(/^turn-(\d+)$/) : null;
    const value = match ? Number(match[1]) : 0;

    return Number.isInteger(value) && value > highest ? value : highest;
  }, 0);
}

module.exports = {
  createWebUi
};
