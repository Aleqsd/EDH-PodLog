const STORAGE_KEY = "edhPodlogSession";
const LAST_DECK_STORAGE_KEY = "edhPodlogLastDeckSelection";
const LAST_CARD_STORAGE_KEY = "edhPodlogLastCardSelection";
const DECK_EVALUATIONS_STORAGE_KEY = "edhPodlogDeckEvaluations";
const CONFIG = window.EDH_PODLOG_CONFIG ?? {};
const GOOGLE_CLIENT_ID = CONFIG.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_SCOPES = "openid email profile";
const GOOGLE_CONFIG_PLACEHOLDER = "REMPLACEZ_MOI_PAR_VOTRE_CLIENT_ID";
const NUMBER_FORMAT = new Intl.NumberFormat("fr-FR");
const API_BASE_URL = (() => {
  const base = CONFIG.API_BASE_URL || "http://localhost:4310";
  return base.endsWith("/") ? base.replace(/\/+$/, "") : base;
})();

const APP_REVISION = CONFIG.APP_REVISION ?? "";
const APP_REVISION_FULL = CONFIG.APP_REVISION_FULL ?? "";

const mountAppRevisionBadge = () => {
  if (!APP_REVISION || typeof document === "undefined") {
    return;
  }

  const body = document.body;
  if (!body || document.getElementById("appRevisionBadge")) {
    return;
  }

  const badge = document.createElement("aside");
  badge.id = "appRevisionBadge";
  badge.className = "app-revision-badge";
  badge.setAttribute("aria-label", `Révision ${APP_REVISION}`);
  badge.dataset.revision = APP_REVISION;

  if (APP_REVISION_FULL) {
    badge.title = `Commit ${APP_REVISION_FULL}`;
    badge.dataset.revisionFull = APP_REVISION_FULL;
  }

  const label = document.createElement("span");
  label.className = "app-revision-label";
  label.textContent = "rev";

  const value = document.createElement("span");
  value.className = "app-revision-value";
  value.textContent = APP_REVISION;

  badge.append(label, value);
  body.appendChild(badge);
};

