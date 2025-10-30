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

const auth = window.EDH_PODLOG?.auth ?? {};
let landingSignInButton = null;
let landingFootnoteTextEl = null;
let defaultSignInLabel = "";
let defaultFootnoteText = "";

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
  if (typeof auth.redirectToLanding === "function") {
    auth.redirectToLanding();
    return;
  }
  window.location.replace("index.html");
};

const revokeGoogleToken = (token) => {
  if (typeof auth.revokeToken === "function") {
    auth.revokeToken(token);
    return;
  }
  if (!token) {
    return;
  }
  const google = window.google?.accounts?.oauth2;
  if (google?.revoke) {
    google.revoke(token, () => {});
  }
};

const getGoogleAccessToken = () =>
  typeof auth.getAccessToken === "function" ? auth.getAccessToken() : null;

const setGoogleAccessToken = (token) => {
  if (typeof auth.setAccessToken === "function") {
    auth.setAccessToken(token);
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
    givenName: userInfo.given_name || previousSession?.givenName || "",
    picture: userInfo.picture || previousSession?.picture || "",
    identityPicture: userInfo.picture || previousSession?.identityPicture || "",
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

  setGoogleAccessToken(tokenResponse.access_token);

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
    setGoogleAccessToken(mergedSession.accessToken);
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

  if (!auth.isClientConfigured || !auth.isClientConfigured()) {
    console.warn("Client Google OAuth manquant. Configurez-le dans config.js.");
    updateSignInButtonState();
    return;
  }

  const nextTokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: typeof auth.getClientId === "function" ? auth.getClientId() : GOOGLE_CLIENT_ID,
    scope: typeof auth.getScopes === "function" ? auth.getScopes() : GOOGLE_SCOPES,
    callback: handleGoogleTokenResponse,
  });

  auth.setTokenClient?.(nextTokenClient);
  auth.setLibraryReady?.(true);
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

  if (!auth.isClientConfigured || !auth.isClientConfigured()) {
    explainMissingGoogleConfig();
    return;
  }

  if (!auth.isLibraryReady || !auth.isLibraryReady()) {
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

const collectDeckBoards = (deck) => {
  const normalizeCardEntry = (entry) => {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const sourceCard = entry.card ?? entry;
    const card =
      sourceCard && typeof sourceCard === "object"
        ? typeof sourceCard.card === "object"
          ? sourceCard.card
          : sourceCard
        : null;
    if (!card || typeof card !== "object") {
      return null;
    }
    const quantityCandidates = [
      entry.quantity,
      sourceCard.quantity,
      entry.count,
      sourceCard.count,
    ];
    let quantity = 0;
    for (const candidate of quantityCandidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
        quantity = candidate;
        break;
      }
    }
    return { card, quantity };
  };

  const buildBoard = (name, boardData) => {
    if (!boardData || typeof boardData !== "object") {
      return null;
    }

    const resolvedName =
      typeof boardData.name === "string" && boardData.name.trim().length > 0
        ? boardData.name
        : typeof name === "string"
        ? name
        : "";

    const rawCards = Array.isArray(boardData.cards)
      ? boardData.cards
      : boardData.cards && typeof boardData.cards === "object"
      ? Object.values(boardData.cards)
      : [];

    const cards = rawCards.map(normalizeCardEntry).filter(Boolean);
    if (cards.length === 0) {
      return null;
    }

    const inferredCount = cards.reduce((sum, entry) => sum + (entry.quantity || 0), 0);
    const count =
      typeof boardData.count === "number" && Number.isFinite(boardData.count)
        ? boardData.count
        : inferredCount;

    return {
      name: resolvedName || "",
      count,
      cards,
    };
  };

  const boardsSource = deck?.raw?.boards ?? deck?.boards ?? null;
  if (Array.isArray(boardsSource)) {
    return boardsSource.map((board) => buildBoard(board?.name, board)).filter(Boolean);
  }
  if (boardsSource && typeof boardsSource === "object") {
    return Object.entries(boardsSource)
      .map(([boardName, boardData]) => buildBoard(boardName, boardData))
      .filter(Boolean);
  }
  return [];
};

const collectDeckCards = (deck) => {
  const boards = collectDeckBoards(deck);
  return boards.flatMap((board) =>
    board.cards.map((entry) => ({
      board,
      entry,
    }))
  );
};

const DECK_PERSONAL_RATING_DEFAULT = null;
const DECK_PERSONAL_TAG_LIMIT = 7;

const DECK_RATING_CATEGORIES = [
  {
    key: "stability",
    label: "Stabilité",
    description:
      "Ton deck fait-il ce qu'il est censé faire à chaque partie ? Évalue : la pioche régulière, la qualité et la cohérence de la base de mana, la redondance des cartes clés et la synergie interne. Un deck stable trouve ses pièces et développe son plan sans dépendre de la chance.",
  },
  {
    key: "acceleration",
    label: "Accélération",
    description:
      "Peux-tu rapidement prendre de l'avance ou mettre de la pression ? Évalue : les sources de ramp, les bursts de pioche, les cartes qui te donnent un tempo fort ou t'aident à passer la vitesse supérieure. Un deck bien accéléré ne subit pas le rythme des autres.",
  },
  {
    key: "interaction",
    label: "Interaction",
    description:
      "Sais-tu gérer ce que font les autres ? Évalue : les removals, contres, wraths, outils de stax, ou simplement ta capacité à peser dans les rapports de force. Un deck interactif ne laisse pas la table s'emballer sans réagir.",
  },
  {
    key: "resilience",
    label: "Résilience",
    description:
      "Que se passe-t-il quand tout s'effondre ? Évalue : la protection de ton board, la recursion, la capacité à repartir après une wrath ou un contretemps, le sustain à long terme. Un deck résilient encaisse les coups et revient plus fort.",
  },
  {
    key: "finish",
    label: "Finition",
    description:
      "Sais-tu vraiment gagner ? Évalue : la présence de conditions de victoire claires, les menaces létales, les combos, les tuteurs et la manière de conclure une partie. Un deck qui finit bien transforme ses avantages en victoire.",
  },
  {
    key: "construction",
    label: "Construction",
    description:
      "Ton deck sait-il où il va ? Évalue : la clarté du plan de jeu, la logique entre les cartes et la capacité du deck à rester fidèle à son identité. Un deck cohérent a une ligne directrice claire et reconnaissable.",
  },
];

const DECK_BRACKET_LEVELS = [
  {
    id: "1",
    label: "1 · Exhibition",
    description:
      "Les joueurs attendent des decks qui privilégient un objectif, un thème ou une idée avant la puissance brute. Les règles de construction peuvent rester souples selon la table et tolérer des entorses sur les commandants ou la légalité. Les conditions de victoire sont très thématiques ou volontairement modestes et la partie sert surtout à montrer vos créations. Comptez au moins neuf tours de jeu avant de gagner ou perdre, le temps de mettre votre deck en scène.",
  },
  {
    id: "2",
    label: "2 · Core",
    description:
      "Les joueurs attendent des decks simples et peu optimisés, avec des cartes choisies pour la créativité ou le divertissement. Les conditions de victoire se construisent progressivement, sont visibles sur le board et restent faciles à interrompre. Le rythme est détendu et social : on joue proactivement en laissant chaque deck dérouler son plan. Les parties dépassent généralement les huit tours.",
  },
  {
    id: "3",
    label: "3 · Upgraded",
    description:
      "Les joueurs attendent des decks renforcés par des synergies solides et une haute qualité de cartes, capables de perturber les adversaires. Les game changers sont souvent des moteurs de valeur ou des sorts capables de clore la partie. Les conditions de victoire peuvent se déployer lors d'un tour explosif grâce aux ressources accumulées. Le gameplay alterne actions proactives et réponses : comptez au moins six tours avant la conclusion.",
  },
  {
    id: "4",
    label: "4 · Optimized",
    description:
      "Les joueurs attendent des decks très affûtés sans tomber dans la méta cEDH. Ils sont létaux, constants et rapides, conçus pour conclure la partie aussi vite que possible. Les game changers ressemblent à du mana rapide, des moteurs qui snowball, de la disruption gratuite ou des tuteurs. Les conditions de victoire restent variées mais toujours efficaces et instantanées. Les parties sont explosives et peuvent se terminer autour du quatrième tour.",
  },
  {
    id: "5",
    label: "5 · cEDH",
    description:
      "Les joueurs attendent des decks pensés avec précision pour la méta cEDH, capables de gagner très vite ou de générer des ressources écrasantes en s'appuyant sur l'expertise du format. Les conditions de victoire sont optimisées pour l'efficacité et la constance. Le jeu est technique, avec des marges d'erreur infimes et une priorité absolue donnée à la victoire. Une partie peut se terminer à n'importe quel tour.",
  },
];

const DECK_PLAYSTYLE_OPTIONS = ["Aggro", "Midrange", "Control", "Combo", "Fun"];

const DECK_TAG_OPTIONS = [
  "+1/+1 Counter",
  "-1/-1 Counter",
  "Aristocrate",
  "Bigspell",
  "Blink",
  "Chaos",
  "Donjon",
  "Enchanterement",
  "Equipment",
  "Flavor",
  "Goodstuff",
  "Group Hug",
  "Hard Control",
  "Landfall",
  "Legendary",
  "Reanimator",
  "Staxx",
  "Storm",
  "Superfriend",
  "Swarm",
  "Token",
  "Tribal",
  "Vote",
];

const findDeckBracketDefinition = (id) => {
  if (!id) {
    return null;
  }
  const normalized = String(id).trim();
  if (!normalized) {
    return null;
  }
  return DECK_BRACKET_LEVELS.find((level) => level.id === normalized) ?? null;
};

