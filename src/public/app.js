const elements = {
  arbiterCount: document.querySelector("#arbiterCount"),
  arbiterPanels: document.querySelector("#arbiterPanels"),
  arbitrationsInput: document.querySelector("#arbitrationsInput"),
  panelTemplate: document.querySelector("#panelTemplate"),
  requestInput: document.querySelector("#requestInput"),
  roundsInput: document.querySelector("#roundsInput"),
  slaveCount: document.querySelector("#slaveCount"),
  slavePanels: document.querySelector("#slavePanels"),
  startButton: document.querySelector("#startButton"),
  statusText: document.querySelector("#statusText")
};

const state = {
  config: null,
  counts: {
    arbiters: 1,
    slaves: 3
  },
  panels: {
    arbiters: new Map(),
    slaves: new Map()
  },
  running: false
};

init();

async function init() {
  state.config = await fetchConfig();
  applyDefaults();
  bindControls();
  connectEvents();
  renderPreviewPanels();
}

async function fetchConfig() {
  const response = await fetch("/api/config");

  if (!response.ok) {
    throw new Error("Configuration indisponible.");
  }

  return response.json();
}

function applyDefaults() {
  const defaults = state.config.sessionDefaults;

  state.counts.slaves = defaults.slaveCount;
  state.counts.arbiters = defaults.arbiterCount;
  elements.roundsInput.value = defaults.agentRoundsPerArbitration;
  elements.arbitrationsInput.value = defaults.maxArbitrations;
  elements.requestInput.value = defaults.initialRequest;
  updateCounters();
}

function bindControls() {
  document.addEventListener("click", (event) => {
    const action = event.target?.dataset?.action;

    if (!action || state.running) {
      return;
    }

    if (action === "slave-minus") {
      updateCount("slaves", -1);
    }

    if (action === "slave-plus") {
      updateCount("slaves", 1);
    }

    if (action === "arbiter-minus") {
      updateCount("arbiters", -1);
    }

    if (action === "arbiter-plus") {
      updateCount("arbiters", 1);
    }
  });

  elements.startButton.addEventListener("click", startSession);
}

function updateCount(kind, delta) {
  const limits = state.config.limits;
  const current = state.counts[kind];
  const min = kind === "slaves" ? limits.minSlaveAgents : limits.minArbiters;
  const max = kind === "slaves" ? limits.maxSlaveAgents : limits.maxArbiters;

  state.counts[kind] = Math.min(max, Math.max(min, current + delta));
  updateCounters();
  renderPreviewPanels();
}

function updateCounters() {
  elements.slaveCount.textContent = state.counts.slaves;
  elements.arbiterCount.textContent = state.counts.arbiters;
}

function connectEvents() {
  const events = new EventSource("/events");

  events.onmessage = (message) => {
    const event = JSON.parse(message.data);
    handleServerEvent(event);
  };

  events.onerror = () => {
    setStatus("Connexion evenementielle perdue. Reconnexion automatique...");
  };
}

function handleServerEvent(event) {
  if (event.type === "hello") {
    setRunning(event.payload.running);
    return;
  }

  if (event.type === "snapshot") {
    renderSnapshot(event.payload);
    return;
  }

  if (event.type === "sessionIntro") {
    setStatus(event.payload.intro);
    return;
  }

  if (event.type === "status") {
    setStatus(event.payload.text);
    return;
  }

  if (event.type === "append") {
    appendToPanel(event.payload);
    return;
  }

  if (event.type === "running") {
    setRunning(event.payload.running);
  }
}

async function startSession() {
  if (state.running) {
    return;
  }

  setRunning(true);
  setStatus("Demarrage de la session...");
  clearPanels();
  renderPreviewPanels();

  const response = await fetch("/api/start", {
    body: JSON.stringify({
      agentRoundsPerArbitration: Number(elements.roundsInput.value),
      arbiterCount: state.counts.arbiters,
      initialRequest: elements.requestInput.value,
      maxArbitrations: Number(elements.arbitrationsInput.value),
      slaveCount: state.counts.slaves
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Erreur inconnue." }));
    setRunning(false);
    setStatus(payload.error);
  }
}

function renderPreviewPanels() {
  const slaves = Array.from({ length: state.counts.slaves }, (_, index) => ({
    content: "",
    id: createSlaveId(index),
    name: `Agent ${createSlaveId(index)}`,
    persona: "en attente de lancement"
  }));
  const arbiters = Array.from({ length: state.counts.arbiters }, (_, index) => ({
    content: "",
    id: index === 0 ? "ARBITER" : `ARBITER-${index + 1}`,
    name: index === 0 ? "Arbitre" : `Arbitre ${index + 1}`,
    persona: "synthese et arbitrage"
  }));

  renderPanels({
    collection: "slaves",
    panels: slaves,
    root: elements.slavePanels
  });
  renderPanels({
    collection: "arbiters",
    panels: arbiters,
    root: elements.arbiterPanels
  });
}

function renderSnapshot(snapshot) {
  state.counts.slaves = snapshot.slaves.length;
  state.counts.arbiters = snapshot.arbiters.length;
  updateCounters();
  setStatus(snapshot.status);

  renderPanels({
    collection: "slaves",
    panels: snapshot.slaves,
    root: elements.slavePanels
  });
  renderPanels({
    collection: "arbiters",
    panels: snapshot.arbiters,
    root: elements.arbiterPanels
  });
}

function renderPanels({ collection, panels, root }) {
  state.panels[collection].clear();
  root.replaceChildren();

  for (const panel of panels) {
    const panelElement = createPanelElement({ collection, panel });
    root.append(panelElement);
    state.panels[collection].set(panel.id, panelElement);
  }
}

function createPanelElement({ collection, panel }) {
  const fragment = elements.panelTemplate.content.cloneNode(true);
  const panelElement = fragment.querySelector(".panel");
  const title = fragment.querySelector("h3");
  const persona = fragment.querySelector("p");
  const badge = fragment.querySelector("header span");
  const output = fragment.querySelector("pre");

  panelElement.dataset.collection = collection;
  panelElement.dataset.id = panel.id;
  title.textContent = panel.name;
  persona.textContent = panel.persona;
  badge.textContent = panel.id.replace("ARBITER", "A");
  output.textContent = panel.content || "";
  output.scrollTop = output.scrollHeight;

  return panelElement;
}

function appendToPanel({ collection, id, text }) {
  const panel = state.panels[collection]?.get(id);

  if (!panel) {
    return;
  }

  const output = panel.querySelector("pre");
  const shouldFollow =
    output.scrollTop + output.clientHeight >= output.scrollHeight - 18;

  output.textContent += text;

  if (shouldFollow) {
    output.scrollTop = output.scrollHeight;
  }
}

function clearPanels() {
  for (const collection of Object.values(state.panels)) {
    for (const panel of collection.values()) {
      panel.querySelector("pre").textContent = "";
    }
  }
}

function setRunning(running) {
  state.running = running;
  elements.startButton.disabled = running;
  elements.startButton.textContent = running ? "En cours" : "Lancer";
}

function setStatus(text) {
  elements.statusText.textContent = text || "Pret.";
}

function createSlaveId(index) {
  let value = index;
  let id = "";

  do {
    id = String.fromCharCode(65 + (value % 26)) + id;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);

  return id;
}