const buildBackendUrl = (path) => {
  if (!path) {
    return API_BASE_URL;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
};

let tokenClient = null;
let googleAccessToken = null;
let isGoogleLibraryReady = false;
let currentSession = null;

let landingSignInButton = null;
let landingFootnoteTextEl = null;
let defaultSignInLabel = "Se connecter avec Google";
let defaultFootnoteText =
  "Nous n'utiliserons vos données que pour EDH PodLog.";

let moxfieldForm = null;
let moxfieldHandleInput = null;
let moxfieldSaveButton = null;
let moxfieldSyncButton = null;
let moxfieldStatusEl = null;
let moxfieldDeckSummaryEl = null;
let moxfieldDeckSummaryText = null;
let moxfieldDeckSummaryAction = null;
let moxfieldMetaEl = null;
let defaultSyncLabel = "Synchroniser avec Moxfield";
let deckSummaryEl = null;
let deckCommanderEl = null;
let deckInsightsEl = null;
let currentSyncAbortController = null;
let deckCollectionEl = null;
let deckCollectionEmptyEl = null;
let deckStatusEl = null;
let deckBulkDeleteBtn = null;
let deckSelectionModal = null;
let deckSelectionListEl = null;
let deckSelectionForm = null;
let deckSelectionConfirmBtn = null;
let deckSelectionCancelBtn = null;
let deckSelectionCloseBtn = null;
let deckSelectionSelectAllBtn = null;
let deckSelectionClearBtn = null;
let pendingDeckSelection = null;

const isGoogleClientConfigured = () =>
  Boolean(
    GOOGLE_CLIENT_ID &&
      GOOGLE_CLIENT_ID !== GOOGLE_CONFIG_PLACEHOLDER &&
      !GOOGLE_CLIENT_ID.includes("REMPLACEZ")
  );

const getSession = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return sanitizeSessionForStorage(JSON.parse(raw));
  } catch (error) {
    console.warn("Session invalide, nettoyage…", error);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

const trimMoxfieldDeckForStorage = (deck) => {
  if (!deck || typeof deck !== "object") {
    return null;
  }

  const trimmed = { ...deck };

  if (trimmed.raw && typeof trimmed.raw === "object") {
    const rawDeck = { ...trimmed.raw };

    if (Array.isArray(rawDeck.boards)) {
      rawDeck.boards = rawDeck.boards.map((board) => {
        if (!board || typeof board !== "object") {
          return null;
        }
        const safeBoard = {
          name: typeof board.name === "string" ? board.name : null,
        };
        if (typeof board.count === "number" && Number.isFinite(board.count)) {
          safeBoard.count = board.count;
        }
        if (Array.isArray(board.cards)) {
          safeBoard.cards = board.cards
            .map((cardEntry) => {
              if (!cardEntry || typeof cardEntry !== "object") {
                return null;
              }
              const quantity =
                typeof cardEntry.quantity === "number" && Number.isFinite(cardEntry.quantity)
                  ? cardEntry.quantity
                  : null;
              const card = cardEntry.card && typeof cardEntry.card === "object"
                ? {
                    id:
                      cardEntry.card.id ??
                      cardEntry.card.card_id ??
                      cardEntry.card.uniqueCardId ??
                      cardEntry.card.unique_card_id ??
                      null,
                    name: cardEntry.card.name ?? null,
                    mana_cost: cardEntry.card.mana_cost ?? cardEntry.card.manaCost ?? null,
                    type_line: cardEntry.card.type_line ?? cardEntry.card.typeLine ?? null,
                    oracle_text: cardEntry.card.oracle_text ?? cardEntry.card.oracleText ?? null,
                    cmc:
                      typeof cardEntry.card.cmc === "number" && Number.isFinite(cardEntry.card.cmc)
                        ? cardEntry.card.cmc
                        : typeof cardEntry.card.mana_value === "number" &&
                          Number.isFinite(cardEntry.card.mana_value)
                        ? cardEntry.card.mana_value
                        : null,
                    mana_value:
                      typeof cardEntry.card.mana_value === "number" &&
                      Number.isFinite(cardEntry.card.mana_value)
                        ? cardEntry.card.mana_value
                        : null,
                    colors: Array.isArray(cardEntry.card.colors) ? [...cardEntry.card.colors] : [],
                    image_uris:
                      cardEntry.card.image_uris && typeof cardEntry.card.image_uris === "object"
                        ? {
                            small: cardEntry.card.image_uris.small ?? null,
                            normal: cardEntry.card.image_uris.normal ?? null,
                            large: cardEntry.card.image_uris.large ?? null,
                          }
                        : null,
                  }
                : null;
              return { quantity, card };
            })
            .filter(Boolean);
        }
        return safeBoard;
      }).filter(Boolean);
    }

    trimmed.raw = rawDeck;
  }

  return trimmed;
};

const sanitizeSessionForStorage = (session) => {
  if (!session || typeof session !== "object") {
    return session;
  }

  const sanitized = { ...session };

  if (sanitized.integrations && typeof sanitized.integrations === "object") {
    sanitized.integrations = { ...sanitized.integrations };
    const moxfield = sanitized.integrations.moxfield;
    if (moxfield && typeof moxfield === "object") {
      const trimmedIntegration = { ...moxfield };
      if (Array.isArray(moxfield.decks)) {
        trimmedIntegration.decks = moxfield.decks
          .map(trimMoxfieldDeckForStorage)
          .filter(Boolean);
        trimmedIntegration.deckCount = trimmedIntegration.decks.length;
      }
      sanitized.integrations.moxfield = trimmedIntegration;
    }
  }

  return sanitized;
};

const isQuotaExceededError = (error) => {
  if (!error) {
    return false;
  }
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014
  );
};

const persistSession = (session) => {
  const sanitized = sanitizeSessionForStorage(session);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn(
        "Stockage local saturé : impossible d'enregistrer l'état de la session.",
        error
      );
      const quotaError = new Error(
        "Local storage quota exceeded while saving session."
      );
      quotaError.code = "STORAGE_QUOTA";
      throw quotaError;
    }
    throw error;
  }
  return session;
};

