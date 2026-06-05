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
    closeConfigButton: document.querySelector("#closeConfigButton"),
    configDialog: document.querySelector("#configDialog"),
    configToggleButton: document.querySelector("#configToggleButton"),
    conversationScroll: document.querySelector("#conversationScroll"),
    layersWorkspace: document.querySelector("#layersWorkspace"),
    newConversationButton: document.querySelector("#newConversationButton"),
    openPresetsButton: document.querySelector("#openPresetsButton"),
    conversationWorkspace: document.querySelector("#conversationWorkspace"),
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
    conversation: null,
    conversationNodes: null,
    finalAnswerText: "",
    layers: [],
    reasoningBlocks: new Map(),
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
      renderConversationPreview();
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
    elements.requestInput.addEventListener("keydown", handleComposerKeydown);
    elements.startButton.addEventListener("click", startSession);
    elements.newConversationButton.addEventListener("click", startNewConversation);
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
    elements.configToggleButton.addEventListener("click", () => {
      elements.configDialog.showModal();

      requestAnimationFrame(() => {
        elements.layersWorkspace.focus();
      });
    });
    elements.closeConfigButton.addEventListener("click", () => elements.configDialog.close());
    elements.configDialog.addEventListener("click", (event) => {
      // Ferme uniquement si le clic tombe dans le backdrop (hors du panneau interne)
      const rect = elements.configDialog.getBoundingClientRect();
      const insidePanel =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!insidePanel) {
        elements.configDialog.close();
      }
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
    const name = normalizeText(bot.name, normalizeText(bot.persona, `Bot ${index + 1}`));

    return {
      id: normalizeText(bot.id, createId(`bot-${index + 1}`)),
      name,
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
    renderConversationPreview();
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
        renderConversationPreview();
      });
      bindCheckbox(card.querySelector(".layer-enabled"), layer.enabled, (value) => {
        layer.enabled = value;
        card.classList.toggle("is-disabled", !value);
        renderConversationPreview();
      });
      card.classList.toggle("is-disabled", !layer.enabled);

      card.querySelector(".move-layer-up").addEventListener("click", () => {
        moveLayer(layer.id, -1);
      });

      card.querySelector(".move-layer-down").addEventListener("click", () => {
        moveLayer(layer.id, 1);
      });

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
      updateLayerMoveButtons(card, index);
      elements.layersWorkspace.append(card);
    });
  }

  function renderChatbotsLayer(card, layer) {
    const purpose = card.querySelector(".layer-purpose");
    purpose.value = layer.config.purpose;
    purpose.addEventListener("change", () => {
      layer.config.purpose = purpose.value === "arbitrate" ? "arbitrate" : "debate";
      persistWorkspace();
      renderConversationPreview();
    });
    card.querySelector(".add-bot").addEventListener("click", () => {
      layer.bots.push(createBot());
      persistWorkspace();
      renderLayers();
      renderConversationPreview();
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
        renderConversationPreview();
      });
      bindTextInput(botCard.querySelector(".bot-system-prompt"), bot.systemPrompt, (value) => {
        bot.systemPrompt = value;
      });
      botCard.querySelector(".delete-bot").addEventListener("click", () => {
        layer.bots = layer.bots.filter((candidate) => candidate.id !== bot.id);
        persistWorkspace();
        renderLayers();
        renderConversationPreview();
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

  function startNewConversation() {
    if (state.running) {
      setStatus("Attendez la fin de la session avant de démarrer une nouvelle conversation.", true);
      return;
    }

    state.conversation = null;
    state.conversationNodes = null;
    state.reasoningBlocks.clear();
    elements.requestInput.value = "";
    persistWorkspace();
    renderConversation();
    setStatus("Nouvelle conversation prête.");
  }

  function deleteLayer(layerId) {
    if (state.running) {
      return;
    }

    state.layers = state.layers.filter((layer) => layer.id !== layerId);
    persistWorkspace();
    renderLayers();
    renderConversationPreview();
  }

  function moveLayer(layerId, direction) {
    if (state.running) {
      return;
    }

    const currentIndex = state.layers.findIndex((layer) => layer.id === layerId);
    if (currentIndex === -1) {
      return;
    }

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= state.layers.length) {
      return;
    }

    const scrollTop = elements.layersWorkspace.scrollTop;

    const [movedLayer] = state.layers.splice(currentIndex, 1);
    state.layers.splice(targetIndex, 0, movedLayer);

    persistWorkspace();
    renderLayers();
    renderConversationPreview();

    elements.layersWorkspace.scrollTop = scrollTop;
    setStatus(`Layer "${movedLayer.name}" déplacé.`);
  }

  function handleComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      startSession();
    }
  }

  function updateLayerMoveButtons(card, index) {
    const upButton = card.querySelector(".move-layer-up");
    const downButton = card.querySelector(".move-layer-down");

    if (!upButton || !downButton) {
      return;
    }

    upButton.disabled = state.running || index === 0;
    downButton.disabled = state.running || index === state.layers.length - 1;
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
    renderConversationPreview();
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
        : normalizeText(preset.value.name, normalizeText(preset.value.persona, "Bot personnalisé"));
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
    renderConversationPreview();
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

    const initialRequest = normalizeText(elements.requestInput.value, "");
    if (!initialRequest) {
      setStatus("Entrez une question initiale avant de lancer.", true);
      return;
    }

    state.conversation = createConversation({
      initialRequest,
      running: true,
      turns: []
    });
    elements.requestInput.value = "";
    persistWorkspace();
    renderConversation();
    setRunning(true);
    setStatus("Démarrage de la session...");

    try {
      await fetchJson("/api/start", {
        body: JSON.stringify({
          agentRoundsPerArbitration: Number(elements.roundsSlider.value),
          initialRequest,
          layers: clone(state.layers),
          maxArbitrations: Number(elements.arbitrationsSlider.value)
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
    } catch (error) {
      console.error(error);
      setRunning(false);
      elements.requestInput.value = initialRequest;
      persistWorkspace();
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
      appendConversationOutput(payload);
      return;
    }
    if (event.type === "turnStart") {
      startConversationTurn(payload.turn);
      return;
    }
    if (event.type === "turnEnd") {
      completeConversationTurn(payload.turnId);
      return;
    }
    if (event.type === "reload") {
      window.location.reload();
    }
  }

  function renderSnapshot(snapshot) {
    state.conversation = createConversationFromSnapshot(snapshot);
    renderConversation();
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

  function renderConversationPreview() {
    renderConversation();
  }

  function renderConversation() {
    state.reasoningBlocks.clear();
    state.conversationNodes = null;
    elements.conversationWorkspace.replaceChildren();

    if (!state.conversation) {
      elements.conversationWorkspace.append(createEmptyState(
        "Envoyez un message pour démarrer la conversation."
      ));
      return;
    }

    const conversation = cloneTemplate("#conversationTemplate");
    const nodes = {
      answer: conversation.querySelector(".final-answer"),
      reasoningList: conversation.querySelector(".reasoning-list"),
      userMessage: conversation.querySelector(".user-message")
    };

    nodes.userMessage.textContent = state.conversation.initialRequest;

    for (const turn of state.conversation.turns) {
      appendThinkingTurn(nodes, turn);
    }

    state.conversationNodes = nodes;
    updateConversationSummary();
    elements.conversationWorkspace.append(conversation);
    scrollConversationToBottom();
  }

  function appendThinkingTurn(nodes, turn) {
    const turnElement = cloneTemplate("#thinkingTurnTemplate");
    const content = turnElement.querySelector("pre");

    turnElement.dataset.turnId = turn.id;
    turnElement.dataset.turnKind = turn.kind;
    turnElement.classList.toggle("is-active", turn.status === "running");
    turnElement.classList.toggle("is-complete", turn.status === "complete");
    turnElement.open = turn.status === "running";
    turnElement.querySelector(".reasoning-block__title").textContent =
      normalizeText(turn.title, `Thinking about ${normalizeText(turn.agentName, "un agent")}...`);
    turnElement.querySelector(".reasoning-block__meta").textContent = normalizeText(turn.meta, "");
    content.textContent = sanitizeVisibleModelText(turn.content, turn);

    nodes.reasoningList.append(turnElement);
    registerReasoningBlock(turn, turnElement);
  }

  function createConversation({ initialRequest, running, turns }) {
    return {
      initialRequest: normalizeText(initialRequest, ""),
      running: Boolean(running),
      turns: normalizeConversationTurns(turns)
    };
  }

  function createConversationFromSnapshot(snapshot) {
    const turns = Array.isArray(snapshot?.turns)
      ? snapshot.turns
      : deriveTurnsFromSnapshotLayers(snapshot);

    return createConversation({
      initialRequest: snapshot?.session?.initialRequest,
      running: state.running,
      turns
    });
  }

  function deriveTurnsFromSnapshotLayers(snapshot) {
    const layers = normalizeSnapshotLayers(snapshot);
    const turns = [];

    for (const layer of layers) {
      if (layer.type !== "chatbots") {
        continue;
      }

      for (const bot of layer.bots) {
        const content = normalizeContent(bot.content);
        if (!content) {
          continue;
        }

        turns.push({
          id: createId("snapshot-turn"),
          agentName: bot.name,
          botId: bot.id,
          content,
          kind: layer.config?.purpose === "arbitrate" ? "arbiter" : "agent",
          layerId: layer.id,
          meta: layer.name,
          status: "complete",
          title: `Thinking about ${bot.name}...`
        });
      }
    }

    return turns;
  }

  function normalizeConversationTurns(turns) {
    if (!Array.isArray(turns)) {
      return [];
    }

    return turns
      .filter((turn) => turn && typeof turn === "object")
      .map((turn, index) => normalizeConversationTurn(turn, index));
  }

  function normalizeConversationTurn(turn, index = 0) {
    const kind = normalizeConversationTurnKind(turn.kind);
    const agentName = normalizeText(turn.agentName, getDefaultTurnAgentName(kind));

    return {
      id: normalizeText(turn.id, createId(`turn-${index + 1}`)),
      agentName,
      botId: normalizeText(turn.botId, ""),
      content: normalizeContent(turn.content),
      kind,
      layerId: normalizeText(turn.layerId, ""),
      meta: normalizeText(turn.meta, ""),
      status: turn.status === "complete" ? "complete" : "running",
      title: normalizeText(turn.title, getDefaultTurnTitle(kind, agentName))
    };
  }

  function normalizeConversationTurnKind(kind) {
    if (kind === "arbiter" || kind === "retrieval") {
      return kind;
    }

    return "agent";
  }

  function getDefaultTurnAgentName(kind) {
    if (kind === "arbiter") {
      return "Arbitre";
    }
    if (kind === "retrieval") {
      return "Retrieval";
    }

    return "Agent";
  }

  function getDefaultTurnTitle(kind, agentName) {
    if (kind === "arbiter") {
      return `Arbitrage par ${agentName}`;
    }
    if (kind === "retrieval") {
      return `Retrieval - ${agentName}`;
    }

    return `Thinking about ${agentName}...`;
  }

  function startConversationTurn(turn) {
    if (!state.conversation) {
      state.conversation = createConversation({
        initialRequest: elements.requestInput.value,
        running: true,
        turns: []
      });
      renderConversation();
    }

    const normalizedTurn = normalizeConversationTurn(turn, state.conversation.turns.length);
    const existingTurn = findConversationTurn(normalizedTurn.id) ||
      findConversationTurnForPayload({
        agentName: normalizedTurn.agentName,
        botId: normalizedTurn.botId,
        id: normalizedTurn.botId,
        layerId: normalizedTurn.layerId
      });
    if (existingTurn) {
      const previousTurnId = existingTurn.id;
      Object.assign(existingTurn, {
        agentName: normalizedTurn.agentName,
        botId: normalizedTurn.botId,
        id: normalizedTurn.id,
        kind: normalizedTurn.kind,
        layerId: normalizedTurn.layerId,
        meta: normalizedTurn.meta,
        status: "running",
        title: normalizedTurn.title
      });

      const existingPanel = findReasoningBlockForPayload({
        botId: existingTurn.botId,
        id: existingTurn.botId,
        layerId: existingTurn.layerId,
        turnId: existingTurn.id
      }) || findReasoningBlockForPayload({
        botId: existingTurn.botId,
        id: existingTurn.botId,
        layerId: existingTurn.layerId,
        turnId: previousTurnId
      });

      if (existingPanel) {
        existingPanel.classList.add("is-active");
        existingPanel.classList.remove("is-complete");
        existingPanel.open = true;
        registerReasoningBlock(existingTurn, existingPanel);
      } else if (state.conversationNodes) {
        appendThinkingTurn(state.conversationNodes, existingTurn);
      } else {
        renderConversation();
      }

      updateConversationSummary();
      scrollConversationToBottom();
      return;
    }

    state.conversation.turns.push(normalizedTurn);

    if (!state.conversationNodes) {
      renderConversation();
      return;
    }

    collapseRunningThinkingTurns();
    appendThinkingTurn(state.conversationNodes, normalizedTurn);
    updateConversationSummary();
    scrollConversationToBottom();
  }

  function completeConversationTurn(turnId) {
    const turn = findConversationTurn(turnId);
    if (turn) {
      turn.status = "complete";
    }

    const panel = findReasoningBlockForPayload({ turnId });
    if (panel) {
      panel.classList.remove("is-active");
      panel.classList.add("is-complete");
      panel.open = false;
    }

    updateConversationSummary();
    scrollConversationToBottom();
  }

  function collapseRunningThinkingTurns() {
    document.querySelectorAll(".reasoning-block.is-active").forEach((turn) => {
      turn.classList.remove("is-active");
      turn.classList.add("is-complete");
      turn.open = false;
    });
  }

  function findConversationTurn(turnId) {
    const normalizedTurnId = normalizeText(turnId, "");
    if (!normalizedTurnId || !state.conversation) {
      return null;
    }

    return state.conversation.turns.find((turn) => turn.id === normalizedTurnId) || null;
  }

  function findConversationTurnForPayload(payload) {
    const exactTurn = findConversationTurn(payload?.turnId);
    if (exactTurn) {
      return exactTurn;
    }
    if (!state.conversation) {
      return null;
    }

    const layerId = normalizeText(payload?.layerId, "");
    const botId = normalizeText(payload?.botId ?? payload?.id, "");
    const agentName = normalizeLookupText(payload?.agentName ?? payload?.botName ?? payload?.name);
    const runningTurns = state.conversation.turns.filter((turn) => turn.status === "running");

    return runningTurns.find((turn) =>
      layerId &&
      botId &&
      turn.layerId === layerId &&
      turn.botId === botId
    ) ||
      runningTurns.find((turn) => botId && turn.botId === botId) ||
      runningTurns.find((turn) =>
        layerId &&
        agentName &&
        turn.layerId === layerId &&
        normalizeLookupText(turn.agentName) === agentName
      ) ||
      null;
  }

  function findReasoningBlockForPayload(payload) {
    const keys = getReasoningKeysForPayload(payload);
    for (const key of keys) {
      const block = state.reasoningBlocks.get(key);
      if (block) {
        return block;
      }
    }

    const turn = findConversationTurnForPayload(payload);
    if (!turn) {
      return null;
    }

    for (const key of getReasoningKeysForTurn(turn)) {
      const block = state.reasoningBlocks.get(key);
      if (block) {
        return block;
      }
    }

    return null;
  }

  function registerReasoningBlock(turn, block) {
    for (const key of getReasoningKeysForTurn(turn)) {
      state.reasoningBlocks.set(key, block);
    }
  }

  function getReasoningKeysForTurn(turn) {
    return getReasoningKeys({
      agentName: turn?.agentName,
      botId: turn?.botId,
      id: turn?.botId,
      layerId: turn?.layerId,
      name: turn?.agentName,
      turnId: turn?.id
    });
  }

  function getReasoningKeysForPayload(payload) {
    return getReasoningKeys({
      agentName: payload?.agentName ?? payload?.botName ?? payload?.name,
      botId: payload?.botId ?? payload?.id,
      id: payload?.id,
      layerId: payload?.layerId,
      name: payload?.name,
      turnId: payload?.turnId
    });
  }

  function getReasoningKeys(source) {
    const keys = [];
    const turnId = normalizeText(source?.turnId, "");
    const layerId = normalizeText(source?.layerId, "");
    const botId = normalizeText(source?.botId ?? source?.id, "");
    const agentName = normalizeLookupText(source?.agentName ?? source?.name);

    addReasoningKey(keys, turnId);
    if (layerId || botId) {
      addReasoningKey(keys, reasoningKey(layerId, botId));
    }
    addReasoningKey(keys, botId);
    if (agentName) {
      addReasoningKey(keys, `name:${agentName}`);
      if (layerId) {
        addReasoningKey(keys, `name:${layerId}:${agentName}`);
      }
    }

    return keys;
  }

  function addReasoningKey(keys, key) {
    const normalizedKey = normalizeText(key, "");
    if (!normalizedKey || normalizedKey === ":" || keys.includes(normalizedKey)) {
      return;
    }

    keys.push(normalizedKey);
  }

  function createLiveConversationTurn(payload) {
    const target = findLayerBotForPayload(payload);
    const layer = target?.layer || null;
    const bot = target?.bot || null;
    const layerId = normalizeText(payload?.layerId, layer?.id || "");
    const botId = normalizeText(payload?.botId ?? payload?.id, bot?.id || "");
    const inferredKind = layer?.type === "retrieval"
      ? "retrieval"
      : layer?.config?.purpose === "arbitrate"
        ? "arbiter"
        : "agent";
    const kind = normalizeConversationTurnKind(payload?.kind || inferredKind);
    const agentName = normalizeText(
      payload?.agentName ?? payload?.botName ?? payload?.name,
      bot?.name || layer?.name || getDefaultTurnAgentName(kind)
    );

    return normalizeConversationTurn({
      agentName,
      botId,
      content: "",
      id: normalizeText(payload?.turnId, createId("live-turn")),
      kind,
      layerId,
      meta: normalizeText(payload?.meta, layer?.name || ""),
      status: "running",
      title: normalizeText(payload?.title, getDefaultTurnTitle(kind, agentName))
    }, state.conversation?.turns.length || 0);
  }

  function findLayerBotForPayload(payload) {
    const layerId = normalizeText(payload?.layerId, "");
    const botId = normalizeText(payload?.botId ?? payload?.id, "");
    const agentName = normalizeLookupText(payload?.agentName ?? payload?.botName ?? payload?.name);

    for (const layer of state.layers) {
      if (layerId && layer.id !== layerId) {
        continue;
      }

      const bot = layer.bots.find((candidate) =>
        botId && candidate.id === botId
      ) || layer.bots.find((candidate) =>
        agentName && normalizeLookupText(candidate.name) === agentName
      ) || null;

      if (bot || layerId) {
        return { bot, layer };
      }
    }

    if (!botId && !agentName) {
      return null;
    }

    for (const layer of state.layers) {
      const bot = layer.bots.find((candidate) =>
        botId && candidate.id === botId
      ) || layer.bots.find((candidate) =>
        agentName && normalizeLookupText(candidate.name) === agentName
      ) || null;

      if (bot) {
        return { bot, layer };
      }
    }

    return null;
  }

  function updateConversationSummary() {
    const nodes = state.conversationNodes;
    if (!nodes || !state.conversation) {
      return;
    }

    const completedOutputTurns = [...state.conversation.turns]
      .filter((turn) => turn.kind !== "retrieval" && normalizeContent(turn.content).trim());
    const latestArbiterTurn = [...completedOutputTurns]
      .reverse()
      .find((turn) => turn.kind === "arbiter");
    const fallbackTurn = [...completedOutputTurns].reverse()[0];
    const finalTurn = state.conversation.running
      ? null
      : latestArbiterTurn || fallbackTurn || null;
    const answer = sanitizeVisibleModelText(finalTurn?.content, finalTurn).trim();

    if (answer) {
      nodes.answer.innerHTML = renderMarkdown(answer);
      if (state.finalAnswerText !== answer) {
        state.finalAnswerText = answer;
      }
    } else {
      nodes.answer.textContent = state.conversation.running
        ? "Thinking..."
        : "La réponse finale apparaîtra ici.";
      state.finalAnswerText = "";
    }

    nodes.answer.classList.toggle("is-waiting", !answer && state.conversation.running);
    nodes.answer.classList.toggle("is-empty", !answer);
  }

  function appendConversationOutput(payload) {
    const panel = ensureReasoningBlockForPayload(payload);

    if (!panel) {
      return;
    }

    const output = panel.querySelector("pre");
    const shouldFollow = output.scrollTop + output.clientHeight >= output.scrollHeight - 20;
    const text = normalizeContent(payload.text ?? payload.content);
    panel.classList.add("is-active");
    panel.classList.remove("is-complete");
    panel.open = true;

    const turn = findConversationTurnForPayload(payload);
    if (turn) {
      turn.content += text;
      registerReasoningBlock(turn, panel);
      const visibleText = sanitizeVisibleModelText(turn.content, turn);
      output.textContent = visibleText;
    } else {
      const visibleText = sanitizeVisibleModelText(text);
      output.textContent += visibleText;
    }

    if (shouldFollow) {
      output.scrollTop = output.scrollHeight;
    }

    updateConversationSummary();
    scrollConversationToBottom();
  }

  function ensureReasoningBlockForPayload(payload) {
    if (!state.conversation) {
      state.conversation = createConversation({
        initialRequest: elements.requestInput.value,
        running: true,
        turns: []
      });
    }

    if (!state.conversationNodes) {
      renderConversation();
    }

    const existingPanel = findReasoningBlockForPayload(payload);
    if (existingPanel) {
      return existingPanel;
    }

    let turn = findConversationTurnForPayload(payload);
    if (!turn) {
      turn = createLiveConversationTurn(payload);
      state.conversation.turns.push(turn);
    }

    if (!state.conversationNodes) {
      renderConversation();
    } else {
      appendThinkingTurn(state.conversationNodes, turn);
    }

    const panel = findReasoningBlockForPayload({
      ...payload,
      botId: turn.botId,
      id: turn.botId,
      layerId: turn.layerId,
      turnId: turn.id
    });

    return panel;
  }

  function setRunning(running) {
    const wasRunning = state.running;
    state.running = running;
    elements.startButton.disabled = running;
    elements.startButton.textContent = running ? "…" : "↑";
    elements.startButton.setAttribute("aria-label", running ? "Session en cours" : "Envoyer");
    elements.newConversationButton.disabled = running;
    elements.roundsSlider.disabled = running;
    elements.arbitrationsSlider.disabled = running;
    elements.requestInput.disabled = running;
    elements.addChatbotsLayerButton.disabled = running;
    elements.addRetrievalLayerButton.disabled = running;
    elements.resetWorkspaceButton.disabled = running;
    elements.openPresetsButton.disabled = running;
    document.querySelectorAll(".layer-card").forEach(setInteractiveState);

    if (state.conversation) {
      state.conversation.running = running;
    }

    if (wasRunning && !running) {
      document.querySelectorAll(".reasoning-block.is-active").forEach((turn) => {
        turn.classList.remove("is-active");
        turn.classList.add("is-complete");
        turn.open = false;
      });
    }

    updateConversationSummary();
    if (!running) {
      scrollConversationToBottom();
    }
  }

  function scrollConversationToBottom() {
    requestAnimationFrame(() => {
      elements.conversationScroll.scrollTop = elements.conversationScroll.scrollHeight;
    });
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

  function sanitizeVisibleModelText(value, turn = null) {
  const agentName = normalizeText(turn?.agentName, "");
  let text = normalizeContent(value).replace(/\r\n/g, "\n");

  text = text
    .split("\n")
    .filter((line) => !isTechnicalTranscriptHeader(line))
    .join("\n");

  return stripLeadingVisibleWrappers(text, agentName);
}

function stripLeadingVisibleWrappers(text, agentName = "") {
  const lines = text.split("\n");

  const agentPattern = agentName
    ? new RegExp(`^${escapeRegExp(agentName)}\\s*:?$`, "i")
    : null;

  const labelPattern =
    /^(?:R[eé]ponse|REPONSE|RÉPONSE|Synth[eè]se|SYNTHESE|Synthèse|SYNTHÈSE)\s*:\s*(.*)$/i;

  while (lines.length > 0) {
    const rawLine = lines[0] ?? "";
    const trimmedLine = rawLine.trim();

    if (!trimmedLine) {
      lines.shift();
      continue;
    }

    if (isTechnicalTranscriptHeader(trimmedLine)) {
      lines.shift();
      continue;
    }

    if (agentPattern && agentPattern.test(trimmedLine)) {
      lines.shift();
      continue;
    }

    const labelMatch = trimmedLine.match(labelPattern);
    if (labelMatch) {
      lines.shift();

      const restOfLine = normalizeText(labelMatch[1], "");
      if (restOfLine) {
        lines.unshift(restOfLine);
      }

      continue;
    }

    break;
  }

  return lines.join("\n").replace(/^\s+/, "");
}

  function isTechnicalTranscriptHeader(line) {
    const normalizedLine = normalizeText(line, "");
    if (!normalizedLine) {
      return false;
    }

    return /^={2,}.*(?:ARBITRAGE|TOUR|R[EÉ]PONSE|REPONSE|SYNTH[EÈ]SE|SYNTHESE).*={2,}.*$/i
      .test(normalizedLine);
  }

  function renderMarkdown(source) {
    const lines = normalizeContent(source).replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        index++;
        continue;
      }

      if (line.startsWith("```")) {
        const language = sanitizeCodeLanguage(line.slice(3).trim());
        const codeLines = [];
        index++;

        while (index < lines.length && !lines[index].startsWith("```")) {
          codeLines.push(lines[index]);
          index++;
        }

        if (index < lines.length) {
          index++;
        }

        const className = language ? ` class="language-${language}"` : "";
        blocks.push(`<pre><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        const level = Math.min(heading[1].length + 1, 4);
        blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        index++;
        continue;
      }

      const unordered = line.match(/^\s*[-*]\s+(.+)$/);
      if (unordered) {
        const items = [];

        while (index < lines.length) {
          const item = lines[index].match(/^\s*[-*]\s+(.+)$/);
          if (!item) {
            break;
          }
          items.push(`<li>${renderInlineMarkdown(item[1])}</li>`);
          index++;
        }

        blocks.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ordered) {
        const items = [];

        while (index < lines.length) {
          const item = lines[index].match(/^\s*\d+\.\s+(.+)$/);
          if (!item) {
            break;
          }
          items.push(`<li>${renderInlineMarkdown(item[1])}</li>`);
          index++;
        }

        blocks.push(`<ol>${items.join("")}</ol>`);
        continue;
      }

      const paragraph = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !isMarkdownBlockStart(lines[index])
      ) {
        paragraph.push(lines[index].trim());
        index++;
      }

      blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    }

    return blocks.join("");
  }

  function renderInlineMarkdown(text) {
    const codeSnippets = [];
    const withPlaceholders = normalizeContent(text).replace(/`([^`\n]+)`/g, (_, code) => {
      const placeholder = `\u0000${codeSnippets.length}\u0000`;
      codeSnippets.push(`<code>${escapeHtml(code)}</code>`);
      return placeholder;
    });

    let html = escapeHtml(withPlaceholders);
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\b_([^_]+)_\b/g, "<em>$1</em>");
    html = html.replace(/\u0000(\d+)\u0000/g, (_, index) => codeSnippets[Number(index)] || "");

    return html;
  }

  function isMarkdownBlockStart(line) {
    return line.startsWith("```") ||
      /^(#{1,4})\s+/.test(line) ||
      /^\s*[-*]\s+/.test(line) ||
      /^\s*\d+\.\s+/.test(line);
  }

  function sanitizeCodeLanguage(language) {
    return normalizeText(language.split(/\s+/)[0], "").replace(/[^a-z0-9_-]/gi, "");
  }

  function escapeHtml(value) {
    return normalizeContent(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(value) {
    return normalizeText(value, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  function reasoningKey(layerId, botId) {
    return `${normalizeText(layerId, "")}:${normalizeText(botId, "")}`;
  }

  function normalizeText(value, fallback) {
    if (typeof value !== "string") {
      return fallback;
    }
    return value.trim() || fallback;
  }

  function normalizeLookupText(value) {
    return normalizeText(value, "").toLowerCase();
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
