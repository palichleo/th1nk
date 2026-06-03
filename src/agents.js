const {
  buildArbiterSystemPrompt,
  buildSlaveSystemPrompt
} = require("./prompts");

const SLAVE_PERSONAS = [
  "architecte: propose une structure claire, modulaire et maintenable",
  "critique: cherche les failles, les hypotheses faibles et les angles morts",
  "pragmatique: simplifie les propositions et privilegie ce qui peut etre implemente",
  "testeur: transforme les idees en criteres verifiables et detecte les risques",
  "integrateur: relie les idees compatibles et preserve les hypotheses minoritaires",
  "optimiseur: cherche les couts inutiles, la latence, la memoire et les limites de contexte"
];

function createSlaveAgents({ count }) {
  return Array.from({ length: count }, (_, index) => {
    const id = createAgentId(index);
    const persona = SLAVE_PERSONAS[index % SLAVE_PERSONAS.length];

    return {
      id,
      name: `Agent ${id}`,
      kind: "slave",
      persona,
      messages: [
        {
          role: "system",
          content: buildSlaveSystemPrompt({ id, persona })
        }
      ]
    };
  });
}

function createArbiterAgent(index = 0) {
  const id = index === 0 ? "ARBITER" : `ARBITER-${index + 1}`;
  const name = index === 0 ? "Arbitre" : `Arbitre ${index + 1}`;

  return {
    id,
    name,
    kind: "arbiter",
    messages: [
      {
        role: "system",
        content: buildArbiterSystemPrompt()
      }
    ]
  };
}

function createArbiterAgents({ count }) {
  return Array.from({ length: count }, (_, index) => createArbiterAgent(index));
}

function createAgentId(index) {
  let value = index;
  let id = "";

  do {
    id = String.fromCharCode(65 + (value % 26)) + id;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);

  return id;
}

module.exports = {
  createArbiterAgent,
  createArbiterAgents,
  createSlaveAgents
};
