/**
 * app.js
 * ---------------------------------------------------------
 * Point d'entrée de l'application. Ne contient QUE de
 * l'orchestration : chaque module fait un travail précis,
 * app.js les branche ensemble.
 *
 * Le tableau de bord ne s'initialise qu'après déverrouillage
 * du verrou d'accès (js/auth.js) — voir README section Sécurité
 * pour les limites de ce mécanisme.
 * ---------------------------------------------------------
 */

// Imports : chaque module gère une seule responsabilité (voir en-tête de chaque fichier).
import { CONFIG, loadPersistedConfig } from "./config.js";
import { TeguisMqttClient } from "./mqttClient.js";
import { TeguisSpeech, playResponse } from "./speech.js";
import { parseCommand, matchScene, customHandlers } from "./commandParser.js";
import { isRelayTopic, renderRooms, updateRelayUI, updateSensorUI } from "./dashboard.js";
import { applyTheme, renderSettings } from "./settingsPanel.js";
import { requireAccessGate } from "./auth.js";
import { showToast } from "./notifications.js";
import { initEnergyChart, recordReading, generateBilan, loadDailyHistory, renderHistory, exportHistoryCsv } from "./energy.js";
import { renderScenes } from "./scenes.js";

// Affiche une salutation adaptée à l'heure + la date du jour sous le titre "Teguis".
// Purement cosmétique : ne dépend d'aucun module, s'exécute avant même le verrou d'accès.
function setGreeting(){
  const el = document.getElementById("greeting");
  if(!el) return;
  const h = new Date().getHours();
  const mot = h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
  const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  el.textContent = `${mot} 👋   ${date}`;
}
setGreeting();

// Ajoute une ligne horodatée dans le panneau "Journal" en bas de l'écran.
function log(msg){
  const el = document.getElementById("cmd-log");
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.prepend(line);   // prepend = ajoute en HAUT, donc les messages les plus récents restent visibles en premier
}

// Allume/éteint un voyant visuel (petit rond coloré) identifié par son id HTML.
function setLed(id, on){
  document.getElementById(id).classList.toggle("on", on);   // ajoute/enlève la classe CSS "on"
}

