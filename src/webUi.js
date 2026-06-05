function createWebUi({ layers, sendEvent, session }) {
  const state = {
    layers: layers.map((layer) => createLayerState(layer)),
    session,
    status: "Demarrage...",
    turns: []
  };
  let activeTurnId = null;
  let turnSequence = 0;

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

      emit("append", {
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

  function addArbiterHeader({ arbitrationIndex, arbiter }) {
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

    emit("turnStart", {
      turn
    });
    emit("turnEnd", {
      turnId: turn.id
    });
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

    emit("turnStart", {
      turn
    });
  }

  function completeCurrentTurn() {
    if (!activeTurnId) {
      return;
    }

    const turn = state.turns.find((candidate) => candidate.id === activeTurnId);
    if (turn && turn.status !== "complete") {
      turn.status = "complete";
      emit("turnEnd", {
        turnId: turn.id
      });
    }

    activeTurnId = null;
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

  function formatAgentLabel(agent) {
    const name = typeof agent.name === "string" ? agent.name.trim() : "";
    const persona = typeof agent.persona === "string" ? agent.persona.trim() : "";

    if (!persona || persona === name) {
      return agent.name;
    }

    return `${agent.name} (${persona})`;
  }

  function render() {
    emit("snapshot", getSnapshot());
  }

  function setSessionIntro(intro) {
    emit("sessionIntro", {
      intro
    });
  }

  function setStatus(text) {
    state.status = text;

    emit("status", {
      text
    });
  }

  function getSnapshot() {
    return {
      layers: state.layers,
      session: state.session,
      status: state.status,
      turns: state.turns
    };
  }

  return {
    addAgentTurnHeader,
    addArbiterHeader,
    addRetrievalTurn,
    appendAgent,
    appendArbiter,
    appendArbiterToPanel,
    completeCurrentTurn,
    getSnapshot,
    render,
    setSessionIntro,
    setStatus
  };
}

module.exports = {
  createWebUi
};
