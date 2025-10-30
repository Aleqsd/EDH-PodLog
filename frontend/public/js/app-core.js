const runtimeConfig = window.EDH_PODLOG?.config ?? null;
const STORAGE_KEY = "edhPodlogSession";
const LAST_DECK_STORAGE_KEY = "edhPodlogLastDeckSelection";
const LAST_CARD_STORAGE_KEY = "edhPodlogLastCardSelection";
const DECK_EVALUATIONS_STORAGE_KEY = "edhPodlogDeckEvaluations";
const DECK_LAYOUT_STORAGE_KEY = "edhPodlogDeckDisplayMode";
let sessionStore = window.EDH_PODLOG?.session ?? null;

if (!sessionStore || typeof sessionStore.load !== "function") {
  const storage = typeof window !== "undefined" ? window.localStorage : null;
  const cloneValue = (value) => (value ? JSON.parse(JSON.stringify(value)) : value);
  const readFromStorage = () => {
    if (!storage) {
      return null;
    }
    try {
      const raw = storage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn("Impossible de charger la session depuis le stockage local :", error);
      return null;
    }
  };
  const writeToStorage = (value) => {
    if (!storage) {
      return;
    }
    try {
      if (value) {
        storage.setItem(STORAGE_KEY, JSON.stringify(value));
      } else {
        storage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Impossible d'enregistrer la session dans le stockage local :", error);
    }
  };

  let fallbackSession = readFromStorage();

  sessionStore = {
    load: () => cloneValue(fallbackSession ?? readFromStorage()),
    persist(session) {
      const cloned = cloneValue(session);
      fallbackSession = cloned;
      writeToStorage(cloned);
      return cloned;
    },
    clear() {
      fallbackSession = null;
      writeToStorage(null);
    },
    update(mutator) {
      const base = cloneValue(fallbackSession ?? readFromStorage());
      const draft = cloneValue(base) ?? {};
      const next = typeof mutator === "function" ? mutator(draft) : mutator;
      const resolved = next === undefined ? draft : next;
      return this.persist(resolved);
    },
    clone: cloneValue,
    getCurrent: () => cloneValue(fallbackSession ?? readFromStorage()),
    setCurrent(session) {
      const cloned = cloneValue(session);
      fallbackSession = cloned;
      writeToStorage(cloned);
      return cloned;
    },
    getActive: () => cloneValue(fallbackSession ?? readFromStorage()),
    deckPersonalizations: {
      bootstrapCache: () => {},
      ensureSynced: async () => {},
      get: () => null,
      set: async () => null,
      getEvaluation: () => null,
      setEvaluation: async () => null,
      exportForStorage: () => ({}),
    },
  };
  window.EDH_PODLOG = window.EDH_PODLOG || {};
  window.EDH_PODLOG.session = sessionStore;
}

const resolveSessionStore = () => {
  if (typeof window !== "undefined") {
    const globalStore = window.EDH_PODLOG?.session;
    if (globalStore && globalStore !== sessionStore) {
      sessionStore = globalStore;
    }
  }
  return sessionStore;
};

const bootstrapCurrentSession = () => {
  const store = resolveSessionStore();
  if (store?.getCurrent) {
    try {
      const latest = store.getCurrent();
      if (typeof latest !== "undefined") {
        return latest;
      }
    } catch (error) {
      console.warn("Impossible de récupérer la session active :", error);
    }
  }
  if (store?.load) {
    try {
      const loaded = store.load();
      if (typeof loaded !== "undefined") {
        return loaded;
      }
    } catch (error) {
      console.warn("Impossible de charger la session :", error);
    }
  }
  return null;
};

let currentSession = bootstrapCurrentSession();

const getSession = () => {
  const store = resolveSessionStore();
  if (store?.getCurrent) {
    try {
      const latest = store.getCurrent();
      if (typeof latest !== "undefined") {
        currentSession = latest;
        return latest;
      }
    } catch (error) {
      console.warn("Impossible de récupérer la session active :", error);
    }
  }
  if (store?.load) {
    try {
      const loaded = store.load();
      if (typeof loaded !== "undefined") {
        currentSession = loaded;
        return loaded;
      }
    } catch (error) {
      console.warn("Impossible de charger la session :", error);
    }
  }
  return currentSession ?? null;
};

const setCurrentSession = (session) => {
  const store = resolveSessionStore();
  if (store?.setCurrent) {
    try {
      store.setCurrent(session);
    } catch (error) {
      console.warn("Impossible de mettre à jour la session active :", error);
    }
  } else if (store?.persist) {
    try {
      store.persist(session);
    } catch (error) {
      console.warn("Impossible de persister la session :", error);
    }
  }
  currentSession = session ?? null;
  return currentSession;
};

const persistSession = (session) => {
  const store = resolveSessionStore();
  if (store?.persist) {
    try {
      const persisted = store.persist(session);
      currentSession = persisted ?? session ?? null;
      return persisted ?? session ?? null;
    } catch (error) {
      if (error?.code !== "STORAGE_QUOTA") {
        console.warn("Impossible d'enregistrer la session :", error);
      }
      currentSession = session ?? null;
      return session ?? null;
    }
  }
  return setCurrentSession(session);
};

const clearSession = () => {
  const store = resolveSessionStore();
  if (store?.clear) {
    try {
      store.clear();
    } catch (error) {
      console.warn("Impossible de nettoyer la session :", error);
    }
  }
  if (store?.setCurrent) {
    try {
      store.setCurrent(null);
    } catch (error) {
      console.warn("Impossible de réinitialiser la session active :", error);
    }
  }
  currentSession = null;
};

const updateSessionData = (mutator) => {
  const store = resolveSessionStore();
  const cloneSessionValue = (session) => {
    if (session === null || session === undefined) {
      return null;
    }
    if (store?.clone && typeof store.clone === "function") {
      try {
        return store.clone(session);
      } catch (error) {
        console.warn("Impossible de cloner la session :", error);
      }
    }
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(session);
      } catch {
        // ignore structuredClone failures, fallback to JSON strategy
      }
    }
    try {
      return JSON.parse(JSON.stringify(session));
    } catch {
      if (typeof session === "object" && session !== null) {
        return { ...session };
      }
      return session;
    }
  };

  const applyMutator = (session) => {
    const base = cloneSessionValue(session);
    if (base === null) {
      return session ?? null;
    }
    const result = typeof mutator === "function" ? mutator(base) : mutator;
    return result === undefined ? base : result;
  };

  if (store?.update) {
    try {
      const updated = store.update((session) => applyMutator(session));
      currentSession = updated ?? currentSession ?? null;
      return updated ?? null;
    } catch (error) {
      console.warn("Impossible de mettre à jour la session :", error);
    }
  }

  const current = getSession();
  if (current === null || current === undefined) {
    return null;
  }
  const resolved = applyMutator(current);
  return persistSession(resolved);
};

const deckPersonalizationsApi = sessionStore?.deckPersonalizations ?? {};
const apiClient = window.EDH_PODLOG?.api ?? {};

const buildBackendUrl = (path = "") => {
  if (apiClient && typeof apiClient.buildUrl === "function") {
    return apiClient.buildUrl(path);
  }

  const fallbackBase = (() => {
    if (runtimeConfig?.api?.baseUrl) {
      return runtimeConfig.api.baseUrl;
    }
    const rawBase = runtimeConfig?.raw?.API_BASE_URL ?? "http://localhost:4310";
    return rawBase.endsWith("/") ? rawBase.replace(/\/+$/, "") : rawBase;
  })();

  if (!path) {
    return fallbackBase;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${fallbackBase}${normalizedPath}`;
};

const resolveStoredDeckDisplayMode = () => {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const stored = localStorage.getItem(DECK_LAYOUT_STORAGE_KEY);
    if (stored === "bracket" || stored === "standard") {
      return stored;
    }
  } catch (error) {
    console.warn("Impossible de lire le mode d'affichage des decks sauvegardé :", error);
  }
  return null;
};

const persistDeckDisplayMode = (mode) => {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(DECK_LAYOUT_STORAGE_KEY, mode);
  } catch (error) {
    console.warn("Impossible d'enregistrer le mode d'affichage des decks :", error);
  }
};

const deckCollectionState = {
  displayMode: resolveStoredDeckDisplayMode() ?? "bracket",
  sort: "updated-desc",
  searchRaw: "",
  search: "",
  colors: new Set(),
  brackets: new Set(),
};

const deckComputedMetaCache = new WeakMap();

const DECK_COLOR_CODES = ["W", "U", "B", "R", "G", "C"];
const DECK_COLOR_CODE_SET = new Set(DECK_COLOR_CODES);
const BRACKET_NONE_KEY = "none";
const DECK_RATING_SORT_MAP = {
  "rating-stability": "stability",
  "rating-acceleration": "acceleration",
  "rating-interaction": "interaction",
  "rating-resilience": "resilience",
  "rating-finish": "finish",
  "rating-construction": "construction",
};
const DECK_SORT_KEYS = new Set([
  "updated-desc",
  "updated-asc",
  "created-desc",
  "created-asc",
  "alpha-asc",
  "alpha-desc",
  "color-identity",
  ...Object.keys(DECK_RATING_SORT_MAP),
]);
const BRACKET_KEYWORD_ENTRIES = [
  ["exhibition", "1"],
  ["core", "2"],
  ["focus", "3"],
  ["optimize", "4"],
  ["optimizee", "4"],
  ["optimise", "4"],
  ["optimisee", "4"],
  ["optimisé", "4"],
  ["optimisée", "4"],
  ["optimized", "4"],
  ["optimisé", "4"],
  ["optimisée", "4"],
  ["competitive", "5"],
  ["competitif", "5"],
  ["compétitif", "5"],
  ["compet", "5"],
];

const exportDeckPersonalizationsForStorage = () =>
  deckPersonalizationsApi.exportForStorage
    ? deckPersonalizationsApi.exportForStorage()
    : {};

const bootstrapDeckPersonalizationCache = (owner = null) => {
  if (deckPersonalizationsApi.bootstrapCache) {
    deckPersonalizationsApi.bootstrapCache(owner);
  }
};

const ensureDeckPersonalizationsSynced = async (session = null) => {
  if (!deckPersonalizationsApi.ensureSynced) {
    return;
  }
  await deckPersonalizationsApi.ensureSynced(session);
};

const getDeckPersonalization = (deckId) =>
  deckPersonalizationsApi.get ? deckPersonalizationsApi.get(deckId) : null;

const setDeckPersonalization = async (deckId, updates) => {
  if (!deckPersonalizationsApi.set) {
    return null;
  }
  return deckPersonalizationsApi.set(deckId, updates);
};

const getDeckEvaluation = (deckId) =>
  deckPersonalizationsApi.getEvaluation
    ? deckPersonalizationsApi.getEvaluation(deckId)
    : null;

const setDeckEvaluation = async (deckId, evaluation) => {
  if (!deckPersonalizationsApi.setEvaluation) {
    return null;
  }
  return deckPersonalizationsApi.setEvaluation(deckId, evaluation);
};

function fetchBackendProfile(googleSub) {
  if (apiClient.fetchBackendProfile) {
    return apiClient.fetchBackendProfile(googleSub);
  }
  const endpoint = googleSub ? buildBackendUrl(`/profiles/${encodeURIComponent(googleSub)}`) : null;
  if (!endpoint) {
    return Promise.resolve(null);
  }
  if (typeof fetch !== "function") {
    return Promise.resolve(null);
  }
  return fetch(endpoint, {
    headers: { Accept: "application/json" },
  }).then((response) => {
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Profil introuvable (${response.status})`);
    }
    return response.json();
  });
}

