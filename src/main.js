const { createArbiterAgent, createSlaveAgents } = require("./agents");
const { CONFIG } = require("./config");
const { runDebate } = require("./debateOrchestrator");
const { checkOllamaModels } = require("./ollamaClient");
const { promptSessionConfig } = require("./sessionInput");
const { createTerminalUi } = require("./terminalUi");

async function main() {
  const session = await promptSessionConfig(CONFIG);
  const slaveAgents = createSlaveAgents({ count: session.slaveCount });
  const arbiterAgent = createArbiterAgent();
  const ui = createTerminalUi({ slaveAgents });

  ui.render();

  try {
    ui.setStatus("Verification d'Ollama...");

    await checkOllamaModels({
      baseUrl: CONFIG.ollamaBaseUrl,
      models: [CONFIG.models.slave, CONFIG.models.arbiter]
    });

    await runDebate({
      config: CONFIG,
      session,
      slaveAgents,
      arbiterAgent,
      ui
    });

    ui.setStatus("Debat termine. Tu peux scroller ou quitter avec q.");
  } catch (error) {
    ui.appendArbiter(`\n\nERREUR :\n${error.message}\n`);
    ui.setStatus("Erreur detectee. Tu peux scroller ou quitter avec q.");
  }
}

main();
