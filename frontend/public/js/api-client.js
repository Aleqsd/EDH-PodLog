(() => {
  const config = window.EDH_PODLOG?.config ?? null;
  if (!config) {
    console.warn("EDH PodLog runtime config unavailable; API client not initialised.");
    return;
  }

  const buildUrl = (path) => config.api.buildUrl(path);

  const toISOStringIfValid = (value) => {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  };

  const endpoints = {
    profile(googleSub) {
      if (!googleSub) {
        return null;
      }
      return buildUrl(`/profiles/${encodeURIComponent(googleSub)}`);
    },
    playgroups(googleSub) {
      if (!googleSub) {
        return null;
      }
      return buildUrl(`/profiles/${encodeURIComponent(googleSub)}/playgroups`);
    },
    playgroupDetail(googleSub, playgroupId) {
      if (!googleSub || !playgroupId) {
        return null;
      }
      return buildUrl(
        `/profiles/${encodeURIComponent(googleSub)}/playgroups/${encodeURIComponent(playgroupId)}`
      );
    },
    players(googleSub) {
      if (!googleSub) {
        return null;
      }
      return buildUrl(`/profiles/${encodeURIComponent(googleSub)}/players`);
    },
    availablePlayers(googleSub) {
      const base = this.players(googleSub);
      return base ? `${base}/available` : null;
    },
    trackedPlayer(googleSub, playerId) {
      if (!googleSub || !playerId) {
        return null;
      }
      return buildUrl(
        `/profiles/${encodeURIComponent(googleSub)}/players/${encodeURIComponent(playerId)}`
      );
    },
    trackedPlayerLink(googleSub, playerId) {
      const base = this.trackedPlayer(googleSub, playerId);
      return base ? `${base}/link` : null;
    },
    games(googleSub) {
      if (!googleSub) {
        return null;
      }
      return buildUrl(`/profiles/${encodeURIComponent(googleSub)}/games`);
    },
    socialSearch() {
      return buildUrl("/social/users/search");
    },
    publicProfile(googleSub) {
      if (!googleSub) {
        return null;
      }
      return buildUrl(`/social/users/${encodeURIComponent(googleSub)}`);
    },
    follow(followerSub) {
      if (!followerSub) {
        return null;
      }
      return buildUrl(`/social/users/${encodeURIComponent(followerSub)}/follow`);
    },
    deckPersonalizations(googleSub) {
      if (!googleSub) {
        return null;
      }
      return buildUrl(
        `/profiles/${encodeURIComponent(googleSub)}/deck-personalizations`
      );
    },
    deckPersonalizationDetail(googleSub, deckId) {
      if (!googleSub || !deckId) {
        return null;
      }
      return buildUrl(
        `/profiles/${encodeURIComponent(googleSub)}/deck-personalizations/${encodeURIComponent(deckId)}`
      );
    },
  };

  const fetchBackendProfile = async (googleSub) => {
    const endpoint = endpoints.profile(googleSub);
    if (!endpoint) {
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Profil introuvable (${response.status})`);
      }

      return response.json();
    } catch (error) {
      console.warn("Impossible de récupérer le profil depuis le backend :", error);
      throw error;
    }
  };

  const upsertBackendProfile = async (googleSub, payload) => {
    const endpoint = endpoints.profile(googleSub);
    if (!endpoint || !payload || typeof payload !== "object") {
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Enregistrement du profil refusé (${response.status})`);
      }

      return response.json();
    } catch (error) {
      console.warn("Impossible d'enregistrer le profil utilisateur :", error);
      throw error;
    }
  };

  const fetchUserPlaygroups = async (googleSub) => {
    const endpoint = endpoints.playgroups(googleSub);
    if (!endpoint) {
      return { playgroups: [] };
    }

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Impossible de récupérer les groupes (${response.status}).`);
      }
      const payload = await response.json();
      if (!payload || typeof payload !== "object") {
        return { playgroups: [] };
      }
      return {
        playgroups: Array.isArray(payload.playgroups) ? payload.playgroups : [],
      };
    } catch (error) {
      console.warn("Échec de récupération des groupes :", error);
      throw error;
    }
  };

  const fetchUserPlaygroupDetail = async (googleSub, playgroupId) => {
    const endpoint = endpoints.playgroupDetail(googleSub, playgroupId);
    if (!endpoint) {
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Impossible de récupérer le groupe (${response.status}).`);
      }
      return response.json();
    } catch (error) {
      console.warn("Échec de récupération du détail du groupe :", error);
      throw error;
    }
  };

  const upsertUserPlaygroup = async (googleSub, name) => {
    const endpoint = endpoints.playgroups(googleSub);
    if (!endpoint) {
      return null;
    }
    const payload = { name };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Impossible d'enregistrer le groupe (${response.status}).`);
      }
      return response.json();
    } catch (error) {
      console.warn("Échec de l'enregistrement du groupe :", error);
      throw error;
    }
  };

  const updateUserPlaygroup = async (googleSub, playgroupId, payload) => {
    const endpoint = endpoints.playgroupDetail(googleSub, playgroupId);
    if (!endpoint) {
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });
      if (response.status === 404) {
        throw new Error("Groupe introuvable");
      }
      if (!response.ok) {
        throw new Error(`Impossible de mettre à jour le groupe (${response.status}).`);
      }
      return response.json();
    } catch (error) {
      console.warn("Échec de la mise à jour du groupe :", error);
      throw error;
    }
  };

  const deleteUserPlaygroup = async (googleSub, playgroupId) => {
    const endpoint = endpoints.playgroupDetail(googleSub, playgroupId);
    if (!endpoint) {
      return false;
    }

    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
      });
      if (response.status === 404) {
        throw new Error("Groupe introuvable");
      }
      if (!response.ok) {
        throw new Error(`Impossible de supprimer le groupe (${response.status}).`);
      }
      return true;
    } catch (error) {
      console.warn("Échec de la suppression du groupe :", error);
      throw error;
    }
  };

  const fetchUserGames = async (googleSub, { playgroupId } = {}) => {
    const endpoint = endpoints.games(googleSub);
    if (!endpoint) {
      return { games: [] };
    }
    let url = endpoint;
    if (playgroupId) {
      const params = new URLSearchParams({ playgroup_id: playgroupId });
      url = `${endpoint}?${params}`;
    }

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Impossible de récupérer les parties (${response.status}).`);
      }
      const payload = await response.json();
      if (!payload || typeof payload !== "object") {
        return { games: [] };
      }
      return {
        games: Array.isArray(payload.games) ? payload.games : [],
      };
    } catch (error) {
      console.warn("Échec de récupération des parties :", error);
      throw error;
    }
  };

  const recordUserGame = async (googleSub, payload) => {
    const endpoint = endpoints.games(googleSub);
    if (!endpoint || !payload || typeof payload !== "object") {
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message =
          errorBody?.detail ||
          `Impossible d'enregistrer la partie (${response.status}).`;
        throw new Error(message);
      }
      return response.json();
    } catch (error) {
      console.warn("Échec de l'enregistrement de la partie :", error);
      throw error;
    }
  };

  const fetchAvailablePlayers = async (googleSub) => {
    const endpoint = endpoints.availablePlayers(googleSub);
    if (!endpoint) {
      return { players: [] };
    }

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Impossible de récupérer les joueurs (${response.status}).`);
      }
      const payload = await response.json();
      return {
        players: Array.isArray(payload?.players) ? payload.players : [],
      };
    } catch (error) {
      console.warn("Échec de récupération des joueurs disponibles :", error);
      throw error;
    }
  };

  const fetchTrackedPlayers = async (googleSub) => {
    const endpoint = endpoints.players(googleSub);
    if (!endpoint) {
      return { players: [] };
    }

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Impossible de récupérer les joueurs suivis (${response.status}).`);
      }
      const payload = await response.json();
      return {
        players: Array.isArray(payload?.players) ? payload.players : [],
      };
    } catch (error) {
      console.warn("Échec de récupération des joueurs suivis :", error);
      throw error;
    }
  };

  const createTrackedPlayer = async (googleSub, name) => {
    const endpoint = endpoints.players(googleSub);
    if (!endpoint) {
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        throw new Error(`Création du joueur impossible (${response.status}).`);
      }
      return response.json();
    } catch (error) {
      console.warn("Échec de création d'un joueur suivi :", error);
      throw error;
    }
  };

  const updateTrackedPlayer = async (googleSub, playerId, payload) => {
    const endpoint = endpoints.trackedPlayer(googleSub, playerId);
    if (!endpoint) {
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });
      if (response.status === 404) {
        throw new Error("Joueur introuvable");
      }
      if (!response.ok) {
        throw new Error(`Impossible de mettre à jour le joueur (${response.status}).`);
      }
      return response.json();
    } catch (error) {
      console.warn("Échec de mise à jour du joueur suivi :", error);
      throw error;
    }
  };

  const deleteTrackedPlayer = async (googleSub, playerId) => {
    const endpoint = endpoints.trackedPlayer(googleSub, playerId);
    if (!endpoint) {
      return false;
    }

    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
      });
      if (response.status === 404) {
        throw new Error("Joueur introuvable");
      }
      if (!response.ok) {
        throw new Error(`Impossible de supprimer le joueur (${response.status}).`);
      }
      return true;
    } catch (error) {
      console.warn("Échec de suppression du joueur suivi :", error);
      throw error;
    }
  };

  const linkTrackedPlayer = async (googleSub, playerId, targetSub) => {
    const endpoint = endpoints.trackedPlayerLink(googleSub, playerId);
    if (!endpoint) {
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ google_sub: targetSub }),
      });
      if (response.status === 404) {
        throw new Error("Joueur introuvable");
      }
      if (!response.ok) {
        throw new Error(`Impossible de lier le joueur (${response.status}).`);
      }
      return response.json();
    } catch (error) {
      console.warn("Échec du rattachement du joueur :", error);
      throw error;
    }
  };

  const searchPublicUsers = async ({ query, viewer }) => {
    const endpoint = endpoints.socialSearch();
    if (!endpoint) {
      return [];
    }

    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    if (viewer) {
      params.set("viewer", viewer);
    }

    const url = params.toString() ? `${endpoint}?${params}` : endpoint;

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Recherche impossible (${response.status}).`);
      }
      const payload = await response.json();
      return Array.isArray(payload?.results) ? payload.results : [];
    } catch (error) {
      console.warn("Échec de la recherche d'utilisateurs :", error);
      throw error;
    }
  };

  const fetchPublicUserProfile = async (googleSub) => {
    const endpoint = endpoints.publicProfile(googleSub);
    if (!endpoint) {
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Impossible de récupérer le profil public (${response.status}).`);
      }
      return response.json();
    } catch (error) {
      console.warn("Échec de chargement du profil public :", error);
      throw error;
    }
  };

  const followUserAccount = async (followerSub, targetSub) => {
    const endpoint = endpoints.follow(followerSub);
    if (!endpoint || !targetSub) {
      return false;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target_sub: targetSub }),
      });
      if (!response.ok) {
        throw new Error(`Impossible de suivre cet utilisateur (${response.status}).`);
      }
      return true;
    } catch (error) {
      console.warn("Échec du suivi d'utilisateur :", error);
      throw error;
    }
  };

  const unfollowUserAccount = async (followerSub, targetSub) => {
    const endpoint = endpoints.follow(followerSub);
    if (!endpoint || !targetSub) {
      return false;
    }

    const url = `${endpoint}/${encodeURIComponent(targetSub)}`;

    try {
      const response = await fetch(url, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Impossible de se désabonner (${response.status}).`);
      }
      return true;
    } catch (error) {
      console.warn("Échec de la désinscription d'un suivi :", error);
      throw error;
    }
  };

  const buildDeckPersonalizationsEndpoint = (googleSub) =>
    endpoints.deckPersonalizations(googleSub);

  const buildDeckPersonalizationDetailEndpoint = (googleSub, deckId) =>
    endpoints.deckPersonalizationDetail(googleSub, deckId);

  const upsertDeckPersonalizationRemote = async (googleSub, deckId, payload) => {
    const endpoint = buildDeckPersonalizationDetailEndpoint(googleSub, deckId);
    if (!endpoint) {
      return payload;
    }

    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });
      if (response.status === 404) {
        throw new Error("Deck introuvable");
      }
      if (!response.ok) {
        throw new Error(`Impossible d'enregistrer la personnalisation (${response.status}).`);
      }
      return response.json();
    } catch (error) {
      console.warn("Impossible d'enregistrer la personnalisation distante :", error);
      throw error;
    }
  };

  const fetchDeckPersonalizationsFromBackend = async (googleSub) => {
    const endpoint = buildDeckPersonalizationsEndpoint(googleSub);
    if (!endpoint) {
      return [];
    }

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(
          `Impossible de charger les personnalisations de deck (${response.status}).`
        );
      }
      const payload = await response.json();
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      return entries;
    } catch (error) {
      console.warn("Impossible de récupérer les personnalisations de deck :", error);
      throw error;
    }
  };

  const api = {
    buildUrl,
    toISOStringIfValid,
    endpoints,
    fetchBackendProfile,
    upsertBackendProfile,
    fetchUserPlaygroups,
    fetchUserPlaygroupDetail,
    upsertUserPlaygroup,
    updateUserPlaygroup,
    deleteUserPlaygroup,
    fetchUserGames,
    recordUserGame,
    fetchAvailablePlayers,
    fetchTrackedPlayers,
    createTrackedPlayer,
    updateTrackedPlayer,
    deleteTrackedPlayer,
    linkTrackedPlayer,
    searchPublicUsers,
    fetchPublicUserProfile,
    followUserAccount,
    unfollowUserAccount,
    deckPersonalizations: {
      list: fetchDeckPersonalizationsFromBackend,
      upsert: upsertDeckPersonalizationRemote,
      endpoints: {
        list: buildDeckPersonalizationsEndpoint,
        detail: buildDeckPersonalizationDetailEndpoint,
      },
    },
  };

  window.EDH_PODLOG = window.EDH_PODLOG || {};
  window.EDH_PODLOG.api = {
    ...(window.EDH_PODLOG.api || {}),
    ...api,
  };
})();