function upsertBackendProfile(googleSub, payload) {
  if (apiClient.upsertBackendProfile) {
    return apiClient.upsertBackendProfile(googleSub, payload);
  }
  const endpoint = googleSub ? buildBackendUrl(`/profiles/${encodeURIComponent(googleSub)}`) : null;
  if (!endpoint || !payload || typeof fetch !== "function") {
    return Promise.resolve(null);
  }
  return fetch(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Profil indisponible`);
    }
    return response.json();
  });
}

function fetchUserPlaygroups(googleSub) {
  if (apiClient.fetchUserPlaygroups) {
    return apiClient.fetchUserPlaygroups(googleSub);
  }
  return Promise.resolve({ playgroups: [] });
}

function fetchUserPlaygroupDetail(googleSub, playgroupId) {
  if (apiClient.fetchUserPlaygroupDetail) {
    return apiClient.fetchUserPlaygroupDetail(googleSub, playgroupId);
  }
  return Promise.resolve(null);
}

function upsertUserPlaygroup(googleSub, name) {
  if (apiClient.upsertUserPlaygroup) {
    return apiClient.upsertUserPlaygroup(googleSub, name);
  }
  return Promise.resolve(null);
}

function updateUserPlaygroup(googleSub, playgroupId, payload) {
  if (apiClient.updateUserPlaygroup) {
    return apiClient.updateUserPlaygroup(googleSub, playgroupId, payload);
  }
  return Promise.resolve(null);
}

function deleteUserPlaygroup(googleSub, playgroupId) {
  if (apiClient.deleteUserPlaygroup) {
    return apiClient.deleteUserPlaygroup(googleSub, playgroupId);
  }
  return Promise.resolve(false);
}

function fetchUserGames(googleSub, options) {
  if (apiClient.fetchUserGames) {
    return apiClient.fetchUserGames(googleSub, options);
  }
  return Promise.resolve({ games: [] });
}

function recordUserGame(googleSub, payload) {
  if (apiClient.recordUserGame) {
    return apiClient.recordUserGame(googleSub, payload);
  }
  return Promise.resolve(null);
}

function fetchAvailablePlayers(googleSub) {
  if (apiClient.fetchAvailablePlayers) {
    return apiClient.fetchAvailablePlayers(googleSub);
  }
  return Promise.resolve({ players: [] });
}

function fetchTrackedPlayers(googleSub) {
  if (apiClient.fetchTrackedPlayers) {
    return apiClient.fetchTrackedPlayers(googleSub);
  }
  return Promise.resolve({ players: [] });
}

function createTrackedPlayer(googleSub, name) {
  if (apiClient.createTrackedPlayer) {
    return apiClient.createTrackedPlayer(googleSub, name);
  }
  return Promise.resolve(null);
}

function updateTrackedPlayer(googleSub, playerId, payload) {
  if (apiClient.updateTrackedPlayer) {
    return apiClient.updateTrackedPlayer(googleSub, playerId, payload);
  }
  return Promise.resolve(null);
}

function deleteTrackedPlayer(googleSub, playerId) {
  if (apiClient.deleteTrackedPlayer) {
    return apiClient.deleteTrackedPlayer(googleSub, playerId);
  }
  return Promise.resolve(false);
}

function linkTrackedPlayer(googleSub, playerId, targetSub) {
  if (apiClient.linkTrackedPlayer) {
    return apiClient.linkTrackedPlayer(googleSub, playerId, targetSub);
  }
  return Promise.resolve(null);
}

function searchPublicUsers(params) {
  if (apiClient.searchPublicUsers) {
    return apiClient.searchPublicUsers(params);
  }
  return Promise.resolve([]);
}

function fetchPublicUserProfile(googleSub) {
  if (apiClient.fetchPublicUserProfile) {
    return apiClient.fetchPublicUserProfile(googleSub);
  }
  return Promise.resolve(null);
}

function followUserAccount(followerSub, targetSub) {
  if (apiClient.followUserAccount) {
    return apiClient.followUserAccount(followerSub, targetSub);
  }
  return Promise.resolve(false);
}

function unfollowUserAccount(followerSub, targetSub) {
  if (apiClient.unfollowUserAccount) {
    return apiClient.unfollowUserAccount(followerSub, targetSub);
  }
  return Promise.resolve(false);
}

const toISOStringIfValid = (value) => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

if (typeof buildProfileEndpoint === "undefined") {
const buildProfileEndpoint = (googleSub) => {
  if (apiClient.endpoints?.profile) {
    return apiClient.endpoints.profile(googleSub);
  }
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(`/profiles/${encodeURIComponent(googleSub)}`);
};
}

if (typeof buildPlaygroupsEndpoint === "undefined") {
const buildPlaygroupsEndpoint = (googleSub) => {
  if (apiClient.endpoints?.playgroups) {
    return apiClient.endpoints.playgroups(googleSub);
  }
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(
    `/profiles/${encodeURIComponent(googleSub)}/playgroups`
  );
};
}

if (typeof buildPlaygroupDetailEndpoint === "undefined") {
const buildPlaygroupDetailEndpoint = (googleSub, playgroupId) => {
  if (apiClient.endpoints?.playgroupDetail) {
    return apiClient.endpoints.playgroupDetail(googleSub, playgroupId);
  }
  if (!googleSub || !playgroupId) {
    return null;
  }
  return buildBackendUrl(
    `/profiles/${encodeURIComponent(googleSub)}/playgroups/${encodeURIComponent(playgroupId)}`
  );
};
}

if (typeof buildPlayersEndpoint === "undefined") {
const buildPlayersEndpoint = (googleSub) => {
  if (apiClient.endpoints?.players) {
    return apiClient.endpoints.players(googleSub);
  }
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(`/profiles/${encodeURIComponent(googleSub)}/players`);
};
}

if (typeof buildAvailablePlayersEndpoint === "undefined") {
const buildAvailablePlayersEndpoint = (googleSub) => {
  if (apiClient.endpoints?.availablePlayers) {
    return apiClient.endpoints.availablePlayers(googleSub);
  }
  const base = buildPlayersEndpoint(googleSub);
  if (!base) {
    return null;
  }
  return `${base}/available`;
};
}

if (typeof buildTrackedPlayerEndpoint === "undefined") {
const buildTrackedPlayerEndpoint = (googleSub, playerId) => {
  if (apiClient.endpoints?.trackedPlayer) {
    return apiClient.endpoints.trackedPlayer(googleSub, playerId);
  }
  if (!googleSub || !playerId) {
    return null;
  }
  return buildBackendUrl(
    `/profiles/${encodeURIComponent(googleSub)}/players/${encodeURIComponent(playerId)}`
  );
};
}

if (typeof buildTrackedPlayerLinkEndpoint === "undefined") {
const buildTrackedPlayerLinkEndpoint = (googleSub, playerId) => {
  if (apiClient.endpoints?.trackedPlayerLink) {
    return apiClient.endpoints.trackedPlayerLink(googleSub, playerId);
  }
  const base = buildTrackedPlayerEndpoint(googleSub, playerId);
  if (!base) {
    return null;
  }
  return `${base}/link`;
};
}

if (typeof buildGamesEndpoint === "undefined") {
const buildGamesEndpoint = (googleSub) => {
  if (apiClient.endpoints?.games) {
    return apiClient.endpoints.games(googleSub);
  }
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(`/profiles/${encodeURIComponent(googleSub)}/games`);
};
}

if (typeof buildSocialSearchEndpoint === "undefined") {
const buildSocialSearchEndpoint = () => {
  return apiClient.endpoints?.socialSearch
    ? apiClient.endpoints.socialSearch()
    : buildBackendUrl("/social/users/search");
};
}

if (typeof buildPublicProfileEndpoint === "undefined") {
const buildPublicProfileEndpoint = (googleSub) => {
  if (apiClient.endpoints?.publicProfile) {
    return apiClient.endpoints.publicProfile(googleSub);
  }
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(`/social/users/${encodeURIComponent(googleSub)}`);
};
}

if (typeof buildFollowEndpoint === "undefined") {
const buildFollowEndpoint = (followerSub) => {
  if (apiClient.endpoints?.follow) {
    return apiClient.endpoints.follow(followerSub);
  }
  if (!followerSub) {
    return null;
  }
  return buildBackendUrl(`/social/users/${encodeURIComponent(followerSub)}/follow`);
};
}


const convertDeckToProfilePayload = (deck) => {
  if (!deck || typeof deck !== "object") {
    return null;
  }

  const publicId = deck.publicId || deck.public_id || deck.id || deck.slug;
  if (!publicId) {
    return null;
  }

  const slug = deck.slug || publicId;
  const url =
    deck.url ||
    (slug ? `https://www.moxfield.com/decks/${slug}` : null);

  const updatedAtIso = toISOStringIfValid(deck.updatedAt || deck.updated_at);
  const syncedAtIso =
    toISOStringIfValid(deck.syncedAt || deck.synced_at) || updatedAtIso;

  return {
    public_id: publicId,
    name: deck.name || null,
    format: deck.format || null,
    slug: slug || null,
    url,
    card_count: typeof deck.cardCount === "number" ? deck.cardCount : null,
    updated_at: updatedAtIso,
    last_synced_at: syncedAtIso,
    source: deck.source || null,
  };
};

const convertProfileDeckToIntegration = (deck) => {
  if (!deck || typeof deck !== "object") {
    return null;
  }

  const publicId = deck.public_id || deck.publicId || deck.id || null;
  const slug = deck.slug || publicId;
  if (!publicId && !slug) {
    return null;
  }

  const url = deck.url || (slug ? `https://www.moxfield.com/decks/${slug}` : null);
  const updatedAt = deck.updated_at || deck.last_synced_at || null;

  return {
    id: slug || publicId,
    slug,
    name: deck.name || "Deck sans nom",
    format: deck.format || "—",
    updatedAt,
    cardCount: typeof deck.card_count === "number" ? deck.card_count : null,
    url,
    publicId: publicId || slug,
    source: deck.source || "saved",
    syncedAt: deck.last_synced_at || null,
  };
};

const applyProfileToSession = (session, profile) => {
  if (!session || !profile || typeof profile !== "object") {
    return session;
  }

  const next = {
    ...session,
  };

  if (Object.prototype.hasOwnProperty.call(profile, "given_name")) {
    const rawGivenName = profile.given_name;
    if (typeof rawGivenName === "string" && rawGivenName.trim().length > 0) {
      next.givenName = rawGivenName.trim();
    } else if (!next.givenName) {
      next.givenName = "";
    }
  }

  if (Object.prototype.hasOwnProperty.call(profile, "display_name")) {
    const rawDisplayName = profile.display_name;
    const trimmedDisplayName =
      typeof rawDisplayName === "string" ? rawDisplayName.trim() : "";
    next.profileDisplayName = trimmedDisplayName;

    const fallbackNameCandidates = [
      trimmedDisplayName,
      typeof next.givenName === "string" ? next.givenName : "",
      typeof session?.givenName === "string" ? session.givenName : "",
      typeof profile.email === "string" ? profile.email : "",
      typeof session?.userName === "string" ? session.userName : "",
    ];
    const resolvedName = fallbackNameCandidates.find(
      (value) => typeof value === "string" && value.trim().length > 0
    );

    if (resolvedName) {
      next.userName = resolvedName.trim();
      next.initials = computeInitials(next.userName);
    } else {
      next.userName = "";
      next.initials = "";
    }
  }

  if (Object.prototype.hasOwnProperty.call(profile, "email") && profile.email) {
    next.email = profile.email;
  }

  if (
    typeof session?.identityPicture === "string" &&
    session.identityPicture.length > 0 &&
    !next.identityPicture
  ) {
    next.identityPicture = session.identityPicture;
  }

  if (Object.prototype.hasOwnProperty.call(profile, "picture")) {
    const rawPicture = profile.picture;
    const hasPicture = typeof rawPicture === "string" && rawPicture.length > 0;
    const isDataUrl = hasPicture && rawPicture.startsWith("data:image/");

    if (hasPicture) {
      next.picture = rawPicture;
      if (!isDataUrl) {
        next.identityPicture = rawPicture;
      }
    } else {
      const identityFallback =
        typeof next.identityPicture === "string" && next.identityPicture.length > 0
          ? next.identityPicture
          : "";
      next.picture = identityFallback;
    }
  }

  if (Object.prototype.hasOwnProperty.call(profile, "description")) {
    const rawDescription = profile.description;
    next.profileDescription =
      typeof rawDescription === "string" && rawDescription.length > 0
        ? rawDescription
        : "";
  }

  if (Object.prototype.hasOwnProperty.call(profile, "is_public")) {
    next.profileIsPublic = Boolean(profile.is_public);
  }

  const existingIntegration = getMoxfieldIntegration(next) || {};

  const handleProvided = Object.prototype.hasOwnProperty.call(
    profile,
    "moxfield_handle"
  );
  const profileHandle =
    handleProvided && profile.moxfield_handle
      ? profile.moxfield_handle.trim()
      : null;

  const hasProfileDecks = Array.isArray(profile.moxfield_decks);
  const profileDecks = hasProfileDecks
    ? profile.moxfield_decks.map(convertProfileDeckToIntegration).filter(Boolean)
    : [];

  const integration = {
    ...existingIntegration,
  };

  if (handleProvided) {
    integration.handle = profileHandle || null;
    integration.handleLower = profileHandle ? profileHandle.toLowerCase() : null;
  } else if (integration.handle && typeof integration.handle === "string") {
    integration.handleLower = integration.handle.toLowerCase();
  }

  if (hasProfileDecks) {
    integration.decks = profileDecks;
    integration.deckCount = profileDecks.length;
    if (profileDecks.length > 0) {
      integration.totalDecks = Math.max(
        profileDecks.length,
        typeof existingIntegration.totalDecks === "number"
          ? existingIntegration.totalDecks
          : profileDecks.length
      );
    } else {
      integration.totalDecks = 0;
    }
  }

  next.integrations = {
    ...next.integrations,
    moxfield: integration,
  };

  return next;
};

const persistIntegrationToProfile = async (
  session,
  { decks, handleChanged = false } = {}
) => {
  if (!session?.googleSub) {
    return session;
  }

  const integration = getMoxfieldIntegration(session) || {};
  const payload = {};
  const hasHandleField =
    typeof integration.handle === "string" || handleChanged;

  if (hasHandleField) {
    payload.moxfield_handle =
      typeof integration.handle === "string" && integration.handle.trim().length > 0
        ? integration.handle.trim()
        : null;
  }

  const decksToPersist =
    decks !== undefined
      ? decks
      : Array.isArray(integration.decks)
      ? integration.decks
      : [];

  if (handleChanged || decks !== undefined) {
    payload.moxfield_decks = decksToPersist
      .map(convertDeckToProfilePayload)
      .filter(Boolean);
  }

  if (Object.keys(payload).length === 0) {
    return session;
  }

  try {
    const profile = await upsertBackendProfile(session.googleSub, payload);
    if (!profile) {
      return session;
    }
    const merged = applyProfileToSession(session, profile);
    persistSession(merged);
    return merged;
  } catch (error) {
    console.warn("Synchronisation du profil utilisateur impossible :", error);
    return session;
  }
};

const getQueryParams = () => {
  try {
    return new URLSearchParams(window.location.search);
  } catch (error) {
    return new URLSearchParams();
  }
};

const getQueryParam = (key) => getQueryParams().get(key);

const computeInitials = (value) => {
  if (!value) {
    return "";
  }

  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
};

const applyAvatarStyles = (element, session) => {
  if (!element || !session) {
    return;
  }

  const initials = session.initials ?? computeInitials(session.userName);
  const isDecorative = element.hasAttribute("aria-hidden");

  if (session.picture) {
    element.style.backgroundImage = `url('${session.picture}')`;
    element.style.backgroundSize = "cover";
    element.style.backgroundPosition = "center";
    element.style.backgroundColor = "#1b2540";
    element.textContent = "";
    if (isDecorative) {
      element.removeAttribute("aria-label");
    } else {
      element.setAttribute("aria-label", session.userName ?? "Profil");
    }
  } else {
    element.style.backgroundImage = "";
    element.style.backgroundColor = "";
    element.textContent = initials;
    if (isDecorative) {
      element.removeAttribute("aria-label");
    } else if (session.userName) {
      element.setAttribute("aria-label", session.userName);
    } else {
      element.removeAttribute("aria-label");
    }
  }
};

const updateProfileBadge = (session) => {
  const profileName = document.getElementById("profileName");
  const profileAvatar = document.getElementById("profileAvatar");

  if (profileName && session?.userName) {
    profileName.textContent = session.userName;
  }

  if (profileAvatar) {
    applyAvatarStyles(profileAvatar, session);
  }
};

const updateProfileDetails = (session) => {
  const fullNameEl = document.getElementById("profileFullName");
  const emailEl = document.getElementById("profileEmail");
  const emailDetailEl = document.getElementById("profileEmailDetail");
  const memberSinceEl = document.getElementById("profileMemberSince");
  const badgeLargeEl = document.getElementById("profileBadgeLarge");
  const bioEl = document.getElementById("profileBio");
  const avatarPreviewEl = document.getElementById("profileAvatarPreview");

  if (fullNameEl && session?.userName) {
    fullNameEl.textContent = session.userName;
  }

  if (emailEl && session?.email) {
    emailEl.textContent = session.email;
  }

  if (emailDetailEl && session?.email) {
    emailDetailEl.textContent = session.email;
  }

  if (badgeLargeEl) {
    applyAvatarStyles(badgeLargeEl, session);
  }

  if (avatarPreviewEl) {
    applyAvatarStyles(avatarPreviewEl, session);
  }

  if (memberSinceEl && session?.createdAt) {
    memberSinceEl.textContent = formatDateTime(session.createdAt, {
      dateStyle: "long",
    });
  }

  if (bioEl) {
    const description =
      typeof session?.profileDescription === "string" ? session.profileDescription.trim() : "";
    if (description) {
      bioEl.textContent = description;
      bioEl.hidden = false;
    } else {
      bioEl.textContent = "";
      bioEl.hidden = true;
    }
  }
};

const formatDateTime = (value, options = { dateStyle: "medium", timeStyle: "short" }) => {
  if (value === null || value === undefined) {
    return "";
  }

  const date =
    typeof value === "number"
      ? new Date(value)
      : value instanceof Date
      ? value
      : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("fr-FR", options);
  return formatter.format(date);
};

const getMoxfieldIntegration = (session) => session?.integrations?.moxfield ?? null;

const setMoxfieldIntegration = (updater) =>
  updateSessionData((session) => {
    const existing = session.integrations?.moxfield ?? {};
    const next =
      typeof updater === "function" ? updater({ ...existing }) : { ...existing, ...updater };

    const currentIntegrations = session.integrations ?? {};

    return {
      ...session,
      integrations: {
        ...currentIntegrations,
        moxfield: next,
      },
    };
  });

const showMoxfieldStatus = (message, variant = "neutral") => {
  if (!moxfieldStatusEl) {
    return;
  }

  moxfieldStatusEl.textContent = message ?? "";
  moxfieldStatusEl.classList.remove("is-error", "is-success");

  if (!message) {
    return;
  }

  if (variant === "error") {
    moxfieldStatusEl.classList.add("is-error");
  } else if (variant === "success") {
    moxfieldStatusEl.classList.add("is-success");
  }
};

const showDeckStatus = (message, variant = "neutral") => {
  if (!deckStatusEl) {
    showMoxfieldStatus(message, variant);
    return;
  }

  deckStatusEl.textContent = message ?? "";
  deckStatusEl.classList.remove("is-error", "is-success");

  if (!message) {
    return;
  }

  if (variant === "error") {
    deckStatusEl.classList.add("is-error");
  } else if (variant === "success") {
    deckStatusEl.classList.add("is-success");
  }
};


const getDeckIdentifier = (deck) =>
  deck?.publicId ?? deck?.public_id ?? deck?.slug ?? deck?.id ?? deck?.deckId ?? null;

const normalizeDeckIdentifierValue = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const collectDeckIdentifierCandidates = (deck) => {
  const candidates = [];
  const addCandidate = (value) => {
    const normalized = normalizeDeckIdentifierValue(value);
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  if (!deck || typeof deck !== "object") {
    return candidates;
  }

  addCandidate(deck.publicId);
  addCandidate(deck.public_id);
  addCandidate(deck.slug);
  addCandidate(deck.id);
  addCandidate(deck.deckId);
  addCandidate(deck?.raw?.public_id);
  addCandidate(deck?.raw?.publicId);
  addCandidate(deck?.raw?.slug);
  addCandidate(deck?.raw?.id);
  addCandidate(deck?.raw?.deckId);

  return candidates;
};

const deckMatchesIdentifier = (deck, identifier) => {
  const normalized = normalizeDeckIdentifierValue(identifier);
  if (!normalized) {
    return false;
  }
  return collectDeckIdentifierCandidates(deck).includes(normalized);
};

const findDeckInIntegration = (integration, deckId) => {
  if (!integration || !deckId) {
    return null;
  }
  return (
    integration.decks?.find((storedDeck) => deckMatchesIdentifier(storedDeck, deckId)) ?? null
  );
};

const deckHasCardDetails = (deck) =>
  Array.isArray(deck?.raw?.boards) &&
  deck.raw.boards.length > 0 &&
  deck.raw.boards.some((board) => Array.isArray(board?.cards) && board.cards.length > 0);

const replaceDeckInIntegration = (integration, updatedDeck) => {
  if (!integration || !updatedDeck) {
    return integration;
  }
  const targetId = getDeckIdentifier(updatedDeck);
  if (!targetId) {
    return integration;
  }

  const decks = Array.isArray(integration.decks) ? [...integration.decks] : [];
  const index = decks.findIndex((existing) => deckMatchesIdentifier(existing, targetId));
  if (index === -1) {
    decks.push(updatedDeck);
  } else {
    decks[index] = {
      ...decks[index],
      ...updatedDeck,
    };
  }

  return {
    ...integration,
    decks,
    deckCount: decks.length,
  };
};

const BOARD_LABELS = {
  commanders: "Commandants",
  mainboard: "Decklist",
  sideboard: "Réserve",
  maybeboard: "Peut-être",
  companions: "Compagnons",
  signature_spells: "Sorts de signature",
  contraptions: "Contraptions",
  stickers: "Autocollants",
  attractions: "Attractions",
  vanguard: "Vanguard",
};

const humanizeBoardName = (name) => {
  if (!name) {
    return "Section inconnue";
  }
  const lower = name.toLowerCase();
  if (BOARD_LABELS[lower]) {
    return BOARD_LABELS[lower];
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const extractManaSymbols = (manaCost) => {
  if (typeof manaCost !== "string" || manaCost.trim().length === 0) {
    return [];
  }
  const matches = manaCost.match(/\{([^}]+)\}/g);
  if (!matches) {
    return [];
  }
  return matches.map((token) => token.replace(/[{}]/g, "").trim()).filter(Boolean);
};

const describeManaSymbol = (symbol) => {
  if (!symbol) {
    return "";
  }

  const upper = symbol.toUpperCase();
  const isNumeric = /^\d+$/.test(upper);
  if (isNumeric) {
    return `Générique ${upper}`;
  }

  const COLOR_LABELS = {
    W: "Blanc",
    U: "Bleu",
    B: "Noir",
    R: "Rouge",
    G: "Vert",
    C: "Incolore",
    S: "Neige",
  };

  if (COLOR_LABELS[upper]) {
    return COLOR_LABELS[upper];
  }

  if (upper === "X" || upper === "Y" || upper === "Z") {
    return `Variable (${upper})`;
  }

  if (upper.includes("P")) {
    const withoutPhyrexian = upper.replace(/P/gi, "").split("/").filter(Boolean);
    if (withoutPhyrexian.length > 0) {
      return `Phyrexian ${withoutPhyrexian.join("/")}`;
    }
    return "Coût phyrexian";
  }

  if (upper.includes("/")) {
    return `Hybride ${upper}`;
  }

  if (upper === "T") {
    return "Engager";
  }

  return upper;
};

const summariseManaCost = (manaCost) => {
  const symbols = extractManaSymbols(manaCost);
  if (symbols.length === 0) {
    return [];
  }
  const counts = new Map();
  symbols.forEach((symbol) => {
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  });
  return Array.from(counts.entries()).map(([symbol, count]) => ({
    symbol,
    description: describeManaSymbol(symbol),
    count,
  }));
};

const normalizeText = (value) => {
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  } catch (error) {
    return String(value).toLowerCase();
  }
};

const parseDeckTimestamp = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (value > 1e12) {
      return value;
    }
    if (value > 1e9) {
      return Math.round(value * 1000);
    }
    if (value > 1e5) {
      return Math.round(value * 1000);
    }
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return parseDeckTimestamp(numeric);
    }
    const date = new Date(trimmed);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "object" && value !== null && typeof value.$date !== "undefined") {
    return parseDeckTimestamp(value.$date);
  }
  return null;
};

