/**
 * dashboard.js
 * ---------------------------------------------------------
 * Gère l'affichage :
 *  - les contrôles relais (toggles), générés depuis CONFIG.rooms
 *  - les cartes de monitoring, créées automatiquement dès
 *    qu'un nouveau topic capteur est reçu (aucune config requise
 *    côté ESP32 pour apparaître ici)
 *
 * Extensible : pour ajouter un nouveau TYPE de widget (ex: un
 * curseur au lieu d'un toggle pour un variateur de lumière),
 * ajoute une fonction de rendu et branche-la dans renderRooms().
 * ---------------------------------------------------------
 */

// Liste des noms d'appareils considérés comme des RELAIS (donc affichés en toggle ON/OFF,
// et jamais comme une carte de monitoring). Tout ce qui n'est pas dans cette liste est
// traité comme un capteur (température, humidité...).
const KNOWN_RELAY_APPAREILS = ["lumiere", "prise", "porte", "volet"];
const lastNumericValue = {}; // dernière valeur numérique connue par topic, pour afficher une tendance ▲/▼
const relayState = {};      // état ON/OFF courant de chaque relais, indexé par "piece/appareil"

// Petite touche visuelle : une icône par type d'appareil, purement cosmétique
// (n'affecte ni le parsing vocal ni les topics MQTT, juste l'affichage de la carte).
const RELAY_ICONS = { lumiere: "💡", prise: "🔌", porte: "🚪", volet: "🪟" };
function relayIcon(appareil){ return RELAY_ICONS[appareil] || "⚙️"; }

// Idem pour les capteurs : devine une icône à partir du nom du topic (aucune config requise,
// un topic non reconnu retombe simplement sur l'icône par défaut).
function sensorIcon(topic){
  const t = topic.toLowerCase();
  if(t.includes("temp")) return "🌡️";
  if(t.includes("humid")) return "💧";
  if(t.includes("lum") || t.includes("lux")) return "☀️";
  if(t.includes("mouv") || t.includes("presence") || t.includes("pir")) return "🚶";
  if(t.includes("gaz") || t.includes("fumee") || t.includes("smoke")) return "🫧";
  return "📶";
}

// Construit une clé unique et stable pour identifier un relais dans les objets ci-dessus.
function relayKey(piece, appareil){ return `${piece}/${appareil}`; }

// Utilisé par app.js pour savoir, à la réception d'un message MQTT, s'il faut mettre à
// jour un toggle (relais) ou une carte de monitoring (capteur).
export function isRelayTopic(appareil){
  return KNOWN_RELAY_APPAREILS.includes(appareil);
}

// Dessine la liste des relais/contrôles à partir de CONFIG.rooms.
// `onToggle(piece, appareil, "ON"|"OFF")` est appelé par app.js pour publier la commande MQTT.
export function renderRooms(rooms, onToggle){
  const list = document.getElementById("relay-list"); // conteneur HTML des contrôles
  list.innerHTML = "";                                  // on repart de zéro à chaque appel (ex: après un changement de réglages)

  rooms.forEach(r => {
    const key = relayKey(r.piece, r.appareil);
    if(!(key in relayState)) relayState[key] = false;   // état initial OFF tant qu'on n'a pas reçu de vraie valeur du device

    const row = document.createElement("div");           // une ligne = un contrôle
    row.className = "relay-row";
    row.innerHTML = `
      <div class="relay-main">
        <span class="relay-icon" aria-hidden="true">${relayIcon(r.appareil)}</span>
        <span class="relay-name">${r.label}</span>
      </div>
      <div class="toggle" data-key="${key}"></div>
    `;
    list.appendChild(row);

    // Au clic sur le toggle : on inverse l'état, on publie la commande, et on
    // met à jour l'UI immédiatement (sans attendre la confirmation de l'ESP32 —
    // voir README pour la discussion optimiste vs confirmée).
    row.querySelector(".toggle").addEventListener("click", () => {
      const next = !relayState[key];                    // on calcule le nouvel état souhaité
      onToggle(r.piece, r.appareil, next ? "ON" : "OFF"); // publie la commande MQTT
      updateRelayUI(r.piece, r.appareil, next);           // met à jour visuellement tout de suite
    });
  });
}

// Met à jour l'état visuel (allumé/éteint) d'un toggle donné. Appelé à la fois :
//  - localement, juste après un clic ou une commande vocale (optimiste)
//  - à la réception d'un message MQTT .../status venant réellement de l'ESP32 (confirmé)
export function updateRelayUI(piece, appareil, on){
  const key = relayKey(piece, appareil);
  relayState[key] = on;                                              // mémorise le nouvel état
  const el = document.querySelector(`.toggle[data-key="${key}"]`);   // retrouve l'élément DOM correspondant
  if(el) el.classList.toggle("on", on);                              // ajoute/enlève la classe CSS "on" (change la couleur/position)
}

// Crée ou met à jour la carte de monitoring d'un capteur, à partir d'un topic MQTT complet
// (ex: "teguis_dashboard_01/douche/temperature/status") et de sa valeur reçue.
// Affichage volontairement simple : un GROS CHIFFRE, rien d'autre — pas de graphique/sparkline,
// pour rester lisible même avec beaucoup de capteurs sur le tableau de bord.
export function updateSensorUI(topic, valeur){
  const container = document.getElementById("sensor-cards");
  // CSS.escape() évite qu'un topic contenant des caractères spéciaux ne casse le sélecteur CSS.
  let card = document.querySelector(`[data-sensor="${CSS.escape(topic)}"]`);

  if(!card){
    // Premier message reçu pour ce topic → on crée la carte à la volée (aucune
    // config préalable nécessaire, c'est ce qui rend le dashboard "plug-and-play").
    card = document.createElement("div");
    card.className = "sensor-card";
    card.dataset.sensor = topic;                                       // sert de clé pour la retrouver au prochain message
    card.innerHTML = `
      <div class="sensor-topic"><span aria-hidden="true">${sensorIcon(topic)}</span>${topic.split("/").slice(1, -1).join("/")}</div>
      <div class="sensor-value-row">
        <span class="sensor-value">—</span>
        <span class="sensor-trend" aria-hidden="true"></span>
      </div>
    `;
    container.appendChild(card);
  }

  card.querySelector(".sensor-value").textContent = valeur;             // affiche la dernière valeur brute reçue (texte)

  // Flèche de tendance (▲/▼) par rapport à la lecture précédente — un repère
  // utile en un coup d'œil, sans le poids visuel d'un graphique complet.
  const num = parseFloat(valeur);
  const trendEl = card.querySelector(".sensor-trend");
  if(!isNaN(num) && trendEl){
    const precedent = lastNumericValue[topic];
    if(precedent !== undefined && num !== precedent){
      const hausse = num > precedent;
      trendEl.textContent = hausse ? "▲" : "▼";
      trendEl.classList.toggle("up", hausse);
      trendEl.classList.toggle("down", !hausse);
    }
    lastNumericValue[topic] = num;
  }
}
