/**
 * settingsPanel.js
 * ---------------------------------------------------------
 * Panneau permettant à l'UTILISATEUR de personnaliser
 * l'application sans toucher au code :
 *  - ajouter/retirer des pièces et appareils
 *  - changer les couleurs du thème
 *  - exporter/importer sa configuration en fichier JSON
 *  - sauvegarder ses réglages dans ce navigateur (opt-in, voir
 *    hasPersistedConfig/savePersistedConfig/clearPersistedConfig
 *    dans config.js)
 * ---------------------------------------------------------
 */

import { hasPersistedConfig, savePersistedConfig, clearPersistedConfig } from "./config.js";

// Applique un thème (5 couleurs) en modifiant les variables CSS globales (--bg, --panel...).
// Comme le CSS entier est écrit avec var(--xxx), tout le visuel se met à jour instantanément.
export function applyTheme(theme){
  const root = document.documentElement;             // la balise <html>, portée globale pour les variables CSS
  root.style.setProperty("--bg", theme.bg);
  root.style.setProperty("--panel", theme.panel);
  root.style.setProperty("--amber", theme.accent);
  root.style.setProperty("--teal", theme.accentSecondary);
  root.style.setProperty("--text", theme.text);
}

// Construit tout le contenu HTML du panneau de réglages à partir de la config courante,
// puis branche les évènements (clics, etc.). Rappelée entièrement à chaque changement
// (ajout/suppression de pièce) pour rester simple plutôt que de faire du diffing DOM.
export function renderSettings(config, callbacks){
  const panel = document.getElementById("settings-body");
  panel.innerHTML = "";   // on repart de zéro à chaque rendu

  // --- Broker ---
  panel.appendChild(section("Connexion broker", `
    <input id="set-broker-url" placeholder="wss://TON_BROKER:8884/mqtt" value="${config.broker.url}">
    <input id="set-broker-user" placeholder="Utilisateur" value="${config.broker.username}">
    <input id="set-broker-pass" placeholder="Mot de passe" type="password" value="${config.broker.password}">
    <input id="set-topic-prefix" placeholder="Préfixe de topic (doit être identique à TOPIC_PREFIX du firmware)" value="${config.topics.prefix}">
  `));

  // --- Thème ---
  panel.appendChild(section("Thème", `
    <label>Fond<input type="color" id="theme-bg" value="${config.theme.bg}"></label>
    <label>Panneaux<input type="color" id="theme-panel" value="${config.theme.panel}"></label>
    <label>Accent principal<input type="color" id="theme-accent" value="${config.theme.accent}"></label>
    <label>Accent secondaire<input type="color" id="theme-accent2" value="${config.theme.accentSecondary}"></label>
  `));

  // --- Pièces / appareils ---
  // On génère une ligne éditable par entrée de config.rooms, avec son index (data-idx)
  // pour pouvoir la retrouver/la supprimer précisément ensuite.
  const roomsHtml = config.rooms.map((r, i) => `
    <div class="room-row" data-idx="${i}">
      <input class="room-piece" value="${r.piece}" placeholder="pièce">
      <input class="room-appareil" value="${r.appareil}" placeholder="appareil">
      <input class="room-label" value="${r.label}" placeholder="libellé affiché">
      <button class="btn-remove-room" data-idx="${i}">✕</button>
    </div>
  `).join(""); // toutes les lignes concaténées en une seule chaîne HTML
  panel.appendChild(section("Pièces &amp; appareils", `
    <div id="rooms-editor">${roomsHtml}</div>
    <button id="add-room-btn" class="btn-secondary">+ Ajouter un appareil</button>
  `));

  // --- Export / import ---
  panel.appendChild(section("Sauvegarde de la configuration", `
    <button id="export-config-btn" class="btn-secondary">Exporter (.json)</button>
    <input type="file" id="import-config-input" accept="application/json" style="margin-top:8px;">
  `));

  // --- Scènes personnalisées ---
  // Chaque scène : un nom, une ou plusieurs phrases de déclenchement (une par
  // ligne), et une liste d'actions (une par ligne, format "piece,appareil,ON/OFF").
  // Encodage volontairement simple en texte plutôt qu'un éditeur visuel complexe —
  // reste lisible et facile à corriger à la main.
  const scenesHtml = (config.scenes || []).map((s, i) => `
    <div class="scene-row" data-idx="${i}">
      <input class="scene-nom" value="${s.nom}" placeholder="Nom de la scène (ex: Mode nuit)">
      <textarea class="scene-phrases" rows="2" placeholder="Phrases de déclenchement, une par ligne">${(s.phrases || []).join("\n")}</textarea>
      <textarea class="scene-actions" rows="3" placeholder="Actions, une par ligne : piece,appareil,ON ou OFF">${(s.actions || []).map(a => `${a.piece},${a.appareil},${a.valeur}`).join("\n")}</textarea>
      <button class="btn-remove-scene" data-idx="${i}">✕ Supprimer cette scène</button>
    </div>
  `).join("");
  panel.appendChild(section("Scènes personnalisées", `
    <p class="muted" style="margin:0 0 10px 0;">Une scène déclenche plusieurs actions d'un coup, à la voix ou par bouton (ex: "mode nuit" éteint tout sauf la chambre).</p>
    <div id="scenes-editor">${scenesHtml}</div>
    <button id="add-scene-btn" class="btn-secondary">+ Ajouter une scène</button>
  `));

  // --- Assistant vocal : mode d'activation ---
  panel.appendChild(section("Assistant vocal", `
    <label>
      <span>Activation</span>
      <select id="set-assistant-mode" style="width:auto;">
        <option value="bouton" ${config.assistant.mode === "bouton" ? "selected" : ""}>Bouton uniquement (clic pour parler)</option>
        <option value="mot_cle" ${config.assistant.mode === "mot_cle" ? "selected" : ""}>Mot-clé (écoute en continu)</option>
      </select>
    </label>
    <label>
      <span>Mot-clé (si activation par mot-clé)</span>
      <input id="set-assistant-wakeword" value="${config.assistant.wakeWord}" style="width:140px;" placeholder="teguis">
    </label>
    <p class="muted" style="margin:6px 0 0 0;">En mode mot-clé, le navigateur affiche un indicateur "micro actif" en permanence — normal, pas un bug. Le bouton micro reste utilisable manuellement dans les deux modes.</p>
  `));

  // --- Énergie ---
  panel.appendChild(section("Énergie", `
    <label>Tarif électrique (FCFA/kWh, optionnel — laisse à 0 pour ne pas estimer de coût)
      <input id="set-energy-tariff" type="number" min="0" step="1" value="${config.energyTariffFcfaPerKwh || 0}" style="width:100px; margin-left:8px;">
    </label>
  `));

  // --- Sauvegarde locale (opt-in) ---
  // Reflète honnêtement l'état RÉEL de localStorage à l'ouverture du panneau
  // (pas juste une préférence en mémoire) : si la personne a déjà coché puis
  // rouvre Réglages plus tard, la case doit apparaître cochée pour de vrai.
  panel.appendChild(section("Sur cet appareil", `
    <label style="align-items:flex-start; gap:10px;">
      <span>
        Se souvenir de mes réglages sur cet appareil<br>
        <span class="muted" style="font-size:12px;">Garde broker, pièces, scènes et thème même après fermeture de l'app.
        Stocké uniquement dans ce navigateur, en clair — ne coche pas sur un appareil partagé/public.</span>
      </span>
      <input type="checkbox" id="set-remember" style="width:auto; flex-shrink:0;" ${hasPersistedConfig() ? "checked" : ""}>
    </label>
  `));

  // Bouton final, sans titre de section (d'où le premier argument vide).
  panel.appendChild(section("", `<button id="apply-settings-btn" class="btn-primary">Appliquer</button>`));

  wireEvents(config, callbacks);   // attache tous les gestionnaires de clic/changement définis ci-dessous
}

