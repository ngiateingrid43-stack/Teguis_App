/**
 * commandParser.js
 * ---------------------------------------------------------
 * Transforme un texte transcrit ("allume la lumière du salon")
 * en commande structurée { piece, appareil, valeur, reponseKey }.
 *
 * Logique : on découpe la phrase en mots (tokens), on ignore les
 * accents/la casse/la ponctuation, puis on cherche dans ces mots
 * la présence d'un nom de pièce, d'un nom d'appareil et d'un verbe
 * d'action. Les pièces/appareils à plusieurs mots (ex: "salle a
 * manger") sont recherchés comme une suite consécutive de tokens,
 * pas comme un simple sous-texte — ça évite les faux positifs et
 * ça marche même si le mot est entouré d'autres mots ("dans la
 * salle a manger stp" matche quand même).
 *
 * Le vocabulaire vient de config.js — pour ajouter une pièce,
 * un appareil ou un mot d'action, modifie CONFIG.vocabulaire,
 * jamais ce fichier.
 * ---------------------------------------------------------
 */

/** Minuscule, sans accents, sans ponctuation, espaces normalisés. */
function normalizeText(str){
  return str
    .toLowerCase()                                      // insensible à la casse
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")    // enlève les accents (é→e, à→a...)
    .replace(/[^a-z0-9\s]/g, " ")                         // enlève la ponctuation (remplacée par un espace)
    .replace(/\s+/g, " ")                                 // fusionne les espaces multiples en un seul
    .trim();                                              // enlève les espaces en début/fin
}

// Découpe une chaîne normalisée en tableau de mots ("allume le salon" → ["allume","le","salon"]).
function tokenize(str){
  const n = normalizeText(str);      // on normalise d'abord
  return n ? n.split(" ") : [];      // chaîne vide → tableau vide (évite [""] avec split sur "")
}

/** Est-ce que la suite de tokens `sub` apparaît consécutivement dans `tokens` ? */
function containsSubsequence(tokens, sub){
  if(sub.length === 0 || sub.length > tokens.length) return false; // cas impossibles, sortie rapide
  // On essaie chaque position de départ possible dans `tokens`...
  for(let i = 0; i <= tokens.length - sub.length; i++){
    let match = true; // on suppose que ça matche jusqu'à preuve du contraire
    // ...et on vérifie que tous les mots de `sub` correspondent à partir de cette position.
    for(let j = 0; j < sub.length; j++){
      if(tokens[i + j] !== sub[j]){ match = false; break; } // un mot ne correspond pas → abandon de cette position
    }
    if(match) return true; // toute la sous-séquence a matché à la position i
  }
  return false; // aucune position de départ n'a fonctionné
}

/**
 * Cherche quelle clé d'un dictionnaire {clé: [alias, ...]} apparaît dans les
 * tokens de la phrase. En cas d'alias multiples correspondants, on garde
 * celui avec le plus de mots (le plus spécifique) — ex: si un jour "salle"
 * seul devenait un alias, "salle a manger" doit quand même gagner.
 */
function findByAlias(tokens, dict){
  let best = null;    // meilleure clé trouvée jusqu'ici
  let bestLen = 0;     // longueur (en mots) de l'alias qui a produit `best`
  for(const key of Object.keys(dict)){       // pour chaque pièce/appareil connu...
    for(const alias of dict[key]){           // ...pour chaque façon de le prononcer...
      const aliasTokens = tokenize(alias);   // on découpe aussi l'alias en mots
      // On ne remplace `best` que si cet alias est PLUS LONG que le meilleur actuel
      // ET qu'il apparaît réellement dans la phrase.
      if(aliasTokens.length > bestLen && containsSubsequence(tokens, aliasTokens)){
        best = key;
        bestLen = aliasTokens.length;
      }
    }
  }
  return best; // null si rien n'a été trouvé
}

