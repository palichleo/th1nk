const fs = require("fs/promises");
const http = require("http");
const path = require("path");

const { runDebate } = require("./debateOrchestrator");
const {
  createDefaultLayers,
  createRuntimeFromLayers,
  normalizeLayers
} = require("./layers");
const { checkOllamaModels } = require("./ollamaClient");
const { createPresetStore } = require("./presetStore");
const { buildRetrievalContext } = require("./retrievalLayer");
const { createWebUi } = require("./webUi");

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function createWebServer({ config }) {
  const publicDir = path.join(__dirname, "public");
  const clients = new Set();
  const presetStore = createPresetStore({
    dataDirectory: config.dataDirectory
  });

  let currentUi = null;
  let isRunning = false;

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://localhost");

      if (request.method === "GET" && requestUrl.pathname === "/events") {
        handleEvents(request, response);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/config") {
        sendJson(response, 200, getPublicConfig(config));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/presets") {
        await handlePresetList(requestUrl, response);
        return;
      }

      if (requestUrl.pathname.startsWith("/api/presets/")) {
        await handlePresetMutation({ request, requestUrl, response });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/start") {
        await handleStart(request, response);
        return;
      }

      if (request.method === "GET") {
        await serveStatic({ publicDir, requestUrl, response });
        return;
      }

      sendJson(response, 405, {
        error: "Methode non supportee."
      });
    } catch (error) {
      sendJson(response, getErrorStatus(error), {
        error: error.message
      });
    }
  });

  server.broadcastEvent = broadcastEvent;

  function handleEvents(request, response) {
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    });

    clients.add(response);

    sendToClient(response, {
      type: "hello",
      payload: {
        running: isRunning
      }
    });

    if (currentUi) {
      sendToClient(response, {
        type: "snapshot",
        payload: currentUi.getSnapshot()
      });
    }

    request.on("close", () => {
      clients.delete(response);
    });
  }

  async function handlePresetList(requestUrl, response) {
    const kind = requestUrl.searchParams.get("kind");
    const presets = await presetStore.list(kind);

    sendJson(response, 200, {
      presets
    });
  }

  async function handlePresetMutation({ request, requestUrl, response }) {
    const pathParts = requestUrl.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
    const kind = pathParts[2];
    const name = pathParts[3];

    if (request.method === "POST" && !name) {
      const preset = await readJsonBody(request);
      const savedPreset = await presetStore.save(kind, preset);

      sendJson(response, 201, savedPreset);
      return;
    }

    if (request.method === "DELETE" && name) {
      const removed = await presetStore.remove(kind, name);

      sendJson(response, removed ? 200 : 404, {
        removed
      });
      return;
    }

    sendJson(response, 405, {
      error: "Methode de preset non supportee."
    });
  }

  async function handleStart(request, response) {
    if (isRunning) {
      sendJson(response, 409, {
        error: "Une session est deja en cours."
      });
      return;
    }

    const input = await readJsonBody(request);
    const session = normalizeSession({ config, input });
    const layers = normalizeLayers({
      inputLayers: input.layers,
      sessionDefaults: config.sessionDefaults
    });
    const runtime = createRuntimeFromLayers(layers);
    validateRuntime(runtime);

    session.slaveCount = runtime.slaveAgents.length;
    session.arbiterCount = runtime.arbiterAgents.length;

    currentUi = createWebUi({
      layers,
      sendEvent: broadcast,
      session
    });
    isRunning = true;

    currentUi.render();
    sendJson(response, 202, {
      ok: true
    });

    runSession({
      ...runtime,
      session
    }).catch((error) => {
      if (currentUi) {
        currentUi.appendArbiter(`\n\nERREUR :\n${error.message}\n`);
        currentUi.setStatus("Erreur detectee.");
      }
    });
  }

  async function runSession({
    arbiterAgents,
    retrievalLayers,
    session,
    slaveAgents
  }) {
    try {
      currentUi.setStatus("Preparation du contexte documentaire...");
      const retrieval = await buildCombinedRetrievalContext({
        dataDirectory: config.dataDirectory,
        layers: retrievalLayers,
        query: session.initialRequest
      });

      currentUi.setStatus("Verification d'Ollama...");

      await checkOllamaModels({
        baseUrl: config.ollamaBaseUrl,
        models: [config.models.slave, config.models.arbiter]
      });

      const stats = await runDebate({
        arbiterAgents,
        config,
        referenceContext: retrieval.context,
        retrieveReferenceContext: async (query) => {
          const nextRetrieval = await buildCombinedRetrievalContext({
            dataDirectory: config.dataDirectory,
            layers: retrievalLayers,
            query
          });

          return nextRetrieval.context;
        },
        session,
        slaveAgents,
        ui: currentUi
      });

      const retrievalSummary = retrieval.chunksSelected > 0
        ? `, ${retrieval.chunksSelected} chunks documentaires`
        : "";
      const retrievalWarnings = retrieval.errorCount > 0
        ? `, ${retrieval.errorCount} avertissements retrieval`
        : "";

      currentUi.setStatus(
        `Debat termine. ${stats.agentResponseCount} reponses agents, ${stats.arbitrationCount} arbitrages${retrievalSummary}${retrievalWarnings}.`
      );
    } finally {
      isRunning = false;
      broadcast({
        type: "running",
        payload: {
          running: false
        }
      });
    }
  }

  function broadcast(event) {
    for (const client of clients) {
      sendToClient(client, event);
    }
  }

  function broadcastEvent(event) {
    for (const client of clients) {
      sendToClient(client, event);
    }
  }

  return server;
}

