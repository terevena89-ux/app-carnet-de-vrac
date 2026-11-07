// =========================================================
// Service worker : un petit « gardien » qui tourne en arrière-plan.
// Il garde une copie des fichiers de l'appli pour qu'elle s'ouvre
// même sans réseau. (Les données, elles, sont gérées par Firebase.)
// À CHAQUE NOUVELLE VERSION : changer le numéro ci-dessous.
// =========================================================
const CACHE = "etc-v0.1.0";

// Fichiers de l'appli à garder dès l'installation
const FICHIERS = [
  "./", "index.html", "style.css", "app.js", "excel-style.js", "firebase-config.js",
  "manifest.json", "icones/icone.svg", "icones/icone-192.png"
];

// IMPORTANT : GitHub autorise le téléphone à garder chaque fichier 10 minutes
// sans revérifier. On demande donc toujours au serveur (« reload » / « no-cache ») ;
// sinon on risquerait de ranger l'ancienne version sous l'étiquette de la nouvelle.
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FICHIERS.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

// Supprime les copies des anciennes versions
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(noms => Promise.all(noms.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Bibliothèques (Firebase, ExcelJS) : versions fixes, donc on peut garder la copie
  if (url.hostname === "www.gstatic.com" || url.hostname === "cdnjs.cloudflare.com") {
    e.respondWith(
      caches.match(req).then(copie => copie || fetch(req).then(rep => {
        const clone = rep.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
        return rep;
      }))
    );
    return;
  }

  // Fichiers de l'appli : réseau d'abord (pour avoir la dernière version), copie si pas de réseau.
  // « no-cache » = « vérifie auprès du serveur que c'est la dernière version ».
  if (url.origin === location.origin) {
    e.respondWith(
      // (on passe l'adresse req.url et pas req : le navigateur refuse de modifier une demande d'ouverture de page)
      fetch(req.url, { cache: "no-cache" }).then(rep => {
        const clone = rep.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
        return rep;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  }
  // Le reste (connexion Google, base de données) passe sans être touché.
});
