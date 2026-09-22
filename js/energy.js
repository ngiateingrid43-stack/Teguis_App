/**
 * energy.js
 * ---------------------------------------------------------
 * Reçoit les lectures des deux capteurs de courant du firmware
 * (topics .../energie/eclairage/status et .../energie/appareils/status,
 * en Watts), les trace sur un graphique en direct, calcule un bilan
 * de session à la demande, ET conserve un historique JOURNALIER
 * persistant (localStorage) pour les vues jour/semaine/mois/année.
 *
 * Deux niveaux de "mémoire" à bien distinguer :
 *  - `history`/`energieWh` : uniquement la session en cours (graphique
 *    en direct + bilan "session"), remis à zéro à chaque rechargement.
 *  - `dailyHistory` : cumul JOUR PAR JOUR, sauvegardé automatiquement
 *    dans le navigateur (localStorage) et qui SURVIT à la fermeture
 *    de l'app — c'est lui qui alimente les vues jour/semaine/mois/année.
 *
 * Honnêteté sur le mot "fichier" : un navigateur ne peut pas écrire
 * silencieusement sur le disque en arrière-plan (aucune API web ne le
 * permet sans qu'un sélecteur de fichier s'ouvre à chaque fois). La
 * sauvegarde AUTOMATIQUE se fait donc dans localStorage (propre à ce
 * navigateur/cet appareil). Pour un VRAI fichier que tu peux garder,
 * envoyer, ou ouvrir dans Excel, utilise le bouton "Exporter (.csv)"
 * — ça, c'est un vrai fichier téléchargé sur ton appareil.
 *
 * Les kWh affichés sont une estimation par intégration des lectures de
 * puissance dans le temps, pas une mesure certifiée.
 * ---------------------------------------------------------
 */

// Historique des lectures en mémoire, SESSION uniquement : { eclairage: [{t, w}], appareils: [{t, w}] }
const history = { eclairage: [], appareils: [] };
// Energie cumulée estimée depuis le début de la SESSION, en wattheures (Wh).
const energieWh = { eclairage: 0, appareils: 0 };

let chart = null;

/**
 * ---------------------------------------------------------
 * Historique journalier persistant (localStorage)
 * ---------------------------------------------------------
 * Structure stockée : { "2026-08-20": { eclairage: Wh, appareils: Wh }, ... }
 * Une entrée par jour calendaire (fuseau horaire du navigateur).
 */
const DAILY_STORAGE_KEY = "teguis-energy-daily-v1";
let dailyHistory = {};

// Clé du jour courant au format AAAA-MM-JJ (utilisée comme clé d'objet).
function todayKey(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Charge l'historique journalier depuis localStorage — à appeler une fois au démarrage.
export function loadDailyHistory(){
  try{
    const raw = localStorage.getItem(DAILY_STORAGE_KEY);
    dailyHistory = raw ? JSON.parse(raw) : {};
  } catch(err){
    console.warn("[Teguis] Historique énergie illisible, on repart de zéro:", err);
    dailyHistory = {};
  }
}

// Sauvegarde l'historique journalier courant dans localStorage.
function persistDailyHistory(){
  try{ localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(dailyHistory)); }
  catch(err){ console.warn("[Teguis] Impossible de sauvegarder l'historique énergie:", err); }
}

// Ajoute une quantité d'énergie (Wh) au jour courant, pour "eclairage" ou "appareils".
function addToDailyHistory(kind, deltaWh){
  const key = todayKey();
  if(!dailyHistory[key]) dailyHistory[key] = { eclairage: 0, appareils: 0 };
  dailyHistory[key][kind] += deltaWh;
  persistDailyHistory();
}

/**
 * Additionne l'énergie journalière sur une période donnée.
 * `periode` : "jour" | "semaine" | "mois" | "annee".
 * "semaine" = les 7 derniers jours calendaires (dont aujourd'hui), pas la semaine ISO.
 */
export function getAggregate(periode){
  const now = new Date();
  const totaux = { eclairage: 0, appareils: 0, jours: 0 };

  for(const [dateStr, valeurs] of Object.entries(dailyHistory)){
    const d = new Date(dateStr + "T00:00:00");
    let inclure = false;

    if(periode === "jour"){
      inclure = dateStr === todayKey();
    } else if(periode === "semaine"){
      const diffJours = (now - d) / 86400000;
      inclure = diffJours >= 0 && diffJours < 7;
    } else if(periode === "mois"){
      inclure = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    } else if(periode === "annee"){
      inclure = d.getFullYear() === now.getFullYear();
    }

    if(inclure){
      totaux.eclairage += valeurs.eclairage;
      totaux.appareils += valeurs.appareils;
      totaux.jours++;
    }
  }

  return totaux;
}

