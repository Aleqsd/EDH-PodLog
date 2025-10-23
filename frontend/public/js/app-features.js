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

const updateDeckSummary = (summary) => {
  if (!deckSummaryEl) {
    return;
  }

  const shouldHide = !summary || !Array.isArray(summary.boards) || summary.boards.length === 0;
  deckSummaryEl.classList.toggle("is-hidden", shouldHide);

  if (shouldHide) {
    deckSummaryEl.innerHTML = "";
    return;
  }

  deckSummaryEl.innerHTML = "";

  const stats = document.createElement("dl");
  stats.className = "deck-summary-grid";

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
    stats.appendChild(group);
  });

  deckSummaryEl.appendChild(stats);

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

