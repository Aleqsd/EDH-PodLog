(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  let cachedDecksController = null;

  const ensureDefaultSyncLabel = () => {
    if (moxfieldSyncButton && moxfieldSyncButton.textContent.trim().length > 0) {
      defaultSyncLabel = moxfieldSyncButton.textContent.trim();
      moxfieldSyncButton.innerHTML = `<span class="button-label">${defaultSyncLabel}</span>`;
    }
  };

  const bindDeckSelectionModal = () => {
    if (deckSelectionConfirmBtn) {
      deckSelectionConfirmBtn.addEventListener("click", handleDeckSelectionConfirm);
    }
    deckSelectionCancelBtn?.addEventListener("click", () => closeDeckSelectionModal("cancel"));
    deckSelectionCloseBtn?.addEventListener("click", () => closeDeckSelectionModal("cancel"));
    deckSelectionSelectAllBtn?.addEventListener("click", selectAllDecksForImport);
    deckSelectionClearBtn?.addEventListener("click", clearDeckSelection);
    deckSelectionListEl?.addEventListener("change", updateDeckSelectionConfirmState);

    if (deckSelectionModal) {
      deckSelectionModal.addEventListener("click", (event) => {
        if (event.target === deckSelectionModal) {
          closeDeckSelectionModal("cancel");
        }
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && deckSelectionModal?.classList.contains("is-visible")) {
        event.preventDefault();
        closeDeckSelectionModal("cancel");
      }
    });
  };

  const sessionStore = window.EDH_PODLOG?.session ?? {};

  api.registerPageController("synchronisation", (context) => {
    moxfieldForm = document.getElementById("moxfieldForm");
    moxfieldHandleInput = document.getElementById("moxfieldHandle");
    moxfieldSaveButton = moxfieldForm?.querySelector(".inline-button") ?? null;
    moxfieldSyncButton = document.getElementById("moxfieldSync");
    moxfieldStatusEl = document.getElementById("moxfieldStatus");
    moxfieldDeckSummaryEl = document.getElementById("moxfieldDeckSummary");
    moxfieldDeckSummaryText = document.getElementById("moxfieldDeckSummaryText");
    moxfieldDeckSummaryAction = document.getElementById("moxfieldDeckSummaryAction");
    moxfieldMetaEl = document.getElementById("moxfieldSyncMeta");

    deckSelectionModal = document.getElementById("deckSelectionModal");
    deckSelectionListEl = document.getElementById("deckSelectionList");
    deckSelectionForm = document.getElementById("deckSelectionForm");
    deckSelectionConfirmBtn = document.getElementById("deckSelectionConfirm");
    deckSelectionCancelBtn = document.getElementById("deckSelectionCancel");
    deckSelectionCloseBtn = document.getElementById("deckSelectionClose");
    deckSelectionSelectAllBtn = document.getElementById("deckSelectionSelectAll");
    deckSelectionClearBtn = document.getElementById("deckSelectionClearAll");

    ensureDefaultSyncLabel();
    bindDeckSelectionModal();

    const loadCachedDecksForHandle = async (handle, { showMessageOnMiss = false } = {}) => {
      const normalizedHandle = handle?.trim();
      if (!normalizedHandle) {
        return;
      }

      if (cachedDecksController) {
        cachedDecksController.abort();
      }

      const controller = new AbortController();
      cachedDecksController = controller;

      try {
        const { decks, totalDecks, user } = await fetchDecksFromBackend(normalizedHandle, {
          signal: controller.signal,
          mode: "cache-only",
        });

        const deckCount = Array.isArray(decks) ? decks.length : 0;
        const totalCount = typeof totalDecks === "number" ? totalDecks : deckCount;
        const message = `Decks chargés depuis le cache (${deckCount} deck${deckCount > 1 ? "s" : ""}).`;

        const updatedSession = setMoxfieldIntegration((integration) => ({
          ...integration,
          handle: normalizedHandle,
          handleLower: normalizedHandle.toLowerCase(),
          decks,
          deckCount,
          totalDecks: totalCount,
          lastUser: user ?? integration?.lastUser ?? null,
          lastSyncedAt: Date.now(),
          lastSyncStatus: "success",
          lastSyncMessage: message,
          lastSource: "cache",
        }));

        currentSession = updatedSession ?? currentSession;
        sessionStore.setCurrent?.(currentSession);
        context.session = currentSession;
        renderMoxfieldPanel(currentSession);
        refreshDeckCollection(currentSession);
      } catch (error) {
        if (error.code === "CACHE_MISS") {
          if (showMessageOnMiss) {
            showMoxfieldStatus(
              "Aucune donnée en cache pour ce pseudo. Lancez une synchronisation.",
              "neutral"
            );
          }
        } else if (error.code === "NETWORK") {
          showMoxfieldStatus(error.message, "error");
        } else if (error.code === "HTTP_ERROR") {
          showMoxfieldStatus(
            `L'API EDH PodLog a renvoyé une erreur (${error.status ?? "inconnue"}).`,
            "error"
          );
        } else if (error.code !== "AbortError") {
          showMoxfieldStatus("Lecture du cache impossible pour le moment.", "error");
        }
      } finally {
        if (cachedDecksController === controller) {
          cachedDecksController = null;
        }
      }
    };

    window.EDH_PODLOG.loadCachedDecksForHandle = loadCachedDecksForHandle;

    if (context.session) {
      renderMoxfieldPanel(context.session);
      const integration = getMoxfieldIntegration(context.session);
      if (
        integration?.handle &&
        (!Array.isArray(integration.decks) || integration.decks.length === 0)
      ) {
        loadCachedDecksForHandle(integration.handle);
      }
    }

    refreshDeckCollection(context.session);

    if (moxfieldForm && moxfieldHandleInput) {
      moxfieldForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!context.session) {
          redirectToLanding();
          return;
        }

        const rawHandle = moxfieldHandleInput.value;
        const validation = validateMoxfieldHandle(rawHandle);

        if (!validation.valid) {
          if (validation.reason === "empty") {
            showMoxfieldStatus("Veuillez renseigner votre pseudo Moxfield.", "error");
          } else {
            showMoxfieldStatus(
              "Le pseudo Moxfield ne doit contenir que des lettres, chiffres, tirets ou underscores.",
              "error"
            );
          }
          if (moxfieldSyncButton) {
            moxfieldSyncButton.disabled = true;
          }
          return;
        }

        if (moxfieldSaveButton) {
          moxfieldSaveButton.disabled = true;
        }

        const normalizedHandle = validation.normalized;
        const previousIntegration = getMoxfieldIntegration(context.session);
        const previousHandle = previousIntegration?.handle ?? null;
        const handleChanged =
          (previousHandle ?? "").toLowerCase() !== normalizedHandle.toLowerCase();

        const updatedSession = setMoxfieldIntegration((integration) => {
          const next = { ...integration };
          next.handle = normalizedHandle;
          next.handleLower = normalizedHandle.toLowerCase();
          next.handleUpdatedAt = Date.now();

          if (handleChanged) {
            next.decks = [];
            next.deckCount = 0;
            next.totalDecks = null;
            next.lastUser = null;
            next.lastSyncedAt = null;
            next.lastSyncStatus = null;
            next.lastSyncMessage = null;
            next.lastSource = null;
          }

          return next;
        });

        currentSession = updatedSession ?? currentSession;
        currentSession =
          (await persistIntegrationToProfile(currentSession, {
            handleChanged,
            decks: handleChanged ? [] : undefined,
          })) ?? currentSession;
        sessionStore.setCurrent?.(currentSession);
        context.session = currentSession;
        renderMoxfieldPanel(currentSession, { preserveStatus: true });
        showMoxfieldStatus("Pseudo Moxfield enregistré.", "success");

        if (moxfieldSaveButton) {
          moxfieldSaveButton.disabled = false;
        }

        if (moxfieldSyncButton && !moxfieldSyncButton.classList.contains("is-loading")) {
          moxfieldSyncButton.disabled = false;
        }

        loadCachedDecksForHandle(normalizedHandle, { showMessageOnMiss: true });
      });
    }

    if (moxfieldSyncButton) {
      moxfieldSyncButton.addEventListener("click", async () => {
        if (!context.session) {
          redirectToLanding();
          return;
        }

        const handleValue = moxfieldHandleInput?.value ?? "";
        const validation = validateMoxfieldHandle(handleValue);

        if (!validation.valid) {
          showMoxfieldStatus(
            validation.reason === "empty"
              ? "Renseignez d'abord votre pseudo Moxfield."
              : "Le pseudo Moxfield contient des caractères non autorisés.",
            "error"
          );
          return;
        }

        if (cachedDecksController) {
          cachedDecksController.abort();
          cachedDecksController = null;
        }

        if (currentSyncAbortController) {
          currentSyncAbortController.abort();
        }

        const controller = new AbortController();
        currentSyncAbortController = controller;

        setMoxfieldSyncLoading(true);
        showMoxfieldStatus("Récupération des decks disponibles…");

        try {
          const preview = await fetchDeckSummariesFromBackend(
            validation.normalized,
            controller.signal
          );

          if (!Array.isArray(preview.decks) || preview.decks.length === 0) {
            showMoxfieldStatus("Aucun deck public trouvé pour ce pseudo.", "neutral");
            return;
          }

          const existingMap = buildExistingDeckMap(getMoxfieldIntegration(context.session));
          currentSyncAbortController = null;
          setMoxfieldSyncLoading(false);
          showMoxfieldStatus("Sélectionnez les decks à importer.", "neutral");
          openDeckSelectionModal({
            handle: validation.normalized,
            decks: preview.decks,
            totalDecks: preview.totalDecks,
            user: preview.user,
            existingDeckMap: existingMap,
          });
        } catch (error) {
          if (error.name === "AbortError") {
            return;
          }

          let message = error.message || "Synchronisation impossible.";
          let variant = "error";

          if (error.code === "NOT_FOUND") {
            message =
              "Impossible de trouver ce pseudo Moxfield. Vérifiez l'orthographe et réessayez.";
          } else if (error.code === "HTTP_ERROR") {
            message = `L'API EDH PodLog a renvoyé une erreur (${error.status ?? "inconnue"}).`;
          } else if (error.code === "NETWORK") {
            message = error.message;
          }

          showMoxfieldStatus(message, variant);
        } finally {
          if (currentSyncAbortController === controller) {
            currentSyncAbortController = null;
          }
          setMoxfieldSyncLoading(false);
        }
      });
    }
  });
})();
