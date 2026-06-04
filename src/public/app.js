(function () {
  const STORAGE_KEY = "th1nk.slaveProfiles.v1";
  const EDIT_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 17.25V21h3.75L17.8 9.95l-3.75-3.75L3 17.25zm2.92 2.83H5v-.92l8.98-8.98.92.92L5.92 20.08zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path>
    </svg>
  `;

  const elements = {
    agentEditor: document.querySelector("#agentEditor"),
    agentEditorCancel: document.querySelector("#agentEditorCancel"),
    agentEditorForm: document.querySelector("#agentEditorForm"),
    agentEditorName: document.querySelector("#agentEditorName"),
    agentEditorPersona: document.querySelector("#agentEditorPersona"),
    agentEditorTitle: document.querySelector("#agentEditorTitle"),
    arbiterPanels: document.querySelector("#arbiterPanels"),
    requestInput: document.querySelector("#requestInput"),
    slavePanels: document.querySelector("#slavePanels"),
    startButton: document.querySelector("#startButton"),
    roundsSlider: document.querySelector("#roundsSlider"),
    roundsValue: document.querySelector("#roundsValue"),
    arbitrationsSlider: document.querySelector("#arbitrationsSlider"),
    arbitrationsValue: document.querySelector("#arbitrationsValue"),
    slaveCountDisplay: document.querySelector("#slaveCountDisplay"),
    arbiterCountDisplay: document.querySelector("#arbiterCountDisplay"),
    slaveMinus: document.querySelector("#slaveMinusBtn"),
    slavePlus: document.querySelector("#slavePlusBtn"),
    arbiterMinus: document.querySelector("#arbiterMinusBtn"),
    arbiterPlus: document.querySelector("#arbiterPlusBtn"),
    statusText: document.querySelector("#statusText")
  };

  const statusSpan = document.createElement("div");
  statusSpan.id = "statusText";
  statusSpan.style.fontSize = "0.8rem";
  statusSpan.style.marginTop = "1rem";
  statusSpan.style.color = "var(--text-soft)";
  statusSpan.style.textAlign = "center";
  document.querySelector(".prompt-bar").appendChild(statusSpan);
  elements.statusText = statusSpan;

  const state = {
    agentEditorIndex: null,
    config: null,
    counts: {
      arbiters: 1,
      slaves: 3
    },
    panels: {
      arbiters: new Map(),
      slaves: new Map()
    },
    running: false,
    slaveProfiles: []
  };

  init();

  async function init() {
    try {
      state.config = await fetchConfig();
      state.slaveProfiles = loadSlaveProfiles();
      applyDefaults();
      bindControlsAndSliders();
      bindAgentEditor();
      connectEvents();
      renderPreviewPanels();
      setStatus("Pret.");
    } catch (err) {
      console.error(err);
      setStatus("Erreur de configuration initiale.");
    }
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
    elements.roundsSlider.value = defaults.agentRoundsPerArbitration;
    elements.roundsValue.textContent = defaults.agentRoundsPerArbitration;
    elements.arbitrationsSlider.value = defaults.maxArbitrations;
    elements.arbitrationsValue.textContent = defaults.maxArbitrations;
    elements.requestInput.value = defaults.initialRequest;
    updateCountersDisplay();
  }

  function loadSlaveProfiles() {
    const defaults = Array.isArray(state.config.defaultSlaveProfiles)
      ? state.config.defaultSlaveProfiles
      : [];
    const storedProfiles = readStoredSlaveProfiles();

    return defaults.map((fallbackProfile, index) =>
      normalizeSlaveProfile(storedProfiles[index], fallbackProfile, index)
    );
  }

  function readStoredSlaveProfiles() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function persistSlaveProfiles() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.slaveProfiles));
    } catch (error) {
      // Local storage is optional. Ignore persistence failures.
    }
  }

  function normalizeSlaveProfile(profile, fallbackProfile, index) {
    const fallbackId = fallbackProfile?.id || createAgentId(index);
    const fallbackName = fallbackProfile?.name || `Agent ${fallbackId}`;
    const fallbackPersona = fallbackProfile?.persona || "Role";

    if (!profile || typeof profile !== "object") {
      return {
        id: fallbackId,
        name: fallbackName,
        persona: fallbackPersona
      };
    }

    return {
      id: fallbackId,
      name: normalizeText(profile.name, fallbackName),
      persona: normalizeText(profile.persona, fallbackPersona)
    };
  }

  function normalizeText(value, fallback) {
    if (typeof value !== "string") {
      return fallback;
    }

    const trimmed = value.trim();

    return trimmed || fallback;
  }

  function updateCountersDisplay() {
    elements.slaveCountDisplay.textContent = state.counts.slaves;
    elements.arbiterCountDisplay.textContent = state.counts.arbiters;
  }

  function bindControlsAndSliders() {
    elements.roundsSlider.addEventListener("input", (event) => {
      elements.roundsValue.textContent = event.target.value;
    });

    elements.arbitrationsSlider.addEventListener("input", (event) => {
      elements.arbitrationsValue.textContent = event.target.value;
    });

    elements.slaveMinus.addEventListener("click", () => {
      if (state.running) {
        return;
      }

      const limits = state.config.limits;
      const newValue = Math.max(limits.minSlaveAgents, state.counts.slaves - 1);

      if (newValue !== state.counts.slaves) {
        state.counts.slaves = newValue;
        updateCountersDisplay();
        renderPreviewPanels();
      }
    });

    elements.slavePlus.addEventListener("click", () => {
      if (state.running) {
        return;
      }

      const limits = state.config.limits;
      const newValue = Math.min(limits.maxSlaveAgents, state.counts.slaves + 1);

      if (newValue !== state.counts.slaves) {
        state.counts.slaves = newValue;
        updateCountersDisplay();
        renderPreviewPanels();
      }
    });

    elements.arbiterMinus.addEventListener("click", () => {
      if (state.running) {
        return;
      }

      const limits = state.config.limits;
      const newValue = Math.max(limits.minArbiters, state.counts.arbiters - 1);

      if (newValue !== state.counts.arbiters) {
        state.counts.arbiters = newValue;
        updateCountersDisplay();
        renderPreviewPanels();
      }
    });

    elements.arbiterPlus.addEventListener("click", () => {
      if (state.running) {
        return;
      }

      const limits = state.config.limits;
      const newValue = Math.min(limits.maxArbiters, state.counts.arbiters + 1);

      if (newValue !== state.counts.arbiters) {
        state.counts.arbiters = newValue;
        updateCountersDisplay();
        renderPreviewPanels();
      }
    });

    elements.startButton.addEventListener("click", startSession);
  }

  function bindAgentEditor() {
    elements.agentEditorForm.addEventListener("submit", commitAgentEditor);
    elements.agentEditorCancel.addEventListener("click", closeAgentEditor);
    elements.agentEditor.addEventListener("click", (event) => {
      if (event.target?.matches("[data-close-agent-editor]")) {
        closeAgentEditor();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.agentEditor.hidden) {
        closeAgentEditor();
      }
    });
  }

  function connectEvents() {
    const events = new EventSource("/events");

    events.onmessage = (message) => {
      const event = JSON.parse(message.data);
      handleServerEvent(event);
    };

    events.onerror = () => {
      setStatus("Connexion evenementielle perdue. Reconnexion auto...");
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
      return;
    }

    if (event.type === "reload") {
      window.location.reload();
    }
  }

  async function startSession() {
    if (state.running) {
      return;
    }

    closeAgentEditor();
    setRunning(true);
    setStatus("Demarrage de la session...");
    clearPanels();
    renderPreviewPanels();

    const payload = {
      agentRoundsPerArbitration: Number(elements.roundsSlider.value),
      arbiterCount: state.counts.arbiters,
      initialRequest: elements.requestInput.value,
      maxArbitrations: Number(elements.arbitrationsSlider.value),
      slaveCount: state.counts.slaves,
      slaveProfiles: state.slaveProfiles.slice(0, state.counts.slaves).map((profile) => ({
        name: profile.name,
        persona: profile.persona
      }))
    };

    const response = await fetch("/api/start", {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: "Erreur inconnue." }));
      setRunning(false);
      setStatus(err.error || "Echec du lancement");
    }
  }

  function renderPreviewPanels() {
    const slaves = state.slaveProfiles
      .slice(0, state.counts.slaves)
      .map((profile) => ({
        content: "",
        id: profile.id,
        name: profile.name,
        persona: profile.persona
      }));

    const arbiters = Array.from({ length: state.counts.arbiters }, (_, index) => ({
      content: "",
      id: index === 0 ? "ARBITER" : `ARBITER-${index + 1}`,
      name: index === 0 ? "Arbitre" : `Arbitre ${index + 1}`,
      persona: "synthese et arbitrage"
    }));

    renderPanels({ collection: "slaves", panels: slaves, root: elements.slavePanels });
    renderPanels({ collection: "arbiters", panels: arbiters, root: elements.arbiterPanels });
  }

  function renderSnapshot(snapshot) {
    state.counts.slaves = snapshot.slaves.length;
    state.counts.arbiters = snapshot.arbiters.length;
    updateCountersDisplay();
    setStatus(snapshot.status);

    renderPanels({ collection: "slaves", panels: snapshot.slaves, root: elements.slavePanels });
    renderPanels({ collection: "arbiters", panels: snapshot.arbiters, root: elements.arbiterPanels });
  }

  function renderPanels({ collection, panels, root }) {
    state.panels[collection].clear();
    root.replaceChildren();

    panels.forEach((panel, index) => {
      const panelElement = createPanelElement({ collection, panel, index });
      root.append(panelElement);
      state.panels[collection].set(panel.id, panelElement);
    });
  }

  function createPanelElement({ collection, panel, index }) {
    const fragment = document.querySelector("#panelTemplate").content.cloneNode(true);
    const panelElement = fragment.querySelector(".panel");
    const title = fragment.querySelector("h3");
    const persona = fragment.querySelector("p");
    const badge = fragment.querySelector(".panel-badge");
    const output = fragment.querySelector("pre");

    panelElement.dataset.collection = collection;
    panelElement.dataset.id = panel.id;
    title.textContent = panel.name;
    persona.textContent = panel.persona;
    output.textContent = panel.content || "";
    output.scrollTop = output.scrollHeight;

    if (collection === "slaves") {
      badge.innerHTML = EDIT_ICON;
      badge.disabled = state.running;
      badge.setAttribute("aria-label", `Modifier ${panel.name}`);
      badge.addEventListener("click", () => openAgentEditor(index));
    } else {
      badge.textContent = panel.id.replace("ARBITER", "A");
      badge.disabled = true;
      badge.setAttribute("aria-label", panel.name);
    }

    return panelElement;
  }

  function appendToPanel({ collection, id, text }) {
    const panel = state.panels[collection]?.get(id);

    if (!panel) {
      return;
    }

    const output = panel.querySelector("pre");
    const shouldFollow = output.scrollTop + output.clientHeight >= output.scrollHeight - 18;
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
    elements.roundsSlider.disabled = running;
    elements.arbitrationsSlider.disabled = running;

    const controls = [elements.slaveMinus, elements.slavePlus, elements.arbiterMinus, elements.arbiterPlus];
    controls.forEach((button) => {
      if (button) {
        button.disabled = running;
      }
    });

    updatePanelEditButtonsState();
  }

  function updatePanelEditButtonsState() {
    document.querySelectorAll(".panel-badge").forEach((button) => {
      const isSlaveEditor = button.closest(".panel")?.dataset.collection === "slaves";
      button.disabled = isSlaveEditor ? state.running : true;
    });
  }

  function openAgentEditor(index) {
    if (state.running) {
      return;
    }

    const profile = state.slaveProfiles[index];

    if (!profile) {
      return;
    }

    state.agentEditorIndex = index;
    elements.agentEditorTitle.textContent = profile.name;
    elements.agentEditorName.value = profile.name;
    elements.agentEditorPersona.value = profile.persona;
    elements.agentEditor.hidden = false;
    elements.agentEditorName.focus();
    elements.agentEditorName.select();
  }

  function closeAgentEditor() {
    state.agentEditorIndex = null;
    elements.agentEditor.hidden = true;
  }

  function commitAgentEditor(event) {
    event.preventDefault();

    if (state.agentEditorIndex === null) {
      return;
    }

    const index = state.agentEditorIndex;
    const fallback = state.slaveProfiles[index];

    if (!fallback) {
      closeAgentEditor();
      return;
    }

    state.slaveProfiles[index] = {
      id: fallback.id,
      name: normalizeText(elements.agentEditorName.value, fallback.name),
      persona: normalizeText(elements.agentEditorPersona.value, fallback.persona)
    };

    persistSlaveProfiles();
    renderPreviewPanels();
    closeAgentEditor();
  }

  function setStatus(text) {
    if (elements.statusText) {
      elements.statusText.textContent = text || "Pret.";
    }
  }

  function createAgentId(index) {
    let value = index;
    let id = "";

    do {
      id = String.fromCharCode(65 + (value % 26)) + id;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);

    return id;
  }
})();
