/**
 * scenes.js
 * ---------------------------------------------------------
 * Affiche un bouton par scène personnalisée (CONFIG.scenes) —
 * cliquer dessus exécute toutes ses actions d'un coup, exactement
 * comme le ferait la phrase vocale associée (voir matchScene()
 * dans commandParser.js pour le déclenchement par la voix).
 * ---------------------------------------------------------
 */

// `onTrigger(scene)` est appelé par app.js pour exécuter réellement les
// actions de la scène (publication MQTT + mise à jour de l'UI).
export function renderScenes(scenes, onTrigger){
  const container = document.getElementById("scene-buttons");
  if(!container) return;
  container.innerHTML = "";

  if(!scenes || scenes.length === 0){
    container.innerHTML = `<p class="muted">Aucune scène configurée — ajoutes-en depuis ⚙ Réglages.</p>`;
    return;
  }

  scenes.forEach(scene => {
    const btn = document.createElement("button");
    btn.className = "scene-btn";
    btn.textContent = scene.nom;
    btn.addEventListener("click", () => onTrigger(scene));
    container.appendChild(btn);
  });
}
