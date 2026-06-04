 // Éléments DOM
      const elements = {
        arbiterPanels: document.querySelector("#arbiterPanels"),
        requestInput: document.querySelector("#requestInput"),
        slavePanels: document.querySelector("#slavePanels"),
        startButton: document.querySelector("#startButton"),
        // sliders
        roundsSlider: document.querySelector("#roundsSlider"),
        roundsValue: document.querySelector("#roundsValue"),
        arbitrationsSlider: document.querySelector("#arbitrationsSlider"),
        arbitrationsValue: document.querySelector("#arbitrationsValue"),
        // compteurs affichage
        slaveCountDisplay: document.querySelector("#slaveCountDisplay"),
        arbiterCountDisplay: document.querySelector("#arbiterCountDisplay"),
        // boutons +/-
        slaveMinus: document.querySelector("#slaveMinusBtn"),
        slavePlus: document.querySelector("#slavePlusBtn"),
        arbiterMinus: document.querySelector("#arbiterMinusBtn"),
        arbiterPlus: document.querySelector("#arbiterPlusBtn"),
        // status (pour messages utilisateur)
        statusText: document.querySelector("#statusText") // on va le créer dynamiquement? Gardons un petit élément pour les status
      };

      // Créer un élément de status discret si besoin (pour les retours utilisateur)
      const statusSpan = document.createElement("div");
      statusSpan.id = "statusText";
      statusSpan.style.fontSize = "0.8rem";
      statusSpan.style.marginTop = "1rem";
      statusSpan.style.color = "var(--text-soft)";
      statusSpan.style.textAlign = "center";
      document.querySelector(".prompt-bar").appendChild(statusSpan);
      elements.statusText = statusSpan;

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

      // Initialisation
      init();

      async function init() {
        try {
          state.config = await fetchConfig();
          applyDefaults();
          bindControlsAndSliders();
          connectEvents();
          renderPreviewPanels();
          setStatus("Prêt.");
        } catch (err) {
          console.error(err);
          setStatus("Erreur de configuration initiale.");
        }
      }

      async function fetchConfig() {
        const response = await fetch("/api/config");
        if (!response.ok) throw new Error("Configuration indisponible.");
        return response.json();
      }

      function applyDefaults() {
        const defaults = state.config.sessionDefaults;
        state.counts.slaves = defaults.slaveCount;
        state.counts.arbiters = defaults.arbiterCount;
        // sliders : valeurs par défaut depuis config
        elements.roundsSlider.value = defaults.agentRoundsPerArbitration;
        elements.roundsValue.textContent = defaults.agentRoundsPerArbitration;
        elements.arbitrationsSlider.value = defaults.maxArbitrations;
        elements.arbitrationsValue.textContent = defaults.maxArbitrations;
        elements.requestInput.value = defaults.initialRequest;
        updateCountersDisplay();
      }

      function updateCountersDisplay() {
        elements.slaveCountDisplay.textContent = state.counts.slaves;
        elements.arbiterCountDisplay.textContent = state.counts.arbiters;
      }

      function bindControlsAndSliders() {
        // Sliders + affichage
        elements.roundsSlider.addEventListener("input", (e) => {
          elements.roundsValue.textContent = e.target.value;
        });
        elements.arbitrationsSlider.addEventListener("input", (e) => {
          elements.arbitrationsValue.textContent = e.target.value;
        });

        // Boutons slaves
        elements.slaveMinus.addEventListener("click", () => {
          if (state.running) return;
          const limits = state.config.limits;
          const newVal = Math.max(limits.minSlaveAgents, state.counts.slaves - 1);
          if (newVal !== state.counts.slaves) {
            state.counts.slaves = newVal;
            updateCountersDisplay();
            renderPreviewPanels();
          }
        });
        elements.slavePlus.addEventListener("click", () => {
          if (state.running) return;
          const limits = state.config.limits;
          const newVal = Math.min(limits.maxSlaveAgents, state.counts.slaves + 1);
          if (newVal !== state.counts.slaves) {
            state.counts.slaves = newVal;
            updateCountersDisplay();
            renderPreviewPanels();
          }
        });

        // Boutons arbitres
        elements.arbiterMinus.addEventListener("click", () => {
          if (state.running) return;
          const limits = state.config.limits;
          const newVal = Math.max(limits.minArbiters, state.counts.arbiters - 1);
          if (newVal !== state.counts.arbiters) {
            state.counts.arbiters = newVal;
            updateCountersDisplay();
            renderPreviewPanels();
          }
        });
        elements.arbiterPlus.addEventListener("click", () => {
          if (state.running) return;
          const limits = state.config.limits;
          const newVal = Math.min(limits.maxArbiters, state.counts.arbiters + 1);
          if (newVal !== state.counts.arbiters) {
            state.counts.arbiters = newVal;
            updateCountersDisplay();
            renderPreviewPanels();
          }
        });

        elements.startButton.addEventListener("click", startSession);
      }

      function connectEvents() {
        const events = new EventSource("/events");
        events.onmessage = (message) => {
          const event = JSON.parse(message.data);
          handleServerEvent(event);
        };
        events.onerror = () => {
          setStatus("Connexion événementielle perdue. Reconnexion auto...");
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
        if (state.running) return;

        setRunning(true);
        setStatus("Démarrage de la session...");
        clearPanels();
        renderPreviewPanels();

        const payload = {
          agentRoundsPerArbitration: Number(elements.roundsSlider.value),
          arbiterCount: state.counts.arbiters,
          initialRequest: elements.requestInput.value,
          maxArbitrations: Number(elements.arbitrationsSlider.value),
          slaveCount: state.counts.slaves
        };

        const response = await fetch("/api/start", {
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Erreur inconnue." }));
          setRunning(false);
          setStatus(err.error || "Échec du lancement");
        }
      }

      function renderPreviewPanels() {
        const slaves = Array.from({ length: state.counts.slaves }, (_, idx) => ({
          content: "",
          id: createSlaveId(idx),
          name: `Agent ${createSlaveId(idx)}`,
          persona: "en attente de lancement"
        }));
        const arbiters = Array.from({ length: state.counts.arbiters }, (_, idx) => ({
          content: "",
          id: idx === 0 ? "ARBITER" : `ARBITER-${idx + 1}`,
          name: idx === 0 ? "Arbitre" : `Arbitre ${idx + 1}`,
          persona: "synthèse et arbitrage"
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

        for (const panel of panels) {
          const panelElement = createPanelElement({ collection, panel });
          root.append(panelElement);
          state.panels[collection].set(panel.id, panelElement);
        }
      }

      function createPanelElement({ collection, panel }) {
        const fragment = document.querySelector("#panelTemplate").content.cloneNode(true);
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
        if (!panel) return;

        const output = panel.querySelector("pre");
        const shouldFollow = output.scrollTop + output.clientHeight >= output.scrollHeight - 18;
        output.textContent += text;
        if (shouldFollow) output.scrollTop = output.scrollHeight;
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
        // désactiver les boutons de modification des compteurs pendant l'exécution
        const btns = [elements.slaveMinus, elements.slavePlus, elements.arbiterMinus, elements.arbiterPlus];
        btns.forEach(btn => { if(btn) btn.disabled = running; });
        // sliders désactivés pendant run
        elements.roundsSlider.disabled = running;
        elements.arbitrationsSlider.disabled = running;
      }

      function setStatus(text) {
        if (elements.statusText) elements.statusText.textContent = text || "Prêt.";
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

      // Petite initialisation des maps pour clear()
      state.panels.slaves.clear = function() { this.forEach((_, key) => this.delete(key)); };
      state.panels.arbiters.clear = function() { this.forEach((_, key) => this.delete(key)); };
      state.panels.slaves.clear = state.panels.slaves.clear.bind(state.panels.slaves);
      state.panels.arbiters.clear = state.panels.arbiters.clear.bind(state.panels.arbiters);