/**
 * Affiche le total kWh + coût FCFA (si tarif renseigné) pour la période choisie,
 * dans #energy-history-output. Appelé par app.js au clic sur un des boutons de période.
 */
export function renderHistory(periode, tarifParKwh){
  const output = document.getElementById("energy-history-output");
  if(!output) return;

  const { eclairage, appareils, jours } = getAggregate(periode);
  const totalWh = eclairage + appareils;
  const totalKwh = totalWh / 1000;

  const labels = { jour: "Aujourd'hui", semaine: "Cette semaine (7 derniers jours)", mois: "Ce mois-ci", annee: "Cette année" };

  if(jours === 0){
    output.innerHTML = `<p class="muted">Aucune donnée enregistrée pour "${labels[periode]}" — l'historique se construit au fil des jours d'utilisation.</p>`;
    return;
  }

  let coutHtml = "";
  if(tarifParKwh && tarifParKwh > 0){
    coutHtml = `<p><strong>Coût estimé :</strong> ${(totalKwh * tarifParKwh).toFixed(0)} FCFA</p>`;
  }

  output.innerHTML = `
    <p><strong>${labels[periode]} :</strong> ${totalKwh.toFixed(3)} kWh (${jours} jour${jours > 1 ? "s" : ""} de données)</p>
    <p>Éclairage : ${(eclairage / 1000).toFixed(3)} kWh &nbsp;·&nbsp; Autres appareils : ${(appareils / 1000).toFixed(3)} kWh</p>
    ${coutHtml}
  `;
}

/**
 * Exporte tout l'historique journalier en un vrai fichier .csv téléchargé —
 * ouvrable dans Excel/LibreOffice/Google Sheets, ou à garder comme sauvegarde.
 */
export function exportHistoryCsv(){
  const lignes = ["date,eclairage_kwh,appareils_kwh,total_kwh"];
  Object.keys(dailyHistory).sort().forEach(date => {
    const v = dailyHistory[date];
    const ecl = (v.eclairage / 1000).toFixed(4);
    const app = (v.appareils / 1000).toFixed(4);
    const total = ((v.eclairage + v.appareils) / 1000).toFixed(4);
    lignes.push(`${date},${ecl},${app},${total}`);
  });

  const blob = new Blob([lignes.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `teguis-consommation-${todayKey()}.csv`;
  a.click();
}

// A appeler une fois au démarrage, après que le <canvas id="energy-chart"> existe dans le DOM.
export function initEnergyChart(){
  const canvas = document.getElementById("energy-chart");
  if(!canvas || typeof Chart === "undefined") return;   // Chart.js absent ou canvas manquant : on n'affiche pas de graphe, sans planter

  const style = getComputedStyle(document.documentElement);
  const amber = style.getPropertyValue("--amber").trim() || "#DE8F3C";
  const teal = style.getPropertyValue("--teal").trim() || "#5E8F79";

  chart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "Éclairage (W)", data: [], borderColor: amber, backgroundColor: amber, borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: "Autres appareils (W)", data: [], borderColor: teal, backgroundColor: teal, borderWidth: 2, pointRadius: 0, tension: 0.3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { display: false },
        y: { display: true, beginAtZero: true, title: { display: true, text: "Watts" } }
      }
    }
  });
}

/**
 * Enregistre une nouvelle lecture de puissance pour "eclairage" ou "appareils".
 * Met à jour le graphique, le compteur de Wh cumulés, et les valeurs affichées
 * en direct sur les mini-cartes. Appelé depuis app.js à chaque message MQTT
 * reçu sur .../energie/<kind>/status.
 */
export function recordReading(kind, watts){
  if(kind !== "eclairage" && kind !== "appareils") return;   // topic énergie inconnu, on ignore proprement
  if(isNaN(watts)) return;

  const now = Date.now();
  const points = history[kind];

  // Intégration trapézoïdale simple : énergie = puissance moyenne × durée écoulée.
  if(points.length > 0){
    const prev = points[points.length - 1];
    const dureeHeures = (now - prev.t) / 3600000;   // millisecondes → heures
    const puissanceMoyenne = (prev.w + watts) / 2;
    const deltaWh = puissanceMoyenne * dureeHeures;
    energieWh[kind] += deltaWh;           // cumul de la session (graphique + bilan session)
    addToDailyHistory(kind, deltaWh);     // cumul persistant du jour (jour/semaine/mois/année)
  }

  points.push({ t: now, w: watts });
  if(points.length > 200) points.shift();   // fenêtre glissante, évite de saturer la mémoire sur une longue session

  updateLiveCards();
  updateChart();
}

