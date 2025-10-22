const STORAGE_KEY = "edhPodlogSession";
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
let moxfieldDeckListEl = null;
let moxfieldMetaEl = null;
let defaultSyncLabel = "Synchroniser avec Moxfield";
let currentSyncAbortController = null;
let deckCollectionEl = null;
let deckCollectionEmptyEl = null;
let deckStatusEl = null;
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

const renderMoxfieldDeckList = (decks) => {
  if (!moxfieldDeckListEl) {
    return;
  }

  const hasDecks = renderDeckCardsInto(moxfieldDeckListEl, decks);
  if (!hasDecks) {
    const placeholder = document.createElement("p");
    placeholder.className = "deck-placeholder";
    placeholder.textContent = "Aucun deck synchronisé pour le moment.";
    moxfieldDeckListEl.innerHTML = "";
    moxfieldDeckListEl.appendChild(placeholder);
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

    const finalSession = updatedSession ?? getSession();
    refreshDeckCollection(finalSession);
    if (typeof renderMoxfieldPanel === "function") {
      renderMoxfieldPanel(finalSession, { preserveStatus: true });
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

    const importedDecks = decks.filter((deck) =>
      selectionMap.has(getDeckIdentifier(deck))
    );

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

    currentSession = updatedSession ?? currentSession;
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

  renderMoxfieldDeckList(integration?.decks ?? []);
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

if (typeof window !== "undefined") {
  window.EDH_PODLOG_INTERNAL = {
    validateMoxfieldHandle,
    normalizeMoxfieldDeck,
  };
}

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
  let cachedDecksController = null;


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
  deckCollectionEl = document.getElementById("deckCollection");
  deckCollectionEmptyEl = document.getElementById("deckCollectionEmpty");
  deckStatusEl = document.getElementById("deckStatus");
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
      renderMoxfieldPanel(currentSession, { preserveStatus: true });
      showMoxfieldStatus("Pseudo Moxfield enregistré.", "success");

      if (moxfieldSaveButton) {
        moxfieldSaveButton.disabled = false;
      }

      if (moxfieldSyncButton && !moxfieldSyncButton.classList.contains("is-loading")) {
        moxfieldSyncButton.disabled = false;
      }

      loadCachedDecksForHandle(validation.normalized, { showMessageOnMiss: true });
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
