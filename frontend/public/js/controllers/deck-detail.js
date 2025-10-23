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
  const SORT_MODES = {
    TYPE: "type",
    MANA: "mana",
    ALPHABETICAL: "alphabetical",
    TAG: "tag",
  };

  let currentDeckData = null;
  let currentDeckHandle = null;
  let deckSortMode = SORT_MODES.TYPE;

  const CARD_NAME_COLLATOR = new Intl.Collator("fr", { sensitivity: "base" });

  const CARD_TYPE_GROUPS = [
    { key: "creature", label: "Créatures", tokens: ["creature", "créature"] },
    { key: "planeswalker", label: "Planeswalkers", tokens: ["planeswalker", "arpenteur"] },
    { key: "artifact", label: "Artefacts", tokens: ["artifact", "artefact"] },
    { key: "enchantment", label: "Enchantements", tokens: ["enchantment", "enchantement"] },
    { key: "instant", label: "Éphémères", tokens: ["instant", "éphémère"] },
    { key: "sorcery", label: "Rituels", tokens: ["sorcery", "rituel"] },
    { key: "battle", label: "Batailles", tokens: ["battle", "bataille"] },
    { key: "land", label: "Terrains", tokens: ["land", "terrain"] },
    { key: "other", label: "Autres", tokens: [] },
  ];

  const CARD_TYPE_LOOKUP = new Map();
  const CARD_TYPE_TOKEN_LOOKUP = new Map();
  CARD_TYPE_GROUPS.forEach((group, index) => {
    const meta = { ...group, weight: index };
    CARD_TYPE_LOOKUP.set(group.key, meta);
    group.tokens.forEach((token) => {
      CARD_TYPE_TOKEN_LOOKUP.set(token, meta);
    });
  });

  const getCardTypeMeta = (cardData) => {
    const typeLineRaw = cardData?.type_line ?? cardData?.typeLine ?? "";
    if (typeof typeLineRaw !== "string" || typeLineRaw.trim().length === 0) {
      return CARD_TYPE_LOOKUP.get("other");
    }
    const normalized = typeLineRaw.toLowerCase();
    const baseSection = normalized.split("—")[0] ?? normalized;
    const tokens = baseSection
      .split(/[\s/]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      const lookup = CARD_TYPE_TOKEN_LOOKUP.get(tokens[index]);
      if (lookup) {
        return lookup;
      }
    }
    for (const [token, meta] of CARD_TYPE_TOKEN_LOOKUP.entries()) {
      if (baseSection.includes(token)) {
        return meta;
      }
    }
    if (normalized.includes("land") || normalized.includes("terrain")) {
      return CARD_TYPE_LOOKUP.get("land");
    }
    return CARD_TYPE_LOOKUP.get("other");
  };

  const getEntryQuantity = (cardEntry) => {
    const raw = typeof cardEntry?.quantity === "number" ? cardEntry.quantity : 1;
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  };

  const sortCardEntries = (entries, mode) => {
    const items = Array.isArray(entries) ? [...entries] : [];
    items.sort((a, b) => {
      const cardA = a?.card ?? {};
      const cardB = b?.card ?? {};
      const nameA = typeof cardA?.name === "string" ? cardA.name : "";
      const nameB = typeof cardB?.name === "string" ? cardB.name : "";
      const manaValueA = getCardManaValue(cardA);
      const manaValueB = getCardManaValue(cardB);
      const safeManaA = manaValueA === null ? Number.POSITIVE_INFINITY : manaValueA;
      const safeManaB = manaValueB === null ? Number.POSITIVE_INFINITY : manaValueB;
      const typeA = getCardTypeMeta(cardA);
      const typeB = getCardTypeMeta(cardB);

      switch (mode) {
        case SORT_MODES.MANA: {
          if (safeManaA !== safeManaB) {
            return safeManaA - safeManaB;
          }
          if (typeA.weight !== typeB.weight) {
            return typeA.weight - typeB.weight;
          }
          return CARD_NAME_COLLATOR.compare(nameA, nameB);
        }
        case SORT_MODES.TYPE: {
          if (typeA.weight !== typeB.weight) {
            return typeA.weight - typeB.weight;
          }
          if (safeManaA !== safeManaB) {
            return safeManaA - safeManaB;
          }
          return CARD_NAME_COLLATOR.compare(nameA, nameB);
        }
        case SORT_MODES.ALPHABETICAL:
        case SORT_MODES.TAG:
        default: {
          const comparison = CARD_NAME_COLLATOR.compare(nameA, nameB);
          if (comparison !== 0) {
            return comparison;
          }
          if (typeA.weight !== typeB.weight) {
            return typeA.weight - typeB.weight;
          }
          return safeManaA - safeManaB;
        }
      }
    });
    return items;
  };

  const buildTypeGroups = (entries, mode) => {
    const groups = new Map();
    entries.forEach((entry) => {
      const meta = getCardTypeMeta(entry?.card ?? {});
      const key = meta?.key ?? "other";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: meta?.label ?? "Autres",
          weight: meta?.weight ?? CARD_TYPE_LOOKUP.get("other")?.weight ?? CARD_TYPE_GROUPS.length,
          cards: [],
          quantity: 0,
        });
      }
      const bucket = groups.get(key);
      bucket.cards.push(entry);
      bucket.quantity += getEntryQuantity(entry);
    });

    const sortModeForCards =
      mode === SORT_MODES.MANA ? SORT_MODES.MANA : SORT_MODES.ALPHABETICAL;

    const ordered = Array.from(groups.values());
    ordered.forEach((group) => {
      group.cards = sortCardEntries(group.cards, sortModeForCards);
    });
    ordered.sort((a, b) => {
      if (a.weight !== b.weight) {
        return a.weight - b.weight;
      }
      return CARD_NAME_COLLATOR.compare(a.label, b.label);
    });
    return ordered;
  };

  const createCardRow = (cardEntry, board, { deck, deckId, handle }) => {
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

    [quantityCell, nameCell, typeCell, manaCostCell].forEach((cell) => row.appendChild(cell));

    return row;
  };

  const buildSortControls = (board) => {
    const wrapper = document.createElement("div");
    wrapper.className = "deck-board-actions";

    const baseId = typeof board?.name === "string" && board.name.trim().length > 0
      ? board.name
      : "deck";
    const controlId = `deckSortMode-${baseId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "deck"}`;

    const label = document.createElement("label");
    label.className = "card-sort-label";
    label.setAttribute("for", controlId);
    label.textContent = "Trier par";
    wrapper.appendChild(label);

    const select = document.createElement("select");
    select.className = "card-sort-select";
    select.id = controlId;

    const options = [
      { value: SORT_MODES.MANA, label: "Coût de mana" },
      { value: SORT_MODES.TYPE, label: "Type de carte" },
      { value: SORT_MODES.ALPHABETICAL, label: "Ordre alphabétique" },
      { value: SORT_MODES.TAG, label: "Tag (bientôt)", disabled: true },
    ];

    options.forEach((definition) => {
      const option = document.createElement("option");
      option.value = definition.value;
      option.textContent = definition.label;
      if (definition.disabled) {
        option.disabled = true;
      }
      select.appendChild(option);
    });

    select.value = deckSortMode;
    select.addEventListener("change", (event) => {
      const nextValue = event.target.value;
      if (nextValue === SORT_MODES.TAG) {
        event.target.value = deckSortMode;
        return;
      }
      deckSortMode = nextValue;
      if (currentDeckData) {
        renderDeckBoards(currentDeckData, { handle: currentDeckHandle });
      }
    });

    wrapper.appendChild(select);
    return wrapper;
  };

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

    if (deck) {
      currentDeckData = deck;
    }
    if (typeof handle !== "undefined") {
      currentDeckHandle = handle ?? null;
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
    const commanderEntries = [];

    boards.forEach((board) => {
      const cards = Array.isArray(board?.cards) ? [...board.cards] : [];
      if (cards.length === 0) {
        return;
      }

      const boardNameRaw = typeof board?.name === "string" ? board.name : "";
      const boardName = boardNameRaw.toLowerCase();
      const boardLabel = humanizeBoardName(board?.name);
      const isCommanderBoard = boardName.includes("commander");
      const isMainboard =
        boardName === "mainboard" || boardLabel.toLowerCase() === "bibliothèque principale";

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
      if (cards.length > 1) {
        header.appendChild(buildSortControls(board));
      }
      section.appendChild(header);

      const table = document.createElement("table");
      table.className = "card-table";
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      ["Qté", "Carte", "Type", "Coût"].forEach((label) => {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = label;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      if (isMainboard) {
        const groups = buildTypeGroups(cards, deckSortMode);
        groups.forEach((group) => {
          if (!group || !Array.isArray(group.cards) || group.cards.length === 0) {
            return;
          }
          const groupRow = document.createElement("tr");
          groupRow.className = "card-table-group";
          const groupHeader = document.createElement("th");
          groupHeader.scope = "colgroup";
          groupHeader.colSpan = 4;
          groupHeader.textContent = `${group.label} (${group.quantity})`;
          groupRow.appendChild(groupHeader);
          tbody.appendChild(groupRow);
          group.cards.forEach((cardEntry) => {
            tbody.appendChild(createCardRow(cardEntry, board, { deck, deckId, handle }));
          });
        });
      } else {
        const sortedCards = sortCardEntries(cards, deckSortMode);
        sortedCards.forEach((cardEntry) => {
          tbody.appendChild(createCardRow(cardEntry, board, { deck, deckId, handle }));
        });
      }

      table.appendChild(tbody);
      const tableContainer = document.createElement("div");
      tableContainer.className = "card-table-container";
      tableContainer.appendChild(table);
      section.appendChild(tableContainer);

      deckBoardsEl.appendChild(section);
    });

    const deckStats = computeDeckStatistics(deck);

    updateDeckSummary({
      totalCards: totalCardQuantity,
      uniqueCards: uniqueCardIdentifiers.size,
      boards: boardSummaries,
      stats: deckStats,
      deckId,
      deckName: deck?.name ?? null,
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

    const nextDeckId = getDeckIdentifier(deck) ?? deck?.id ?? null;
    const previousDeckId = currentDeckData
      ? getDeckIdentifier(currentDeckData) ?? currentDeckData?.id ?? null
      : null;
    if (!previousDeckId || previousDeckId !== nextDeckId) {
      deckSortMode = SORT_MODES.TYPE;
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