const clampPersonalRatingValue = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof clampDeckRatingValue === "function") {
    const sanitized = clampDeckRatingValue(value);
    return sanitized === null ? null : sanitized;
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

const createEmptyDeckPersonalization = () => ({
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

const cloneDeckPersonalization = (source) => {
  const base = createEmptyDeckPersonalization();
  if (!source || typeof source !== "object") {
    return base;
  }
  if (source.ratings && typeof source.ratings === "object") {
    base.ratings = {};
    Object.entries(source.ratings).forEach(([key, value]) => {
      const sanitized = clampPersonalRatingValue(value);
      if (sanitized !== null) {
        base.ratings[key] = sanitized;
      }
    });
  }
  if (typeof source.bracket === "string" && source.bracket.trim()) {
    base.bracket = source.bracket.trim();
  }
  if (typeof source.playstyle === "string" && source.playstyle.trim()) {
    base.playstyle = source.playstyle.trim();
  }
  if (Array.isArray(source.tags)) {
    base.tags = source.tags.filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim());
  }
  if (typeof source.personalTag === "string") {
    base.personalTag = source.personalTag.trim();
  }
  if (typeof source.notes === "string") {
    base.notes = source.notes.trim();
  }
  if (typeof source.deckId === "string" && source.deckId.trim()) {
    base.deckId = source.deckId.trim();
  }
  const parseTimestamp = (value) => {
    if (typeof toTimestamp === "function") {
      return toTimestamp(value);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  };
  const createdAt = parseTimestamp(source.createdAt);
  if (createdAt !== null) {
    base.createdAt = createdAt;
  }
  const updatedAt = parseTimestamp(source.updatedAt);
  if (updatedAt !== null) {
    base.updatedAt = updatedAt;
  }
  return base;
};

const resolveDeckRatingValue = (personalization, key) => {
  if (!personalization || !personalization.ratings) {
    return null;
  }
  const raw = personalization.ratings[key];
  if (typeof raw === "undefined") {
    return null;
  }
  return clampPersonalRatingValue(raw);
};

let deckPersonalizationBackdrop = null;
let deckPersonalizationModal = null;
let deckPersonalizationForm = null;
let deckPersonalizationSaveBtn = null;
let deckPersonalizationCancelBtn = null;
let deckPersonalizationCloseBtn = null;
let deckPersonalizationStatusEl = null;
let deckPersonalizationRatingControls = new Map();
let deckPersonalizationTagInputs = [];
let deckPersonalizationBracketInputs = [];
let deckPersonalizationPlaystyleSelect = null;
let deckPersonalizationPersonalTagInput = null;
let deckPersonalizationNotesInput = null;
let deckPersonalizationTagLimitHint = null;
let deckPersonalizationContext = null;
let deckPersonalizationKeydownHandler = null;

const setDeckPersonalizationStatus = (message, tone = "neutral") => {
  if (!deckPersonalizationStatusEl) {
    return;
  }
  const baseClass = "deck-personal-status";
  deckPersonalizationStatusEl.className = baseClass;
  if (message && tone) {
    deckPersonalizationStatusEl.classList.add(`is-${tone}`);
  }
  deckPersonalizationStatusEl.textContent = message ?? "";
  deckPersonalizationStatusEl.hidden = !message;
};

const refreshDeckPersonalizationTagState = () => {
  const limit = DECK_PERSONAL_TAG_LIMIT;
  const selected = deckPersonalizationTagInputs.filter((input) => input.checked);
  const remaining = Math.max(0, limit - selected.length);
  deckPersonalizationTagInputs.forEach((input) => {
    if (!input.checked) {
      input.disabled = selected.length >= limit;
    } else {
      input.disabled = false;
    }
  });
  if (deckPersonalizationTagLimitHint) {
    if (selected.length >= limit) {
      deckPersonalizationTagLimitHint.textContent = `Limite atteinte : ${limit} tags sélectionnés.`;
      deckPersonalizationTagLimitHint.classList.add("is-warning");
    } else {
      const noun = remaining > 1 ? "tags" : "tag";
      deckPersonalizationTagLimitHint.textContent = `Encore ${remaining} ${noun} disponible${remaining > 1 ? "s" : ""}.`;
      deckPersonalizationTagLimitHint.classList.remove("is-warning");
    }
  }
};

const ensureDeckPersonalizationModal = () => {
  if (deckPersonalizationBackdrop) {
    return;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "deckPersonalizationModal";
  backdrop.setAttribute("aria-hidden", "true");

  const modal = document.createElement("div");
  modal.className = "modal deck-personal-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "deckPersonalizationTitle");

  const header = document.createElement("header");
  header.className = "modal-header";

  const title = document.createElement("h2");
  title.className = "modal-title";
  title.id = "deckPersonalizationTitle";
  title.textContent = "Modifier les informations personnelles du deck";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal-close";
  closeBtn.setAttribute("aria-label", "Fermer");
  closeBtn.innerHTML = "&times;";

  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "modal-body";

  const form = document.createElement("form");
  form.className = "deck-personal-form";
  form.id = "deckPersonalizationForm";
  form.noValidate = true;
  body.appendChild(form);

  const status = document.createElement("p");
  status.className = "deck-personal-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  form.appendChild(status);

  const footer = document.createElement("footer");
  footer.className = "modal-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "modal-button secondary";
  cancelBtn.textContent = "Annuler";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "modal-button primary";
  saveBtn.textContent = "Enregistrer";

  footer.append(cancelBtn, saveBtn);

  modal.append(header, body, footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  deckPersonalizationBackdrop = backdrop;
  deckPersonalizationModal = modal;
  deckPersonalizationForm = form;
  deckPersonalizationSaveBtn = saveBtn;
  deckPersonalizationCancelBtn = cancelBtn;
  deckPersonalizationCloseBtn = closeBtn;
  deckPersonalizationStatusEl = status;

  deckPersonalizationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleDeckPersonalizationSubmit();
  });
  deckPersonalizationSaveBtn.addEventListener("click", () => {
    if (deckPersonalizationForm) {
      if (typeof deckPersonalizationForm.requestSubmit === "function") {
        deckPersonalizationForm.requestSubmit();
      } else {
        deckPersonalizationForm.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    }
  });
  deckPersonalizationCancelBtn.addEventListener("click", () => {
    closeDeckPersonalizationModal("cancel");
  });
  deckPersonalizationCloseBtn.addEventListener("click", () => {
    closeDeckPersonalizationModal("cancel");
  });
};

const clearDeckPersonalizationModalState = () => {
  deckPersonalizationRatingControls = new Map();
  deckPersonalizationTagInputs = [];
  deckPersonalizationBracketInputs = [];
  deckPersonalizationPlaystyleSelect = null;
  deckPersonalizationPersonalTagInput = null;
  deckPersonalizationNotesInput = null;
  deckPersonalizationTagLimitHint = null;
};

const buildDeckPersonalizationRatingsSection = (personalization) => {
  const section = document.createElement("section");
  section.className = "deck-personal-section deck-personal-section-ratings";

  const heading = document.createElement("h3");
  heading.className = "deck-personal-section-title";
  heading.textContent = "Notes stratégiques (1 à 5)";
  section.appendChild(heading);

  const fields = document.createElement("div");
  fields.className = "deck-rating-grid deck-rating-grid-modal";
  section.appendChild(fields);

  deckPersonalizationRatingControls = new Map();

  DECK_RATING_CATEGORIES.forEach((category) => {
    const field = document.createElement("div");
    field.className = "deck-rating-field deck-rating-field-modal";

    const controlRow = document.createElement("div");
    controlRow.className = "deck-rating-control";
    field.appendChild(controlRow);

    const selectId = `deckRating-${category.key}`;
    const label = document.createElement("label");
    label.className = "deck-rating-label";
    label.setAttribute("for", selectId);
    label.textContent = category.label;

    const select = document.createElement("select");
    select.className = "deck-rating-select";
    select.id = selectId;
    select.name = selectId;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "—";
    select.appendChild(placeholder);

    for (let i = 1; i <= 5; i += 1) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = String(i);
      select.appendChild(option);
    }

    const description = document.createElement("p");
    description.className = "deck-rating-help";
    description.textContent = category.description ?? "";
    const descriptionId = `${selectId}-description`;
    description.id = descriptionId;
    select.setAttribute("aria-describedby", descriptionId);

    controlRow.append(label, select);
    field.appendChild(description);
    fields.appendChild(field);

    const control = {
      select,
      value: DECK_PERSONAL_RATING_DEFAULT,
      setValue(next) {
        const sanitized = clampPersonalRatingValue(next);
        control.value = sanitized;
        if (sanitized === null) {
          select.value = "";
        } else {
          select.value = String(sanitized);
        }
      },
    };

    select.addEventListener("change", () => {
      control.setValue(select.value);
    });

    deckPersonalizationRatingControls.set(category.key, control);
  });

  DECK_RATING_CATEGORIES.forEach((category) => {
    const control = deckPersonalizationRatingControls.get(category.key);
    if (!control) {
      return;
    }
    const initialValue = resolveDeckRatingValue(personalization, category.key);
    control.setValue(initialValue);
  });

  return section;
};

const buildDeckPersonalizationProfileSection = (personalization) => {
  const section = document.createElement("section");
  section.className = "deck-personal-section deck-personal-section-profile";

  const heading = document.createElement("h3");
  heading.className = "deck-personal-section-title";
  heading.textContent = "Profil de jeu";
  section.appendChild(heading);

  deckPersonalizationBracketInputs = [];

  const syncBracketActiveState = () => {
    deckPersonalizationBracketInputs.forEach((radio) => {
      const container = radio.closest(".deck-bracket-option");
      if (container) {
        container.classList.toggle("is-active", radio.checked);
      }
    });
  };

  const bracketFieldset = document.createElement("fieldset");
  bracketFieldset.className = "deck-bracket-fieldset";

  const bracketLegend = document.createElement("legend");
  bracketLegend.className = "deck-bracket-legend";
  bracketLegend.textContent = "Bracket (1 à 5)";
  bracketFieldset.appendChild(bracketLegend);

  DECK_BRACKET_LEVELS.forEach((level) => {
    const option = document.createElement("label");
    option.className = "deck-bracket-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "deckBracket";
    input.value = level.id;
    if (personalization.bracket && String(personalization.bracket) === level.id) {
      input.checked = true;
    }

    const copy = document.createElement("div");
    copy.className = "deck-bracket-copy";

    const title = document.createElement("strong");
    title.className = "deck-bracket-label";
    title.textContent = level.label;

    const description = document.createElement("p");
    description.className = "deck-bracket-description";
    description.textContent = level.description;

    copy.append(title, description);
    option.append(input, copy);
    bracketFieldset.appendChild(option);
    deckPersonalizationBracketInputs.push(input);
    input.addEventListener("change", syncBracketActiveState);
  });

  section.appendChild(bracketFieldset);
  syncBracketActiveState();

  const playstyleField = document.createElement("label");
  playstyleField.className = "deck-playstyle-field";

  const playstyleLabel = document.createElement("span");
  playstyleLabel.className = "deck-playstyle-label";
  playstyleLabel.textContent = "Type de jeu (optionnel)";

  const playstyleSelect = document.createElement("select");
  playstyleSelect.className = "deck-playstyle-select";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "— Aucun —";
  playstyleSelect.appendChild(emptyOption);

  DECK_PLAYSTYLE_OPTIONS.forEach((optionLabel) => {
    const option = document.createElement("option");
    option.value = optionLabel;
    option.textContent = optionLabel;
    playstyleSelect.appendChild(option);
  });

  if (personalization.playstyle) {
    playstyleSelect.value = personalization.playstyle;
  }

  playstyleField.append(playstyleLabel, playstyleSelect);
  section.appendChild(playstyleField);
  deckPersonalizationPlaystyleSelect = playstyleSelect;

  const tagWrapper = document.createElement("div");
  tagWrapper.className = "deck-tags-wrapper";

  const tagTitle = document.createElement("span");
  tagTitle.className = "deck-tags-label";
  tagTitle.textContent = "Tags (7 max)";
  tagWrapper.appendChild(tagTitle);

  const tagList = document.createElement("div");
  tagList.className = "deck-tag-grid";
  tagWrapper.appendChild(tagList);

  const uniqueTags = new Set(DECK_TAG_OPTIONS);
  if (Array.isArray(personalization.tags)) {
    personalization.tags.forEach((tag) => {
      if (typeof tag === "string") {
        uniqueTags.add(tag);
      }
    });
  }
  const sortedTags = Array.from(uniqueTags).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));

  deckPersonalizationTagInputs = [];
  sortedTags.forEach((tag) => {
    const option = document.createElement("label");
    option.className = "deck-tag-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tag;
    input.name = "deckTags";
    if (Array.isArray(personalization.tags) && personalization.tags.includes(tag)) {
      input.checked = true;
    }

    input.addEventListener("change", () => {
      refreshDeckPersonalizationTagState();
    });

    const text = document.createElement("span");
    text.className = "deck-tag-name";
    text.textContent = tag;

    option.append(input, text);
    tagList.appendChild(option);
    deckPersonalizationTagInputs.push(input);
  });

  deckPersonalizationTagLimitHint = document.createElement("p");
  deckPersonalizationTagLimitHint.className = "deck-tag-limit-hint";
  deckPersonalizationTagLimitHint.textContent = `Encore ${DECK_PERSONAL_TAG_LIMIT} tags disponibles.`;
  tagWrapper.appendChild(deckPersonalizationTagLimitHint);

  section.appendChild(tagWrapper);

  const personalTagField = document.createElement("label");
  personalTagField.className = "deck-personal-tag-field";

  const personalTagLabel = document.createElement("span");
  personalTagLabel.className = "deck-personal-tag-label";
  personalTagLabel.textContent = "Tag personnel (visible uniquement ici)";

  const personalTagInput = document.createElement("input");
  personalTagInput.type = "text";
  personalTagInput.maxLength = 40;
  personalTagInput.className = "deck-personal-tag-input";
  personalTagInput.placeholder = "Ex. 'Test IRL', 'Prêt', 'Tournoi'";
  personalTagInput.value = personalization.personalTag ?? "";

  personalTagField.append(personalTagLabel, personalTagInput);
  section.appendChild(personalTagField);
  deckPersonalizationPersonalTagInput = personalTagInput;

  deckPersonalizationNotesInput = document.createElement("textarea");
  deckPersonalizationNotesInput.className = "deck-personal-notes";
  deckPersonalizationNotesInput.rows = 3;
  deckPersonalizationNotesInput.maxLength = 1000;
  deckPersonalizationNotesInput.placeholder = "Notes personnelles (optionnel)";
  if (typeof personalization.notes === "string" && personalization.notes.trim().length > 0) {
    deckPersonalizationNotesInput.value = personalization.notes.trim();
  }
  section.appendChild(deckPersonalizationNotesInput);

  return section;
};

const populateDeckPersonalizationForm = (personalization) => {
  if (!deckPersonalizationForm) {
    return;
  }
  deckPersonalizationForm.innerHTML = "";

  const intro = document.createElement("p");
  intro.className = "deck-personal-intro";
  intro.textContent =
    "Ajustez votre lecture personnelle de ce deck. Les modifications sont synchronisées avec votre compte EDH PodLog.";
  deckPersonalizationForm.appendChild(intro);

  const ratingsSection = buildDeckPersonalizationRatingsSection(personalization);
  deckPersonalizationForm.appendChild(ratingsSection);

  const profileSection = buildDeckPersonalizationProfileSection(personalization);
  deckPersonalizationForm.appendChild(profileSection);

  deckPersonalizationForm.appendChild(deckPersonalizationStatusEl);

  setDeckPersonalizationStatus("", "neutral");
  refreshDeckPersonalizationTagState();
};

const collectDeckPersonalizationData = () => {
  const ratings = {};
  DECK_RATING_CATEGORIES.forEach((category) => {
    const control = deckPersonalizationRatingControls.get(category.key);
    if (!control) {
      return;
    }
    const value = clampPersonalRatingValue(control.value);
    if (value !== null) {
      ratings[category.key] = value;
    }
  });

  let bracket = null;
  const selectedBracket = deckPersonalizationBracketInputs.find((input) => input.checked);
  if (selectedBracket) {
    bracket = selectedBracket.value;
  }

  let playstyle = null;
  if (deckPersonalizationPlaystyleSelect) {
    const raw = deckPersonalizationPlaystyleSelect.value;
    if (typeof raw === "string" && raw.trim().length > 0) {
      playstyle = raw.trim();
    }
  }

  const tags = deckPersonalizationTagInputs
    .filter((input) => input.checked)
    .map((input) => input.value)
    .slice(0, DECK_PERSONAL_TAG_LIMIT);

  let personalTag = "";
  if (deckPersonalizationPersonalTagInput) {
    personalTag = deckPersonalizationPersonalTagInput.value.trim();
  }

  let notes = "";
  if (deckPersonalizationNotesInput) {
    notes = deckPersonalizationNotesInput.value.trim();
  }

  return {
    ratings,
    bracket,
    playstyle,
    tags,
    personalTag,
    notes,
  };
};

const handleDeckPersonalizationSubmit = async () => {
  if (!deckPersonalizationContext || !deckPersonalizationSaveBtn) {
    return;
  }
  const deckId = deckPersonalizationContext.deckId;
  if (!deckId) {
    return;
  }

  setDeckPersonalizationStatus("Enregistrement en cours…", "neutral");
  deckPersonalizationSaveBtn.disabled = true;
  deckPersonalizationSaveBtn.classList.add("is-loading");

  try {
    const payload = collectDeckPersonalizationData();
    const persisted = (await setDeckPersonalization(deckId, payload)) ?? payload;
    if (typeof deckPersonalizationContext.onSubmit === "function") {
      deckPersonalizationContext.onSubmit(persisted);
    }
    setDeckPersonalizationStatus("Modifications enregistrées.", "success");
    closeDeckPersonalizationModal("submit");
  } catch (error) {
    console.error("Unable to persist deck personalization", error);
    const message =
      error?.message && typeof error.message === "string"
        ? error.message
        : "Impossible d'enregistrer les informations personnelles pour le moment.";
    const fallbackMessage = /failed to fetch/i.test(message)
      ? "Connexion au serveur impossible. Vérifiez votre réseau et réessayez."
      : message;
    setDeckPersonalizationStatus(fallbackMessage, "error");
    deckPersonalizationSaveBtn.disabled = false;
    deckPersonalizationSaveBtn.classList.remove("is-loading");
  }
};

const closeDeckPersonalizationModal = (reason = "close") => {
  if (!deckPersonalizationBackdrop) {
    return;
  }
  deckPersonalizationBackdrop.classList.remove("is-visible");
  deckPersonalizationBackdrop.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  setDeckPersonalizationStatus("", "neutral");
  clearDeckPersonalizationModalState();
  if (deckPersonalizationKeydownHandler) {
    document.removeEventListener("keydown", deckPersonalizationKeydownHandler);
    deckPersonalizationKeydownHandler = null;
  }
  const context = deckPersonalizationContext;
  deckPersonalizationContext = null;
  deckPersonalizationSaveBtn?.classList.remove("is-loading");
  if (deckPersonalizationSaveBtn) {
    deckPersonalizationSaveBtn.disabled = false;
  }
  if (reason === "cancel" && context && typeof context.onCancel === "function") {
    context.onCancel();
  }
};

const openDeckPersonalizationModal = ({ deckId, deckName, basePersonalization, onSubmit, onCancel }) => {
  if (!deckId) {
    return;
  }
  ensureDeckPersonalizationModal();
  if (!deckPersonalizationBackdrop) {
    return;
  }

  const personalization = cloneDeckPersonalization(basePersonalization);
  deckPersonalizationContext = {
    deckId,
    deckName: deckName ?? "",
    onSubmit,
    onCancel,
  };

  populateDeckPersonalizationForm(personalization);

  if (deckPersonalizationBackdrop) {
    deckPersonalizationBackdrop.classList.add("is-visible");
    deckPersonalizationBackdrop.setAttribute("aria-hidden", "false");
  }
  document.body.classList.add("modal-open");

  if (deckPersonalizationKeydownHandler) {
    document.removeEventListener("keydown", deckPersonalizationKeydownHandler);
  }
  deckPersonalizationKeydownHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDeckPersonalizationModal("cancel");
    }
  };
  document.addEventListener("keydown", deckPersonalizationKeydownHandler);

  if (deckPersonalizationModal) {
    const focusTarget =
      deckPersonalizationModal.querySelector(".deck-personal-section input, .deck-personal-section select") ??
      deckPersonalizationCloseBtn;
    if (focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus({ preventScroll: false });
    }
  }
};