/**
 * Cherche si le texte prononcé correspond au déclencheur d'une scène
 * personnalisée (ex: "je suis rentré", "mode nuit"...). Une scène peut
 * avoir plusieurs formulations (`phrases`) ; il suffit qu'UNE SEULE
 * apparaisse dans le texte (comme sous-séquence de mots) pour matcher.
 * Retourne la scène entière (avec ses actions) ou null.
 *
 * Vérifié AVANT le parsing générique pièce/appareil/action dans app.js :
 * une scène est une intention plus spécifique qu'une simple commande
 * ON/OFF sur un seul appareil, donc elle doit avoir la priorité.
 */
export function matchScene(texte, scenes){
  if(!scenes || scenes.length === 0) return null;
  const tokens = tokenize(texte);

  let best = null;
  let bestLen = 0;
  for(const scene of scenes){
    for(const phrase of (scene.phrases || [])){
      const phraseTokens = tokenize(phrase);
      // Comme pour findByAlias : on garde le déclencheur le plus long/spécifique
      // en cas de chevauchement possible entre plusieurs scènes.
      if(phraseTokens.length > bestLen && containsSubsequence(tokens, phraseTokens)){
        best = scene;
        bestLen = phraseTokens.length;
      }
    }
  }
  return best;
}

// Fonction principale exportée : transforme un texte libre en commande structurée (ou null).
export function parseCommand(texte, vocabulaire){
  const tokens = tokenize(texte); // découpage en mots normalisés, une seule fois

  const piece = findByAlias(tokens, vocabulaire.pieces);       // cherche la pièce mentionnée
  let appareil = findByAlias(tokens, vocabulaire.appareils);   // cherche l'appareil mentionné (let: peut être ajusté plus bas)

  // On normalise aussi les listes de verbes, pour comparer des tokens normalisés à des mots normalisés.
  const actionsOnNorm = vocabulaire.actionsOn.map(normalizeText);
  const actionsOffNorm = vocabulaire.actionsOff.map(normalizeText);

  // Un seul mot de la phrase suffit à déterminer l'action : ON si un verbe "on" est présent,
  // sinon OFF si un verbe "off" est présent, sinon aucune action détectée (null).
  const action = tokens.some(w => actionsOnNorm.includes(w)) ? "ON"
               : tokens.some(w => actionsOffNorm.includes(w)) ? "OFF"
               : null;

  // Pas d'appareil détecté mais pièce + action clairs → appareil par défaut
  // (voir CONFIG.vocabulaire.appareilParDefaut, typiquement "lumiere").
  if(!appareil && piece && action && vocabulaire.appareilParDefaut){
    appareil = vocabulaire.appareilParDefaut; // ex: "allume le salon" devient "allume la lumière du salon"
  }

  // Il faut les TROIS informations pour former une commande valide, sinon on abandonne.
  if(!piece || !appareil || !action) return null;

  // Commande complète : renvoyée à app.js pour publication MQTT + mise à jour de l'UI.
  return {
    piece,                                                       // ex: "salon"
    appareil,                                                    // ex: "lumiere"
    valeur: action,                                              // "ON" ou "OFF"
    reponseKey: `${appareil}_${piece}_${action.toLowerCase()}`   // ex: "lumiere_salon_on" (clé audioMap)
  };
}

/**
 * Point d'extension future : si un jour tu veux des commandes qui ne
 * suivent pas le schéma "pièce + appareil + on/off" (ex: "quelle heure
 * est-il", "lance le mode nuit"), ajoute ici une liste de handlers
 * personnalisés testés AVANT le parsing générique ci-dessus.
 *
 * Exemple de forme à suivre :
 *
 *   export const customHandlers = [
 *     {
 *       test: (t) => t.includes("mode nuit"),
 *       handle: () => ({ special: "mode_nuit", reponseKey: "mode_nuit_active" })
 *     }
 *   ];
 *
 * Et dans parseCommand, avant tout le reste :
 *   for(const h of customHandlers) if(h.test(t)) return h.handle();
 */
// Tableau vide pour l'instant — voir app.js, il est déjà branché et prêt à l'emploi.
export const customHandlers = [];
