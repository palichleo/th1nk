const readline = require("readline/promises");

async function promptSessionConfig(config) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const initialRequest = await askText({
      terminal,
      label: "Question a debattre",
      defaultValue: config.sessionDefaults.initialRequest
    });

    const slaveCount = await askInteger({
      terminal,
      label: "Nombre de slave agents",
      defaultValue: config.sessionDefaults.slaveCount,
      min: config.limits.minSlaveAgents,
      max: config.limits.maxSlaveAgents
    });

    const agentRoundsPerArbitration = await askInteger({
      terminal,
      label: "Tours complets des agents avant chaque arbitrage",
      defaultValue: config.sessionDefaults.agentRoundsPerArbitration,
      min: config.limits.minRoundsPerArbitration,
      max: config.limits.maxRoundsPerArbitration
    });

    const maxArbitrations = await askInteger({
      terminal,
      label: "Nombre total d'arbitrages",
      defaultValue: config.sessionDefaults.maxArbitrations,
      min: config.limits.minArbitrations,
      max: config.limits.maxArbitrations
    });

    return {
      agentRoundsPerArbitration,
      initialRequest,
      maxArbitrations,
      slaveCount
    };
  } finally {
    terminal.close();
  }
}

async function askText({ terminal, label, defaultValue }) {
  const answer = await terminal.question(`${label} [${defaultValue}] : `);
  const trimmedAnswer = answer.trim();

  return trimmedAnswer || defaultValue;
}

async function askInteger({ terminal, label, defaultValue, min, max }) {
  while (true) {
    const answer = await terminal.question(
      `${label} (${min}-${max}) [${defaultValue}] : `
    );
    const trimmedAnswer = answer.trim();
    const value = trimmedAnswer ? Number(trimmedAnswer) : defaultValue;

    if (Number.isInteger(value) && value >= min && value <= max) {
      return value;
    }

    console.log(`Valeur invalide. Entre un entier entre ${min} et ${max}.`);
  }
}

module.exports = {
  promptSessionConfig
};
