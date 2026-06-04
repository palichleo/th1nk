const {
  buildArbiterSystemPrompt,
  buildSlaveSystemPrompt
} = require("./prompts");

const DEFAULT_SLAVE_PERSONAS = [
  "architecte: propose une structure claire, modulaire et maintenable",
  "critique: cherche les failles, les hypotheses faibles et les angles morts",
  "pragmatique: simplifie les propositions et privilegie ce qui peut etre implemente",
  "testeur: transforme les idees en criteres verifiables et detecte les risques",
  "integrateur: relie les idees compatibles et preserve les hypotheses minoritaires",
  "optimiseur: cherche les couts inutiles, la latence, la memoire et les limites de contexte"
];

function createDefaultSlaveProfile(index) {
  const id = createAgentId(index);

  return {
    id,
    name: `Agent ${id}`,
    persona: DEFAULT_SLAVE_PERSONAS[index % DEFAULT_SLAVE_PERSONAS.length]
  };
}

function createDefaultSlaveProfiles({ count }) {
  return Array.from({ length: count }, (_, index) => createDefaultSlaveProfile(index));
}

function createSlaveAgents({ count, profiles = [] }) {
  return Array.from({ length: count }, (_, index) => {
    const fallbackProfile = createDefaultSlaveProfile(index);
    const profile = normalizeSlaveProfile(profiles[index], fallbackProfile);

    return {
      id: profile.id,
      name: profile.name,
      kind: "slave",
      persona: profile.persona,
      messages: [
        {
          role: "system",
          content: buildSlaveSystemPrompt({
            id: profile.id,
            persona: profile.persona
          })
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

function normalizeSlaveProfile(profile, fallbackProfile) {
  if (!profile || typeof profile !== "object") {
    return fallbackProfile;
  }

  const name = normalizeText(profile.name, fallbackProfile.name);
  const persona = normalizeText(profile.persona, fallbackProfile.persona);

  return {
    id: fallbackProfile.id,
    name,
    persona
  };
}

function normalizeText(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  return trimmed || fallback;
}

module.exports = {
  DEFAULT_SLAVE_PERSONAS,
  createArbiterAgent,
  createArbiterAgents,
  createDefaultSlaveProfile,
  createDefaultSlaveProfiles,
  createSlaveAgents
};