const COLOR_DISTRIBUTION_META = {
  W: { label: "Blanc", token: "--color-mana-white" },
  U: { label: "Bleu", token: "--color-mana-blue" },
  B: { label: "Noir", token: "--color-mana-black" },
  R: { label: "Rouge", token: "--color-mana-red" },
  G: { label: "Vert", token: "--color-mana-green" },
  C: { label: "Incolore", token: "--color-mana-colorless" },
};
const CARD_NAME_COLLATOR = new Intl.Collator("fr", { sensitivity: "base" });
const NUMBER_FORMAT = new Intl.NumberFormat("fr-FR");

const MANA_SYMBOL_BASE_URL = "https://svgs.scryfall.io/card-symbols";
const MANA_SYMBOL_PATHS = {
  W: "W",
  U: "U",
  B: "B",
  R: "R",
  G: "G",
  C: "C",
  S: "S",
  X: "X",
  Y: "Y",
  Z: "Z",
  P: "P",
  E: "E",
  T: "tap",
  Q: "untap",
  INFINITY: "infinity",
};

const getManaSymbolUrl = (symbol) => {
  if (!symbol) {
    return null;
  }
  const normalized = String(symbol).toUpperCase().trim();
  if (!normalized) {
    return null;
  }
  if (MANA_SYMBOL_PATHS[normalized]) {
    return `${MANA_SYMBOL_BASE_URL}/${MANA_SYMBOL_PATHS[normalized]}.svg`;
  }
  if (/^\d+$/.test(normalized)) {
    return `${MANA_SYMBOL_BASE_URL}/${normalized}.svg`;
  }
  if (normalized === "∞") {
    return `${MANA_SYMBOL_BASE_URL}/${MANA_SYMBOL_PATHS.INFINITY}.svg`;
  }
  const sanitized = normalized.replace(/\//g, "");
  if (!sanitized) {
    return null;
  }
  if (MANA_SYMBOL_PATHS[sanitized]) {
    return `${MANA_SYMBOL_BASE_URL}/${MANA_SYMBOL_PATHS[sanitized]}.svg`;
  }
  if (/^[0-9A-Z]+$/.test(sanitized)) {
    return `${MANA_SYMBOL_BASE_URL}/${sanitized}.svg`;
  }
  return null;
};

const createManaSymbolElement = (symbol) => {
  const normalized = String(symbol ?? "").toUpperCase();
  const url = getManaSymbolUrl(normalized);
  if (url) {
    const img = document.createElement("img");
    img.className = "mana-symbol";
    img.src = url;
    img.alt = `{${normalized}}`;
    img.loading = "lazy";
    img.decoding = "async";
    const description = describeManaSymbol(normalized);
    if (description) {
      img.title = description;
    }
    return img;
  }
  const fallback = document.createElement("span");
  fallback.className = "mana-symbol mana-symbol-fallback";
  fallback.textContent = `{${symbol}}`;
  const description = describeManaSymbol(normalized);
  if (description) {
    fallback.title = description;
  }
  return fallback;
};

const isLandCard = (cardData) => {
  if (!cardData || typeof cardData !== "object") {
    return false;
  }
  const typeLine = String(cardData.type_line ?? cardData.typeLine ?? "")
    .toLowerCase()
    .trim();
  if (!typeLine) {
    return false;
  }
  return typeLine.includes("land") || typeLine.includes("terrain");
};

const isPermanentCard = (cardData) => {
  if (!cardData || typeof cardData !== "object") {
    return false;
  }
  const typeLine = String(cardData.type_line ?? cardData.typeLine ?? "")
    .toLowerCase()
    .trim();
  if (!typeLine) {
    return false;
  }
  const nonPermanentTokens = ["instant", "éphémère", "ephemere", "sorcery", "rituel"];
  return !nonPermanentTokens.some((token) => typeLine.includes(token));
};

const computeManaValueFromCost = (manaCost) => {
  const symbols = extractManaSymbols(manaCost);
  if (symbols.length === 0) {
    return null;
  }

  let total = 0;
  symbols.forEach((symbol) => {
    const upper = symbol.toUpperCase();
    if (/^\d+$/.test(upper)) {
      total += Number(upper);
      return;
    }
    if (upper === "X" || upper === "Y" || upper === "Z" || upper === "T" || upper === "Q") {
      return;
    }
    if (upper === "∞") {
      return;
    }
    if (upper.includes("/")) {
      const parts = upper.split("/").filter(Boolean);
      if (parts.includes("P")) {
        total += 1;
        return;
      }
      const numericParts = parts
        .filter((part) => /^\d+$/.test(part))
        .map((part) => Number(part));
      if (numericParts.length > 0) {
        total += Math.max(...numericParts);
        return;
      }
      total += 1;
      return;
    }
    total += 1;
  });
  return total;
};

const getCardManaValue = (cardData) => {
  if (!cardData || typeof cardData !== "object") {
    return null;
  }
  const direct =
    typeof cardData.cmc === "number" && Number.isFinite(cardData.cmc)
      ? cardData.cmc
      : typeof cardData.mana_value === "number" && Number.isFinite(cardData.mana_value)
      ? cardData.mana_value
      : null;
  if (direct !== null) {
    return direct;
  }
  return computeManaValueFromCost(cardData.mana_cost);
};

const buildGameChangerLookup = (deck) => {
  const map = new Map();
  if (!deck || typeof deck !== "object") {
    return map;
  }
  const tagSources = [];
  if (Array.isArray(deck?.raw?.tags)) {
    tagSources.push(deck.raw.tags);
  }
  if (Array.isArray(deck?.tags)) {
    tagSources.push(deck.tags);
  }

  tagSources.forEach((tags) => {
    tags.forEach((tagEntry) => {
      const cardName = typeof tagEntry?.card_name === "string" ? tagEntry.card_name.trim() : "";
      if (!cardName) {
        return;
      }
      const normalized = cardName.toLowerCase();
      const buckets = Array.isArray(tagEntry?.tags) ? tagEntry.tags : [];
      const isGameChanger = buckets.some(
        (value) => typeof value === "string" && value.toLowerCase() === "game changer"
      );
      if (isGameChanger) {
        map.set(normalized, true);
      }
    });
  });

  return map;
};

const computeDeckStatistics = (deck) => {
  if (!deck || typeof deck !== "object") {
    return null;
  }

  const boards = collectDeckBoards(deck);
  if (!Array.isArray(boards) || boards.length === 0) {
    return null;
  }

  const mainboard =
    boards.find((board) => (board?.name ?? "").toLowerCase() === "mainboard") ?? boards[0];
  const cards = Array.isArray(mainboard?.cards) ? mainboard.cards : [];

  const bucketOrder = ["0", "1", "2", "3", "4", "5", "6", "7", "8+"];
  const bucketMap = new Map(
    bucketOrder.map((label) => [
      label,
      {
        label,
        total: 0,
        permanentCount: 0,
        spellCount: 0,
        permanentCards: [],
        spellCards: [],
      },
    ])
  );
  let nonLandCount = 0;
  let manaValueSum = 0;

  const colorWeights = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
  };
  let colorWeightTotal = 0;
  const allowedColorCodes = new Set(Object.keys(COLOR_DISTRIBUTION_META));

  const manaPipCounts = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
    GENERIC: 0,
  };

  const gameChangerLookup = buildGameChangerLookup(deck);
  let gameChangerCount = 0;
  const gameChangerNames = new Set();

  let permanentCount = 0;
  let nonPermanentCount = 0;

  const tallyManaSymbols = (symbol, quantity) => {
    if (!symbol || quantity <= 0) {
      return;
    }
    const normalized = String(symbol).toUpperCase().trim();
    if (!normalized) {
      return;
    }
    if (/^\d+$/.test(normalized)) {
      manaPipCounts.GENERIC += Number(normalized) * quantity;
      return;
    }
    if (normalized === "∞" || normalized === "X" || normalized === "Y" || normalized === "Z") {
      return;
    }
    if (normalized === "C") {
      manaPipCounts.C += quantity;
      return;
    }
    if (normalized.includes("/")) {
      const parts = normalized.split("/").filter(Boolean);
      if (parts.length === 0) {
        return;
      }
      const colorParts = parts.filter((part) => Object.prototype.hasOwnProperty.call(manaPipCounts, part));
      const numericParts = parts.filter((part) => /^\d+$/.test(part));
      numericParts.forEach((part) => {
        manaPipCounts.GENERIC += Number(part) * quantity;
      });
      const share =
        colorParts.length > 0 ? quantity / colorParts.length : 0;
      colorParts.forEach((part) => {
        manaPipCounts[part] += share;
      });
      if (parts.includes("C") && !colorParts.includes("C")) {
        manaPipCounts.C += quantity;
      }
      return;
    }
    if (Object.prototype.hasOwnProperty.call(manaPipCounts, normalized)) {
      manaPipCounts[normalized] += quantity;
    }
  };

  cards.forEach((cardEntry) => {
    if (!cardEntry || typeof cardEntry !== "object") {
      return;
    }
    const quantity =
      typeof cardEntry.quantity === "number" && Number.isFinite(cardEntry.quantity)
        ? cardEntry.quantity
        : 0;
    if (quantity <= 0) {
      return;
    }
    const cardData = cardEntry.card ?? {};
    const manaValue = getCardManaValue(cardData);
    const land = isLandCard(cardData);
    const permanent = isPermanentCard(cardData);

    if (!land && manaValue !== null) {
      const bucketKey = manaValue >= 8 ? "8+" : String(Math.max(0, Math.floor(manaValue)));
      const bucket = bucketMap.get(bucketKey);
      if (bucket) {
        bucket.total += quantity;
        if (permanent) {
          bucket.permanentCount += quantity;
          bucket.permanentCards.push({
            name: cardData?.name ?? "Carte inconnue",
            quantity,
            typeLine: cardData?.type_line ?? cardData?.typeLine ?? "—",
            manaCost: cardData?.mana_cost ?? null,
          });
        } else {
          bucket.spellCount += quantity;
          bucket.spellCards.push({
            name: cardData?.name ?? "Carte inconnue",
            quantity,
            typeLine: cardData?.type_line ?? cardData?.typeLine ?? "—",
            manaCost: cardData?.mana_cost ?? null,
          });
        }
      }
      manaValueSum += manaValue * quantity;
      nonLandCount += quantity;
    }

    if (!land) {
      if (permanent) {
        permanentCount += quantity;
      } else {
        nonPermanentCount += quantity;
      }
    }

    const cardName = typeof cardData?.name === "string" ? cardData.name.toLowerCase() : null;
    if (cardName && gameChangerLookup.has(cardName)) {
      gameChangerCount += quantity;
      if (cardData?.name) {
        gameChangerNames.add(cardData.name);
      } else {
        gameChangerNames.add(cardName);
      }
    }

    const colors = Array.isArray(cardData?.colors) ? cardData.colors : [];
    const normalizedColors = Array.from(
      new Set(
        colors
          .map((color) => String(color || "").toUpperCase())
          .filter((code) => code && allowedColorCodes.has(code))
      )
    );

    if (normalizedColors.length === 0) {
      colorWeights.C += quantity;
      colorWeightTotal += quantity;
    } else {
      const share = quantity / normalizedColors.length;
      normalizedColors.forEach((code) => {
        if (!Object.prototype.hasOwnProperty.call(colorWeights, code)) {
          colorWeights[code] = 0;
        }
        colorWeights[code] += share;
      });
      colorWeightTotal += quantity;
    }

    const manaSymbols = extractManaSymbols(cardData?.mana_cost);
    if (Array.isArray(manaSymbols) && manaSymbols.length > 0) {
      manaSymbols.forEach((symbol) => {
        tallyManaSymbols(symbol, quantity);
      });
    }
  });

  const manaCurve = bucketOrder.map((label) => {
    const bucket = bucketMap.get(label) ?? {
      label,
      total: 0,
      permanentCount: 0,
      spellCount: 0,
      permanentCards: [],
      spellCards: [],
    };
    const total = Math.round(bucket.total ?? 0);
    const permanentTotal = Math.round(bucket.permanentCount ?? 0);
    const spellTotal = Math.round(bucket.spellCount ?? 0);
    return {
      label,
      value: total,
      total,
      permanentCount: permanentTotal,
      spellCount: spellTotal,
      permanentCards: bucket.permanentCards ?? [],
      spellCards: bucket.spellCards ?? [],
    };
  });
  const manaCurveMax = manaCurve.reduce((max, bucket) => Math.max(max, bucket.total ?? 0), 0);
  const averageManaValue =
    nonLandCount > 0 ? Number((manaValueSum / nonLandCount).toFixed(2)) : null;

  const colorOrder = ["W", "U", "B", "R", "G", "C"];
  const pipColorTotal = colorOrder.reduce((sum, color) => sum + (manaPipCounts[color] ?? 0), 0);

  const colorDistribution = colorOrder
    .map((color) => {
      const value = colorWeights[color] ?? 0;
      const meta = COLOR_DISTRIBUTION_META[color] ?? { label: color, token: "--color-white" };
      const ratio = colorWeightTotal > 0 ? value / colorWeightTotal : 0;
      const pipCount = manaPipCounts[color] ?? 0;
      const pipRatio = pipColorTotal > 0 ? pipCount / pipColorTotal : 0;
      return {
        color,
        label: meta.label,
        token: meta.token,
        value,
        ratio,
        pipCount,
        pipRatio,
      };
    })
    .filter(
      (entry) =>
        entry.value > 0 ||
        colorWeightTotal === 0 ||
        entry.pipCount > 0 ||
        pipColorTotal === 0
    );

  const manaPips = {
    colors: {
      W: manaPipCounts.W,
      U: manaPipCounts.U,
      B: manaPipCounts.B,
      R: manaPipCounts.R,
      G: manaPipCounts.G,
      C: manaPipCounts.C,
    },
    generic: manaPipCounts.GENERIC,
    total:
      pipColorTotal +
      manaPipCounts.GENERIC,
  };

  const gameChangerCards = Array.from(gameChangerNames).sort((a, b) =>
    CARD_NAME_COLLATOR.compare(a, b)
  );

  return {
    manaCurve,
    manaCurveMax,
    averageManaValue,
    colorDistribution,
    colorWeightTotal,
    gameChangerCount,
    gameChangerCards,
    nonLandCount,
    permanentCount,
    nonPermanentCount,
    manaPips,
  };
};

