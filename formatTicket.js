#!/usr/bin/env node
/**
 * formatTicket.js
 *
 * Transforme une note technique courte en ticket ServiceNow formaté en français.
 *
 * Usage:
 *   node formatTicket.js              -> exécute les exemples
 *   node formatTicket.js "ma note..." -> transforme la note passée en argument
 *
 * Exemples de mots-clés reconnus :
 *   outils: intune, zscaler, sap, azure, ldap, ad, okta, vpn, teams, outlook, exchange
 *   actions: reset, réinitialis, sync, synchronis, vérif, vérificat, escalad, patch, maj
 *   escalade: L2, L3, SAP, Mobility, SLS, réseau, sécurité
 *
 * Le script fait une "meilleure tentative" — il peut laisser des placeholders si des informations manquent.
 * 
 * Amaf 2025 
 *   /__IGNORE_---
 */

const KNOWN_TOOLS = [
  "intune", "zscaler", "sap", "azure", "ldap", "ad", "okta", "vpn",
  "teams", "outlook", "exchange", "sccm", "jamf", "mobility", "sls"
];

const ESCALATION_TARGETS = [
  {regex: /\b(l2|level ?2|support niveau 2|L2)\b/i, label: "L2"},
  {regex: /\b(l3|level ?3|support niveau 3|L3)\b/i, label: "L3"},
  {regex: /\b(sap)\b/i, label: "L2 SAP"},
  {regex: /\b(mobility|mobile)\b/i, label: "L2 Mobility"},
  {regex: /\b(sls)\b/i, label: "SLS"},
  {regex: /\b(réseau|network)\b/i, label: "Réseau"},
  {regex: /\b(sécurité|firewall|fire wall)\b/i, label: "Sécurité"}
];

const ACTION_KEYWORDS = [
  {regex: /\b(reset|réinitialis|réinitialisation|réinitialiser|resetting)\b/i, label: "Réinitialisation"},
  {regex: /\b(sync|synchronis|synchronisation|synchroniser)\b/i, label: "Synchronisation"},
  {regex: /\b(vérif|vérificat|contrôl|check|checked)\b/i, label: "Vérification"},
  {regex: /\b(escalad|escalation|escalé|escalée)\b/i, label: "Escalade"},
  {regex: /\b(configur|configuratio|configuré)\b/i, label: "Configuration"},
  {regex: /\b(diagnos|diagno|diagnost|diagnostic)\b/i, label: "Diagnostic"},
  {regex: /\b(connex|connexion|déconnex|déconnecté)\b/i, label: "Actions réseau/connexion"},
  {regex: /\b(mot de passe|mdp|password)\b/i, label: "Intervention mot de passe"}
];

function pickFirstSentence(text) {
  // Prend la première phrase utile comme résumé (1 ligne)
  // Sépare sur ., ?, ! ou saut de ligne
  const candidates = text.split(/[\r\n]+|[.?!]+/).map(s => s.trim()).filter(Boolean);
  return candidates.length ? candidates[0] : text;
}

