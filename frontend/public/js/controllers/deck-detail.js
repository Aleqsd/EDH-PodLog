(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  let deckTitleEl = null;
  let deckMetaEl = null;
  let deckDescriptionEl = null;
  let deckBoardsEl = null;
  let deckErrorEl = null;
  let deckLoadingEl = null;
  let deckHandleBadgeEl = null;

  const setDeckLoading = (isLoading) => {
    if (deckLoadingEl) {
      deckLoadingEl.classList.toggle("is-hidden", !isLoading);
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
      section.appendChild(table);

      deckBoardsEl.appendChild(section);
      hasRenderedBoard = true;
    });

    updateDeckSummary({
      cardCount: totalCardQuantity,
      uniqueCards: uniqueCardIdentifiers.size,
      boards: boardSummaries,
    });

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
                (acc, cardEntry) =>
                  acc + (typeof cardEntry?.quantity === "number" ? cardEntry.quantity : 1),
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

  const initDeckDetailPage = async (context) => {
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
        context.session = session;
      }
      if (!deck || !deckHasCardDetails(deck)) {
        showDeckError(
          "Impossible de récupérer les cartes de ce deck. Lancez une nouvelle synchronisation."
        );
        return;
      }
      populateDeckDetail(deck, { handle: handleHint });
      try {
        window.sessionStorage.setItem(
          LAST_DECK_STORAGE_KEY,
          JSON.stringify({
            deckId: getDeckIdentifier(deck) ?? deckId,
            handle: handleHint ?? null,
            deck: deck,
          })
        );
      } catch (error) {
        // ignore quota issues
      }
    } catch (error) {
      console.error("Unable to load deck detail", error);
      if (!prefilledFromSnapshot) {
        showDeckError("Nous n'avons pas pu charger les informations de ce deck.");
      }
    } finally {
      setDeckLoading(false);
    }
  };

  api.registerPageController("deck-detail", async (context) => {
    deckTitleEl = document.getElementById("deckTitle");
    deckMetaEl = document.getElementById("deckMeta");
    deckDescriptionEl = document.getElementById("deckDescription");
    deckBoardsEl = document.getElementById("deckBoards");
    deckErrorEl = document.getElementById("deckError");
    deckLoadingEl = document.getElementById("deckLoading");
    deckHandleBadgeEl = document.getElementById("deckHandleBadge");
    deckSummaryEl = document.getElementById("deckSummary");
    deckCommanderEl = document.getElementById("deckCommanderHighlight");

    await initDeckDetailPage(context);
  });
})();