const getDeckUpdatedTimestamp = (deck) => {
  if (!deck || typeof deck !== "object") {
    return 0;
  }
  const candidates = [
    deck.updatedAt,
    deck.updated_at,
    deck.modifiedAt,
    deck.modified_at,
    deck.raw?.updatedAt,
    deck.raw?.updated_at,
    deck.raw?.updatedAtUtc,
    deck.raw?.updated_at_utc,
    deck.raw?.updatedOn,
    deck.raw?.updated_on,
    deck.raw?.modifiedOn,
    deck.raw?.modified_on,
    deck.raw?.lastUpdated,
    deck.raw?.last_updated,
  ];
  for (const candidate of candidates) {
    const parsed = parseDeckTimestamp(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  const fallback = parseDeckTimestamp(deck.createdAt ?? deck.created_at ?? deck.raw?.createdAt);
  return fallback ?? 0;
};

const getDeckCreationTimestamp = (deck) => {
  if (!deck || typeof deck !== "object") {
    return 0;
  }
  const candidates = [
    deck.createdAt,
    deck.created_at,
    deck.raw?.createdAt,
    deck.raw?.created_at,
    deck.raw?.createdAtUtc,
    deck.raw?.created_at_utc,
    deck.raw?.createdOn,
    deck.raw?.created_on,
    deck.raw?.dateCreated,
    deck.raw?.date_created,
    deck.raw?.publishedAt,
    deck.raw?.published_at,
    deck.raw?.metadata?.created_at,
  ];
  for (const candidate of candidates) {
    const parsed = parseDeckTimestamp(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return getDeckUpdatedTimestamp(deck);
};

const buildDeckColorSortKey = (colors) => {
  if (!Array.isArray(colors) || colors.length === 0) {
    return "Z";
  }
  const indices = colors
    .map((color) => DECK_COLOR_CODES.indexOf(color))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  if (indices.length === 0) {
    return "Z";
  }
  return `${indices.length}-${indices.join("")}`;
};

const isCommanderBoardName = (name) => {
  const normalized = normalizeText(name);
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("commander") ||
    normalized.includes("commandant") ||
    normalized.includes("companion") ||
    normalized.includes("compagnon") ||
    normalized.includes("partner")
  );
};

const resolveDeckColorIdentity = (deck) => {
  const colors = new Set();
  const commanderColors = new Set();
  let sawAnyColorless = false;
  let sawCommanderColorless = false;

  const addColorToken = (token, isCommander) => {
    if (token === null || token === undefined) {
      return;
    }
    const str = String(token).trim().toUpperCase();
    if (!str) {
      return;
    }
    for (const char of str) {
      if (!DECK_COLOR_CODE_SET.has(char)) {
        continue;
      }
      colors.add(char);
      if (isCommander) {
        commanderColors.add(char);
      }
    }
  };

  const markColorless = (isCommander) => {
    sawAnyColorless = true;
    if (isCommander) {
      sawCommanderColorless = true;
    }
  };

  const processColorSource = (value, { isCommander = false } = {}) => {
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        markColorless(isCommander);
      }
      value.forEach((entry) => processColorSource(entry, { isCommander }));
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      const matches = trimmed.match(/[WUBRGC]/gi);
      if (matches && matches.length > 0) {
        matches.forEach((match) => addColorToken(match, isCommander));
        return;
      }
      const normalized = normalizeText(trimmed);
      if (
        normalized.includes("colorless") ||
        normalized.includes("incolore") ||
        normalized.includes("sans couleur")
      ) {
        markColorless(isCommander);
      }
      return;
    }
    if (typeof value === "object") {
      const nestedCandidates = [
        value.colorIdentity,
        value.color_identity,
        value.colour_identity,
        value.colors,
        value.identity,
        value.primaryColors,
        value.primary_colors,
        value.card?.colorIdentity,
        value.card?.color_identity,
        value.card?.colour_identity,
        value.card?.colors,
      ];
      nestedCandidates.forEach((candidate) => processColorSource(candidate, { isCommander }));

      if (Array.isArray(value.commanders)) {
        value.commanders.forEach((entry) => processColorSource(entry, { isCommander: true }));
      }
      if (value.commander) {
        processColorSource(value.commander, { isCommander: true });
      }
      if (Array.isArray(value.cards)) {
        value.cards.forEach((entry) => processColorSource(entry, { isCommander }));
      }
      if (value.card) {
        processColorSource(value.card, { isCommander });
      }
    }
  };

  const processSources = (sources, isCommander = false) => {
    sources.forEach((source) => processColorSource(source, { isCommander }));
  };

  processSources(
    [
      deck?.raw?.commander,
      deck?.raw?.commanders,
      deck?.raw?.primaryCommander,
      deck?.raw?.secondaryCommander,
      deck?.raw?.podlog?.commander,
      deck?.raw?.podlog?.commanders,
      deck?.raw?.profile?.commander,
      deck?.raw?.profile?.commanders,
    ],
    true,
  );

  processSources(
    [
      deck?.colorIdentity,
      deck?.color_identity,
      deck?.colour_identity,
      deck?.colors,
      deck?.identity,
      deck?.raw?.colorIdentity,
      deck?.raw?.color_identity,
      deck?.raw?.colour_identity,
      deck?.raw?.colors,
      deck?.raw?.metadata?.colorIdentity,
      deck?.raw?.metadata?.color_identity,
      deck?.raw?.podlog?.colorIdentity,
      deck?.raw?.podlog?.color_identity,
      deck?.raw?.profile?.colorIdentity,
      deck?.raw?.profile?.color_identity,
    ],
  );

  const processBoards = (boards) => {
    if (!Array.isArray(boards)) {
      return;
    }
    boards.forEach((board) => {
      if (!board) {
        return;
      }
      const isCommanderBoard = isCommanderBoardName(board?.name);
      const entries = Array.isArray(board?.cards)
        ? board.cards
        : board?.cards && typeof board.cards === "object"
        ? Object.values(board.cards)
        : [];
      entries.forEach((entry) => {
        const cardData = entry?.card ?? entry;
        processColorSource(cardData, { isCommander: isCommanderBoard });
      });
    });
  };

  if (typeof collectDeckBoards === "function") {
    try {
      const boards = collectDeckBoards(deck);
      processBoards(boards);
    } catch (error) {
      console.warn("Impossible d'extraire les couleurs du deck :", error);
    }
  } else if (Array.isArray(deck?.raw?.boards)) {
    processBoards(deck.raw.boards);
  }

  const toOrderedArray = (set) => {
    const ordered = Array.from(set).filter((color) => DECK_COLOR_CODE_SET.has(color));
    ordered.sort((a, b) => DECK_COLOR_CODES.indexOf(a) - DECK_COLOR_CODES.indexOf(b));
    return ordered;
  };

  const commanderOrdered = toOrderedArray(commanderColors);
  if (commanderOrdered.length > 0) {
    return commanderOrdered;
  }
  if (sawCommanderColorless) {
    return ["C"];
  }

  const generalOrdered = toOrderedArray(colors);
  if (generalOrdered.length > 0) {
    return generalOrdered;
  }
  if (sawAnyColorless) {
    return ["C"];
  }
  return [];
};

const collectDeckCardNames = (deck) => {
  const names = new Set();
  const addName = (name) => {
    if (typeof name !== "string") {
      return;
    }
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      names.add(trimmed);
    }
  };

  if (typeof collectDeckBoards === "function") {
    try {
      const boards = collectDeckBoards(deck);
      boards.forEach((board) => {
        if (!Array.isArray(board?.cards)) {
          return;
        }
        board.cards.forEach((entry) => {
          if (!entry) {
            return;
          }
          if (entry.card) {
            const cardData = entry.card.card ?? entry.card;
            addName(cardData?.name);
          }
          addName(entry?.card?.name);
          addName(entry?.name);
        });
      });
    } catch (error) {
      console.warn("Impossible d'extraire la liste des cartes du deck :", error);
    }
  }

  if (names.size === 0 && Array.isArray(deck?.raw?.cards)) {
    deck.raw.cards.forEach((card) => {
      if (!card) {
        return;
      }
      addName(card?.name ?? card?.card?.name);
    });
  }

  if (
    names.size === 0 &&
    deck?.raw?.cardlist &&
    typeof deck.raw.cardlist === "object" &&
    !Array.isArray(deck.raw.cardlist)
  ) {
    Object.values(deck.raw.cardlist).forEach((entry) => {
      addName(entry?.name ?? entry?.card?.name);
    });
  }

  return Array.from(names);
};

