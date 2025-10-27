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

  api.registerPageController("groupes", async (context) => {
    const groupsList = document.getElementById("groupsList");
    const groupsEmpty = document.getElementById("groupsEmpty");

    if (!groupsList || !groupsEmpty) {
      return;
    }

    const session = context.session ?? (typeof getSession === "function" ? getSession() : null);
    const googleSub = session?.googleSub || null;

    let playgroups = [];
    let games = [];

    const loadPlaygroups = async () => {
      if (!googleSub) {
        playgroups = [];
        return;
      }
      try {
        const payload = await fetchUserPlaygroups(googleSub);
        playgroups = Array.isArray(payload?.playgroups) ? payload.playgroups : [];
      } catch (error) {
        console.warn("Impossible de charger les groupes :", error);
        playgroups = [];
      }
    };

    const loadGames = async () => {
      if (!googleSub) {
        games = [];
        return;
      }
      try {
        const payload = await fetchUserGames(googleSub);
        games = Array.isArray(payload?.games) ? payload.games : [];
      } catch (error) {
        console.warn("Impossible de charger les parties :", error);
        games = [];
      }
    };

    const buildRecentGamesList = (entries) => {
      if (!entries.length) {
        return null;
      }
      const list = document.createElement("ul");
      list.className = "group-recent-games";

      entries.slice(0, 3).forEach((game) => {
        const item = document.createElement("li");
        const createdAt = safeToDate(game.created_at);
        const metaParts = [];
        if (typeof formatDateTime === "function") {
          metaParts.push(
            formatDateTime(createdAt || game.created_at, {
              dateStyle: "medium",
              timeStyle: "short",
            })
          );
        } else if (createdAt) {
          metaParts.push(createdAt.toLocaleString("fr-FR"));
        }

        const rankingMap = new Map();
        if (Array.isArray(game.rankings)) {
          game.rankings.forEach((ranking) => {
            if (ranking?.player_id) {
              rankingMap.set(ranking.player_id, Number.parseInt(ranking.rank, 10));
            }
          });
        }

        let winnerName = null;
        if (Array.isArray(game.players)) {
          const winner = game.players.find((player) => rankingMap.get(player.id) === 1);
          winnerName = winner?.name ? normalizeString(winner.name) : null;
        }
        if (winnerName) {
          metaParts.push(`Vainqueur : ${winnerName}`);
        }

        item.textContent = metaParts.join(" – ");
        list.appendChild(item);
      });

      return list;
    };

    const renderGroups = () => {
      groupsList.innerHTML = "";

      if (!Array.isArray(playgroups) || playgroups.length === 0) {
        groupsEmpty.hidden = false;
        return;
      }

      groupsEmpty.hidden = true;

      const gameMap = new Map();
      games.forEach((game) => {
        const playgroupId = game?.playgroup?.id;
        if (!playgroupId) {
          return;
        }
        if (!gameMap.has(playgroupId)) {
          gameMap.set(playgroupId, []);
        }
        gameMap.get(playgroupId).push(game);
      });

      playgroups
        .slice()
        .sort((a, b) => {
          const lastUsedA = safeToDate(a.last_used_at);
          const lastUsedB = safeToDate(b.last_used_at);
          if (lastUsedA && lastUsedB) {
            return lastUsedB - lastUsedA;
          }
          if (lastUsedA) {
            return -1;
          }
          if (lastUsedB) {
            return 1;
          }
          return a.name.localeCompare(b.name, "fr");
        })
        .forEach((group) => {
          const card = document.createElement("li");
          card.className = "group-card";

          const head = document.createElement("div");
          head.className = "group-card-head";

          const title = document.createElement("h2");
          title.textContent = group.name || "Groupe sans nom";
          head.appendChild(title);

          const meta = document.createElement("span");
          meta.className = "group-card-meta";
          const count = typeof group.game_count === "number" ? group.game_count : 0;
          const parts = [`${count} partie${count > 1 ? "s" : ""}`];
          const lastUsedAt = safeToDate(group.last_used_at);
          if (lastUsedAt && typeof formatDateTime === "function") {
            parts.push(`Dernière partie le ${formatDateTime(lastUsedAt, { dateStyle: "medium" })}`);
          }
          meta.textContent = parts.join(" · ");
          head.appendChild(meta);

          card.appendChild(head);

          const groupGames = (gameMap.get(group.id) || [])
            .slice()
            .sort((a, b) => {
              const dateA = safeToDate(a.created_at);
              const dateB = safeToDate(b.created_at);
              if (dateA && dateB) {
                return dateB - dateA;
              }
              if (dateA) {
                return -1;
              }
              if (dateB) {
                return 1;
              }
              return 0;
            });

          const cardBody = document.createElement("div");
          cardBody.className = "group-card-body";
          if (groupGames.length > 0) {
            const latestGame = groupGames[0];
            const createdAt = safeToDate(latestGame.created_at);
            const parts = [];
            if (typeof formatDateTime === "function") {
              parts.push(
                formatDateTime(createdAt || latestGame.created_at, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              );
            }

            const rankingMap = new Map();
            if (Array.isArray(latestGame.rankings)) {
              latestGame.rankings.forEach((ranking) => {
                if (ranking?.player_id) {
                  rankingMap.set(ranking.player_id, Number.parseInt(ranking.rank, 10));
                }
              });
            }

            if (Array.isArray(latestGame.players)) {
              const winner = latestGame.players.find((player) => rankingMap.get(player.id) === 1);
              if (winner?.name) {
                parts.push(`Vainqueur : ${winner.name}`);
              }
            }

            cardBody.textContent = `Dernière partie : ${parts.join(" · ")}`;
          } else {
            cardBody.textContent =
              "Aucune partie enregistrée pour ce groupe pour le moment.";
          }
          card.appendChild(cardBody);

          const recentList = buildRecentGamesList(groupGames);
          if (recentList) {
            card.appendChild(recentList);
          }

          const actions = document.createElement("div");
          actions.className = "group-card-actions";

          const viewLink = document.createElement("a");
          viewLink.className = "secondary-action";
          viewLink.href = `parties.html?playgroup=${encodeURIComponent(group.id)}`;
          viewLink.textContent = "Voir les parties";
          actions.appendChild(viewLink);

          card.appendChild(actions);
          groupsList.appendChild(card);
        });
    };

    await loadPlaygroups();
    await loadGames();
    renderGroups();
  });
})();
