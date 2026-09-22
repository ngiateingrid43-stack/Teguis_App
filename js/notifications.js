/**
 * notifications.js
 * ---------------------------------------------------------
 * Petites alertes visuelles temporaires ("toasts") affichées
 * en haut de l'écran — utilisées pour les évènements que
 * l'utilisateur doit remarquer même s'il ne regarde pas le
 * journal en bas de page : ouverture/fermeture du portail,
 * accès accordé/refusé sur une porte à double authentification.
 *
 * N'a aucun lien avec MQTT ou la logique métier — juste de
 * l'affichage, appelé depuis app.js.
 * ---------------------------------------------------------
 */

// Affiche un toast pendant quelques secondes puis le retire du DOM.
// `type` détermine la couleur : "success" (vert/sauge), "danger" (rouge), "info" (ambre, défaut).
export function showToast(message, type = "info"){
  const container = document.getElementById("toast-container");
  if(!container) return;   // le conteneur peut être absent sur une variante réduite de la page

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Force un reflow avant d'ajouter la classe "show" : nécessaire pour que la
  // transition CSS d'entrée (fondu + glissement) se joue réellement, plutôt
  // que d'apparaître instantanément sans animation.
  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    // On attend la fin de la transition de sortie avant de retirer l'élément du DOM.
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}
