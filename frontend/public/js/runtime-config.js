(() => {
  const rawConfig = window.EDH_PODLOG_CONFIG ?? {};

  const buildApiBaseUrl = () => {
    const base = rawConfig.API_BASE_URL || "http://localhost:4310";
    return base.endsWith("/") ? base.replace(/\/+$/, "") : base;
  };

  const storageKeys = {
    session: "edhPodlogSession",
    lastDeckSelection: "edhPodlogLastDeckSelection",
    lastCardSelection: "edhPodlogLastCardSelection",
    deckEvaluations: "edhPodlogDeckEvaluations",
    deckLayout: "edhPodlogDeckDisplayMode",
  };

  const appVersion = (() => {
    const value = rawConfig.APP_VERSION;
    return typeof value === "string" ? value.trim() : "";
  })();

  const revisionMessage = (() => {
    const value = rawConfig.APP_REVISION_MESSAGE;
    return typeof value === "string" ? value.trim() : "";
  })();

  window.EDH_PODLOG = window.EDH_PODLOG || {};
  window.EDH_PODLOG.config = {
    raw: rawConfig,
    storageKeys,
    google: {
      clientId: rawConfig.GOOGLE_CLIENT_ID ?? "",
      placeholder: "REMPLACEZ_MOI_PAR_VOTRE_CLIENT_ID",
      scopes: "openid email profile",
    },
    api: {
      baseUrl: buildApiBaseUrl(),
      buildUrl(path = "") {
        if (!path) {
          return this.baseUrl;
        }
        const normalized = path.startsWith("/") ? path : `/${path}`;
        return `${this.baseUrl}${normalized}`;
      },
    },
    revision: {
      short: rawConfig.APP_REVISION ?? "",
      full: rawConfig.APP_REVISION_FULL ?? "",
      message: revisionMessage,
      dateRaw: rawConfig.APP_REVISION_DATE ?? "",
    },
    version: appVersion,
    intl: {
      number: new Intl.NumberFormat("fr-FR"),
    },
  };
})();
