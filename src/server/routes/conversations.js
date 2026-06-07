function createConversationsRoute({ readJsonBody, sendJson, store }) {
  return async function handleConversationsRoute({ request, requestUrl, response }) {
    const pathParts = requestUrl.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
    const conversationId = pathParts[2] || "";

    if (pathParts[0] !== "api" || pathParts[1] !== "conversations") {
      return false;
    }

    if (request.method === "GET" && !conversationId) {
      const conversations = await store.listConversations();

      sendJson(response, 200, {
        conversations
      });
      return true;
    }

    if (request.method === "POST" && !conversationId) {
      const input = await readJsonBody(request);
      const conversation = await store.createConversation(
        input.initialMessage || input.initialRequest || "",
        input.config || {}
      );

      sendJson(response, 201, {
        conversation
      });
      return true;
    }

    if (request.method === "GET" && conversationId) {
      const conversation = await store.getConversation(conversationId);

      sendJson(response, 200, {
        conversation
      });
      return true;
    }

    if (request.method === "DELETE" && conversationId) {
      const deleted = await store.deleteConversation(conversationId);

      sendJson(response, deleted ? 200 : 404, {
        deleted
      });
      return true;
    }

    sendJson(response, 405, {
      error: "Methode de conversation non supportee."
    });
    return true;
  };
}

module.exports = {
  createConversationsRoute
};
