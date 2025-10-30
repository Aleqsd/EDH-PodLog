(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  const KNOWN_PLAYERS_STORAGE_KEY = "edhPodlogKnownPlayers";
  const LAST_PLAYGROUP_STORAGE_KEY = "edhPodlogLastPlaygroup";
  const DEFAULT_PLAYER_NAMES = ["Joueur 1", "Joueur 2", "Joueur 3", "Joueur 4"];
  const MANUAL_DECK_OPTION = "__manual__";
  const MAX_DASHBOARD_HISTORY = 5;

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
      console.warn(`Impossible de lire ${key} depuis le stockage.`, error);
      return [];
    }
  };

  const writeArrayToStorage = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      if (typeof isQuotaExceededError === "function" && isQuotaExceededError(error)) {
        console.warn(`Stockage plein, impossible de sauvegarder ${key}.`);
      } else {
        console.warn(`Impossible d'écrire ${key} dans le stockage.`, error);
      }
      return false;
    }
  };

  const readValueFromStorage = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn(`Impossible de lire ${key} depuis le stockage.`, error);
      return null;
    }
  };

  const writeValueToStorage = (key, value) => {
    try {
      if (value) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(`Impossible de persister ${key}.`, error);
    }
  };

  const formatRankLabel = (rank) => (rank === 1 ? "1er" : `${rank}e`);

  const clonePlayer = (player) => ({ ...player });

  const safeToDate = (value) => {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  };

  api.registerPageController("dashboard", async (context) => {
    const toggleBtn = document.getElementById("gameSetupToggle");
    const container = document.getElementById("gameSetupContainer");
    const setupForm = document.getElementById("gameSetupForm");
    const playgroupInput = document.getElementById("playgroupInput");
    const playgroupListEl = document.getElementById("knownPlaygroups");
    const playersListEl = document.getElementById("gamePlayersList");
    const playerTemplate = document.getElementById("playerRowTemplate");
    const addPlayerButton = document.getElementById("addPlayerButton");
    const knownPlayersListEl = document.getElementById("knownPlayers");
    const saveResultButton = document.getElementById("saveResultButton");
    const startGameButton = document.getElementById("startGameButton");
    const resultForm = document.getElementById("gameResultForm");
    const resultGrid = document.getElementById("gameResultGrid");
    const cancelResultButton = document.getElementById("cancelResultButton");
    const statusEl = document.getElementById("gameStatus");
    const historyEmpty = document.getElementById("gameHistoryEmpty");
    const historyList = document.getElementById("gameHistoryList");
    const lifeTrackerOverlay = document.getElementById("lifeTrackerOverlay");
    const lifeTrackerGrid = document.getElementById("lifeTrackerGrid");
    const lifeTrackerClose = document.getElementById("lifeTrackerClose");
    const lifeTrackerReset = document.getElementById("lifeTrackerReset");

    if (
      !toggleBtn ||
      !container ||
      !setupForm ||
      !playgroupInput ||
      !playgroupListEl ||
      !playersListEl ||
      !playerTemplate ||
      !addPlayerButton ||
      !saveResultButton ||
      !startGameButton ||
      !resultForm ||
      !resultGrid ||
      !cancelResultButton ||
      !statusEl ||
      !historyEmpty ||
      !historyList ||
      !lifeTrackerOverlay ||
      !lifeTrackerGrid ||
      !lifeTrackerClose ||
      !lifeTrackerReset
    ) {
      return;
    }

    setupForm.addEventListener("submit", (event) => event.preventDefault());

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

    const sessionStore = window.EDH_PODLOG?.session ?? {};
    const session =
      context.session ??
      (sessionStore.getCurrent ? sessionStore.getCurrent() : null) ??
      (sessionStore.load ? sessionStore.load() : null);
    const googleSub = session?.googleSub || null;

    const ownerDisplayName =
      normalizeString(session?.userName) ||
      normalizeString(session?.givenName) ||
      DEFAULT_PLAYER_NAMES[0];

    const integration =
      typeof getMoxfieldIntegration === "function" ? getMoxfieldIntegration(session) : null;
    const deckOptions = Array.isArray(integration?.decks)
      ? integration.decks
          .map((deck) => {
            const identifier =
              typeof getDeckIdentifier === "function"
                ? getDeckIdentifier(deck)
                : deck?.publicId ?? deck?.id ?? deck?.slug ?? null;
            if (!identifier) {
              return null;
            }
            const slug = deck?.slug ?? deck?.id ?? deck?.publicId ?? identifier;
            return {
              id: identifier,
              name: deck?.name || "Deck sans nom",
              format: deck?.format || "",
              slug,
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

    let playgroups = [];
    let playgroupSelection = { id: null, name: "" };

    const refreshPlaygroupDatalist = () => {
      playgroupListEl.innerHTML = "";
      playgroups
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "fr"))
        .forEach((group) => {
          const option = document.createElement("option");
          option.value = group.name;
          playgroupListEl.appendChild(option);
        });
    };

    const findPlaygroupByName = (name) => {
      const normalized = normalizeString(name).toLowerCase();
      if (!normalized) {
        return null;
      }
      return (
        playgroups.find(
          (group) => normalizeString(group.name).toLowerCase() === normalized
        ) || null
      );
    };

    const updatePlaygroupSelection = (group, { preserveInput = false } = {}) => {
      if (group) {
        playgroupSelection = { id: group.id || null, name: group.name || "" };
        if (!preserveInput) {
          playgroupInput.value = group.name || "";
        }
        writeValueToStorage(LAST_PLAYGROUP_STORAGE_KEY, playgroupSelection.id || "");
      } else {
        playgroupSelection = {
          id: null,
          name: normalizeString(playgroupInput.value),
        };
        if (!playgroupSelection.name) {
          writeValueToStorage(LAST_PLAYGROUP_STORAGE_KEY, "");
        }
      }
    };

    const handlePlaygroupInputChange = () => {
      const typed = playgroupInput.value;
      const match = findPlaygroupByName(typed);
      if (match) {
        updatePlaygroupSelection(match);
      } else {
        playgroupSelection = { id: null, name: normalizeString(typed) };
      }
    };

    playgroupInput.addEventListener("input", handlePlaygroupInputChange);

    const ensureDefaultPlaygroup = async () => {
      if (!googleSub) {
        return null;
      }
      const defaultName = `Groupe de ${ownerDisplayName}`;
      try {
        return await upsertUserPlaygroup(googleSub, defaultName);
      } catch (error) {
        console.warn("Impossible de créer le groupe par défaut :", error);
        return null;
      }
    };

    const loadPlaygroups = async () => {
      if (!googleSub) {
        if (!playgroupSelection.name && ownerDisplayName) {
          playgroupSelection = { id: null, name: `Groupe de ${ownerDisplayName}` };
          playgroupInput.value = playgroupSelection.name;
        }
        return;
      }
      try {
        const payload = await fetchUserPlaygroups(googleSub);
        playgroups = Array.isArray(payload?.playgroups) ? payload.playgroups : [];
        if (!playgroups.length) {
          const created = await ensureDefaultPlaygroup();
          if (created) {
            playgroups = [created];
          }
        }
      } catch (error) {
        console.warn("Impossible de charger les groupes :", error);
        setStatus("Impossible de charger vos groupes.", "error");
      }
      refreshPlaygroupDatalist();
      const lastId = readValueFromStorage(LAST_PLAYGROUP_STORAGE_KEY);
      const matchById = lastId ? playgroups.find((group) => group.id === lastId) : null;
      if (matchById) {
        updatePlaygroupSelection(matchById);
      } else if (playgroups.length > 0) {
        updatePlaygroupSelection(playgroups[0]);
      } else if (!normalizeString(playgroupInput.value) && ownerDisplayName) {
        playgroupSelection = { id: null, name: `Groupe de ${ownerDisplayName}` };
        playgroupInput.value = playgroupSelection.name;
      } else {
        updatePlaygroupSelection(null, { preserveInput: true });
      }
    };

    const loadAvailablePlayers = async () => {
      if (!googleSub) {
        availablePlayers = [];
        return;
      }
      try {
        const payload = await fetchAvailablePlayers(googleSub);
        availablePlayers = Array.isArray(payload?.players) ? payload.players : [];
      } catch (error) {
        console.warn("Impossible de charger les joueurs suivis :", error);
        availablePlayers = [];
      }
    };

    let players = [];
   let latestConfirmedPlayers = null;
   let availablePlayers = [];
    const LIFE_TRACKER_LONG_PRESS_DELAY = 400;
    let lifeTrackerState = null;

    const getCurrentRoster = () =>
      players.map((player, index) => ({
        id: player.id || `player-${index}`,
        name: normalizeString(player.name) || `Joueur ${index + 1}`,
      }));

    const computeRosterSignature = (roster) =>
      roster.map((entry) => `${entry.id}:${entry.name}`).join("|");

    const createLifeTrackerState = (roster) => ({
      players: roster.map((entry) => ({
        ...entry,
        life: 40,
        commanderDamage: roster
          .filter((source) => source.id !== entry.id)
          .map((source) => ({
            sourceId: source.id,
            sourceName: source.name,
            amount: 0,
          })),
      })),
    });

    const updateStartGameButton = () => {
      if (!startGameButton) {
        return;
      }
      if (!lifeTrackerState) {
        startGameButton.textContent = "Démarrer la partie";
        return;
      }
      if (lifeTrackerOverlay.hidden) {
        startGameButton.textContent = "Ouvrir le suivi de vie";
      } else {
        startGameButton.textContent = "Suivi de vie en cours";
      }
    };

    function hideLifeTracker({ focusTrigger = false } = {}) {
      if (lifeTrackerOverlay.hidden) {
        updateStartGameButton();
        return;
      }
      lifeTrackerOverlay.hidden = true;
      lifeTrackerOverlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("life-tracker-open");
      updateStartGameButton();
      if (focusTrigger) {
        runSoon(() => {
          startGameButton.focus();
        });
      }
    }

    function discardLifeTrackerState() {
      lifeTrackerState = null;
      hideLifeTracker();
      updateStartGameButton();
    }

    function adjustLifeTotal(playerId, delta) {
      if (!lifeTrackerState) {
        return;
      }
      const player = lifeTrackerState.players.find((entry) => entry.id === playerId);
      if (!player) {
        return;
      }
      const nextValue = Number.isFinite(player.life) ? player.life + delta : 40 + delta;
      player.life = Math.max(-999, Math.min(999, nextValue));
      renderLifeTracker();
    }

    function adjustCommanderDamage(targetId, sourceId, delta) {
      if (!lifeTrackerState) {
        return;
      }
      const player = lifeTrackerState.players.find((entry) => entry.id === targetId);
      if (!player) {
        return;
      }
      const track = player.commanderDamage.find((entry) => entry.sourceId === sourceId);
      if (!track) {
        return;
      }
      const nextValue = track.amount + delta;
      track.amount = Math.max(0, Math.min(999, nextValue));
      renderLifeTracker();
    }

    function setupLifeButton(button, playerId, step) {
      if (!button) {
        return;
      }
      let longPressTimer = null;
      let longPressTriggered = false;
      let keyboardActivation = false;

      const clearTimer = () => {
        if (longPressTimer !== null) {
          window.clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };

      button.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) {
          return;
        }
        if (event.pointerType === "touch") {
          event.preventDefault();
        }
        keyboardActivation = false;
        longPressTriggered = false;
        clearTimer();
        if (typeof button.setPointerCapture === "function" && event.pointerId != null) {
          try {
            button.setPointerCapture(event.pointerId);
          } catch (error) {
            // Ignorer les erreurs de capture de pointeur non prises en charge.
          }
        }
        longPressTimer = window.setTimeout(() => {
          longPressTriggered = true;
          adjustLifeTotal(playerId, step * 10);
        }, LIFE_TRACKER_LONG_PRESS_DELAY);
      });

      const handlePointerEnd = (event) => {
        if (
          typeof button.releasePointerCapture === "function" &&
          event.pointerId != null &&
          button.hasPointerCapture?.(event.pointerId)
        ) {
          try {
            button.releasePointerCapture(event.pointerId);
          } catch (error) {
            // Ignorer si la capture n'est plus active.
          }
        }
        clearTimer();
      };

      button.addEventListener("pointerup", handlePointerEnd);
      button.addEventListener("pointerleave", handlePointerEnd);
      button.addEventListener("pointercancel", handlePointerEnd);

      button.addEventListener("click", (event) => {
        if (longPressTriggered || keyboardActivation) {
          longPressTriggered = false;
          keyboardActivation = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        adjustLifeTotal(playerId, step);
      });

      button.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
          event.preventDefault();
          keyboardActivation = true;
          adjustLifeTotal(playerId, step);
        }
      });

      button.addEventListener("keyup", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          keyboardActivation = false;
        }
      });
    }

    function renderLifeTracker() {
      if (!lifeTrackerState || !lifeTrackerGrid) {
        return;
      }
      lifeTrackerGrid.innerHTML = "";
      lifeTrackerGrid.dataset.playerCount = String(lifeTrackerState.players.length);

      lifeTrackerState.players.forEach((player) => {
        const card = document.createElement("article");
        card.className = "life-tracker-card";
        card.dataset.playerId = player.id;
        card.setAttribute("role", "gridcell");

        const nameEl = document.createElement("h3");
        nameEl.className = "life-tracker-player";
        nameEl.textContent = player.name;
        card.appendChild(nameEl);

        const lifeWrapper = document.createElement("div");
        lifeWrapper.className = "life-tracker-life";

        const decreaseBtn = document.createElement("button");
        decreaseBtn.type = "button";
        decreaseBtn.className = "life-tracker-life-button is-decrement";
        decreaseBtn.textContent = "-";
        decreaseBtn.title = "Appui long : -10 points";
        decreaseBtn.setAttribute("aria-label", `Retirer 1 point de vie à ${player.name}`);
        setupLifeButton(decreaseBtn, player.id, -1);

        const lifeValue = document.createElement("output");
        lifeValue.className = "life-tracker-life-value";
        lifeValue.textContent = String(player.life);
        lifeValue.setAttribute("role", "status");
        lifeValue.setAttribute("aria-live", "polite");
        lifeValue.setAttribute("aria-label", `${player.name} : ${player.life} points de vie`);

        const increaseBtn = document.createElement("button");
        increaseBtn.type = "button";
        increaseBtn.className = "life-tracker-life-button is-increment";
        increaseBtn.textContent = "+";
        increaseBtn.title = "Appui long : +10 points";
        increaseBtn.setAttribute("aria-label", `Ajouter 1 point de vie à ${player.name}`);
        setupLifeButton(increaseBtn, player.id, 1);

        lifeWrapper.append(decreaseBtn, lifeValue, increaseBtn);
        card.appendChild(lifeWrapper);

        if (player.commanderDamage.length > 0) {
          const commanderSection = document.createElement("div");
          commanderSection.className = "life-tracker-commander";

          const commanderTitle = document.createElement("p");
          commanderTitle.className = "life-tracker-commander-title";
          commanderTitle.textContent = "Dégâts de commandant reçus";
          commanderSection.appendChild(commanderTitle);

          const commanderList = document.createElement("ul");
          commanderList.className = "life-tracker-commander-list";
          commanderList.setAttribute(
            "aria-label",
            `Dégâts de commandant reçus par ${player.name}`
          );

          player.commanderDamage.forEach((entry) => {
            const listItem = document.createElement("li");
            listItem.className = "life-tracker-commander-entry";
            listItem.dataset.sourceId = entry.sourceId;
            const lethal = entry.amount >= 21;
            if (lethal) {
              listItem.classList.add("is-lethal");
            }

            const sourceLabel = document.createElement("span");
            sourceLabel.className = "life-tracker-commander-source";
            sourceLabel.textContent = entry.sourceName;

            const controls = document.createElement("div");
            controls.className = "life-tracker-commander-controls";

            const minusBtn = document.createElement("button");
            minusBtn.type = "button";
            minusBtn.className = "life-tracker-commander-button is-decrement";
            minusBtn.textContent = "-";
            minusBtn.setAttribute(
              "aria-label",
              `Retirer 1 point de dégâts de commandant infligé par ${entry.sourceName}`
            );
            minusBtn.addEventListener("click", () => {
              adjustCommanderDamage(player.id, entry.sourceId, -1);
            });

            const value = document.createElement("span");
            value.className = "life-tracker-commander-value";
            value.textContent = String(entry.amount);
            value.setAttribute(
              "aria-label",
              `${entry.amount} dégâts infligés par ${entry.sourceName}`
            );
            if (lethal) {
              value.setAttribute("data-lethal", "true");
            } else {
              value.removeAttribute("data-lethal");
            }

            const plusBtn = document.createElement("button");
            plusBtn.type = "button";
            plusBtn.className = "life-tracker-commander-button is-increment";
            plusBtn.textContent = "+";
            plusBtn.setAttribute(
              "aria-label",
              `Ajouter 1 point de dégâts de commandant infligé par ${entry.sourceName}`
            );
            plusBtn.addEventListener("click", () => {
              adjustCommanderDamage(player.id, entry.sourceId, 1);
            });

            const lethalBadge = document.createElement("span");
            lethalBadge.className = "life-tracker-commander-lethal";
            lethalBadge.textContent = "21+ létal";
            lethalBadge.hidden = !lethal;

            controls.append(minusBtn, value, plusBtn);
            listItem.append(sourceLabel, controls, lethalBadge);
            commanderList.appendChild(listItem);
          });

          commanderSection.appendChild(commanderList);
          card.appendChild(commanderSection);
        }

        lifeTrackerGrid.appendChild(card);
      });

      updateStartGameButton();
    }

    const showLifeTracker = () => {
      if (!lifeTrackerState) {
        return;
      }
      lifeTrackerOverlay.hidden = false;
      lifeTrackerOverlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("life-tracker-open");
      renderLifeTracker();
      updateStartGameButton();
      runSoon(() => {
        lifeTrackerClose.focus();
      });
    };

    const resetLifeTracker = () => {
      if (!lifeTrackerState) {
        return;
      }
      lifeTrackerState.players.forEach((player) => {
        player.life = 40;
        player.commanderDamage.forEach((entry) => {
          entry.amount = 0;
        });
      });
      renderLifeTracker();
      setStatus("Le suivi de vie a été réinitialisé.", "success");
    };

    const handleLifeTrackerKeydown = (event) => {
      if (event.key === "Escape" && lifeTrackerState && !lifeTrackerOverlay.hidden) {
        event.preventDefault();
        hideLifeTracker({ focusTrigger: true });
      }
    };

    const createInitialPlayers = () =>
      DEFAULT_PLAYER_NAMES.map((name, index) => ({
        id: index === 0 && googleSub ? `user:${googleSub}` : createIdentifier("player"),
        name: index === 0 ? ownerDisplayName : name,
        deckName: "",
        deckId: "",
        deckFormat: "",
        deckSlug: "",
        deckMode: index === 0 && deckOptions.length > 0 ? "library" : "manual",
        isOwner: index === 0,
        isDefault: true,
        sourceId: index === 0 && googleSub ? `user:${googleSub}` : null,
        sourceType: index === 0 && googleSub ? "user" : null,
        googleSub: index === 0 && googleSub ? googleSub : null,
        linkedGoogleSub: index === 0 && googleSub ? googleSub : null,
        availableDecks: [],
        selectedDeckId: "",
      }));

    const createAdditionalPlayer = () => ({
      id: createIdentifier("player"),
      name: `Joueur ${players.length + 1}`,
      deckName: "",
      deckId: "",
      deckFormat: "",
      deckSlug: "",
      deckMode: "manual",
      isOwner: false,
      isDefault: false,
      sourceId: null,
      sourceType: null,
      googleSub: null,
      linkedGoogleSub: null,
      availableDecks: [],
      selectedDeckId: "",
    });

    const ensureOwnerExists = () => {
      if (players.some((player) => player.isOwner)) {
        return;
      }
      if (players.length > 0) {
        players[0].isOwner = true;
        players[0].name = ownerDisplayName;
        players[0].deckMode = deckOptions.length > 0 ? players[0].deckMode : "manual";
        if (googleSub) {
          players[0].sourceId = `user:${googleSub}`;
          players[0].sourceType = "user";
          players[0].googleSub = googleSub;
          players[0].linkedGoogleSub = googleSub;
          players[0].id = `user:${googleSub}`;
        }
      }
    };

    const reindexPlayerNames = () => {
      players.forEach((player, index) => {
        player.index = index + 1;
      });
    };

    const resetPlayerSource = (player) => {
      player.sourceId = null;
      player.sourceType = null;
      player.googleSub = null;
      player.linkedGoogleSub = null;
      player.availableDecks = [];
      player.selectedDeckId = "";
      if (!player.isOwner) {
        player.deckMode = "manual";
      }
      if (!player.isOwner) {
        player.id = createIdentifier("player");
      }
    };

    const applyPlayerSource = (player, sourceId) => {
      if (!sourceId) {
        resetPlayerSource(player);
        return;
      }
      const summary = availablePlayers.find((entry) => entry?.id === sourceId);
      if (!summary) {
        resetPlayerSource(player);
        return;
      }

      player.sourceId = summary.id;
      player.sourceType = summary.player_type || null;
      player.googleSub = summary.google_sub || null;
      player.linkedGoogleSub = summary.linked_google_sub || summary.google_sub || null;
      player.availableDecks = Array.isArray(summary.decks) ? summary.decks.slice() : [];
      player.selectedDeckId = "";

      if (summary.name) {
        player.name = summary.name;
      }

      if (summary.id) {
        player.id = summary.id;
      }

      if (player.googleSub && player.googleSub === googleSub) {
        player.isOwner = true;
      }

      if (player.availableDecks.length > 0) {
        const primaryDeck = player.availableDecks[0];
        player.deckMode = "linked";
        player.deckId = primaryDeck.public_id || primaryDeck.id || "";
        player.deckSlug = primaryDeck.slug || primaryDeck.public_id || player.deckId || "";
        player.deckFormat = primaryDeck.format || "";
        player.deckName = primaryDeck.name || "";
        player.selectedDeckId = player.deckId || player.deckSlug || "";
      } else if (!player.isOwner) {
        player.deckMode = "manual";
        player.deckId = "";
        player.deckName = "";
        player.deckFormat = "";
        player.deckSlug = "";
      }
    };

    const createDeckSelect = (player, deckSelect) => {
      deckSelect.innerHTML = "";

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Sélectionner un deck";
      placeholder.disabled = true;
      placeholder.selected = !player.deckId;
      deckSelect.appendChild(placeholder);

      deckOptions.forEach((deck) => {
        const option = document.createElement("option");
        option.value = deck.id;
        option.textContent = deck.format
          ? `${deck.name} · ${deck.format.toUpperCase()}`
          : deck.name;
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
          player.deckSlug = "";
          player.deckFormat = "";
          if (!player.deckName) {
            player.deckName = "";
          }
          renderPlayers();
          return;
        }

        const selectedDeck = deckOptions.find((deck) => deck.id === selectedValue);
        player.deckMode = "library";
        player.deckId = selectedDeck?.id ?? "";
        player.deckSlug = selectedDeck?.slug ?? selectedDeck?.id ?? "";
        player.deckFormat = selectedDeck?.format ?? "";
        player.deckName = selectedDeck?.name ?? "";
        renderPlayers();
      });
    };

    const populateLinkedDeckSelect = (player, selectEl) => {
      if (!selectEl) {
        return;
      }
      selectEl.innerHTML = "";

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Sélectionner un deck";
      selectEl.appendChild(placeholder);

      (Array.isArray(player.availableDecks) ? player.availableDecks : []).forEach((deck) => {
        const option = document.createElement("option");
        const deckId = deck.public_id || deck.id || deck.slug || "";
        option.value = deckId;
        option.textContent = deck.name
          ? `${deck.name}${deck.format ? ` · ${deck.format.toUpperCase()}` : ""}`
          : deck.format
          ? deck.format.toUpperCase()
          : "Deck suivi";
        option.dataset.slug = deck.slug || "";
        option.dataset.format = deck.format || "";
        option.dataset.name = deck.name || "";
        selectEl.appendChild(option);
      });

      selectEl.value = player.selectedDeckId || "";

      selectEl.addEventListener("change", (event) => {
        const deckId = event.target.value;
        if (!deckId) {
          player.deckMode = "manual";
          player.deckId = "";
          player.deckSlug = "";
          player.deckFormat = "";
          player.deckName = "";
          player.selectedDeckId = "";
          renderPlayers();
          return;
        }

        const option = event.target.selectedOptions[0];
        player.deckMode = "linked";
        player.deckId = deckId;
        player.deckSlug = option?.dataset?.slug || deckId;
        player.deckFormat = option?.dataset?.format || "";
        player.deckName = option?.dataset?.name || option?.textContent || "";
        player.selectedDeckId = deckId;
        renderPlayers();
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
          ownerRadio.addEventListener("change", () => setOwner(player.id));
        }

        const nameInput = row.querySelector(".player-name-input");
        if (nameInput) {
          nameInput.value = player.name || "";
          nameInput.required = true;
          if (knownPlayersListEl) {
            nameInput.setAttribute("list", knownPlayersListEl.id);
          }
          nameInput.addEventListener("input", (event) => {
            player.name = event.target.value;
          });
          nameInput.disabled = Boolean(player.sourceId && player.sourceType === "user");
        }

        const sourceSelect = row.querySelector(".player-source-select");
        if (sourceSelect) {
          sourceSelect.innerHTML = "";
          const manualOption = document.createElement("option");
          manualOption.value = "";
          manualOption.textContent = "Saisie libre";
          sourceSelect.appendChild(manualOption);

          const sortedSources = availablePlayers
            .slice()
            .sort((a, b) => {
              const labelA = normalizeString(a?.name || a?.google_sub || "a");
              const labelB = normalizeString(b?.name || b?.google_sub || "b");
              return labelA.localeCompare(labelB, "fr", { sensitivity: "base" });
            });

          sortedSources.forEach((entry) => {
            if (!entry?.id) {
              return;
            }
            const option = document.createElement("option");
            option.value = entry.id;
            option.textContent = entry.name || entry.google_sub || "Joueur suivi";
            option.dataset.type = entry.player_type || "";
            option.dataset.googleSub = entry.google_sub || "";
            sourceSelect.appendChild(option);
          });

          sourceSelect.value = player.sourceId && sortedSources.some((entry) => entry.id === player.sourceId)
            ? player.sourceId
            : "";

          sourceSelect.addEventListener("change", (event) => {
            applyPlayerSource(player, event.target.value);
            renderPlayers();
          });
        }

        const manualDeckLabel = row.querySelector(".player-deck-manual");
        const manualDeckInput = row.querySelector(".player-deck-input");
        const selectDeckLabel = row.querySelector(".player-deck-select");
        const deckSelect = row.querySelector(".player-deck-select-input");
        const linkedDeckLabel = row.querySelector(".player-linked-deck");
        const linkedDeckSelect = row.querySelector(".player-linked-deck-select");

        if (player.isOwner && deckOptions.length > 0 && deckSelect && selectDeckLabel) {
          selectDeckLabel.hidden = false;
          createDeckSelect(player, deckSelect);
        } else if (selectDeckLabel) {
          selectDeckLabel.hidden = true;
          if (deckSelect) {
            deckSelect.innerHTML = "";
          }
        }

        if (linkedDeckLabel && linkedDeckSelect) {
          const hasLinkedDecks = Array.isArray(player.availableDecks) && player.availableDecks.length > 0;
          linkedDeckLabel.hidden = !hasLinkedDecks;
          if (hasLinkedDecks) {
            populateLinkedDeckSelect(player, linkedDeckSelect);
          } else {
            linkedDeckSelect.innerHTML = "";
          }
        }

        if (manualDeckLabel && manualDeckInput) {
          const hideForOwner = player.isOwner && deckOptions.length > 0 && player.deckMode !== "manual";
          const hideForLinked = Array.isArray(player.availableDecks)
            && player.availableDecks.length > 0
            && player.deckMode === "linked";
          manualDeckLabel.hidden = hideForOwner || hideForLinked;
          manualDeckInput.value = player.deckName ?? "";
          manualDeckInput.placeholder = "Nom du deck (optionnel)";
          manualDeckInput.addEventListener("input", (event) => {
            player.deckName = event.target.value.trim();
            if (player.isOwner && deckOptions.length > 0) {
              player.deckMode = "manual";
              player.deckId = "";
              player.deckSlug = "";
              player.deckFormat = "";
            }
            if (!player.isOwner) {
              player.deckMode = "manual";
              player.deckId = "";
              player.deckSlug = "";
              player.deckFormat = "";
              player.selectedDeckId = "";
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
            removeBtn.addEventListener("click", () => removePlayer(player.id));
          }
        }

        const moveUpBtn = row.querySelector('[data-action="move-up"]');
        if (moveUpBtn) {
          moveUpBtn.disabled = index === 0;
          if (!moveUpBtn.disabled) {
            moveUpBtn.addEventListener("click", () => movePlayer(player.id, -1));
          }
        }

        const moveDownBtn = row.querySelector('[data-action="move-down"]');
        if (moveDownBtn) {
          moveDownBtn.disabled = index === players.length - 1;
          if (!moveDownBtn.disabled) {
            moveDownBtn.addEventListener("click", () => movePlayer(player.id, 1));
          }
        }

        playersListEl.appendChild(row);
      });
    };

    lifeTrackerClose.addEventListener("click", () => {
      hideLifeTracker({ focusTrigger: true });
    });

    lifeTrackerReset.addEventListener("click", () => {
      resetLifeTracker();
    });

    lifeTrackerOverlay.addEventListener("click", (event) => {
      if (event.target === lifeTrackerOverlay) {
        hideLifeTracker({ focusTrigger: true });
      }
    });

    document.addEventListener("keydown", handleLifeTrackerKeydown, { capture: true });

    const setOwner = (playerId) => {
      players = players.map((player) => {
        if (player.id === playerId) {
          return {
            ...player,
            isOwner: true,
            name: ownerDisplayName,
            deckMode: deckOptions.length > 0 ? player.deckMode : "manual",
            sourceType: googleSub ? "user" : player.sourceType,
            sourceId: googleSub ? `user:${googleSub}` : player.sourceId,
            googleSub: googleSub || player.googleSub,
            linkedGoogleSub: googleSub || player.linkedGoogleSub,
            id: googleSub ? `user:${googleSub}` : player.id,
          };
        }
        return { ...player, isOwner: false };
      });
      renderPlayers();
    };

    const movePlayer = (playerId, delta) => {
      const index = players.findIndex((player) => player.id === playerId);
      if (index === -1) {
        return;
      }
      const newIndex = index + delta;
      if (newIndex < 0 || newIndex >= players.length) {
        return;
      }
      const updated = [...players];
      const [item] = updated.splice(index, 1);
      updated.splice(newIndex, 0, item);
      players = updated;
      renderPlayers();
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
      discardLifeTrackerState();
      setupForm.hidden = false;
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

      if (!normalizeString(playgroupInput.value) && !normalizeString(playgroupSelection.name)) {
        setStatus("Indiquez le groupe associé à la partie.", "error");
        return false;
      }

      setStatus("");
      return true;
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

    const prepareResultCapture = () => {
      if (!validatePlayers()) {
        return;
      }
      latestConfirmedPlayers = players.map(clonePlayer);
      populateResultForm(latestConfirmedPlayers);
      resultForm.hidden = false;
      setStatus("");
      runSoon(() => {
        const firstSelect = resultGrid.querySelector("select");
        if (firstSelect) {
          firstSelect.focus();
        }
      });
      const additionalNames = latestConfirmedPlayers
        .filter((player) => !player.isDefault)
        .map((player) => player.name);
      addKnownPlayers(additionalNames);
    };

    const buildRankingPayload = () => {
      const formData = new FormData(resultForm);
      const rankings = [];
      for (const player of latestConfirmedPlayers) {
        const rawValue = formData.get(`result-${player.id}`);
        const rank = Number.parseInt(rawValue, 10);
        if (!rawValue || !Number.isFinite(rank) || rank < 1 || rank > latestConfirmedPlayers.length) {
          setStatus("Veuillez attribuer un rang à chaque joueur.", "error");
          return null;
        }
        rankings.push({ playerId: player.id, rank });
      }
      return rankings;
    };

    const createDeckLink = (player) => {
      if (!player.deck_id) {
        return null;
      }
      const link = document.createElement("a");
      link.href = `deck.html?deck=${encodeURIComponent(player.deck_id)}`;
      link.className = "game-history-deck";
      link.textContent =
        player.deck_name ||
        (player.deck_format ? `Deck ${player.deck_format.toUpperCase()}` : "Voir le deck");
      return link;
    };

    let gameHistory = [];

    const renderHistory = () => {
      historyList.innerHTML = "";
      if (!Array.isArray(gameHistory) || gameHistory.length === 0) {
        historyEmpty.hidden = false;
        return;
      }
      historyEmpty.hidden = true;

      gameHistory.slice(0, MAX_DASHBOARD_HISTORY).forEach((record) => {
        const entry = document.createElement("li");
        entry.className = "game-history-entry";

        const header = document.createElement("div");
        header.className = "game-history-header";

        const title = document.createElement("span");
        title.className = "game-history-title";
        title.textContent = record.playgroup?.name || "Partie enregistrée";
        header.appendChild(title);

        const meta = document.createElement("span");
        meta.className = "game-history-meta";
        const createdAt = safeToDate(record.created_at);
        if (typeof formatDateTime === "function") {
          meta.textContent = formatDateTime(createdAt || record.created_at, {
            dateStyle: "medium",
            timeStyle: "short",
          });
        } else if (createdAt) {
          meta.textContent = createdAt.toLocaleString("fr-FR");
        }
        header.appendChild(meta);

        const playersList = document.createElement("ul");
        playersList.className = "game-history-players";

        const rankingMap = new Map();
        if (Array.isArray(record.rankings)) {
          record.rankings.forEach((ranking) => {
            if (ranking?.player_id) {
              rankingMap.set(ranking.player_id, Number.parseInt(ranking.rank, 10));
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

          const nameStrong = document.createElement("strong");
          nameStrong.textContent = ` ${player.name || "Joueur inconnu"}`;

          item.append(rankSpan, nameStrong);

          const metaParts = [];
          if (player.is_owner) {
            metaParts.push("Propriétaire");
          }
          if (player.deck_name) {
            metaParts.push(player.deck_name);
          } else if (player.deck_id && player.deck_format) {
            metaParts.push(player.deck_format.toUpperCase());
          }

          if (metaParts.length > 0) {
            const metaSpan = document.createElement("span");
            metaSpan.className = "game-history-player-meta";
            metaSpan.textContent = metaParts.join(" · ");
            item.append(document.createTextNode(" "), metaSpan);
          }

          if (player.deck_id) {
            const deckLink = createDeckLink(player);
            if (deckLink) {
              item.append(document.createTextNode(" · "), deckLink);
            }
          }

          playersList.appendChild(item);
        });

        entry.append(header, playersList);
        historyList.appendChild(entry);
      });
    };

    const loadGameHistory = async () => {
      if (!googleSub) {
        gameHistory = [];
        renderHistory();
        return;
      }
      try {
        const payload = await fetchUserGames(googleSub);
        gameHistory = Array.isArray(payload?.games) ? payload.games : [];
        renderHistory();
      } catch (error) {
        console.warn("Impossible de charger l'historique des parties :", error);
        setStatus("Impossible de charger l'historique des parties.", "error");
      }
    };

    const recordResult = async () => {
      if (!Array.isArray(latestConfirmedPlayers) || latestConfirmedPlayers.length === 0) {
        setStatus("Préparez d'abord la composition de la table.", "error");
        return;
      }

      const rankings = buildRankingPayload();
      if (!rankings) {
        return;
      }

      const playgroupName =
        normalizeString(playgroupInput.value) || normalizeString(playgroupSelection.name);
      if (!playgroupName) {
        setStatus("Indiquez le groupe associé à la partie.", "error");
        return;
      }

      if (!googleSub) {
        setStatus("Connectez-vous pour enregistrer vos parties.", "error");
        return;
      }

      const payload = {
        playgroup: {
          id: playgroupSelection.id,
          name: playgroupName,
        },
        players: latestConfirmedPlayers.map((player, index) => ({
          id: player.id,
          name: player.name,
          is_owner: Boolean(player.isOwner),
          deck_id:
            player.deckMode === "library" || player.deckMode === "linked"
              ? player.deckId || null
              : null,
          deck_name: player.deckName || null,
          deck_format:
            player.deckMode === "library" || player.deckMode === "linked"
              ? player.deckFormat || null
              : null,
          deck_slug:
            player.deckMode === "library" || player.deckMode === "linked"
              ? player.deckSlug || player.deckId || null
              : null,
          order: index,
          player_type: player.sourceType || (player.isOwner ? "user" : "guest"),
          google_sub: player.googleSub || null,
          linked_google_sub: player.linkedGoogleSub || null,
        })),
        rankings: rankings.map((ranking) => ({
          player_id: ranking.playerId,
          rank: ranking.rank,
        })),
      };

      try {
        const record = await recordUserGame(googleSub, payload);
        setStatus("La partie a été enregistrée. Retrouvez-la dans l'onglet Parties.", "success");
        resultForm.hidden = true;
        resultForm.reset();
        resultGrid.innerHTML = "";
        players = createInitialPlayers();
        latestConfirmedPlayers = null;
        renderPlayers();
        addKnownPlayers(payload.players.map((player) => player.name));
        if (record?.playgroup) {
          updatePlaygroupSelection(record.playgroup);
          await loadPlaygroups();
        } else {
          await loadPlaygroups();
        }
        await loadGameHistory();
      } catch (error) {
        setStatus(error?.message || "Impossible d'enregistrer la partie.", "error");
      }
    };

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
        resultForm.hidden = true;
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

    saveResultButton.addEventListener("click", () => {
      prepareResultCapture();
    });

    startGameButton.addEventListener("click", () => {
      const roster = getCurrentRoster();
      const signature = computeRosterSignature(roster);

      if (lifeTrackerState && lifeTrackerState.signature === signature) {
        showLifeTracker();
        return;
      }

      if (!validatePlayers()) {
        return;
      }

      lifeTrackerState = {
        ...createLifeTrackerState(roster),
        signature,
      };
      setStatus("Suivi de vie Commander activé.", "success");
      showLifeTracker();
    });

    cancelResultButton.addEventListener("click", () => {
      resultForm.hidden = true;
      resultForm.reset();
      resultGrid.innerHTML = "";
      setStatus("Enregistrement du résultat annulé.");
    });

    resultForm.addEventListener("submit", (event) => {
      event.preventDefault();
      recordResult();
    });

    await loadPlaygroups();
    await loadAvailablePlayers();
    resetWorkflow({ preserveStatus: true });
    await loadGameHistory();
  });
})();
