function createWebUi({ layers, sendEvent, session }) {
  const state = {
    layers: layers.map((layer) => createLayerState(layer)),
    session,
    status: "Demarrage..."
  };

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

      emit("append", {
        id: botId,
        layerId: layer.id,
        text
      });
      return;
    }
  }

  function addAgentTurnHeader({ agent, arbitrationIndex, roundIndex, responseIndex }) {
    appendAgent({
      agentId: agent.id,
      text: [
        "",
        "",
        `=== ARBITRAGE ${arbitrationIndex} / TOUR ${roundIndex} / REPONSE ${responseIndex} ===`,
        `${agent.name} (${agent.persona})`,
        "",
        "Reponse :",
        ""
      ].join("\n")
    });
  }

  function addArbiterHeader({ arbitrationIndex, arbiter }) {
    appendArbiterToPanel({
      arbiterId: arbiter.id,
      text: [
        "",
        "",
        `=== ARBITRAGE ${arbitrationIndex} ===`,
        arbiter.name,
        "",
        "Synthese :",
        ""
      ].join("\n")
    });
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
      status: state.status
    };
  }

  return {
    addAgentTurnHeader,
    addArbiterHeader,
    appendAgent,
    appendArbiter,
    appendArbiterToPanel,
    getSnapshot,
    render,
    setSessionIntro,
    setStatus
  };
}

module.exports = {
  createWebUi
};