// Met à jour les petites valeurs affichées en direct (Watts actuels + Wh cumulés).
function updateLiveCards(){
  const elEcl = document.getElementById("energy-live-eclairage");
  const elApp = document.getElementById("energy-live-appareils");
  const elTotal = document.getElementById("energy-live-total");

  const dernierEcl = history.eclairage.at(-1);
  const dernierApp = history.appareils.at(-1);

  if(elEcl) elEcl.textContent = dernierEcl ? `${dernierEcl.w.toFixed(0)} W` : "—";
  if(elApp) elApp.textContent = dernierApp ? `${dernierApp.w.toFixed(0)} W` : "—";
  if(elTotal){
    const totalWh = energieWh.eclairage + energieWh.appareils;
    elTotal.textContent = `${(totalWh / 1000).toFixed(3)} kWh (session)`;
  }
}

// Redessine le graphique à partir des deux historiques (fusionnés par index temporel approximatif).
function updateChart(){
  if(!chart) return;
  const labels = history.eclairage.map((p, i) => i);   // axe X = simples indices, pas des horodatages lisibles
  chart.data.labels = labels;
  chart.data.datasets[0].data = history.eclairage.map(p => p.w);
  chart.data.datasets[1].data = history.appareils.map(p => p.w);
  chart.update("none");
}

/**
 * Génère un texte de bilan + suggestions, à partir de ce qui a été
 * observé depuis le début de la session. Rendu dans #energy-bilan-output.
 * `tarifParKwh` est optionnel (CONFIG.energyTariff) : si fourni, une
 * estimation de coût est ajoutée — jamais inventée si absente.
 */
export function generateBilan(tarifParKwh){
  const output = document.getElementById("energy-bilan-output");
  if(!output) return;

  const totalWh = energieWh.eclairage + energieWh.appareils;
  if(totalWh <= 0){
    output.innerHTML = `<p class="muted">Pas encore assez de données cette session — laisse l'app connectée quelques minutes avec des appareils actifs, puis redemande un bilan.</p>`;
    return;
  }

  const pctEclairage = (energieWh.eclairage / totalWh) * 100;
  const pctAppareils = 100 - pctEclairage;
  const pointeEclairage = Math.max(0, ...history.eclairage.map(p => p.w));
  const pointeAppareils = Math.max(0, ...history.appareils.map(p => p.w));

  const suggestions = [];
  if(pctEclairage > 45){
    suggestions.push("L'éclairage représente une part importante de ta consommation — passer aux ampoules LED (si ce n'est pas déjà fait) ou éteindre systématiquement les pièces inoccupées peut réduire nettement ce poste.");
  }
  if(pctAppareils > 75){
    suggestions.push("Les autres appareils dominent largement la consommation — vérifie s'il y a des appareils laissés en veille inutilement (chargeurs, box, petit électroménager) : la veille cumulée pèse souvent plus qu'on ne le pense.");
  }
  if(pointeAppareils > 1500){
    suggestions.push(`Un pic de ${pointeAppareils.toFixed(0)} W a été mesuré sur les "autres appareils" — assure-toi que ton câblage/disjoncteur sur ce circuit est bien dimensionné pour cette charge.`);
  }
  if(suggestions.length === 0){
    suggestions.push("Répartition équilibrée entre éclairage et autres appareils, rien d'anormal détecté sur cette session.");
  }

  let coutHtml = "";
  if(tarifParKwh && tarifParKwh > 0){
    const cout = (totalWh / 1000) * tarifParKwh;
    coutHtml = `<p><strong>Coût estimé (session) :</strong> ${cout.toFixed(1)} FCFA — basé sur ton tarif configuré de ${tarifParKwh} FCFA/kWh.</p>`;
  }

  output.innerHTML = `
    <p><strong>Depuis le début de la session :</strong> ${(totalWh / 1000).toFixed(3)} kWh consommés au total.</p>
    <p>Éclairage : ${(energieWh.eclairage / 1000).toFixed(3)} kWh (${pctEclairage.toFixed(0)}%) — pic ${pointeEclairage.toFixed(0)} W.<br>
       Autres appareils : ${(energieWh.appareils / 1000).toFixed(3)} kWh (${pctAppareils.toFixed(0)}%) — pic ${pointeAppareils.toFixed(0)} W.</p>
    ${coutHtml}
    <p><strong>Suggestions :</strong></p>
    <ul>${suggestions.map(s => `<li>${s}</li>`).join("")}</ul>
    <p class="muted" style="margin-top:10px;">Bilan basé uniquement sur cette session (depuis l'ouverture de l'app) — pas d'historique long terme pour l'instant.</p>
  `;
}
