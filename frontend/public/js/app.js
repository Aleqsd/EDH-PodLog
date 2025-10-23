const STORAGE_KEY = "edhPodlogSession";
const LAST_DECK_STORAGE_KEY = "edhPodlogLastDeckSelection";
const LAST_CARD_STORAGE_KEY = "edhPodlogLastCardSelection";
const CONFIG = window.EDH_PODLOG_CONFIG ?? {};
const GOOGLE_CLIENT_ID = CONFIG.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_SCOPES = "openid email profile";
const GOOGLE_CONFIG_PLACEHOLDER = "REMPLACEZ_MOI_PAR_VOTRE_CLIENT_ID";
const API_BASE_URL = (() => {
  const base = CONFIG.API_BASE_URL || "http://localhost:4310";
  return base.endsWith("/") ? base.replace(/\/+$/, "") : base;
})();

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
  mainboard: "Bibliothèque principale",
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
        window.sessionStorage.setItem(
          LAST_DECK_STORAGE_KEY,
          JSON.stringify({ deckId, handle })
        );
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

const handleDeckSelectionConfirm = async () => {
  if (!pendingDeckSelection) {
    closeDeckSelectionModal();
    return;
  }

  const selections = gatherDeckSelection();
  if (selections.length === 0) {
    showMoxfieldStatus("Sélectionnez au moins un deck à importer.", "neutral");
    return;
  }

  const { handle, totalDecks, user } = pendingDeckSelection;
  closeDeckSelectionModal("confirm");
  await performDeckSync(handle, selections, { totalDecks, user });
};

const renderMoxfieldPanel = (session, { preserveStatus = false } = {}) => {
  if (!moxfieldHandleInput || !moxfieldSyncButton) {
    return;
  }

  const integration = getMoxfieldIntegration(session);
  const handle = integration?.handle ?? "";

  if (moxfieldHandleInput) {
    moxfieldHandleInput.value = handle;
  }

  if (moxfieldSyncButton && !moxfieldSyncButton.classList.contains("is-loading")) {
    moxfieldSyncButton.innerHTML = `<span class="button-label">${defaultSyncLabel}</span>`;
    moxfieldSyncButton.disabled = !handle;
  }

  if (moxfieldSaveButton) {
    moxfieldSaveButton.disabled = false;
  }

  if (moxfieldMetaEl) {
    if (integration?.lastSyncedAt) {
      const sourceLabel =
        integration.lastSource === "cache"
          ? "depuis le cache"
          : integration.lastSource === "live"
          ? "via Moxfield"
          : "";
      const descriptor = sourceLabel ? ` ${sourceLabel}` : "";
      moxfieldMetaEl.textContent = `Dernière synchronisation${descriptor} le ${formatDateTime(
        integration.lastSyncedAt
      )}`;
    } else if (handle) {
      moxfieldMetaEl.textContent = "Jamais synchronisé";
    } else {
      moxfieldMetaEl.textContent =
        "Renseignez votre pseudo Moxfield pour activer la synchronisation.";
    }
  }

  if (!preserveStatus) {
    const message = integration?.lastSyncMessage ?? "";
    const status = integration?.lastSyncStatus ?? "neutral";
    showMoxfieldStatus(
      message,
      status === "error" ? "error" : status === "success" ? "success" : "neutral"
    );
  }

  updateMoxfieldDeckSummary(session);
  refreshDeckCollection(session);
};

const setMoxfieldSyncLoading = (isLoading) => {
  if (!moxfieldSyncButton) {
    return;
  }

  if (isLoading) {
    moxfieldSyncButton.classList.add("is-loading");
    moxfieldSyncButton.setAttribute("aria-busy", "true");
    moxfieldSyncButton.innerHTML =
      '<span class="button-spinner" aria-hidden="true"></span><span class="button-label">Synchronisation…</span>';
    moxfieldSyncButton.disabled = true;
  } else {
    moxfieldSyncButton.classList.remove("is-loading");
    moxfieldSyncButton.removeAttribute("aria-busy");
    moxfieldSyncButton.innerHTML = `<span class="button-label">${defaultSyncLabel}</span>`;
    const hasHandle = Boolean(moxfieldHandleInput?.value.trim());
    moxfieldSyncButton.disabled = !hasHandle;
  }
};

const redirectToLanding = () => {
  window.location.replace("index.html");
};

