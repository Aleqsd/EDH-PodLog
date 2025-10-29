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
    const deckDisplayStandard = document.getElementById("deckDisplayStandard");
    const deckDisplayBracket = document.getElementById("deckDisplayBracket");
    const deckSortSelect = document.getElementById("deckSortSelect");
    const deckSearchInput = document.getElementById("deckSearchInput");
    const deckResetFiltersBtn = document.getElementById("deckResetFilters");
    const deckColorFiltersContainer = document.getElementById("deckColorFilters");
    const deckBracketFiltersContainer = document.getElementById("deckBracketFilters");

    const readCheckedValues = (root) =>
      Array.from(root?.querySelectorAll?.('input[type="checkbox"]:checked') ?? []).map(
        (input) => input.value
      );

    const getEffectiveSession = () =>
      context.session ?? (typeof getSession === "function" ? getSession() : null);

    const refreshWithSession = () => {
      refreshDeckCollection(getEffectiveSession());
    };

    if (deckBulkDeleteBtn) {
      deckBulkDeleteBtn.addEventListener("click", handleDeckBulkRemoval);
    }

    const existingState =
      typeof getDeckCollectionState === "function" ? getDeckCollectionState() : null;

    if (existingState) {
      if (deckDisplayStandard && deckDisplayBracket) {
        if (existingState.displayMode === "bracket") {
          deckDisplayBracket.checked = true;
          deckDisplayStandard.checked = false;
        } else {
          deckDisplayStandard.checked = true;
          deckDisplayBracket.checked = false;
        }
      }
      if (deckSortSelect) {
        deckSortSelect.value = existingState.sort ?? deckSortSelect.value;
      }
      if (deckSearchInput) {
        deckSearchInput.value = existingState.search ?? "";
      }
      if (deckColorFiltersContainer) {
        const selectedColors = new Set(existingState.colorFilters ?? []);
        deckColorFiltersContainer
          .querySelectorAll('input[type="checkbox"]')
          .forEach((input) => {
            input.checked = selectedColors.has(input.value);
          });
      }
      if (deckBracketFiltersContainer) {
        const selectedBrackets = new Set(existingState.bracketFilters ?? []);
        deckBracketFiltersContainer
          .querySelectorAll('input[type="checkbox"]')
          .forEach((input) => {
            input.checked = selectedBrackets.has(input.value);
          });
      }
    }

    if (typeof setDeckCollectionDisplayMode === "function") {
      if (deckDisplayBracket?.checked) {
        setDeckCollectionDisplayMode("bracket");
      } else {
        setDeckCollectionDisplayMode("standard");
      }
    }
    if (typeof setDeckCollectionSortMode === "function") {
      setDeckCollectionSortMode(deckSortSelect?.value ?? "updated-desc");
    }
    if (typeof setDeckCollectionSearchQuery === "function") {
      setDeckCollectionSearchQuery(deckSearchInput?.value ?? "");
    }
    if (typeof setDeckCollectionColorFilters === "function") {
      setDeckCollectionColorFilters(readCheckedValues(deckColorFiltersContainer));
    }
    if (typeof setDeckCollectionBracketFilters === "function") {
      setDeckCollectionBracketFilters(readCheckedValues(deckBracketFiltersContainer));
    }

    if (deckDisplayStandard || deckDisplayBracket) {
      const handleDisplayChange = (event) => {
        if (!event?.target?.checked) {
          return;
        }
        if (typeof setDeckCollectionDisplayMode === "function") {
          setDeckCollectionDisplayMode(event.target.value === "bracket" ? "bracket" : "standard");
        }
        refreshWithSession();
      };
      deckDisplayStandard?.addEventListener("change", handleDisplayChange);
      deckDisplayBracket?.addEventListener("change", handleDisplayChange);
    }

    if (deckSortSelect) {
      deckSortSelect.addEventListener("change", (event) => {
        if (typeof setDeckCollectionSortMode === "function") {
          setDeckCollectionSortMode(event.target.value);
        }
        refreshWithSession();
      });
    }

    if (deckColorFiltersContainer) {
      deckColorFiltersContainer.addEventListener("change", () => {
        if (typeof setDeckCollectionColorFilters === "function") {
          setDeckCollectionColorFilters(readCheckedValues(deckColorFiltersContainer));
        }
        refreshWithSession();
      });
    }

    if (deckBracketFiltersContainer) {
      deckBracketFiltersContainer.addEventListener("change", () => {
        if (typeof setDeckCollectionBracketFilters === "function") {
          setDeckCollectionBracketFilters(readCheckedValues(deckBracketFiltersContainer));
        }
        refreshWithSession();
      });
    }

    if (deckResetFiltersBtn) {
      deckResetFiltersBtn.addEventListener("click", () => {
        if (deckSearchInput) {
          deckSearchInput.value = "";
        }
        deckColorFiltersContainer
          ?.querySelectorAll('input[type="checkbox"]')
          .forEach((input) => {
            input.checked = false;
          });
        deckBracketFiltersContainer
          ?.querySelectorAll('input[type="checkbox"]')
          .forEach((input) => {
            input.checked = false;
          });
        if (typeof resetDeckCollectionFilters === "function") {
          resetDeckCollectionFilters();
        }
        if (typeof setDeckCollectionSearchQuery === "function") {
          setDeckCollectionSearchQuery("");
        }
        if (typeof setDeckCollectionColorFilters === "function") {
          setDeckCollectionColorFilters([]);
        }
        if (typeof setDeckCollectionBracketFilters === "function") {
          setDeckCollectionBracketFilters([]);
        }
        refreshWithSession();
      });
    }

    if (deckSearchInput) {
      let searchTimer = null;
      deckSearchInput.addEventListener("input", (event) => {
        if (typeof setDeckCollectionSearchQuery === "function") {
          setDeckCollectionSearchQuery(event.target.value);
        }
        if (searchTimer) {
          window.clearTimeout(searchTimer);
        }
        searchTimer = window.setTimeout(() => {
          refreshWithSession();
          searchTimer = null;
        }, 150);
      });
    }

    const initialSession = getEffectiveSession();
    refreshDeckCollection(initialSession);

    if (initialSession) {
      const integration = getMoxfieldIntegration(initialSession);
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
