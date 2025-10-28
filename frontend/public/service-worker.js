const CACHE_VERSION = "v1.0.0";
const CACHE_PREFIX = "edh-podlog-";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./dashboard.html",
  "./decks.html",
  "./parties.html",
  "./groupes.html",
  "./synchronisation.html",
  "./profile.html",
  "./card.html",
  "./deck.html",
  "./styles.css",
  "./styles/tokens.css",
  "./styles/utilities.css",
  "./styles/base.css",
  "./styles/components.css",
  "./styles/views.css",
  "./styles/responsive.css",
  "./js/app-core.js",
  "./js/app-features.js",
  "./js/app-init.js",
  "./js/controllers/shared.js",
  "./js/controllers/dashboard.js",
  "./js/controllers/decks.js",
  "./js/controllers/synchronisation.js",
  "./js/controllers/deck-detail.js",
  "./js/controllers/card-detail.js",
  "./js/controllers/profile.js",
  "./js/controllers/landing.js",
  "./config.js",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./apple-touch-icon.png",
  "./assets/edh-podlog-icon.svg",
  "./assets/moxfield_logo.png"
];

const CORE_ASSET_SET = new Set(CORE_ASSETS);

const toRelativePath = (requestUrl) => {
  if (requestUrl.pathname === "/") {
    return "./";
  }
  return `.${requestUrl.pathname}`;
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch((error) => {
        console.warn("EDH PodLog SW install failed to cache assets:", error);
      })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

const cacheFirst = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
};

const networkThenCache = async (request) => {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === "navigate") {
      return cache.match("./index.html");
    }
    throw error;
  }
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  const relativePath = toRelativePath(requestUrl);
  if (request.mode === "navigate") {
    event.respondWith(networkThenCache(request));
    return;
  }

  if (CORE_ASSET_SET.has(relativePath)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkThenCache(request));
});
