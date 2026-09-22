/**
 * config.js
 * ---------------------------------------------------------
 * Configuration par défaut de Teguis.
 * Tout ce qui est propre À TON installation (pièces, appareils,
 * broker, thème) se modifie ICI ou via le panneau de réglages
 * de l'appli — jamais besoin de toucher aux autres fichiers
 * pour ajouter une pièce ou un appareil.
 * ---------------------------------------------------------
 */

// On exporte un objet DEFAULT_CONFIG : c'est le "modèle" de config,
// utilisé pour créer CONFIG au démarrage et pour pouvoir réinitialiser plus tard.
export const DEFAULT_CONFIG = {

  // Informations de connexion au broker MQTT (rempli via ⚙ Réglages en général).
  broker: {
    url: "",        // ex: wss://xxxxx.hivemq.cloud:8884/mqtt — wss:// obligatoire, ws:// est refusé
    username: "",   // nom d'utilisateur MQTT (laisser vide si le broker est public/sans auth)
    password: ""    // mot de passe MQTT correspondant
  },

  // Verrou d'accès applicatif basique. ATTENTION : ce n'est PAS une vraie
  // authentification (voir js/auth.js et README section Sécurité) — le
  // code source du navigateur reste lisible par n'importe qui. Pour une
  // vraie protection, mets l'appli derrière un reverse proxy avec Basic
  // Auth ou un petit backend d'authentification.
  security: {
    appPassphrase: ""   // laisse vide en dev ; renseigne une phrase avant tout déploiement réel
  },

  // Structure des topics MQTT utilisés partout dans l'app (mqttClient.js, app.js...).
  topics: {
    // DOIT être identique à TOPIC_PREFIX dans config.h côté firmware ESP32,
    // sinon l'app et l'ESP32 publient/écoutent sur des topics différents
    // et ne se "voient" jamais, même avec une connexion MQTT qui fonctionne.
    prefix: "teguis_dashboard_01",   // 1er segment de chaque topic, ex: teguis_dashboard_01/salon/lumiere/set
    setSuffix: "set",                // dernier segment d'un topic de COMMANDE (app → ESP32)
    statusSuffix: "status"           // dernier segment d'un topic d'ÉTAT (ESP32 → app)
  },

  // Chaque relais/appareil affiché sur le tableau de bord.
  // Ajouter un objet ici = ajouter un contrôle, sans autre modif.
  rooms: [
    { piece: "salon",   appareil: "lumiere", label: "Lumière — Salon" },   // carte 1 du dashboard
    { piece: "chambre", appareil: "lumiere", label: "Lumière — Chambre" }, // carte 2 du dashboard
    { piece: "salon",   appareil: "prise",   label: "ventilateur — Salon" },     // carte 3 du dashboard
    { piece: "cuisine",   appareil: "lumiere", label: "Lumière — Cuisine" },   // carte 4 du dashboard
    { piece: "salle_a_manger", appareil: "lumiere", label: "Lumière — salle_a_manger" }, // carte 5 du dashboard
    { piece: "garage",   appareil: "porte",   label: "Porte — Garage" },  // carte 6 du dashboard (corrigé : le firmware déclare ce relais en "porte", pas "prise")
    { piece: "garage",   appareil: "lumiere", label: "Lumière — Garage" },  // carte 7 du dashboard   
    { piece: "couloir", appareil: "lumiere", label: "Lumière — Couloir" },  // carte 9 du dashboard
    { piece: "douche",   appareil: "lumiere",   label: "Lumière — Douche" },  // carte 10 du dashboard
    { piece: "veranda",  appareil: "lumiere",   label: "Lumière — Véranda" }, // carte 11 du dashboard (câblée en firmware mais absente ici jusqu'ici)
    { piece: "case_du_chien",   appareil: "porte",   label: "Trappe — Niche" },  // carte 12 du dashboard (corrigé : "porte", pas "prise")
    { piece: "portail",   appareil: "porte",   label: "Portail" },  // carte 13 du dashboard (corrigé : "porte", pas "prise")
    { piece: "pompe",   appareil: "pompe",   label: "Pompe" }  // carte 14 du dashboard (corrigé : "pompe", pas "prise")
  ],

  // Alias reconnus par le parser de commandes vocales.
  // Ajouter un mot/une phrase ici = la commande vocale le reconnaît immédiatement.
  // Chaque pièce/appareil = une clé technique (sans accent ni espace, utilisée
  // dans les topics MQTT) + une liste d'alias qu'on peut prononcer (accents,
  // espaces et variantes autorisés dans les alias, le parser normalise tout seul).
  vocabulaire: {
    // Dictionnaire clé technique → liste de façons de la prononcer.
    pieces: {
      salon:          ["salon"],                                    // un seul alias suffit ici
      chambre:        ["chambre"],
      cuisine:        ["cuisine"],
      douche:         ["douche", "salle de bain", "salle de bains"], // 3 façons de dire la même pièce
      garage:         ["garage"],
      salle_a_manger: ["salle a manger", "salle à manger"],          // alias à 3 mots, avec/sans accent
      veranda:        ["veranda", "véranda"],                         // avec/sans accent (normalisé quand même)
      portail:        ["portaille", "portail"],
      case_du_chien:  ["niche du chien", "case du chien"],
      couloir:        ["coulloire", "couloir", "couloire"],
      pompe:          ["pompe", "pompe à eau", "pompe a eau"]
    },
    // Dictionnaire clé technique appareil → liste d'alias vocaux.
    appareils: {
      lumiere: ["lumiere", "lumière", "lampe", "eclairage", "éclairage"], // tous les synonymes de "lumière"
      prise:   ["ventilateur", "climatiseur", "climatisation", "chauffe eau"],
      // "portail" est aussi listé ici (en plus d'être un nom de pièce) : ça permet
      // à "ouvre le portail" de résoudre correctement piece=portail ET appareil=porte,
      // au lieu de tomber par erreur sur l'appareil par défaut (lumière).
      porte:   ["porte", "portail", "trappe", "portillon"],
      // Pour ajouter une nouvelle fonctionnalité (ex: volet, chauffage...),
      // ajoute juste une nouvelle entrée ici, avec ses alias vocaux —
      // aucune autre modif de code n'est nécessaire.
      pompe:          ["pompe", "pompe à eau", "pompe a eau"]
    },
    // Verbes qui déclenchent une commande ON (impératif ET infinitif).
    actionsOn: ["allume", "allumer", "allumes", "ouvre", "ouvrir", "active", "activer", "allumez", "ouvrez"],
    // Verbes qui déclenchent une commande OFF (impératif ET infinitif, avec/sans accent).
    actionsOff: ["eteins", "éteins", "eteindre", "éteindre", "eteint", "éteint",
                 "ferme", "fermer", "désactive", "desactive", "désactiver", "desactiver", "fermez", "desactivez", "désactivez"],

    // Si la pièce et l'action sont claires mais qu'aucun mot d'appareil n'est
    // prononcé (ex: "allume le salon" au lieu de "allume la lumière du salon"),
    // on suppose que c'est la lumière — c'est l'intention la plus fréquente à
    // l'oral. Mets "" pour désactiver ce comportement et exiger l'appareil.
    appareilParDefaut: "lumiere"
  },

  // Mode d'activation de l'assistant vocal — modifiable via ⚙ Réglages.
  // "bouton"  : comportement historique, il faut cliquer sur le micro.
  // "mot_cle" : écoute en continu, se déclenche en prononçant `wakeWord`.
  // Le bouton micro reste TOUJOURS utilisable manuellement, quel que soit le mode.
  assistant: {
    mode: "bouton",
    wakeWord: "teguis"
  },

  // Tarif électrique optionnel (FCFA/kWh), utilisé UNIQUEMENT si renseigné
  // pour estimer un coût dans le bilan énergie — jamais de valeur inventée
  // si ce champ reste à 0 (voir energy.js).
  energyTariffFcfaPerKwh: 0,

  // Scènes personnalisées : une phrase vocale (ou un bouton) déclenche
  // PLUSIEURS actions d'un coup. Modifiable entièrement via ⚙ Réglages,
  // aucune ligne de code à toucher pour en ajouter une nouvelle.
  scenes: [
    {
      nom: "Je suis rentré",
      phrases: ["je suis rentre", "je suis rentré", "je suis a la maison", "je suis arrive"],
      actions: [
        { piece: "portail", appareil: "porte", valeur: "ON" },
        { piece: "salon",   appareil: "lumiere", valeur: "ON" },
        { piece: "couloir", appareil: "lumiere", valeur: "ON" }
      ]
    },
    {
      nom: "Mode nuit",
      phrases: ["mode nuit", "bonne nuit", "je vais dormir"],
      actions: [
        { piece: "salon",   appareil: "lumiere", valeur: "OFF" },
        { piece: "cuisine", appareil: "lumiere", valeur: "OFF" },
        { piece: "salle_a_manger", appareil: "lumiere", valeur: "OFF" },
        { piece: "couloir", appareil: "lumiere", valeur: "OFF" },
        { piece: "chambre", appareil: "lumiere", valeur: "ON" }
      ]
    },
    {
      nom: "Mode sécurité",
      phrases: ["mode securite", "mode sécurité", "je pars", "active la securite"],
      actions: [
        { piece: "salon",   appareil: "lumiere", valeur: "OFF" },
        { piece: "chambre", appareil: "lumiere", valeur: "OFF" },
        { piece: "cuisine", appareil: "lumiere", valeur: "OFF" },
        { piece: "garage",  appareil: "porte", valeur: "OFF" },
        { piece: "portail", appareil: "porte", valeur: "OFF" }
      ]
    }
  ],

  // Fichier audio joué pour chaque réponse. Clé = {appareil}_{piece}_{on|off}
  // ou une clé spéciale (commande_inconnue, connexion_perdue...).
  audioMap: {
    lumiere_salon_on:    "sons/confirm_lumiere_salon_on.mp3",   // joué quand "lumière salon" passe ON
    lumiere_salon_off:   "sons/confirm_lumiere_salon_off.mp3",  // joué quand "lumière salon" passe OFF
    lumiere_chambre_on:  "sons/confirm_lumiere_chambre_on.mp3", // idem pour la chambre
    lumiere_chambre_off: "sons/confirm_lumiere_chambre_off.mp3",
    lumiere_coulior_on:  "sons/confirm_lumiere_coulior_on.mp3", // idem pour le couloir
    lumiere_coulior_off: "sons/confirm_lumiere_coulior_off.mp3",
    lumiere_douche_on:  "sons/confirm_lumiere_douche_on.mp3", // idem pour la douche
    lumiere_douche_off: "sons/confirm_lumiere_douche_off.mp3",
    prise_salon_on:      "sons/confirm_prise_salon_on.mp3",     // idem pour la prise du salon
    prise_salon_off:     "sons/confirm_prise_salon_off.mp3",
    // Corrigé : l'appareil réel est "porte" (pas "prise") pour portail/case_du_chien/garage,
    // donc la clé générée par commandParser.js (reponseKey = appareil_piece_action) est porte_*.
    porte_portail_on:    "sons/confirm_porte_portail_on.mp3",
    porte_portail_off:   "sons/confirm_porte_portail_off.mp3",
    porte_case_du_chien_on:  "sons/confirm_porte_case_du_chien_on.mp3",
    porte_case_du_chien_off: "sons/confirm_porte_case_du_chien_off.mp3",
    porte_garage_on:     "sons/confirm_porte_garage_on.mp3",
    porte_garage_off:    "sons/confirm_porte_garage_off.mp3",
    commande_inconnue:   "sons/commande_inconnue.mp3",          // joué quand parseCommand() ne comprend rien
    connexion_perdue:    "sons/connexion_perdue.mp3",           // joué quand le broker MQTT se déconnecte

    // --- Notifications (pas liées à une commande vocale, déclenchées par app.js
    // à la réception de certains topics MQTT précis — voir onMessage dans app.js) ---
    portail_ouvert:      "sons/notif_portail_ouvert.mp3",   // le contact du portail passe à "ouvert"
    portail_ferme:       "sons/notif_portail_ferme.mp3",    // le contact du portail passe à "fermé"
    acces_autorise:      "sons/notif_acces_autorise.mp3",   // une porte à double authentification accorde l'accès
    acces_refuse:        "sons/notif_acces_refuse.mp3"      // une porte à double authentification refuse l'accès
  },

  // Thème visuel par défaut — modifiable en direct via le panneau de réglages.
  // Palette "maison chaleureuse" : crème, ambre cuivré, sauge (voir css/style.css).
  theme: {
    bg: "#F1E8D9",              // couleur de fond générale (mur crème)
    panel: "#FBF8F2",           // couleur de fond des panneaux/cartes (ivoire)
    accent: "#DE8F3C",          // couleur d'accent principale (ambre cuivré)
    accentSecondary: "#5E8F79", // couleur d'accent secondaire (sauge)
    text: "#332A20"             // couleur du texte principal (brun café)
  }
};

