(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  const GAME_HISTORY_STORAGE_KEY = "edhPodlogGameHistory";
  const KNOWN_PLAYERS_STORAGE_KEY = "edhPodlogKnownPlayers";
  const DEFAULT_PLAYER_NAMES = ["Joueur 1", "Joueur 2", "Joueur 3", "Joueur 4"];
  const MANUAL_DECK_OPTION = "__manual__";

  const runSoon = (callback) => {
    if (typeof queueMicrotask === "function") {
      queueMicrotask(callback);
      return;
    }
    Promise.resolve().then(callback).catch(() => {});
  };

  const createIdentifier = (prefix) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");

  const readArrayFromStorage = (key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (typeof console !== "undefined") {
        console.warn(`Impossible de lire ${key} depuis le stockage.`, error);
      }
      return [];
    }
  };

  const writeArrayToStorage = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      if (typeof console !== "undefined") {
        if (typeof isQuotaExceededError === "function" && isQuotaExceededError(error)) {
          console.warn(`Stockage plein, impossible de sauvegarder ${key}.`);
        } else {
          console.warn(`Impossible d'écrire ${key} dans le stockage.`, error);
        }
      }
      return false;
    }
  };

  const formatRankLabel = (rank) => (rank === 1 ? "1er" : `${rank}e`);

  const clonePlayer = (player) => ({ ...player });

  api.registerPageController("dashboard", (context) => {
    const toggleBtn = document.getElementById("gameSetupToggle");
    const container = document.getElementById("gameSetupContainer");
    const setupForm = document.getElementById("gameSetupForm");
    const playersListEl = document.getElementById("gamePlayersList");
    const playerTemplate = document.getElementById("playerRowTemplate");
    const addPlayerButton = document.getElementById("addPlayerButton");
    const knownPlayersListEl = document.getElementById("knownPlayers");
    const summarySection = document.getElementById("gameSummary");
    const summaryList = document.getElementById("gameSummaryList");
    const editPlayersButton = document.getElementById("editPlayersButton");
    const startGameButton = document.getElementById("startGameButton");
    const openResultButton = document.getElementById("openResultButton");
    const resultForm = document.getElementById("gameResultForm");
    const resultGrid = document.getElementById("gameResultGrid");
    const cancelResultButton = document.getElementById("cancelResultButton");
    const statusEl = document.getElementById("gameStatus");
    const historyEmpty = document.getElementById("gameHistoryEmpty");
    const historyList = document.getElementById("gameHistoryList");

    if (
      !toggleBtn ||
      !container ||
      !setupForm ||
      !playersListEl ||
      !playerTemplate ||
      !addPlayerButton ||
      !summarySection ||
      !summaryList ||
      !openResultButton ||
      !resultForm ||
      !resultGrid ||
      !cancelResultButton ||
      !statusEl ||
      !historyEmpty ||
      !historyList
    ) {
      return;
    }

    const session = context.session ?? (typeof getSession === "function" ? getSession() : null);
    const integration =
      typeof getMoxfieldIntegration === "function" ? getMoxfieldIntegration(session) : null;
    const deckOptions = Array.isArray(integration?.decks)
      ? integration.decks
          .map((deck) => {
            const id =
              typeof getDeckIdentifier === "function"
                ? getDeckIdentifier(deck)
                : deck?.publicId ?? deck?.id ?? null;
            if (!id) {
              return null;
            }
            return {
              id,
              name: deck.name || "Deck sans nom",
              format: deck.format || "",
            };
          })
          .filter(Boolean)
      : [];

    let knownPlayers = new Set(
      readArrayFromStorage(KNOWN_PLAYERS_STORAGE_KEY)
        .map(normalizeString)
        .filter((name) => name && !DEFAULT_PLAYER_NAMES.includes(name))
    );

    const refreshKnownPlayersDatalist = () => {
      if (!knownPlayersListEl) {
        return;
      }
      knownPlayersListEl.innerHTML = "";
      Array.from(knownPlayers)
        .sort((a, b) => a.localeCompare(b, "fr"))
        .forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          knownPlayersListEl.appendChild(option);
        });
    };

    refreshKnownPlayersDatalist();

    const addKnownPlayers = (names) => {
      let updated = false;
      names.forEach((name) => {
        const normalized = normalizeString(name);
        if (!normalized || DEFAULT_PLAYER_NAMES.includes(normalized) || knownPlayers.has(normalized)) {
          return;
        }
        knownPlayers.add(normalized);
        updated = true;
      });
      if (updated) {
        writeArrayToStorage(KNOWN_PLAYERS_STORAGE_KEY, Array.from(knownPlayers));
        refreshKnownPlayersDatalist();
      }
    };

    let gameHistory = readArrayFromStorage(GAME_HISTORY_STORAGE_KEY);

    const renderHistory = () => {
      historyList.innerHTML = "";
      if (!Array.isArray(gameHistory) || gameHistory.length === 0) {
        historyEmpty.hidden = false;
        return;
      }
      historyEmpty.hidden = true;

      gameHistory.forEach((record, index) => {
        const entry = document.createElement("li");
        entry.className = "game-history-entry";

        const header = document.createElement("div");
        header.className = "game-history-header";

        const title = document.createElement("span");
        title.textContent = `Partie ${gameHistory.length - index}`;

        const meta = document.createElement("span");
        meta.className = "game-history-meta";
        if (typeof formatDateTime === "function") {
          meta.textContent = formatDateTime(record.createdAt, {
            dateStyle: "medium",
            timeStyle: "short",
          });
        } else {
          meta.textContent = new Date(record.createdAt).toLocaleString("fr-FR");
        }

        header.append(title, meta);

        const playersList = document.createElement("ul");
        playersList.className = "game-history-players";

        const rankingMap = new Map();
        if (Array.isArray(record.rankings)) {
          record.rankings.forEach((entryRanking) => {
            if (entryRanking?.playerId) {
              rankingMap.set(entryRanking.playerId, Number.parseInt(entryRanking.rank, 10));
            }
          });
        }

        (Array.isArray(record.players) ? record.players : []).forEach((player) => {
          const item = document.createElement("li");
          const rankValue = rankingMap.get(player.id);
          const rankSpan = document.createElement("span");
          rankSpan.className = "game-history-rank";
          rankSpan.textContent =
            typeof rankValue === "number" && Number.isFinite(rankValue)
              ? formatRankLabel(rankValue)
              : "–";

          const nameText = document.createTextNode(` ${player.name || "Joueur inconnu"}`);

          item.append(rankSpan, nameText);

          const metaParts = [];
          if (player.isOwner) {
            metaParts.push("Propriétaire");
          }
          if (player.deckName) {
            metaParts.push(player.deckName);
          }

          if (metaParts.length > 0) {
            const metaSpan = document.createElement("span");
            metaSpan.className = "game-history-player-meta";
            metaSpan.textContent = metaParts.join(" · ");
            item.append(document.createTextNode(" "), metaSpan);
          }

          playersList.appendChild(item);
        });

        entry.append(header, playersList);
        historyList.appendChild(entry);
      });
    };

    renderHistory();

    const setStatus = (message, variant = "neutral") => {
      statusEl.textContent = message ?? "";
      statusEl.classList.remove("is-error", "is-success");
      if (!message) {
        return;
      }
      if (variant === "error") {
        statusEl.classList.add("is-error");
      } else if (variant === "success") {
        statusEl.classList.add("is-success");
      }
    };

    const createInitialPlayers = () =>
      DEFAULT_PLAYER_NAMES.map((name, index) => ({
        id: createIdentifier("player"),
        name,
        deckName: "",
        deckId: "",
        deckMode: deckOptions.length > 0 && index === 0 ? "library" : "manual",
        isOwner: index === 0,
        isDefault: true,
      }));

    const createAdditionalPlayer = () => ({
      id: createIdentifier("player"),
      name: `Joueur ${players.length + 1}`,
      deckName: "",
      deckId: "",
      deckMode: "manual",
      isOwner: false,
      isDefault: false,
    });

    let players = createInitialPlayers();
    let latestConfirmedPlayers = null;

    const ensureOwnerExists = () => {
      if (players.some((player) => player.isOwner)) {
        return;
      }
      if (players.length > 0) {
        players[0].isOwner = true;
        if (deckOptions.length > 0) {
          players[0].deckMode = "library";
        }
      }
    };

    const reindexPlayerNames = () => {
      players.forEach((player, index) => {
        player.index = index + 1;
      });
    };

    const renderPlayers = () => {
      playersListEl.innerHTML = "";
      ensureOwnerExists();
      reindexPlayerNames();

      players.forEach((player, index) => {
        const fragment = playerTemplate.content.cloneNode(true);
        const row = fragment.querySelector(".player-row");
        if (!row) {
          return;
        }

        row.dataset.playerId = player.id;
        row.classList.toggle("is-owner", Boolean(player.isOwner));

        const indexEl = row.querySelector(".player-index");
        if (indexEl) {
          indexEl.textContent = `#${index + 1}`;
        }

        const ownerLabel = row.querySelector(".player-owner-toggle span");
        if (ownerLabel) {
          ownerLabel.textContent = player.isOwner
            ? "Propriétaire du compte"
            : "Marquer comme propriétaire";
        }

        const ownerRadio = row.querySelector(".player-owner-radio");
        if (ownerRadio) {
          ownerRadio.value = player.id;
          ownerRadio.checked = Boolean(player.isOwner);
          ownerRadio.addEventListener("change", () => {
            setOwner(player.id);
          });
        }

        const nameInput = row.querySelector(".player-name-input");
        if (nameInput) {
          nameInput.value = player.name || "";
          nameInput.required = true;
          if (knownPlayersListEl) {
            nameInput.setAttribute("list", knownPlayersListEl.id);
          }
          nameInput.addEventListener("input", (event) => {
            const nextName = normalizeString(event.target.value);
            player.name = nextName || event.target.value;
          });
        }

        const manualDeckLabel = row.querySelector(".player-deck-manual");
        const manualDeckInput = row.querySelector(".player-deck-input");
        const selectDeckLabel = row.querySelector(".player-deck-select");
        const deckSelect = row.querySelector(".player-deck-select-input");

        if (player.isOwner && deckOptions.length > 0 && deckSelect && selectDeckLabel) {
          selectDeckLabel.hidden = false;
          deckSelect.innerHTML = "";

          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = "Sélectionner un deck";
          placeholder.disabled = true;
          deckSelect.appendChild(placeholder);

          deckOptions.forEach((deck) => {
            const option = document.createElement("option");
            option.value = deck.id;
            option.textContent = deck.format ? `${deck.name} · ${deck.format.toUpperCase()}` : deck.name;
            deckSelect.appendChild(option);
          });

          const manualOption = document.createElement("option");
          manualOption.value = MANUAL_DECK_OPTION;
          manualOption.textContent = "Saisir un deck manuellement";
          deckSelect.appendChild(manualOption);

          if (player.deckMode === "library" && player.deckId) {
            deckSelect.value = player.deckId;
          } else if (player.deckMode === "manual") {
            deckSelect.value = MANUAL_DECK_OPTION;
          } else {
            deckSelect.value = "";
          }

          deckSelect.addEventListener("change", (event) => {
            const selectedValue = event.target.value;
            if (selectedValue === MANUAL_DECK_OPTION) {
              player.deckMode = "manual";
              player.deckId = "";
              if (manualDeckInput) {
                player.deckName = manualDeckInput.value.trim();
              }
              renderPlayers();
              return;
            }

            const selectedDeck = deckOptions.find((deck) => deck.id === selectedValue);
            player.deckMode = "library";
            player.deckId = selectedValue;
            player.deckName = selectedDeck?.name ?? "";
            renderPlayers();
          });
        } else {
          if (selectDeckLabel) {
            selectDeckLabel.hidden = true;
          }
          if (deckSelect) {
            deckSelect.innerHTML = "";
          }
        }

        if (manualDeckLabel && manualDeckInput) {
          manualDeckLabel.hidden = player.isOwner && deckOptions.length > 0 && player.deckMode !== "manual";
          manualDeckInput.value = player.deckName ?? "";
          manualDeckInput.placeholder = "Nom du deck (optionnel)";
          manualDeckInput.addEventListener("input", (event) => {
            player.deckName = event.target.value.trim();
            if (player.isOwner && deckOptions.length > 0) {
              player.deckMode = "manual";
              player.deckId = "";
            }
          });
        }

        const removeBtn = row.querySelector('[data-action="remove"]');
        if (removeBtn) {
          const canRemove = players.length > 4;
          removeBtn.disabled = !canRemove;
          if (!canRemove) {
            removeBtn.setAttribute("aria-disabled", "true");
          } else {
            removeBtn.removeAttribute("aria-disabled");
            removeBtn.addEventListener("click", () => {
              removePlayer(player.id);
            });
          }
        }

        const moveUpBtn = row.querySelector('[data-action="move-up"]');
        if (moveUpBtn) {
          moveUpBtn.disabled = index === 0;
          if (!moveUpBtn.disabled) {
            moveUpBtn.addEventListener("click", () => {
              movePlayer(player.id, -1);
            });
          }
        }

        const moveDownBtn = row.querySelector('[data-action="move-down"]');
        if (moveDownBtn) {
          moveDownBtn.disabled = index === players.length - 1;
          if (!moveDownBtn.disabled) {
            moveDownBtn.addEventListener("click", () => {
              movePlayer(player.id, 1);
            });
          }
        }

        playersListEl.appendChild(row);
      });
    };

    const movePlayer = (playerId, delta) => {
      const currentIndex = players.findIndex((player) => player.id === playerId);
      if (currentIndex < 0) {
        return;
      }
      const nextIndex = currentIndex + delta;
      if (nextIndex < 0 || nextIndex >= players.length) {
        return;
      }
      const [player] = players.splice(currentIndex, 1);
      players.splice(nextIndex, 0, player);
      renderPlayers();
    };

    const setOwner = (playerId) => {
      let updated = false;
      players = players.map((player) => {
        if (player.id === playerId) {
          if (!player.isOwner) {
            updated = true;
          }
          const next = {
            ...player,
            isOwner: true,
          };
          if (deckOptions.length === 0) {
            next.deckMode = "manual";
            next.deckId = "";
          } else if (next.deckMode !== "manual" && !next.deckId) {
            next.deckMode = "library";
          }
          return next;
        }

        if (!player.isOwner) {
          return player;
        }

        updated = true;
        return {
          ...player,
          isOwner: false,
          deckMode: player.deckMode === "library" ? "manual" : player.deckMode,
          deckId: "",
        };
      });

      if (updated) {
        renderPlayers();
      }
    };

    const removePlayer = (playerId) => {
      if (players.length <= 4) {
        return;
      }
      players = players.filter((player) => player.id !== playerId);
      renderPlayers();
    };

    const resetWorkflow = ({ preserveStatus = false } = {}) => {
      players = createInitialPlayers();
      latestConfirmedPlayers = null;
      setupForm.hidden = false;
      summarySection.hidden = true;
      resultForm.hidden = true;
      resultForm.reset();
      resultGrid.innerHTML = "";
      if (!preserveStatus) {
        setStatus("");
      }
      renderPlayers();
      runSoon(() => {
        const firstInput = playersListEl.querySelector(".player-name-input");
        if (firstInput) {
          firstInput.focus();
        }
      });
    };

    renderPlayers();

    toggleBtn.addEventListener("click", () => {
      const isHidden = container.hasAttribute("hidden");
      if (isHidden) {
        container.removeAttribute("hidden");
        toggleBtn.textContent = "Fermer la préparation";
        resetWorkflow();
      } else {
        container.setAttribute("hidden", "hidden");
        toggleBtn.textContent = "Lancer une partie";
        setStatus("");
      }
    });

    addPlayerButton.addEventListener("click", () => {
      players.push(createAdditionalPlayer());
      renderPlayers();
      runSoon(() => {
        const inputs = playersListEl.querySelectorAll(".player-name-input");
        if (inputs.length > 0) {
          inputs[inputs.length - 1].focus();
        }
      });
    });

    const validatePlayers = () => {
      if (!Array.isArray(players) || players.length < 4) {
        setStatus("Veuillez renseigner au moins quatre joueurs.", "error");
        return false;
      }

      for (const player of players) {
        const name = normalizeString(player.name);
        if (!name) {
          setStatus("Les noms des joueurs sont obligatoires.", "error");
          return false;
        }
      }

      setStatus("");
      return true;
    };

    const renderSummary = (playerList) => {
      summaryList.innerHTML = "";
      playerList.forEach((player, index) => {
        const item = document.createElement("li");
        item.className = "game-summary-item";

        const nameEl = document.createElement("strong");
        nameEl.textContent = `${index + 1}. ${player.name}`;

        const metaParts = [];
        if (player.isOwner) {
          metaParts.push("Propriétaire");
        }
        if (player.deckName) {
          metaParts.push(player.deckName);
        }

        const metaEl = document.createElement("span");
        metaEl.textContent = metaParts.length > 0 ? metaParts.join(" · ") : "Deck non précisé";

        item.append(nameEl, metaEl);
        summaryList.appendChild(item);
      });
    };

    const populateResultForm = (playerList) => {
      resultGrid.innerHTML = "";
      playerList.forEach((player) => {
        const row = document.createElement("div");
        row.className = "game-result-row";

        const label = document.createElement("label");
        label.setAttribute("for", `result-${player.id}`);

        const labelText = document.createElement("span");
        labelText.textContent = player.name;

        const select = document.createElement("select");
        select.id = `result-${player.id}`;
        select.name = `result-${player.id}`;
        select.className = "game-result-select";
        select.required = true;

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Sélectionner un rang";
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);

        for (let rank = 1; rank <= playerList.length; rank += 1) {
          const option = document.createElement("option");
          option.value = String(rank);
          option.textContent = formatRankLabel(rank);
          select.appendChild(option);
        }

        label.append(labelText, select);
        row.appendChild(label);
        resultGrid.appendChild(row);
      });
    };

    setupForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!validatePlayers()) {
        return;
      }

      latestConfirmedPlayers = players.map(clonePlayer);
      renderSummary(latestConfirmedPlayers);
      setupForm.hidden = true;
      summarySection.hidden = false;
      resultForm.hidden = true;
      resultForm.reset();
      resultGrid.innerHTML = "";
      setStatus("La composition de la partie est prête.");

      const additionalNames = latestConfirmedPlayers
        .filter((player) => !player.isDefault)
        .map((player) => player.name);
      addKnownPlayers(additionalNames);
    });

    editPlayersButton?.addEventListener("click", () => {
      if (!latestConfirmedPlayers) {
        resetWorkflow();
        return;
      }
      players = latestConfirmedPlayers.map(clonePlayer);
      setupForm.hidden = false;
      summarySection.hidden = true;
      resultForm.hidden = true;
      resultForm.reset();
      resultGrid.innerHTML = "";
      setStatus("");
      renderPlayers();
      requestAnimationFrame(() => {
        const firstInput = playersListEl.querySelector(".player-name-input");
        if (firstInput) {
          firstInput.focus();
        }
      });
    });

    startGameButton?.addEventListener("click", () => {
      setStatus("La fonctionnalité de suivi en direct arrive bientôt.", "error");
    });

    openResultButton.addEventListener("click", () => {
      if (!Array.isArray(latestConfirmedPlayers) || latestConfirmedPlayers.length === 0) {
        setStatus("Confirmez d'abord la composition de la partie.", "error");
        return;
      }
      populateResultForm(latestConfirmedPlayers);
      resultForm.hidden = false;
      setStatus("");
    });

    cancelResultButton.addEventListener("click", () => {
      resultForm.hidden = true;
      resultForm.reset();
      resultGrid.innerHTML = "";
      setStatus("Enregistrement du résultat annulé.");
    });

    resultForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!Array.isArray(latestConfirmedPlayers) || latestConfirmedPlayers.length === 0) {
        setStatus("Confirmez la composition avant d'enregistrer un résultat.", "error");
        return;
      }

      const formData = new FormData(resultForm);
      const rankings = [];
      for (const player of latestConfirmedPlayers) {
        const rawValue = formData.get(`result-${player.id}`);
        const rank = Number.parseInt(rawValue, 10);
        if (!rawValue || !Number.isFinite(rank) || rank < 1 || rank > latestConfirmedPlayers.length) {
          setStatus("Veuillez attribuer un rang à chaque joueur.", "error");
          return;
        }
        rankings.push({ playerId: player.id, rank });
      }

      const record = {
        id: createIdentifier("game"),
        createdAt: new Date().toISOString(),
        players: latestConfirmedPlayers.map((player, index) => ({
          id: player.id,
          name: player.name,
          deckName: player.deckName ?? "",
          deckId: player.deckId ?? "",
          isOwner: Boolean(player.isOwner),
          order: index,
        })),
        rankings,
      };

      gameHistory = [record, ...gameHistory].slice(0, 100);
      writeArrayToStorage(GAME_HISTORY_STORAGE_KEY, gameHistory);
      renderHistory();

      setStatus("La partie a été enregistrée dans votre historique.", "success");
      resetWorkflow({ preserveStatus: true });
      resultForm.hidden = true;
    });
  });
})();