const collectCommanderNames = (deck) => {
  const names = new Set();
  const addName = (name) => {
    if (typeof name !== "string") {
      return;
    }
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      names.add(trimmed);
    }
  };

  const processCommanderSource = (value) => {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(processCommanderSource);
      return;
    }
    if (typeof value === "string") {
      addName(value);
      return;
    }
    if (typeof value === "object") {
      addName(value.name ?? value.cardName ?? value.card?.name);
      if (Array.isArray(value.cards)) {
        value.cards.forEach(processCommanderSource);
      }
      if (value.card) {
        addName(value.card?.name);
      }
    }
  };

  [
    deck?.raw?.commander,
    deck?.raw?.commanders,
    deck?.raw?.primaryCommander,
    deck?.raw?.secondaryCommander,
    deck?.raw?.podlog?.commander,
    deck?.raw?.podlog?.commanders,
    deck?.raw?.profile?.commander,
  ].forEach(processCommanderSource);

  const processCommanderBoard = (boards) => {
    if (!Array.isArray(boards)) {
      return;
    }
    boards.forEach((board) => {
      if (!board || !isCommanderBoardName(board?.name) || !Array.isArray(board?.cards)) {
        return;
      }
      board.cards.forEach((entry) => {
        if (!entry) {
          return;
        }
        const cardData = entry.card?.card ?? entry.card ?? entry;
        processCommanderSource(cardData);
      });
    });
  };

  if (typeof collectDeckBoards === "function") {
    try {
      processCommanderBoard(collectDeckBoards(deck));
    } catch (error) {
      console.warn("Impossible d'extraire les commandants du deck :", error);
    }
  } else if (Array.isArray(deck?.raw?.boards)) {
    processCommanderBoard(deck.raw.boards);
  } else if (deck?.raw?.boards && typeof deck.raw.boards === "object") {
    processCommanderBoard(Object.values(deck.raw.boards));
  }

  return Array.from(names);
};

