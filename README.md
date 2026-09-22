# Teguis — Application web de contrôle domotique

Panneau de contrôle domotique en JavaScript pur (ES Modules), sans framework ni étape de build. Fonctionne sur n'importe quel navigateur moderne (desktop, Android, iOS) à partir d'un simple hébergement statique en HTTPS.

---

## 1. Comment démarrer (par où commencer concrètement)

1. **Ouvrir le projet en local** : comme `index.html` utilise des modules JS (`type="module"`), tu ne peux pas juste double-cliquer sur le fichier — les navigateurs bloquent le chargement de modules en `file://`. Lance un petit serveur local :
   ```bash
   cd teguis-app
   python3 -m http.server 8000
   ```
   puis ouvre `http://localhost:8000` dans Chrome.

2. **Configurer ton broker MQTT** : clique sur **⚙ Réglages** en haut à droite, renseigne l'URL WebSocket de ton broker (ex: `wss://xxxxx.hivemq.cloud:8884/mqtt`) et tes identifiants, puis **Appliquer**.

3. **Se connecter** : clique sur **Connecter**. Le voyant à côté de "Connexion broker" passe au vert (teal) si ça fonctionne.

4. **Tester un relais** : les toggles dans le panneau "Commandes" publient déjà sur `maison/{piece}/{appareil}/set`. Ouvre un client MQTT tiers (ex: MQTT Explorer) connecté au même broker pour vérifier que les messages arrivent bien, avant même de brancher un ESP32.

5. **Tester le monitoring** : publie manuellement une valeur test (ex: `22.5` sur `maison/salon/temperature/status`) depuis MQTT Explorer — une carte doit apparaître automatiquement dans "Monitoring capteurs".

6. **Tester la voix** : clique sur le bouton micro rond, dis "allume la lumière du salon". Le transcript s'affiche, la commande part en MQTT, et l'appli tente de jouer un son de confirmation (voir section 6 pour les fichiers audio).

7. **Enregistrer et déposer tes fichiers audio** dans le dossier `sons/` (voir section 6).

8. **Héberger en HTTPS** (GitHub Pages, Netlify, Vercel) une fois que tout fonctionne en local — le micro et la persistance des réglages en dépendent en usage réel.

---

## 2. Structure du projet

```
teguis-app/
├── index.html              → page HTML unique, structure visuelle
├── css/
│   └── style.css           → tous les styles, variables de thème personnalisables
├── js/
│   ├── config.js           → configuration par défaut (pièces, broker, thème, vocabulaire vocal)
│   ├── mqttClient.js        → encapsule la connexion MQTT (MQTT.js)
│   ├── speech.js            → reconnaissance vocale + lecture des réponses audio
│   ├── commandParser.js      → transforme un texte en commande structurée
│   ├── dashboard.js          → génère les toggles relais et les cartes de monitoring
│   ├── settingsPanel.js       → panneau de personnalisation (thème, pièces, export/import config)
│   ├── auth.js                → verrou d'accès basique (voir section 5, Sécurité)
│   └── app.js                → orchestre tous les modules ensemble (point d'entrée)
└── sons/
    └── (tes fichiers .mp3 de réponse, à ajouter toi-même)
```

**Pourquoi cette séparation :** chaque fichier a une seule responsabilité. Pour modifier ou remplacer une brique (ex: changer de bibliothèque MQTT, ou ajouter une vraie synthèse vocale), tu touches un seul fichier sans risquer de casser les autres. C'est ce qui rend le projet "flexible pour les mises à jour" — tu peux faire évoluer chaque module indépendamment.

---

## 3. Comment les modules communiquent entre eux

`app.js` est le seul fichier qui importe tous les autres et qui les connecte. Aucun module ne connaît directement les autres — ils communiquent via des **callbacks** passés en paramètre. Exemple avec `mqttClient.js` :

```js
const mqttClient = new TeguisMqttClient({
  onConnect: () => { /* ce que app.js veut faire à la connexion */ },
  onMessage: (topic, valeur) => { /* ce que app.js veut faire à la réception */ }
});
```

`mqttClient.js` ne sait rien du dashboard ou de la voix — il se contente d'appeler les callbacks qu'on lui donne. **Avantage concret pour toi** : si demain tu remplaces MQTT.js par une autre bibliothèque, tu ne réécris que `mqttClient.js`, tant que la classe garde les mêmes callbacks (`onConnect`, `onMessage`, etc.), `app.js` n'a rien à changer.

---

## 4. Comment fonctionne chaque brique

### `config.js`
Un seul objet `CONFIG` avec tout ce qui est propre à ton installation : liste des pièces/appareils, vocabulaire reconnu par la voix, table audio, couleurs du thème. **Ajouter une pièce ou un appareil se fait uniquement en ajoutant une ligne dans `CONFIG.rooms`** (ou via le panneau Réglages, qui fait la même chose en mémoire) :
```js
{ piece: "cuisine", appareil: "lumiere", label: "Lumière — Cuisine" }
```
Aucune autre modification de code nécessaire — le dashboard et le parser vocal utilisent tous les deux cette même config.

