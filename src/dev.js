const fs = require("fs");
const path = require("path");

const { CONFIG } = require("./config");
const { createWebServer } = require("./webServer");

const port = Number(process.env.PORT || 3000);
const server = createWebServer({
  config: CONFIG
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mode dev: http://127.0.0.1:${port}`);
});

const watchedPaths = [
  path.join(__dirname, "public"),
  path.join(__dirname, "agents.js"),
  path.join(__dirname, "config.js"),
  path.join(__dirname, "debateOrchestrator.js"),
  path.join(__dirname, "debateState.js"),
  path.join(__dirname, "main.js"),
  path.join(__dirname, "ollamaClient.js"),
  path.join(__dirname, "prompts.js"),
  path.join(__dirname, "sessionInput.js"),
  path.join(__dirname, "terminalUi.js"),
  path.join(__dirname, "webServer.js"),
  path.join(__dirname, "webUi.js")
];

let reloadTimer = null;
let reloadPending = false;

for (const targetPath of watchedPaths) {
  watchPath(targetPath);
}

function watchPath(targetPath) {
  fs.watch(
    targetPath,
    {
      recursive: fs.statSync(targetPath).isDirectory()
    },
    () => {
      scheduleReload();
    }
  );
}

function scheduleReload() {
  if (reloadPending) {
    return;
  }

  reloadPending = true;

  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadPending = false;
    server.broadcastEvent({
      type: "reload",
      payload: {
        reason: "interface-modified"
      }
    });
  }, 150);
}
