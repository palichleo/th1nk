const fs = require("fs/promises");
const http = require("http");
const path = require("path");

const { createArbiterAgents, createSlaveAgents } = require("./agents");
const { runDebate } = require("./debateOrchestrator");
const { checkOllamaModels } = require("./ollamaClient");
const { createWebUi } = require("./webUi");

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function createWebServer({ config }) {
  const publicDir = path.join(__dirname, "public");
  const clients = new Set();

  let currentUi = null;
  let isRunning = false;

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/events") {
        handleEvents(request, response);
        return;
      }

      if (request.method === "GET" && request.url === "/api/config") {
        sendJson(response, 200, getPublicConfig(config));
        return;
      }

      if (request.method === "POST" && request.url === "/api/start") {
        await handleStart(request, response);
        return;
      }

      if (request.method === "GET") {
        await serveStatic({ publicDir, request, response });
        return;
      }

      sendJson(response, 405, {
        error: "Methode non supportee."
      });
    } catch (error) {
      sendJson(response, 500, {
        error: error.message
      });
    }
  });

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

  async function handleStart(request, response) {
    if (isRunning) {
      sendJson(response, 409, {
        error: "Une session est deja en cours."
      });
      return;
    }

    const input = await readJsonBody(request);
    const session = normalizeSession({ config, input });
    const slaveAgents = createSlaveAgents({ count: session.slaveCount });
    const arbiterAgents = createArbiterAgents({ count: session.arbiterCount });

    currentUi = createWebUi({
      arbiterAgents,
      sendEvent: broadcast,
      session,
      slaveAgents
    });
    isRunning = true;

    currentUi.render();
    sendJson(response, 202, {
      ok: true
    });

    runSession({ arbiterAgents, session, slaveAgents }).catch((error) => {
      if (currentUi) {
        currentUi.appendArbiter(`\n\nERREUR :\n${error.message}\n`);
        currentUi.setStatus("Erreur detectee.");
      }
    });
  }

  async function runSession({ arbiterAgents, session, slaveAgents }) {
    try {
      currentUi.setStatus("Verification d'Ollama...");

      await checkOllamaModels({
        baseUrl: config.ollamaBaseUrl,
        models: [config.models.slave, config.models.arbiter]
      });

      const stats = await runDebate({
        arbiterAgents,
        config,
        session,
        slaveAgents,
        ui: currentUi
      });

      currentUi.setStatus(
        `Debat termine. ${stats.agentResponseCount} reponses agents, ${stats.arbitrationCount} arbitrages.`
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

  return server;
}

async function serveStatic({ publicDir, request, response }) {
  const requestUrl = new URL(request.url, "http://localhost");
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
    arbiterCount: clampInteger({
      fallback: config.sessionDefaults.arbiterCount,
      max: config.limits.maxArbiters,
      min: config.limits.minArbiters,
      value: input.arbiterCount
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
    }),
    slaveCount: clampInteger({
      fallback: config.sessionDefaults.slaveCount,
      max: config.limits.maxSlaveAgents,
      min: config.limits.minSlaveAgents,
      value: input.slaveCount
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

    if (body.length > 64 * 1024) {
      throw new Error("Payload trop volumineux.");
    }
  }

  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
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