### `mqttClient.js`
Une classe qui encapsule MQTT.js. Elle s'abonne automatiquement à `maison/+/+/status` (le `+` est un joker MQTT) à la connexion, donc elle reçoit tous les statuts sans que tu aies à t'abonner topic par topic.

### `commandParser.js`
Reçoit un texte, cherche des mots-clés (pièce, appareil, action) dans `CONFIG.vocabulaire`, retourne soit `null` (commande non comprise) soit un objet `{ piece, appareil, valeur, reponseKey }`.

Un point d'extension est prévu : `customHandlers`, une liste vide par défaut, testée en priorité dans `app.js` avant le parsing générique. Utile pour des commandes qui ne suivent pas le schéma "pièce + appareil + on/off" (voir section 5).

### `speech.js`
Deux responsabilités : capter la voix (`TeguisSpeech`, autour de la Web Speech API) et jouer une réponse audio préenregistrée (`playResponse`). Si un fichier audio n'existe pas encore, ça log une erreur au lieu de planter — utile en développement avant d'avoir tous tes enregistrements.

### `dashboard.js`
Génère dynamiquement :
- les **toggles relais** à partir de `CONFIG.rooms`
- les **cartes de monitoring**, créées à la volée dès qu'un nouveau topic capteur est reçu (aucune configuration requise pour un nouveau capteur — dès que l'ESP32 publie sur un nouveau topic `.../status` qui n'est pas un relais connu, une carte apparaît avec un mini-graphique Chart.js)

### `settingsPanel.js`
Construit le formulaire de réglages : champs broker, sélecteurs de couleur pour le thème (appliqués en direct via des variables CSS), éditeur de pièces/appareils, et export/import de la config en fichier `.json`.

**Pourquoi export/import JSON plutôt que localStorage :** ce projet évite volontairement `localStorage` pour rester compatible avec un aperçu dans Claude.ai (qui ne le supporte pas). En usage réel (ton propre hébergement), l'export/import JSON te donne déjà une vraie persistance manuelle. Si tu veux une sauvegarde **automatique** entre les sessions une fois hébergé ailleurs que dans Claude, ajoute dans `settingsPanel.js`, fonction `readFormIntoConfig`, juste avant le `return config;` :
```js
localStorage.setItem("teguis-config", JSON.stringify(config));
```
et au démarrage de `app.js` :
```js
const saved = localStorage.getItem("teguis-config");
if(saved) Object.assign(CONFIG, JSON.parse(saved));
```

### `app.js`
Le chef d'orchestre. Crée les instances de `TeguisMqttClient` et `TeguisSpeech`, branche les boutons de l'interface, et fait le lien entre "un événement arrive quelque part" → "quoi faire dans l'interface". Le tableau de bord ne s'initialise qu'après déverrouillage du verrou d'accès (`auth.js`).

### `auth.js`
Verrou d'accès basique : demande une phrase de passe avant d'afficher le dashboard. **Voir la section Sécurité ci-dessous — ce n'est pas une vraie authentification.**

---

## 5. Sécurité — ce qui est couvert, ce qui ne l'est pas, honnêtement

Aucun système ne peut prétendre être "garanti sécurisé" à 100%. Voici précisément ce que cette version durcit, et ce qui reste de ta responsabilité.

### Ce que le code fait maintenant

- **TLS obligatoire** : `mqttClient.js` refuse toute URL ne commençant pas par `wss://` — impossible de se connecter en clair par erreur
- **Validation des topics** : tout topic publié est vérifié contre un format strict (lettres, chiffres, `_`, `-`, `/` uniquement) — bloque l'injection accidentelle de jokers MQTT (`#`, `+`) via un nom de pièce/appareil mal saisi dans les Réglages
- **Assainissement des entrées utilisateur** : les noms de pièce/appareil saisis dans le panneau de réglages sont nettoyés (minuscules, caractères sûrs uniquement) avant de servir à construire un topic
- **Limite de débit de publication** : max 60 publications/minute, pour éviter qu'une boucle logicielle ne spamme ton broker ou tes relais
- **Rejet des messages entrants trop volumineux** (>2 Ko), qui n'ont aucune raison légitime d'être aussi gros pour ce projet
- **Verrou d'accès basique** (`auth.js`) : une phrase de passe est demandée avant d'afficher le dashboard

### Ce que le code NE PEUT PAS garantir (limites structurelles d'une appli 100% statique)

- **Le verrou d'accès n'est pas une vraie authentification.** Le code JavaScript tourne entièrement dans le navigateur de l'utilisateur — n'importe qui peut ouvrir les outils de développement, lire la phrase de passe attendue dans le code source ou dans le trafic réseau, et contourner le verrou. C'est une gêne pour un accès occasionnel non malveillant, pas une protection contre quelqu'un de déterminé.
- **Pas de vraie session/authentification serveur.** Une appli purement statique (HTML/CSS/JS servis tels quels) n'a pas de backend pour vérifier "qui a le droit d'accéder à quoi" de façon fiable.
- **Les identifiants du broker restent visibles** dans la configuration côté client si quelqu'un inspecte le trafic ou le code — ce n'est pas un secret côté serveur.