function findTools(text) {
  const found = [];
  const lower = text.toLowerCase();
  for (const t of KNOWN_TOOLS) if (lower.includes(t)) found.push(capitalizeTool(t));
  return [...new Set(found)];
}
function capitalizeTool(t) {
  if (/^[a-z]+$/.test(t)) return t.toUpperCase() === t ? t : t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

function findEscalation(text) {
  const matches = [];
  for (const e of ESCALATION_TARGETS) {
    if (e.regex.test(text)) matches.push(e.label);
  }
  return [...new Set(matches)];
}

function findActions(text) {
  const found = [];
  for (const a of ACTION_KEYWORDS) {
    if (a.regex.test(text)) found.push(a.label);
  }
  return [...new Set(found)];
}

function buildDescription(note, summary, tools, actions, escalations) {
  // Compose description in French with placeholders if needed.
  let userProblem = extractUserProblem(note);
  if (!userProblem) userProblem = "Problème signalé par l'utilisateur : " + sanitize(note);

  let diagnostic = "Le technicien a réalisé un diagnostic initial.";
  // enrich diagnostic with actions/tools when present
  if (actions.length || tools.length) {
    const act = actions.length ? `Actions réalisées : ${actions.join(", ")}.` : "";
    const t = tools.length ? `Outils/plateformes consultés : ${tools.join(", ")}.` : "";
    diagnostic = `Diagnostic et actions menées : ${[act, t].filter(Boolean).join(" ")}`.trim();
  } else {
    diagnostic += " Aucune action technique détaillée fournie dans la note initiale.";
  }

  let result = "";
  if (escalations.length) {
    result = `La demande nécessite une escalade vers : ${escalations.join(", ")}. Transmission effectuée.`;
  } else if (actions.includes("Réinitialisation") || actions.includes("Intervention mot de passe")) {
    result = "Résolution effectuée : réinitialisation réalisée / intervention effectuée. Vérifier si l'utilisateur confirme la résolution.";
  } else {
    result = "Aucune résolution définitive fournie ; suivre la prochaine étape renseignée dans la note (p. ex. surveillance, rendez-vous, informations complémentaires nécessaires).";
  }

  // final composed description
  return `${summary}\n\nDescription détaillée :\n${userProblem}\n\n${diagnostic}\n\nRésultat / étape suivante :\n${result}`;
}

function extractUserProblem(text) {
  // heuristique simple : tenter d'extraire fragment contenant "utilisateur", "poste", "session", "impossible"
  const patterns = [
    /utilisateur[:\s\-]*([^.;\n]+)/i,
    /poste[:\s\-]*([^.;\n]+)/i,
    /session[:\s\-]*([^.;\n]+)/i,
    /impossible de ([^.;\n]+)/i,
    /ne peut pas ([^.;\n]+)/i,
    /erreur[:\s\-]*([^.;\n]+)/i
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[0].charAt(0).toUpperCase() + m[0].slice(1);
  }
  return null;
}

function sanitize(text) {
  return text.trim().replace(/\s+/g, " ");
}

function buildInternalNotes(tools, actions, note) {
  const bullets = [];
  if (actions.length) bullets.push(...actions.map(a => `- ${a}`));
  if (tools.length) bullets.push(`- Outils consultés : ${tools.join(", ")}`);
  // try to extract any concrete commands or checks
  const checks = extractChecks(note);
  if (checks.length) bullets.push(...checks.map(c => `- ${c}`));
  if (!bullets.length) bullets.push("- Aucune action technique détaillée fournie dans la note initiale.");
  return bullets.join("\n");
}

function extractChecks(text) {
  // repère phrases courtes mentionnant vérif, connecté, sync, etc.
  const sentences = text.split(/[.?!\n]+/).map(s => s.trim()).filter(Boolean);
  return sentences.filter(s => /vérif|check|sync|synchronis|intune|zscaler|réinitialis|reset|mdp|mot de passe|connect|vpn|ldap|ad|sap/i.test(s))
                  .map(s => s.endsWith(".") ? s : s + ".");
}

function buildClientComment(actions, escalations, tools) {
  // short polite message starting with Bonjour, ending with Cordialement, SD Nova
  let line;
  if (escalations.length) {
    line = `Bonjour,\n\nVotre demande a été transmise à l'équipe suivante : ${escalations.join(", ")} pour prise en charge. Nous reviendrons vers vous dès qu'ils auront un retour.\n\nCordialement,\nSD Nova`;
  } else if (actions.includes("Réinitialisation") || actions.includes("Intervention mot de passe")) {
    line = `Bonjour,\n\nVotre mot de passe / accès a été réinitialisé. Merci de vérifier que vous pouvez vous connecter et de nous informer en cas de problème.\n\nCordialement,\nSD Nova`;
  } else {
    // generic
    const toolMsg = tools.length ? ` (${tools.join(", ")})` : "";
    line = `Bonjour,\n\nL'intervention a été réalisée${toolMsg}. Si le problème persiste, merci de nous le signaler pour un suivi.\n\nCordialement,\nSD Nova`;
  }
  return line;
}

function formatTicket(note) {
  const text = sanitize(note);
  const summary = pickFirstSentence(text);
  const tools = findTools(text);
  const escalations = findEscalation(text);
  const actions = findActions(text);
  const description = buildDescription(text, summary, tools, actions, escalations);
  const internalNotes = buildInternalNotes(tools, actions, text);
  const clientComment = buildClientComment(actions, escalations, tools);

  const output = [
    '---',
    '###  Description',
    `- ${summary}`,
    '',
    description,
    '---',
    '###  Note de travail interne',
    internalNotes,
    '---',
    '###  Commentaire visible par le client',
    clientComment,
    '---'
  ].join('\n');

  return output;
}

// CLI / Exemple
function main() {
  const arg = process.argv.slice(2).join(" ");
  if (arg) {
    console.log(formatTicket(arg));
    return;
  }

  // exemples
  const exemples = [
    "Utilisateur: Dupont - Impossible de se connecter à sa session. Mot de passe bloqué. Réinitialisé le mot de passe via AD, vérif connexion OK.",
    "PC: poste123 - Outlook ne démarre pas, erreur 0x80070005. Vérif profil, reset MAPI, test sur webmail OK. Escalade L2 Exchange si persiste.",
    "Télétravail: VPN ne s'établit pas. Vérification Zscaler et Intune effectuée, appareil non compliant. Transmis à Mobility."
  ];

  for (const e of exemples) {
    console.log("=== NOTE SOURCE ===");
    console.log(e);
    console.log("\n--- TICKET FORMATTÉ ---\n");
    console.log(formatTicket(e));
    console.log("\n\n");
  }
}

if (require.main === module) main();

module.exports = { formatTicket };
