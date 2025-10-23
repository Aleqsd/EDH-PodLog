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

const DECK_RATING_CATEGORIES = [
  { key: "consistency", label: "Consitance" },
  { key: "acceleration", label: "Accélération" },
  { key: "interaction", label: "Interraction" },
  { key: "resilience", label: "Résilience" },
  { key: "finition", label: "Finition" },
];

const COLOR_DISTRIBUTION_META = {
  W: { label: "Blanc", token: "--color-mana-white" },
  U: { label: "Bleu", token: "--color-mana-blue" },
  B: { label: "Noir", token: "--color-mana-black" },
  R: { label: "Rouge", token: "--color-mana-red" },
  G: { label: "Vert", token: "--color-mana-green" },
  C: { label: "Incolore", token: "--color-mana-colorless" },
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
  const buckets = bucketOrder.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
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

  const gameChangerLookup = buildGameChangerLookup(deck);
  let gameChangerCount = 0;

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

    if (!land && manaValue !== null) {
      const bucketKey = manaValue >= 8 ? "8+" : String(Math.max(0, Math.floor(manaValue)));
      buckets[bucketKey] = (buckets[bucketKey] ?? 0) + quantity;
      manaValueSum += manaValue * quantity;
      nonLandCount += quantity;
    }

    const cardName = typeof cardData?.name === "string" ? cardData.name.toLowerCase() : null;
    if (cardName && gameChangerLookup.has(cardName)) {
      gameChangerCount += quantity;
    }

    const identity = Array.isArray(cardData?.color_identity) ? cardData.color_identity : [];
    if (identity.length === 0) {
      colorWeights.C += quantity;
      colorWeightTotal += quantity;
    } else {
      const share = quantity / identity.length;
      identity.forEach((color) => {
        const code = String(color || "").toUpperCase();
        if (!code) {
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(colorWeights, code)) {
          colorWeights[code] = 0;
        }
        colorWeights[code] += share;
      });
      colorWeightTotal += quantity;
    }
  });

  const manaCurve = bucketOrder.map((label) => ({
    label,
    value: Math.round(buckets[label] ?? 0),
  }));
  const manaCurveMax = manaCurve.reduce((max, bucket) => Math.max(max, bucket.value), 0);
  const averageManaValue =
    nonLandCount > 0 ? Number((manaValueSum / nonLandCount).toFixed(2)) : null;

  const colorOrder = ["W", "U", "B", "R", "G", "C"];
  const colorDistribution = colorOrder
    .map((color) => {
      const value = colorWeights[color] ?? 0;
      const meta = COLOR_DISTRIBUTION_META[color] ?? { label: color, token: "--color-white" };
      const ratio = colorWeightTotal > 0 ? value / colorWeightTotal : 0;
      return {
        color,
        label: meta.label,
        token: meta.token,
        value,
        ratio,
      };
    })
    .filter((entry) => entry.value > 0 || colorWeightTotal === 0);

  return {
    manaCurve,
    manaCurveMax,
    averageManaValue,
    colorDistribution,
    colorWeightTotal,
    gameChangerCount,
    nonLandCount,
  };
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
  subtitle.textContent = "Répartition des sorts par coût converti (hors terrains).";
  card.appendChild(subtitle);

  const chart = document.createElement("div");
  chart.className = "deck-mana-chart";
  const maxValue = Math.max(stats.manaCurveMax ?? 0, 1);
  chart.style.setProperty("--deck-mana-max", String(maxValue));
  chart.setAttribute("role", "list");
  chart.setAttribute("aria-label", "Répartition des sorts par coût converti");

  stats.manaCurve.forEach((bucket) => {
    const bar = document.createElement("div");
    bar.className = "deck-mana-bar";
    const value = Math.max(0, bucket?.value ?? 0);
    bar.style.setProperty("--deck-mana-value", String(value));
    bar.setAttribute("role", "listitem");
    bar.dataset.cost = bucket?.label ?? "";
    bar.setAttribute(
      "aria-label",
      `Coût ${bucket?.label ?? "?"}, ${NUMBER_FORMAT.format(value)} carte${
        value > 1 ? "s" : ""
      }`
    );

    const barFill = document.createElement("div");
    barFill.className = "deck-mana-bar-fill";
    bar.appendChild(barFill);

    const count = document.createElement("span");
    count.className = "deck-mana-bar-count";
    count.textContent = NUMBER_FORMAT.format(value);
    barFill.appendChild(count);

    const label = document.createElement("span");
    label.className = "deck-mana-bar-label";
    label.textContent = bucket?.label ?? "—";
    bar.appendChild(label);

    chart.appendChild(bar);
  });

  card.appendChild(chart);

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
  title.textContent = "Identités de couleur";
  card.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "deck-stats-card-subtitle";
  subtitle.textContent = "Part de chaque couleur dans le paquet principal.";
  card.appendChild(subtitle);

  const chart = document.createElement("div");
  chart.className = "deck-color-chart";
  chart.setAttribute("aria-hidden", "true");

  let start = 0;
  const segments = [];
  stats.colorDistribution.forEach((entry, index) => {
    const ratio = Math.max(0, entry?.ratio ?? 0);
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
  legend.setAttribute("aria-label", "Répartition des identités de couleur");
  stats.colorDistribution.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "deck-color-legend-item";
    item.setAttribute("role", "listitem");

    const swatch = document.createElement("span");
    swatch.className = "deck-color-legend-swatch";
    swatch.style.setProperty("--deck-color-swatch", `var(${entry?.token ?? "--color-white"})`);

    const label = document.createElement("span");
    label.className = "deck-color-legend-label";
    const percentage =
      stats.colorWeightTotal > 0
        ? Math.round((Math.max(0, entry?.ratio ?? 0) * 1000)) / 10
        : 0;
    label.textContent = `${entry?.label ?? "?"} · ${percentage.toLocaleString("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    })}%`;

    item.appendChild(swatch);
    item.appendChild(label);
    legend.appendChild(item);
  });

  card.appendChild(legend);

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
  title.textContent = "Résumé rapide";
  card.appendChild(title);

  const grid = document.createElement("dl");
  grid.className = "deck-impact-grid";

  const impactItems = [
    {
      label: "Coût moyen (hors terrains)",
      value:
        typeof stats.averageManaValue === "number"
          ? formatAverageManaValue(stats.averageManaValue)
          : "—",
    },
    {
      label: "Game changer",
      value: NUMBER_FORMAT.format(Math.max(0, stats.gameChangerCount ?? 0)),
      footnote: 'Nombre de cartes taggées "Game changer" sur Moxfield.',
    },
    {
      label: "Sorts non terrains",
      value: NUMBER_FORMAT.format(Math.max(0, stats.nonLandCount ?? 0)),
    },
  ];

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

  categories.forEach((_, index) => {
    const angle = (Math.PI * 2 * index) / categories.length - Math.PI / 2;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("deck-radar-axis");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", "0");
    line.setAttribute("x2", (Math.cos(angle) * radius).toFixed(2));
    line.setAttribute("y2", (Math.sin(angle) * radius).toFixed(2));
    group.appendChild(line);
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
    if (!Array.isArray(values) || values.length !== categories.length) {
      return;
    }
    const coordinates = values.map((rawValue, index) => {
      const numeric = Number(rawValue);
      const clamped = Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), maxValue) : 0;
      const angle = (Math.PI * 2 * index) / categories.length - Math.PI / 2;
      const distance = (clamped / maxValue) * radius;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      points[index].setAttribute("cx", x.toFixed(2));
      points[index].setAttribute("cy", y.toFixed(2));
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    shape.setAttribute("points", coordinates.join(" "));
  };

  return { element: svg, update };
};

