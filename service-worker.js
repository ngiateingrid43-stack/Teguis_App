/**
 * service-worker.js
 * ---------------------------------------------------------
 * Met en cache uniquement l'"app shell" (HTML/CSS/JS/icônes) —
 * jamais les données MQTT, qui doivent toujours être en direct.
 * Ça permet à l'appli de s'ouvrir instantanément sur ton téléphone
 * ou ordinateur même avec une connexion internet capricieuse,
 * pendant que la connexion MQTT elle-même reste temps réel.
 * ---------------------------------------------------------
 */

const CACHE_NAME = "teguis-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/auth.js",
  "./js/commandParser.js",
  "./js/config.js",
  "./js/dashboard.js",
  "./js/mqttClient.js",
  "./js/settingsPanel.js",
  "./js/speech.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Ne jamais intercepter les CDN externes (MQTT.js, Chart.js) ni autre chose
  // que le même-origine : on veut seulement mettre en cache NOTRE app shell.
  if(event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ||
      fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => cached)
    )
  );
});
