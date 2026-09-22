/**
 * speech.js
 * ---------------------------------------------------------
 * Encapsule la Web Speech API (reconnaissance vocale native
 * du navigateur). Support fiable sur Chrome (desktop + Android) ;
 * partiel/absent sur Safari/iOS selon versions.
 *
 * Deux modes d'activation, au choix (voir CONFIG.assistant.mode
 * dans config.js, modifiable via ⚙ Réglages) :
 *  - "bouton"  : comportement historique — un clic déclenche UNE
 *                écoute, puis s'arrête.
 *  - "mot_cle" : écoute EN CONTINU, en arrière-plan, en cherchant
 *                un mot-clé (ex: "Teguis") dans ce qui est dit ;
 *                une fois détecté, bascule sur une écoute de
 *                commande classique.
 *
 * Choix d'implémentation : DEUX instances SpeechRecognition
 * séparées (une par mode), plutôt qu'une seule instance dont on
 * changerait les réglages à la volée. L'API Web Speech n'aime pas
 * qu'on modifie `continuous`/`interimResults` pendant qu'une
 * instance est active — deux instances indépendantes évitent
 * complètement cette classe de bugs.
 *
 * Honnêteté importante sur le mode "mot_cle" : le navigateur
 * affichera un indicateur "micro actif" en permanence tant que ce
 * mode est actif — comportement standard du navigateur, pas un
 * bug, et ça consomme un peu plus de batterie qu'un simple bouton.
 * Le mode "bouton" reste toujours disponible en repli manuel.
 * ---------------------------------------------------------
 */