const clearSession = () => {
  localStorage.removeItem(STORAGE_KEY);
};

const loadDeckEvaluations = () => {
  const raw = localStorage.getItem(DECK_EVALUATIONS_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Évaluations de deck invalides, nettoyage…", error);
    localStorage.removeItem(DECK_EVALUATIONS_STORAGE_KEY);
    return {};
  }
};

const persistDeckEvaluations = (evaluations) => {
  try {
    localStorage.setItem(DECK_EVALUATIONS_STORAGE_KEY, JSON.stringify(evaluations));
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn(
        "Stockage local saturé : impossible d'enregistrer les informations personnalisées du deck.",
        error
      );
      const quotaError = new Error(
        "Local storage quota exceeded while saving deck personalization."
      );
      quotaError.code = "STORAGE_QUOTA";
      throw quotaError;
    }
    throw error;
  }
};

const LEGACY_DECK_RATING_KEY_MAP = {
  consistency: "stability",
  consistance: "stability",
  consitance: "stability",
  acceleration: "acceleration",
  interaction: "interaction",
  interraction: "interaction",
  resilience: "resilience",
  finition: "finish",
  finish: "finish",
};

const clampDeckRatingValue = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rounded = Math.round(numeric);
  if (rounded < 1) {
    return 1;
  }
  if (rounded > 5) {
    return 5;
  }
  return rounded;
};

const sanitizeDeckRatings = (input) => {
  if (!input || typeof input !== "object") {
    return {};
  }
  const sanitized = {};
  Object.entries(input).forEach(([key, value]) => {
    const sanitizedValue = clampDeckRatingValue(value);
    if (sanitizedValue !== null) {
      const normalizedKey = LEGACY_DECK_RATING_KEY_MAP[key] ?? String(key);
      sanitized[normalizedKey] = sanitizedValue;
    }
  });
  return sanitized;
};

const sanitizeOptionalString = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeBracketId = (value) => {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (typeof value === "object") {
    return sanitizeBracketId(value?.id ?? value?.value ?? value?.bracket);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 5) {
    return String(Math.round(numeric));
  }
  const stringValue = typeof value === "string" ? value.trim() : "";
  if (stringValue === "") {
    return null;
  }
  if (/^[1-5]$/.test(stringValue)) {
    return stringValue;
  }
  return stringValue;
};

const sanitizeTagList = (tags, limit = 7) => {
  if (!Array.isArray(tags) || limit <= 0) {
    return [];
  }
  const sanitized = [];
  const seen = new Set();
  tags.forEach((tag) => {
    const text = typeof tag === "string" ? tag.trim() : "";
    if (!text) {
      return;
    }
    const fingerprint = text.toLowerCase();
    if (seen.has(fingerprint)) {
      return;
    }
    if (sanitized.length >= limit) {
      return;
    }
    seen.add(fingerprint);
    sanitized.push(text);
  });
  return sanitized;
};

const sanitizePersonalTag = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > 40 ? trimmed.slice(0, 40) : trimmed;
};

const sanitizePersonalNotes = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
};

const createDeckPersonalizationDefaults = () => ({
  version: 2,
  ratings: {},
  bracket: null,
  playstyle: null,
  tags: [],
  personalTag: "",
  notes: "",
  updatedAt: null,
});

const normalizeDeckPersonalizationEntry = (entry) => {
  const defaults = createDeckPersonalizationDefaults();
  if (!entry || typeof entry !== "object") {
    return defaults;
  }

  const hasStructuredFields =
    "ratings" in entry ||
    "bracket" in entry ||
    "playstyle" in entry ||
    "tags" in entry ||
    "personalTag" in entry ||
    "notes" in entry ||
    entry.version >= 2;

  const normalized = {
    ...defaults,
    ratings: sanitizeDeckRatings(hasStructuredFields ? entry.ratings ?? {} : entry),
  };

  if (hasStructuredFields) {
    normalized.bracket = sanitizeBracketId(entry.bracket);
    const playstyle = sanitizeOptionalString(entry.playstyle ?? entry.archetype);
    normalized.playstyle = playstyle;
    normalized.tags = sanitizeTagList(entry.tags);
    normalized.personalTag = sanitizePersonalTag(entry.personalTag);
    normalized.notes = sanitizePersonalNotes(entry.notes);
    if (typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)) {
      normalized.updatedAt = entry.updatedAt;
    }
  }

  return normalized;
};