const computeDeckMeta = (deck) => {
  const normalizedName = normalizeText(deck?.name ?? "");
  const normalizedSlug = normalizeText(deck?.slug ?? "");
  const cardNames = collectDeckCardNames(deck).map((name) => normalizeText(name)).filter(Boolean);
  const commanderNames = collectCommanderNames(deck)
    .map((name) => normalizeText(name))
    .filter(Boolean);
  const colors = resolveDeckColorIdentity(deck);
  return {
    normalizedName,
    normalizedSlug,
    cardNames,
    commanderNames,
    colors,
    colorKey: buildDeckColorSortKey(colors),
  };
};

const getDeckComputedMeta = (deck) => {
  if (!deck || typeof deck !== "object") {
    return computeDeckMeta({});
  }
  const cached = deckComputedMetaCache.get(deck);
  if (cached) {
    return cached;
  }
  const meta = computeDeckMeta(deck);
  deckComputedMetaCache.set(deck, meta);
  return meta;
};

const getDeckRatingValue = (deck, key) => {
  if (!key || typeof getDeckEvaluation !== "function") {
    return 0;
  }
  const deckId = getDeckIdentifier(deck);
  if (!deckId) {
    return 0;
  }
  const evaluation = getDeckEvaluation(deckId);
  if (!evaluation || typeof evaluation !== "object") {
    return 0;
  }
  const value = evaluation[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const normalizeBracketId = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  if (/^[1-5]$/.test(raw)) {
    return raw;
  }
  const digitMatch = raw.match(/[1-5]/);
  if (digitMatch) {
    return digitMatch[0];
  }
  const normalized = normalizeText(raw);
  if (!normalized) {
    return null;
  }
  for (const [keyword, id] of BRACKET_KEYWORD_ENTRIES) {
    if (normalized.includes(keyword)) {
      return id;
    }
  }
  if (typeof DECK_BRACKET_LEVELS !== "undefined" && Array.isArray(DECK_BRACKET_LEVELS)) {
    for (const level of DECK_BRACKET_LEVELS) {
      const labelNormalized = normalizeText(level?.label ?? "");
      if (!labelNormalized) {
        continue;
      }
      if (labelNormalized.includes(normalized) || normalized.includes(labelNormalized)) {
        return level.id ?? null;
      }
    }
  }
  return null;
};

const resolveDeckBracketGroup = (deck) => {
  const fallback = { id: BRACKET_NONE_KEY, label: "Sans bracket" };
  if (!deck || typeof deck !== "object") {
    return fallback;
  }
  let bracketValue = null;
  const deckId = getDeckIdentifier(deck);
  if (deckId && typeof getDeckPersonalization === "function") {
    const personalization = getDeckPersonalization(deckId);
    if (personalization?.bracket) {
      bracketValue = personalization.bracket;
    }
  }
  if (!bracketValue && typeof extractDeckBracket === "function") {
    const extracted = extractDeckBracket(deck);
    if (extracted?.bracket) {
      bracketValue = extracted.bracket;
    }
  }
  const normalized = normalizeBracketId(bracketValue);
  if (!normalized) {
    return fallback;
  }
  let label = null;
  if (typeof findDeckBracketDefinition === "function") {
    const definition = findDeckBracketDefinition(normalized);
    if (definition?.label) {
      label = definition.label;
    }
  }
  if (!label && typeof DECK_BRACKET_LEVELS !== "undefined" && Array.isArray(DECK_BRACKET_LEVELS)) {
    const match = DECK_BRACKET_LEVELS.find((level) => level.id === normalized);
    if (match?.label) {
      label = match.label;
    }
  }
  if (!label) {
    label = `Bracket ${normalized}`;
  }
  return { id: normalized, label };
};

const doesDeckMatchSearch = (deck, normalizedQuery) => {
  if (!normalizedQuery) {
    return true;
  }
  const meta = getDeckComputedMeta(deck);
  if (meta.normalizedName && meta.normalizedName.includes(normalizedQuery)) {
    return true;
  }
  if (meta.normalizedSlug && meta.normalizedSlug.includes(normalizedQuery)) {
    return true;
  }
  if (meta.commanderNames.some((name) => name.includes(normalizedQuery))) {
    return true;
  }
  if (meta.cardNames.some((name) => name.includes(normalizedQuery))) {
    return true;
  }
  return false;
};

const doesDeckMatchColorFilters = (deck, selectedColors) => {
  if (!selectedColors || selectedColors.size === 0) {
    return true;
  }
  const meta = getDeckComputedMeta(deck);
  if (!Array.isArray(meta.colors) || meta.colors.length === 0) {
    return false;
  }
  const colorSet = new Set(meta.colors);
  for (const color of selectedColors) {
    if (!DECK_COLOR_CODE_SET.has(color)) {
      continue;
    }
    if (!colorSet.has(color)) {
      return false;
    }
  }
  return true;
};

const doesDeckMatchBracketFilters = (deck, selectedBrackets) => {
  if (!selectedBrackets || selectedBrackets.size === 0) {
    return true;
  }
  const group = resolveDeckBracketGroup(deck);
  const bracketId = group.id ?? BRACKET_NONE_KEY;
  if (!bracketId || bracketId === BRACKET_NONE_KEY) {
    return selectedBrackets.has(BRACKET_NONE_KEY);
  }
  return selectedBrackets.has(bracketId);
};

const compareDeckNames = (a, b) => {
  const metaA = getDeckComputedMeta(a);
  const metaB = getDeckComputedMeta(b);
  const nameA = metaA.normalizedName || normalizeText(a?.name ?? "");
  const nameB = metaB.normalizedName || normalizeText(b?.name ?? "");
  const byName = nameA.localeCompare(nameB);
  if (byName !== 0) {
    return byName;
  }
  return (getDeckIdentifier(a) ?? "").localeCompare(getDeckIdentifier(b) ?? "");
};

const compareDecks = (a, b, sortKey = "updated-desc") => {
  switch (sortKey) {
    case "alpha-asc":
      return compareDeckNames(a, b);
    case "alpha-desc":
      return compareDeckNames(b, a);
    case "updated-asc": {
      const delta = getDeckUpdatedTimestamp(a) - getDeckUpdatedTimestamp(b);
      if (delta !== 0) {
        return delta;
      }
      return compareDeckNames(a, b);
    }
    case "updated-desc": {
      const delta = getDeckUpdatedTimestamp(b) - getDeckUpdatedTimestamp(a);
      if (delta !== 0) {
        return delta;
      }
      return compareDeckNames(a, b);
    }
    case "created-asc": {
      const delta = getDeckCreationTimestamp(a) - getDeckCreationTimestamp(b);
      if (delta !== 0) {
        return delta;
      }
      return compareDeckNames(a, b);
    }
    case "created-desc": {
      const delta = getDeckCreationTimestamp(b) - getDeckCreationTimestamp(a);
      if (delta !== 0) {
        return delta;
      }
      return compareDeckNames(a, b);
    }
    case "color-identity": {
      const metaA = getDeckComputedMeta(a);
      const metaB = getDeckComputedMeta(b);
      if (metaA.colorKey === metaB.colorKey) {
        return compareDeckNames(a, b);
      }
      return metaA.colorKey.localeCompare(metaB.colorKey);
    }
    default: {
      const ratingKey = DECK_RATING_SORT_MAP[sortKey];
      if (!ratingKey) {
        const delta = getDeckUpdatedTimestamp(b) - getDeckUpdatedTimestamp(a);
        if (delta !== 0) {
          return delta;
        }
        return compareDeckNames(a, b);
      }
      const ratingDelta = getDeckRatingValue(b, ratingKey) - getDeckRatingValue(a, ratingKey);
      if (ratingDelta !== 0) {
        return ratingDelta;
      }
      return compareDeckNames(a, b);
    }
  }
};

const applyDeckCollectionTransforms = (decks) => {
  if (!Array.isArray(decks)) {
    return [];
  }
  const normalizedQuery = deckCollectionState.search;
  const hasSearch = Boolean(normalizedQuery);
  const hasColorFilters = deckCollectionState.colors.size > 0;
  const hasBracketFilters = deckCollectionState.brackets.size > 0;

  const filtered = decks.filter((deck) => {
    if (hasSearch && !doesDeckMatchSearch(deck, normalizedQuery)) {
      return false;
    }
    if (hasColorFilters && !doesDeckMatchColorFilters(deck, deckCollectionState.colors)) {
      return false;
    }
    if (hasBracketFilters && !doesDeckMatchBracketFilters(deck, deckCollectionState.brackets)) {
      return false;
    }
    return true;
  });

  const sortKey = deckCollectionState.sort;
  filtered.sort((a, b) => compareDecks(a, b, sortKey));
  return filtered;
};

const formatDeckCountLabel = (count) => `${count} deck${count > 1 ? "s" : ""}`;

const getDeckCollectionState = () => ({
  displayMode: deckCollectionState.displayMode,
  sort: deckCollectionState.sort,
  search: deckCollectionState.searchRaw,
  colorFilters: Array.from(deckCollectionState.colors),
  bracketFilters: Array.from(deckCollectionState.brackets),
});

const setDeckCollectionDisplayMode = (mode) => {
  const normalized = mode === "bracket" ? "bracket" : "standard";
  if (deckCollectionState.displayMode === normalized) {
    return deckCollectionState.displayMode;
  }
  deckCollectionState.displayMode = normalized;
  if (deckCollectionEl) {
    deckCollectionEl.dataset.mode = normalized;
  }
  persistDeckDisplayMode(normalized);
  return deckCollectionState.displayMode;
};

const setDeckCollectionSortMode = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const resolved = DECK_SORT_KEYS.has(trimmed) ? trimmed : "updated-desc";
  deckCollectionState.sort = resolved;
  return resolved;
};

