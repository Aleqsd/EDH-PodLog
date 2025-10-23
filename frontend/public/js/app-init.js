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
  deckSummaryEl = document.getElementById("deckSummary");
  deckCommanderEl = document.getElementById("deckCommanderHighlight");

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
    if (message) {
      updateDeckSummary(null);
      renderCommanderHighlight([], null);
    }
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
    updateDeckSummary(null);
    renderCommanderHighlight([], deck);
    return;
  }

  const deckId = getDeckIdentifier(deck);
  const uniqueCardIdentifiers = new Set();
  let totalCardQuantity = 0;
  const boardSummaries = [];
  let hasRenderedBoard = false;
  let hasCommanderContent = false;
  const commanderEntries = [];

  boards.forEach((board) => {
    const cards = Array.isArray(board?.cards) ? [...board.cards] : [];
    if (cards.length === 0) {
      return;
    }

    const boardName = typeof board?.name === "string" ? board.name.toLowerCase() : "";
    const isCommanderBoard = boardName.includes("commander");

    cards.sort((a, b) => {
      const nameA = a?.card?.name ?? "";
      const nameB = b?.card?.name ?? "";
      return nameA.localeCompare(nameB, "fr", { sensitivity: "base" });
    });

    let boardQuantity = 0;
    cards.forEach((cardEntry) => {
      const quantity =
        typeof cardEntry?.quantity === "number" && Number.isFinite(cardEntry.quantity)
          ? cardEntry.quantity
          : 0;
      boardQuantity += quantity;

      const cardData = cardEntry?.card ?? {};
      const uniqueKey =
        getPrimaryCardIdentifier(cardData) ||
        cardData?.oracle_id ||
        cardData?.oracleId ||
        cardData?.name ||
        null;
      if (uniqueKey) {
        uniqueCardIdentifiers.add(String(uniqueKey));
      }
    });

    const normalizedBoardCount =
      boardQuantity > 0
        ? boardQuantity
        : typeof board?.count === "number" && Number.isFinite(board.count) && board.count > 0
        ? board.count
        : cards.length;

    const boardLabel = humanizeBoardName(board?.name);
    boardSummaries.push({
      label: boardLabel,
      count: normalizedBoardCount,
    });
    totalCardQuantity += normalizedBoardCount;

    if (isCommanderBoard) {
      cards.forEach((cardEntry) => {
        commanderEntries.push({ cardEntry, board });
      });
      hasCommanderContent = true;
      return;
    }

    const section = document.createElement("section");
    section.className = "deck-board";

    const header = document.createElement("header");
    header.className = "deck-board-header";
    const title = document.createElement("h2");
    title.className = "deck-board-title";
    title.textContent = `${boardLabel} (${normalizedBoardCount})`;
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
        const primaryId = getPrimaryCardIdentifier(cardData);
        if (deckId && primaryId) {
          link.href = `card.html?deck=${encodeURIComponent(
            deckId
          )}&card=${encodeURIComponent(primaryId)}`;
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
    const tableContainer = document.createElement("div");
    tableContainer.className = "card-table-container";
    tableContainer.appendChild(table);
    section.appendChild(tableContainer);
    deckBoardsEl.appendChild(section);
    hasRenderedBoard = true;
  });

  if (!hasRenderedBoard && !hasCommanderContent) {
    const empty = document.createElement("p");
    empty.className = "deck-board-empty";
    empty.textContent =
      "Impossible de trouver la liste des cartes pour ce deck. Relancez une synchronisation.";
    deckBoardsEl.appendChild(empty);
  }

  if (boardSummaries.length === 0) {
    updateDeckSummary(null);
  } else {
    updateDeckSummary({
      totalCards: totalCardQuantity,
      uniqueCards: uniqueCardIdentifiers.size,
      boards: boardSummaries,
    });
  }

  renderCommanderHighlight(commanderEntries, deck, { deckId, handle });
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
    let storedDeck = null;

    try {
      storedDeck = JSON.parse(window.sessionStorage.getItem(LAST_DECK_STORAGE_KEY) || "null");
    } catch (error) {
      console.warn("Impossible de lire la sélection du deck :", error);
      storedDeck = null;
    }

    if (!deckId && storedDeck?.deckId) {
      deckId = storedDeck.deckId;
    }

    if (!handleHint && storedDeck?.handle) {
      handleHint = storedDeck.handle;
    }

    if (!deckId) {
      showDeckError("Identifiant de deck manquant.");
      setDeckLoading(false);
      return;
    }

    let prefilledFromSnapshot = false;
    if (
      storedDeck &&
      storedDeck.deck &&
      storedDeck.deckId === deckId &&
      deckHasCardDetails(storedDeck.deck)
    ) {
      populateDeckDetail(storedDeck.deck, { handle: handleHint });
      setDeckLoading(false);
      prefilledFromSnapshot = true;
    }

    if (!prefilledFromSnapshot) {
      setDeckLoading(true);
    }

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
      if (!prefilledFromSnapshot) {
        showDeckError(
          "Nous n'avons pas pu charger ce deck. Vérifiez qu'il est toujours public sur Moxfield."
        );
      }
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
    let storedCard = null;

    try {
      storedCard = JSON.parse(window.sessionStorage.getItem(LAST_CARD_STORAGE_KEY) || "null");
    } catch (error) {
      console.warn("Impossible de lire la sélection de la carte :", error);
      storedCard = null;
    }

    if (!deckId || !cardId) {
      if (storedCard) {
        deckId = deckId || storedCard.deckId || null;
        cardId = cardId || storedCard.cardId || null;
      }
    }

    if (!handleHint && storedCard?.handle) {
      handleHint = storedCard.handle;
    }

    if (!deckId || !cardId) {
      showCardError("Paramètres incomplets pour afficher cette carte.");
      setCardLoading(false);
      return;
    }

    let prefilledFromSnapshot = false;
    const normalizedRequestedCardId = String(cardId).toLowerCase();
    const normalizedStoredCardId =
      storedCard?.cardId !== undefined && storedCard?.cardId !== null
        ? String(storedCard.cardId).toLowerCase()
        : null;

    if (
      storedCard &&
      storedCard.entry &&
      normalizedStoredCardId &&
      normalizedStoredCardId === normalizedRequestedCardId &&
      (!storedCard.deckId || storedCard.deckId === deckId)
    ) {
      const deckSnapshot = {
        publicId: storedCard.deck?.publicId ?? storedCard.deckId ?? deckId,
        name: storedCard.deck?.name ?? null,
        format: storedCard.deck?.format ?? null,
      };

      const boardSnapshot = storedCard.board
        ? {
            name: storedCard.board?.name ?? null,
          }
        : null;

      const quantity =
        typeof storedCard.entry.quantity === "number" && Number.isFinite(storedCard.entry.quantity)
          ? storedCard.entry.quantity
          : 1;

      const entrySnapshot = {
        quantity,
        card: sanitizeCardData(storedCard.entry.card),
      };

      populateCardDetail(
        deckSnapshot,
        { board: boardSnapshot, entry: entrySnapshot },
        { handle: handleHint }
      );
      setCardLoading(false);
      prefilledFromSnapshot = true;
    }

    if (!prefilledFromSnapshot) {
      setCardLoading(true);
    }

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
      if (!prefilledFromSnapshot) {
        showCardError("Nous n'avons pas pu charger les informations de cette carte.");
      }
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