const revokeGoogleToken = (token) => {
  if (!token) {
    return;
  }

  if (window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
};

const fetchGoogleUserInfo = async (accessToken) => {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Impossible de récupérer le profil Google (${response.status})`);
  }

  return response.json();
};

const buildSessionFromGoogle = (userInfo, tokenResponse, previousSession) => {
  const now = Date.now();
  const userName =
    userInfo.name || userInfo.given_name || previousSession?.userName || "Utilisateur";
  const email = userInfo.email || previousSession?.email || "";
  const initials = computeInitials(userName);

  return {
    provider: "google",
    accessToken: tokenResponse.access_token,
    tokenExpiresAt: tokenResponse.expires_in
      ? now + tokenResponse.expires_in * 1000
      : previousSession?.tokenExpiresAt ?? null,
    userName,
    email,
    picture: userInfo.picture || previousSession?.picture || "",
    initials,
    googleSub: userInfo.sub,
    createdAt: previousSession?.createdAt ?? now,
    updatedAt: now,
    integrations: previousSession?.integrations ?? {},
  };
};

const handleGoogleTokenResponse = async (tokenResponse) => {
  if (!tokenResponse || tokenResponse.error) {
    console.error("Échec de Google OAuth :", tokenResponse?.error);
    setSignInButtonLoading(false);
    window.alert(
      "La connexion Google a échoué. Merci de réessayer dans quelques instants."
    );
    return;
  }

  googleAccessToken = tokenResponse.access_token;

  try {
    const userInfo = await fetchGoogleUserInfo(tokenResponse.access_token);
    const previousSession = getSession();
    const session = buildSessionFromGoogle(userInfo, tokenResponse, previousSession);

    let mergedSession = session;
    if (session.googleSub) {
      const identityPayload = {
        display_name: session.userName,
        email: session.email || null,
        picture: session.picture || null,
      };
      if (userInfo.given_name) {
        identityPayload.given_name = userInfo.given_name;
      }

      try {
        const profile = await upsertBackendProfile(session.googleSub, identityPayload);
        if (profile) {
          mergedSession = applyProfileToSession(session, profile);
        }
      } catch (profileError) {
        console.warn("Impossible de synchroniser le profil Google :", profileError);
      }
    }

    persistSession(mergedSession);
    googleAccessToken = mergedSession.accessToken;
    window.location.href = "dashboard.html";
  } catch (error) {
    console.error("Impossible de terminer la connexion Google :", error);
    window.alert(
      "Nous n'avons pas pu récupérer votre profil Google. Vérifiez les autorisations et réessayez."
    );
    setSignInButtonLoading(false);
  }
};

const initializeGoogleAuth = () => {
  if (!window.google?.accounts?.oauth2) {
    return;
  }

  if (!isGoogleClientConfigured()) {
    console.warn("Client Google OAuth manquant. Configurez-le dans config.js.");
    updateSignInButtonState();
    return;
  }

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: handleGoogleTokenResponse,
  });

  isGoogleLibraryReady = true;
  updateSignInButtonState();
};

const setSignInButtonLabel = (text) => {
  if (!landingSignInButton) {
    return;
  }

  const label = landingSignInButton.querySelector("span");
  if (label) {
    label.textContent = text;
  }
};

const setSignInButtonDisabled = (disabled) => {
  if (!landingSignInButton) {
    return;
  }

  landingSignInButton.disabled = Boolean(disabled);
};

const setFootnoteText = (text) => {
  if (landingFootnoteTextEl) {
    landingFootnoteTextEl.textContent = text;
  }
};

const explainMissingGoogleConfig = () => {
  if (!landingSignInButton) {
    return;
  }

  landingSignInButton.classList.add("is-disabled");
  setSignInButtonDisabled(true);
  setSignInButtonLabel("Configurer Google OAuth");
  setFootnoteText(
    "Ajoutez votre identifiant client Google dans config.js pour activer la connexion."
  );
};

const setSignInButtonLoading = (isLoading) => {
  if (!landingSignInButton) {
    return;
  }

  landingSignInButton.classList.toggle("is-loading", Boolean(isLoading));
  setSignInButtonDisabled(isLoading);
  if (isLoading) {
    setSignInButtonLabel("Connexion…");
  } else {
    setSignInButtonLabel(defaultSignInLabel);
  }
};

const updateSignInButtonState = () => {
  if (!landingSignInButton) {
    return;
  }

  if (!isGoogleClientConfigured()) {
    explainMissingGoogleConfig();
    return;
  }

  if (!isGoogleLibraryReady) {
    setSignInButtonDisabled(true);
    setSignInButtonLabel("Chargement de Google…");
    setFootnoteText(defaultFootnoteText);
    return;
  }

  landingSignInButton.classList.remove("is-disabled");
  setSignInButtonDisabled(false);
  setSignInButtonLabel(defaultSignInLabel);
  setFootnoteText(defaultFootnoteText);
};

const MOXFIELD_HANDLE_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;

const validateMoxfieldHandle = (value) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return { valid: false, reason: "empty" };
  }

  if (!MOXFIELD_HANDLE_REGEX.test(trimmed)) {
    return { valid: false, reason: "format" };
  }

  return { valid: true, normalized: trimmed };
};

const normalizeMoxfieldDeck = (deck) => {
  if (!deck || typeof deck !== "object") {
    return null;
  }

  const slugFromUrl =
    typeof deck.public_url === "string"
      ? deck.public_url.split("/").filter(Boolean).pop()
      : null;

  const slug =
    deck.publicId ||
    deck.public_id ||
    slugFromUrl ||
    deck.id ||
    deck.deckId ||
    deck.slug ||
    deck.publicSlug ||
    deck.publicDeckId ||
    null;

  const url =
    typeof deck.public_url === "string"
      ? deck.public_url
      : slug
      ? `https://www.moxfield.com/decks/${slug}`
      : null;

  const updatedAt =
    deck.updatedAt ||
    deck.updatedAtUtc ||
    deck.modifiedOn ||
    deck.lastUpdated ||
    deck.last_updated_at ||
    deck.createdAt ||
    deck.created_at ||
    null;

  const cardCount = (() => {
    if (typeof deck.cardCount === "number") {
      return deck.cardCount;
    }
    if (typeof deck.mainboardCount === "number") {
      return deck.mainboardCount;
    }
    if (Array.isArray(deck.mainboard)) {
      return deck.mainboard.length;
    }
    if (Array.isArray(deck.boards)) {
      return deck.boards.reduce((total, board) => {
        if (typeof board?.count === "number") {
          return total + board.count;
        }
        if (Array.isArray(board?.cards)) {
          return (
            total +
            board.cards.reduce(
              (sum, card) =>
                sum + (typeof card?.quantity === "number" ? card.quantity : 0),
              0
            )
          );
        }
        return total;
      }, 0);
    }
    return null;
  })();

  return {
    id: slug || deck.id || deck.deckId || deck.public_id || null,
    slug,
    name: deck.name || "Deck sans nom",
    format:
      deck.format ||
      deck.formatType ||
      deck.deckFormat ||
      deck.format_name ||
      deck.formatName ||
      "—",
    updatedAt,
    cardCount,
    url,
    publicId: deck.public_id || deck.publicId || null,
    raw: deck,
  };
};

const fetchDecksFromBackend = async (
  handle,
  { signal, mode = "cache-only" } = {}
) => {
  const trimmedHandle = handle?.trim();
  if (!trimmedHandle) {
    const invalidHandleError = new Error("Pseudo Moxfield introuvable.");
    invalidHandleError.code = "NOT_FOUND";
    throw invalidHandleError;
  }

  const encodedHandle = encodeURIComponent(trimmedHandle);
  const endpoint =
    mode === "live"
      ? `/users/${encodedHandle}/decks`
      : `/cache/users/${encodedHandle}/decks`;

  let response;
  try {
    response = await fetch(buildBackendUrl(endpoint), {
      signal,
      headers: {
        Accept: "application/json",
      },
    });
  } catch (error) {
    const networkError = new Error(
      "Impossible de contacter l'API EDH PodLog pour le moment. Réessayez plus tard."
    );
    networkError.code = "NETWORK";
    throw networkError;
  }

  if (response.status === 404) {
    if (mode === "cache-only") {
      const cacheMissError = new Error("Aucune donnée en cache pour ce pseudo.");
      cacheMissError.code = "CACHE_MISS";
      throw cacheMissError;
    }
    const notFoundError = new Error("Pseudo Moxfield introuvable.");
    notFoundError.code = "NOT_FOUND";
    throw notFoundError;
  }

  if (!response.ok) {
    const httpError = new Error(
      `L'API EDH PodLog a renvoyé une erreur (${response.status}).`
    );
    httpError.code = "HTTP_ERROR";
    httpError.status = response.status;
    throw httpError;
  }

  const payload = await response.json();
  const rawDecks = Array.isArray(payload?.decks) ? payload.decks : [];

  const decks = rawDecks
    .map((deck) => normalizeMoxfieldDeck(deck))
    .filter(Boolean)
    .map((deck) => ({
      ...deck,
      source: mode === "live" ? "live" : "cache",
    }));

  decks.sort((a, b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return timeB - timeA;
  });

  const totalDecks =
    typeof payload?.total_decks === "number"
      ? payload.total_decks
      : typeof payload?.totalDecks === "number"
      ? payload.totalDecks
      : decks.length;

  return {
    decks,
    totalDecks,
    user: payload?.user ?? null,
    source: mode === "live" ? "live" : "cache",
  };
};

const fetchDeckSummariesFromBackend = async (handle, signal) => {
  const trimmedHandle = handle?.trim();
  if (!trimmedHandle) {
    const invalidHandleError = new Error("Pseudo Moxfield introuvable.");
    invalidHandleError.code = "NOT_FOUND";
    throw invalidHandleError;
  }

  const encodedHandle = encodeURIComponent(trimmedHandle);
  let response;
  try {
    response = await fetch(buildBackendUrl(`/users/${encodedHandle}/deck-summaries`), {
      signal,
      headers: {
        Accept: "application/json",
      },
    });
  } catch (error) {
    const networkError = new Error(
      "Impossible de contacter l'API EDH PodLog pour le moment. Réessayez plus tard."
    );
    networkError.code = "NETWORK";
    throw networkError;
  }

  if (response.status === 404) {
    const notFoundError = new Error("Pseudo Moxfield introuvable.");
    notFoundError.code = "NOT_FOUND";
    throw notFoundError;
  }

  if (!response.ok) {
    const httpError = new Error(
      `L'API EDH PodLog a renvoyé une erreur (${response.status}).`
    );
    httpError.code = "HTTP_ERROR";
    httpError.status = response.status;
    throw httpError;
  }

  const payload = await response.json();
  const rawDecks = Array.isArray(payload?.decks) ? payload.decks : [];
  const decks = rawDecks
    .map((deck) => normalizeMoxfieldDeck(deck))
    .filter(Boolean)
    .map((deck) => ({
      ...deck,
      source: "preview",
    }));

  decks.sort((a, b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return timeB - timeA;
  });

  const totalDecks =
    typeof payload?.total_decks === "number"
      ? payload.total_decks
      : typeof payload?.totalDecks === "number"
      ? payload.totalDecks
      : decks.length;

  return {
    decks,
    totalDecks,
    user: payload?.user ?? null,
  };
};

const syncMoxfieldDecks = async (handle, signal) => {
  try {
    return await fetchDecksFromBackend(handle, { signal, mode: "live" });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    if (error.code) {
      throw error;
    }

    const networkError = new Error(
      "Impossible de contacter l'API EDH PodLog pour le moment. Réessayez plus tard."
    );
    networkError.code = "NETWORK";
    throw networkError;
  }
};

const collectDeckBoards = (deck) =>
  Array.isArray(deck?.raw?.boards)
    ? deck.raw.boards
        .map((board) => ({
          name: board.name || "",
          count: board.count || 0,
          cards: Array.isArray(board?.cards)
            ? board.cards
                .map((entry) => {
                  if (!entry || typeof entry !== "object" || !entry.card) {
                    return null;
                  }
                  const card = entry.card;
                  return {
                    card,
                    quantity:
                      typeof entry.quantity === "number" && Number.isFinite(entry.quantity)
                        ? entry.quantity
                        : 0,
                  };
                })
                .filter(Boolean)
            : [],
        }))
        .filter(Boolean)
    : [];

const collectDeckCards = (deck) => {
  const boards = collectDeckBoards(deck);
  return boards.flatMap((board) =>
    board.cards.map((entry) => ({
      board,
      entry,
    }))
  );
};

const findCardInDeckById = (deck, cardId) => {
  if (!deck || !cardId) {
    return null;
  }
  const normalizedCardId = String(cardId).toLowerCase();
  const boards = collectDeckBoards(deck);
  for (const board of boards) {
    const cards = Array.isArray(board?.cards) ? board.cards : [];
    for (const cardEntry of cards) {
      const cardData = cardEntry?.card;
      if (!cardData) {
        continue;
      }
      const identifiers = [
        cardData.id,
        cardData.card_id,
        cardData.uniqueCardId,
        cardData.unique_card_id,
        cardData.scryfall_id,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      if (identifiers.includes(normalizedCardId)) {
        return { board, entry: cardEntry };
      }
    }
  }
  return null;
};

const formatManaCostText = (manaCost) => {
  const symbols = extractManaSymbols(manaCost);
  if (symbols.length > 0) {
    return symbols.join(" ");
  }
  return typeof manaCost === "string" && manaCost.trim().length > 0
    ? manaCost.trim()
    : "—";
};

const formatManaBreakdownText = (manaCost) => {
  const summary = summariseManaCost(manaCost);
  if (summary.length === 0) {
    return "—";
  }
  return summary
    .map(({ description, count }) => (count > 1 ? `${description} ×${count}` : description))
    .join(" · ");
};

const ensureDeckDetails = async (deckId, { handle, preferLive = false } = {}) => {
  if (!deckId) {
    return { deck: null, session: getSession() };
  }

  let session = getSession();
  const integration = getMoxfieldIntegration(session);
  const effectiveHandle =
    handle ||
    integration?.handle ||
    integration?.handleLower ||
    integration?.lastUser?.user_name ||
    null;

  let deck = findDeckInIntegration(integration, deckId);
  if (deck && deckHasCardDetails(deck)) {
    return { deck, session };
  }

  if (!effectiveHandle) {
    return { deck, session };
  }

  const fetchOrder = preferLive ? ["live", "cache-only"] : ["cache-only", "live"];

  for (const mode of fetchOrder) {
    try {
      const payload = await fetchDecksFromBackend(effectiveHandle, {
        mode,
      });

      if (!payload || !Array.isArray(payload.decks)) {
        continue;
      }

      const matched = payload.decks.find(
        (candidate) => getDeckIdentifier(candidate) === deckId
      );

      if (!matched) {
        continue;
      }

      try {
        setMoxfieldIntegration((current) => replaceDeckInIntegration(current, matched));
      } catch (storageError) {
        if (storageError?.code === "STORAGE_QUOTA") {
          console.warn(
            "Stockage local saturé lors de la mise à jour du deck. Les détails ne seront pas conservés pour la session.",
            storageError
          );
        } else {
          throw storageError;
        }
      }
      session = getSession();
      const refreshed = findDeckInIntegration(getMoxfieldIntegration(session), deckId);
      if (refreshed && deckHasCardDetails(refreshed)) {
        return { deck: refreshed, session };
      }
      deck = matched;
    } catch (error) {
      if (mode === "cache-only") {
        if (error.code && error.code !== "CACHE_MISS") {
          console.warn("Lecture du cache impossible :", error);
        }
      } else if (error.code === "NOT_FOUND") {
        throw error;
      } else {
        console.warn("Synchronisation en direct impossible :", error);
      }
    }
  }

  return { deck, session };
};

if (typeof window !== "undefined") {
  window.EDH_PODLOG_INTERNAL = {
    validateMoxfieldHandle,
    normalizeMoxfieldDeck,
  };
}

window.addEventListener("google-loaded", initializeGoogleAuth);

document.addEventListener("DOMContentLoaded", async () => {
  landingSignInButton = document.getElementById("googleSignIn");
  const footnote = document.querySelector(".signin-footnote .footnote-text");
  landingFootnoteTextEl = footnote ?? null;
  if (landingFootnoteTextEl && landingFootnoteTextEl.textContent.trim().length > 0) {
    defaultFootnoteText = landingFootnoteTextEl.textContent.trim();
  }

  const yearEl = document.getElementById("footerYear");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  const profileMenuButton = document.getElementById("profileMenuButton");
  const profileMenu = document.getElementById("profileMenu");
  const signOutBtn = document.getElementById("signOutBtn");
  const profileLink = document.querySelector(
    '.dropdown-link[href="profile.html"], .dropdown-link[href="./profile.html"]'
  );
  const profileHref = profileLink
    ? new URL(profileLink.getAttribute("href") || "profile.html", window.location.href).href
    : new URL("profile.html", window.location.href).href;
  const requireAuthFlag =
    document.body?.dataset?.requireAuth &&
    document.body.dataset.requireAuth.toLowerCase() === "true";

  let currentSession = getSession();
  let cachedDecksController = null;
  const pageType = document.body?.dataset?.page ?? "";

  const deckTitleEl = document.getElementById("deckTitle");
  const deckMetaEl = document.getElementById("deckMeta");
  const deckDescriptionEl = document.getElementById("deckDescription");
  const deckBoardsEl = document.getElementById("deckBoards");
  const deckErrorEl = document.getElementById("deckError");
  const deckLoadingEl = document.getElementById("deckLoading");
  const deckHandleBadgeEl = document.getElementById("deckHandleBadge");
  const deckHeroImageEl = document.getElementById("deckHeroImage");

  const cardTitleEl = document.getElementById("cardTitle");
  const cardSubtitleEl = document.getElementById("cardSubtitle");
  const cardManaCostEl = document.getElementById("cardManaCost");
  const cardManaBreakdownEl = document.getElementById("cardManaBreakdown");
  const cardOracleEl = document.getElementById("cardOracle");
  const cardImageEl = document.getElementById("cardImage");
  const cardInfoListEl = document.getElementById("cardInfoList");
  const cardErrorEl = document.getElementById("cardError");
  const cardLoadingEl = document.getElementById("cardLoading");
  const cardBoardEl = document.getElementById("cardBoard");
  const cardQuantityEl = document.getElementById("cardQuantity");
  const cardBackLinkEl = document.getElementById("cardBackLink");

  const setDeckLoading = (isLoading) => {
    if (deckLoadingEl) {
      deckLoadingEl.classList.toggle("is-hidden", !isLoading);
    }
  };

  const setCardLoading = (isLoading) => {
    if (cardLoadingEl) {
      cardLoadingEl.classList.toggle("is-hidden", !isLoading);
    }
  };

  const showDeckError = (message) => {
    if (!deckErrorEl) {
      return;
    }
    deckErrorEl.textContent = message ?? "";
    deckErrorEl.classList.toggle("is-hidden", !message);
  };

  const showCardError = (message) => {
    if (!cardErrorEl) {
      return;
    }
    cardErrorEl.textContent = message ?? "";
    cardErrorEl.classList.toggle("is-hidden", !message);
  };

const renderDeckBoards = (deck, { handle } = {}) => {
  if (!deckBoardsEl) {
    return;
  }
  deckBoardsEl.innerHTML = "";

  const boards = collectDeckBoards(deck);
  if (boards.length === 0) {
      const empty = document.createElement("p");
      empty.className = "deck-board-empty";
      empty.textContent =
        "Impossible de trouver la liste des cartes pour ce deck. Relancez une synchronisation.";
      deckBoardsEl.appendChild(empty);
      return;
    }

  const deckId = getDeckIdentifier(deck);

  const commanderImages = [];

  boards.forEach((board) => {
    const cards = Array.isArray(board?.cards) ? [...board.cards] : [];
    if (cards.length === 0) {
      return;
    }

    if (board?.name && board.name.toLowerCase() === "commanders") {
      cards.forEach((cardEntry) => {
        const commanderCard = cardEntry?.card;
        if (!commanderCard) {
          return;
        }
        const baseId =
          commanderCard.id ||
          commanderCard.card_id ||
          commanderCard.uniqueCardId ||
          commanderCard.scryfall_id;
        if (baseId) {
          commanderImages.push({
            id: baseId,
            name: commanderCard.name || "",
          });
        }
      });
    }

    cards.sort((a, b) => {
        const nameA = a?.card?.name ?? "";
        const nameB = b?.card?.name ?? "";
        return nameA.localeCompare(nameB, "fr", { sensitivity: "base" });
      });

      const section = document.createElement("section");
      section.className = "deck-board";

      const header = document.createElement("header");
      header.className = "deck-board-header";
      const title = document.createElement("h2");
      title.className = "deck-board-title";
      const boardLabel = humanizeBoardName(board?.name);
      const cardCount = typeof board?.count === "number" ? board.count : cards.length;
      title.textContent = `${boardLabel} (${cardCount})`;
      header.appendChild(title);
      section.appendChild(header);

      const table = document.createElement("table");
      table.className = "card-table";
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      ["Qté", "Carte", "Type", "Coût", "Énergies"].forEach((label) => {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = label;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      cards.forEach((cardEntry) => {
        const cardData = cardEntry?.card ?? {};
        const row = document.createElement("tr");
        row.className = "card-table-row";

        const quantityCell = document.createElement("td");
        quantityCell.textContent = String(cardEntry?.quantity ?? 1);
        quantityCell.className = "card-table-quantity";

        const nameCell = document.createElement("td");
        nameCell.className = "card-table-name";
        if (cardData?.name) {
          const link = document.createElement("a");
          link.className = "card-link";
          const primaryId =
            cardData.id || cardData.card_id || cardData.uniqueCardId || cardData.scryfall_id;
          if (deckId && primaryId) {
            link.href = `card.html?deck=${encodeURIComponent(
              deckId
            )}&card=${encodeURIComponent(primaryId)}`;
            link.addEventListener("click", () => {
              try {
                window.sessionStorage.setItem(
                  LAST_CARD_STORAGE_KEY,
                  JSON.stringify({ deckId, cardId: primaryId, handle: handle || null })
                );
              } catch (error) {
                console.warn("Impossible d'enregistrer la sélection de la carte :", error);
              }
            });
          } else {
            link.href = "#";
          }
          link.textContent = cardData.name;
          nameCell.appendChild(link);
        } else {
          nameCell.textContent = "Carte inconnue";
        }

        const typeCell = document.createElement("td");
        typeCell.className = "card-table-type";
        typeCell.textContent = cardData?.type_line ?? "—";

        const manaCostCell = document.createElement("td");
        manaCostCell.className = "card-table-mana";
        manaCostCell.textContent = formatManaCostText(cardData?.mana_cost);

        const energyCell = document.createElement("td");
        energyCell.className = "card-table-energy";
        energyCell.textContent = formatManaBreakdownText(cardData?.mana_cost);

        [quantityCell, nameCell, typeCell, manaCostCell, energyCell].forEach((cell) =>
          row.appendChild(cell)
        );

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      section.appendChild(table);
      deckBoardsEl.appendChild(section);
  });

  if (deckHeroImageEl) {
    if (commanderImages.length > 0) {
      const primaryCommander = commanderImages[0];
      deckHeroImageEl.src = `https://assets.moxfield.net/cards/card-${primaryCommander.id}-normal.webp`;
      deckHeroImageEl.alt = primaryCommander.name
        ? `Illustration de ${primaryCommander.name}`
        : "Illustration du commandant";
      deckHeroImageEl.classList.remove("is-hidden");
    } else {
      deckHeroImageEl.classList.add("is-hidden");
      deckHeroImageEl.removeAttribute("src");
      deckHeroImageEl.removeAttribute("alt");
    }
  }
};

  const populateDeckDetail = (deck, { handle } = {}) => {
    if (!deck) {
      showDeckError("Ce deck n'a pas pu être trouvé.");
      return;
    }

    showDeckError("");
    if (deckTitleEl) {
      deckTitleEl.textContent = deck?.name ?? "Deck sans nom";
    }

    if (deckDescriptionEl) {
      const description =
        deck?.raw?.description ??
        deck?.description ??
        (deck?.raw?.summary ?? deck?.summary ?? "").trim();
      deckDescriptionEl.textContent =
        description && description.length > 0
          ? description
          : "Ce deck ne contient pas de description pour le moment.";
    }

    if (deckHandleBadgeEl) {
      const sourceHandle =
        handle ||
        deck?.raw?.created_by?.user_name ||
        deck?.raw?.authors?.[0]?.user_name ||
        null;
      if (sourceHandle) {
        deckHandleBadgeEl.textContent = `Prélevé depuis Moxfield (${sourceHandle})`;
        deckHandleBadgeEl.classList.remove("is-hidden");
      } else {
        deckHandleBadgeEl.textContent = "";
        deckHandleBadgeEl.classList.add("is-hidden");
      }
    }

    if (deckMetaEl) {
      const parts = [];
      if (deck?.format) {
        parts.push(deck.format.toUpperCase());
      }
      const totalCards = Array.isArray(deck?.raw?.boards)
        ? deck.raw.boards.reduce((sum, board) => {
            const boardCards = Array.isArray(board?.cards) ? board.cards : [];
            return (
              sum +
              boardCards.reduce(
                (acc, cardEntry) => acc + (typeof cardEntry?.quantity === "number" ? cardEntry.quantity : 1),
                0
              )
            );
          }, 0)
        : null;
      if (typeof totalCards === "number" && totalCards > 0) {
        parts.push(`${totalCards} cartes`);
      } else if (typeof deck?.cardCount === "number" && deck.cardCount > 0) {
        parts.push(`${deck.cardCount} cartes`);
      }
      const updatedValue = deck?.updatedAt ?? deck?.raw?.last_updated_at ?? deck?.lastUpdatedAt;
      if (updatedValue) {
        parts.push(`Mis à jour le ${formatDateTime(updatedValue, { dateStyle: "medium" })}`);
      }
      if (deck?.raw?.synced_at || deck?.syncedAt) {
        parts.push(
          `Synchronisation ${formatDateTime(deck.raw?.synced_at ?? deck.syncedAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}`
        );
      }
      deckMetaEl.textContent = parts.join(" · ");
    }

    renderDeckBoards(deck, { handle });
  };

  const populateCardDetail = (deck, cardContext, { handle } = {}) => {
    if (!cardContext) {
      showCardError("Cette carte est introuvable dans le deck sélectionné.");
      return;
    }

    showCardError("");

    const { entry, board } = cardContext;
    const cardData = entry?.card ?? {};

    if (cardBackLinkEl) {
      const deckId = getDeckIdentifier(deck);
      if (deckId) {
        const backUrl = handle
          ? `deck.html?deck=${encodeURIComponent(deckId)}&handle=${encodeURIComponent(handle)}`
          : `deck.html?deck=${encodeURIComponent(deckId)}`;
        cardBackLinkEl.href = backUrl;
      } else {
        cardBackLinkEl.href = "decks.html";
      }
    }

    if (cardTitleEl) {
      cardTitleEl.textContent = cardData?.name ?? "Carte inconnue";
    }

    if (cardSubtitleEl) {
      const subtitleParts = [];
      if (deck?.name) {
        subtitleParts.push(deck.name);
      }
      if (board?.name) {
        subtitleParts.push(humanizeBoardName(board.name));
      }
      cardSubtitleEl.textContent =
        subtitleParts.length > 0 ? subtitleParts.join(" · ") : "Deck importé";
    }

    if (cardBoardEl) {
      cardBoardEl.textContent = board?.name ? humanizeBoardName(board.name) : "Section inconnue";
    }

    if (cardQuantityEl) {
      cardQuantityEl.textContent = `Quantité importée : ${entry?.quantity ?? 1}`;
    }

    if (cardManaCostEl) {
      cardManaCostEl.textContent = formatManaCostText(cardData?.mana_cost);
    }

    if (cardManaBreakdownEl) {
      cardManaBreakdownEl.textContent = formatManaBreakdownText(cardData?.mana_cost);
    }

    if (cardOracleEl) {
      const oracleText =
        cardData?.oracle_text ??
        (Array.isArray(cardData?.faces)
          ? cardData.faces
              .map((face) => `${face?.name ?? ""} — ${face?.oracle_text ?? ""}`.trim())
              .join("\n\n")
          : "");
      const hasOracle = oracleText && oracleText.trim().length > 0;
      cardOracleEl.textContent = hasOracle
        ? oracleText
        : "Cette carte ne possède pas de texte d'oracle.";
      cardOracleEl.classList.toggle("is-placeholder", !hasOracle);
    }

    if (cardImageEl) {
      const baseId =
        cardData?.id || cardData?.card_id || cardData?.uniqueCardId || cardData?.scryfall_id;
      if (baseId) {
        cardImageEl.src = `https://assets.moxfield.net/cards/card-${baseId}-normal.webp`;
        cardImageEl.alt = cardData?.name ?? "Illustration de la carte";
        cardImageEl.classList.remove("is-hidden");
      } else {
        cardImageEl.classList.add("is-hidden");
        cardImageEl.removeAttribute("src");
        cardImageEl.removeAttribute("alt");
      }
    }

    if (cardInfoListEl) {
      cardInfoListEl.innerHTML = "";

      const addInfoItem = (label, value) => {
        if (!value) {
          return;
        }
        const li = document.createElement("li");
        li.innerHTML = `<strong>${label} :</strong> ${value}`;
        cardInfoListEl.appendChild(li);
      };

      addInfoItem("Type", cardData?.type_line ?? null);

      if (cardData?.power || cardData?.toughness) {
        addInfoItem("Caractéristiques", `${cardData?.power ?? "?"}/${cardData?.toughness ?? "?"}`);
      } else if (cardData?.loyalty) {
        addInfoItem("Loyauté", cardData.loyalty);
      }

      const colors = Array.isArray(cardData?.color_identity)
        ? cardData.color_identity.join(", ")
        : null;
      addInfoItem("Identité de couleur", colors);

      if (cardData?.set_name || cardData?.set) {
        const setLabel = cardData?.set_name
          ? `${cardData.set_name}${cardData?.cn ? ` (${cardData.cn})` : ""}`
          : cardData?.set;
        addInfoItem("Édition", setLabel);
      }

      if (cardData?.prices) {
        const prices = [];
        const formatPrice = (value, suffix) => {
          if (typeof value === "number") {
            return `${value.toFixed(2)} ${suffix}`;
          }
          if (typeof value === "string" && value.trim().length > 0) {
            return `${value} ${suffix}`;
          }
          return null;
        };
        const usd = formatPrice(cardData.prices.usd, "$");
        const eur = formatPrice(cardData.prices.eur, "€");
        if (usd) {
          prices.push(usd);
        }
        if (eur) {
          prices.push(eur);
        }
        if (prices.length > 0) {
          addInfoItem("Prix estimé", prices.join(" · "));
        }
      }

      if (cardData?.scryfall_id && cardData?.set && cardData?.cn) {
        const scryfallUrl = `https://scryfall.com/card/${cardData.set}/${cardData.cn}`;
        const li = document.createElement("li");
        li.innerHTML = `<strong>Ressource :</strong> <a href="${scryfallUrl}" target="_blank" rel="noopener noreferrer">Voir sur Scryfall</a>`;
        cardInfoListEl.appendChild(li);
      }
    }
  };

  const initDeckDetailPage = async () => {
    if (pageType !== "deck-detail") {
      return;
    }

    let deckId = getQueryParam("deck");
    let handleHint = getQueryParam("handle");

    if (!deckId) {
      try {
        const stored = JSON.parse(window.sessionStorage.getItem(LAST_DECK_STORAGE_KEY) || "null");
        if (stored?.deckId) {
          deckId = stored.deckId;
          if (!handleHint && stored.handle) {
            handleHint = stored.handle;
          }
        }
      } catch (error) {
        console.warn("Impossible de lire la sélection du deck :", error);
      }
    }

    if (!deckId) {
      showDeckError("Identifiant de deck manquant.");
      setDeckLoading(false);
      return;
    }

    setDeckLoading(true);
    try {
      const { deck, session } = await ensureDeckDetails(deckId, {
        handle: handleHint,
      });
      if (session) {
        currentSession = session;
      }
      if (!deck || !deckHasCardDetails(deck)) {
        showDeckError(
          "Impossible de récupérer les cartes de ce deck. Lancez une nouvelle synchronisation."
        );
        return;
      }
      populateDeckDetail(deck, { handle: handleHint });
      try {
        window.sessionStorage.removeItem(LAST_DECK_STORAGE_KEY);
      } catch (error) {
        // ignore
      }
    } catch (error) {
      console.error("Unable to load deck detail", error);
      showDeckError(
        "Nous n'avons pas pu charger ce deck. Vérifiez qu'il est toujours public sur Moxfield."
      );
    } finally {
      setDeckLoading(false);
    }
  };

  const initCardDetailPage = async () => {
    if (pageType !== "card-detail") {
      return;
    }

    let deckId = getQueryParam("deck");
    let cardId = getQueryParam("card");
    let handleHint = getQueryParam("handle");

    if (!deckId || !cardId) {
      try {
        const storedCard = JSON.parse(
          window.sessionStorage.getItem(LAST_CARD_STORAGE_KEY) || "null"
        );
        if (storedCard) {
          deckId = deckId || storedCard.deckId || null;
          cardId = cardId || storedCard.cardId || null;
          if (!handleHint && storedCard.handle) {
            handleHint = storedCard.handle;
          }
        }
      } catch (error) {
        console.warn("Impossible de lire la sélection de la carte :", error);
      }
    }

    if (!deckId || !cardId) {
      showCardError("Paramètres incomplets pour afficher cette carte.");
      setCardLoading(false);
      return;
    }

    setCardLoading(true);
    try {
      const { deck, session } = await ensureDeckDetails(deckId, {
        handle: handleHint,
      });
      if (session) {
        currentSession = session;
      }
      if (!deck || !deckHasCardDetails(deck)) {
        showCardError(
          "Impossible de récupérer le deck associé à cette carte. Relancez une synchronisation."
        );
        return;
      }
      const cardContext = findCardInDeckById(deck, cardId);
      if (!cardContext) {
        showCardError("Cette carte n'appartient pas (ou plus) au deck sélectionné.");
        return;
      }
      populateCardDetail(deck, cardContext, { handle: handleHint });
      try {
        window.sessionStorage.removeItem(LAST_CARD_STORAGE_KEY);
      } catch (error) {
        // ignore
      }
    } catch (error) {
      console.error("Unable to load card detail", error);
      showCardError("Nous n'avons pas pu charger les informations de cette carte.");
    } finally {
      setCardLoading(false);
    }
  };


  const loadCachedDecksForHandle = async (
    handle,
    { showMessageOnMiss = false } = {}
  ) => {
    const normalizedHandle = handle?.trim();
    if (!normalizedHandle) {
      return;
    }

    if (cachedDecksController) {
      cachedDecksController.abort();
    }

    const controller = new AbortController();
    cachedDecksController = controller;

    try {
      const { decks, totalDecks, user } = await fetchDecksFromBackend(normalizedHandle, {
        signal: controller.signal,
        mode: "cache-only",
      });

      const deckCount = Array.isArray(decks) ? decks.length : 0;
      const totalCount =
        typeof totalDecks === "number" ? totalDecks : deckCount;
      const message = `Decks chargés depuis le cache (${deckCount} deck${
        deckCount > 1 ? "s" : ""
      }).`;

      const updatedSession = setMoxfieldIntegration((integration) => ({
        ...integration,
        handle: normalizedHandle,
        handleLower: normalizedHandle.toLowerCase(),
        decks,
        deckCount,
        totalDecks: totalCount,
        lastUser: user ?? integration?.lastUser ?? null,
        lastSyncedAt: Date.now(),
        lastSyncStatus: "success",
        lastSyncMessage: message,
        lastSource: "cache",
      }));

      currentSession = updatedSession ?? currentSession;
      renderMoxfieldPanel(currentSession);
      refreshDeckCollection(currentSession);
    } catch (error) {
      if (error.code === "CACHE_MISS") {
        if (showMessageOnMiss) {
          showMoxfieldStatus(
            "Aucune donnée en cache pour ce pseudo. Lancez une synchronisation.",
            "neutral"
          );
        }
      } else if (error.code === "NETWORK") {
        showMoxfieldStatus(error.message, "error");
      } else if (error.code === "HTTP_ERROR") {
        showMoxfieldStatus(
          `L'API EDH PodLog a renvoyé une erreur (${error.status ?? "inconnue"}).`,
          "error"
        );
      } else if (error.code !== "AbortError") {
        showMoxfieldStatus("Lecture du cache impossible pour le moment.", "error");
      }
    } finally {
      if (cachedDecksController === controller) {
        cachedDecksController = null;
      }
    }
  };

  if (currentSession?.accessToken) {
    googleAccessToken = currentSession.accessToken;
  }

  const pageRequiresAuth = Boolean(requireAuthFlag || profileMenuButton || signOutBtn);

  if (pageRequiresAuth && !currentSession) {
    redirectToLanding();
    return;
  }

  if (currentSession?.googleSub) {
    try {
      const profile = await fetchBackendProfile(currentSession.googleSub);
      if (profile) {
        const merged = applyProfileToSession(currentSession, profile);
        persistSession(merged);
        currentSession = merged;
      }
    } catch (error) {
      console.warn("Impossible de récupérer le profil sauvegardé :", error);
    }
  }

  if (currentSession) {
    updateProfileBadge(currentSession);
    updateProfileDetails(currentSession);
  }

  if (landingSignInButton) {
    const label = landingSignInButton.querySelector("span");
    if (label && label.textContent.trim().length > 0) {
      defaultSignInLabel = label.textContent.trim();
    }
    setSignInButtonDisabled(true);
    updateSignInButtonState();

    landingSignInButton.addEventListener("click", (event) => {
      event.preventDefault();

      if (!isGoogleClientConfigured()) {
        explainMissingGoogleConfig();
        return;
      }

      if (!tokenClient) {
        window.alert(
          "La librairie Google n'est pas encore prête. Veuillez patienter une seconde puis réessayer."
        );
        return;
      }

      setSignInButtonLoading(true);
      tokenClient.requestAccessToken({
        prompt: currentSession ? "" : "consent",
      });
    });
  }

  if (profileMenuButton && profileMenu) {
    const closeMenu = () => {
      profileMenu.classList.remove("is-visible");
      profileMenuButton.setAttribute("aria-expanded", "false");
    };

    const toggleMenu = () => {
      const isOpen = profileMenu.classList.toggle("is-visible");
      profileMenuButton.setAttribute("aria-expanded", String(isOpen));
    };

    profileMenuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu();
    });

    profileMenu.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    document.addEventListener("click", (event) => {
      if (
        profileMenu.classList.contains("is-visible") &&
        !profileMenu.contains(event.target)
      ) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    });
  }

  if (profileLink) {
    profileLink.addEventListener("click", (event) => {
      event.stopPropagation();
      profileMenu?.classList.remove("is-visible");
      profileMenuButton?.setAttribute("aria-expanded", "false");
      event.preventDefault();
      window.location.assign(profileHref);
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      profileMenu?.classList.remove("is-visible");
      profileMenuButton?.setAttribute("aria-expanded", "false");
      const session = getSession();
      revokeGoogleToken(session?.accessToken || googleAccessToken);
      clearSession();
      redirectToLanding();
    });
  }

  moxfieldForm = document.getElementById("moxfieldForm");
  moxfieldHandleInput = document.getElementById("moxfieldHandle");
  moxfieldSaveButton = moxfieldForm?.querySelector(".inline-button") ?? null;
  moxfieldSyncButton = document.getElementById("moxfieldSync");
  moxfieldStatusEl = document.getElementById("moxfieldStatus");
  moxfieldDeckSummaryEl = document.getElementById("moxfieldDeckSummary");
  moxfieldDeckSummaryText = document.getElementById("moxfieldDeckSummaryText");
  moxfieldDeckSummaryAction = document.getElementById("moxfieldDeckSummaryAction");
  moxfieldMetaEl = document.getElementById("moxfieldSyncMeta");
  deckCollectionEl = document.getElementById("deckCollection");
  deckCollectionEmptyEl = document.getElementById("deckCollectionEmpty");
  deckStatusEl = document.getElementById("deckStatus");
  deckBulkDeleteBtn = document.getElementById("deckBulkDelete");
  deckSelectionModal = document.getElementById("deckSelectionModal");
  deckSelectionListEl = document.getElementById("deckSelectionList");
  deckSelectionForm = document.getElementById("deckSelectionForm");
  deckSelectionConfirmBtn = document.getElementById("deckSelectionConfirm");
  deckSelectionCancelBtn = document.getElementById("deckSelectionCancel");
  deckSelectionCloseBtn = document.getElementById("deckSelectionClose");
  deckSelectionSelectAllBtn = document.getElementById("deckSelectionSelectAll");
  deckSelectionClearBtn = document.getElementById("deckSelectionClearAll");

  if (deckSelectionConfirmBtn) {
    deckSelectionConfirmBtn.addEventListener("click", handleDeckSelectionConfirm);
  }
  deckSelectionCancelBtn?.addEventListener("click", () => closeDeckSelectionModal("cancel"));
  deckSelectionCloseBtn?.addEventListener("click", () => closeDeckSelectionModal("cancel"));
  deckSelectionSelectAllBtn?.addEventListener("click", selectAllDecksForImport);
  deckSelectionClearBtn?.addEventListener("click", clearDeckSelection);
  deckSelectionListEl?.addEventListener("change", updateDeckSelectionConfirmState);
  if (deckSelectionModal) {
    deckSelectionModal.addEventListener("click", (event) => {
      if (event.target === deckSelectionModal) {
        closeDeckSelectionModal("cancel");
      }
    });
  }

  deckBulkDeleteBtn?.addEventListener("click", handleDeckBulkRemoval);

  if (moxfieldSyncButton && moxfieldSyncButton.textContent.trim().length > 0) {
    defaultSyncLabel = moxfieldSyncButton.textContent.trim();
    moxfieldSyncButton.innerHTML = `<span class="button-label">${defaultSyncLabel}</span>`;
  }

  if (currentSession) {
    renderMoxfieldPanel(currentSession);
    const integration = getMoxfieldIntegration(currentSession);
    if (
      integration?.handle &&
      (!Array.isArray(integration.decks) || integration.decks.length === 0)
    ) {
      loadCachedDecksForHandle(integration.handle);
    }
  }

  refreshDeckCollection(currentSession);

  if (moxfieldForm && moxfieldHandleInput) {
    moxfieldForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!currentSession) {
        redirectToLanding();
        return;
      }

      const rawHandle = moxfieldHandleInput.value;
      const validation = validateMoxfieldHandle(rawHandle);

      if (!validation.valid) {
        if (validation.reason === "empty") {
          showMoxfieldStatus("Veuillez renseigner votre pseudo Moxfield.", "error");
        } else {
          showMoxfieldStatus(
            "Le pseudo Moxfield ne doit contenir que des lettres, chiffres, tirets ou underscores.",
            "error"
          );
        }
        moxfieldSyncButton.disabled = true;
        return;
      }

      if (moxfieldSaveButton) {
        moxfieldSaveButton.disabled = true;
      }

      const normalizedHandle = validation.normalized;
      const previousIntegration = getMoxfieldIntegration(currentSession);
      const previousHandle = previousIntegration?.handle ?? null;
      const handleChanged =
        (previousHandle ?? "").toLowerCase() !== normalizedHandle.toLowerCase();

      const updatedSession = setMoxfieldIntegration((integration) => {
        const next = { ...integration };
        next.handle = normalizedHandle;
        next.handleLower = normalizedHandle.toLowerCase();
        next.handleUpdatedAt = Date.now();

        if (handleChanged) {
          next.decks = [];
          next.deckCount = 0;
          next.totalDecks = null;
          next.lastUser = null;
          next.lastSyncedAt = null;
          next.lastSyncStatus = null;
          next.lastSyncMessage = null;
          next.lastSource = null;
        }

        return next;
      });

      currentSession = updatedSession ?? currentSession;
      currentSession =
        (await persistIntegrationToProfile(currentSession, {
          handleChanged,
          decks: handleChanged ? [] : undefined,
        })) ?? currentSession;
      renderMoxfieldPanel(currentSession, { preserveStatus: true });
      showMoxfieldStatus("Pseudo Moxfield enregistré.", "success");

      if (moxfieldSaveButton) {
        moxfieldSaveButton.disabled = false;
      }

      if (moxfieldSyncButton && !moxfieldSyncButton.classList.contains("is-loading")) {
        moxfieldSyncButton.disabled = false;
      }

      loadCachedDecksForHandle(normalizedHandle, { showMessageOnMiss: true });
    });
  }

  if (moxfieldSyncButton) {
    moxfieldSyncButton.addEventListener("click", async () => {
      if (!currentSession) {
        redirectToLanding();
        return;
      }

      const handleValue = moxfieldHandleInput?.value ?? "";
      const validation = validateMoxfieldHandle(handleValue);

      if (!validation.valid) {
        showMoxfieldStatus(
          validation.reason === "empty"
            ? "Renseignez d'abord votre pseudo Moxfield."
            : "Le pseudo Moxfield contient des caractères non autorisés.",
          "error"
        );
        return;
      }

      if (cachedDecksController) {
        cachedDecksController.abort();
        cachedDecksController = null;
      }

      if (currentSyncAbortController) {
        currentSyncAbortController.abort();
      }

      const controller = new AbortController();
      currentSyncAbortController = controller;

      setMoxfieldSyncLoading(true);
      showMoxfieldStatus("Récupération des decks disponibles…");

      try {
        const preview = await fetchDeckSummariesFromBackend(
          validation.normalized,
          controller.signal
        );

        if (!Array.isArray(preview.decks) || preview.decks.length === 0) {
          showMoxfieldStatus("Aucun deck public trouvé pour ce pseudo.", "neutral");
          return;
        }

        const existingMap = buildExistingDeckMap(getMoxfieldIntegration(currentSession));
        currentSyncAbortController = null;
        setMoxfieldSyncLoading(false);
        showMoxfieldStatus("Sélectionnez les decks à importer.", "neutral");
        openDeckSelectionModal({
          handle: validation.normalized,
          decks: preview.decks,
          totalDecks: preview.totalDecks,
          user: preview.user,
          existingDeckMap: existingMap,
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        let message = error.message || "Synchronisation impossible.";
        let variant = "error";

        if (error.code === "NOT_FOUND") {
          message =
            "Impossible de trouver ce pseudo Moxfield. Vérifiez l'orthographe et réessayez.";
        } else if (error.code === "HTTP_ERROR") {
          message = `L'API EDH PodLog a renvoyé une erreur (${error.status ?? "inconnue"}).`;
        } else if (error.code === "NETWORK") {
          message = error.message;
        }

        showMoxfieldStatus(message, variant);
      } finally {
        if (currentSyncAbortController === controller) {
          currentSyncAbortController = null;
        }
        setMoxfieldSyncLoading(false);
      }
    });
  }

  await initDeckDetailPage();
  await initCardDetailPage();

  if (window.google?.accounts?.oauth2 && !isGoogleLibraryReady) {
    initializeGoogleAuth();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && deckSelectionModal?.classList.contains("is-visible")) {
    event.preventDefault();
    closeDeckSelectionModal("cancel");
  }
});