const setDeckCollectionSearchQuery = (value) => {
  const raw = typeof value === "string" ? value : "";
  deckCollectionState.searchRaw = raw;
  deckCollectionState.search = normalizeText(raw);
  return deckCollectionState.search;
};

const setDeckCollectionColorFilters = (values) => {
  const next = new Set();
  if (Array.isArray(values)) {
    values.forEach((value) => {
      const normalized = String(value ?? "")
        .trim()
        .toUpperCase();
      if (DECK_COLOR_CODE_SET.has(normalized)) {
        next.add(normalized);
      }
    });
  }
  deckCollectionState.colors = next;
  return next;
};

const setDeckCollectionBracketFilters = (values) => {
  const next = new Set();
  if (Array.isArray(values)) {
    values.forEach((value) => {
      const normalized = normalizeText(value);
      if (!normalized) {
        return;
      }
      if (
        normalized === "none" ||
        normalized.includes("sans") ||
        normalized.includes("aucun")
      ) {
        next.add(BRACKET_NONE_KEY);
        return;
      }
      const bracketId = normalizeBracketId(value);
      if (bracketId) {
        next.add(bracketId);
      }
    });
  }
  deckCollectionState.brackets = next;
  return next;
};

const resetDeckCollectionFilters = () => {
  deckCollectionState.colors = new Set();
  deckCollectionState.brackets = new Set();
  deckCollectionState.search = "";
  deckCollectionState.searchRaw = "";
  return getDeckCollectionState();
};

const createDeckCardElement = (deck) => {
  const card = document.createElement("article");
  card.className = "deck-card";
  const deckId = getDeckIdentifier(deck);
  if (deckId) {
    card.dataset.deckId = deckId;
  }

  const header = document.createElement("div");
  header.className = "deck-card-header";

  const title = document.createElement("h4");
  title.className = "deck-card-title";
  title.textContent = deck?.name || "Deck sans nom";

  const formatBadge = document.createElement("span");
  formatBadge.className = "deck-card-format";
  formatBadge.textContent = deck?.format ? deck.format.toUpperCase() : "FORMAT ?";

  header.append(title, formatBadge);

  const metaLine = document.createElement("div");
  metaLine.className = "deck-card-updated";
  const metaParts = [];

  if (typeof deck?.cardCount === "number" && deck.cardCount > 0) {
    metaParts.push(`${deck.cardCount} cartes`);
  }

  if (deck?.updatedAt) {
    metaParts.push(
      `Mis à jour le ${formatDateTime(deck.updatedAt, { dateStyle: "medium" })}`
    );
  }

  metaLine.textContent = metaParts.join(" · ") || "Informations indisponibles";

  const link = document.createElement("a");
  link.className = "deck-card-link";
  if (deck?.url) {
    link.href = deck.url;
  } else if (deck?.slug) {
    link.href = `https://www.moxfield.com/decks/${deck.slug}`;
  } else if (deck?.id) {
    link.href = `https://www.moxfield.com/decks/${deck.id}`;
  } else {
    link.removeAttribute("href");
  }
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Voir sur Moxfield";

  const actions = document.createElement("div");
  actions.className = "deck-card-actions";

  if (deckId) {
    const detailLink = document.createElement("a");
    detailLink.className = "deck-card-action primary";
    detailLink.href = `deck.html?deck=${encodeURIComponent(deckId)}`;
    detailLink.textContent = "Voir le deck";
    detailLink.addEventListener("click", () => {
      const currentIntegration = getMoxfieldIntegration(getSession());
      const handle = currentIntegration?.handle || currentIntegration?.handleLower || null;
      try {
        const snapshot = createDeckSnapshot(deck, { handle }) ?? { deckId, handle };
        window.sessionStorage.setItem(LAST_DECK_STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        console.warn("Impossible d'enregistrer la sélection du deck :", error);
      }
    });
    actions.appendChild(detailLink);
  }

  if (deckId) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "deck-card-action destructive";
    deleteBtn.textContent = "Supprimer";
    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleDeckRemoval(deckId, deck?.name);
    });
    actions.appendChild(deleteBtn);
  }

  if (actions.children.length > 0) {
    card.append(header, metaLine, link, actions);
  } else {
    card.append(header, metaLine, link);
  }
  return card;
};

