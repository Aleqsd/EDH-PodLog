(() => {
  const config = window.EDH_PODLOG?.config ?? null;
  const googleConfig = config?.google ?? {};

  const state = {
    tokenClient: null,
    accessToken: null,
    libraryReady: false,
  };

  const getClientId = () => googleConfig.clientId ?? "";
  const getScopes = () => googleConfig.scopes ?? "openid email profile";
  const getPlaceholder = () => googleConfig.placeholder ?? "REMPLACEZ_MOI_PAR_VOTRE_CLIENT_ID";

  const isClientConfigured = () => {
    const clientId = getClientId();
    if (!clientId) {
      return false;
    }
    if (clientId === getPlaceholder()) {
      return false;
    }
    return !clientId.includes("REMPLACEZ");
  };

  const redirectToLanding = (href = "index.html") => {
    window.location.replace(href);
  };

  const revokeToken = (token) => {
    if (!token) {
      return;
    }
    const google = window.google?.accounts?.oauth2;
    if (google?.revoke) {
      google.revoke(token, () => {});
    }
  };

  const auth = {
    getClientId,
    getScopes,
    getPlaceholder,
    isClientConfigured,
    getTokenClient: () => state.tokenClient,
    setTokenClient(client) {
      state.tokenClient = client;
      return state.tokenClient;
    },
    getAccessToken: () => state.accessToken,
    setAccessToken(token) {
      state.accessToken = token;
      return state.accessToken;
    },
    isLibraryReady: () => state.libraryReady,
    setLibraryReady(value) {
      state.libraryReady = Boolean(value);
      return state.libraryReady;
    },
    redirectToLanding,
    revokeToken,
  };

  window.EDH_PODLOG = window.EDH_PODLOG || {};
  window.EDH_PODLOG.auth = {
    ...(window.EDH_PODLOG.auth || {}),
    ...auth,
  };
})();
