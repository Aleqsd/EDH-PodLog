(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  let cardTitleEl = null;
  let cardSubtitleEl = null;
  let cardManaCostEl = null;
  let cardManaBreakdownEl = null;
  let cardOracleEl = null;
  let cardImageEl = null;
  let cardInfoListEl = null;
  let cardErrorEl = null;
  let cardLoadingEl = null;
  let cardBoardEl = null;
  let cardQuantityEl = null;
  let cardBackLinkEl = null;

  const setCardLoading = (isLoading) => {
    if (cardLoadingEl) {
      cardLoadingEl.classList.toggle("is-hidden", !isLoading);
    }
  };

  const showCardError = (message) => {
    if (!cardErrorEl) {
      return;
    }
    cardErrorEl.textContent = message ?? "";
    cardErrorEl.classList.toggle("is-hidden", !message);
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
      cardManaCostEl.classList.add("mana-cost");
      renderManaCost(cardManaCostEl, cardData?.mana_cost);
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
        if (!value && value !== 0) {
          return;
        }
        const li = document.createElement("li");
        const term = document.createElement("strong");
        term.textContent = `${label} :`;
        li.appendChild(term);
        li.appendChild(document.createTextNode(" "));
        if (value instanceof Node) {
          li.appendChild(value);
        } else {
          li.appendChild(document.createTextNode(String(value)));
        }
        cardInfoListEl.appendChild(li);
      };

      addInfoItem("Type", cardData?.type_line ?? null);

      if (cardData?.power || cardData?.toughness) {
        addInfoItem("Caractéristiques", `${cardData?.power ?? "?"}/${cardData?.toughness ?? "?"}`);
      } else if (cardData?.loyalty) {
        addInfoItem("Loyauté", cardData.loyalty);
      }

      const colors = Array.isArray(cardData?.color_identity) ? cardData.color_identity : [];
      if (colors.length > 0) {
        const identityGroup = document.createElement("span");
        identityGroup.className = "mana-cost";
        colors.forEach((color) => {
          identityGroup.appendChild(createManaSymbolElement(color));
        });
        addInfoItem("Identité de couleur", identityGroup);
      } else {
        addInfoItem("Identité de couleur", "Incolore");
      }

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

  const initCardDetailPage = async (context) => {
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
        window.EDH_PODLOG?.session?.setCurrent?.(session);
        context.session = session;
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

  api.registerPageController("card-detail", async (context) => {
    cardTitleEl = document.getElementById("cardTitle");
    cardSubtitleEl = document.getElementById("cardSubtitle");
    cardManaCostEl = document.getElementById("cardManaCost");
    cardManaBreakdownEl = document.getElementById("cardManaBreakdown");
    cardOracleEl = document.getElementById("cardOracle");
    cardImageEl = document.getElementById("cardImage");
    cardInfoListEl = document.getElementById("cardInfoList");
    cardErrorEl = document.getElementById("cardError");
    cardLoadingEl = document.getElementById("cardLoading");
    cardBoardEl = document.getElementById("cardBoard");
    cardQuantityEl = document.getElementById("cardQuantity");
    cardBackLinkEl = document.getElementById("cardBackLink");

    await initCardDetailPage(context);
  });
})();