const renderDeckCardsInto = (target, decks) => {
  if (!target) {
    return false;
  }

  target.innerHTML = "";
  target.dataset.mode = deckCollectionState.displayMode;

  if (!Array.isArray(decks) || decks.length === 0) {
    return false;
  }

  if (deckCollectionState.displayMode === "bracket") {
    const groups = new Map();
    const labels = new Map();

    decks.forEach((deck) => {
      const group = resolveDeckBracketGroup(deck);
      const groupId = group?.id ?? BRACKET_NONE_KEY;
      const label = group?.label ?? (groupId === BRACKET_NONE_KEY ? "Sans bracket" : `Bracket ${groupId}`);
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
        labels.set(groupId, label);
      }
      groups.get(groupId).push(deck);
    });

    const orderedIds = [];
    if (typeof DECK_BRACKET_LEVELS !== "undefined" && Array.isArray(DECK_BRACKET_LEVELS)) {
      DECK_BRACKET_LEVELS.forEach((level) => {
        if (groups.has(level.id)) {
          orderedIds.push(level.id);
        }
      });
    }

    groups.forEach((_, id) => {
      if (id !== BRACKET_NONE_KEY && !orderedIds.includes(id)) {
        orderedIds.push(id);
      }
    });

    if (groups.has(BRACKET_NONE_KEY)) {
      orderedIds.push(BRACKET_NONE_KEY);
    }

    orderedIds.forEach((id) => {
      const groupDecks = groups.get(id);
      if (!Array.isArray(groupDecks) || groupDecks.length === 0) {
        return;
      }
      const section = document.createElement("section");
      section.className = "deck-bracket-group";
      section.dataset.bracket = id ?? BRACKET_NONE_KEY;

      const header = document.createElement("header");
      header.className = "deck-bracket-header";

      const title = document.createElement("h3");
      title.className = "deck-bracket-title";
      title.textContent =
        labels.get(id) ?? (id === BRACKET_NONE_KEY ? "Sans bracket" : `Bracket ${id}`);

      const count = document.createElement("span");
      count.className = "deck-bracket-count";
      count.textContent = formatDeckCountLabel(groupDecks.length);

      header.append(title, count);

      const grid = document.createElement("div");
      grid.className = "deck-grid";
      groupDecks.forEach((deck) => {
        grid.appendChild(createDeckCardElement(deck));
      });

      section.append(header, grid);
      target.appendChild(section);
    });

    return target.children.length > 0;
  }

  const grid = document.createElement("div");
  grid.className = "deck-grid";
  decks.forEach((deck) => {
    grid.appendChild(createDeckCardElement(deck));
  });
  target.appendChild(grid);
  return true;
};

const updateMoxfieldDeckSummary = (session) => {
  if (!moxfieldDeckSummaryEl || !moxfieldDeckSummaryText) {
    return;
  }

  const integration = getMoxfieldIntegration(session);
  const decks = Array.isArray(integration?.decks) ? integration.decks : [];
  const deckCount = decks.length;
  const totalDecks =
    typeof integration?.totalDecks === "number" && integration.totalDecks >= deckCount
      ? integration.totalDecks
      : deckCount;

  if (deckCount === 0) {
    moxfieldDeckSummaryText.textContent = "Aucun deck synchronisé pour le moment.";
    if (moxfieldDeckSummaryAction) {
      moxfieldDeckSummaryAction.hidden = true;
    }
    return;
  }

  const descriptor = deckCount > 1 ? "decks" : "deck";
  const pluralSuffix = deckCount > 1 ? "s" : "";
  if (totalDecks > deckCount) {
    moxfieldDeckSummaryText.textContent = `${deckCount} ${descriptor} importé${pluralSuffix} sur ${totalDecks}. Gérez vos listes depuis l'espace Decks.`;
  } else {
    moxfieldDeckSummaryText.textContent = `${deckCount} ${descriptor} importé${pluralSuffix}. Gérez vos listes depuis l'espace Decks.`;
  }

  if (moxfieldDeckSummaryAction) {
    moxfieldDeckSummaryAction.hidden = false;
    moxfieldDeckSummaryAction.setAttribute(
      "aria-label",
      deckCount > 1 ? "Ouvrir la page Decks" : "Ouvrir la page Deck"
    );
  }
};

const refreshDeckCollection = (session) => {
  if (!deckCollectionEl) {
    return;
  }

  const integration = getMoxfieldIntegration(session);
  const decks = Array.isArray(integration?.decks) ? integration.decks : [];
  const transformedDecks = applyDeckCollectionTransforms(decks);
  const hasDecks = renderDeckCardsInto(deckCollectionEl, transformedDecks);
  if (deckCollectionEmptyEl) {
    const hasAnyDecks = decks.length > 0;
    deckCollectionEmptyEl.classList.toggle("is-visible", !hasDecks);
    if (!hasDecks) {
      if (!hasAnyDecks) {
        deckCollectionEmptyEl.textContent =
          "Aucun deck importé pour le moment. Lancez une synchronisation pour retrouver vos listes.";
      } else if (
        deckCollectionState.search ||
        deckCollectionState.colors.size > 0 ||
        deckCollectionState.brackets.size > 0
      ) {
        deckCollectionEmptyEl.textContent =
          "Aucun deck ne correspond à votre recherche ou vos filtres.";
      } else {
        deckCollectionEmptyEl.textContent =
          "Aucun deck disponible pour le moment.";
      }
    }
  }
  if (deckBulkDeleteBtn) {
    const hasAnyDecks = decks.length > 0;
    deckBulkDeleteBtn.disabled = !hasAnyDecks;
    deckBulkDeleteBtn.classList.toggle("is-hidden", !hasAnyDecks);
    if (deckBulkDeleteContainer) {
      deckBulkDeleteContainer.classList.toggle("is-hidden", !hasAnyDecks);
    }
  }
};

async function handleDeckRemoval(deckId, deckName) {
  if (!deckId) {
    return;
  }

  const label = deckName ? `\u00ab ${deckName} \u00bb` : "ce deck";
  const confirmed = window.confirm(`Supprimer ${label} de vos imports ?`);
  if (!confirmed) {
    return;
  }

  const session = getSession();
  if (!session) {
    redirectToLanding();
    return;
  }

  const integration = getMoxfieldIntegration(session);
  const handle = integration?.handle || integration?.handleLower;
  if (!handle) {
    showDeckStatus(
      "Impossible d'identifier votre pseudo Moxfield. Lancez une synchronisation avant de supprimer un deck.",
      "error"
    );
    return;
  }

  showDeckStatus("Suppression du deck en cours…");

  try {
    const response = await fetch(
      buildBackendUrl(
        `/users/${encodeURIComponent(handle)}/decks/${encodeURIComponent(deckId)}`
      ),
      {
        method: "DELETE",
      }
    );

    if (response.status === 404) {
      showDeckStatus("Deck introuvable dans le cache.", "error");
      return;
    }

    if (!response.ok) {
      throw new Error(`Suppression refusée (${response.status})`);
    }

    const updatedSession = setMoxfieldIntegration((current) => {
      const nextDecks = Array.isArray(current?.decks)
        ? current.decks.filter((existingDeck) => getDeckIdentifier(existingDeck) !== deckId)
        : [];

      return {
        ...current,
        decks: nextDecks,
        deckCount: nextDecks.length,
        totalDecks: nextDecks.length,
      };
    });

    let finalSession = updatedSession ?? getSession();
    finalSession =
      (await persistIntegrationToProfile(finalSession, {
        decks: getMoxfieldIntegration(finalSession)?.decks ?? [],
      })) ?? finalSession;
    setCurrentSession(finalSession ?? currentSession);

    refreshDeckCollection(currentSession);
    if (typeof renderMoxfieldPanel === "function") {
      renderMoxfieldPanel(currentSession, { preserveStatus: true });
    }
    showDeckStatus("Deck supprimé de vos imports.", "success");
  } catch (error) {
    console.error("Unable to delete deck", error);
    showDeckStatus(
      "Impossible de supprimer le deck pour le moment. Réessayez plus tard.",
      "error"
    );
  }
}

async function handleDeckBulkRemoval() {
  const session = getSession();
  if (!session) {
    redirectToLanding();
    return;
  }

  const integration = getMoxfieldIntegration(session);
  const decks = Array.isArray(integration?.decks) ? integration.decks : [];
  if (decks.length === 0) {
    showDeckStatus("Aucun deck à supprimer.", "neutral");
    return;
  }

  const confirmed = window.confirm(
    `Supprimer ${decks.length} deck${decks.length > 1 ? "s" : ""} importé${
      decks.length > 1 ? "s" : ""
    } ? Cette action est définitive.`
  );
  if (!confirmed) {
    return;
  }

  const handle = integration?.handle || integration?.handleLower;
  if (!handle) {
    showDeckStatus(
      "Impossible d'identifier votre pseudo Moxfield. Lancez une synchronisation avant de supprimer vos decks.",
      "error"
    );
    return;
  }

  showDeckStatus("Suppression de tous les decks en cours…");
  if (deckBulkDeleteBtn) {
    deckBulkDeleteBtn.disabled = true;
    deckBulkDeleteBtn.classList.add("is-loading");
  }
  if (deckCollectionEl) {
    deckCollectionEl.classList.add("is-loading");
  }

  const deckIds = decks.map((deck) => getDeckIdentifier(deck)).filter(Boolean);
  const failures = [];

  for (const deckId of deckIds) {
    const endpoint = buildBackendUrl(
      `/users/${encodeURIComponent(handle)}/decks/${encodeURIComponent(deckId)}`
    );
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (response.status === 404) {
        continue;
      }
      if (!response.ok) {
        throw new Error(`Suppression refusée (${response.status})`);
      }
    } catch (error) {
      console.error("Unable to delete deck", deckId, error);
      failures.push(deckId);
    }
  }

  const updatedSession = setMoxfieldIntegration((current) => ({
    ...current,
    decks: [],
    deckCount: 0,
    totalDecks: 0,
  }));

  let finalSession = updatedSession ?? getSession();
  finalSession = (await persistIntegrationToProfile(finalSession, { decks: [] })) ?? finalSession;

  if (typeof currentSession !== "undefined") {
    setCurrentSession(finalSession ?? currentSession);
  }

  renderMoxfieldPanel(finalSession, { preserveStatus: true });
  refreshDeckCollection(finalSession);

  if (deckBulkDeleteBtn) {
    deckBulkDeleteBtn.classList.remove("is-loading");
  }
  if (deckCollectionEl) {
    deckCollectionEl.classList.remove("is-loading");
  }

  if (failures.length === 0) {
    showDeckStatus("Tous les decks ont été supprimés de vos imports.", "success");
  } else if (failures.length === deckIds.length) {
    showDeckStatus(
      "Impossible de supprimer les decks pour le moment. Réessayez plus tard.",
      "error"
    );
  } else {
    showDeckStatus(
      `${deckIds.length - failures.length} suppression${deckIds.length - failures.length > 1 ? "s" : ""} effectuée${
        deckIds.length - failures.length > 1 ? "s" : ""
      }. ${failures.length} deck${failures.length > 1 ? "s" : ""} reste à supprimer.`,
      "error"
    );
  }
}