const toDateSafe = (value) => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeIdentifier = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  return text.toLowerCase();
};

const addIdentifierToSet = (set, value) => {
  const normalized = normalizeIdentifier(value);
  if (normalized) {
    set.add(normalized);
  }
};

const collectDeckIdentifiers = (deck) => {
  const identifiers = new Set();
  if (!deck || typeof deck !== "object") {
    return identifiers;
  }

  addIdentifierToSet(identifiers, getDeckIdentifier(deck));
  addIdentifierToSet(identifiers, deck.id);
  addIdentifierToSet(identifiers, deck.slug);
  addIdentifierToSet(identifiers, deck.publicId);
  addIdentifierToSet(identifiers, deck.public_id);
  addIdentifierToSet(identifiers, deck.deckId);

  const raw = deck.raw && typeof deck.raw === "object" ? deck.raw : null;
  if (raw) {
    addIdentifierToSet(identifiers, raw.id);
    addIdentifierToSet(identifiers, raw.slug);
    addIdentifierToSet(identifiers, raw.public_id);
    addIdentifierToSet(identifiers, raw.publicId);
  }

  const addUrlTokens = (url) => {
    if (typeof url !== "string") {
      return;
    }
    url
      .split(/[/?#]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => addIdentifierToSet(identifiers, part));
  };

  addUrlTokens(deck.url);
  addUrlTokens(deck.publicUrl);
  addUrlTokens(deck.public_url);
  if (raw) {
    addUrlTokens(raw.url);
    addUrlTokens(raw.public_url);
  }

  return identifiers;
};

const collectPlayerIdentifiers = (player) => {
  const identifiers = [];
  const push = (value) => {
    const normalized = normalizeIdentifier(value);
    if (normalized) {
      identifiers.push(normalized);
    }
  };

  if (!player || typeof player !== "object") {
    return identifiers;
  }

  [
    player.deck_id,
    player.deckId,
    player.deck_slug,
    player.deckSlug,
    player.deck_public_id,
    player.deckPublicId,
    player.deck_publicId,
  ].forEach(push);

  const addUrlTokens = (url) => {
    if (typeof url !== "string") {
      return;
    }
    url
      .split(/[/?#]/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .forEach(push);
  };

  addUrlTokens(player.deck_public_url);
  addUrlTokens(player.deck_publicUrl);
  addUrlTokens(player.deckUrl);

  return identifiers;
};

const doesPlayerMatchDeck = (player, deckIdentifiers) => {
  if (!player || !(deckIdentifiers instanceof Set) || deckIdentifiers.size === 0) {
    return false;
  }
  const identifiers = collectPlayerIdentifiers(player);
  return identifiers.some((identifier) => deckIdentifiers.has(identifier));
};

const summariseDeckPerformance = (deck, games) => {
  const deckId = getDeckIdentifier(deck) ?? deck?.id ?? null;
  const result = {
    status: "empty",
    deckId,
    deckName: deck?.name ?? null,
    totalGames: 0,
    rankedGames: 0,
    unrankedGames: 0,
    winCount: 0,
    lossCount: 0,
    winRate: null,
    positions: [],
    startingPositions: [],
    history: [],
    lastPlayedAt: null,
  };

  if (!deckId || !Array.isArray(games) || games.length === 0) {
    return result;
  }

  const deckIdentifiers = collectDeckIdentifiers(deck);
  if (deckIdentifiers.size === 0) {
    deckIdentifiers.add(normalizeIdentifier(deckId));
  }

  const history = [];
  const positionMap = new Map();
  const startingPositionMap = new Map();
  let winCount = 0;
  let rankedGames = 0;

  const resolveStartingPosition = (player) => {
    if (!player || typeof player !== "object") {
      return null;
    }
    const candidates = [
      player.order,
      player.turn_order,
      player.turnOrder,
      player.starting_position,
      player.startingPosition,
      player.seat,
      player.seat_position,
    ];
    for (const candidate of candidates) {
      const numeric = Number.parseInt(candidate, 10);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
    return null;
  };

  games.forEach((game) => {
    if (!game || typeof game !== "object") {
      return;
    }
    const players = Array.isArray(game.players) ? game.players : [];
    if (players.length === 0) {
      return;
    }

    const rankingMap = new Map();
    (Array.isArray(game.rankings) ? game.rankings : []).forEach((ranking) => {
      const playerId = ranking?.player_id ?? ranking?.playerId;
      if (!playerId) {
        return;
      }
      const parsedRank = Number.parseInt(ranking.rank ?? ranking?.position ?? ranking?.value, 10);
      if (Number.isFinite(parsedRank) && parsedRank > 0) {
        rankingMap.set(playerId, parsedRank);
      }
    });

    const matchingPlayers = players.filter((player) => doesPlayerMatchDeck(player, deckIdentifiers));
    if (matchingPlayers.length === 0) {
      return;
    }

    const participant =
      matchingPlayers.find((player) => Boolean(player?.is_owner)) ?? matchingPlayers[0];
    const rawRank = rankingMap.get(participant?.id) ?? null;
    const rank = Number.isFinite(rawRank) && rawRank > 0 ? rawRank : null;
    const startingPosition = resolveStartingPosition(participant);

    const createdAt = toDateSafe(game.created_at ?? game.updated_at ?? null);
    const opponents = players
      .filter((player) => player && player.id !== participant?.id)
      .map((player) => ({
        id: player.id ?? null,
        name:
          typeof player.name === "string" && player.name.trim().length > 0
            ? player.name.trim()
            : "Joueur inconnu",
        rank: rankingMap.get(player.id) ?? null,
        isOwner: Boolean(player.is_owner),
        deckName: typeof player.deck_name === "string" ? player.deck_name : null,
      }));

    const historyEntry = {
      id:
        game.id ??
        `${game.created_at ?? game.updated_at ?? Date.now()}-${participant?.id ?? "participant"}`,
      createdAt,
      createdAtRaw: game.created_at ?? game.updated_at ?? null,
      playgroupName:
        typeof game.playgroup?.name === "string" && game.playgroup.name.trim().length > 0
          ? game.playgroup.name.trim()
          : "Partie enregistrée",
      rank,
      playerCount: players.length,
      isWin: rank === 1,
      notes: typeof game.notes === "string" ? game.notes.trim() : "",
      opponents,
    };
    history.push(historyEntry);

    if (startingPosition !== null) {
      startingPositionMap.set(
        startingPosition,
        (startingPositionMap.get(startingPosition) ?? 0) + 1
      );
    }

    if (rank !== null) {
      rankedGames += 1;
      if (rank === 1) {
        winCount += 1;
      }
      positionMap.set(rank, (positionMap.get(rank) ?? 0) + 1);
    }
  });

  history.sort((a, b) => {
    const timeA =
      a.createdAt instanceof Date && !Number.isNaN(a.createdAt.getTime())
        ? a.createdAt.getTime()
        : a.createdAtRaw
        ? new Date(a.createdAtRaw).getTime()
        : 0;
    const timeB =
      b.createdAt instanceof Date && !Number.isNaN(b.createdAt.getTime())
        ? b.createdAt.getTime()
        : b.createdAtRaw
        ? new Date(b.createdAtRaw).getTime()
        : 0;
    return timeB - timeA;
  });

  const totalGames = history.length;
  const unrankedGames = totalGames - rankedGames;
  const lossCount = Math.max(0, rankedGames - winCount);
  const winRate = rankedGames > 0 ? winCount / rankedGames : null;
  const positions = Array.from(positionMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rank, count]) => ({ rank, count }));
  const startingPositions = Array.from(startingPositionMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([position, count]) => ({ position, count }));

  result.status = totalGames > 0 ? "ready" : "empty";
  result.totalGames = totalGames;
  result.rankedGames = rankedGames;
  result.unrankedGames = unrankedGames;
  result.winCount = winCount;
  result.lossCount = lossCount;
  result.winRate = winRate;
  result.positions = positions;
  result.startingPositions = startingPositions;
  result.history = history;
  result.lastPlayedAt = history[0]?.createdAt ?? null;

  return result;
};

const formatFinishLabel = (rank) => {
  if (!Number.isFinite(rank) || rank <= 0) {
    return "—";
  }
  return rank === 1 ? "1er" : `${rank}e`;
};

const formatPercentageLabel = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
};

const TURN_ORDER_COLOR_PALETTE = [
  "var(--color-brand-primary)",
  "var(--color-brand-secondary)",
  "var(--color-status-success)",
  "var(--color-status-danger)",
  "var(--color-brand-muted)",
  "var(--color-accent-lilac)",
  "var(--color-brand-plum)",
  "var(--color-status-warning)",
];

const updateDeckPerformance = (state) => {
  if (!deckPerformanceEl) {
    return;
  }

  deckPerformanceEl.innerHTML = "";
  deckPerformanceEl.classList.add("is-hidden");
  deckPerformanceEl.dataset.state = state?.status ?? "idle";
  deckPerformanceEl.dataset.deckId =
    state?.deckId !== undefined && state?.deckId !== null ? String(state.deckId) : "";

  if (!state) {
    return;
  }

  const renderStatus = (message, className = "") => {
    const statusEl = document.createElement("p");
    statusEl.className = `deck-performance-status${className ? ` ${className}` : ""}`;
    statusEl.textContent = message;
    deckPerformanceEl.appendChild(statusEl);
    deckPerformanceEl.classList.remove("is-hidden");
  };

  switch (state.status) {
    case "loading": {
      const loader = document.createElement("p");
      loader.className = "deck-performance-status deck-performance-status-loading";
      loader.innerHTML = `<span aria-hidden="true">⏳</span><span>Analyse des parties…</span>`;
      deckPerformanceEl.appendChild(loader);
      deckPerformanceEl.classList.remove("is-hidden");
      return;
    }
    case "error": {
      renderStatus(
        state.message ?? "Impossible de charger les performances de ce deck.",
        "is-error"
      );
      return;
    }
    case "empty": {
      renderStatus(
        state.message ?? "Aucune partie enregistrée avec ce deck pour le moment."
      );
      return;
    }
    case "ready":
    default:
      break;
  }

  if (!Array.isArray(state.history) || state.history.length === 0) {
    renderStatus(
      state.message ?? "Aucune partie enregistrée avec ce deck pour le moment."
    );
    deckPerformanceEl.dataset.state = "empty";
    return;
  }

  const content = document.createElement("div");
  content.className = "deck-performance-content";

  const overview = document.createElement("div");
  overview.className = "deck-performance-overview";

  const summaryCard = document.createElement("article");
  summaryCard.className = "deck-performance-card deck-stats-card deck-performance-card-summary";
  const summaryTitle = document.createElement("h3");
  summaryTitle.className = "deck-performance-card-title";
  summaryTitle.textContent = "Winrate";
  summaryCard.appendChild(summaryTitle);

  const winrateValue = document.createElement("span");
  winrateValue.className = "deck-performance-winrate-value";
  if (state.winRate === null) {
    winrateValue.textContent = "—";
  } else {
    const percent = state.winRate * 100;
    winrateValue.textContent = `${percent.toLocaleString("fr-FR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}%`;
  }
  summaryCard.appendChild(winrateValue);

  const detail = document.createElement("p");
  detail.className = "deck-performance-winrate-detail";
  if (state.rankedGames > 0) {
    detail.textContent = `${NUMBER_FORMAT.format(
      state.rankedGames
    )} partie${state.rankedGames > 1 ? "s" : ""} classée${
      state.rankedGames > 1 ? "s" : ""
    } analysée${state.rankedGames > 1 ? "s" : ""}.`;
  } else {
    detail.textContent = "Aucune partie classée disponible pour calculer un winrate.";
  }
  summaryCard.appendChild(detail);

  const summaryMeta = document.createElement("p");
  summaryMeta.className = "deck-performance-summary-meta";
  const metaParts = [
    `${NUMBER_FORMAT.format(state.totalGames)} partie${
      state.totalGames > 1 ? "s" : ""
    }`,
  ];
  if (state.unrankedGames > 0) {
    metaParts.push(
      `${NUMBER_FORMAT.format(state.rankedGames)} avec classement`
    );
  }
  if (state.lastPlayedAt instanceof Date && !Number.isNaN(state.lastPlayedAt.getTime())) {
    metaParts.push(
      `Dernière partie le ${formatDateTime(state.lastPlayedAt, { dateStyle: "medium" })}`
    );
  }
  summaryMeta.textContent = metaParts.join(" · ");
  summaryCard.appendChild(summaryMeta);

  const positionsSection = document.createElement("div");
  positionsSection.className = "deck-performance-positions-summary";

  if (!Array.isArray(state.positions) || state.positions.length === 0) {
    const emptyPositions = document.createElement("p");
    emptyPositions.className = "deck-performance-card-empty";
    emptyPositions.textContent = "Aucune position disponible.";
    positionsSection.appendChild(emptyPositions);
  } else {
    const positionsList = document.createElement("ul");
    positionsList.className = "deck-performance-positions-list";
    positionsList.setAttribute(
      "aria-label",
      "Répartition des positions finales observées."
    );
    state.positions.forEach((position) => {
      const listItem = document.createElement("li");
      listItem.className = "deck-performance-position";
      listItem.setAttribute(
        "aria-label",
        `${formatFinishLabel(position.rank)} : ${NUMBER_FORMAT.format(position.count)} partie${
          position.count > 1 ? "s" : ""
        }`
      );

      const rankEl = document.createElement("span");
      rankEl.className = "deck-performance-position-rank";
      rankEl.textContent = formatFinishLabel(position.rank);
      listItem.appendChild(rankEl);

      const progress = document.createElement("div");
      progress.className = "deck-performance-position-progress";
      progress.setAttribute("aria-hidden", "true");
      const progressFill = document.createElement("div");
      progressFill.className = "deck-performance-position-progress-fill";
      const ratio =
        state.rankedGames > 0
          ? Math.max(0, Math.min(1, position.count / state.rankedGames))
          : 0;
      progressFill.style.setProperty("--deck-performance-position-ratio", String(ratio));
      progress.appendChild(progressFill);
      listItem.appendChild(progress);

      const valueEl = document.createElement("span");
      valueEl.className = "deck-performance-position-value";
      const percentage =
        state.rankedGames > 0
          ? (position.count / state.rankedGames) * 100
          : 0;
      valueEl.textContent = `${NUMBER_FORMAT.format(position.count)} partie${
        position.count > 1 ? "s" : ""
      } (${percentage.toLocaleString("fr-FR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      })}%)`;
      listItem.appendChild(valueEl);

      positionsList.appendChild(listItem);
    });
    positionsSection.appendChild(positionsList);
  }

  summaryCard.appendChild(positionsSection);

  if (state.unrankedGames > 0) {
    const footnote = document.createElement("p");
    footnote.className = "deck-performance-footnote";
    footnote.textContent = `${NUMBER_FORMAT.format(
      state.unrankedGames
    )} partie${state.unrankedGames > 1 ? "s" : ""} sans classement.`;
    summaryCard.appendChild(footnote);
  }

  overview.appendChild(summaryCard);

  const safeStartingPositions = Array.isArray(state.startingPositions)
    ? state.startingPositions
        .map((entry) => ({
          position: Number.isFinite(entry?.position)
            ? entry.position
            : Number.parseInt(entry?.position ?? "", 10),
          count: Number.isFinite(entry?.count)
            ? entry.count
            : Number.parseInt(entry?.count ?? "", 10),
        }))
        .filter(
          (entry) =>
            Number.isFinite(entry.position) &&
            entry.position > 0 &&
            Number.isFinite(entry.count) &&
            entry.count > 0
        )
    : [];

  const turnOrderCard = document.createElement("article");
  turnOrderCard.className = "deck-performance-card deck-stats-card deck-performance-card-turn-order";
  const turnOrderTitle = document.createElement("h3");
  turnOrderTitle.className = "deck-performance-card-title";
  turnOrderTitle.textContent = "Positions de départ";
  turnOrderCard.appendChild(turnOrderTitle);

  const turnOrderTotal = safeStartingPositions.reduce(
    (sum, entry) => sum + Math.max(0, entry.count),
    0
  );

  if (turnOrderTotal <= 0) {
    const emptyTurnOrder = document.createElement("p");
    emptyTurnOrder.className = "deck-performance-card-empty";
    emptyTurnOrder.textContent = "Aucune donnée sur les positions de départ.";
    turnOrderCard.appendChild(emptyTurnOrder);
  } else {
    const normalizedPositions = safeStartingPositions.map((entry, index) => ({
      position: entry.position,
      count: entry.count,
      ratio: entry.count / turnOrderTotal,
      color: TURN_ORDER_COLOR_PALETTE[index % TURN_ORDER_COLOR_PALETTE.length],
    }));

    const turnOrderBody = document.createElement("div");
    turnOrderBody.className = "deck-turn-order-body";

    const ring = document.createElement("div");
    ring.className = "deck-turn-order-ring";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("deck-turn-order-ring-svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "Répartition des positions de départ."
    );

    const radius = 48;
    const center = 60;
    const circumference = 2 * Math.PI * radius;

    const baseCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    baseCircle.classList.add("deck-turn-order-ring-base");
    baseCircle.setAttribute("cx", String(center));
    baseCircle.setAttribute("cy", String(center));
    baseCircle.setAttribute("r", String(radius));
    baseCircle.setAttribute("fill", "transparent");
    baseCircle.setAttribute("stroke-width", "12");
    svg.appendChild(baseCircle);

    let offset = 0;
    normalizedPositions.forEach((entry) => {
      const segmentLength = entry.ratio * circumference;
      if (!(segmentLength > 0)) {
        return;
      }
      const segment = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      segment.classList.add("deck-turn-order-ring-segment");
      segment.setAttribute("cx", String(center));
      segment.setAttribute("cy", String(center));
      segment.setAttribute("r", String(radius));
      segment.setAttribute("fill", "transparent");
      segment.setAttribute("stroke-width", "12");
      segment.setAttribute("stroke", entry.color);
      segment.setAttribute(
        "stroke-dasharray",
        `${segmentLength.toFixed(2)} ${circumference.toFixed(2)}`
      );
      segment.setAttribute("stroke-dashoffset", `${(-offset).toFixed(2)}`);
      const percentageLabel = (entry.ratio * 100).toLocaleString("fr-FR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      });
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `Position ${entry.position} : ${NUMBER_FORMAT.format(entry.count)} partie${
        entry.count > 1 ? "s" : ""
      } (${percentageLabel}%)`;
      segment.appendChild(title);
      svg.appendChild(segment);
      offset += segmentLength;
    });

    ring.appendChild(svg);

    const ringCenter = document.createElement("div");
    ringCenter.className = "deck-turn-order-ring-center";
    const centerValue = document.createElement("strong");
    centerValue.textContent = NUMBER_FORMAT.format(turnOrderTotal);
    const centerLabel = document.createElement("span");
    centerLabel.textContent = `partie${turnOrderTotal > 1 ? "s" : ""}`;
    ringCenter.append(centerValue, centerLabel);
    ring.appendChild(ringCenter);

    turnOrderBody.appendChild(ring);

    const legend = document.createElement("ul");
    legend.className = "deck-turn-order-legend";

    normalizedPositions.forEach((entry) => {
      const legendItem = document.createElement("li");
      legendItem.className = "deck-turn-order-legend-item";

      const swatch = document.createElement("span");
      swatch.className = "deck-turn-order-legend-swatch";
      swatch.style.setProperty("--deck-turn-order-swatch-color", entry.color);
      legendItem.appendChild(swatch);

      const label = document.createElement("span");
      label.className = "deck-turn-order-legend-label";
      label.textContent = `#${entry.position}`;
      legendItem.appendChild(label);

      const value = document.createElement("span");
      value.className = "deck-turn-order-legend-value";
      value.textContent = `${(entry.ratio * 100).toLocaleString("fr-FR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      })}% · ${NUMBER_FORMAT.format(entry.count)}`;
      legendItem.appendChild(value);

      legend.appendChild(legendItem);
    });

    turnOrderBody.appendChild(legend);
    turnOrderCard.appendChild(turnOrderBody);
  }

  overview.appendChild(turnOrderCard);
  content.appendChild(overview);

  const historyCard = document.createElement("article");
  historyCard.className = "deck-performance-card deck-stats-card deck-performance-card-history";
  const historyTitle = document.createElement("h3");
  historyTitle.className = "deck-performance-card-title";
  historyTitle.textContent = "Historique des parties";
  historyCard.appendChild(historyTitle);

  const historyList = document.createElement("ol");
  historyList.className = "deck-performance-history-list";
  historyList.setAttribute(
    "aria-label",
    "Liste des parties enregistrées avec ce deck (les plus récentes en premier)."
  );

  state.history.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "deck-performance-history-item";

    const header = document.createElement("div");
    header.className = "deck-performance-history-header";

    const dateEl = document.createElement("time");
    dateEl.className = "deck-performance-history-date";
    if (entry.createdAt instanceof Date && !Number.isNaN(entry.createdAt.getTime())) {
      dateEl.dateTime = entry.createdAt.toISOString();
      dateEl.textContent = formatDateTime(entry.createdAt, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } else if (entry.createdAtRaw) {
      dateEl.textContent = formatDateTime(entry.createdAtRaw, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } else {
      dateEl.textContent = "Date inconnue";
    }
    header.appendChild(dateEl);

    const groupEl = document.createElement("span");
    groupEl.className = "deck-performance-history-playgroup";
    groupEl.textContent = entry.playgroupName ?? "Partie enregistrée";
    header.appendChild(groupEl);

    item.appendChild(header);

    const outcome = document.createElement("div");
    outcome.className = "deck-performance-history-outcome";
    const rankBadge = document.createElement("span");
    rankBadge.className = "deck-performance-history-rank";
    rankBadge.textContent = formatFinishLabel(entry.rank);
    if (entry.isWin) {
      rankBadge.classList.add("is-win");
      rankBadge.setAttribute("aria-label", "Victoire");
    }
    outcome.appendChild(rankBadge);

    const countEl = document.createElement("span");
    countEl.className = "deck-performance-history-count";
    countEl.textContent = `${NUMBER_FORMAT.format(entry.playerCount ?? 0)} joueur${
      (entry.playerCount ?? 0) > 1 ? "s" : ""
    }`;
    outcome.appendChild(countEl);

    item.appendChild(outcome);

    if (entry.notes) {
      const notesEl = document.createElement("p");
      notesEl.className = "deck-performance-history-notes";
      notesEl.textContent = entry.notes;
      item.appendChild(notesEl);
    }

    if (Array.isArray(entry.opponents) && entry.opponents.length > 0) {
      const opponentsList = document.createElement("ul");
      opponentsList.className = "deck-performance-history-opponents";
      opponentsList.setAttribute("aria-label", "Adversaires");
      entry.opponents.forEach((opponent) => {
        const opponentItem = document.createElement("li");
        const opponentParts = [
          opponent.name ?? "Adversaire",
        ];
        if (Number.isFinite(opponent.rank) && opponent.rank > 0) {
          opponentParts.push(formatFinishLabel(opponent.rank));
        }
        opponentItem.textContent = opponentParts.join(" · ");
        opponentsList.appendChild(opponentItem);
      });
      item.appendChild(opponentsList);
    }

    historyList.appendChild(item);
  });

  historyCard.appendChild(historyList);
  content.appendChild(historyCard);

  deckPerformanceEl.appendChild(content);
  deckPerformanceEl.classList.remove("is-hidden");
  deckPerformanceEl.dataset.state = "ready";
};

const extractDeckBracket = (deck) => {
  if (!deck || typeof deck !== "object") {
    return { bracket: null, justification: null };
  }

  const pickString = (...candidates) => {
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
    return null;
  };

  const bracket = pickString(
    deck.bracket,
    deck?.podlog?.bracket,
    deck?.classification?.bracket,
    deck?.raw?.bracket,
    deck?.raw?.bracket_name,
    deck?.raw?.classification?.bracket,
    deck?.raw?.podlog?.bracket,
    deck?.raw?.podlog?.bracket_name
  );

  const justification = pickString(
    deck?.bracketJustification,
    deck?.bracket_justification,
    deck?.bracketReason,
    deck?.bracket_reason,
    deck?.podlog?.bracketJustification,
    deck?.podlog?.bracket_justification,
    deck?.podlog?.bracketReason,
    deck?.podlog?.bracket_reason,
    deck?.raw?.podlog?.bracketJustification,
    deck?.raw?.podlog?.bracket_justification,
    deck?.raw?.podlog?.bracketReason,
    deck?.raw?.podlog?.bracket_reason
  );

  return { bracket, justification };
};

const formatAverageManaValue = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const buildManaCurveCard = (stats) => {
  if (!stats || !Array.isArray(stats.manaCurve) || stats.manaCurve.length === 0) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "deck-stats-card deck-stats-card-curve";

  const title = document.createElement("h3");
  title.className = "deck-stats-card-title";
  title.textContent = "Courbe de mana";
  card.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "deck-stats-card-subtitle";
  subtitle.textContent =
    "Répartition des permanents et des sorts (hors terrains) par coût converti.";
  card.appendChild(subtitle);

  const chart = document.createElement("div");
  chart.className = "deck-mana-chart";
  const maxValue = Math.max(stats.manaCurveMax ?? 0, 1);
  chart.style.setProperty("--deck-mana-max", String(maxValue));
  chart.setAttribute("role", "list");
  chart.setAttribute(
    "aria-label",
    "Répartition des permanents et des sorts par coût converti (hors terrains)."
  );

  const bars = [];
  const detail = document.createElement("section");
  detail.className = "deck-mana-detail";
  detail.setAttribute("role", "region");
  detail.setAttribute("aria-live", "polite");
  detail.setAttribute(
    "aria-label",
    "Cartes associées au coût de mana sélectionné"
  );

  const buildDetailColumn = (label, cards) => {
    const column = document.createElement("div");
    column.className = "deck-mana-detail-column";
    const total = Array.isArray(cards)
      ? cards.reduce((sum, entry) => sum + Math.max(1, Number(entry?.quantity ?? 1)), 0)
      : 0;
    const heading = document.createElement("h5");
    heading.className = "deck-mana-detail-heading";
    heading.textContent = `${label} (${NUMBER_FORMAT.format(total)})`;
    column.appendChild(heading);

    if (!total) {
      const empty = document.createElement("p");
      empty.className = "deck-mana-detail-empty";
      empty.textContent = "Aucune carte";
      column.appendChild(empty);
      return column;
    }

    const list = document.createElement("ul");
    list.className = "deck-mana-detail-list";

    const sorted = [...cards].sort((a, b) =>
      CARD_NAME_COLLATOR.compare(a?.name ?? "", b?.name ?? "")
    );
    sorted.forEach((entry) => {
      const item = document.createElement("li");
      item.classList.add("deck-mana-detail-item");

      const name = document.createElement("span");
      name.className = "deck-mana-detail-name";
      name.textContent = entry?.name ?? "Carte inconnue";
      item.appendChild(name);

      list.appendChild(item);
    });

    column.appendChild(list);
    return column;
  };

  const renderDetail = (index) => {
    detail.innerHTML = "";
    const safeIndex = index >= 0 && index < stats.manaCurve.length ? index : 0;
    const bucket = stats.manaCurve[safeIndex];
    if (!bucket) {
      const empty = document.createElement("p");
      empty.className = "deck-mana-detail-empty";
      empty.textContent = "Sélectionnez une barre pour afficher les cartes correspondantes.";
      detail.appendChild(empty);
      return;
    }

    const heading = document.createElement("h4");
    heading.className = "deck-mana-detail-title";
    heading.textContent = `Cartes pour un coût ${bucket.label ?? "—"}`;
    detail.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "deck-mana-detail-grid";
    grid.appendChild(buildDetailColumn("Permanents", bucket?.permanentCards ?? []));
    grid.appendChild(buildDetailColumn("Sorts", bucket?.spellCards ?? []));
    detail.appendChild(grid);
  };

  const handleSelect = (index) => {
    bars.forEach((bar, idx) => {
      const isActive = idx === index;
      bar.classList.toggle("is-active", isActive);
      bar.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    renderDetail(index);
  };

  stats.manaCurve.forEach((bucket, index) => {
    const total = Math.max(0, bucket?.total ?? bucket?.value ?? 0);
    const permanentCount = Math.max(0, bucket?.permanentCount ?? 0);
    const spellCount = Math.max(0, bucket?.spellCount ?? 0);
    const permanentRatio = total > 0 ? Math.min(1, permanentCount / total) : 0;
    const spellRatio = total > 0 ? Math.min(1, spellCount / total) : 0;

    const bar = document.createElement("div");
    bar.className = "deck-mana-bar";
    bar.setAttribute("role", "listitem");
    bar.tabIndex = 0;
    bar.dataset.cost = bucket?.label ?? "";
    bar.style.setProperty("--deck-mana-value", String(total));
    bar.setAttribute(
      "aria-label",
      `Coût ${bucket?.label ?? "?"}, ${NUMBER_FORMAT.format(
        permanentCount
      )} permanent${permanentCount > 1 ? "s" : ""}, ${NUMBER_FORMAT.format(spellCount)} sort${
        spellCount > 1 ? "s" : ""
      }. Sélectionner pour afficher les cartes correspondantes.`
    );
    bar.setAttribute("aria-selected", "false");

    const barFill = document.createElement("div");
    barFill.className = "deck-mana-bar-fill";
    bar.appendChild(barFill);

    const spellSegment = document.createElement("div");
    spellSegment.className = "deck-mana-segment deck-mana-segment-spells";
    spellSegment.style.height = `${Math.max(0, Math.min(1, spellRatio)) * 100}%`;
    spellSegment.style.order = "1";
    barFill.appendChild(spellSegment);

    const permanentSegment = document.createElement("div");
    permanentSegment.className = "deck-mana-segment deck-mana-segment-permanents";
    permanentSegment.style.height = `${Math.max(0, Math.min(1, permanentRatio)) * 100}%`;
    permanentSegment.style.order = "2";
    barFill.appendChild(permanentSegment);

    const label = document.createElement("span");
    label.className = "deck-mana-bar-label";
    label.textContent = bucket?.label ?? "—";

    const activate = () => handleSelect(index);
    bar.addEventListener("click", (event) => {
      event.preventDefault();
      activate();
    });
    bar.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });

    bar.title = `Permanents : ${NUMBER_FORMAT.format(permanentCount)} · Sorts : ${NUMBER_FORMAT.format(spellCount)}`;
    bar.appendChild(label);
    chart.appendChild(bar);
    bars.push(bar);
  });

  const legend = document.createElement("div");
  legend.className = "deck-mana-legend-split";
  const buildLegendItem = (label, className) => {
    const item = document.createElement("span");
    item.className = `deck-mana-legend-item ${className}`;
    const swatch = document.createElement("span");
    swatch.className = "deck-mana-legend-swatch";
    item.appendChild(swatch);
    const text = document.createElement("span");
    text.className = "deck-mana-legend-label";
    text.textContent = label;
    item.appendChild(text);
    return item;
  };
  legend.appendChild(buildLegendItem("Permanents", "deck-mana-legend-permanents"));
  legend.appendChild(buildLegendItem("Sorts", "deck-mana-legend-spells"));

  const layout = document.createElement("div");
  layout.className = "deck-mana-body";

  const visual = document.createElement("div");
  visual.className = "deck-mana-visual";
  visual.appendChild(chart);
  visual.appendChild(legend);

  layout.appendChild(visual);
  layout.appendChild(detail);
  card.appendChild(layout);

  const initialIndex = stats.manaCurve.findIndex(
    (bucket) => (bucket?.total ?? bucket?.value ?? 0) > 0
  );
  handleSelect(initialIndex >= 0 ? initialIndex : 0);

  if (typeof stats.averageManaValue === "number") {
    const average = document.createElement("p");
    average.className = "deck-mana-average";
    average.textContent = `Coût moyen (hors terrains) : ${formatAverageManaValue(
      stats.averageManaValue
    )}`;
    card.appendChild(average);
  }

  return card;
};

const buildColorDistributionCard = (stats) => {
  if (
    !stats ||
    !Array.isArray(stats.colorDistribution) ||
    stats.colorDistribution.length === 0
  ) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "deck-stats-card deck-stats-card-colors";

  const title = document.createElement("h3");
  title.className = "deck-stats-card-title";
  title.textContent = "Répartition des symboles";
  card.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "deck-stats-card-subtitle";
  subtitle.textContent = "Symboles de mana présents dans le deck et symboles requis par les coûts de mana.";
  card.appendChild(subtitle);

  const chart = document.createElement("div");
  chart.className = "deck-color-chart";
  chart.setAttribute("aria-hidden", "true");

  let start = 0;
  const totalPips = stats.colorDistribution.reduce(
    (sum, entry) => sum + Math.max(0, entry?.pipCount ?? 0),
    0
  );
  const usePipSegments = totalPips > 0;
  const segments = [];
  stats.colorDistribution.forEach((entry, index) => {
    const pipCount = Math.max(0, entry?.pipCount ?? 0);
    const ratio = usePipSegments
      ? pipCount / totalPips
      : Math.max(0, entry?.ratio ?? 0);
    const portion = Math.round(ratio * 1000) / 10;
    const end = index === stats.colorDistribution.length - 1 ? 100 : Math.min(100, start + portion);
    const token = entry?.token ?? "--color-mana-colorless";
    segments.push(`var(${token}) ${start}% ${end}%`);
    start = end;
  });

  if (segments.length === 0) {
    segments.push("var(--color-mana-colorless) 0% 100%");
  }

  const gradient = `conic-gradient(${segments.join(", ")})`;
  chart.style.background = gradient;
  card.appendChild(chart);

  const legend = document.createElement("ul");
  legend.className = "deck-color-legend";
  legend.setAttribute("role", "list");
  legend.setAttribute(
    "aria-label",
    "Répartition des symboles de mana et symboles requis par les coûts"
  );
  stats.colorDistribution.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "deck-color-legend-item";
    item.setAttribute("role", "listitem");

    const swatch = document.createElement("span");
    swatch.className = "deck-color-legend-swatch";
    swatch.style.setProperty("--deck-color-swatch", `var(${entry?.token ?? "--color-white"})`);

    const icon = createManaSymbolElement(entry?.color ?? "");
    icon.classList.add("deck-color-legend-icon");

    const label = document.createElement("span");
    label.className = "deck-color-legend-label";
    const cardPercentage =
      stats.colorWeightTotal > 0
        ? Math.round((Math.max(0, entry?.ratio ?? 0) * 1000)) / 10
        : 0;
    const pipCountValue = Math.max(0, entry?.pipCount ?? 0);
    const pipPercentage =
      totalPips > 0 ? Math.round((pipCountValue / totalPips) * 1000) / 10 : null;
    const pipCount =
      totalPips > 0
        ? pipCountValue.toLocaleString("fr-FR", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          })
        : null;
    const parts = [
      entry?.label ?? "?",
      `${cardPercentage.toLocaleString("fr-FR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      })}% des cartes`,
    ];
    if (pipCount && pipCountValue > 0) {
      const details = pipPercentage !== null ? `${pipCount} symboles (${pipPercentage.toLocaleString("fr-FR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      })}%)` : `${pipCount} symboles`;
      parts.push(details);
    }
    label.textContent = parts.join(" · ");

    item.appendChild(swatch);
    item.appendChild(icon);
    item.appendChild(label);
    legend.appendChild(item);
  });

  card.appendChild(legend);

  if (stats.manaPips && (stats.manaPips.generic ?? 0) > 0) {
    const genericNote = document.createElement("p");
    genericNote.className = "deck-color-footnote";
    genericNote.textContent = `${Number(stats.manaPips.generic).toLocaleString("fr-FR")} symboles génériques requis.`;
    card.appendChild(genericNote);
  }

  return card;
};

