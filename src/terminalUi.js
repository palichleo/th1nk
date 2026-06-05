const blessed = require("blessed");

function createTerminalUi({ slaveAgents }) {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    mouse: true,
    title: "Debat multi-agent Ollama"
  });

  enableMouseSupport(screen);

  const state = {
    focusedPanel: "debate",
    follow: {
      debate: true,
      arbiter: true
    },
    content: {
      debate: "",
      arbiter: ""
    },
    status: ""
  };

  const debateBox = createPanel({
    label: ` Agents (${slaveAgents.length}) `,
    left: 0,
    width: "65%"
  });

  const arbiterBox = createPanel({
    label: " Arbitre ",
    left: "65%",
    width: "35%"
  });

  const statusBox = blessed.box({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    border: "line",
    padding: {
      left: 1,
      right: 1
    },
    content: ""
  });

  const boxes = {
    debate: debateBox,
    arbiter: arbiterBox
  };

  screen.append(debateBox);
  screen.append(arbiterBox);
  screen.append(statusBox);

  bindGlobalKeys();
  bindPanelEvents("debate", debateBox);
  bindPanelEvents("arbiter", arbiterBox);

  focusPanel("debate");
  setStatus("Demarrage...");

  function createPanel({ label, left, width }) {
    return blessed.box({
      top: 0,
      left,
      width,
      height: "100%-3",
      label,
      border: "line",
      padding: {
        left: 1,
        right: 1
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: false,
      scrollbar: {
        ch: " ",
        inverse: true
      }
    });
  }

  function enableMouseSupport(targetScreen) {
    const program = targetScreen.program;

    if (program && typeof program.enableMouse === "function") {
      program.enableMouse();
    }

    if (program && typeof program.enableSGRMouse === "function") {
      program.enableSGRMouse();
    }
  }

  function bindGlobalKeys() {
    screen.key(["q", "escape", "C-c"], () => {
      process.exit(0);
    });

    screen.key(["tab"], () => {
      focusPanel(state.focusedPanel === "debate" ? "arbiter" : "debate");
    });

    screen.key(["left"], () => {
      focusPanel("debate");
    });

    screen.key(["right"], () => {
      focusPanel("arbiter");
    });

    screen.key(["pageup"], () => {
      scrollFocused(-10);
    });

    screen.key(["pagedown"], () => {
      scrollFocused(10);
    });

    screen.key(["up", "k"], () => {
      scrollFocused(-1);
    });

    screen.key(["down", "j"], () => {
      scrollFocused(1);
    });

    screen.on("wheelup", () => {
      scrollFocused(-5);
    });

    screen.on("wheeldown", () => {
      scrollFocused(5);
    });

    screen.key(["home"], () => {
      const box = boxes[state.focusedPanel];
      box.setScroll(0);
      state.follow[state.focusedPanel] = false;
      updateStatus();
      render();
    });

    screen.key(["end"], () => {
      scrollToBottom(state.focusedPanel);
      state.follow[state.focusedPanel] = true;
      updateStatus();
      render();
    });
  }

  function bindPanelEvents(panelId, box) {
    box.on("click", () => {
      focusPanel(panelId);
    });

    box.on("wheelup", () => {
      focusPanel(panelId);
      scrollPanel(panelId, -5);
    });

    box.on("wheeldown", () => {
      focusPanel(panelId);
      scrollPanel(panelId, 5);
    });
  }

  function focusPanel(panelId) {
    state.focusedPanel = panelId;

    debateBox.setLabel(
      panelId === "debate"
        ? ` Agents (${slaveAgents.length}) [actif] `
        : ` Agents (${slaveAgents.length}) `
    );
    arbiterBox.setLabel(panelId === "arbiter" ? " Arbitre [actif] " : " Arbitre ");

    boxes[panelId].focus();

    updateStatus();
    render();
  }

  function scrollFocused(amount) {
    scrollPanel(state.focusedPanel, amount);
  }

  function scrollPanel(panelId, amount) {
    const box = boxes[panelId];
    const currentScroll = getScrollPosition(box);
    const nextScroll = Math.max(0, currentScroll + amount);

    box.setScroll(nextScroll);
    state.follow[panelId] = isScrolledToBottom(box);

    updateStatus();
    render();
  }

  function append(panelId, text) {
    const box = boxes[panelId];
    const previousScroll = getScrollPosition(box);

    state.content[panelId] += text;

    box.setContent(state.content[panelId]);

    if (state.follow[panelId]) {
      scrollToBottom(panelId);
    } else {
      box.setScroll(previousScroll);
    }

    render();
  }

  function scrollToBottom(panelId) {
    const box = boxes[panelId];

    box.setScrollPerc(100);

    if (typeof box.getScrollHeight === "function") {
      box.setScroll(Math.max(0, box.getScrollHeight()));
    }
  }

  function getScrollPosition(box) {
    if (typeof box.getScroll === "function") {
      return box.getScroll();
    }

    return 0;
  }

  function isScrolledToBottom(box) {
    const percentage = box.getScrollPerc();

    if (!Number.isFinite(percentage)) {
      return true;
    }

    return percentage >= 98;
  }

  function appendDebate(text) {
    append("debate", text);
  }

  function appendArbiter(text) {
    append("arbiter", text);
  }

  function addAgentTurnHeader({ agent, arbitrationIndex, roundIndex, responseIndex }) {
    appendDebate(
      [
        "",
        "",
        `==================== ARBITRAGE ${arbitrationIndex} / TOUR ${roundIndex} / REPONSE ${responseIndex} ====================`,
        formatAgentLabel(agent),
        "",
        "Reponse :",
        ""
      ].join("\n")
    );
  }

  function addArbiterHeader({ arbitrationIndex }) {
    appendArbiter(
      [
        "",
        "",
        `==================== ARBITRAGE ${arbitrationIndex} ====================`,
        "",
        "Synthese :",
        ""
      ].join("\n")
    );
  }

  function formatAgentLabel(agent) {
    const name = typeof agent.name === "string" ? agent.name.trim() : "";
    const persona = typeof agent.persona === "string" ? agent.persona.trim() : "";

    if (!persona || persona === name) {
      return agent.name;
    }

    return `${agent.name} (${persona})`;
  }

  function setStatus(text) {
    state.status = text;
    updateStatus();
    render();
  }

  function updateStatus() {
    statusBox.setContent(`${state.status}\n${getHelpText()}`);
  }

  function getHelpText() {
    const active = state.focusedPanel === "debate" ? "Agents" : "Arbitre";
    const followDebate = state.follow.debate ? "auto" : "manuel";
    const followArbiter = state.follow.arbiter ? "auto" : "manuel";

    return `Panneau actif : ${active} | Scroll : molette, haut/bas, PageUp/PageDown, Home/End | Tab/gauche/droite | Agents:${followDebate} Arbitre:${followArbiter} | Quitter : q`;
  }

  function render() {
    screen.render();
  }

  function destroy() {
    screen.destroy();
  }

  return {
    addAgentTurnHeader,
    addArbiterHeader,
    appendArbiter,
    appendDebate,
    destroy,
    render,
    setStatus
  };
}

module.exports = {
  createTerminalUi
};
