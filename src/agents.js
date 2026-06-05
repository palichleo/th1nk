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
  const personaTemplate = DEFAULT_SLAVE_PERSONAS[index % DEFAULT_SLAVE_PERSONAS.length];
  const { name } = splitDefaultPersonaTemplate(personaTemplate, id);

  return {
    id,
    name,
    persona: name,
    systemPrompt: ""
  };
}

function createDefaultSlaveProfiles({ count }) {
  return Array.from({ length: count }, (_, index) => createDefaultSlaveProfile(index));
}

function createSlaveAgents({ count, profiles = [] }) {
  return Array.from({ length: count }, (_, index) => {
    const fallbackProfile = createDefaultSlaveProfile(index);
    const profile = normalizeSlaveProfile(profiles[index], fallbackProfile);
    const systemPrompt = normalizeText(
      profile.systemPrompt,
      buildSlaveSystemPrompt({
        id: profile.id,
        name: profile.name,
        persona: profile.persona
      })
    );

    return {
      id: profile.id,
      name: profile.name,
      kind: "slave",
      persona: profile.persona,
      systemPrompt,
      messages: [
        {
          role: "system",
          content: systemPrompt
        }
      ]
    };
  });
}

function createDefaultArbiterProfile(index = 0) {
  const id = index === 0 ? "ARBITER" : `ARBITER-${index + 1}`;
  const name = index === 0 ? "Arbitre" : `Arbitre ${index + 1}`;

  return {
    id,
    name,
    persona: name,
    systemPrompt: buildArbiterSystemPrompt()
  };
}

function createDefaultArbiterProfiles({ count }) {
  return Array.from({ length: count }, (_, index) => createDefaultArbiterProfile(index));
}

function createArbiterAgent(index = 0, profile) {
  const fallbackProfile = createDefaultArbiterProfile(index);
  const normalizedProfile = normalizeArbiterProfile(profile, fallbackProfile);

  return {
    id: normalizedProfile.id,
    name: normalizedProfile.name,
    kind: "arbiter",
    persona: normalizedProfile.persona,
    systemPrompt: normalizedProfile.systemPrompt,
    messages: [
      {
        role: "system",
        content: normalizedProfile.systemPrompt
      }
    ]
  };
}

function createArbiterAgents({ count, profiles = [] }) {
  return Array.from({ length: count }, (_, index) => createArbiterAgent(index, profiles[index]));
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

  const id = normalizeText(profile.id, fallbackProfile.id);
  const name = normalizeSlaveName(profile.name ?? profile.persona, fallbackProfile);

  return {
    id,
    name,
    persona: name,
    systemPrompt: normalizeOptionalText(profile.systemPrompt)
  };
}

function normalizeArbiterProfile(profile, fallbackProfile) {
  if (!profile || typeof profile !== "object") {
    return fallbackProfile;
  }

  const name = normalizeText(profile.name ?? profile.persona, fallbackProfile.name);

  return {
    id: normalizeText(profile.id, fallbackProfile.id),
    name,
    persona: name,
    systemPrompt: normalizeText(profile.systemPrompt, fallbackProfile.systemPrompt)
  };
}

function splitDefaultPersonaTemplate(template, fallbackName) {
  if (typeof template !== "string") {
    return {
      name: fallbackName,
      persona: "Role"
    };
  }

  const separatorIndex = template.indexOf(":");

  if (separatorIndex === -1) {
    return {
      name: formatDefaultPersonaName(template, fallbackName),
      persona: template.trim() || "Role"
    };
  }

  const rawName = template.slice(0, separatorIndex).trim();
  const rawPersona = template.slice(separatorIndex + 1).trim();

  return {
    name: formatDefaultPersonaName(rawName, fallbackName),
    persona: rawPersona || "Role"
  };
}

function formatDefaultPersonaName(value, fallbackName) {
  if (typeof value !== "string") {
    return fallbackName;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return fallbackName;
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function normalizeSlaveName(value, fallbackProfile) {
  const normalized = normalizeText(value, fallbackProfile.name);

  if (normalized === `Agent ${fallbackProfile.id}`) {
    return fallbackProfile.name;
  }

  return normalized;
}

function normalizeText(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  return trimmed || fallback;
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

module.exports = {
  DEFAULT_SLAVE_PERSONAS,
  createArbiterAgent,
  createArbiterAgents,
  createDefaultArbiterProfile,
  createDefaultArbiterProfiles,
  createDefaultSlaveProfile,
  createDefaultSlaveProfiles,
  createSlaveAgents
};