const applyDeckPersonalizationUpdates = (existingEntry, updates) => {
  const base = normalizeDeckPersonalizationEntry(existingEntry);
  const next = { ...base };

  if (updates && typeof updates === "object") {
    if ("ratings" in updates) {
      next.ratings = sanitizeDeckRatings(updates.ratings);
    }
    if ("bracket" in updates) {
      next.bracket = sanitizeBracketId(updates.bracket);
    }
    if ("playstyle" in updates) {
      next.playstyle = sanitizeOptionalString(updates.playstyle);
    }
    if ("tags" in updates) {
      next.tags = sanitizeTagList(updates.tags);
    }
    if ("personalTag" in updates) {
      next.personalTag = sanitizePersonalTag(updates.personalTag);
    }
    if ("notes" in updates) {
      next.notes = sanitizePersonalNotes(updates.notes);
    }
  }

  next.version = 2;
  next.updatedAt = Date.now();
  return next;
};

const getDeckPersonalization = (deckId) => {
  if (!deckId) {
    return null;
  }
  const evaluations = loadDeckEvaluations();
  const entry = evaluations?.[deckId];
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return normalizeDeckPersonalizationEntry(entry);
};

const setDeckPersonalization = (deckId, updates) => {
  if (!deckId) {
    return null;
  }
  const current = loadDeckEvaluations();
  const existing = current?.[deckId];
  const next = applyDeckPersonalizationUpdates(existing, updates);
  current[deckId] = next;
  persistDeckEvaluations(current);
  return next;
};

const getDeckEvaluation = (deckId) => {
  const personalization = getDeckPersonalization(deckId);
  return personalization?.ratings ?? null;
};

const setDeckEvaluation = (deckId, evaluation) => {
  if (!deckId || !evaluation || typeof evaluation !== "object") {
    return null;
  }
  const personalization = setDeckPersonalization(deckId, { ratings: evaluation });
  return personalization?.ratings ?? null;
};

const cloneSession = (session) => {
  if (!session) {
    return null;
  }

  return {
    ...session,
    integrations: session.integrations
      ? {
          ...session.integrations,
          moxfield: session.integrations.moxfield
            ? {
                ...session.integrations.moxfield,
                decks: Array.isArray(session.integrations.moxfield.decks)
                  ? [...session.integrations.moxfield.decks]
                  : [],
              }
            : undefined,
        }
      : undefined,
  };
};

const updateSessionData = (mutator) => {
  const current = getSession();
  if (!current) {
    return null;
  }

  const draft = cloneSession(current);
  const result = mutator ? mutator(draft) ?? draft : draft;
  return persistSession(result);
};

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

const buildProfileEndpoint = (googleSub) => {
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(`/profiles/${encodeURIComponent(googleSub)}`);
};

const buildPlaygroupsEndpoint = (googleSub) => {
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(
    `/profiles/${encodeURIComponent(googleSub)}/playgroups`
  );
};

const buildGamesEndpoint = (googleSub) => {
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(`/profiles/${encodeURIComponent(googleSub)}/games`);
};

const fetchBackendProfile = async (googleSub) => {
  const endpoint = buildProfileEndpoint(googleSub);
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Profil introuvable (${response.status})`);
    }

    return response.json();
  } catch (error) {
    console.warn("Impossible de récupérer le profil depuis le backend :", error);
    throw error;
  }
};

const upsertBackendProfile = async (googleSub, payload) => {
  const endpoint = buildProfileEndpoint(googleSub);
  if (!endpoint || !payload || typeof payload !== "object") {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Enregistrement du profil refusé (${response.status})`);
    }

    return response.json();
  } catch (error) {
    console.warn("Impossible d'enregistrer le profil utilisateur :", error);
    throw error;
  }
};

