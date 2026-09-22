/**
 * mqttClient.js — version durcie
 * ---------------------------------------------------------
 * Encapsule la connexion MQTT (via MQTT.js, chargé en <script>
 * global dans index.html donc accessible ici comme `window.mqtt`).
 *
 * Durcissements appliqués ici :
 *  1. Refuse toute URL non chiffrée (impose wss://)
 *  2. Valide le format de chaque topic avant publication
 *     (évite l'injection de caractères de contrôle MQTT
 *     comme # ou + dans un topic censé être fixe)
 *  3. Limite le débit de publication (anti-spam / anti-boucle)
 *
 * Ce que CE FICHIER NE PEUT PAS garantir (voir README, section
 * Sécurité) : l'authentification et les permissions par topic
 * (ACL) se configurent côté BROKER, pas ici.
 * ---------------------------------------------------------
 */

// Un topic "sûr" ne contient que lettres/chiffres/_/-// : pas de #, +, espaces, ni caractères spéciaux.
const TOPIC_SAFE_PATTERN = /^[a-zA-Z0-9_\-\/]+$/;
// Plafond de publications par minute, pour éviter qu'un bug (boucle infinie) ne sature le broker.
const MAX_PUBLISH_PER_MINUTE = 60;

// Classe qui encapsule TOUTE la logique MQTT de l'appli — le reste du code
// (app.js) ne parle jamais directement à MQTT.js, seulement à cette classe.
export class TeguisMqttClient {
  // Le constructeur reçoit des callbacks (fournis par app.js) à appeler
  // à chaque évènement MQTT important.
  constructor({ onConnect, onDisconnect, onMessage, onError, onSecurityWarning }){
    this.client = null;                              // instance MQTT.js réelle, créée seulement dans connect()
    this.onConnect = onConnect || (() => {});         // callback : connexion réussie
    this.onDisconnect = onDisconnect || (() => {});   // callback : déconnexion/coupure
    this.onMessage = onMessage || (() => {});         // callback : message MQTT reçu
    this.onError = onError || (() => {});             // callback : erreur de connexion/protocole
    this.onSecurityWarning = onSecurityWarning || (() => {}); // callback : avertissement non bloquant
    this._publishTimestamps = [];                     // historique des heures de publication (pour le rate-limit)
  }

  // Ouvre la connexion au broker. Lève une exception (throw) si la config est invalide —
  // c'est à l'appelant (app.js) de l'attraper avec try/catch et de l'afficher au journal.
  connect({ url, username, password, topicPrefix }){
    if(!url) throw new Error("URL du broker manquante"); // rien à faire sans URL
    if(!topicPrefix) throw new Error("Préfixe de topic manquant (doit correspondre à TOPIC_PREFIX du firmware)");
    this.topicPrefix = topicPrefix; // mémorisé pour construire le filtre d'abonnement plus bas

    // Sécurité : on refuse tout ce qui n'est pas chiffré (ws:// est en clair sur le réseau).
    if(!url.startsWith("wss://")){
      throw new Error(
        "Connexion refusée : seule une URL wss:// (chiffrée TLS) est acceptée. " +
        "ws:// non chiffré expose tes identifiants et commandes en clair sur le réseau."
      );
    }

    // Pas une erreur bloquante, mais on prévient si aucun identifiant n'est fourni.
    if(!username || !password){
      this.onSecurityWarning(
        "Connexion sans identifiants — déconseillé hors phase de test sur un broker privé."
      );
    }

    // clean:true = pas de session persistante côté broker entre deux connexions.
    const options = { clean: true, connectTimeout: 8000 };
    if(username) options.username = username; // n'ajoute la clé que si elle est fournie
    if(password) options.password = password; // idem

    // window.mqtt vient du <script> MQTT.js chargé globalement dans index.html.
    this.client = window.mqtt.connect(url, options);

    // Dès que la connexion TCP/TLS + handshake MQTT réussit :
    this.client.on("connect", () => {
      // On s'abonne à TOUS les topics d'état de TOUTES les pièces/appareils
      // (les deux "+" sont des wildcards MQTT à un niveau).
      this.client.subscribe(`${this.topicPrefix}/+/+/status`);
      this.onConnect(); // prévient app.js (allume le voyant, log, etc.)
    });

    this.client.on("close", () => this.onDisconnect());     // connexion fermée proprement
    this.client.on("reconnect", () => this.onDisconnect()); // MQTT.js retente une connexion → on affiche "déconnecté" entre-temps
    this.client.on("error", (err) => this.onError(err));    // erreur réseau/protocole

    // Un message arrive sur un topic auquel on est abonné (donc un topic .../status).
    this.client.on("message", (topic, payload) => {
      // Garde-fou : ignore les payloads anormalement volumineux
      if(payload.length > 2048){
        this.onSecurityWarning(`Message ignoré (trop volumineux) sur ${topic}`);
        return; // on ne transmet pas ce message à onMessage
      }
      this.onMessage(topic, payload.toString()); // payload est un Buffer → on le convertit en texte
    });
  }

  // Coupe la connexion proprement (ex: avant de reconfigurer le broker).
  disconnect(){
    if(this.client){
      this.client.end(true);  // true = fermeture forcée immédiate, sans attendre les messages en attente
      this.client = null;     // on oublie la référence pour permettre une nouvelle connect() propre
    }
  }

  // Petit utilitaire : vrai seulement si une connexion existe ET qu'elle est active.
  isConnected(){
    return !!(this.client && this.client.connected);
  }

  // Publie une commande sur un topic. Lève une exception si quelque chose est anormal —
  // à nouveau, c'est à l'appelant de l'attraper et de l'afficher.
  publish(topic, valeur){
    if(!this.isConnected()) throw new Error("Client MQTT non connecté"); // rien à publier sans connexion

    // Vérifie que le topic ne contient pas de caractères MQTT spéciaux inattendus.
    if(!TOPIC_SAFE_PATTERN.test(topic)){
      throw new Error(`Topic rejeté (caractères non autorisés): ${topic}`);
    }

    // Anti-boucle/anti-spam : refuse de publier si on dépasse le quota de la minute.
    if(!this._checkRateLimit()){
      throw new Error("Limite de publication atteinte (anti-boucle/anti-spam), réessaie dans un instant");
    }

    this.client.publish(topic, String(valeur)); // MQTT.js veut une chaîne, on force la conversion
  }

  // Retourne true si on a le droit de publier maintenant, false si le quota est dépassé.
  // Implémente une fenêtre glissante d'une minute (pas un simple compteur qui se remet à zéro).
  _checkRateLimit(){
    const now = Date.now();
    // On ne garde que les publications des 60 dernières secondes.
    this._publishTimestamps = this._publishTimestamps.filter(t => now - t < 60000);
    if(this._publishTimestamps.length >= MAX_PUBLISH_PER_MINUTE) return false; // quota dépassé
    this._publishTimestamps.push(now); // on enregistre cette publication
    return true; // autorisé
  }
}
