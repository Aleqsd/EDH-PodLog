const STORAGE_KEY = "edhPodlogSession";
const LAST_DECK_STORAGE_KEY = "edhPodlogLastDeckSelection";
const LAST_CARD_STORAGE_KEY = "edhPodlogLastCardSelection";
const DECK_EVALUATIONS_STORAGE_KEY = "edhPodlogDeckEvaluations";
const DECK_LAYOUT_STORAGE_KEY = "edhPodlogDeckDisplayMode";
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
const APP_REVISION_MESSAGE = (() => {
  const value = CONFIG.APP_REVISION_MESSAGE;
  return typeof value === "string" ? value.trim() : "";
})();
const APP_REVISION_DATE_RAW = CONFIG.APP_REVISION_DATE ?? "";

const parseRevisionDate = (raw) => {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const REVISION_DATE = parseRevisionDate(APP_REVISION_DATE_RAW);
const formatRevisionDate = (date) => {
  if (!(date instanceof Date)) {
    return "";
  }
  try {
    const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    return `${dateFormatter.format(date)} à ${timeFormatter.format(date)}`;
  } catch (error) {
    console.warn("EDH PodLog failed to format revision date:", error);
    return date.toISOString();
  }
};

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
  if (APP_REVISION_MESSAGE) {
    badge.setAttribute("aria-label", `Dernière mise à jour : ${APP_REVISION_MESSAGE} (${APP_REVISION})`);
  } else {
    badge.setAttribute("aria-label", `Révision ${APP_REVISION}`);
  }
  badge.dataset.revision = APP_REVISION;

  if (APP_REVISION_FULL) {
    badge.title = `Commit ${APP_REVISION_FULL}`;
    badge.dataset.revisionFull = APP_REVISION_FULL;
  }

  const previewMessage = (() => {
    if (!APP_REVISION_MESSAGE) {
      return `Révision ${APP_REVISION}`;
    }
    const maxLength = 80;
    if (APP_REVISION_MESSAGE.length <= maxLength) {
      return APP_REVISION_MESSAGE;
    }
    return `${APP_REVISION_MESSAGE.slice(0, maxLength - 1)}…`;
  })();

  const header = document.createElement("span");
  header.className = "app-revision-header";

  const messageSpan = document.createElement("span");
  messageSpan.className = "app-revision-message";
  messageSpan.textContent = previewMessage;

  const revisionSpan = document.createElement("span");
  revisionSpan.className = "app-revision-value";
  revisionSpan.textContent = `(${APP_REVISION})`;

  header.append(messageSpan, revisionSpan);
  badge.append(header);

  if (APP_REVISION_MESSAGE) {
    badge.dataset.revisionMessage = APP_REVISION_MESSAGE;
    const tooltip = document.createElement("div");
    tooltip.className = "app-revision-tooltip";
    tooltip.textContent = APP_REVISION_MESSAGE;
    tooltip.id = "appRevisionTooltip";
    badge.setAttribute("aria-describedby", tooltip.id);
    badge.append(tooltip);
  }

  if (REVISION_DATE) {
    const display = formatRevisionDate(REVISION_DATE);
    if (display) {
      const dateEl = document.createElement("time");
      dateEl.className = "app-revision-date";
      dateEl.dateTime = REVISION_DATE.toISOString();
      dateEl.textContent = `Mis à jour le ${display}`;
      badge.dataset.revisionDate = REVISION_DATE.toISOString();
      badge.append(dateEl);
    }
  }

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
let deckPerformanceEl = null;
let currentSyncAbortController = null;
let deckCollectionEl = null;
let deckCollectionEmptyEl = null;
let deckStatusEl = null;
let deckBulkDeleteBtn = null;
let deckBulkDeleteContainer = null;

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
  ["optimisees", "4"],
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

let deckSelectionModal = null;
let deckSelectionListEl = null;
let deckSelectionForm = null;
let deckSelectionConfirmBtn = null;
let deckSelectionCancelBtn = null;
let deckSelectionCloseBtn = null;
let deckSelectionSelectAllBtn = null;
let deckSelectionClearBtn = null;
let pendingDeckSelection = null;

const deckPersonalizationCache = new Map();
let deckPersonalizationOwner = null;
let deckPersonalizationsBootstrapped = false;
let deckPersonalizationLoadPromise = null;
let deckPersonalizationsRemoteHydrated = false;

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

const loadStoredDeckPersonalizations = () => {
  const raw = localStorage.getItem(DECK_EVALUATIONS_STORAGE_KEY);
  if (!raw) {
    return { owner: null, entries: {} };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (parsed.entries && typeof parsed.entries === "object") {
        return {
          owner:
            typeof parsed.owner === "string" && parsed.owner.trim().length > 0
              ? parsed.owner.trim()
              : null,
          entries: parsed.entries ?? {},
        };
      }
      return { owner: null, entries: parsed };
    }
  } catch (error) {
    console.warn("Évaluations de deck invalides, nettoyage…", error);
    localStorage.removeItem(DECK_EVALUATIONS_STORAGE_KEY);
    return { owner: null, entries: {} };
  }

  return { owner: null, entries: {} };
};