const buildExistingDeckMap = (integration) => {
  const map = new Map();
  if (!integration?.decks) {
    return map;
  }
  integration.decks.forEach((deck) => {
    const deckId = getDeckIdentifier(deck);
    if (deckId) {
      map.set(deckId, deck);
    }
  });
  return map;
};

const gatherDeckSelection = () => {
  if (!deckSelectionListEl) {
    return [];
  }

  const selections = [];
  const items = deckSelectionListEl.querySelectorAll("[data-deck-id]");
  items.forEach((item) => {
    const deckId = item.getAttribute("data-deck-id");
    if (!deckId) {
      return;
    }

    const radios = item.querySelectorAll(`input[type="radio"][name="deck-${deckId}"]`);
    if (radios.length > 0) {
      const selected = Array.from(radios).find((input) => input.checked);
      if (selected && selected.value === "replace") {
        selections.push({ id: deckId, action: "replace" });
      }
      return;
    }

    const checkbox = item.querySelector(`input[type="checkbox"][name="deck-${deckId}"]`);
    if (checkbox?.checked) {
      selections.push({ id: deckId, action: "import" });
    }
  });

  return selections;
};

const updateDeckSelectionConfirmState = () => {
  if (!deckSelectionConfirmBtn) {
    return;
  }
  deckSelectionConfirmBtn.disabled = gatherDeckSelection().length === 0;
};

const populateDeckSelectionModal = (handle, decks, existingDeckMap) => {
  if (!deckSelectionListEl) {
    return;
  }

  deckSelectionListEl.innerHTML = "";

  if (!Array.isArray(decks) || decks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "modal-empty-state";
    empty.textContent = "Aucun deck public trouvé pour ce pseudo.";
    deckSelectionListEl.appendChild(empty);
    if (deckSelectionConfirmBtn) {
      deckSelectionConfirmBtn.disabled = true;
    }
    return;
  }

  decks.forEach((deck) => {
    const deckId = getDeckIdentifier(deck);
    if (!deckId) {
      return;
    }

    const isExisting = existingDeckMap.has(deckId);
    const item = document.createElement("div");
    item.className = "modal-deck-item";
    item.dataset.deckId = deckId;

    const header = document.createElement("div");
    header.className = "modal-deck-header";

    const title = document.createElement("h3");
    title.className = "modal-deck-title";
    title.textContent = deck.name || "Deck sans nom";

    const formatBadge = document.createElement("span");
    formatBadge.className = "deck-card-format";
    formatBadge.textContent = deck.format ? deck.format.toUpperCase() : "FORMAT ?";

    header.append(title, formatBadge);

    const meta = document.createElement("div");
    meta.className = "modal-deck-meta";
    const metaParts = [];
    if (deck.updatedAt) {
      metaParts.push(
        `Mis à jour le ${formatDateTime(deck.updatedAt, { dateStyle: "medium" })}`
      );
    }
    metaParts.push(isExisting ? "Déjà importé" : "Nouveau deck");
    meta.textContent = metaParts.join(" · ");

    const options = document.createElement("div");
    options.className = "modal-deck-options";

    if (isExisting) {
      const ignoreLabel = document.createElement("label");
      ignoreLabel.className = "modal-choice-label";
      const ignoreRadio = document.createElement("input");
      ignoreRadio.type = "radio";
      ignoreRadio.name = `deck-${deckId}`;
      ignoreRadio.value = "ignore";
      ignoreRadio.checked = true;
      ignoreRadio.defaultChecked = true;
      ignoreRadio.dataset.deckAction = "existing";
      ignoreLabel.append(ignoreRadio, document.createTextNode("Ignorer"));

      const replaceLabel = document.createElement("label");
      replaceLabel.className = "modal-choice-label";
      const replaceRadio = document.createElement("input");
      replaceRadio.type = "radio";
      replaceRadio.name = `deck-${deckId}`;
      replaceRadio.value = "replace";
      replaceRadio.dataset.deckAction = "existing";
      replaceLabel.append(replaceRadio, document.createTextNode("Remplacer"));

      options.append(ignoreLabel, replaceLabel);
    } else {
      const importLabel = document.createElement("label");
      importLabel.className = "modal-choice-label";
      const importCheckbox = document.createElement("input");
      importCheckbox.type = "checkbox";
      importCheckbox.name = `deck-${deckId}`;
      importCheckbox.value = "import";
      importCheckbox.checked = true;
      importCheckbox.defaultChecked = true;
      importCheckbox.dataset.deckAction = "new";
      importLabel.append(importCheckbox, document.createTextNode("Importer ce deck"));
      options.append(importLabel);
    }

    item.append(header, meta, options);
  deckSelectionListEl.appendChild(item);
  });

  updateDeckSelectionConfirmState();
};

const selectAllDecksForImport = () => {
  if (!deckSelectionListEl) {
    return;
  }

  deckSelectionListEl
    .querySelectorAll('input[type="checkbox"][data-deck-action="new"]')
    .forEach((input) => {
      input.checked = true;
    });

  deckSelectionListEl
    .querySelectorAll('input[type="radio"][data-deck-action="existing"][value="replace"]')
    .forEach((input) => {
      input.checked = true;
    });

  updateDeckSelectionConfirmState();
};

const clearDeckSelection = () => {
  if (!deckSelectionListEl) {
    return;
  }

  deckSelectionListEl
    .querySelectorAll('input[type="checkbox"][data-deck-action="new"]')
    .forEach((input) => {
      input.checked = false;
    });

  deckSelectionListEl
    .querySelectorAll('input[type="radio"][data-deck-action="existing"][value="ignore"]')
    .forEach((input) => {
      input.checked = true;
    });

  updateDeckSelectionConfirmState();
};

const closeDeckSelectionModal = (reason = "close") => {
  if (!deckSelectionModal) {
    return;
  }

  deckSelectionModal.classList.remove("is-visible");
  deckSelectionModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  if (deckSelectionForm) {
    deckSelectionForm.reset();
  }
  pendingDeckSelection = null;
  if (reason === "cancel") {
    showMoxfieldStatus("Sélection annulée.", "neutral");
  }
};

const openDeckSelectionModal = ({ handle, decks, totalDecks, user, existingDeckMap }) => {
  if (!deckSelectionModal) {
    return;
  }

  pendingDeckSelection = { handle, totalDecks, user, decks, existingDeckMap };
  populateDeckSelectionModal(handle, decks, existingDeckMap);
  deckSelectionModal.classList.add("is-visible");
  deckSelectionModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  updateDeckSelectionConfirmState();
};

const performDeckSync = async (handle, selections, previewMeta) => {
  if (!Array.isArray(selections) || selections.length === 0) {
    showMoxfieldStatus("Sélectionnez au moins un deck à importer.", "neutral");
    return;
  }

  if (currentSyncAbortController) {
    currentSyncAbortController.abort();
  }

  const controller = new AbortController();
  currentSyncAbortController = controller;

  setMoxfieldSyncLoading(true);
  showMoxfieldStatus("Synchronisation en cours…");

  try {
    const { decks, totalDecks, user, source } = await syncMoxfieldDecks(
      handle,
      controller.signal
    );

    const selectionMap = new Map(
      selections.map((entry) => [entry.id, entry.action])
    );

    const syncTimestamp = Date.now();
    const importedDecks = decks
      .filter((deck) => selectionMap.has(getDeckIdentifier(deck)))
      .map((deck) => ({
        ...deck,
        syncedAt: syncTimestamp,
      }));

    if (importedDecks.length === 0) {
      showMoxfieldStatus("Aucun deck n'a été sélectionné pour l'import.", "neutral");
      return;
    }

    const message = `Synchronisation réussie (${importedDecks.length} deck${
      importedDecks.length > 1 ? "s" : ""
    }).`;

    const updatedSession = setMoxfieldIntegration((integration) => {
      const previousDecks = Array.isArray(integration?.decks)
        ? integration.decks
        : [];
      const remainingDecks = previousDecks.filter((deck) => {
        const deckId = getDeckIdentifier(deck);
        return deckId ? !selectionMap.has(deckId) : true;
      });
      const mergedDecks = [...remainingDecks, ...importedDecks];
      const remoteTotal =
        typeof totalDecks === "number"
          ? totalDecks
          : typeof previewMeta?.totalDecks === "number"
          ? previewMeta.totalDecks
          : mergedDecks.length;
      const totalCount = Math.max(remoteTotal, mergedDecks.length);

      return {
        ...integration,
        handle,
        handleLower: handle.toLowerCase(),
        decks: mergedDecks,
        deckCount: mergedDecks.length,
        totalDecks: totalCount,
        lastUser: user ?? previewMeta?.user ?? integration?.lastUser ?? null,
        lastSyncedAt: Date.now(),
        lastSyncStatus: "success",
        lastSyncMessage: message,
        lastSource: source ?? "live",
      };
    });

    let nextSession = updatedSession ?? currentSession;
    const decksToPersist =
      getMoxfieldIntegration(nextSession)?.decks?.slice() ?? [];
    nextSession = await persistIntegrationToProfile(nextSession, {
      decks: decksToPersist,
    });

    setCurrentSession(nextSession ?? currentSession);
    renderMoxfieldPanel(currentSession);
    refreshDeckCollection(currentSession);
    showMoxfieldStatus(message, "success");
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    if (error.code === "NOT_FOUND") {
      showMoxfieldStatus(
        "Impossible de trouver ce pseudo Moxfield. Vérifiez l'orthographe et réessayez.",
        "error"
      );
    } else if (error.code === "STORAGE_QUOTA") {
      showMoxfieldStatus(
        "Synchronisation trop volumineuse pour le stockage local de ce navigateur. Supprimez quelques decks ou videz la session depuis le profil.",
        "error"
      );
    } else if (error.code === "HTTP_ERROR") {
      showMoxfieldStatus(
        `L'API EDH PodLog a renvoyé une erreur (${error.status ?? "inconnue"}).`,
        "error"
      );
    } else if (error.code === "NETWORK") {
      showMoxfieldStatus(error.message, "error");
    } else {
      showMoxfieldStatus("Synchronisation impossible pour le moment.", "error");
    }
  } finally {
    if (currentSyncAbortController === controller) {
      currentSyncAbortController = null;
    }
    setMoxfieldSyncLoading(false);
  }
};
