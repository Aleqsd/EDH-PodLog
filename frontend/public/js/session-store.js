(() => {
  const config = window.EDH_PODLOG?.config;
  const apiClient = window.EDH_PODLOG?.api ?? {};
  const deckRemoteApi = apiClient.deckPersonalizations ?? {};
  if (!config) {
    console.warn("EDH PodLog runtime config missing; session store not initialised.");
    return;
  }

  const STORAGE_KEY = config.storageKeys.session;
  const LAST_DECK_STORAGE_KEY = config.storageKeys.lastDeckSelection;
  const LAST_CARD_STORAGE_KEY = config.storageKeys.lastCardSelection;
  const DECK_EVALUATIONS_STORAGE_KEY = config.storageKeys.deckEvaluations;
  const DECK_LAYOUT_STORAGE_KEY = config.storageKeys.deckLayout;

  let currentSession = null;

  const deckPersonalizationCache = new Map();
  let deckPersonalizationOwner = null;
  let deckPersonalizationsBootstrapped = false;
  let deckPersonalizationLoadPromise = null;
  let deckPersonalizationsRemoteHydrated = false;

  const trimMoxfieldDeckForStorage = (deck) => {
    if (!deck || typeof deck !== "object") {
      return null;
    }

    const trimmed = { ...deck };

    if (trimmed.raw && typeof trimmed.raw === "object") {
      const rawDeck = { ...trimmed.raw };

      if (Array.isArray(rawDeck.boards)) {
        rawDeck.boards = rawDeck.boards
          .map((board) => {
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
                          typeof cardEntry.card.cmc === "number" &&
                          Number.isFinite(cardEntry.card.cmc)
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
          })
          .filter(Boolean);
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

  const loadStoredSession = () => {
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
        const quotaError = new Error("Local storage quota exceeded while saving session.");
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
      }
    } catch (error) {
      console.warn("Impossible de charger les personnalisations locales :", error);
    }

    return { owner: null, entries: {} };
  };

  const persistDeckPersonalizationsToStorage = (owner, entries) => {
    try {
      localStorage.setItem(
        DECK_EVALUATIONS_STORAGE_KEY,
        JSON.stringify({
          owner,
          entries,
        })
      );
    } catch (error) {
      if (isQuotaExceededError(error)) {
        const quotaError = new Error(
          "Local storage quota exceeded while saving deck personalizations."
        );
        quotaError.code = "STORAGE_QUOTA";
        throw quotaError;
      }
      throw error;
    }
  };

  const exportDeckPersonalizationsForStorage = () => {
    const entries = {};
    deckPersonalizationCache.forEach((value, key) => {
      entries[key] = value;
    });
    return entries;
  };

  const LEGACY_DECK_RATING_KEY_MAP = {
    "power-level": "construction",
    powerLevel: "construction",
    power: "construction",
    fun: "interaction",
    speed: "acceleration",
    removal: "interaction",
    tutor: "construction",
    draw: "construction",
    protection: "resilience",
    resilience: "resilience",
    interactivity: "interaction",
    consistency: "stability",
  };

  const clampDeckRatingValue = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return null;
    }
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
    if (currentSession) {
      return currentSession;
    }
    return loadStoredSession();
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
    return { ...entry };
  };

  ;

  ;

  ;

  ;

  const ensureDeckPersonalizationsSynced = async (session = null) => {
    const activeSession = session ?? getActiveSession();
    const googleSub = activeSession?.googleSub ?? null;

    if (!googleSub) {
      deckPersonalizationsBootstrapped = false;
      deckPersonalizationOwner = null;
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
      if (!deckRemoteApi.list) {
        deckPersonalizationsRemoteHydrated = true;
        return;
      }
      deckPersonalizationLoadPromise = Promise.resolve(deckRemoteApi.list(googleSub))
        .then((entries) => {
          deckPersonalizationsRemoteHydrated = true;
          if (Array.isArray(entries)) {
            deckPersonalizationCache.clear();
            entries.forEach((entry) => {
              if (!entry || !entry.deckId) {
                return;
              }
              deckPersonalizationCache.set(entry.deckId, normalizeDeckPersonalizationEntry(entry));
            });
            persistDeckPersonalizationsToStorage(
              googleSub,
              exportDeckPersonalizationsForStorage()
            );
          }
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

    const remote = deckRemoteApi.upsert
      ? await deckRemoteApi.upsert(googleSub, deckId, payload)
      : payload;
    const normalizedRemote = normalizeDeckPersonalizationEntry(remote);
    normalizedRemote.deckId =
      normalizedRemote.deckId && normalizedRemote.deckId.trim().length > 0
        ? normalizedRemote.deckId
        : deckId;
    if (
      typeof normalizedRemote.updatedAt !== "number" ||
      !Number.isFinite(normalizedRemote.updatedAt)
    ) {
      normalizedRemote.updatedAt = Date.now();
    }
    if (
      typeof normalizedRemote.createdAt !== "number" ||
      !Number.isFinite(normalizedRemote.createdAt)
    ) {
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
    const current = loadStoredSession();
    if (!current) {
      return null;
    }

    const draft = cloneSession(current);
    const result = mutator ? mutator(draft) ?? draft : draft;
    return persistSession(result);
  };

  const sessionStore = {
    get storageKeys() {
      return {
        session: STORAGE_KEY,
        lastDeck: LAST_DECK_STORAGE_KEY,
        lastCard: LAST_CARD_STORAGE_KEY,
        deckEvaluations: DECK_EVALUATIONS_STORAGE_KEY,
        deckLayout: DECK_LAYOUT_STORAGE_KEY,
      };
    },

    load: loadStoredSession,
    persist: persistSession,
    clear: clearSession,

    getCurrent() {
      return currentSession;
    },

    setCurrent(session) {
      currentSession = session;
      return currentSession;
    },

    getActive: getActiveSession,
    update: updateSessionData,
    clone: cloneSession,

    deckPersonalizations: {
      bootstrapCache: bootstrapDeckPersonalizationCache,
      ensureSynced: ensureDeckPersonalizationsSynced,
      get: getDeckPersonalization,
      set: setDeckPersonalization,
      getEvaluation: getDeckEvaluation,
      setEvaluation: setDeckEvaluation,
      exportForStorage: exportDeckPersonalizationsForStorage,
    },
  };

  window.EDH_PODLOG.session = sessionStore;
})();