// Normalisation minimale (minuscule + sans accents), pour comparer le mot-clé
// prononcé sans être sensible aux accents que la reconnaissance peut ajouter/omettre.
function normalize(str){
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export class TeguisSpeech {
  // `onWakeWord(remainder)` : appelé quand le mot-clé est détecté en mode "mot_cle" —
  // `remainder` contient ce qui a été dit APRÈS le mot-clé dans la même phrase (peut être vide).
  constructor({ onStart, onEnd, onResult, onError, onWakeWord }){
    const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!Impl;
    if(!this.supported) return;

    this.wakeWord = "teguis";
    this._continuousShouldRun = false;   // piloté par start/stopWakeWordListening()
    this.mode = "commande";              // "commande" ou "motcle" — reflète QUELLE instance est active

    // --- Instance dédiée aux commandes ponctuelles (mode bouton, et suite d'un mot-clé) ---
    this.commandRecognition = new Impl();
    this.commandRecognition.lang = "fr-FR";
    this.commandRecognition.continuous = false;
    this.commandRecognition.interimResults = false;
    this.commandRecognition.onstart = () => { this.mode = "commande"; (onStart || (() => {}))(); };
    this.commandRecognition.onend = onEnd || (() => {});
    this.commandRecognition.onerror = onError || (() => {});
    this.commandRecognition.onresult = (event) => {
      const texte = event.results[event.results.length - 1][0].transcript;
      (onResult || (() => {}))(texte);
    };

    // --- Instance dédiée à l'écoute continue du mot-clé ---
    this.wakeRecognition = new Impl();
    this.wakeRecognition.lang = "fr-FR";
    this.wakeRecognition.continuous = true;
    this.wakeRecognition.interimResults = true;
    this.wakeRecognition.onstart = () => { this.mode = "motcle"; };
    this.wakeRecognition.onend = () => {
      // Les navigateurs coupent périodiquement l'écoute continue (silence prolongé, limite
      // de durée...) — on la relance automatiquement tant qu'elle est censée tourner,
      // sinon le mot-clé cesserait de fonctionner au bout de quelques dizaines de secondes.
      if(this._continuousShouldRun){
        try{ this.wakeRecognition.start(); } catch(err){ /* déjà en cours, ignoré */ }
      }
    };
    this.wakeRecognition.onerror = (e) => {
      // "no-speech"/"aborted"/"audio-capture" sont des évènements NORMAUX et fréquents en
      // écoute continue (silence dans la pièce...) — avalés silencieusement, onend relance seul.
      const benin = ["no-speech", "aborted", "audio-capture"];
      if(!benin.includes(e.error)) (onError || (() => {}))(e);
    };
    this.wakeRecognition.onresult = (event) => {
      for(let i = event.resultIndex; i < event.results.length; i++){
        const brut = event.results[i][0].transcript;
        const norm = normalize(brut);
        const idx = norm.indexOf(this.wakeWord);
        if(idx === -1) continue;

        // Texte prononcé APRÈS le mot-clé dans la même phrase, ex: "teguis allume le salon"
        // → remainder = "allume le salon". Vide si seul le mot-clé a été dit.
        const remainder = brut.slice(idx + this.wakeWord.length).trim();

        this._continuousShouldRun = false;                  // on coupe le réarmement automatique le temps de traiter
        try{ this.wakeRecognition.stop(); } catch(err){ /* sans conséquence */ }
        (onWakeWord || (() => {}))(remainder);
        return;   // un seul mot-clé traité par évènement
      }
    };
  }

  // --- Mode "bouton" (écoute unique) ---

  // Démarre l'écoute du micro pour UNE commande. Doit être appelée suite à une interaction
  // utilisateur (clic) la toute première fois — les navigateurs bloquent sinon l'accès micro.
  start(){
    if(!this.supported) throw new Error("Web Speech API non supportée");
    // Coupe l'écoute continue si elle tournait (une seule instance capte le micro à la fois).
    this._continuousShouldRun = false;
    try{ this.wakeRecognition.stop(); } catch(err){ /* pas grave si elle ne tournait pas */ }
    try{ this.commandRecognition.start(); }
    catch(err){ /* déjà en cours d'écoute : ignoré, évite une exception "InvalidStateError" bruyante */ }
  }

  // Arrête manuellement l'écoute de commande en cours (ex: second clic sur le bouton micro).
  // Utilise stop() et non abort() : stop() laisse le moteur finaliser et émettre le dernier
  // résultat déjà capté avant de fermer, alors qu'abort() jetterait ce qui vient d'être dit.
  // Déclenche le onend habituel (même callback que l'arrêt automatique par silence) — c'est
  // donc onEnd, côté app.js, qui exécutera la commande en attente, exactement comme avant.
  stop(){
    try{ this.commandRecognition.stop(); }
    catch(err){ /* pas en cours d'écoute : rien à arrêter, sans conséquence */ }
  }

  // --- Mode "mot_cle" (écoute continue en arrière-plan) ---

  startWakeWordListening(wakeWord){
    if(!this.supported) throw new Error("Web Speech API non supportée");
    this.wakeWord = normalize(wakeWord || "teguis");
    this._continuousShouldRun = true;
    try{ this.wakeRecognition.start(); }
    catch(err){ /* déjà en cours d'écoute : ignoré */ }
  }

  stopWakeWordListening(){
    this._continuousShouldRun = false;
    try{ this.wakeRecognition.stop(); } catch(err){ /* déjà arrêtée, sans conséquence */ }
  }
}

/**
 * Lecture d'un fichier audio préenregistré à partir d'une clé de la table
 * audioMap.
 *
 * `onEnded` est appelé une fois que le son a RÉELLEMENT fini de jouer —
 * c'est ce qui permet à app.js de faire "attendre" la commande MQTT
 * jusqu'à la fin de la confirmation vocale. Il est aussi appelé
 * immédiatement si le son est manquant/introuvable, pour que l'appli
 * reste utilisable même sans fichiers audio enregistrés (aucune commande
 * ne doit rester bloquée juste parce qu'un .mp3 n'existe pas encore).
 */
export function playResponse(key, audioMap, { onMissing, onEnded } = {}){
  const done = onEnded || (() => {});
  const warn = onMissing || (() => {});

  const path = audioMap[key];
  if(!path){
    warn(`Aucun son configuré pour: ${key}`);
    done();
    return;
  }

  const audio = new Audio(path);
  audio.addEventListener("ended", done);
  audio.play().catch(() => {
    warn(`Fichier audio introuvable: ${path}`);
    done();
  });
}
