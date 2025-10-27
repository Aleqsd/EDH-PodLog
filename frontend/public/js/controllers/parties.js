(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");
  const safeToDate = (value) => {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const formatRankLabel = (rank) => (rank === 1 ? "1er" : `${rank}e`);

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

  api.registerPageController("parties", async (context) => {
    const historyList = document.getElementById("partiesHistoryList");
    const historyEmpty = document.getElementById("partiesHistoryEmpty");
    const filterSelect = document.getElementById("gamesPlaygroupFilter");

    if (!historyList || !historyEmpty || !filterSelect) {
      return;
    }

    const session = context.session ?? (typeof getSession === "function" ? getSession() : null);
    const googleSub = session?.googleSub || null;

    const searchParams = new URLSearchParams(window.location.search);
    let selectedPlaygroupId = searchParams.get("playgroup") || "";

    let playgroups = [];
    let games = [];

    const renderFilterOptions = () => {
      const previousValue = filterSelect.value;
      filterSelect.innerHTML = "";

      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "Tous les groupes";
      filterSelect.appendChild(allOption);

      playgroups
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "fr"))
        .forEach((group) => {
          const option = document.createElement("option");
          option.value = group.id;
          const count = typeof group.game_count === "number" ? group.game_count : null;
          option.textContent = count !== null ? `${group.name} (${count})` : group.name;
          filterSelect.appendChild(option);
        });

      if (selectedPlaygroupId && !playgroups.some((group) => group.id === selectedPlaygroupId)) {
        selectedPlaygroupId = "";
      }

      filterSelect.value = selectedPlaygroupId || previousValue || "";
    };

    const renderGames = () => {
      historyList.innerHTML = "";
      if (!Array.isArray(games) || games.length === 0) {
        historyEmpty.hidden = false;
        return;
      }

      historyEmpty.hidden = true;

      games.forEach((record) => {
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
            dateStyle: "full",
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

    const loadPlaygroups = async () => {
      if (!googleSub) {
        playgroups = [];
        renderFilterOptions();
        return;
      }
      try {
        const payload = await fetchUserPlaygroups(googleSub);
        playgroups = Array.isArray(payload?.playgroups) ? payload.playgroups : [];
      } catch (error) {
        console.warn("Impossible de charger les groupes :", error);
        playgroups = [];
      }
      renderFilterOptions();
    };

    const loadGames = async (playgroupId) => {
      if (!googleSub) {
        games = [];
        renderGames();
        return;
      }
      try {
        const payload = await fetchUserGames(googleSub, {
          playgroupId: playgroupId || undefined,
        });
        games = Array.isArray(payload?.games) ? payload.games : [];
        renderGames();
      } catch (error) {
        console.warn("Impossible de charger les parties :", error);
        games = [];
        renderGames();
      }
    };

    filterSelect.addEventListener("change", () => {
      selectedPlaygroupId = filterSelect.value || "";
      const params = new URLSearchParams(window.location.search);
      if (selectedPlaygroupId) {
        params.set("playgroup", selectedPlaygroupId);
      } else {
        params.delete("playgroup");
      }
      const nextUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, "", nextUrl.endsWith("?") ? nextUrl.slice(0, -1) : nextUrl);
      loadGames(selectedPlaygroupId);
    });

    await loadPlaygroups();
    await loadGames(selectedPlaygroupId);
  });
})();
