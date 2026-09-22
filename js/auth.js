/**
 * auth.js
 * ---------------------------------------------------------
 * Verrou d'accès très basique à l'échelle de l'appli : demande
 * une phrase de passe avant d'afficher le tableau de bord.
 *
 * A SAVOIR (honnêteté technique, voir README section Sécurité) :
 * Ceci est une mesure d'ATTÉNUATION, pas une vraie authentification.
 * Une appli 100% statique (HTML/JS servi tel quel) ne peut jamais
 * garantir une sécurité d'accès robuste : n'importe qui inspectant
 * le code source du navigateur peut voir cette logique et la
 * contourner. Pour une vraie protection d'accès, il faut une
 * authentification côté SERVEUR (reverse proxy avec Basic Auth,
 * ou un petit backend qui vérifie une session) — voir README.
 *
 * Cette passphrase ne persiste jamais (pas de localStorage) :
 * elle est redemandée à chaque rechargement de page, par design.
 * ---------------------------------------------------------
 */

// Affiche un écran de verrouillage par-dessus toute l'appli tant que la bonne
// phrase de passe n'a pas été saisie. `onUnlock` est appelé une fois déverrouillé
// (c'est lui qui initialise réellement le dashboard, voir app.js → initApp).
export function requireAccessGate({ expectedPassphrase, onUnlock }){
  if(!expectedPassphrase){
    // Aucune passphrase configurée : on ne bloque pas, mais on prévient.
    console.warn("[Teguis] Aucun verrou d'accès configuré (APP_PASSPHRASE vide dans config.js).");
    onUnlock();     // on saute directement le verrou
    return;         // et on ne construit pas l'overlay
  }

  // Construction de l'écran de verrouillage (overlay plein écran, voir style.css #access-gate).
  const overlay = document.createElement("div");
  overlay.id = "access-gate";
  overlay.innerHTML = `
    <div class="gate-box">
      <div class="panel-label">Accès protégé</div>
      <input type="password" id="gate-input" placeholder="Phrase de passe">
      <button id="gate-submit" class="btn-primary">Entrer</button>
      <div id="gate-error" class="gate-error"></div>
    </div>
  `;
  document.body.appendChild(overlay);   // ajouté par-dessus tout le reste (voir z-index en CSS)

  // Fonction appelée au clic sur "Entrer" ou à la touche Entrée.
  const submit = () => {
    const value = document.getElementById("gate-input").value;
    if(value === expectedPassphrase){    // comparaison stricte, en clair (voir limites en en-tête du fichier)
      overlay.remove();                  // retire l'écran de verrouillage du DOM
      onUnlock();                        // déclenche l'initialisation réelle de l'appli
    } else {
      document.getElementById("gate-error").textContent = "Phrase de passe incorrecte";
    }
  };

  document.getElementById("gate-submit").addEventListener("click", submit);   // clic sur le bouton
  document.getElementById("gate-input").addEventListener("keydown", (e) => {
    if(e.key === "Enter") submit();   // permet de valider avec la touche Entrée, sans souris
  });
}
