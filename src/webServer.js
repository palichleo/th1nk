const fs = require("fs/promises");
const http = require("http");
const path = require("path");

const { runDebate } = require("./debateOrchestrator");
const {
  createDefaultLayers,
  createRuntimeFromLayers,
  normalizeLayers
} = require("./layers");
const { debugLog, errorLog } = require("./logger");
const { checkOllamaModels } = require("./ollamaClient");
const { createPresetStore } = require("./presetStore");
const { buildRetrievalContext } = require("./retrievalLayer");
const { buildConversationRetrievalContext } = require("./server/retrieval/conversationIndexer");
const { createConversationsRoute } = require("./server/routes/conversations");
const { createRunManager } = require("./server/runs/runManager");
const { createConversationMarkdownStore } = require("./server/storage/conversationMarkdownStore");
const {
  buildTurnContext,
  prepareConversationTurn
} = require("./server/storage/turnContext");
const { createWebUi } = require("./webUi");

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function createWebServer({ config }) {
  const publicDir = path.join(__dirname, "public");
  const devClients = new Set();
  const presetStore = createPresetStore({
    dataDirectory: config.dataDirectory
  });
  const conversationStore = createConversationMarkdownStore({
    directory: config.conversationDirectory
  });
  const runManager = createRunManager();
  const handleConversationsRoute = createConversationsRoute({
    readJsonBody,
    sendJson,
    store: conversationStore
  });

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://localhost");
      const runEventsRoute = parseRunEventsRoute(requestUrl);
      const runCancelRoute = parseRunCancelRoute(requestUrl);
      const messageRoute = parseConversationMessageRoute(requestUrl);

      if (request.method === "GET" && requestUrl.pathname === "/events") {
        handleDevEvents(request, response);
        return;
      }

      if (runEventsRoute) {
        if (request.method !== "GET") {
          sendJson(response, 405, {
            error: "Methode de stream run non supportee."
          });
          return;
        }

        handleRunEvents({
          lastEventId:
            request.headers["last-event-id"] ||
            requestUrl.searchParams.get("lastEventId"),
          request,
          response,
          runId: runEventsRoute.runId
        });
        return;
      }

      if (runCancelRoute) {
        if (request.method !== "POST") {
          sendJson(response, 405, {
            error: "Methode d'annulation run non supportee."
          });
          return;
        }

        handleRunCancel({
          response,
          runId: runCancelRoute.runId
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/runs") {
        await handleCreateRun(request, response);
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

      if (messageRoute) {
        if (request.method !== "POST") {
          sendJson(response, 405, {
            error: "Methode de message non supportee."
          });
          return;
        }

        await handleLegacyConversationMessage({
          conversationId: messageRoute.conversationId,
          request,
          response
        });
        return;
      }

      if (
        requestUrl.pathname === "/api/conversations" ||
        requestUrl.pathname.startsWith("/api/conversations/")
      ) {
        await handleConversationsRoute({ request, requestUrl, response });
        return;
      }

      if (requestUrl.pathname.startsWith("/api/presets/")) {
        await handlePresetMutation({ request, requestUrl, response });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/start") {
        await handleCreateRun(request, response);
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

  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 0;
  server.broadcastEvent = broadcastDevEvent;

  function handleDevEvents(request, response) {
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    });

    devClients.add(response);
    sendToClient(response, {
      type: "hello",
      payload: {
        running: false
      }
    });

    request.on("close", () => {
      devClients.delete(response);
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

  async function handleCreateRun(request, response) {
    const input = await readJsonBody(request);
    const prepared = await prepareRunInput(input);
    const run = runManager.createRun({
      conversationId: prepared.conversation.id,
      payload: {
        userMessage: prepared.userMessage
      }
    });
    attachRunIdToPreparedTurn(prepared, run.id);

    sendJson(response, 202, {
      conversation: prepared.conversation.summary,
      ok: true,
      run: getPublicRun(run),
      runId: run.id
    });

    executeRun(run.id, prepared).catch((error) => {
      errorLog(`[run] erreur du run ${run.id}: ${error.message || error}`);
    });
  }

  async function handleLegacyConversationMessage({ conversationId, request, response }) {
    const input = await readJsonBody(request);
    const prepared = await prepareRunInput({
      ...input,
      conversationId
    });
    const run = runManager.createRun({
      conversationId: prepared.conversation.id,
      payload: {
        userMessage: prepared.userMessage
      }
    });
    attachRunIdToPreparedTurn(prepared, run.id);

    sendJson(response, 202, {
      conversation: prepared.conversation.summary,
      ok: true,
      run: getPublicRun(run),
      runId: run.id
    });

    executeRun(run.id, prepared).catch((error) => {
      errorLog(`[run] erreur du run ${run.id}: ${error.message || error}`);
    });
  }

  async function prepareRunInput(input) {
    const conversationId = normalizeInitialRequest({
      fallback: "",
      value: input.conversationId
    });
    const userMessage = normalizeInitialRequest({
      fallback: "",
      value: input.userMessage || input.message || input.content || input.initialRequest
    });

    if (!conversationId) {
      throw new TypeError("conversationId est requis pour creer un run.");
    }
    if (!userMessage) {
      throw new TypeError("Le message utilisateur est requis pour creer un run.");
    }

    const layers = normalizeLayers({
      inputLayers: input.layers,
      sessionDefaults: config.sessionDefaults
    });
    const runtime = createRuntimeFromLayers(layers);
    validateRuntime(runtime);

    const initialConversation = await conversationStore.getConversation(conversationId);
    const shouldAppendUserMessage = shouldPersistRunUserMessage(
      initialConversation,
      userMessage
    );
    const userTurn = shouldAppendUserMessage
      ? await conversationStore.appendMessage(conversationId, {
          id: createUserMessageId(),
          role: "user",
          kind: "user",
          agentName: "Utilisateur",
          status: "complete",
          title: "Message utilisateur",
          content: userMessage
        })
      : null;
    const conversation = await conversationStore.getConversation(conversationId);
    const turn = prepareConversationTurn({
      conversation,
      rawUserMessage: userMessage,
      userTurnId: userTurn?.id || "initial-request"
    });
    const session = normalizeSession({
      config,
      input: {
        ...input,
        initialRequest: conversation.initialRequest || userMessage
      }
    });

    session.conversationId = conversation.id;
    session.conversationTitle = conversation.title;
    session.checkpointBaseIndex = Array.isArray(conversation.checkpoints)
      ? conversation.checkpoints.length
      : 0;
    session.currentTask = turn.currentTask;
    session.currentUserMessage = userMessage;
    session.rootInitialRequest = conversation.initialRequest;
    session.turn = turn;
    session.userMessageId = userTurn?.id || "";
    session.slaveCount = runtime.slaveAgents.length;
    session.arbiterCount = runtime.arbiterAgents.length;

    logTurnDebug("turn_started", {
      answerToUser: "",
      conversation,
      newCheckpointId: "",
      retrievedChunks: 0,
      session,
      turn
    });

    return {
      ...runtime,
      conversation,
      includeConversationHistory: true,
      layers,
      session,
      shouldAppendUserMessage,
      turn,
      userMessage
    };
  }

  async function executeRun(runId, prepared) {
    const run = runManager.getRun(runId);

    if (!run) {
      return;
    }

    const signal = run.abortController.signal;
    const ui = createWebUi({
      conversation: toConversationUiMetadata(prepared.conversation),
      conversationStore,
      initialTurns: prepared.conversation.turns,
      layers: prepared.layers,
      sendEvent: (event) => {
        runManager.emit(runId, event.type, event.payload);
      },
      session: prepared.session
    });

    try {
      throwIfAborted(signal);
      ui.render();

      throwIfAborted(signal);
      await runSession({
        ...prepared,
        includeConversationHistory: prepared.includeConversationHistory,
        runId,
        signal,
        ui
      });
    } catch (error) {
      if (signal.aborted) {
        debugLog(`[run] run annulé ${runId}`);
        await ui.flushPersistence();
        await ui.setConversationStatus("cancelled");
        return;
      }

      errorLog(`[run] erreur du run ${runId}: ${error.message || error}`);
      await ui.flushPersistence();
      await ui.setConversationStatus("error");
      runManager.emit(runId, "run_error", {
        message: error.message || String(error)
      });
    }
  }

  async function runSession({
    arbiterAgents,
    conversation,
    includeConversationHistory = true,
    retrievalLayers,
    runId,
    session,
    signal,
    slaveAgents,
    ui
  }) {
    try {
      throwIfAborted(signal);
      ui.setStatus("Preparation du contexte documentaire...");
      runManager.emit(runId, "retrieval_started", {
        message: "Preparation du contexte documentaire..."
      });

      const retrieval = await buildCombinedRetrievalContext({
        config,
          excludeConversationId: session.conversationId,
          includeConversationHistory,
          dataDirectory: config.dataDirectory,
          layers: retrievalLayers,
          query: buildTurnRetrievalQuery(session.turn)
        });

      throwIfAborted(signal);
      runManager.emit(runId, "retrieval_done", {
        chunksSelected: retrieval.chunksSelected,
        errorCount: retrieval.errorCount
      });
      emitRetrievalTurns({
        retrieval,
        ui
      });

      const turnContext = buildTurnContext({
        conversation,
        retrievedChunks: retrieval.context,
        turn: session.turn
      });

      logTurnDebug("turn_context_ready", {
        answerToUser: "",
        conversation,
        newCheckpointId: "",
        retrievedChunks: retrieval.chunksSelected,
        session,
        turn: session.turn
      });

      ui.setStatus("Verification d'Ollama...");
      await checkOllamaModels({
        baseUrl: config.ollamaBaseUrl,
        models: getRequiredModels({
          arbiterAgents,
          config
        }),
        signal
      });
      throwIfAborted(signal);

      const stats = await runDebate({
        arbiterAgents,
        config,
        referenceContext: mergeReferenceContexts(turnContext, retrieval.context),
        retrieveReferenceContext: async (query) => {
          throwIfAborted(signal);
          const nextRetrieval = await buildCombinedRetrievalContext({
            config,
            excludeConversationId: session.conversationId,
            includeConversationHistory,
            dataDirectory: config.dataDirectory,
            layers: retrievalLayers,
            query
          });

          return mergeReferenceContexts(turnContext, nextRetrieval.context);
        },
        session,
        signal,
        slaveAgents,
        ui
      });

      const retrievalSummary = retrieval.chunksSelected > 0
        ? `, ${retrieval.chunksSelected} chunks documentaires`
        : "";
      const retrievalWarnings = retrieval.errorCount > 0
        ? `, ${retrieval.errorCount} avertissements retrieval`
        : "";

      ui.setStatus(
        `Debat termine. ${stats.agentResponseCount} reponses agents, ${stats.arbitrationCount} arbitrages${retrievalSummary}${retrievalWarnings}.`
      );
      await ui.flushPersistence();
      await ui.setConversationStatus("complete");

      const updatedConversation = await conversationStore.getConversation(session.conversationId);

      logTurnDebug("turn_completed", {
        answerToUser: getLatestAnswerToUser(updatedConversation),
        conversation: updatedConversation,
        newCheckpointId: getLatestCheckpointId(updatedConversation),
        retrievedChunks: retrieval.chunksSelected,
        session,
        turn: session.turn
      });

      runManager.emit(runId, "run_done", {
        conversation: updatedConversation,
        stats
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      await ui.flushPersistence();
      await ui.setConversationStatus("error");
      throw error;
    }
  }

  function handleRunEvents({ lastEventId, request, response, runId }) {
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    });
    response.flushHeaders?.();

    const attached = runManager.attachClient(runId, response, lastEventId);

    if (!attached) {
      response.write("event: run_error\n");
      response.write(`data: ${JSON.stringify({
        id: "0",
        type: "run_error",
        runId,
        data: {
          message: "Run introuvable."
        },
        createdAt: new Date().toISOString()
      })}\n\n`);
      response.end();
      return;
    }

    request.on("close", () => {
      runManager.detachClient(runId, response);
    });
  }

  function handleRunCancel({ response, runId }) {
    const cancelled = runManager.cancelRun(runId);

    sendJson(response, cancelled ? 200 : 404, {
      cancelled
    });
  }

  function emitRetrievalTurns({ retrieval, ui }) {
    if (
      !retrieval.layerResults.length ||
      !ui ||
      typeof ui.addRetrievalTurn !== "function"
    ) {
      return;
    }

    retrieval.layerResults.forEach(({ layer, result }, index) => {
      ui.addRetrievalTurn({
        index: index + 1,
        layer,
        result,
        total: retrieval.layerResults.length
      });
    });
  }

  function broadcastDevEvent(event) {
    for (const client of devClients) {
      sendToClient(client, event);
    }
  }

  return server;
}

function attachRunIdToPreparedTurn(prepared, runId) {
  if (prepared?.turn) {
    prepared.turn.runId = runId;
  }
  if (prepared?.session?.turn) {
    prepared.session.runId = runId;
    prepared.session.turn.runId = runId;
  }
}

function buildTurnRetrievalQuery(turn) {
  return normalizeInitialRequest({
    fallback: "",
    value: turn?.currentTask || turn?.rawUserMessage
  });
}

function logTurnDebug(label, {
  answerToUser,
  conversation,
  newCheckpointId,
  retrievedChunks,
  session,
  turn
}) {
  debugLog(`[context] ${label}`, {
    agentResponsesLength: Array.isArray(turn?.agentResponses)
      ? turn.agentResponses.length
      : 0,
    answerLength: getTextLength(answerToUser),
    conversationId: conversation?.id || session?.conversationId || "",
    conversationTurnIndex: turn?.conversationTurnIndex || 0,
    currentTaskLength: getTextLength(turn?.currentTask),
    initialRequestLength: getTextLength(conversation?.initialRequest || session?.initialRequest),
    latestCheckpointId: turn?.latestCheckpointId || "",
    newCheckpointId: newCheckpointId || "",
    rawUserMessageLength: getTextLength(turn?.rawUserMessage),
    retrievedChunks
  });
}

function getLatestAnswerToUser(conversation) {
  const messages = Array.isArray(conversation?.messages)
    ? conversation.messages
    : Array.isArray(conversation?.turns)
      ? conversation.turns
      : [];

  return [...messages]
    .reverse()
    .find((message) => message.kind === "answer")?.content || "";
}

function getLatestCheckpointId(conversation) {
  const checkpoints = Array.isArray(conversation?.checkpoints)
    ? conversation.checkpoints
    : [];

  return checkpoints.at(-1)?.id || "";
}

function getTextLength(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length;
}

async function buildCombinedRetrievalContext({
  config,
  dataDirectory,
  excludeConversationId,
  includeConversationHistory = true,
  layers,
  query
}) {
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
  const conversationLayerResult = includeConversationHistory
    ? await buildConversationLayerResult({
        config,
        dataDirectory,
        excludeConversationId,
        query
      })
    : null;

  if (conversationLayerResult) {
    results.unshift(conversationLayerResult);
  }

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
    context: contexts.join("\n\n"),
    layerResults: results
  };
}

async function buildConversationLayerResult({
  config,
  dataDirectory,
  excludeConversationId,
  query
}) {
  if (!config.conversationHistory || config.conversationHistory.enabled === false) {
    return null;
  }

  const result = await buildConversationRetrievalContext({
    conversationDirectory: config.conversationDirectory,
    dataDirectory,
    excludeConversationId,
    options: config.conversationHistory,
    query
  });
  const stats = result.result.stats;
  const hasSignal =
    stats.filesIndexed > 0 ||
    stats.chunksIndexed > 0 ||
    stats.chunksSelected > 0 ||
    stats.errors.length > 0;

  return hasSignal ? result : null;
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

function parseRunEventsRoute(requestUrl) {
  const pathParts = splitPath(requestUrl);

  if (
    pathParts.length === 4 &&
    pathParts[0] === "api" &&
    pathParts[1] === "runs" &&
    pathParts[3] === "events"
  ) {
    return {
      runId: pathParts[2]
    };
  }

  return null;
}

function parseRunCancelRoute(requestUrl) {
  const pathParts = splitPath(requestUrl);

  if (
    pathParts.length === 4 &&
    pathParts[0] === "api" &&
    pathParts[1] === "runs" &&
    pathParts[3] === "cancel"
  ) {
    return {
      runId: pathParts[2]
    };
  }

  return null;
}

function parseConversationMessageRoute(requestUrl) {
  const pathParts = splitPath(requestUrl);

  if (
    pathParts.length === 4 &&
    pathParts[0] === "api" &&
    pathParts[1] === "conversations" &&
    pathParts[3] === "messages"
  ) {
    return {
      conversationId: pathParts[2]
    };
  }

  return null;
}

function splitPath(requestUrl) {
  return requestUrl.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

function shouldPersistRunUserMessage(conversation, userMessage) {
  const hasUserMessage = conversation.messages.some(
    (message) => message.role === "user" || message.kind === "user"
  );
  const normalizedInitialRequest = normalizeInitialRequest({
    fallback: "",
    value: conversation.initialRequest
  });
  const normalizedUserMessage = normalizeInitialRequest({
    fallback: "",
    value: userMessage
  });

  return hasUserMessage || normalizedInitialRequest !== normalizedUserMessage;
}

function mergeReferenceContexts(...contexts) {
  return contexts
    .filter((context) => typeof context === "string" && context.trim())
    .map((context) => context.trim())
    .join("\n\n");
}

function createUserMessageId() {
  return `user-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function toConversationUiMetadata(conversation) {
  return {
    ...conversation.summary,
    checkpoints: conversation.checkpoints,
    initialRequest: conversation.initialRequest
  };
}

function getPublicRun(run) {
  return {
    id: run.id,
    conversationId: run.conversationId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Run annulé.");
  error.name = "AbortError";
  throw error;
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
}

function getRequiredModels({ arbiterAgents, config }) {
  const models = [config.models.slave];

  if (arbiterAgents.length > 0) {
    models.push(config.models.arbiter);
  }

  return [...new Set(models.filter(Boolean))];
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
  if (error && error.code === "ENOENT") {
    return 404;
  }

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
