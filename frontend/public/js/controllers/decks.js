(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  api.registerPageController("decks", (context) => {
    deckCollectionEl = document.getElementById("deckCollection");
    deckCollectionEmptyEl = document.getElementById("deckCollectionEmpty");
    deckStatusEl = document.getElementById("deckStatus");
    deckBulkDeleteBtn = document.getElementById("deckBulkDelete");

    if (deckBulkDeleteBtn) {
      deckBulkDeleteBtn.addEventListener("click", handleDeckBulkRemoval);
    }

    if (context.session) {
      refreshDeckCollection(context.session);
      const integration = getMoxfieldIntegration(context.session);
      if (
        integration?.handle &&
        (!Array.isArray(integration.decks) || integration.decks.length === 0)
      ) {
        const loadFromCache = window.EDH_PODLOG?.loadCachedDecksForHandle;
        if (typeof loadFromCache === "function") {
          loadFromCache(integration.handle);
        }
      }
    }
  });
})();
