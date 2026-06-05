async function checkOllamaModels({ baseUrl, models }) {
  if (typeof fetch !== "function") {
    throw new Error("fetch n'est pas disponible. Utilise Node.js 18 ou superieur.");
  }

  const response = await fetch(`${baseUrl}/api/tags`, {
    method: "GET"
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
  onToken
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

  logLlmDebug({
    agent: formatDebugAgent(agent),
    input,
    messages: requestBody.messages,
    metadata: debugMetadata || null,
    model,
    options,
    think: Object.prototype.hasOwnProperty.call(requestBody, "think")
      ? requestBody.think
      : null
  });

  let response = await postChat({ baseUrl, body: requestBody });

  if (!response.ok) {
    const errorText = await response.text();

    if (shouldRetryWithoutThink({ response, errorText, requestBody })) {
      delete requestBody.think;
      logLlmDebug({
        agent: formatDebugAgent(agent),
        input,
        messages: requestBody.messages,
        metadata: {
          ...(debugMetadata || {}),
          retryReason: "think unsupported"
        },
        model,
        options,
        think: null
      });
      response = await postChat({ baseUrl, body: requestBody });
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

  let fullAnswer = await readOllamaStream(response, onToken);

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
    output: fullAnswer
  });

  return fullAnswer;
}

function logLlmDebug(payload) {
  console.log(`[LLM INPUT] ${payload.agent?.name || "agent"}`, payload);
}

function logLlmOutput(payload) {
  console.log(`[LLM OUTPUT] ${payload.agent?.name || "agent"}`, payload);
}

function formatDebugAgent(agent) {
  return {
    id: agent?.id || "",
    kind: agent?.kind || "",
    name: agent?.name || "",
    persona: agent?.persona || ""
  };
}

async function postChat({ baseUrl, body }) {
  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
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

async function readOllamaStream(response, onToken) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let fullAnswer = "";

  while (true) {
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
