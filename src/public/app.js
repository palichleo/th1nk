(function () {
  "use strict";

  const WORKSPACE_STORAGE_KEY = "th1nk.layersWorkspace.v1";
  const THEME_STORAGE_KEY = "th1nk.theme";
  const DEFAULT_RETRIEVAL_CONFIG = {
    directory: "",
    chunkSize: 900,
    chunkOverlap: 120,
    topK: 6
  };

  const elements = {
    addChatbotsLayerButton: document.querySelector("#addChatbotsLayerButton"),
    addRetrievalLayerButton: document.querySelector("#addRetrievalLayerButton"),
    arbitrationsSlider: document.querySelector("#arbitrationsSlider"),
    arbitrationsValue: document.querySelector("#arbitrationsValue"),
    cancelPresetNameButton: document.querySelector("#cancelPresetNameButton"),
    closePresetsButton: document.querySelector("#closePresetsButton"),
    layersWorkspace: document.querySelector("#layersWorkspace"),
    openPresetsButton: document.querySelector("#openPresetsButton"),
    outputsWorkspace: document.querySelector("#outputsWorkspace"),
    presetNameDialog: document.querySelector("#presetNameDialog"),
    presetNameForm: document.querySelector("#presetNameForm"),
    presetNameInput: document.querySelector("#presetNameInput"),
    presetsDrawer: document.querySelector("#presetsDrawer"),
    presetsList: document.querySelector("#presetsList"),
    requestInput: document.querySelector("#requestInput"),
    resetWorkspaceButton: document.querySelector("#resetWorkspaceButton"),
    roundsSlider: document.querySelector("#roundsSlider"),
    roundsValue: document.querySelector("#roundsValue"),
    startButton: document.querySelector("#startButton"),
    statusText: document.querySelector("#statusText"),
    themeButton: document.querySelector("#themeButton")
  };

  const state = {
    config: null,
    layers: [],
    outputPanels: new Map(),
    pendingPreset: null,
    presetKind: "layers",
    presetTargetLayerId: null,
    presets: {
      bots: [],
      layers: []
    },
    running: false
  };

  init();

  async function init() {
    bindStaticControls();
    applyTheme(readStorage(THEME_STORAGE_KEY) || preferredTheme());

    try {
      state.config = await fetchJson("/api/config");
      applySessionDefaults();
      state.layers = loadWorkspaceLayers();
      renderLayers();
      renderOutputPreview();
      connectEvents();
      setStatus("Prêt.");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Configuration indisponible.", true);
    }
  }

  function bindStaticControls() {
    elements.roundsSlider.addEventListener("input", () => {
      elements.roundsValue.textContent = elements.roundsSlider.value;
      persistWorkspace();
    });
    elements.arbitrationsSlider.addEventListener("input", () => {
      elements.arbitrationsValue.textContent = elements.arbitrationsSlider.value;
      persistWorkspace();
    });
    elements.requestInput.addEventListener("input", persistWorkspace);
    elements.startButton.addEventListener("click", startSession);
    elements.addChatbotsLayerButton.addEventListener("click", () => addLayer("chatbots"));
    elements.addRetrievalLayerButton.addEventListener("click", () => addLayer("retrieval"));
    elements.resetWorkspaceButton.addEventListener("click", resetWorkspace);
    elements.openPresetsButton.addEventListener("click", () => openPresets());
    elements.closePresetsButton.addEventListener("click", closePresets);
    elements.presetsDrawer.addEventListener("click", (event) => {
      if (event.target.matches("[data-close-drawer]")) {
        closePresets();
      }
    });
    document.querySelectorAll("[data-preset-kind]").forEach((button) => {
      button.addEventListener("click", () => selectPresetKind(button.dataset.presetKind));
    });
    elements.presetNameForm.addEventListener("submit", submitPresetName);
    elements.cancelPresetNameButton.addEventListener("click", closePresetNameDialog);
    elements.themeButton.addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.presetsDrawer.hidden) {
        closePresets();
      }
    });
  }

  function applySessionDefaults() {
    const defaults = state.config?.sessionDefaults || {};
    const stored = readWorkspace();
    const limits = state.config?.limits || {};

    configureSlider(elements.roundsSlider, {
      min: limits.minRoundsPerArbitration,
      max: limits.maxRoundsPerArbitration,
      value: stored?.agentRoundsPerArbitration ?? defaults.agentRoundsPerArbitration ?? 3
    });
    configureSlider(elements.arbitrationsSlider, {
      min: limits.minArbitrations,
      max: limits.maxArbitrations,
      value: stored?.maxArbitrations ?? defaults.maxArbitrations ?? 2
    });
    elements.roundsValue.textContent = elements.roundsSlider.value;
    elements.arbitrationsValue.textContent = elements.arbitrationsSlider.value;
    elements.requestInput.value = normalizeText(
      stored?.initialRequest,
      normalizeText(defaults.initialRequest, "")
    );
  }

  function configureSlider(slider, { min, max, value }) {
    slider.min = positiveInteger(min, 1);
    slider.max = positiveInteger(max, 20);
    slider.value = clampInteger(value, Number(slider.min), Number(slider.max));
  }

  function loadWorkspaceLayers() {
    const stored = readWorkspace();
    const source = Array.isArray(stored?.layers) && stored.layers.length
      ? stored.layers
      : state.config?.defaultLayers;

    return normalizeLayers(source);
  }

  function readWorkspace() {
    const value = readStorage(WORKSPACE_STORAGE_KEY);
    return value && typeof value === "object" ? value : null;
  }

  function persistWorkspace() {
    writeStorage(WORKSPACE_STORAGE_KEY, {
      agentRoundsPerArbitration: Number(elements.roundsSlider.value),
      initialRequest: elements.requestInput.value,
      layers: state.layers,
      maxArbitrations: Number(elements.arbitrationsSlider.value)
    });
  }

  function normalizeLayers(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((layer) => layer && typeof layer === "object")
      .map((layer, index) => normalizeLayer(layer, index));
  }

  function normalizeLayer(layer, index = 0) {
    const type = normalizeText(layer.type, "custom");
    const fallbackName = type === "retrieval"
      ? "Contexte documentaire"
      : type === "chatbots"
        ? "Groupe de chatbots"
        : `Layer ${type}`;
    const config = type === "retrieval"
      ? normalizeRetrievalConfig(layer.config)
      : type === "chatbots"
        ? { purpose: layer.config?.purpose === "arbitrate" ? "arbitrate" : "debate" }
        : cloneObject(layer.config);

    return {
      id: normalizeText(layer.id, createId(`layer-${index + 1}`)),
      name: normalizeText(layer.name, fallbackName),
      type,
      enabled: layer.enabled !== false,
      config,
      bots: type === "chatbots" ? normalizeBots(layer.bots) : []
    };
  }

  function normalizeBots(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((bot) => bot && typeof bot === "object")
      .map((bot, index) => normalizeBot(bot, index));
  }

  function normalizeBot(bot, index = 0) {
    return {
      id: normalizeText(bot.id, createId(`bot-${index + 1}`)),
      name: normalizeText(bot.name, `Bot ${index + 1}`),
      persona: normalizeText(bot.persona, ""),
      systemPrompt: normalizeText(bot.systemPrompt, "")
    };
  }

  function normalizeRetrievalConfig(config) {
    return {
      directory: normalizeText(config?.directory, ""),
      chunkSize: positiveInteger(config?.chunkSize, DEFAULT_RETRIEVAL_CONFIG.chunkSize),
      chunkOverlap: nonNegativeInteger(config?.chunkOverlap, DEFAULT_RETRIEVAL_CONFIG.chunkOverlap),
      topK: positiveInteger(config?.topK, DEFAULT_RETRIEVAL_CONFIG.topK)
    };
  }

  function addLayer(type, source) {
    if (state.running) {
      return;
    }

    const layer = source
      ? normalizeLayer({ ...clone(source), id: createId("layer") }, state.layers.length)
      : createLayer(type);
    if (source && layer.type === "chatbots") {
      layer.bots = layer.bots.map((bot) => ({ ...bot, id: createId("bot") }));
    }
    state.layers.push(layer);
    persistWorkspace();
    renderLayers();
    renderOutputPreview();
  }

  function createLayer(type) {
    if (type === "retrieval") {
      return normalizeLayer({
        id: createId("layer"),
        name: "Contexte documentaire",
        type: "retrieval",
        enabled: true,
        config: DEFAULT_RETRIEVAL_CONFIG,
        bots: []
      }, state.layers.length);
    }

    return normalizeLayer({
      id: createId("layer"),
      name: "Nouveau groupe",
      type: "chatbots",
      enabled: true,
      config: { purpose: "debate" },
      bots: [createBot()]
    }, state.layers.length);
  }

  function createBot(source) {
    return normalizeBot({
      ...clone(source || {}),
      id: createId("bot"),
      name: source?.name || "Nouveau bot"
    });
  }

  function renderLayers() {
    elements.layersWorkspace.replaceChildren();

    if (!state.layers.length) {
      elements.layersWorkspace.append(createEmptyState(
        "Aucun layer. Ajoutez un groupe de chatbots ou une source de retrieval."
      ));
      return;
    }

    state.layers.forEach((layer, index) => {
      const templateId = layer.type === "retrieval"
        ? "#retrievalLayerTemplate"
        : layer.type === "chatbots"
          ? "#chatbotsLayerTemplate"
          : "#customLayerTemplate";
      const card = cloneTemplate(templateId);
      card.dataset.layerId = layer.id;
      card.querySelector(".layer-index").textContent = String(index + 1).padStart(2, "0");
      bindTextInput(card.querySelector(".layer-name"), layer.name, (value) => {
        layer.name = normalizeText(value, layer.name);
        renderOutputPreview();
      });
      bindCheckbox(card.querySelector(".layer-enabled"), layer.enabled, (value) => {
        layer.enabled = value;
        card.classList.toggle("is-disabled", !value);
        renderOutputPreview();
      });
      card.classList.toggle("is-disabled", !layer.enabled);
      card.querySelector(".delete-layer").addEventListener("click", () => deleteLayer(layer.id));
      card.querySelector(".save-layer-preset").addEventListener("click", () => {
        requestPresetName("layers", layer);
      });

      if (layer.type === "retrieval") {
        renderRetrievalLayer(card, layer);
      } else if (layer.type === "chatbots") {
        renderChatbotsLayer(card, layer);
      } else {
        renderCustomLayer(card, layer);
      }

      setInteractiveState(card);
      elements.layersWorkspace.append(card);
    });
  }

  function renderChatbotsLayer(card, layer) {
    const purpose = card.querySelector(".layer-purpose");
    purpose.value = layer.config.purpose;
    purpose.addEventListener("change", () => {
      layer.config.purpose = purpose.value === "arbitrate" ? "arbitrate" : "debate";
      persistWorkspace();
      renderOutputPreview();
    });
    card.querySelector(".add-bot").addEventListener("click", () => {
      layer.bots.push(createBot());
      persistWorkspace();
      renderLayers();
      renderOutputPreview();
    });
    card.querySelector(".load-bot-preset").addEventListener("click", () => {
      openPresets({ kind: "bots", targetLayerId: layer.id });
    });

    const grid = card.querySelector(".bots-grid");
    if (!layer.bots.length) {
      grid.append(createEmptyState("Ce layer ne contient aucun bot."));
      return;
    }

    layer.bots.forEach((bot) => {
      const botCard = cloneTemplate("#botTemplate");
      botCard.dataset.botId = bot.id;
      bindTextInput(botCard.querySelector(".bot-name"), bot.name, (value) => {
        bot.name = normalizeText(value, bot.name);
        renderOutputPreview();
      });
      bindTextInput(botCard.querySelector(".bot-persona"), bot.persona, (value) => {
        bot.persona = value;
        renderOutputPreview();
      });
      bindTextInput(botCard.querySelector(".bot-system-prompt"), bot.systemPrompt, (value) => {
        bot.systemPrompt = value;
      });
      botCard.querySelector(".delete-bot").addEventListener("click", () => {
        layer.bots = layer.bots.filter((candidate) => candidate.id !== bot.id);
        persistWorkspace();
        renderLayers();
        renderOutputPreview();
      });
      botCard.querySelector(".save-bot-preset").addEventListener("click", () => {
        requestPresetName("bots", bot);
      });
      grid.append(botCard);
    });
  }

  function renderRetrievalLayer(card, layer) {
    bindTextInput(card.querySelector(".retrieval-directory"), layer.config.directory, (value) => {
      layer.config.directory = value.trim();
    });
    bindNumberInput(card.querySelector(".retrieval-chunk-size"), layer.config.chunkSize, 1, (value) => {
      layer.config.chunkSize = value;
      ensureValidRetrievalOverlap(layer);
    });
    bindNumberInput(
      card.querySelector(".retrieval-chunk-overlap"),
      layer.config.chunkOverlap,
      0,
      (value) => {
        layer.config.chunkOverlap = Math.min(value, Math.max(0, layer.config.chunkSize - 1));
      }
    );
    bindNumberInput(card.querySelector(".retrieval-top-k"), layer.config.topK, 1, (value) => {
      layer.config.topK = value;
    });
  }

  function renderCustomLayer(card, layer) {
    const typeInput = card.querySelector(".custom-layer-type");
    const configInput = card.querySelector(".custom-layer-config");

    typeInput.value = layer.type;
    configInput.value = JSON.stringify(layer.config, null, 2);
    typeInput.addEventListener("change", () => {
      layer.type = normalizeText(typeInput.value, "custom");
      persistWorkspace();
      renderLayers();
    });
    configInput.addEventListener("change", () => {
      try {
        const parsed = JSON.parse(configInput.value || "{}");
        layer.config = cloneObject(parsed);
        configInput.value = JSON.stringify(layer.config, null, 2);
        persistWorkspace();
        setStatus(`Configuration du layer "${layer.name}" mise à jour.`);
      } catch (error) {
        setStatus("La configuration du layer custom doit être un objet JSON valide.", true);
      }
    });
  }

  function deleteLayer(layerId) {
    if (state.running) {
      return;
    }

    state.layers = state.layers.filter((layer) => layer.id !== layerId);
    persistWorkspace();
    renderLayers();
    renderOutputPreview();
  }

  function resetWorkspace() {
    if (state.running || !window.confirm("Réinitialiser le workspace avec les layers par défaut ?")) {
      return;
    }

    state.layers = normalizeLayers(state.config?.defaultLayers);
    const defaults = state.config?.sessionDefaults || {};
    elements.requestInput.value = normalizeText(defaults.initialRequest, "");
    configureSlider(elements.roundsSlider, {
      min: elements.roundsSlider.min,
      max: elements.roundsSlider.max,
      value: defaults.agentRoundsPerArbitration ?? 3
    });
    configureSlider(elements.arbitrationsSlider, {
      min: elements.arbitrationsSlider.min,
      max: elements.arbitrationsSlider.max,
      value: defaults.maxArbitrations ?? 2
    });
    elements.roundsValue.textContent = elements.roundsSlider.value;
    elements.arbitrationsValue.textContent = elements.arbitrationsSlider.value;
    persistWorkspace();
    renderLayers();
    renderOutputPreview();
    setStatus("Workspace réinitialisé.");
  }

  function bindTextInput(input, value, onCommit) {
    input.value = value;
    input.addEventListener("input", () => {
      onCommit(input.value);
      persistWorkspace();
    });
  }

  function bindNumberInput(input, value, min, onCommit) {
    input.value = value;
    input.addEventListener("change", () => {
      const normalized = min === 0
        ? nonNegativeInteger(input.value, value)
        : positiveInteger(input.value, value);
      input.value = normalized;
      onCommit(normalized);
      persistWorkspace();
    });
  }

  function bindCheckbox(input, value, onCommit) {
    input.checked = value;
    input.addEventListener("change", () => {
      onCommit(input.checked);
      persistWorkspace();
    });
  }

  function ensureValidRetrievalOverlap(layer) {
    layer.config.chunkOverlap = Math.min(
      layer.config.chunkOverlap,
      Math.max(0, layer.config.chunkSize - 1)
    );
  }

  async function openPresets({ kind = state.presetKind, targetLayerId = null } = {}) {
    state.presetTargetLayerId = targetLayerId;
    elements.presetsDrawer.hidden = false;
    await selectPresetKind(kind);
  }

  function closePresets() {
    state.presetTargetLayerId = null;
    elements.presetsDrawer.hidden = true;
  }

  async function selectPresetKind(kind) {
    state.presetKind = kind === "bots" ? "bots" : "layers";
    document.querySelectorAll("[data-preset-kind]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.presetKind === state.presetKind);
    });
    await loadPresets(state.presetKind);
  }

  async function loadPresets(kind) {
    elements.presetsList.replaceChildren(createEmptyState("Chargement..."));

    try {
      const response = await fetchJson(`/api/presets?kind=${encodeURIComponent(kind)}`);
      state.presets[kind] = normalizePresetResponse(response, kind);
      renderPresets(kind);
    } catch (error) {
      console.error(error);
      elements.presetsList.replaceChildren(createEmptyState(error.message || "Presets indisponibles."));
    }
  }

  function normalizePresetResponse(response, kind) {
    const candidates = Array.isArray(response)
      ? response
      : response?.presets ?? response?.[kind] ?? [];
    return Array.isArray(candidates)
      ? candidates
          .filter((preset) => preset && typeof preset === "object")
          .map((preset) => unwrapPreset(preset, kind))
      : [];
  }

  function unwrapPreset(preset, kind) {
    const value = preset.value
      ?? preset.preset
      ?? preset[kind === "layers" ? "layer" : "bot"]
      ?? preset;

    return {
      presetName: normalizeText(preset.name, "Preset sans nom"),
      value: clone(value)
    };
  }

  function renderPresets(kind) {
    elements.presetsList.replaceChildren();
    const presets = state.presets[kind];

    if (!presets.length) {
      elements.presetsList.append(createEmptyState("Aucun preset enregistré."));
      return;
    }

    presets.forEach((preset) => {
      const card = document.createElement("article");
      card.className = "preset-card";
      const content = document.createElement("div");
      const title = document.createElement("h3");
      const description = document.createElement("p");
      const actions = document.createElement("div");
      const loadButton = document.createElement("button");
      const deleteButton = document.createElement("button");

      title.textContent = preset.presetName;
      description.textContent = kind === "layers"
        ? describeLayerPreset(preset.value)
        : normalizeText(preset.value.persona, "Bot personnalisé");
      loadButton.type = "button";
      loadButton.className = "primary-button";
      loadButton.textContent = "Charger";
      loadButton.addEventListener("click", () => loadPreset(kind, preset));
      deleteButton.type = "button";
      deleteButton.className = "danger-button";
      deleteButton.textContent = "Supprimer";
      deleteButton.addEventListener("click", () => deletePreset(kind, preset.presetName));

      content.append(title, description);
      actions.append(loadButton, deleteButton);
      card.append(content, actions);
      elements.presetsList.append(card);
    });
  }

  function describeLayerPreset(preset) {
    if (preset.type === "retrieval") {
      return `Retrieval · ${normalizeText(preset.config?.directory, "répertoire non défini")}`;
    }
    return `Chatbots · ${Array.isArray(preset.bots) ? preset.bots.length : 0} bot(s)`;
  }

  function loadPreset(kind, preset) {
    if (state.running) {
      return;
    }

    if (kind === "layers") {
      addLayer(preset.value.type, preset.value);
      setStatus(`Preset "${preset.presetName}" chargé.`);
      closePresets();
      return;
    }

    const targetLayer = state.layers.find(
      (layer) => layer.id === state.presetTargetLayerId && layer.type === "chatbots"
    );

    if (targetLayer) {
      targetLayer.bots.push(createBot(preset.value));
    } else {
      const layer = createLayer("chatbots");
      layer.name = `Preset · ${preset.presetName}`;
      layer.bots = [createBot(preset.value)];
      state.layers.push(layer);
    }

    persistWorkspace();
    renderLayers();
    renderOutputPreview();
    setStatus(`Preset "${preset.presetName}" chargé.`);
    closePresets();
  }

  function requestPresetName(kind, value) {
    if (state.running) {
      return;
    }

    state.pendingPreset = { kind, value: clone(value) };
    elements.presetNameInput.value = normalizeText(value.name, "");
    elements.presetNameDialog.showModal();
    elements.presetNameInput.focus();
    elements.presetNameInput.select();
  }

  function closePresetNameDialog() {
    state.pendingPreset = null;
    elements.presetNameDialog.close();
  }

  async function submitPresetName(event) {
    event.preventDefault();
    const pending = state.pendingPreset;
    const name = normalizeText(elements.presetNameInput.value, "");

    if (!pending || !name) {
      return;
    }

    const preset = {
      name,
      value: pending.value
    };

    try {
      await fetchJson(`/api/presets/${pending.kind}`, {
        body: JSON.stringify(preset),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      closePresetNameDialog();
      setStatus(`Preset "${name}" enregistré.`);
      if (!elements.presetsDrawer.hidden && state.presetKind === pending.kind) {
        await loadPresets(pending.kind);
      }
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Enregistrement du preset impossible.", true);
    }
  }

  async function deletePreset(kind, name) {
    if (!name || !window.confirm(`Supprimer le preset "${name}" ?`)) {
      return;
    }

    try {
      await fetchJson(`/api/presets/${kind}/${encodeURIComponent(name)}`, {
        method: "DELETE"
      });
      setStatus(`Preset "${name}" supprimé.`);
      await loadPresets(kind);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Suppression du preset impossible.", true);
    }
  }

  async function startSession() {
    if (state.running) {
      return;
    }

    const enabledLayers = state.layers.filter((layer) => layer.enabled);
    if (!enabledLayers.length) {
      setStatus("Activez au moins un layer avant de lancer.", true);
      return;
    }
    if (!hasRunnableChatbots("debate")) {
      setStatus("Ajoutez au moins un bot actif dans un layer de fonction Débat.", true);
      return;
    }
    if (!hasRunnableChatbots("arbitrate")) {
      setStatus("Ajoutez au moins un bot actif dans un layer de fonction Arbitrage.", true);
      return;
    }

    persistWorkspace();
    renderOutputPreview();
    setRunning(true);
    setStatus("Démarrage de la session...");

    try {
      await fetchJson("/api/start", {
        body: JSON.stringify({
          agentRoundsPerArbitration: Number(elements.roundsSlider.value),
          initialRequest: elements.requestInput.value,
          layers: clone(state.layers),
          maxArbitrations: Number(elements.arbitrationsSlider.value)
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
    } catch (error) {
      console.error(error);
      setRunning(false);
      setStatus(error.message || "Échec du lancement.", true);
    }
  }

  function connectEvents() {
    const events = new EventSource("/events");
    events.onmessage = (message) => {
      try {
        handleServerEvent(JSON.parse(message.data));
      } catch (error) {
        console.error("Événement SSE invalide.", error);
      }
    };
    events.onerror = () => {
      setStatus("Connexion événementielle perdue. Reconnexion automatique...", true);
    };
  }

  function hasRunnableChatbots(purpose) {
    return state.layers.some(
      (layer) =>
        layer.enabled &&
        layer.type === "chatbots" &&
        layer.config.purpose === purpose &&
        layer.bots.length > 0
    );
  }

  function handleServerEvent(event) {
    const payload = event?.payload || {};

    if (event.type === "hello" || event.type === "running") {
      setRunning(Boolean(payload.running));
      return;
    }
    if (event.type === "snapshot") {
      renderSnapshot(payload);
      return;
    }
    if (event.type === "sessionIntro") {
      setStatus(payload.intro);
      return;
    }
    if (event.type === "status") {
      setStatus(payload.text);
      return;
    }
    if (event.type === "append") {
      appendOutput(payload);
      return;
    }
    if (event.type === "reload") {
      window.location.reload();
    }
  }

  function renderSnapshot(snapshot) {
    const layers = normalizeSnapshotLayers(snapshot);
    if (layers.length) {
      renderOutputs(layers);
    }
    setStatus(snapshot?.status || "Session en cours.");
  }

  function normalizeSnapshotLayers(snapshot) {
    if (Array.isArray(snapshot?.layers)) {
      return snapshot.layers.map((layer, index) => normalizeSnapshotLayer(layer, index));
    }

    return [];
  }

  function normalizeSnapshotLayer(layer, index) {
    const normalized = normalizeLayer(layer, index);
    normalized.bots = Array.isArray(layer?.bots)
      ? layer.bots.map((bot, botIndex) => ({
          ...normalizeBot(bot, botIndex),
          content: normalizeContent(bot.content ?? bot.contents ?? bot.output)
        }))
      : [];
    return normalized;
  }

  function renderOutputPreview() {
    const layers = state.layers
      .filter((layer) => layer.enabled && layer.type === "chatbots")
      .map((layer) => ({
        ...clone(layer),
        bots: layer.bots.map((bot) => ({ ...bot, content: "" }))
      }));
    renderOutputs(layers);
  }

  function renderOutputs(layers) {
    state.outputPanels.clear();
    elements.outputsWorkspace.replaceChildren();
    const visibleLayers = layers.filter(
      (layer) => layer.enabled !== false && Array.isArray(layer.bots) && layer.bots.length
    );

    if (!visibleLayers.length) {
      elements.outputsWorkspace.append(createEmptyState(
        "Les layers chatbots actifs apparaîtront ici."
      ));
      return;
    }

    visibleLayers.forEach((layer) => {
      const layerElement = cloneTemplate("#outputLayerTemplate");
      layerElement.dataset.layerId = layer.id;
      layerElement.querySelector(".output-layer__kind").textContent =
        layer.config?.purpose === "arbitrate" ? "Arbitrage" : "Débat";
      layerElement.querySelector(".output-layer__name").textContent = layer.name;
      const botsRoot = layerElement.querySelector(".output-bots");

      layer.bots.forEach((bot) => {
        const botElement = cloneTemplate("#outputBotTemplate");
        botElement.dataset.botId = bot.id;
        botElement.querySelector(".output-bot__name").textContent = bot.name;
        botElement.querySelector(".output-bot__persona").textContent =
          normalizeText(bot.persona, "Aucune persona");
        botElement.querySelector("pre").textContent = normalizeContent(bot.content);
        botsRoot.append(botElement);
        state.outputPanels.set(outputKey(layer.id, bot.id), botElement);
        state.outputPanels.set(bot.id, botElement);
      });

      elements.outputsWorkspace.append(layerElement);
    });
  }

  function appendOutput(payload) {
    const layerId = payload.layerId
      ?? (typeof payload.layer === "string" ? payload.layer : payload.layer?.id);
    const botId = payload.botId
      ?? (typeof payload.bot === "string" ? payload.bot : payload.bot?.id)
      ?? payload.id;
    const panel = state.outputPanels.get(outputKey(layerId, botId))
      || state.outputPanels.get(botId);

    if (!panel) {
      return;
    }

    const output = panel.querySelector("pre");
    const shouldFollow = output.scrollTop + output.clientHeight >= output.scrollHeight - 20;
    output.textContent += normalizeContent(payload.text ?? payload.content);
    panel.querySelector(".output-bot__status").textContent = "En cours";

    if (shouldFollow) {
      output.scrollTop = output.scrollHeight;
    }
  }

  function setRunning(running) {
    const wasRunning = state.running;
    state.running = running;
    elements.startButton.disabled = running;
    elements.startButton.textContent = running ? "Session en cours" : "Lancer la session";
    elements.roundsSlider.disabled = running;
    elements.arbitrationsSlider.disabled = running;
    elements.requestInput.disabled = running;
    elements.addChatbotsLayerButton.disabled = running;
    elements.addRetrievalLayerButton.disabled = running;
    elements.resetWorkspaceButton.disabled = running;
    elements.openPresetsButton.disabled = running;
    document.querySelectorAll(".layer-card").forEach(setInteractiveState);

    if (wasRunning && !running) {
      document.querySelectorAll(".output-bot__status").forEach((status) => {
        status.textContent = "Terminé";
      });
    }
  }

  function setInteractiveState(root) {
    root.querySelectorAll("input, textarea, select, button").forEach((control) => {
      control.disabled = state.running;
    });
  }

  function setStatus(text, isError = false) {
    elements.statusText.textContent = normalizeText(text, "Prêt.");
    elements.statusText.classList.toggle("is-error", isError);
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Requête impossible (${response.status}).`);
    }

    return data;
  }

  function createEmptyState(text) {
    const element = document.createElement("p");
    element.className = "empty-state";
    element.textContent = text;
    return element;
  }

  function cloneTemplate(selector) {
    return document.querySelector(selector).content.firstElementChild.cloneNode(true);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    try {
      return clone(value);
    } catch (error) {
      return {};
    }
  }

  function createId(prefix) {
    const suffix = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${suffix}`;
  }

  function outputKey(layerId, botId) {
    return `${normalizeText(layerId, "")}:${normalizeText(botId, "")}`;
  }

  function normalizeText(value, fallback) {
    if (typeof value !== "string") {
      return fallback;
    }
    return value.trim() || fallback;
  }

  function normalizeContent(value) {
    return typeof value === "string" ? value : "";
  }

  function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  function nonNegativeInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function clampInteger(value, min, max) {
    return Math.min(max, Math.max(min, positiveInteger(value, min)));
  }

  function readStorage(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      return key === THEME_STORAGE_KEY ? raw : JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(
        key,
        typeof value === "string" ? value : JSON.stringify(value)
      );
    } catch (error) {
      // La persistance locale reste optionnelle.
    }
  }

  function preferredTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    const dark = theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    elements.themeButton.textContent = dark ? "☀" : "☾";
    elements.themeButton.setAttribute(
      "aria-label",
      dark ? "Utiliser le thème clair" : "Utiliser le thème sombre"
    );
    writeStorage(THEME_STORAGE_KEY, dark ? "dark" : "light");
  }
})();