// Fonction principale, appelée uniquement APRES déverrouillage du gate d'accès (voir tout en bas du fichier).
function initApp(){

  /* ---------------- MQTT ---------------- */

  // Instancie le client MQTT et lui fournit toutes les réactions aux évènements réseau.
  const mqttClient = new TeguisMqttClient({
    onConnect: () => { setLed("conn-led", true); log("Connecté au broker MQTT (TLS)"); },
    onDisconnect: () => { setLed("conn-led", false); playResponse("connexion_perdue", CONFIG.audioMap, { onMissing: log }); },
    onError: (err) => log(`Erreur MQTT: ${err.message}`),
    onSecurityWarning: (msg) => log(`⚠ Sécurité: ${msg}`),
    // Appelé à chaque message MQTT reçu (donc sur un topic .../status, puisque c'est
    // le seul type de topic auquel mqttClient.js s'abonne).
    onMessage: (topic, valeur) => {
      const parts = topic.split("/"); // prefix / piece / appareil / status
      const [, piece, appareil] = parts;   // on ignore le préfixe (1er élément), on garde pièce + appareil

      // --- Énergie : topics .../energie/eclairage ou .../energie/appareils ---
      // Routés vers le module énergie plutôt que vers une carte capteur générique.
      if(piece === "energie"){
        recordReading(appareil, parseFloat(valeur));
        return;
      }

      // --- Accès (porte à double authentification) : topics .../<porte>/acces ---
      // "piece" est ici le nom de la porte (ex: "entree"), pas une pièce de la maison.
      if(appareil === "acces"){
        handleAccessEvent(piece, valeur);
        return;
      }

      // --- Portail : notification sonore + toast à chaque changement réel d'état ---
      // (ne bloque pas le traitement normal ci-dessous : la carte capteur du
      // contact continue aussi de s'afficher comme n'importe quel autre capteur).
      if(piece === "portail" && appareil === "contact"){
        handlePortailContact(valeur);
      }

      if(isRelayTopic(appareil)){
        // C'est un relais connu (lumière, prise...) → on met à jour le toggle correspondant.
        updateRelayUI(piece, appareil, valeur === "ON" || valeur === "1");
      } else {
        // Sinon on considère que c'est un capteur → on crée/actualise sa carte de monitoring.
        updateSensorUI(topic, valeur);
      }
    }
  });

  // Mémorise le dernier état connu du contact du portail, pour ne notifier
  // que sur un VRAI changement (pas à chaque republication du même état,
  // ex: juste après une reconnexion MQTT).
  let previousPortailState = null;
  function handlePortailContact(valeur){
    const ouvert = valeur === "1";
    if(previousPortailState === null){
      previousPortailState = ouvert;   // premher message reçu = état initial, pas un évènement à notifier
      return;
    }
    if(ouvert !== previousPortailState){
      previousPortailState = ouvert;
      showToast(ouvert ? "🚪 Portail ouvert" : "🚪 Portail fermé", ouvert ? "info" : "success");
      playResponse(ouvert ? "portail_ouvert" : "portail_ferme", CONFIG.audioMap, { onMissing: log });
    }
  }

  // Réagit à un évènement d'accès publié par un module de porte à double
  // authentification (voir firmware/access_control). `piece` est ici le nom
  // de la porte (PORTE_NOM dans config_access.h), pas une pièce de la maison.
  function handleAccessEvent(piece, valeur){
    const accorde = valeur === "GRANTED";
    log(`Accès ${accorde ? "AUTORISÉ" : "REFUSÉ"} sur "${piece}"`);
    showToast(`${accorde ? "✅" : "⛔"} Accès ${accorde ? "autorisé" : "refusé"} — ${piece}`, accorde ? "success" : "danger");
    playResponse(accorde ? "acces_autorise" : "acces_refuse", CONFIG.audioMap, { onMissing: log });
  }

  // Publie une commande MQTT vers un appareil donné. Utilisée à la fois par les clics
  // manuels sur le dashboard ET par les commandes vocales reconnues.
  function publishCommand(piece, appareil, valeur){
    try{
      const topic = `${CONFIG.topics.prefix}/${piece}/${appareil}/${CONFIG.topics.setSuffix}`;
      mqttClient.publish(topic, valeur);
      log(`→ ${topic} : ${valeur}`);
    } catch(err){
      log(err.message);   // ex: pas connecté, topic invalide, rate-limit atteint...
    }
  }

  // Bouton "Connecter" : tente la connexion avec la config actuelle (broker.js + préfixe de topic).
  document.getElementById("connect-btn").addEventListener("click", () => {
    try{
      mqttClient.connect({ ...CONFIG.broker, topicPrefix: CONFIG.topics.prefix });
    } catch(err){
      log(err.message);   // ex: URL manquante, ws:// refusé...
    }
  });

  /* ---------------- Voix ---------------- */

  // Mémorise la dernière phrase reconnue, en attente d'exécution une fois la voix
  // COMPLÈTEMENT terminée (voir onEnd plus bas). Séparé de onResult pour garantir
  // que la commande ne parte jamais pendant que le micro est encore actif.
  let pendingTranscript = null;

  // Exécute toutes les actions d'une scène d'un coup (appelée par un clic sur
  // un bouton de scène OU par une commande vocale reconnue comme telle).
  function triggerScene(scene){
    log(`Scène "${scene.nom}" déclenchée (${scene.actions.length} action(s))`);
    scene.actions.forEach(a => {
      publishCommand(a.piece, a.appareil, a.valeur);
      updateRelayUI(a.piece, a.appareil, a.valeur === "ON");
    });
    showToast(`🎬 Scène "${scene.nom}" activée`, "success");
  }

  // Exécute réellement une commande à partir d'un texte transcrit : parsing,
  // publication MQTT, mise à jour de l'UI, et son de confirmation. Extrait dans
  // sa propre fonction pour être appelé depuis onEnd, une fois la voix terminée.
  function executeVoiceCommand(texte){
    // Priorité 1 : une scène personnalisée ("mode nuit", "je suis rentré"...) —
    // plus spécifique qu'une simple commande ON/OFF sur un seul appareil.
    const scene = matchScene(texte, CONFIG.scenes);
    if(scene){
      document.getElementById("last-response").textContent = scene.nom;
      const reponseKey = `scene_${scene.nom.toLowerCase().replace(/\s+/g, "_")}`;
      playResponse(reponseKey, CONFIG.audioMap, {
        onMissing: log,
        onEnded: () => triggerScene(scene)
      });
      return;
    }

    // Priorité 2 : les handlers personnalisés (vide par défaut, voir commandParser.js),
    // puis le parseur générique pièce/appareil/action si rien d'autre n'a matché.
    let cmd = null;
    for(const h of customHandlers){
      if(h.test(texte.toLowerCase())){ cmd = h.handle(); break; }
    }
    if(!cmd) cmd = parseCommand(texte, CONFIG.vocabulaire);

    if(!cmd){
      // Ni un handler personnalisé, ni le parseur générique n'ont compris la phrase.
      log("Commande non reconnue");
      playResponse("commande_inconnue", CONFIG.audioMap, { onMissing: log });
      return;   // on s'arrête là, rien à publier
    }

    document.getElementById("last-response").textContent = cmd.reponseKey.replace(/_/g, " ");

    // On joue D'ABORD le son de confirmation, et la commande MQTT n'est publiée
    // que dans onEnded — c'est-à-dire une fois le son RÉELLEMENT terminé. Si le
    // son est manquant, onEnded est quand même appelé immédiatement (voir
    // speech.js) donc la commande part sans délai artificiel.
    playResponse(cmd.reponseKey, CONFIG.audioMap, {
      onMissing: log,
      onEnded: () => {
        if(cmd.piece && cmd.appareil){
          // Commande "classique" (pièce + appareil identifiés) → on publie et on met à jour l'UI.
          publishCommand(cmd.piece, cmd.appareil, cmd.valeur);
          updateRelayUI(cmd.piece, cmd.appareil, cmd.valeur === "ON");
        }
      }
    });
  }

  // Instancie la reconnaissance vocale et définit ce qui se passe à chaque étape.
  const speech = new TeguisSpeech({
    onStart: () => {
      pendingTranscript = null;   // on efface tout résultat d'une écoute précédente avant d'en démarrer une nouvelle
      document.getElementById("mic-btn").classList.add("listening");
      setLed("mic-led", true);
    },
    // Déclenché quand le moteur de reconnaissance a fini d'écouter (micro réellement fermé).
    // C'est SEULEMENT ICI que la commande part — jamais pendant que le micro est encore actif —
    // pour que le lancement soit net, juste après la fin de la voix, sans chevauchement possible.
    // (Ne concerne QUE les écoutes de commande ponctuelles — l'écoute de fond du mot-clé ne
    // déclenche jamais ce callback, voir speech.js.)
    onEnd: () => {
      document.getElementById("mic-btn").classList.remove("listening");
      setLed("mic-led", false);
      if(pendingTranscript){
        const texte = pendingTranscript;
        pendingTranscript = null;   // consommé, on évite une double exécution si onEnd se déclenchait deux fois
        executeVoiceCommand(texte);
      }
      rearmAssistantIfNeeded();   // reprend l'écoute du mot-clé si ce mode est actif
    },
    onError: (e) => {
      if(e.error === "not-allowed" || e.error === "service-not-allowed"){
        log("🎙️ Autorisation micro requise : clique une fois sur le bouton micro pour l'activer.");
      } else {
        log(`Erreur reconnaissance vocale: ${e.error}`);
      }
    },
    // Appelé dès que le navigateur a une transcription finale — on se contente de
    // l'afficher et de la mettre en attente ; l'exécution réelle attend onEnd (voir ci-dessus).
    onResult: (texte) => {
      document.getElementById("transcript").textContent = `« ${texte} »`;   // affiche ce qui a été compris
      log(`Voix reçue: "${texte}"`);
      pendingTranscript = texte;   // sera exécuté par onEnd, une fois la voix vraiment terminée
    },
    // Déclenché en mode "mot_cle" quand le mot-clé configuré est détecté dans l'écoute de fond.
    onWakeWord: (remainder) => {
      if(remainder && remainder.length > 1){
        // La commande a été dite dans la même phrase que le mot-clé (ex: "teguis allume le salon").
        document.getElementById("transcript").textContent = `« ${remainder} »`;
        log(`Mot-clé "${CONFIG.assistant.wakeWord}" détecté : "${remainder}"`);
        executeVoiceCommand(remainder);
        rearmAssistantIfNeeded();   // pas de capture supplémentaire nécessaire, on réarme tout de suite
      } else {
        // Mot-clé seul : on ouvre une écoute de commande classique juste après (comme un clic manuel).
        log(`Mot-clé "${CONFIG.assistant.wakeWord}" détecté, j'écoute la commande…`);
        speech.start();   // son onEnd exécutera la commande puis réarmera le mot-clé (voir plus haut)
      }
    }
  });

  // Relance l'écoute en continu du mot-clé si c'est le mode actuellement configuré —
  // sans effet si le mode est "bouton". Centralisé ici pour être appelé après CHAQUE
  // commande traitée ET après tout changement de réglages.
  function rearmAssistantIfNeeded(){
    if(CONFIG.assistant.mode !== "mot_cle") return;
    try{ speech.startWakeWordListening(CONFIG.assistant.wakeWord); }
    catch(err){ /* déjà géré par onError si l'autorisation micro manque */ }
  }

  // Bouton micro : toujours utilisable manuellement, quel que soit le mode d'activation choisi.
  // Le bouton lui-même ne change pas : même icône, même classe "listening" gérée par onStart/onEnd.
  // Seul le comportement du clic gagne une seconde branche : un clic pendant l'écoute l'arrête
  // immédiatement (au lieu d'attendre le silence) — la commande déjà captée part quand même,
  // via onEnd, exactement comme un arrêt automatique.
  document.getElementById("mic-btn").addEventListener("click", () => {
    if(!speech.supported){ log("Web Speech API non supportée sur ce navigateur (essaie Chrome)"); return; }
    if(document.getElementById("mic-btn").classList.contains("listening")){
      speech.stop();
    } else {
      speech.start();
    }
  });

  // Démarre l'écoute du mot-clé dès le chargement si c'est le mode configuré. Peut échouer
  // silencieusement la toute première fois si le navigateur n'a pas encore accordé la
  // permission micro (voir message explicite dans onError ci-dessus) — un premier clic
  // manuel sur le micro débloque alors la permission pour la suite.
  rearmAssistantIfNeeded();

  /* ---------------- Dashboard (relais) ---------------- */

  // Redessine la liste des contrôles à partir de CONFIG.rooms (appelé au démarrage,
  // et à nouveau chaque fois que les réglages changent, car les pièces/appareils peuvent varier).
  function refreshRooms(){
    renderRooms(CONFIG.rooms, publishCommand);
  }
  refreshRooms();   // premier rendu au chargement de la page

  /* ---------------- Scènes personnalisées ---------------- */

  function refreshScenes(){
    renderScenes(CONFIG.scenes, triggerScene);
  }
  refreshScenes();   // premier rendu au chargement de la page

  /* ---------------- Énergie ---------------- */

  initEnergyChart();
  loadDailyHistory();   // recharge l'historique jour/semaine/mois/année sauvegardé (localStorage)

  const bilanBtn = document.getElementById("energy-bilan-btn");
  if(bilanBtn){
    bilanBtn.addEventListener("click", () => generateBilan(CONFIG.energyTariffFcfaPerKwh));
  }

  // Onglets de période (Jour/Semaine/Mois/Année) : un seul actif à la fois, style "radio".
  let periodeActive = "jour";
  document.querySelectorAll(".period-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".period-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      periodeActive = tab.dataset.periode;
      renderHistory(periodeActive, CONFIG.energyTariffFcfaPerKwh);
    });
  });
  renderHistory(periodeActive, CONFIG.energyTariffFcfaPerKwh);   // affichage initial ("Jour")

  const exportBtn = document.getElementById("energy-export-btn");
  if(exportBtn) exportBtn.addEventListener("click", exportHistoryCsv);

  /* ---------------- Réglages ---------------- */

  const settingsModal = document.getElementById("settings-modal");

  // Ouvre le panneau de réglages et définit ce qui se passe quand on clique "Appliquer" dedans.
  document.getElementById("open-settings-btn").addEventListener("click", () => {
    renderSettings(CONFIG, {
      onApply: (updatedConfig) => {
        Object.assign(CONFIG, updatedConfig);   // fusionne les nouveaux réglages dans l'objet CONFIG existant
        applyTheme(CONFIG.theme);                // applique immédiatement les nouvelles couleurs
        refreshRooms();                          // redessine le dashboard (pièces/appareils ont pu changer)
        refreshScenes();                         // redessine les boutons de scènes (ont pu changer aussi)
        // Le mode d'activation vocale (ou le mot-clé lui-même) a pu changer : on arrête
        // toujours l'écoute de fond puis on la relance seulement si le nouveau mode le demande.
        speech.stopWakeWordListening();
        rearmAssistantIfNeeded();
        renderHistory(periodeActive, CONFIG.energyTariffFcfaPerKwh);   // le tarif FCFA/kWh a pu changer
        log("Réglages appliqués");
        settingsModal.classList.remove("open");  // referme la modale
      }
    });
    settingsModal.classList.add("open");   // ouvre la modale (affichage géré en CSS via la classe "open")
  });

  // Bouton "✕" de la modale : ferme sans rien appliquer.
  document.getElementById("close-settings-btn").addEventListener("click", () => {
    settingsModal.classList.remove("open");
  });

  /* ---------------- Init ---------------- */

  applyTheme(CONFIG.theme);   // applique le thème par défaut dès le chargement
  log("Interface prête. Configure le broker (bouton Réglages) puis connecte-toi.");
}