const buildEvaluationCard = ({ deckId, deckName }) => {
  if (!deckId) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "deck-stats-card deck-stats-card-evaluation";

  const title = document.createElement("h3");
  title.className = "deck-stats-card-title";
  title.textContent = "Évaluez le plan de jeu";
  card.appendChild(title);

  if (deckName) {
    const subtitle = document.createElement("p");
    subtitle.className = "deck-stats-card-subtitle";
    subtitle.textContent = `Attribuez une note (1 à 5) au deck « ${deckName} ».`;
    card.appendChild(subtitle);
  } else {
    const subtitle = document.createElement("p");
    subtitle.className = "deck-stats-card-subtitle";
    subtitle.textContent = "Attribuez une note (1 à 5) à ce deck.";
    card.appendChild(subtitle);
  }

  const stored = getDeckEvaluation(deckId) ?? {};
  const ratings = {};
  const defaultValue = 3;
  const initialValues = DECK_RATING_CATEGORIES.map((category) => {
    const raw = stored?.[category.key];
    const numeric = Number(raw);
    const base = Number.isFinite(numeric) ? Math.min(Math.max(Math.round(numeric), 1), 5) : defaultValue;
    ratings[category.key] = base;
    return base;
  });

  const radar = createRadarChartComponent(DECK_RATING_CATEGORIES);
  if (radar) {
    radar.update(initialValues);
  }

  const layout = document.createElement("div");
  layout.className = "deck-rating-layout";

  const fields = document.createElement("div");
  fields.className = "deck-rating-grid";
  layout.appendChild(fields);

  if (radar) {
    const radarContainer = document.createElement("div");
    radarContainer.className = "deck-radar-container";
    radarContainer.appendChild(radar.element);
    layout.appendChild(radarContainer);
  }

  DECK_RATING_CATEGORIES.forEach((category) => {
    const field = document.createElement("label");
    field.className = "deck-rating-field";

    const label = document.createElement("span");
    label.className = "deck-rating-label";
    label.textContent = category.label;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "1";
    slider.max = "5";
    slider.step = "1";
    slider.value = String(ratings[category.key]);
    slider.className = "deck-rating-slider";
    slider.dataset.ratingKey = category.key;
    slider.setAttribute("aria-label", `${category.label} (note de 1 à 5)`);

    const value = document.createElement("span");
    value.className = "deck-rating-value";
    value.textContent = String(ratings[category.key]);

    field.appendChild(label);
    field.appendChild(slider);
    field.appendChild(value);
    fields.appendChild(field);

    slider.addEventListener("input", () => {
      const numeric = Number(slider.value);
      const clamped = Number.isFinite(numeric) ? Math.min(Math.max(Math.round(numeric), 1), 5) : defaultValue;
      ratings[category.key] = clamped;
      value.textContent = String(clamped);
      if (radar) {
        const nextValues = DECK_RATING_CATEGORIES.map((cat) => ratings[cat.key]);
        radar.update(nextValues);
      }
    });

    slider.addEventListener("change", () => {
      try {
        const persisted = setDeckEvaluation(deckId, ratings) ?? ratings;
        Object.assign(ratings, persisted);
        slider.value = String(ratings[category.key]);
        value.textContent = String(ratings[category.key]);
      } catch (error) {
        console.warn("Impossible d'enregistrer l'évaluation du deck :", error);
      }
      if (radar) {
        const nextValues = DECK_RATING_CATEGORIES.map((cat) => ratings[cat.key]);
        radar.update(nextValues);
      }
    });
  });

  card.appendChild(layout);

  const note = document.createElement("p");
  note.className = "deck-rating-footnote";
  note.textContent = "Les évaluations sont stockées localement dans votre navigateur.";
  card.appendChild(note);

  return card;
};

