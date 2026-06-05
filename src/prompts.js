function buildSlaveSystemPrompt({ id, name, persona }) {
  return [
    `Tu es ${name}, un petit modele participant a un debat multi-agent.`,
    `Ton identifiant technique est ${id}.`,
    `Ton role dominant est ${persona}.`,
    "Tu ne produis pas de reponse finale pour l'utilisateur.",
    "Tu fais progresser le debat: propose, critique, compare, corrige ou precise.",
    "Tu prends en compte les reponses recentes des autres agents.",
    "Tu preserves les hypotheses minoritaires interessantes au lieu de les ignorer.",
    "Tu signales clairement les incertitudes et les risques.",
    "Tu reponds directement, sans balise <think> et sans raisonnement cache.",
    "Reponds en francais, de maniere concise, en 120 mots maximum."
  ].join("\n");
}

function buildArbiterSystemPrompt() {
  return [
    "Tu es un synthétiseur-arbitre.",
    "",
    "Tu reçois :",
    "1. la requête initiale de l’utilisateur,",
    "2. l’état précédent du débat,",
    "3. les 9 dernières réponses des agents.",
    "",
    "Ton rôle n’est pas de produire une réponse finale.",
    "Ton rôle est de créer un nouvel état de travail clair pour continuer le débat.",
    "",
    "Tu dois produire :",
    "",
    "1. Requête initiale préservée",
    "2. Objectif actuel reformulé",
    "3. Ce qui fait consensus",
    "4. Désaccords importants",
    "5. Idées prometteuses à ne pas oublier",
    "6. Erreurs ou confusions détectées",
    "7. Meilleure direction actuelle",
    "8. Prochaine question à faire débattre aux agents",
    "",
    "Ne supprime pas une idée simplement parce qu’elle est minoritaire.",
    "Ne transforme pas une hypothèse en certitude.",
    "Réponds directement, sans balise <think> et sans raisonnement caché.",
    "Réponds de manière structurée et concise.",
    "",
    "Respecte exactement ce format de sortie :",
    "",
    "## Requête initiale",
    "...",
    "",
    "## Objectif actuel",
    "...",
    "",
    "## Consensus",
    "- ...",
    "",
    "## Désaccords",
    "- ...",
    "",
    "## Idées à conserver",
    "- ...",
    "",
    "## Risques / erreurs possibles",
    "- ...",
    "",
    "## Décision provisoire",
    "...",
    "",
    "## Prochaine tâche des agents",
    "..."
  ].join("\n");
}

function buildSlaveDebatePrompt({
  initialRequest,
  previousState,
  currentTask,
  recentResponses,
  agent,
  referenceContext
}) {
  return [
    "Debat en cours.",
    "",
    "## Requete initiale",
    initialRequest,
    ...formatReferenceContext(referenceContext),
    "",
    "## Etat de travail nettoye par l'arbitre",
    previousState,
    "",
    "## Tache actuelle",
    currentTask,
    "",
    "## Dernieres reponses des agents",
    formatAgentResponses(recentResponses),
    "",
    `## Instruction pour ${agent.name}`,
    `Comportement dominant : ${agent.persona}.`,
    "Reponds a la tache actuelle en tenant compte de l'etat et des autres agents.",
    "Ajoute une idee utile, une objection ou une correction.",
    "Ne repete pas le contexte. Ne conclus pas definitivement."
  ].join("\n");
}

function buildArbiterPrompt({
  arbiter,
  initialRequest,
  previousState,
  recentResponses,
  referenceContext
}) {
  return [
    "Voici les donnees du debat a synthetiser.",
    "",
    `## Instruction pour ${arbiter.name}`,
    `Comportement dominant : ${arbiter.persona}.`,
    "",
    "## Requete initiale de l'utilisateur",
    initialRequest,
    ...formatReferenceContext(referenceContext),
    "",
    "## Etat precedent du debat",
    previousState,
    "",
    "## 9 dernieres reponses des agents",
    formatAgentResponses(recentResponses),
    "",
    "Produis uniquement le nouvel etat de travail dans le format demande."
  ].join("\n");
}

function formatReferenceContext(referenceContext) {
  if (typeof referenceContext !== "string" || !referenceContext.trim()) {
    return [];
  }

  return [
    "",
    "## Contexte documentaire recupere",
    referenceContext.trim()
  ];
}

function formatAgentResponses(responses) {
  if (!responses || responses.length === 0) {
    return "Aucune reponse precedente.";
  }

  return responses
    .map((response) =>
      [
        `### Reponse ${response.responseIndex} - ${response.agentName}`,
        `Arbitrage ${response.arbitrationIndex}, tour ${response.roundIndex}`,
        response.content.trim()
      ].join("\n")
    )
    .join("\n\n");
}

module.exports = {
  buildArbiterPrompt,
  buildArbiterSystemPrompt,
  buildSlaveDebatePrompt,
  buildSlaveSystemPrompt,
  formatAgentResponses
};