async function buildCombinedRetrievalContext({ dataDirectory, layers, query }) {
  const results = await Promise.all(
    layers.map(async (layer) => ({
      layer,
      result: await buildRetrievalContext({
        dataDirectory,
        layer,
        query
      })
    }))
  );
  const contexts = [];
  let chunksSelected = 0;
  let errorCount = 0;

  for (const { layer, result } of results) {
    chunksSelected += result.stats.chunksSelected;
    errorCount += result.stats.errors.length;

    if (result.context) {
      contexts.push(`# ${layer.name}\n\n${result.context}`);
    }
  }

  return {
    chunksSelected,
    errorCount,
    context: contexts.join("\n\n")
  };
}

async function serveStatic({ publicDir, requestUrl, response }) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const normalizedPathname = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, normalizedPathname);
  const resolvedPublicDir = path.resolve(publicDir);
  const resolvedFilePath = path.resolve(filePath);

  if (!resolvedFilePath.startsWith(resolvedPublicDir)) {
    sendJson(response, 403, {
      error: "Chemin interdit."
    });
    return;
  }

  try {
    const content = await fs.readFile(resolvedFilePath);
    const contentType = STATIC_TYPES[path.extname(resolvedFilePath)] || "application/octet-stream";

    response.writeHead(200, {
      "Content-Type": contentType
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, {
        error: "Fichier introuvable."
      });
      return;
    }

    throw error;
  }
}

function getPublicConfig(config) {
  return {
    defaultLayers: createDefaultLayers({
      arbiterCount: config.sessionDefaults.arbiterCount,
      slaveCount: config.sessionDefaults.slaveCount
    }),
    limits: config.limits,
    models: config.models,
    sessionDefaults: config.sessionDefaults
  };
}

function normalizeSession({ config, input }) {
  return {
    agentRoundsPerArbitration: clampInteger({
      fallback: config.sessionDefaults.agentRoundsPerArbitration,
      max: config.limits.maxRoundsPerArbitration,
      min: config.limits.minRoundsPerArbitration,
      value: input.agentRoundsPerArbitration
    }),
    initialRequest: normalizeInitialRequest({
      fallback: config.sessionDefaults.initialRequest,
      value: input.initialRequest
    }),
    maxArbitrations: clampInteger({
      fallback: config.sessionDefaults.maxArbitrations,
      max: config.limits.maxArbitrations,
      min: config.limits.minArbitrations,
      value: input.maxArbitrations
    })
  };
}

function normalizeInitialRequest({ fallback, value }) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  return trimmed || fallback;
}

function validateRuntime({ arbiterAgents, slaveAgents }) {
  if (slaveAgents.length === 0) {
    throw new TypeError(
      "Ajoute au moins un bot actif dans un layer chatbots de fonction Debat."
    );
  }

  if (arbiterAgents.length === 0) {
    throw new TypeError(
      "Ajoute au moins un bot actif dans un layer chatbots de fonction Arbitrage."
    );
  }
}

function clampInteger({ fallback, max, min, value }) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

async function readJsonBody(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;

    if (body.length > 1024 * 1024) {
      throw new Error("Payload trop volumineux.");
    }
  }

  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function getErrorStatus(error) {
  if (error instanceof SyntaxError || error instanceof TypeError) {
    return 400;
  }

  return 500;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendToClient(client, event) {
  client.write(`data: ${JSON.stringify(event)}\n\n`);
}

module.exports = {
  createWebServer
};
