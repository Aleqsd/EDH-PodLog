const STORAGE_KEY = "edhPodlogSession";
const CONFIG = window.EDH_PODLOG_CONFIG ?? {};
const GOOGLE_CLIENT_ID = CONFIG.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_SCOPES = "openid email profile";
const GOOGLE_CONFIG_PLACEHOLDER = "REMPLACEZ_MOI_PAR_VOTRE_CLIENT_ID";
const MOXFIELD_API_BASE = "https://api2.moxfield.com/v2";
const MOXFIELD_DECKS_PAGE_SIZE = 50;

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
let moxfieldDeckListEl = null;
let moxfieldMetaEl = null;
let defaultSyncLabel = "Synchroniser avec Moxfield";
let currentSyncAbortController = null;

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
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Session invalide, nettoyage…", error);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

const persistSession = (session) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
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
  persistSession(result);
  return result;
};

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

    return {
      ...session,
      integrations: {
        ...session.integrations,
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

const renderMoxfieldDeckList = (decks) => {
  if (!moxfieldDeckListEl) {
    return;
  }

  moxfieldDeckListEl.innerHTML = "";

  if (!Array.isArray(decks) || decks.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "deck-placeholder";
    placeholder.textContent = "Aucun deck synchronisé pour le moment.";
    moxfieldDeckListEl.appendChild(placeholder);
    return;
  }

  decks.forEach((deck) => {
    const card = document.createElement("article");
    card.className = "deck-card";

    const header = document.createElement("div");
    header.className = "deck-card-header";

    const title = document.createElement("h4");
    title.className = "deck-card-title";
    title.textContent = deck.name || "Deck sans nom";

    const formatBadge = document.createElement("span");
    formatBadge.className = "deck-card-format";
    formatBadge.textContent = deck.format ? deck.format.toUpperCase() : "FORMAT ?";

    header.append(title, formatBadge);

    const metaLine = document.createElement("div");
    metaLine.className = "deck-card-updated";
    const metaParts = [];

    if (typeof deck.cardCount === "number" && deck.cardCount > 0) {
      metaParts.push(`${deck.cardCount} cartes`);
    }

    if (deck.updatedAt) {
      metaParts.push(
        `Mis à jour le ${formatDateTime(deck.updatedAt, { dateStyle: "medium" })}`
      );
    }

    metaLine.textContent = metaParts.join(" · ") || "Informations indisponibles";

    const link = document.createElement("a");
    link.className = "deck-card-link";
    if (deck.url) {
      link.href = deck.url;
    } else if (deck.slug) {
      link.href = `https://www.moxfield.com/decks/${deck.slug}`;
    } else if (deck.id) {
      link.href = `https://www.moxfield.com/decks/${deck.id}`;
    } else {
      link.removeAttribute("href");
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Voir sur Moxfield";

    card.append(header, metaLine, link);
    moxfieldDeckListEl.appendChild(card);
  });
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
    moxfieldSyncButton.textContent = defaultSyncLabel;
    moxfieldSyncButton.disabled = !handle;
  }

  if (moxfieldSaveButton) {
    moxfieldSaveButton.disabled = false;
  }

  if (moxfieldMetaEl) {
    if (integration?.lastSyncedAt) {
      moxfieldMetaEl.textContent = `Dernière synchronisation le ${formatDateTime(
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

  renderMoxfieldDeckList(integration?.decks ?? []);
};

const setMoxfieldSyncLoading = (isLoading) => {
  if (!moxfieldSyncButton) {
    return;
  }

  if (isLoading) {
    moxfieldSyncButton.classList.add("is-loading");
    moxfieldSyncButton.textContent = "Synchronisation…";
    moxfieldSyncButton.disabled = true;
  } else {
    moxfieldSyncButton.classList.remove("is-loading");
    moxfieldSyncButton.textContent = defaultSyncLabel;
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

    persistSession(session);
    googleAccessToken = session.accessToken;
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

  const slug =
    deck.publicId ||
    deck.id ||
    deck.slug ||
    deck.deckId ||
    deck.publicSlug ||
    deck.publicDeckId ||
    null;

  return {
    id: slug || deck.id || deck.deckId || null,
    slug,
    name: deck.name || "Deck sans nom",
    format: deck.format || deck.formatType || deck.deckFormat || "—",
    updatedAt:
      deck.updatedAt ||
      deck.updatedAtUtc ||
      deck.modifiedOn ||
      deck.lastUpdated ||
      deck.createdAt ||
      null,
    cardCount:
      typeof deck.cardCount === "number"
        ? deck.cardCount
        : typeof deck.mainboardCount === "number"
        ? deck.mainboardCount
        : Array.isArray(deck.mainboard)
        ? deck.mainboard.length
        : null,
    url: slug ? `https://www.moxfield.com/decks/${slug}` : null,
  };
};

const fetchAllMoxfieldDecks = async (handle, signal) => {
  const decks = [];
  let page = 0;
  let totalPages = 1;

  while (page < totalPages) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(MOXFIELD_DECKS_PAGE_SIZE),
      sortBy: "updated",
    });

    const response = await fetch(
      `${MOXFIELD_API_BASE}/users/${encodeURIComponent(handle)}/decks?${params.toString()}`,
      {
        signal,
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (response.status === 404) {
      const notFoundError = new Error("Pseudo Moxfield introuvable.");
      notFoundError.code = "NOT_FOUND";
      throw notFoundError;
    }

    if (!response.ok) {
      const httpError = new Error(`Erreur Moxfield (${response.status})`);
      httpError.code = "HTTP_ERROR";
      httpError.status = response.status;
      throw httpError;
    }

    const payload = await response.json();
    const pageData = Array.isArray(payload?.data) ? payload.data : [];

    pageData.forEach((deck) => {
      const normalized = normalizeMoxfieldDeck(deck);
      if (normalized) {
        decks.push(normalized);
      }
    });

    const discoveredTotalPages = Number.isFinite(payload?.totalPages)
      ? payload.totalPages
      : 1;

    totalPages = Math.max(discoveredTotalPages, 1);
    page += 1;

    if (pageData.length === 0) {
      break;
    }
  }

  decks.sort((a, b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return timeB - timeA;
  });

  return decks;
};

const syncMoxfieldDecks = async (handle, signal) => {
  try {
    const decks = await fetchAllMoxfieldDecks(handle, signal);
    return { decks };
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    if (error.code) {
      throw error;
    }

    const networkError = new Error(
      "Impossible de contacter Moxfield pour le moment. Réessayez plus tard."
    );
    networkError.code = "NETWORK";
    throw networkError;
  }
};

window.addEventListener("google-loaded", initializeGoogleAuth);

document.addEventListener("DOMContentLoaded", () => {
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
  if (currentSession?.accessToken) {
    googleAccessToken = currentSession.accessToken;
  }

  const pageRequiresAuth = Boolean(requireAuthFlag || profileMenuButton || signOutBtn);

  if (pageRequiresAuth && !currentSession) {
    redirectToLanding();
    return;
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
  moxfieldDeckListEl = document.getElementById("moxfieldDeckList");
  moxfieldMetaEl = document.getElementById("moxfieldSyncMeta");

  if (moxfieldSyncButton && moxfieldSyncButton.textContent.trim().length > 0) {
    defaultSyncLabel = moxfieldSyncButton.textContent.trim();
  }

  if (currentSession) {
    renderMoxfieldPanel(currentSession);
  }

  if (moxfieldForm && moxfieldHandleInput) {
    moxfieldForm.addEventListener("submit", (event) => {
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

      const updatedSession = setMoxfieldIntegration((integration) => {
        const next = { ...integration };
        const previousHandle = integration?.handle ?? null;
        next.handle = validation.normalized;
        next.handleLower = validation.normalized.toLowerCase();
        next.handleUpdatedAt = Date.now();

        if (
          previousHandle &&
          previousHandle.toLowerCase() !== validation.normalized.toLowerCase()
        ) {
          next.decks = [];
          next.lastSyncedAt = null;
          next.lastSyncStatus = null;
          next.lastSyncMessage = null;
        }

        return next;
      });

      currentSession = updatedSession ?? currentSession;
      renderMoxfieldPanel(currentSession, { preserveStatus: true });
      showMoxfieldStatus("Pseudo Moxfield enregistré.", "success");

      if (moxfieldSaveButton) {
        moxfieldSaveButton.disabled = false;
      }

      if (moxfieldSyncButton && !moxfieldSyncButton.classList.contains("is-loading")) {
        moxfieldSyncButton.disabled = false;
      }
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

      if (currentSyncAbortController) {
        currentSyncAbortController.abort();
      }

      const controller = new AbortController();
      currentSyncAbortController = controller;

      setMoxfieldSyncLoading(true);
      showMoxfieldStatus("Synchronisation en cours…");

      try {
        const { decks } = await syncMoxfieldDecks(validation.normalized, controller.signal);
        const message = `Synchronisation réussie (${decks.length} deck${
          decks.length > 1 ? "s" : ""
        }).`;

        const updatedSession = setMoxfieldIntegration((integration) => ({
          ...integration,
          handle: validation.normalized,
          handleLower: validation.normalized.toLowerCase(),
          lastSyncedAt: Date.now(),
          deckCount: decks.length,
          decks,
          lastSyncStatus: "success",
          lastSyncMessage: message,
        }));

        currentSession = updatedSession ?? currentSession;
        renderMoxfieldPanel(currentSession);
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
          message = `Moxfield a renvoyé une erreur (${error.status ?? "inconnue"}).`;
        } else if (error.code === "NETWORK") {
          message = error.message;
        }

        const updatedSession = setMoxfieldIntegration((integration) => ({
          ...integration,
          lastSyncedAt: Date.now(),
          lastSyncStatus: "error",
          lastSyncMessage: message,
        }));

        currentSession = updatedSession ?? currentSession;
        renderMoxfieldPanel(currentSession, { preserveStatus: true });
        showMoxfieldStatus(message, variant);
      } finally {
        if (currentSyncAbortController === controller) {
          currentSyncAbortController = null;
        }
        setMoxfieldSyncLoading(false);
      }
    });
  }

  if (window.google?.accounts?.oauth2 && !isGoogleLibraryReady) {
    initializeGoogleAuth();
  }
});
