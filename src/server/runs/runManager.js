const { randomBytes } = require("node:crypto");

const { debugLog } = require("../../logger");

const COMPLETED_RUN_TTL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_RETAINED_EVENTS = 2_000;

function createRunManager() {
  const runs = new Map();

  function createRun({ conversationId, payload = {} }) {
    const now = new Date().toISOString();
    const run = {
      id: createRunId(),
      conversationId,
      status: "running",
      events: [],
      clients: new Set(),
      abortController: new AbortController(),
      cleanupTimer: null,
      createdAt: now,
      updatedAt: now,
      nextEventId: 1,
      heartbeatTimer: null,
      payload
    };

    runs.set(run.id, run);
    debugLog(`[run] créé ${run.id} conversation=${conversationId}`);

    return run;
  }

  function getRun(runId) {
    return runs.get(runId) || null;
  }

  function emit(runId, type, data = {}) {
    const run = getRun(runId);

    if (!run) {
      return null;
    }

    const event = {
      id: String(run.nextEventId++),
      type,
      runId,
      data,
      createdAt: new Date().toISOString()
    };

    run.events.push(event);
    trimEvents(run);
    run.updatedAt = event.createdAt;

    if (type === "run_done") {
      run.status = "done";
      debugLog(`[run] terminé ${runId}`);
      scheduleRunCleanup(run, () => runs.delete(run.id));
    } else if (type === "run_error") {
      run.status = data.cancelled ? "cancelled" : "error";
      debugLog(`[run] erreur du run ${runId}: ${data.message || "erreur inconnue"}`);
      scheduleRunCleanup(run, () => runs.delete(run.id));
    }

    debugLog(`[run] event émis ${runId}#${event.id} ${type}`);

    for (const client of run.clients) {
      sendEvent(client, event);
    }

    if (type === "run_done" || type === "run_error") {
      stopHeartbeat(run);
    }

    return event;
  }

  function attachClient(runId, client, lastEventId) {
    const run = getRun(runId);

    if (!run) {
      return false;
    }

    run.clients.add(client);
    debugLog(`[run] client SSE attaché run=${runId} lastEventId=${lastEventId || "none"}`);

    const lastId = Number(lastEventId || 0);
    const replayEvents = Number.isFinite(lastId)
      ? run.events.filter((event) => Number(event.id) > lastId)
      : run.events;

    for (const event of replayEvents) {
      sendEvent(client, event);
    }

    startHeartbeat(run);
    return true;
  }

  function detachClient(runId, client) {
    const run = getRun(runId);

    if (!run) {
      return;
    }

    run.clients.delete(client);
    debugLog(`[run] client SSE détaché run=${runId}`);

    if (run.clients.size === 0) {
      stopHeartbeat(run);
    }
  }

  function cancelRun(runId) {
    const run = getRun(runId);

    if (!run) {
      return false;
    }

    if (run.status !== "running") {
      return true;
    }

    run.status = "cancelled";
    run.updatedAt = new Date().toISOString();
    run.abortController.abort();
    debugLog(`[run] annulé ${runId}`);
    emit(runId, "run_error", {
      cancelled: true,
      message: "Run annulé par l'utilisateur."
    });

    return true;
  }

  function startHeartbeat(run) {
    if (run.heartbeatTimer || run.status !== "running") {
      return;
    }

    debugLog(`[run] heartbeat actif ${run.id}`);
    run.heartbeatTimer = setInterval(() => {
      for (const client of run.clients) {
        client.write(`: ping ${Date.now()}\n\n`);
      }
    }, HEARTBEAT_INTERVAL_MS);
    run.heartbeatTimer.unref?.();
  }

  function stopHeartbeat(run) {
    if (!run.heartbeatTimer) {
      return;
    }

    clearInterval(run.heartbeatTimer);
    run.heartbeatTimer = null;
  }

  return {
    attachClient,
    cancelRun,
    createRun,
    detachClient,
    emit,
    getRun
  };
}

function trimEvents(run) {
  const overflow = run.events.length - MAX_RETAINED_EVENTS;

  if (overflow > 0) {
    run.events.splice(0, overflow);
  }
}

function scheduleRunCleanup(run, removeRun) {
  if (run.cleanupTimer) {
    return;
  }

  run.cleanupTimer = setTimeout(() => {
    stopHeartbeat(run);
    for (const client of run.clients) {
      try {
        client.end?.();
      } catch {
        // The response may already be closed.
      }
    }
    run.clients.clear();
    removeRun();
  }, COMPLETED_RUN_TTL_MS);
  run.cleanupTimer.unref?.();
}

function sendEvent(client, event) {
  client.write(`id: ${event.id}\n`);
  client.write(`event: ${event.type}\n`);
  client.write(`data: ${JSON.stringify(event)}\n\n`);
}

function createRunId() {
  return `run-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

module.exports = {
  createRunManager
};