const buildImpactCard = (stats) => {
  if (!stats) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "deck-stats-card deck-stats-card-impact";

  const title = document.createElement("h3");
  title.className = "deck-stats-card-title";
  title.textContent = "Composition du deck";
  card.appendChild(title);

  const grid = document.createElement("dl");
  grid.className = "deck-impact-grid";

  const totalRelevant = Math.max(
    0,
    Number(stats.permanentCount ?? 0) + Number(stats.nonPermanentCount ?? 0)
  );
  const permanentValue = Math.max(0, Number(stats.permanentCount ?? 0));
  const nonPermanentValue = Math.max(0, Number(stats.nonPermanentCount ?? 0));

  const impactItems = [
    {
      label: "Permanents",
      value: NUMBER_FORMAT.format(permanentValue),
      footnote:
        totalRelevant > 0
          ? `${Math.round((permanentValue / totalRelevant) * 1000) / 10}% du total des cartes`
          : null,
    },
    {
      label: "Sorts non permanents",
      value: NUMBER_FORMAT.format(nonPermanentValue),
      footnote:
        totalRelevant > 0
          ? `${Math.round((nonPermanentValue / totalRelevant) * 1000) / 10}% du total des cartes`
          : null,
    },
  ];

  const gameChangerTotal = Math.max(0, stats.gameChangerCount ?? 0);
  if (gameChangerTotal > 0) {
    impactItems.push({
      label: "Game changers",
      value: NUMBER_FORMAT.format(gameChangerTotal),
      footnote: 'Cartes taggées "Game changer" sur Moxfield.',
    });
  }

  impactItems.forEach((item) => {
    const entry = document.createElement("div");
    entry.className = "deck-impact-item";

    const dt = document.createElement("dt");
    dt.className = "deck-impact-label";
    dt.textContent = item.label;

    const dd = document.createElement("dd");
    dd.className = "deck-impact-value";
    dd.textContent = item.value;

    entry.appendChild(dt);
    entry.appendChild(dd);

    if (item.footnote) {
      const note = document.createElement("p");
      note.className = "deck-impact-footnote";
      note.textContent = item.footnote;
      entry.appendChild(note);
    }

    grid.appendChild(entry);
  });

  card.appendChild(grid);
  return card;
};