const persistDeckPersonalizationsToStorage = (owner, entries) => {
  const payload = {
    owner: owner ?? null,
    entries: entries ?? {},
  };
  try {
    localStorage.setItem(DECK_EVALUATIONS_STORAGE_KEY, JSON.stringify(payload));
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

const exportDeckPersonalizationsForStorage = () => {
  const snapshot = {};
  deckPersonalizationCache.forEach((value, deckId) => {
    if (!deckId) {
      return;
    }
    const copy = { ...value };
    delete copy.deckId;
    snapshot[deckId] = copy;
  });
  return snapshot;
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

const toTimestamp = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
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

const bootstrapDeckPersonalizationCache = (owner = null) => {
  if (deckPersonalizationsBootstrapped && (!owner || deckPersonalizationOwner === owner)) {
    return;
  }

  const stored = loadStoredDeckPersonalizations();
  if (owner && stored.owner && stored.owner !== owner) {
    deckPersonalizationCache.clear();
    deckPersonalizationOwner = owner;
    deckPersonalizationsBootstrapped = true;
    deckPersonalizationsRemoteHydrated = false;
    return;
  }

  deckPersonalizationCache.clear();
  const entries = stored.entries ?? {};
  Object.entries(entries).forEach(([deckId, rawEntry]) => {
    const normalized = normalizeDeckPersonalizationEntry(rawEntry);
    normalized.deckId =
      normalized.deckId && normalized.deckId.trim().length > 0 ? normalized.deckId : deckId;
    deckPersonalizationCache.set(deckId, normalized);
  });
  deckPersonalizationOwner = owner ?? stored.owner ?? deckPersonalizationOwner ?? null;
  deckPersonalizationsBootstrapped = true;
  if (!owner) {
    deckPersonalizationsRemoteHydrated = false;
  }
};

const createDeckPersonalizationDefaults = () => ({
  version: 2,
  ratings: {},
  bracket: null,
  playstyle: null,
  tags: [],
  personalTag: "",
  notes: "",
  deckId: null,
  createdAt: null,
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
    "bracket_id" in entry ||
    "playstyle" in entry ||
    "tags" in entry ||
    "personalTag" in entry ||
    "personal_tag" in entry ||
    "notes" in entry ||
    "deckId" in entry ||
    "deck_id" in entry ||
    "createdAt" in entry ||
    "created_at" in entry ||
    "updated_at" in entry ||
    "updatedAt" in entry ||
    entry.version >= 2;

  const normalized = {
    ...defaults,
    ratings: sanitizeDeckRatings(hasStructuredFields ? entry.ratings ?? {} : entry),
  };

  if (hasStructuredFields) {
    normalized.bracket = sanitizeBracketId(entry.bracket ?? entry.bracket_id);
    const playstyle = sanitizeOptionalString(entry.playstyle ?? entry.archetype);
    normalized.playstyle = playstyle;
    normalized.tags = sanitizeTagList(entry.tags);
    normalized.personalTag = sanitizePersonalTag(entry.personalTag ?? entry.personal_tag);
    normalized.notes = sanitizePersonalNotes(entry.notes);
    normalized.deckId =
      typeof entry.deckId === "string" && entry.deckId.trim().length > 0
        ? entry.deckId.trim()
        : typeof entry.deck_id === "string" && entry.deck_id.trim().length > 0
        ? entry.deck_id.trim()
        : defaults.deckId;
    const createdAt = toTimestamp(entry.createdAt ?? entry.created_at);
    if (createdAt !== null) {
      normalized.createdAt = createdAt;
    }
    const updatedAt = toTimestamp(entry.updatedAt ?? entry.updated_at);
    if (updatedAt !== null) {
      normalized.updatedAt = updatedAt;
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
  next.deckId = base.deckId ?? null;
  next.createdAt = base.createdAt ?? Date.now();
  next.updatedAt = Date.now();
  return next;
};

const getActiveSession = () => {
  if (typeof currentSession !== "undefined" && currentSession) {
    return currentSession;
  }
  return getSession();
};

const getDeckPersonalization = (deckId) => {
  if (!deckId) {
    return null;
  }
  const session = getActiveSession();
  const owner = session?.googleSub ?? null;
  bootstrapDeckPersonalizationCache(owner);
  const entry = deckPersonalizationCache.get(deckId);
  if (!entry) {
    return null;
  }
  return {
    ...entry,
    ratings: { ...entry.ratings },
    tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
  };
};

const upsertDeckPersonalizationRemote = async (googleSub, deckId, payload) => {
  const endpoint = buildDeckPersonalizationDetailEndpoint(googleSub, deckId);
  if (!endpoint) {
    throw new Error("Point de terminaison d'enregistrement introuvable.");
  }
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(
      `Impossible d'enregistrer les informations personnelles (${response.status}).`
    );
  }
  return response.json();
};

const fetchDeckPersonalizationsFromBackend = async (googleSub) => {
  const endpoint = buildDeckPersonalizationsEndpoint(googleSub);
  if (!endpoint) {
    return [];
  }
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(
      `Impossible de charger les informations personnelles (${response.status}).`
    );
  }
  const payload = await response.json();
  const entries = Array.isArray(payload?.personalizations) ? payload.personalizations : [];

  deckPersonalizationCache.clear();
  entries.forEach((entry) => {
    const deckId =
      (typeof entry?.deckId === "string" && entry.deckId.trim()) ||
      (typeof entry?.deck_id === "string" && entry.deck_id.trim());
    if (!deckId) {
      return;
    }
    const normalized = normalizeDeckPersonalizationEntry(entry);
    normalized.deckId = normalized.deckId && normalized.deckId.trim().length > 0 ? normalized.deckId : deckId;
    deckPersonalizationCache.set(deckId, normalized);
  });
  deckPersonalizationOwner = googleSub;
  deckPersonalizationsBootstrapped = true;
  persistDeckPersonalizationsToStorage(googleSub, exportDeckPersonalizationsForStorage());
  return entries;
};

const ensureDeckPersonalizationsSynced = async (session = null) => {
  const activeSession = session ?? getActiveSession();
  const googleSub = activeSession?.googleSub ?? null;
  if (!googleSub) {
    bootstrapDeckPersonalizationCache(null);
    deckPersonalizationsRemoteHydrated = false;
    return;
  }

  if (deckPersonalizationOwner && deckPersonalizationOwner !== googleSub) {
    deckPersonalizationCache.clear();
    deckPersonalizationsBootstrapped = false;
    deckPersonalizationsRemoteHydrated = false;
  }

  bootstrapDeckPersonalizationCache(googleSub);

  const isCurrentOwner = deckPersonalizationOwner === googleSub;
  if (isCurrentOwner && deckPersonalizationsRemoteHydrated && !deckPersonalizationLoadPromise) {
    return;
  }

  if (!deckPersonalizationLoadPromise) {
    deckPersonalizationLoadPromise = fetchDeckPersonalizationsFromBackend(googleSub)
      .then((entries) => {
        deckPersonalizationsRemoteHydrated = true;
        return entries;
      })
      .catch((error) => {
        console.warn("Impossible de synchroniser les personnalisations de deck :", error);
        throw error;
      })
      .finally(() => {
        deckPersonalizationLoadPromise = null;
      });
  }

  try {
    await deckPersonalizationLoadPromise;
  } catch (error) {
    // Keep local cache on failure.
  }
};

const setDeckPersonalization = async (deckId, updates) => {
  if (!deckId) {
    throw new Error("Identifiant de deck requis.");
  }
  const session = getActiveSession();
  const googleSub = session?.googleSub ?? null;
  if (!googleSub) {
    throw new Error("Connectez-vous pour enregistrer vos modifications.");
  }

  bootstrapDeckPersonalizationCache(googleSub);
  const existing = deckPersonalizationCache.get(deckId);
  const nextLocal = applyDeckPersonalizationUpdates(existing, updates);
  nextLocal.deckId = deckId;

  const payload = {
    ratings: nextLocal.ratings,
    bracket: nextLocal.bracket,
    playstyle: nextLocal.playstyle ?? null,
    tags: Array.isArray(nextLocal.tags) ? nextLocal.tags : [],
    personalTag: nextLocal.personalTag ?? "",
    notes: nextLocal.notes ?? "",
  };

  const remote = await upsertDeckPersonalizationRemote(googleSub, deckId, payload);
  const normalizedRemote = normalizeDeckPersonalizationEntry(remote);
  normalizedRemote.deckId =
    normalizedRemote.deckId && normalizedRemote.deckId.trim().length > 0
      ? normalizedRemote.deckId
      : deckId;
  if (typeof normalizedRemote.updatedAt !== "number" || !Number.isFinite(normalizedRemote.updatedAt)) {
    normalizedRemote.updatedAt = Date.now();
  }
  if (typeof normalizedRemote.createdAt !== "number" || !Number.isFinite(normalizedRemote.createdAt)) {
    normalizedRemote.createdAt = normalizedRemote.updatedAt;
  }

  deckPersonalizationCache.set(deckId, normalizedRemote);
  try {
    persistDeckPersonalizationsToStorage(
      googleSub,
      exportDeckPersonalizationsForStorage()
    );
  } catch (error) {
    if (error && error.code === "STORAGE_QUOTA") {
      console.warn(
        "Le profil stratégique distant a été sauvegardé, mais l'écriture en local est impossible (quota atteint).",
        error
      );
    } else {
      throw error;
    }
  }
  deckPersonalizationsRemoteHydrated = true;

  return normalizedRemote;
};

const getDeckEvaluation = (deckId) => {
  const personalization = getDeckPersonalization(deckId);
  return personalization?.ratings ?? null;
};

const setDeckEvaluation = async (deckId, evaluation) => {
  if (!deckId || !evaluation || typeof evaluation !== "object") {
    return null;
  }
  const personalization = await setDeckPersonalization(deckId, { ratings: evaluation });
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

const buildPlaygroupDetailEndpoint = (googleSub, playgroupId) => {
  if (!googleSub || !playgroupId) {
    return null;
  }
  return buildBackendUrl(
    `/profiles/${encodeURIComponent(googleSub)}/playgroups/${encodeURIComponent(playgroupId)}`
  );
};

const buildPlayersEndpoint = (googleSub) => {
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(`/profiles/${encodeURIComponent(googleSub)}/players`);
};

const buildAvailablePlayersEndpoint = (googleSub) => {
  const base = buildPlayersEndpoint(googleSub);
  if (!base) {
    return null;
  }
  return `${base}/available`;
};

const buildTrackedPlayerEndpoint = (googleSub, playerId) => {
  if (!googleSub || !playerId) {
    return null;
  }
  return buildBackendUrl(
    `/profiles/${encodeURIComponent(googleSub)}/players/${encodeURIComponent(playerId)}`
  );
};

const buildTrackedPlayerLinkEndpoint = (googleSub, playerId) => {
  const base = buildTrackedPlayerEndpoint(googleSub, playerId);
  if (!base) {
    return null;
  }
  return `${base}/link`;
};

const buildGamesEndpoint = (googleSub) => {
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(`/profiles/${encodeURIComponent(googleSub)}/games`);
};

const buildSocialSearchEndpoint = () => buildBackendUrl("/social/users/search");

const buildPublicProfileEndpoint = (googleSub) => {
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(`/social/users/${encodeURIComponent(googleSub)}`);
};

const buildFollowEndpoint = (followerSub) => {
  if (!followerSub) {
    return null;
  }
  return buildBackendUrl(`/social/users/${encodeURIComponent(followerSub)}/follow`);
};

const buildDeckPersonalizationsEndpoint = (googleSub) => {
  if (!googleSub) {
    return null;
  }
  return buildBackendUrl(
    `/profiles/${encodeURIComponent(googleSub)}/deck-personalizations`
  );
};

const buildDeckPersonalizationDetailEndpoint = (googleSub, deckId) => {
  if (!googleSub || !deckId) {
    return null;
  }
  return buildBackendUrl(
    `/profiles/${encodeURIComponent(googleSub)}/deck-personalizations/${encodeURIComponent(deckId)}`
  );
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

const fetchUserPlaygroupDetail = async (googleSub, playgroupId) => {
  const endpoint = buildPlaygroupDetailEndpoint(googleSub, playgroupId);
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Impossible de récupérer le groupe (${response.status}).`);
    }
    return response.json();
  } catch (error) {
    console.warn("Échec de récupération du détail du groupe :", error);
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

const updateUserPlaygroup = async (googleSub, playgroupId, payload) => {
  const endpoint = buildPlaygroupDetailEndpoint(googleSub, playgroupId);
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload || {}),
    });
    if (response.status === 404) {
      throw new Error("Groupe introuvable");
    }
    if (!response.ok) {
      throw new Error(`Impossible de mettre à jour le groupe (${response.status}).`);
    }
    return response.json();
  } catch (error) {
    console.warn("Échec de la mise à jour du groupe :", error);
    throw error;
  }
};

const deleteUserPlaygroup = async (googleSub, playgroupId) => {
  const endpoint = buildPlaygroupDetailEndpoint(googleSub, playgroupId);
  if (!endpoint) {
    return false;
  }

  try {
    const response = await fetch(endpoint, {
      method: "DELETE",
    });
    if (response.status === 404) {
      throw new Error("Groupe introuvable");
    }
    if (!response.ok) {
      throw new Error(`Impossible de supprimer le groupe (${response.status}).`);
    }
    return true;
  } catch (error) {
    console.warn("Échec de la suppression du groupe :", error);
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

const fetchAvailablePlayers = async (googleSub) => {
  const endpoint = buildAvailablePlayersEndpoint(googleSub);
  if (!endpoint) {
    return { players: [] };
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Impossible de récupérer les joueurs (${response.status}).`);
    }
    const payload = await response.json();
    return {
      players: Array.isArray(payload?.players) ? payload.players : [],
    };
  } catch (error) {
    console.warn("Échec de récupération des joueurs disponibles :", error);
    throw error;
  }
};

const fetchTrackedPlayers = async (googleSub) => {
  const endpoint = buildPlayersEndpoint(googleSub);
  if (!endpoint) {
    return { players: [] };
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Impossible de récupérer les joueurs suivis (${response.status}).`);
    }
    const payload = await response.json();
    return {
      players: Array.isArray(payload?.players) ? payload.players : [],
    };
  } catch (error) {
    console.warn("Échec de récupération des joueurs suivis :", error);
    throw error;
  }
};

const createTrackedPlayer = async (googleSub, name) => {
  const endpoint = buildPlayersEndpoint(googleSub);
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      throw new Error(`Création du joueur impossible (${response.status}).`);
    }
    return response.json();
  } catch (error) {
    console.warn("Échec de création d'un joueur suivi :", error);
    throw error;
  }
};

const updateTrackedPlayer = async (googleSub, playerId, payload) => {
  const endpoint = buildTrackedPlayerEndpoint(googleSub, playerId);
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload || {}),
    });
    if (response.status === 404) {
      throw new Error("Joueur introuvable");
    }
    if (!response.ok) {
      throw new Error(`Impossible de mettre à jour le joueur (${response.status}).`);
    }
    return response.json();
  } catch (error) {
    console.warn("Échec de mise à jour du joueur suivi :", error);
    throw error;
  }
};

const deleteTrackedPlayer = async (googleSub, playerId) => {
  const endpoint = buildTrackedPlayerEndpoint(googleSub, playerId);
  if (!endpoint) {
    return false;
  }

  try {
    const response = await fetch(endpoint, {
      method: "DELETE",
    });
    if (response.status === 404) {
      throw new Error("Joueur introuvable");
    }
    if (!response.ok) {
      throw new Error(`Impossible de supprimer le joueur (${response.status}).`);
    }
    return true;
  } catch (error) {
    console.warn("Échec de suppression du joueur suivi :", error);
    throw error;
  }
};

const linkTrackedPlayer = async (googleSub, playerId, targetSub) => {
  const endpoint = buildTrackedPlayerLinkEndpoint(googleSub, playerId);
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ google_sub: targetSub }),
    });
    if (response.status === 404) {
      throw new Error("Joueur introuvable");
    }
    if (!response.ok) {
      throw new Error(`Impossible de lier le joueur (${response.status}).`);
    }
    return response.json();
  } catch (error) {
    console.warn("Échec du rattachement du joueur :", error);
    throw error;
  }
};

const searchPublicUsers = async ({ query, viewer }) => {
  const endpoint = buildSocialSearchEndpoint();
  if (!endpoint) {
    return [];
  }

  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (viewer) {
    params.set("viewer", viewer);
  }

  const url = params.toString() ? `${endpoint}?${params}` : endpoint;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Recherche impossible (${response.status}).`);
    }
    const payload = await response.json();
    return Array.isArray(payload?.results) ? payload.results : [];
  } catch (error) {
    console.warn("Échec de la recherche d'utilisateurs :", error);
    throw error;
  }
};

const fetchPublicUserProfile = async (googleSub) => {
  const endpoint = buildPublicProfileEndpoint(googleSub);
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Impossible de récupérer le profil public (${response.status}).`);
    }
    return response.json();
  } catch (error) {
    console.warn("Échec de chargement du profil public :", error);
    throw error;
  }
};

const followUserAccount = async (followerSub, targetSub) => {
  const endpoint = buildFollowEndpoint(followerSub);
  if (!endpoint || !targetSub) {
    return false;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target_sub: targetSub }),
    });
    if (!response.ok) {
      throw new Error(`Impossible de suivre cet utilisateur (${response.status}).`);
    }
    return true;
  } catch (error) {
    console.warn("Échec du suivi d'utilisateur :", error);
    throw error;
  }
};

const unfollowUserAccount = async (followerSub, targetSub) => {
  const endpoint = buildFollowEndpoint(followerSub);
  if (!endpoint || !targetSub) {
    return false;
  }

  const url = `${endpoint}/${encodeURIComponent(targetSub)}`;

  try {
    const response = await fetch(url, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`Impossible de se désabonner (${response.status}).`);
    }
    return true;
  } catch (error) {
    console.warn("Échec de la désinscription d'un suivi :", error);
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