// Petit utilitaire de mise en page : enveloppe un bloc HTML dans une section titrée (ou pas).
function section(title, innerHtml){
  const div = document.createElement("div");
  div.className = "settings-section";
  div.innerHTML = title ? `<h3>${title}</h3>${innerHtml}` : innerHtml; // pas de <h3> si titre vide
  return div;
}

// Branche tous les événements du panneau : ajout/suppression de pièce, export/import, application.
function wireEvents(config, { onApply }){
  // Ajouter une ligne pièce/appareil vide, puis re-rendre tout le panneau pour l'afficher.
  document.getElementById("add-room-btn").addEventListener("click", () => {
    config.rooms.push({ piece: "", appareil: "", label: "" });
    renderSettings(config, { onApply });   // re-rendu complet du panneau avec la nouvelle ligne
  });

  // Un bouton "✕" par ligne existante : supprime l'entrée correspondante puis re-rend.
  document.querySelectorAll(".btn-remove-room").forEach(btn => {
    btn.addEventListener("click", () => {
      config.rooms.splice(Number(btn.dataset.idx), 1);   // retire l'élément à cet index
      renderSettings(config, { onApply });
    });
  });

  // Ajouter une scène vide, puis re-rendre tout le panneau pour l'afficher.
  document.getElementById("add-scene-btn").addEventListener("click", () => {
    if(!config.scenes) config.scenes = [];
    config.scenes.push({ nom: "", phrases: [], actions: [] });
    renderSettings(config, { onApply });
  });

  // Un bouton "✕ Supprimer" par scène existante.
  document.querySelectorAll(".btn-remove-scene").forEach(btn => {
    btn.addEventListener("click", () => {
      config.scenes.splice(Number(btn.dataset.idx), 1);
      renderSettings(config, { onApply });
    });
  });

  // Génère un fichier .json téléchargeable contenant la config actuelle (lue depuis le formulaire).
  document.getElementById("export-config-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(readFormIntoConfig(config), null, 2)], { type: "application/json" });
    const a = document.createElement("a");       // lien invisible, cliqué par programme
    a.href = URL.createObjectURL(blob);
    a.download = "teguis-config.json";
    a.click();
  });

  // Lit un fichier .json choisi par l'utilisateur et remplace la config courante par son contenu.
  document.getElementById("import-config-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if(!file) return;                              // rien sélectionné, on ne fait rien
    const reader = new FileReader();
    reader.onload = () => {
      const imported = JSON.parse(reader.result);  // parse le contenu texte du fichier en objet
      Object.assign(config, imported);              // fusionne (écrase) la config actuelle avec l'import
      renderSettings(config, { onApply });           // ré-affiche le panneau avec les nouvelles valeurs
      onApply(config);                               // applique immédiatement (thème, dashboard...)
    };
    reader.readAsText(file);   // déclenche la lecture asynchrone, `onload` sera appelé une fois terminée
  });

  // Bouton "Appliquer" : relit tous les champs du formulaire dans `config`, sauvegarde
  // (ou efface) la copie locale selon la case "Se souvenir", puis prévient app.js.
  document.getElementById("apply-settings-btn").addEventListener("click", () => {
    const updated = readFormIntoConfig(config);
    const seSouvenir = document.getElementById("set-remember").checked;
    if(seSouvenir) savePersistedConfig(updated);
    else clearPersistedConfig();
    onApply(updated);
  });
}

