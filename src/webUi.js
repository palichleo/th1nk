function createWebUi({ arbiterAgents, sendEvent, session, slaveAgents }) {
  const state = {
    arbiters: arbiterAgents.map((agent) => createPanelState(agent)),
    session,
    slaves: slaveAgents.map((agent) => createPanelState(agent)),
    status: "Demarrage..."
  };

  function createPanelState(agent) {
    return {
      id: agent.id,
      name: agent.name,
      persona: agent.persona || "synthese et arbitrage",
      content: ""
    };
  }

  function emit(type, payload) {
    sendEvent({
      type,
      payload
    });
  }

  function appendToPanel({ collectionName, id, text }) {
    const panel = state[collectionName].find((candidate) => candidate.id === id);

    if (!panel) {
      return;
    }

    panel.content += text;

    emit("append", {
      collection: collectionName,
      id,
      text
    });
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
    appendToPanel({
      collectionName: "slaves",
      id: agentId,
      text
    });
  }

  function appendArbiterToPanel({ arbiterId, text }) {
    appendToPanel({
      collectionName: "arbiters",
      id: arbiterId,
      text
    });
  }

  function appendArbiter(text) {
    const firstArbiter = state.arbiters[0];

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
      arbiters: state.arbiters,
      session: state.session,
      slaves: state.slaves,
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