/**
 * Etat courant de la config (copie modifiable en mémoire pendant la session).
 * Séparé de DEFAULT_CONFIG pour toujours pouvoir "réinitialiser" proprement.
 */
// structuredClone fait une copie PROFONDE : modifier CONFIG ne touche jamais DEFAULT_CONFIG.
export let CONFIG = structuredClone(DEFAULT_CONFIG);

// Remet CONFIG à zéro (ex: bouton "Réinitialiser" dans Réglages) et renvoie la nouvelle valeur.
export function resetConfig(){
  CONFIG = structuredClone(DEFAULT_CONFIG); // nouvelle copie propre à partir du modèle
  return CONFIG;                            // pratique pour un usage du style `const c = resetConfig()`
}

/**
 * ---------------------------------------------------------
 * Persistance locale (optionnelle, désactivée par défaut)
 * ---------------------------------------------------------
 * Contrairement au reste du projet, CETTE partie utilise localStorage —
 * c'est volontaire et sûr ICI : Teguis, une fois hébergé (Netlify, GitHub
 * Pages...), tourne comme une vraie appli web dans le navigateur du
 * téléphone/ordinateur de l'utilisateur, pas dans un aperçu encapsulé.
 *
 * Rien n'est sauvegardé automatiquement : la personne doit cocher
 * explicitement "Se souvenir de mes réglages" dans ⚙ Réglages (voir
 * settingsPanel.js) — sans quoi tout redevient vierge à la fermeture,
 * comme avant.
 *
 * Limite honnête à connaître : localStorage n'est PAS chiffré. Sur un
 * appareil partagé/public, ne coche pas cette case, ou vide le
 * navigateur après usage.
 */