const fetchUserPlaygroups = async (googleSub) => {
  const endpoint = buildPlaygroupsEndpoint(googleSub);
  if (!endpoint) {
    return { playgroups: [] };
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Impossible de récupérer les groupes (${response.status}).`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== "object") {
      return { playgroups: [] };
    }
    return {
      playgroups: Array.isArray(payload.playgroups) ? payload.playgroups : [],
    };
  } catch (error) {
    console.warn("Échec de récupération des groupes :", error);
    throw error;
  }
};

const upsertUserPlaygroup = async (googleSub, name) => {
  const endpoint = buildPlaygroupsEndpoint(googleSub);
  if (!endpoint) {
    return null;
  }
  const payload = { name };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Impossible d'enregistrer le groupe (${response.status}).`);
    }
    return response.json();
  } catch (error) {
    console.warn("Échec de l'enregistrement du groupe :", error);
    throw error;
  }
};

const fetchUserGames = async (googleSub, { playgroupId } = {}) => {
  const endpoint = buildGamesEndpoint(googleSub);
  if (!endpoint) {
    return { games: [] };
  }
  let url = endpoint;
  if (playgroupId) {
    const params = new URLSearchParams({ playgroup_id: playgroupId });
    url = `${endpoint}?${params}`;
  }

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Impossible de récupérer les parties (${response.status}).`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== "object") {
      return { games: [] };
    }
    return {
      games: Array.isArray(payload.games) ? payload.games : [],
    };
  } catch (error) {
    console.warn("Échec de récupération des parties :", error);
    throw error;
  }
};

const recordUserGame = async (googleSub, payload) => {
  const endpoint = buildGamesEndpoint(googleSub);
  if (!endpoint || !payload || typeof payload !== "object") {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      const message =
        errorBody?.detail ||
        `Impossible d'enregistrer la partie (${response.status}).`;
      throw new Error(message);
    }
    return response.json();
  } catch (error) {
    console.warn("Échec de l'enregistrement de la partie :", error);
    throw error;
  }
};

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

  if (profile.display_name) {
    next.userName = profile.display_name;
    next.initials = computeInitials(profile.display_name);
  }

  if (Object.prototype.hasOwnProperty.call(profile, "email") && profile.email) {
    next.email = profile.email;
  }

  if (Object.prototype.hasOwnProperty.call(profile, "picture")) {
    next.picture = profile.picture || "";
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

  if (session.picture) {
    element.style.backgroundImage = `url('${session.picture}')`;
    element.style.backgroundSize = "cover";
    element.style.backgroundPosition = "center";
    element.style.backgroundColor = "#1b2540";
    element.textContent = "";
    element.setAttribute("aria-label", session.userName ?? "Profil");
  } else {
    element.style.backgroundImage = "";
    element.style.backgroundColor = "";
    element.textContent = initials;
    if (session.userName) {
      element.setAttribute("aria-label", session.userName);
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

  if (memberSinceEl && session?.createdAt) {
    memberSinceEl.textContent = formatDateTime(session.createdAt, {
      dateStyle: "long",
    });
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

const findDeckInIntegration = (integration, deckId) => {
  if (!integration || !deckId) {
    return null;
  }
  return (
    integration.decks?.find((storedDeck) => getDeckIdentifier(storedDeck) === deckId) ??
    null
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
  const index = decks.findIndex((existing) => getDeckIdentifier(existing) === targetId);
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
  if (!Array.isArray(decks) || decks.length === 0) {
    return false;
  }

  decks.forEach((deck) => {
    target.appendChild(createDeckCardElement(deck));
  });
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
  const hasDecks = renderDeckCardsInto(deckCollectionEl, decks);
  if (deckCollectionEmptyEl) {
    deckCollectionEmptyEl.classList.toggle("is-visible", !hasDecks);
  }
  if (deckBulkDeleteBtn) {
    deckBulkDeleteBtn.disabled = !hasDecks;
    deckBulkDeleteBtn.classList.toggle("is-hidden", !hasDecks);
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
    currentSession = finalSession ?? currentSession;

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
    currentSession = finalSession ?? currentSession;
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

    currentSession = nextSession ?? currentSession;
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