### Pour une vraie protection en production, ajoute (hors périmètre de ce code, côté infrastructure)

1. **Authentification côté serveur** : héberge l'appli derrière un reverse proxy (Nginx/Caddy) avec Basic Auth, ou un petit backend qui gère de vraies sessions
2. **ACL sur le broker** : configure des permissions par utilisateur MQTT (ex: l'ESP32 ne peut publier que sur ses propres topics, ton appli ne peut ni lire ni écrire en dehors de `maison/#`) — HiveMQ Cloud et la plupart des brokers sérieux le permettent
3. **Réseau Wi-Fi IoT séparé** du réseau principal de la maison, pour limiter les dégâts si un appareil est compromis
4. **HTTPS sur l'hébergement** de l'appli elle-même (pas seulement le broker) — obligatoire de toute façon pour le micro
5. **Rotation régulière** des mots de passe broker et de la phrase de passe applicative

**Pour ton rapport de projet de fin d'études :** documente explicitement cette liste — un jury valorise généralement la lucidité sur les limites d'un système plutôt qu'une affirmation non fondée de sécurité totale.

---

## 6. Comment ajouter une nouvelle fonctionnalité

**Exemple : ajouter une commande spéciale "mode nuit" qui éteint tout d'un coup.**

Dans `commandParser.js`, remplis `customHandlers` :
```js
export const customHandlers = [
  {
    test: (t) => t.includes("mode nuit"),
    handle: () => ({ special: "mode_nuit", reponseKey: "mode_nuit_active" })
  }
];
```

Dans `app.js`, dans le `onResult` de `TeguisSpeech`, gère le cas `cmd.special` :
```js
if(cmd.special === "mode_nuit"){
  CONFIG.rooms.forEach(r => publishCommand(r.piece, r.appareil, "OFF"));
}
```

Aucune autre partie du code n'a besoin de changer. C'est le principe général pour étendre l'appli : identifie quel module est concerné (vocabulaire → `config.js`, logique de commande → `commandParser.js`, affichage → `dashboard.js`, branchement → `app.js`) et modifie uniquement celui-là.

**Autres extensions naturelles avec cette architecture :**
- Nouveau type de widget (curseur, sélecteur de couleur) → ajouter une fonction de rendu dans `dashboard.js`
- Nouvelle source de données (API météo externe) → nouveau petit module `weather.js`, branché dans `app.js`
- Authentification utilisateur → nouveau module `auth.js` qui protège l'affichage avant d'initialiser le reste

---

## 7. Fichiers audio à préparer

Chaque entrée de `CONFIG.audioMap` (dans `config.js`) correspond à un fichier attendu dans `sons/` :

| Clé | Fichier attendu |
|---|---|
| `lumiere_salon_on` | `sons/confirm_lumiere_salon_on.mp3` |
| `lumiere_salon_off` | `sons/confirm_lumiere_salon_off.mp3` |
| `lumiere_chambre_on` | `sons/confirm_lumiere_chambre_on.mp3` |
| `lumiere_chambre_off` | `sons/confirm_lumiere_chambre_off.mp3` |
| `prise_salon_on` | `sons/confirm_prise_salon_on.mp3` |
| `prise_salon_off` | `sons/confirm_prise_salon_off.mp3` |
| `commande_inconnue` | `sons/commande_inconnue.mp3` |
| `connexion_perdue` | `sons/connexion_perdue.mp3` |

Si tu ajoutes un appareil dans `CONFIG.rooms`, ajoute les deux entrées correspondantes (`on`/`off`) dans `CONFIG.audioMap`, et dépose les fichiers audio associés.

---

## 8. Côté ESP32 (rappel, hors périmètre de ce dépôt)

Pour que le tableau soit complet : ton ESP32 doit se connecter au **même broker MQTT** (en TCP classique via `PubSubClient`, pas WebSocket), s'abonner à `maison/+/+/set`, piloter ses relais à la réception, et republier l'état sur `.../status`. Les capteurs se publient sur `maison/{piece}/{capteur}/status` — le dashboard web les détecte automatiquement.

---

## 9. Limites connues à garder en tête

- **Web Speech API** : fiable sur Chrome (desktop + Android), support partiel/absent sur Safari/iOS selon versions
- **Réponses audio** : uniquement des phrases fixes préenregistrées — pas de valeurs numériques variables parlées (température exacte, etc.) sans travail supplémentaire (concaténation de segments ou TTS)
- **Persistance des réglages** : manuelle via export/import JSON dans ce livrable ; automatique si tu ajoutes `localStorage` une fois hébergé hors de Claude.ai (voir section 4)
- **HTTPS obligatoire** en production pour le micro et un futur service worker (PWA)
- **Sécurité d'accès** : le verrou de mot de passe intégré est une gêne, pas une vraie protection — voir section 5 pour ce qu'il faut ajouter côté infrastructure avant tout déploiement réel