/* ---------------- Config persistée (avant même le verrou d'accès) ---------------- */

// Recharge les réglages sauvegardés (broker, thème, pièces, scènes...) si la
// personne avait coché "Se souvenir de mes réglages" lors d'une visite
// précédente — voir loadPersistedConfig() dans config.js. Silencieux et sans
// effet si rien n'a jamais été sauvegardé (comportement identique à avant).
loadPersistedConfig();

/* ---------------- Verrou d'accès (avant toute chose) ---------------- */

// Tout le reste de l'appli (initApp) n'est exécuté qu'une fois la bonne phrase de passe saisie
// (ou immédiatement si aucune phrase n'est configurée — voir auth.js).
requireAccessGate({
  expectedPassphrase: CONFIG.security.appPassphrase,
  onUnlock: initApp
});

/* ---------------- PWA : installable sur téléphone/ordinateur ----------------
 * Permet d'ajouter Teguis à l'écran d'accueil (icône comme une vraie appli)
 * et de garder l'app shell disponible même en cas de coupure réseau brève.
 * Ne fonctionne qu'en HTTPS (ou localhost) — voir README section hébergement. */
if("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // échoue silencieusement en http:// non sécurisé (ex: simple test local) — non bloquant
    });
  });
}

/**
 * Bouton d'installation natif : Chrome/Edge (desktop et Android) déclenchent
 * l'évènement "beforeinstallprompt" quand l'app est installable. On intercepte
 * ce prompt pour proposer un vrai bouton "Installer" dans l'interface plutôt
 * que de compter sur l'utilisateur pour trouver l'option dans le menu du
 * navigateur — c'est ce qui permet ensuite d'ouvrir Teguis comme une appli
 * à part entière, sans jamais avoir à retaper/rouvrir l'URL.
 * Remarque : Safari/iOS ne déclenche jamais cet évènement — sur iPhone,
 * l'installation reste manuelle via Partager → "Sur l'écran d'accueil"
 * (voir README pour les instructions détaillées par plateforme).
 */
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();               // empêche la mini-infobar automatique du navigateur
  deferredInstallPrompt = event;        // on garde l'évènement pour le déclencher plus tard, sur clic utilisateur
  const btn = document.getElementById("install-app-btn");
  if(btn) btn.hidden = false;           // le bouton n'apparaît QUE si une installation est réellement possible
});

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("install-app-btn");
  if(!btn) return;
  btn.addEventListener("click", async () => {
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();                     // affiche le vrai dialogue d'installation du navigateur
    await deferredInstallPrompt.userChoice;              // attend le choix de l'utilisateur (accepté/refusé)
    deferredInstallPrompt = null;
    btn.hidden = true;                                    // le prompt ne peut être utilisé qu'une seule fois
  });
});

// Une fois l'app effectivement installée (quelle que soit la méthode), inutile
// de continuer à proposer le bouton.
window.addEventListener("appinstalled", () => {
  const btn = document.getElementById("install-app-btn");
  if(btn) btn.hidden = true;
});
