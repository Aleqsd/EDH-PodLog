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

  const formatDate = (value, options) => {
    if (typeof formatDateTime === "function") {
      return formatDateTime(value, options);
    }
    const date = safeToDate(value);
    return date ? date.toLocaleString("fr-FR") : "";
  };

  api.registerPageController("groupes", async (context) => {
    const groupsListEl = document.getElementById("groupsList");
    const groupsEmptyEl = document.getElementById("groupsEmpty");
    const createPlaygroupButton = document.getElementById("createPlaygroupButton");
    const detailPanel = document.getElementById("groupDetailPanel");
    const detailTitle = document.getElementById("groupDetailTitle");
    const detailMeta = document.getElementById("groupDetailMeta");
    const detailNameInput = document.getElementById("groupDetailNameInput");
    const detailStatus = document.getElementById("groupDetailStatus");
    const membersList = document.getElementById("groupMembersList");
    const memberAddSelect = document.getElementById("groupMemberAddSelect");
    const memberAddButton = document.getElementById("groupMemberAddButton");
    const renameButton = document.getElementById("groupRenameButton");
    const deleteButton = document.getElementById("groupDeleteButton");
    const statsContainer = document.getElementById("groupStatsContainer");
    const recentGamesList = document.getElementById("groupRecentGames");
    const userSearchForm = document.getElementById("userSearchForm");
    const userSearchInput = document.getElementById("userSearchInput");
    const searchResultsContainer = document.getElementById("userSearchResults");
    const publicProfilePreview = document.getElementById("publicProfilePreview");
    const trackedPlayerForm = document.getElementById("trackedPlayerForm");
    const trackedPlayerNameInput = document.getElementById("trackedPlayerNameInput");
    const trackedPlayersList = document.getElementById("trackedPlayersList");

    if (!groupsListEl || !groupsEmptyEl) {
      return;
    }

    const sessionStore = window.EDH_PODLOG?.session ?? {};
    const session =
      context.session ??
      (sessionStore.getCurrent ? sessionStore.getCurrent() : null) ??
      (sessionStore.load ? sessionStore.load() : null);
    const googleSub = session?.googleSub || null;
    if (!googleSub) {
      groupsEmptyEl.hidden = false;
      groupsEmptyEl.textContent = "Connectez-vous pour gérer vos groupes.";
      return;
    }

    const state = {
      playgroups: [],
      playgroupDetails: new Map(),
      selectedGroupId: null,
      availablePlayers: [],
      trackedPlayers: [],
      searchResults: [],
      lastSearchQuery: "",
      publicProfile: null,
    };

    const setDetailStatus = (message, variant = "neutral") => {
      if (!detailStatus) {
        return;
      }
      detailStatus.textContent = message || "";
      detailStatus.classList.remove("is-error", "is-success");
      if (!message) {
        return;
      }
      if (variant === "error") {
        detailStatus.classList.add("is-error");
      } else if (variant === "success") {
        detailStatus.classList.add("is-success");
      }
    };

    const buildMemberPayload = (members) =>
      (Array.isArray(members) ? members : []).map((member) => ({
        player_type: member.player_type,
        player_id: member.player_id || null,
        google_sub: member.google_sub || null,
        name: member.name || null,
      }));

    const loadPlaygroups = async () => {
      try {
        const payload = await fetchUserPlaygroups(googleSub);
        state.playgroups = Array.isArray(payload?.playgroups) ? payload.playgroups : [];
      } catch (error) {
        console.warn("Impossible de charger les groupes :", error);
        state.playgroups = [];
      }
    };

    const loadPlaygroupDetail = async (playgroupId, { force = false } = {}) => {
      if (!playgroupId) {
        return null;
      }
      if (!force && state.playgroupDetails.has(playgroupId)) {
        return state.playgroupDetails.get(playgroupId);
      }
      try {
        const detail = await fetchUserPlaygroupDetail(googleSub, playgroupId);
        if (detail) {
          state.playgroupDetails.set(playgroupId, detail);
          return detail;
        }
      } catch (error) {
        console.warn("Impossible de charger le détail du groupe :", error);
      }
      return null;
    };

    const loadAvailablePlayers = async () => {
      try {
        const payload = await fetchAvailablePlayers(googleSub);
        state.availablePlayers = Array.isArray(payload?.players) ? payload.players : [];
      } catch (error) {
        console.warn("Impossible de charger les joueurs disponibles :", error);
        state.availablePlayers = [];
      }
    };

    const loadTrackedPlayers = async () => {
      try {
        const payload = await fetchTrackedPlayers(googleSub);
        state.trackedPlayers = Array.isArray(payload?.players) ? payload.players : [];
      } catch (error) {
        console.warn("Impossible de charger les joueurs invités :", error);
        state.trackedPlayers = [];
      }
    };

    const selectPlaygroup = async (playgroupId) => {
      state.selectedGroupId = playgroupId || null;
      if (state.selectedGroupId) {
        await loadPlaygroupDetail(state.selectedGroupId);
      }
      renderPlaygroupList();
      renderGroupDetail();
    };

    const renderPlaygroupList = () => {
      groupsListEl.innerHTML = "";

      if (!state.playgroups.length) {
        groupsEmptyEl.hidden = false;
        return;
      }

      groupsEmptyEl.hidden = true;

      const sorted = state.playgroups
        .slice()
        .sort((a, b) => {
          const lastA = safeToDate(a.last_used_at);
          const lastB = safeToDate(b.last_used_at);
          if (lastA && lastB) {
            return lastB - lastA;
          }
          if (lastA) {
            return -1;
          }
          if (lastB) {
            return 1;
          }
          return (a.name || "").localeCompare(b.name || "", "fr", { sensitivity: "base" });
        });

      sorted.forEach((group) => {
        const item = document.createElement("li");
        item.className = "group-card";
        if (group.id === state.selectedGroupId) {
          item.classList.add("is-selected");
        }

        const head = document.createElement("button");
        head.type = "button";
        head.className = "group-card-head";
        head.addEventListener("click", () => selectPlaygroup(group.id));

        const title = document.createElement("h2");
        title.textContent = group.name || "Groupe sans nom";
        head.appendChild(title);

        const meta = document.createElement("span");
        meta.className = "group-card-meta";
        const parts = [];
        const count = typeof group.game_count === "number" ? group.game_count : 0;
        parts.push(`${count} partie${count > 1 ? "s" : ""}`);
        const lastUsedAt = safeToDate(group.last_used_at);
        if (lastUsedAt) {
          parts.push(`Dernière partie : ${formatDate(lastUsedAt, { dateStyle: "medium" })}`);
        }
        meta.textContent = parts.join(" · ");
        head.appendChild(meta);

        item.appendChild(head);
        groupsListEl.appendChild(item);
      });
    };

    const renderMembers = (detail) => {
      if (!membersList) {
        return;
      }
      membersList.innerHTML = "";

      if (!detail?.members?.length) {
        const emptyItem = document.createElement("li");
        emptyItem.className = "group-member-empty";
        emptyItem.textContent =
          "Aucun membre enregistré pour ce groupe. Ajoutez vos joueuses et joueurs suivis.";
        membersList.appendChild(emptyItem);
        return;
      }

      detail.members.forEach((member, index) => {
        const item = document.createElement("li");
        item.className = "group-member-item";

        const name = document.createElement("div");
        name.className = "group-member-name";
        name.textContent = member.name || member.google_sub || "Joueur invité";
        item.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "group-member-meta";
        const labels = [];
        if (member.player_type === "user") {
          labels.push("Compte EDH PodLog");
        } else {
          labels.push("Invité");
        }
        if (member.google_sub && member.google_sub === googleSub) {
          labels.push("Vous");
        }
        meta.textContent = labels.join(" · ");
        item.appendChild(meta);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "icon-button";
        removeBtn.textContent = "✕";
        removeBtn.title = "Retirer du groupe";
        removeBtn.addEventListener("click", async () => {
          const nextMembers = detail.members.slice();
          nextMembers.splice(index, 1);
          try {
            await updateUserPlaygroup(googleSub, detail.id, {
              members: buildMemberPayload(nextMembers),
            });
            detail.members = nextMembers;
            await loadPlaygroups();
            await loadAvailablePlayers();
            renderPlaygroupList();
            renderGroupDetail();
            setDetailStatus("Membre retiré du groupe.", "success");
          } catch (error) {
            console.warn("Impossible de retirer le membre :", error);
            setDetailStatus("Impossible de retirer ce membre.", "error");
          }
        });
        item.appendChild(removeBtn);

        membersList.appendChild(item);
      });
    };

    const renderStats = (detail) => {
      if (!statsContainer) {
        return;
      }
      statsContainer.innerHTML = "";
      if (!detail?.stats) {
        return;
      }

      const total = document.createElement("p");
      total.className = "group-stat-total";
      total.textContent = `${detail.stats.total_games} partie${
        detail.stats.total_games > 1 ? "s" : ""
      } enregistrée${detail.stats.total_games > 1 ? "s" : ""}`;
      statsContainer.appendChild(total);

      if (Array.isArray(detail.stats.player_performance) && detail.stats.player_performance.length) {
        const table = document.createElement("div");
        table.className = "group-stat-table";
        const header = document.createElement("div");
        header.className = "group-stat-row group-stat-row-head";
        header.innerHTML = "<span>Joueur</span><span>Parties</span><span>Victoires</span>";
        table.appendChild(header);

        detail.stats.player_performance.forEach((entry) => {
          const row = document.createElement("div");
          row.className = "group-stat-row";
          const label = entry.name || entry.google_sub || entry.player_id || "Participant";
          row.innerHTML = `
            <span>${label}</span>
            <span>${entry.games_played}</span>
            <span>${entry.wins}</span>
          `;
          table.appendChild(row);
        });
        statsContainer.appendChild(table);
      }
    };

    const renderRecentGames = (detail) => {
      if (!recentGamesList) {
        return;
      }
      recentGamesList.innerHTML = "";

      if (!detail?.recent_games?.length) {
        const empty = document.createElement("li");
        empty.className = "group-recent-empty";
        empty.textContent = "Aucune partie récente pour ce groupe.";
        recentGamesList.appendChild(empty);
        return;
      }

      detail.recent_games.slice(0, 5).forEach((game) => {
        const item = document.createElement("li");
        item.className = "group-recent-item";
        const createdAt = formatDate(game.created_at, {
          dateStyle: "medium",
          timeStyle: "short",
        });

        const rankingMap = new Map();
        if (Array.isArray(game.rankings)) {
          game.rankings.forEach((ranking) => {
            if (ranking?.player_id) {
              rankingMap.set(ranking.player_id, Number.parseInt(ranking.rank, 10));
            }
          });
        }

        let winner = "";
        if (Array.isArray(game.players)) {
          const win = game.players.find((player) => rankingMap.get(player.id) === 1);
          winner = win?.name ? ` · Vainqueur : ${win.name}` : "";
        }

        item.textContent = `${createdAt}${winner}`;
        recentGamesList.appendChild(item);
      });
    };

    const renderMemberAddOptions = (detail) => {
      if (!memberAddSelect) {
        return;
      }
      memberAddSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Sélectionner un joueur";
      memberAddSelect.appendChild(placeholder);

      const existingKeys = new Set(
        (detail?.members || []).map((member) =>
          member.player_type === "user" ? `user:${member.google_sub}` : `guest:${member.player_id}`
        )
      );

      const entries = state.availablePlayers
        .slice()
        .sort((a, b) => (normalizeString(a?.name) || a?.google_sub || "").localeCompare(
          normalizeString(b?.name) || b?.google_sub || "",
          "fr",
          { sensitivity: "base" }
        ));

      entries.forEach((entry) => {
        const key = entry.player_type === "user" ? `user:${entry.google_sub}` : `guest:${entry.id}`;
        if (existingKeys.has(key)) {
          return;
        }
        const option = document.createElement("option");
        option.value = key;
        option.textContent = entry.name || entry.google_sub || "Joueur suivi";
        memberAddSelect.appendChild(option);
      });
    };

    const renderGroupDetail = () => {
      if (!detailPanel || !detailTitle || !detailMeta || !detailNameInput) {
        return;
      }

      if (!state.selectedGroupId) {
        detailPanel.hidden = true;
        return;
      }

      const detail = state.playgroupDetails.get(state.selectedGroupId);
      if (!detail) {
        detailPanel.hidden = true;
        return;
      }

      detailPanel.hidden = false;
      detailTitle.textContent = detail.name || "Groupe sans nom";
      const count = typeof detail.game_count === "number" ? detail.game_count : 0;
      const lastUsed = detail.last_used_at ? formatDate(detail.last_used_at, { dateStyle: "medium" }) : "—";
      detailMeta.textContent = `${count} partie${count > 1 ? "s" : ""} · Dernière activité : ${lastUsed}`;
      detailNameInput.value = detail.name || "";
      setDetailStatus("");

      renderMembers(detail);
      renderMemberAddOptions(detail);
      renderStats(detail);
      renderRecentGames(detail);
    };

    const renderTrackedPlayers = () => {
      if (!trackedPlayersList) {
        return;
      }
      trackedPlayersList.innerHTML = "";

      if (!state.trackedPlayers.length) {
        const empty = document.createElement("p");
        empty.className = "tracked-player-empty";
        empty.textContent = "Aucun joueur invité enregistré pour le moment.";
        trackedPlayersList.appendChild(empty);
        return;
      }

      state.trackedPlayers.forEach((player) => {
        const card = document.createElement("div");
        card.className = "tracked-player-card";

        const header = document.createElement("div");
        header.className = "tracked-player-head";
        const title = document.createElement("strong");
        title.textContent = player.name || "Joueur invité";
        header.appendChild(title);

        if (player.google_sub) {
          const badge = document.createElement("span");
          badge.className = "tracked-player-badge";
          badge.textContent = "Compte lié";
          header.appendChild(badge);
        }

        card.appendChild(header);

        const actions = document.createElement("div");
        actions.className = "tracked-player-actions";

        const linkBtn = document.createElement("button");
        linkBtn.type = "button";
        linkBtn.className = "secondary-action";
        linkBtn.textContent = player.google_sub ? "Mettre à jour le lien" : "Associer à un compte";
        linkBtn.addEventListener("click", async () => {
          const target = window.prompt(
            "Identifiant Google de l'utilisateur à associer (google_sub) :",
            ""
          );
          const normalized = normalizeString(target);
          if (!normalized) {
            return;
          }
          try {
            await linkTrackedPlayer(googleSub, player.id, normalized);
            await loadTrackedPlayers();
            await loadAvailablePlayers();
            if (state.selectedGroupId) {
              await loadPlaygroupDetail(state.selectedGroupId, { force: true });
            }
            renderTrackedPlayers();
            renderMemberAddOptions(state.playgroupDetails.get(state.selectedGroupId));
            setDetailStatus("Joueur invité associé avec succès.", "success");
          } catch (error) {
            console.warn("Impossible de lier le joueur invité :", error);
            setDetailStatus("Impossible de lier ce joueur. Vérifiez l'identifiant saisi.", "error");
          }
        });
        actions.appendChild(linkBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "danger-action";
        deleteBtn.textContent = "Supprimer";
        deleteBtn.addEventListener("click", async () => {
          if (!window.confirm("Supprimer ce joueur invité ?")) {
            return;
          }
          try {
            await deleteTrackedPlayer(googleSub, player.id);
            await loadTrackedPlayers();
            await loadAvailablePlayers();
            renderTrackedPlayers();
            if (state.selectedGroupId) {
              renderMemberAddOptions(state.playgroupDetails.get(state.selectedGroupId));
            }
          } catch (error) {
            console.warn("Impossible de supprimer le joueur invité :", error);
            setDetailStatus("Impossible de supprimer ce joueur invité.", "error");
          }
        });
        actions.appendChild(deleteBtn);

        card.appendChild(actions);
        trackedPlayersList.appendChild(card);
      });
    };

    const renderSearchResults = () => {
      if (!searchResultsContainer) {
        return;
      }
      searchResultsContainer.innerHTML = "";

      if (!state.searchResults.length) {
        if (state.lastSearchQuery) {
          const empty = document.createElement("p");
          empty.className = "group-search-empty";
          empty.textContent = "Aucun profil public correspondant à votre recherche.";
          searchResultsContainer.appendChild(empty);
        }
        return;
      }

      state.searchResults.forEach((result) => {
        const card = document.createElement("article");
        card.className = "group-search-card";

        const head = document.createElement("header");
        head.className = "group-search-card-head";
        const title = document.createElement("h3");
        title.textContent = result.display_name || result.google_sub;
        head.appendChild(title);

        const followButton = document.createElement("button");
        followButton.type = "button";
        followButton.className = result.is_followed ? "secondary-action" : "primary-action";
        followButton.textContent = result.is_followed ? "Ne plus suivre" : "Suivre";
        followButton.addEventListener("click", async () => {
          try {
            if (result.is_followed) {
              await unfollowUserAccount(googleSub, result.google_sub);
            } else {
              await followUserAccount(googleSub, result.google_sub);
            }
            result.is_followed = !result.is_followed;
            await loadAvailablePlayers();
            renderMemberAddOptions(state.playgroupDetails.get(state.selectedGroupId));
            renderSearchResults();
          } catch (error) {
            console.warn("Impossible de mettre à jour le suivi :", error);
          }
        });
        head.appendChild(followButton);
        card.appendChild(head);

        if (result.description) {
          const desc = document.createElement("p");
          desc.className = "group-search-description";
          desc.textContent = result.description;
          card.appendChild(desc);
        }

        const actions = document.createElement("div");
        actions.className = "group-search-actions";

        const viewProfile = document.createElement("button");
        viewProfile.type = "button";
        viewProfile.className = "secondary-action";
        viewProfile.textContent = "Voir le profil";
        viewProfile.addEventListener("click", async () => {
          try {
            const profile = await fetchPublicUserProfile(result.google_sub);
            state.publicProfile = profile;
            renderPublicProfile();
          } catch (error) {
            console.warn("Impossible de charger le profil public :", error);
            state.publicProfile = null;
            renderPublicProfile();
          }
        });
        actions.appendChild(viewProfile);

        if (state.selectedGroupId) {
          const addBtn = document.createElement("button");
          addBtn.type = "button";
          addBtn.className = "secondary-action";
          addBtn.textContent = "Ajouter au groupe";
          addBtn.addEventListener("click", async () => {
            const detail = state.playgroupDetails.get(state.selectedGroupId);
            if (!detail) {
              return;
            }
            const key = `user:${result.google_sub}`;
            const alreadyMember = detail.members?.some((member) =>
              member.player_type === "user" && member.google_sub === result.google_sub
            );
            if (alreadyMember) {
              setDetailStatus("Ce joueur fait déjà partie du groupe.", "error");
              return;
            }

            const nextMembers = [...(detail.members || [])];
            nextMembers.push({
              player_type: "user",
              google_sub: result.google_sub,
              name: result.display_name || result.google_sub,
            });
            try {
              await updateUserPlaygroup(googleSub, detail.id, {
                members: buildMemberPayload(nextMembers),
              });
              detail.members = nextMembers;
              await loadAvailablePlayers();
              renderGroupDetail();
              setDetailStatus("Joueur ajouté au groupe.", "success");
            } catch (error) {
              console.warn("Impossible d'ajouter le membre via la recherche :", error);
              setDetailStatus("Impossible d'ajouter ce joueur au groupe.", "error");
            }
          });
          actions.appendChild(addBtn);
        }

        card.appendChild(actions);
        searchResultsContainer.appendChild(card);
      });
    };

    const renderPublicProfile = () => {
      if (!publicProfilePreview) {
        return;
      }
      publicProfilePreview.innerHTML = "";

      if (!state.publicProfile) {
        publicProfilePreview.hidden = true;
        return;
      }

      publicProfilePreview.hidden = false;
      const profile = state.publicProfile;

      const title = document.createElement("h3");
      title.textContent = profile.display_name || profile.google_sub;
      publicProfilePreview.appendChild(title);

      if (profile.description) {
        const desc = document.createElement("p");
        desc.textContent = profile.description;
        publicProfilePreview.appendChild(desc);
      }

      if (Array.isArray(profile.moxfield_decks) && profile.moxfield_decks.length) {
        const decksTitle = document.createElement("h4");
        decksTitle.textContent = "Decks publics";
        publicProfilePreview.appendChild(decksTitle);

        const deckList = document.createElement("ul");
        deckList.className = "group-public-deck-list";
        profile.moxfield_decks.slice(0, 6).forEach((deck) => {
          const item = document.createElement("li");
          const label = deck.name || deck.public_id || "Deck";
          const format = deck.format ? ` · ${deck.format.toUpperCase()}` : "";
          item.textContent = `${label}${format}`;
          deckList.appendChild(item);
        });
        publicProfilePreview.appendChild(deckList);
      }

      if (Array.isArray(profile.recent_games) && profile.recent_games.length) {
        const gamesTitle = document.createElement("h4");
        gamesTitle.textContent = "Parties récentes";
        publicProfilePreview.appendChild(gamesTitle);

        const list = document.createElement("ul");
        list.className = "group-public-games";
        profile.recent_games.forEach((entry) => {
          const item = document.createElement("li");
          item.textContent = `${formatDate(entry.created_at, {
            dateStyle: "medium",
            timeStyle: "short",
          })}${entry.winner ? ` · Vainqueur : ${entry.winner}` : ""}`;
          list.appendChild(item);
        });
        publicProfilePreview.appendChild(list);
      }
    };

    const handleCreatePlaygroup = async () => {
      const name = window.prompt("Nom du nouveau groupe :", "Groupe de jeu");
      const trimmed = normalizeString(name);
      if (!trimmed) {
        return;
      }
      try {
        const created = await upsertUserPlaygroup(googleSub, trimmed);
        await loadPlaygroups();
        renderPlaygroupList();
        if (created?.id) {
          await selectPlaygroup(created.id);
        }
      } catch (error) {
        console.warn("Impossible de créer le groupe :", error);
        setDetailStatus("Impossible de créer un nouveau groupe.", "error");
      }
    };

    const handleRenamePlaygroup = async () => {
      const detail = state.playgroupDetails.get(state.selectedGroupId);
      if (!detail) {
        return;
      }
      const newName = normalizeString(detailNameInput.value);
      if (!newName) {
        setDetailStatus("Le nom du groupe ne peut pas être vide.", "error");
        return;
      }
      try {
        await updateUserPlaygroup(googleSub, detail.id, { name: newName });
        await loadPlaygroups();
        await loadPlaygroupDetail(detail.id, { force: true });
        renderPlaygroupList();
        renderGroupDetail();
        setDetailStatus("Nom du groupe mis à jour.", "success");
      } catch (error) {
        console.warn("Impossible de renommer le groupe :", error);
        setDetailStatus("Impossible de renommer le groupe.", "error");
      }
    };

    const handleDeletePlaygroup = async () => {
      const detail = state.playgroupDetails.get(state.selectedGroupId);
      if (!detail) {
        return;
      }
      if (!window.confirm("Supprimer ce groupe et ses statistiques ?")) {
        return;
      }
      try {
        await deleteUserPlaygroup(googleSub, detail.id);
        state.playgroupDetails.delete(detail.id);
        await loadPlaygroups();
        state.selectedGroupId = null;
        renderPlaygroupList();
        renderGroupDetail();
      } catch (error) {
        console.warn("Impossible de supprimer le groupe :", error);
        setDetailStatus("Impossible de supprimer ce groupe.", "error");
      }
    };

    const handleAddMember = async () => {
      const detail = state.playgroupDetails.get(state.selectedGroupId);
      if (!detail || !memberAddSelect) {
        return;
      }
      const value = memberAddSelect.value;
      if (!value) {
        return;
      }
      const [type, identifier] = value.split(":");
      const nextMembers = [...(detail.members || [])];

      if (type === "user") {
        const already = nextMembers.some((member) => member.player_type === "user" && member.google_sub === identifier);
        if (already) {
          setDetailStatus("Ce joueur fait déjà partie du groupe.", "error");
          return;
        }
        const source = state.availablePlayers.find((entry) => entry.google_sub === identifier);
        nextMembers.push({
          player_type: "user",
          google_sub: identifier,
          name: source?.name || identifier,
        });
      } else {
        const already = nextMembers.some((member) => member.player_type === "guest" && member.player_id === identifier);
        if (already) {
          setDetailStatus("Ce joueur invité est déjà membre.", "error");
          return;
        }
        const source = state.availablePlayers.find((entry) => entry.id === identifier);
        nextMembers.push({
          player_type: "guest",
          player_id: identifier,
          name: source?.name || "Joueur invité",
        });
      }

      try {
        await updateUserPlaygroup(googleSub, detail.id, {
          members: buildMemberPayload(nextMembers),
        });
        detail.members = nextMembers;
        await loadAvailablePlayers();
        renderGroupDetail();
        setDetailStatus("Membre ajouté au groupe.", "success");
        memberAddSelect.value = "";
      } catch (error) {
        console.warn("Impossible d'ajouter un membre :", error);
        setDetailStatus("Impossible d'ajouter ce membre.", "error");
      }
    };

    const handleSearchSubmit = async (event) => {
      event.preventDefault();
      const query = normalizeString(userSearchInput?.value || "");
      state.lastSearchQuery = query;
      if (!query) {
        state.searchResults = [];
        renderSearchResults();
        return;
      }
      try {
        const results = await searchPublicUsers({ query, viewer: googleSub });
        state.searchResults = results;
        renderSearchResults();
      } catch (error) {
        console.warn("Impossible d'effectuer la recherche :", error);
        state.searchResults = [];
        renderSearchResults();
      }
    };

    const handleTrackedPlayerSubmit = async (event) => {
      event.preventDefault();
      const name = normalizeString(trackedPlayerNameInput?.value || "");
      if (!name) {
        return;
      }
      try {
        await createTrackedPlayer(googleSub, name);
        trackedPlayerNameInput.value = "";
        await loadTrackedPlayers();
        await loadAvailablePlayers();
        renderTrackedPlayers();
        if (state.selectedGroupId) {
          renderMemberAddOptions(state.playgroupDetails.get(state.selectedGroupId));
        }
      } catch (error) {
        console.warn("Impossible de créer le joueur invité :", error);
      }
    };

    if (createPlaygroupButton) {
      createPlaygroupButton.addEventListener("click", handleCreatePlaygroup);
    }
    if (renameButton) {
      renameButton.addEventListener("click", handleRenamePlaygroup);
    }
    if (deleteButton) {
      deleteButton.addEventListener("click", handleDeletePlaygroup);
    }
    if (memberAddButton) {
      memberAddButton.addEventListener("click", handleAddMember);
    }
    if (userSearchForm) {
      userSearchForm.addEventListener("submit", handleSearchSubmit);
    }
    if (trackedPlayerForm) {
      trackedPlayerForm.addEventListener("submit", handleTrackedPlayerSubmit);
    }

    await loadPlaygroups();
    await loadAvailablePlayers();
    await loadTrackedPlayers();

    renderPlaygroupList();
    renderTrackedPlayers();
    selectPlaygroup(state.playgroups[0]?.id || null);
  });
})();