const createRadarChartComponent = (categories, { maxValue = 5 } = {}) => {
  if (!Array.isArray(categories) || categories.length === 0) {
    return null;
  }

  const size = 240;
  const center = size / 2;
  const radius = center - 28;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("deck-radar-svg");

  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("transform", `translate(${center}, ${center})`);
  svg.appendChild(group);

  const buildPoints = (level) => {
    const fraction = Math.max(0, Math.min(level, 1));
    return categories
      .map((_, index) => {
        const angle = (Math.PI * 2 * index) / categories.length - Math.PI / 2;
        const x = Math.cos(angle) * radius * fraction;
        const y = Math.sin(angle) * radius * fraction;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  for (let i = 1; i <= maxValue; i += 1) {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.classList.add("deck-radar-grid");
    polygon.setAttribute("points", buildPoints(i / maxValue));
    group.appendChild(polygon);
  }

  const axisLabels = categories.map((category, index) => {
    const angle = (Math.PI * 2 * index) / categories.length - Math.PI / 2;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("deck-radar-axis");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", "0");
    line.setAttribute("x2", (Math.cos(angle) * radius).toFixed(2));
    line.setAttribute("y2", (Math.sin(angle) * radius).toFixed(2));
    group.appendChild(line);
    const labelRadius = radius + 26;
    const labelX = Math.cos(angle) * labelRadius;
    const labelY = Math.sin(angle) * labelRadius;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.classList.add("deck-radar-axis-label");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("x", labelX.toFixed(2));
    text.setAttribute("y", labelY.toFixed(2));
    const nameSpan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    nameSpan.textContent = category.label;
    nameSpan.setAttribute("x", labelX.toFixed(2));
    nameSpan.setAttribute("dy", "0");
    const valueSpan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    valueSpan.classList.add("deck-radar-axis-value");
    valueSpan.textContent = "-";
    valueSpan.setAttribute("x", labelX.toFixed(2));
    valueSpan.setAttribute("dy", "1.1em");
    text.append(nameSpan, valueSpan);
    group.appendChild(text);
    return { text, value: valueSpan };
  });

  const shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  shape.classList.add("deck-radar-shape");
  group.appendChild(shape);

  const points = categories.map(() => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.classList.add("deck-radar-point");
    circle.setAttribute("r", "3");
    group.appendChild(circle);
    return circle;
  });

  const update = (values) => {
    const normalizedValues = Array.isArray(values) ? values : [];
    let hasValue = false;
    const coordinates = categories.map((category, index) => {
      const rawValue = normalizedValues[index];
      const numeric = Number(rawValue);
      const isValid = Number.isFinite(numeric);
      const clamped = isValid ? Math.min(Math.max(numeric, 0), maxValue) : 0;
      if (isValid && clamped > 0) {
        hasValue = true;
      }
      const angle = (Math.PI * 2 * index) / categories.length - Math.PI / 2;
      const distance = (clamped / maxValue) * radius;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const point = points[index];
      if (point) {
        point.setAttribute("cx", x.toFixed(2));
        point.setAttribute("cy", y.toFixed(2));
        point.style.display = isValid && clamped > 0 ? "" : "none";
      }
      const axisLabel = axisLabels[index];
      if (axisLabel) {
        axisLabel.value.textContent =
          isValid && clamped > 0 ? String(clamped) : "—";
      }
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    if (hasValue) {
      shape.setAttribute("points", coordinates.join(" "));
      shape.style.display = "";
    } else {
      shape.setAttribute("points", "");
      shape.style.display = "none";
      points.forEach((point) => {
        if (point) {
          point.setAttribute("cx", "0");
          point.setAttribute("cy", "0");
          point.style.display = "none";
        }
      });
      axisLabels.forEach((axis) => {
        axis.value.textContent = "—";
      });
    }
    svg.classList.toggle("is-empty", !hasValue);
  };

  return { element: svg, update };
};

const buildEvaluationCard = ({ deckId, deckName, stats, deck }) => {
  if (!deckId) {
    return null;
  }

  const bracketInfo = extractDeckBracket(deck);
  const gameChangerCount =
    typeof stats?.gameChangerCount === "number" ? Math.max(0, stats.gameChangerCount) : null;
  const gameChangerCards = Array.isArray(stats?.gameChangerCards) ? stats.gameChangerCards : [];

  const card = document.createElement("article");
  card.className = "deck-stats-card deck-stats-card-evaluation";

  const header = document.createElement("header");
  header.className = "deck-personal-card-header";

  const title = document.createElement("h3");
  title.className = "deck-stats-card-title";
  title.textContent = "Profil stratégique";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "deck-personal-edit";
  editBtn.textContent = "Modifier";

  header.append(title, editBtn);
  card.appendChild(header);

  const summaryLayout = document.createElement("div");
  summaryLayout.className = "deck-rating-summary-layout deck-rating-summary-layout-profile";
  card.appendChild(summaryLayout);

  const radarContainer = document.createElement("div");
  radarContainer.className = "deck-radar-container deck-radar-container-inline";
  summaryLayout.appendChild(radarContainer);

  const radar = createRadarChartComponent(DECK_RATING_CATEGORIES);
  if (radar) {
    radarContainer.appendChild(radar.element);
  }

  const radarEmptyHint = document.createElement("p");
  radarEmptyHint.className = "deck-rating-footnote deck-rating-empty-hint";
  radarEmptyHint.textContent = "Aucune évaluation définie pour le moment.";
  radarEmptyHint.hidden = true;
  summaryLayout.appendChild(radarEmptyHint);

  const infoSection = document.createElement("div");
  infoSection.className = "deck-personal-info deck-personal-info-grid";
  card.appendChild(infoSection);

  const metaList = document.createElement("dl");
  metaList.className = "deck-personal-meta";
  infoSection.appendChild(metaList);

  const tagsSection = document.createElement("div");
  tagsSection.className = "deck-personal-tags-section";
  infoSection.appendChild(tagsSection);

  const tagsTitle = document.createElement("span");
  tagsTitle.className = "deck-personal-tags-title";
  tagsTitle.textContent = "Tags personnels";
  tagsSection.appendChild(tagsTitle);

  const tagsList = document.createElement("div");
  tagsList.className = "deck-personal-tags";
  tagsSection.appendChild(tagsList);

  const notesDisplay = document.createElement("p");
  notesDisplay.className = "deck-personal-notes-display";
  notesDisplay.hidden = true;
  infoSection.appendChild(notesDisplay);

  if (gameChangerCards.length > 0) {
    const badges = document.createElement("div");
    badges.className = "deck-game-changer-badges";
    const limit = 6;
    gameChangerCards.slice(0, limit).forEach((name) => {
      const badge = document.createElement("span");
      badge.className = "deck-game-changer-badge";
      badge.textContent = name;
      badges.appendChild(badge);
    });
    if (gameChangerCards.length > limit) {
      const remainder = document.createElement("span");
      remainder.className = "deck-game-changer-badge deck-game-changer-badge-more";
      remainder.textContent = `+${gameChangerCards.length - limit}`;
      badges.appendChild(remainder);
    }
    card.appendChild(badges);
  }

  let currentPersonalization = cloneDeckPersonalization(
    getDeckPersonalization(deckId) ?? createEmptyDeckPersonalization()
  );

  const renderRatings = () => {
    const values = DECK_RATING_CATEGORIES.map((category) =>
      resolveDeckRatingValue(currentPersonalization, category.key)
    );
    const hasRatings = values.some((value) => Number.isFinite(value) && value > 0);
    if (radar) {
      radar.update(values);
    }
    if (radarEmptyHint) {
      radarEmptyHint.hidden = hasRatings;
    }
    radarContainer.classList.toggle("is-empty", !hasRatings);
  };

  const renderMeta = () => {
    metaList.innerHTML = "";

    const metaItems = [];

    if (currentPersonalization.bracket) {
      const definition = findDeckBracketDefinition(currentPersonalization.bracket);
      metaItems.push({
        label: "Bracket (perso)",
        value: definition ? definition.label : `Tier ${currentPersonalization.bracket}`,
      });
    }

    if (currentPersonalization.playstyle) {
      metaItems.push({
        label: "Type de jeu",
        value: currentPersonalization.playstyle,
      });
    }

    if (bracketInfo.bracket) {
      metaItems.push({
        label: "Bracket (Moxfield)",
        value: bracketInfo.bracket,
      });
    }

    if (gameChangerCount !== null && gameChangerCount > 0) {
      metaItems.push({
        label: "Game changers",
        value: NUMBER_FORMAT.format(gameChangerCount),
      });
    }

    if (typeof currentPersonalization.updatedAt === "number" && Number.isFinite(currentPersonalization.updatedAt)) {
      const updatedDate = new Date(currentPersonalization.updatedAt);
      if (!Number.isNaN(updatedDate.getTime())) {
        const formatter = new Intl.DateTimeFormat("fr-FR", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
        metaItems.push({
          label: "Mis à jour",
          value: formatter.format(updatedDate),
        });
      }
    }

    metaItems.forEach((item) => {
      const wrapper = document.createElement("div");
      wrapper.className = "deck-personal-meta-item";
      const dt = document.createElement("dt");
      dt.className = "deck-personal-meta-label";
      dt.textContent = item.label;
      const dd = document.createElement("dd");
      dd.className = "deck-personal-meta-value";
      dd.textContent = item.value;
      wrapper.append(dt, dd);
      metaList.appendChild(wrapper);
    });
  };

  const renderTags = () => {
    tagsList.innerHTML = "";
    const assignedTags = Array.isArray(currentPersonalization.tags)
      ? currentPersonalization.tags
      : [];
    const personalTag =
      typeof currentPersonalization.personalTag === "string"
        ? currentPersonalization.personalTag.trim()
        : "";

    if (assignedTags.length === 0 && !personalTag) {
      const empty = document.createElement("span");
      empty.className = "deck-personal-tag deck-personal-tag-empty";
      empty.textContent = "Aucun tag sélectionné.";
      tagsList.appendChild(empty);
      return;
    }

    assignedTags.forEach((tag) => {
      const badge = document.createElement("span");
      badge.className = "deck-personal-tag";
      badge.textContent = tag;
      tagsList.appendChild(badge);
    });

    if (personalTag) {
      const badge = document.createElement("span");
      badge.className = "deck-personal-tag deck-personal-tag-custom";
      badge.textContent = personalTag;
      tagsList.appendChild(badge);
    }
  };

  const renderNotes = () => {
    const notes =
      typeof currentPersonalization.notes === "string"
        ? currentPersonalization.notes.trim()
        : "";
    if (notes) {
      notesDisplay.innerHTML = "";
      const label = document.createElement("span");
      label.className = "deck-personal-notes-label";
      label.textContent = "Notes";
      notesDisplay.append(label, document.createTextNode(` : ${notes}`));
      notesDisplay.hidden = false;
    } else {
      notesDisplay.textContent = "";
      notesDisplay.hidden = true;
    }
  };

  const applyPersonalization = (next) => {
    currentPersonalization = cloneDeckPersonalization(next);
    renderRatings();
    renderMeta();
    renderTags();
    renderNotes();
  };

  applyPersonalization(currentPersonalization);

  if (typeof ensureDeckPersonalizationsSynced === "function") {
    const maybeSync = ensureDeckPersonalizationsSynced();
    if (maybeSync && typeof maybeSync.then === "function") {
      maybeSync
        .then(() => {
          const refreshed = getDeckPersonalization(deckId);
          if (!refreshed) {
            return;
          }
          if (
            typeof refreshed.updatedAt === "number" &&
            typeof currentPersonalization.updatedAt === "number" &&
            refreshed.updatedAt === currentPersonalization.updatedAt
          ) {
            return;
          }
          currentPersonalization = cloneDeckPersonalization(refreshed);
          applyPersonalization(currentPersonalization);
        })
        .catch(() => {});
    }
  }

  editBtn.addEventListener("click", () => {
    openDeckPersonalizationModal({
      deckId,
      deckName,
      basePersonalization: currentPersonalization,
      onSubmit: (persisted) => {
        applyPersonalization(persisted);
      },
    });
  });

  return card;
};

const updateDeckSummary = (summary) => {
  if (!deckSummaryEl) {
    return;
  }

  deckSummaryEl.classList.add("is-hidden");
  deckSummaryEl.innerHTML = "";

  if (!summary || !summary.deckId) {
    return;
  }

  const evaluationCard = buildEvaluationCard({
    deckId: summary.deckId ?? null,
    deckName: summary.deckName ?? null,
    stats: summary.stats ?? null,
    deck: summary.deck ?? null,
  });
  if (evaluationCard) {
    deckSummaryEl.appendChild(evaluationCard);
    deckSummaryEl.classList.remove("is-hidden");
  }
};

const updateDeckInsights = (details) => {
  if (!deckInsightsEl) {
    return;
  }

  deckInsightsEl.classList.add("is-hidden");
  deckInsightsEl.innerHTML = "";

  const stats = details?.stats ?? null;
  if (!stats) {
    return;
  }

  const insightCards = [buildManaCurveCard(stats), buildColorDistributionCard(stats), buildImpactCard(stats)].filter(
    Boolean
  );

  if (insightCards.length === 0) {
    return;
  }

  const grid = document.createElement("div");
  grid.className = "deck-stats-grid deck-insights-grid";
  insightCards.forEach((card) => grid.appendChild(card));

  deckInsightsEl.appendChild(grid);
  deckInsightsEl.classList.remove("is-hidden");
};

const renderCommanderHighlight = (entries, deck, { deckId, handle } = {}) => {
  if (!deckCommanderEl) {
    return;
  }

  deckCommanderEl.innerHTML = "";
  deckCommanderEl.classList.add("is-hidden");

  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }

  const container = document.createElement("div");
  container.className = "commander-preview";

  const title = document.createElement("p");
  title.className = "commander-preview-title";
  title.textContent = entries.length > 1 ? "Commandants" : "Commandant";
  container.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "commander-preview-grid";

  entries.forEach(({ cardEntry, board }) => {
    if (!cardEntry) {
      return;
    }

    const cardData = cardEntry?.card ?? {};
    const primaryId = getPrimaryCardIdentifier(cardData);
    const quantity =
      typeof cardEntry?.quantity === "number" && Number.isFinite(cardEntry.quantity)
        ? cardEntry.quantity
        : 1;

    const card = document.createElement("article");
    card.className = "commander-preview-card";

    const link = document.createElement("a");
    link.className = "commander-preview-link";

    if (deckId && primaryId) {
      link.href = `card.html?deck=${encodeURIComponent(deckId)}&card=${encodeURIComponent(primaryId)}`;
      link.addEventListener("click", () => {
        try {
          const snapshot = createCardSnapshot(deck, board, cardEntry, { handle });
          if (snapshot) {
            window.sessionStorage.setItem(LAST_CARD_STORAGE_KEY, JSON.stringify(snapshot));
          }
        } catch (error) {
          console.warn("Impossible d'enregistrer la sélection de la carte :", error);
        }
      });
    } else {
      link.href = "#";
    }

    const visual = document.createElement("div");
    visual.className = "commander-preview-visual";
    const baseId =
      cardData.id || cardData.card_id || cardData.uniqueCardId || cardData.scryfall_id;
    if (baseId) {
      const image = document.createElement("img");
      image.src = `https://assets.moxfield.net/cards/card-${baseId}-normal.webp`;
      image.alt = cardData?.name
        ? `Illustration de ${cardData.name}`
        : "Illustration du commandant";
      visual.appendChild(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "commander-preview-placeholder";
      placeholder.textContent = cardData?.name ?? "Commandant";
      visual.appendChild(placeholder);
    }

    const info = document.createElement("div");
    info.className = "commander-preview-info";

    const name = document.createElement("h3");
    name.className = "commander-preview-name";
    name.textContent = cardData?.name ?? "Commandant inconnu";

    const typeLine = document.createElement("p");
    typeLine.className = "commander-preview-type";
    typeLine.textContent = cardData?.type_line ?? "—";

    const stats = document.createElement("p");
    stats.className = "commander-preview-stats";
    const manaGroup = document.createElement("span");
    manaGroup.className = "commander-preview-mana mana-cost";
    renderManaCost(manaGroup, cardData?.mana_cost);
    stats.appendChild(manaGroup);

    const quantityTag = document.createElement("span");
    quantityTag.className = "commander-preview-tag";
    quantityTag.textContent = `x${quantity}`;
    stats.appendChild(quantityTag);

    const identity = Array.isArray(cardData?.color_identity) ? cardData.color_identity : [];
    if (identity.length > 0) {
      const identityGroup = document.createElement("span");
      identityGroup.className = "commander-preview-identity mana-cost";
      identity.forEach((color) => {
        identityGroup.appendChild(createManaSymbolElement(color));
      });
      stats.appendChild(identityGroup);
    }

    info.appendChild(name);
    info.appendChild(typeLine);
    info.appendChild(stats);

    link.appendChild(visual);
    link.appendChild(info);
    card.appendChild(link);
    grid.appendChild(card);
  });

  container.appendChild(grid);
  deckCommanderEl.appendChild(container);
  deckCommanderEl.classList.remove("is-hidden");
};

const getPrimaryCardIdentifier = (cardData) => {
  if (!cardData || typeof cardData !== "object") {
    return null;
  }

  const candidates = [
    cardData.id,
    cardData.card_id,
    cardData.uniqueCardId,
    cardData.unique_card_id,
    cardData.scryfall_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" || typeof candidate === "number") {
      const value = String(candidate).trim();
      if (value.length > 0) {
        return value;
      }
    }
  }

  return null;
};

const sanitizeCardData = (cardData) => {
  if (!cardData || typeof cardData !== "object") {
    return {};
  }

  const safeFaces = Array.isArray(cardData.faces)
    ? cardData.faces.map((face) => ({
        name: face?.name ?? null,
        oracle_text: face?.oracle_text ?? null,
      }))
    : undefined;

  const safeCard = {
    id: cardData.id ?? null,
    card_id: cardData.card_id ?? null,
    uniqueCardId: cardData.uniqueCardId ?? null,
    unique_card_id: cardData.unique_card_id ?? null,
    scryfall_id: cardData.scryfall_id ?? null,
    name: cardData.name ?? null,
    mana_cost: cardData.mana_cost ?? null,
    type_line: cardData.type_line ?? null,
    oracle_text: cardData.oracle_text ?? null,
    cmc:
      typeof cardData.cmc === "number" && Number.isFinite(cardData.cmc)
        ? cardData.cmc
        : typeof cardData.mana_value === "number" && Number.isFinite(cardData.mana_value)
        ? cardData.mana_value
        : null,
    mana_value:
      typeof cardData.mana_value === "number" && Number.isFinite(cardData.mana_value)
        ? cardData.mana_value
        : null,
    power: cardData.power ?? null,
    toughness: cardData.toughness ?? null,
    loyalty: cardData.loyalty ?? null,
    color_identity: Array.isArray(cardData.color_identity)
      ? [...cardData.color_identity]
      : null,
    set_name: cardData.set_name ?? null,
    set: cardData.set ?? null,
    cn: cardData.cn ?? null,
  };

  if (safeFaces) {
    safeCard.faces = safeFaces;
  }

  if (cardData.prices && typeof cardData.prices === "object") {
    safeCard.prices = {
      usd: cardData.prices.usd ?? null,
      eur: cardData.prices.eur ?? null,
    };
  }

  return safeCard;
};

const createCardSnapshot = (deck, board, cardEntry, { handle } = {}) => {
  if (!deck || !cardEntry || typeof cardEntry !== "object") {
    return null;
  }

  const deckId = getDeckIdentifier(deck);
  const cardData = cardEntry.card ?? null;
  const cardId = getPrimaryCardIdentifier(cardData);

  if (!deckId || !cardId) {
    return null;
  }

  const normalizedHandle =
    typeof handle === "string" && handle.trim().length > 0 ? handle.trim() : null;

  return {
    version: 1,
    storedAt: Date.now(),
    deckId,
    cardId,
    handle: normalizedHandle,
    deck: {
      publicId: deckId,
      name: deck?.name ?? null,
      format: deck?.format ?? null,
    },
    board: board
      ? {
          name: board?.name ?? null,
        }
      : null,
    entry: {
      quantity:
        typeof cardEntry.quantity === "number" && Number.isFinite(cardEntry.quantity)
          ? cardEntry.quantity
          : 1,
      card: sanitizeCardData(cardData),
    },
  };
};

const sanitizeDeckBoardsForSnapshot = (deck) => {
  const rawBoards = Array.isArray(deck?.raw?.boards) ? deck.raw.boards : [];
  return rawBoards
    .map((board) => {
      const entries = Array.isArray(board?.cards) ? board.cards : [];
      const cards = entries
        .map((entry) => {
          if (!entry || typeof entry !== "object" || !entry.card) {
            return null;
          }
          const quantity =
            typeof entry.quantity === "number" && Number.isFinite(entry.quantity)
              ? entry.quantity
              : 0;
          const sanitizedCard = sanitizeCardData(entry.card);
          const primaryId = getPrimaryCardIdentifier(sanitizedCard);
          if (!primaryId) {
            return null;
          }
          return {
            quantity,
            card: sanitizedCard,
          };
        })
        .filter(Boolean);

      if (cards.length === 0) {
        return null;
      }

      const normalizedCount =
        typeof board?.count === "number" && Number.isFinite(board.count)
          ? board.count
          : cards.reduce((sum, entry) => sum + (entry.quantity || 0), 0);

      return {
        name: board?.name ?? "",
        identifier: board?.identifier ?? null,
        count: normalizedCount,
        cards,
      };
    })
    .filter(Boolean);
};

const createDeckSnapshot = (deck, { handle } = {}) => {
  if (!deck || !deckHasCardDetails(deck)) {
    return null;
  }

  const deckId = getDeckIdentifier(deck);
  if (!deckId) {
    return null;
  }

  const boards = sanitizeDeckBoardsForSnapshot(deck);
  if (boards.length === 0) {
    return null;
  }

  const normalizedHandle =
    typeof handle === "string" && handle.trim().length > 0 ? handle.trim() : null;

  const sanitizedDeck = {
    id: deck.id ?? deck.slug ?? deck.publicId ?? deck.public_id ?? deckId,
    slug: deck.slug ?? null,
    name: deck.name ?? null,
    format: deck.format ?? null,
    updatedAt: deck.updatedAt ?? null,
    cardCount: deck.cardCount ?? null,
    url: deck.url ?? null,
    publicId: deck.publicId ?? deck.public_id ?? null,
    syncedAt: deck.syncedAt ?? deck.raw?.synced_at ?? deck.raw?.syncedAt ?? null,
    raw: {
      description: deck?.raw?.description ?? null,
      summary: deck?.raw?.summary ?? null,
      synced_at: deck?.raw?.synced_at ?? deck?.raw?.syncedAt ?? deck?.syncedAt ?? null,
      syncedAt: deck?.raw?.syncedAt ?? deck?.raw?.synced_at ?? deck?.syncedAt ?? null,
      boards: boards.map((board) => ({
        name: board.name,
        identifier: board.identifier,
        count: board.count,
        cards: board.cards.map((entry) => ({
          quantity: entry.quantity,
          card: entry.card,
        })),
      })),
    },
  };

  return {
    version: 1,
    storedAt: Date.now(),
    deckId,
    handle: normalizedHandle,
    deck: sanitizedDeck,
  };
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

const renderManaCost = (element, manaCost, { fallbackText = "—" } = {}) => {
  if (!element) {
    return;
  }
  const symbols = extractManaSymbols(manaCost);
  element.innerHTML = "";
  element.classList.add("mana-cost");

  if (!Array.isArray(symbols) || symbols.length === 0) {
    if (typeof fallbackText === "string") {
      element.textContent = fallbackText;
    }
    element.removeAttribute("aria-label");
    return;
  }

  const breakdown = formatManaBreakdownText(manaCost);
  if (breakdown && breakdown !== "—") {
    element.setAttribute("aria-label", breakdown);
  } else {
    element.removeAttribute("aria-label");
  }

  const fragment = document.createDocumentFragment();
  symbols.forEach((symbol) => {
    fragment.appendChild(createManaSymbolElement(symbol));
  });
  element.appendChild(fragment);
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

      const matched = payload.decks.find((candidate) => deckMatchesIdentifier(candidate, deckId));

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
    createCardSnapshot,
    sanitizeCardData,
    getPrimaryCardIdentifier,
    createDeckSnapshot,
    collectDeckBoards,
    collectDeckIdentifierCandidates,
    deckMatchesIdentifier,
    resolveDeckColorIdentity,
    doesDeckMatchSearch,
    setDeckCollectionSearchQuery,
    setDeckCollectionDisplayMode,
    getDeckCollectionState,
    normalizeText,
  };
}

window.addEventListener("google-loaded", initializeGoogleAuth);