const updateDeckSummary = (summary) => {
  if (!deckSummaryEl) {
    return;
  }

  const hasBoards = summary && Array.isArray(summary.boards) && summary.boards.length > 0;
  const shouldHide = !hasBoards;
  deckSummaryEl.classList.toggle("is-hidden", shouldHide);
  deckSummaryEl.innerHTML = "";

  if (shouldHide) {
    return;
  }

  const statsGrid = document.createElement("dl");
  statsGrid.className = "deck-summary-grid";

  const statItems = [
    {
      label: "Cartes totales",
      value: summary.totalCards,
    },
    {
      label: "Cartes uniques",
      value: summary.uniqueCards,
    },
    {
      label: "Sections",
      value: summary.boards.length,
    },
  ];

  statItems.forEach((stat) => {
    const group = document.createElement("div");
    group.className = "deck-summary-item";

    const term = document.createElement("dt");
    term.className = "deck-summary-label";
    term.textContent = stat.label;

    const value = document.createElement("dd");
    value.className = "deck-summary-value";
    value.textContent =
      typeof stat.value === "number" && Number.isFinite(stat.value)
        ? NUMBER_FORMAT.format(stat.value)
        : "—";

    group.appendChild(term);
    group.appendChild(value);
    statsGrid.appendChild(group);
  });

  deckSummaryEl.appendChild(statsGrid);

  const boardList = document.createElement("ul");
  boardList.className = "deck-summary-board-list";

  summary.boards.forEach((board) => {
    const item = document.createElement("li");
    item.className = "deck-summary-board-item";
    const name = document.createElement("span");
    name.className = "deck-summary-board-name";
    name.textContent = board.label;
    const count = document.createElement("span");
    count.className = "deck-summary-board-count";
    count.textContent =
      typeof board.count === "number" && Number.isFinite(board.count)
        ? NUMBER_FORMAT.format(board.count)
        : "—";
    item.appendChild(name);
    item.appendChild(count);
    boardList.appendChild(item);
  });

  deckSummaryEl.appendChild(boardList);

  const insights = document.createElement("div");
  insights.className = "deck-stats-grid";
  const statCards = [
    buildManaCurveCard(summary.stats),
    buildColorDistributionCard(summary.stats),
    buildImpactCard(summary.stats),
  ].filter(Boolean);
  statCards.forEach((card) => insights.appendChild(card));
  if (insights.childElementCount > 0) {
    deckSummaryEl.appendChild(insights);
  }

  const evaluationCard = buildEvaluationCard({
    deckId: summary.deckId ?? null,
    deckName: summary.deckName ?? null,
  });
  if (evaluationCard) {
    deckSummaryEl.appendChild(evaluationCard);
  }
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
    const manaText = formatManaCostText(cardData?.mana_cost) || "—";
    const colors = Array.isArray(cardData?.color_identity) ? cardData.color_identity.join("") : "";
    const statsParts = [manaText, `x${quantity}`];
    if (colors) {
      statsParts.push(colors);
    }
    stats.textContent = statsParts.join(" • ");

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
    createCardSnapshot,
    sanitizeCardData,
    getPrimaryCardIdentifier,
    createDeckSnapshot,
  };
}

window.addEventListener("google-loaded", initializeGoogleAuth);
