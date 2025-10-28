(() => {
  const controllers = new Map();
  const sharedControllers = [];
  let serviceWorkerRegistrationScheduled = false;
  const isLocalDev =
    typeof window !== "undefined" && /^(localhost|127(?:\.\d{1,3}){3})$/.test(window.location.hostname);

  const scheduleServiceWorkerRegistration = () => {
    if (
      serviceWorkerRegistrationScheduled ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    serviceWorkerRegistrationScheduled = true;

    if (isLocalDev) {
      if (navigator.serviceWorker?.getRegistrations) {
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => {
            for (const registration of registrations) {
              registration.unregister().catch(() => {});
            }
          })
          .catch(() => {});
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register("./service-worker.js")
        .catch((error) =>
          console.warn("EDH PodLog service worker registration failed:", error)
        );
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  };

  const runMaybeAsync = async (fn, context) => {
    if (typeof fn !== "function") {
      return;
    }
    try {
      const result = fn(context);
      if (result && typeof result.then === "function") {
        await result;
      }
    } catch (error) {
      console.error("EDH PodLog controller failed:", error);
    }
  };

  const getBodyDatasetValue = (key) => {
    const value = document.body?.dataset?.[key];
    return typeof value === "string" ? value : "";
  };

  const buildContext = () => {
    const page = getBodyDatasetValue("page").toLowerCase();
    const requireAuth = getBodyDatasetValue("requireAuth").toLowerCase() === "true";

    return {
      page,
      requireAuth,
      get session() {
        return currentSession;
      },
      set session(next) {
        currentSession = next;
      },
      updateSession(updater) {
        if (typeof updater === "function") {
          currentSession = updater(currentSession);
        } else {
          currentSession = updater;
        }
        return currentSession;
      },
    };
  };

  const api = {
    registerPageController(name, initializer) {
      if (!name || typeof initializer !== "function") {
        return;
      }
      controllers.set(String(name).toLowerCase(), initializer);
    },
    registerSharedController(initializer) {
      if (typeof initializer === "function") {
        sharedControllers.push(initializer);
      }
    },
  };

  window.EDH_PODLOG = window.EDH_PODLOG || {};
  window.EDH_PODLOG.controllers = api;
  window.EDH_PODLOG.loadCachedDecksForHandle =
    window.EDH_PODLOG.loadCachedDecksForHandle || (() => {});

  scheduleServiceWorkerRegistration();

  document.addEventListener("DOMContentLoaded", async () => {
    if (typeof mountAppRevisionBadge === "function") {
      mountAppRevisionBadge();
    }

    currentSession = getSession();
    const context = buildContext();

    for (const initializer of sharedControllers) {
      await runMaybeAsync(initializer, context);
    }

    const pageKey = context.page || (document.body?.classList.contains("landing") ? "landing" : "");
    if (controllers.has(pageKey)) {
      await runMaybeAsync(controllers.get(pageKey), context);
    } else if (controllers.has("default")) {
      await runMaybeAsync(controllers.get("default"), context);
    }

    if (window.google?.accounts?.oauth2 && !isGoogleLibraryReady) {
      initializeGoogleAuth();
    }
  });
})();
