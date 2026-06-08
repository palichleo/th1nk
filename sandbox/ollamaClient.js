const { debugLog } = require("./logger");

async function checkOllamaModels({ baseUrl, models, signal }) {
  if (typeof fetch !== "function") {
    throw new Error("fetch n'est pas disponible. Utilise Node.js 18 ou superieur.");
  }

  const response = await fetch(`${baseUrl}/api/tags`, {
    method: "GET",
    signal
  });

  if (!response.ok) {
    throw new Error(
      `Ollama ne repond pas correctement : ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const availableModels = data.models || [];
  const availableNames = new Set(availableModels.map((model) => model.name));
  const missingModels = [...new Set(models)].filter((model) => !availableNames.has(model));

  if (missingModels.length > 0) {
    const formattedAvailableModels =
      availableModels.map((model) => `- ${model.name}`).join("\n") || "- aucun";

    throw new Error(
      [
        "Modele Ollama introuvable.",
        "",
        "Modeles demandes :",
        ...missingModels.map((model) => `- ${model}`),
        "",
        "Modeles disponibles :",
        formattedAvailableModels
      ].join("\n")
    );
  }
}

async function askAgentStreaming({
  baseUrl,
  debugMetadata,
  model,
  options,
  think,
  agent,
  input,
  onToken,
  signal
}) {
  agent.messages.push({
    role: "user",
    content: input
  });

  const requestBody = {
    model,
    messages: agent.messages,
    stream: true,
    options
  };

  if (typeof think === "boolean") {
    requestBody.think = think;
  }

  logLlmRequest({
    agent: formatDebugAgent(agent),
    inputLength: input.length,
    messageCount: requestBody.messages.length,
    metadata: debugMetadata || null,
    model,
    options,
    think: Object.prototype.hasOwnProperty.call(requestBody, "think")
      ? requestBody.think
      : null
  });

  let response = await postChat({ baseUrl, body: requestBody, signal });

  if (!response.ok) {
    const errorText = await response.text();

    if (shouldRetryWithoutThink({ response, errorText, requestBody })) {
      delete requestBody.think;
      logLlmRequest({
        agent: formatDebugAgent(agent),
        inputLength: input.length,
        messageCount: requestBody.messages.length,
        metadata: {
          ...(debugMetadata || {}),
          retryReason: "think unsupported"
        },
        model,
        options,
        think: null
      });
      response = await postChat({ baseUrl, body: requestBody, signal });
    } else {
      throw new Error(
        `Erreur Ollama : ${response.status} ${response.statusText}\n${errorText}`
      );
    }
  }

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Erreur Ollama : ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  let fullAnswer = await readOllamaStream(response, onToken, signal);

  if (!fullAnswer.trim()) {
    fullAnswer =
      "[Aucune reponse visible recue d'Ollama. Verifie le modele, le mode thinking et num_predict.]";
    onToken(fullAnswer);
  }

  agent.messages.push({
    role: "assistant",
    content: fullAnswer
  });

  logLlmOutput({
    agent: formatDebugAgent(agent),
    metadata: debugMetadata || null,
    model,
    outputLength: fullAnswer.length
  });

  return fullAnswer;
}

function logLlmRequest(payload) {
  debugLog(`[llm] request ${payload.agent?.name || "agent"}`, payload);
}

function logLlmOutput(payload) {
  debugLog(`[llm] response ${payload.agent?.name || "agent"}`, payload);
}

function formatDebugAgent(agent) {
  return {
    id: agent?.id || "",
    kind: agent?.kind || "",
    name: agent?.name || "",
    persona: agent?.persona || ""
  };
}

async function postChat({ baseUrl, body, signal }) {
  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal
  });
}

function shouldRetryWithoutThink({ response, errorText, requestBody }) {
  return (
    Object.prototype.hasOwnProperty.call(requestBody, "think") &&
    response.status >= 400 &&
    response.status < 500 &&
    /think|unknown|unsupported|invalid/i.test(errorText)
  );
}

async function readOllamaStream(response, onToken, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let fullAnswer = "";

  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      throwAbortError();
    }

    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      const data = parseJsonLine(trimmed);

      if (!data) {
        continue;
      }

      const token = getVisibleToken(data);

      if (token) {
        fullAnswer += token;
        onToken(token);
      }

      if (data.done) {
        return fullAnswer;
      }
    }
  }

  return fullAnswer;
}

function throwAbortError() {
  const error = new Error("Run annulé.");
  error.name = "AbortError";
  throw error;
}

function getVisibleToken(data) {
  return data?.message?.content || data?.response || "";
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

module.exports = {
  askAgentStreaming,
  checkOllamaModels
};