// Relit CHAQUE champ du formulaire de réglages et les écrit dans l'objet `config` fourni.
// Retourne ce même objet (référence), pratique pour l'enchaîner directement dans onApply(...).
function readFormIntoConfig(config){
  config.broker.url = document.getElementById("set-broker-url").value.trim();
  config.broker.username = document.getElementById("set-broker-user").value.trim();
  config.broker.password = document.getElementById("set-broker-pass").value.trim();
  // || config.topics.prefix : si le champ est vidé/invalide, on garde l'ancienne valeur plutôt que "".
  config.topics.prefix = sanitizeTopicSegment(document.getElementById("set-topic-prefix").value) || config.topics.prefix;

  config.theme.bg = document.getElementById("theme-bg").value;
  config.theme.panel = document.getElementById("theme-panel").value;
  config.theme.accent = document.getElementById("theme-accent").value;
  config.theme.accentSecondary = document.getElementById("theme-accent2").value;

  // Reconstruit tout le tableau rooms à partir des lignes actuellement affichées dans le formulaire.
  const rows = document.querySelectorAll(".room-row");
  config.rooms = Array.from(rows).map(row => ({
    piece: sanitizeTopicSegment(row.querySelector(".room-piece").value),         // nettoyé pour usage MQTT
    appareil: sanitizeTopicSegment(row.querySelector(".room-appareil").value),   // idem
    label: row.querySelector(".room-label").value.trim()                        // libre, juste pour l'affichage
  })).filter(r => r.piece && r.appareil);   // ignore les lignes incomplètes (vides après nettoyage)

  // Reconstruit le tableau scenes à partir des lignes du formulaire. Chaque ligne
  // "piece,appareil,valeur" du textarea "actions" est parsée en objet {piece,appareil,valeur}.
  const sceneRows = document.querySelectorAll(".scene-row");
  config.scenes = Array.from(sceneRows).map(row => {
    const nom = row.querySelector(".scene-nom").value.trim();
    const phrases = row.querySelector(".scene-phrases").value
      .split("\n").map(p => p.trim().toLowerCase()).filter(Boolean);
    const actions = row.querySelector(".scene-actions").value
      .split("\n").map(line => line.trim()).filter(Boolean)
      .map(line => {
        const [piece, appareil, valeur] = line.split(",").map(s => s.trim());
        return { piece: sanitizeTopicSegment(piece || ""), appareil: sanitizeTopicSegment(appareil || ""), valeur: (valeur || "").toUpperCase() };
      })
      .filter(a => a.piece && a.appareil && (a.valeur === "ON" || a.valeur === "OFF"));   // ignore les lignes mal formées
    return { nom, phrases, actions };
  }).filter(s => s.nom && s.actions.length > 0);   // ignore les scènes sans nom ou sans aucune action valide

  const tariffInput = document.getElementById("set-energy-tariff");
  if(tariffInput) config.energyTariffFcfaPerKwh = Math.max(0, parseFloat(tariffInput.value) || 0);

  const modeSelect = document.getElementById("set-assistant-mode");
  const wakeWordInput = document.getElementById("set-assistant-wakeword");
  if(modeSelect) config.assistant.mode = modeSelect.value;
  if(wakeWordInput) config.assistant.wakeWord = wakeWordInput.value.trim().toLowerCase() || "teguis";

  return config;
}

/**
 * Un topic MQTT ne doit jamais contenir #, +, /, ou des espaces à
 * l'intérieur d'un segment — ces caractères ont un sens spécial dans
 * MQTT (jokers, séparateurs). Comme les noms de pièce/appareil viennent
 * d'une saisie utilisateur libre, on les nettoie avant de les utiliser
 * pour construire un topic (évite qu'un nom mal formé casse le routage
 * ou touche involontairement un autre topic via un joker).
 */
function sanitizeTopicSegment(value){
  return value.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, ""); // ne garde que a-z, 0-9, _ et -
}
