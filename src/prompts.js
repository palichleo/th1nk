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
    "2. le checkpoint précédent,",
    "3. le message utilisateur actuel,",
    "4. la tâche actuelle obligatoire,",
    "5. les réponses des agents du tour courant uniquement,",
    "6. les chunks documentaires utilisés.",
    "",
    "Ton rôle est de produire une réponse visible pour l'utilisateur et un checkpoint interne distinct.",
    "La tâche actuelle domine le checkpoint précédent.",
    "Tu ne dois pas répéter l'ancien checkpoint si le message utilisateur change la tâche.",
    "",
    "Ne transforme jamais une hypothèse ou une idée proposée par un agent en décision validée sans validation claire.",
    "Sépare strictement décisions validées, hypothèses, idées proposées, désaccords, risques et points à vérifier.",
    "Réponds directement, sans balise <think> et sans raisonnement caché.",
    "",
    "Respecte exactement ce format JSON, sans markdown autour :",
    "",
    "{",
    "  \"answerToUser\": \"...\",",
    "  \"checkpoint\": {",
    "    \"checkpointId\": \"...\",",
    "    \"userTurnId\": \"...\",",
    "    \"conversationTurnIndex\": 0,",
    "    \"currentTask\": \"...\",",
    "    \"validatedDecisions\": [],",
    "    \"hypotheses\": [],",
    "    \"proposedIdeas\": [],",
    "    \"disagreements\": [],",
    "    \"risks\": [],",
    "    \"pointsToVerify\": [],",
    "    \"openQuestions\": [],",
    "    \"nextUsefulStep\": \"...\"",
    "  }",
    "}"
  ].join("\n");
}

function buildSlaveDebatePrompt({
  initialRequest,
  previousState,
  currentTask,
  recentResponses,
  agent,
  referenceContext,
  turn
}) {
  return [
    "Debat en cours sur un tour utilisateur precis.",
    "",
    "## Requete initiale",
    initialRequest,
    ...formatReferenceContext(referenceContext),
    "",
    "## Etat de travail nettoye par l'arbitre",
    previousState,
    "",
    "## Message utilisateur actuel",
    turn?.rawUserMessage || currentTask,
    "",
    "## Reponses agents deja produites dans ce tour uniquement",
    formatAgentResponses(recentResponses),
    "",
    "## TACHE ACTUELLE OBLIGATOIRE",
    currentTask,
    "",
    `## Instruction pour ${agent.name}`,
    `Comportement dominant : ${agent.persona}.`,
    "Reponds a la tache actuelle, pas a l'ancien checkpoint.",
    "Ajoute une idee utile, une objection ou une correction.",
    "Ne repete pas le contexte. Ne conclus pas definitivement.",
    "Ne transforme pas une hypothese en consensus."
  ].join("\n");
}

function buildArbiterPrompt({
  arbiter,
  initialRequest,
  previousState,
  recentResponses,
  referenceContext,
  turn
}) {
  return [
    "Voici les donnees du tour courant a arbitrer.",
    "",
    `## Instruction pour ${arbiter.name}`,
    `Comportement dominant : ${arbiter.persona}.`,
    "",
    "## Requete initiale de l'utilisateur",
    initialRequest,
    ...formatReferenceContext(referenceContext),
    "",
    "## Checkpoint precedent",
    previousState,
    "",
    "## Message utilisateur actuel brut",
    turn?.rawUserMessage || "",
    "",
    "## TACHE ACTUELLE OBLIGATOIRE",
    turn?.currentTask || "",
    "",
    "## Reponses agents du tour courant uniquement",
    formatAgentResponses(recentResponses),
    "",
    "Contraintes de sortie :",
    "- answerToUser doit repondre au message utilisateur actuel.",
    "- checkpoint.currentTask doit reprendre la tache actuelle obligatoire.",
    "- validatedDecisions ne contient que des decisions clairement validees.",
    "- hypotheses, proposedIdeas, disagreements, risks et pointsToVerify restent separes.",
    "- Ne recopie pas le checkpoint precedent comme nouvelle reponse.",
    "- Produis uniquement le JSON demande."
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