const STORAGE_KEY = "teguis-config-v1";

// Charge la config sauvegardée (si elle existe) DANS l'objet CONFIG déjà
// exporté — à appeler une seule fois, tout au début d'app.js, avant tout
// le reste. Retourne true si une config a bien été trouvée et appliquée.
export function loadPersistedConfig(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return false;
    const saved = JSON.parse(raw);
    Object.assign(CONFIG, saved);   // fusionne dans l'objet CONFIG existant (même référence pour tous les modules)
    return true;
  } catch(err){
    console.warn("[Teguis] Config sauvegardée illisible, ignorée:", err);
    return false;
  }
}

// Sauvegarde la config actuelle dans localStorage. Retourne true en cas de succès.
export function savePersistedConfig(config){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch(err){
    // Peut échouer en navigation privée stricte sur certains navigateurs, ou si le quota est plein.
    console.warn("[Teguis] Impossible de sauvegarder la config:", err);
    return false;
  }
}

// Efface la config sauvegardée (case décochée dans Réglages).
export function clearPersistedConfig(){
  try{ localStorage.removeItem(STORAGE_KEY); } catch(err){ /* rien à faire si indisponible */ }
}

// Utilisé par settingsPanel.js pour savoir si la case "Se souvenir" doit
// s'afficher cochée ou non à l'ouverture du panneau.
export function hasPersistedConfig(){
  try{ return localStorage.getItem(STORAGE_KEY) !== null; }
  catch(err){ return false; }
}
