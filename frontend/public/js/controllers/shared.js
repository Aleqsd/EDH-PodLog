(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  api.registerSharedController(async (context) => {
    const profileMenuButton = document.getElementById("profileMenuButton");
    const profileMenu = document.getElementById("profileMenu");
    const signOutBtn = document.getElementById("signOutBtn");
    const profileLink = document.querySelector(
      '.dropdown-link[href="profile.html"], .dropdown-link[href="./profile.html"]'
    );
    const profileHref = profileLink
      ? new URL(profileLink.getAttribute("href") || "profile.html", window.location.href).href
      : new URL("profile.html", window.location.href).href;

    const pageRequiresAuth =
      context.requireAuth || Boolean(profileMenuButton || signOutBtn || document.body?.classList.contains("app-shell"));

    if (context.session?.accessToken) {
      googleAccessToken = context.session.accessToken;
    }

    if (pageRequiresAuth && !context.session) {
      redirectToLanding();
      return;
    }

    if (context.session?.googleSub) {
      try {
        const profile = await fetchBackendProfile(context.session.googleSub);
        if (profile) {
          const merged = applyProfileToSession(context.session, profile);
          persistSession(merged);
          context.session = merged;
        }
      } catch (error) {
        console.warn("Impossible de récupérer le profil sauvegardé :", error);
      }
    }

    if (context.session?.googleSub && typeof ensureDeckPersonalizationsSynced === "function") {
      try {
        await ensureDeckPersonalizationsSynced(context.session);
      } catch (error) {
        console.warn("Impossible de synchroniser les personnalisations de deck :", error);
      }
    }

    if (context.session) {
      updateProfileBadge(context.session);
      updateProfileDetails(context.session);
    }

    if (profileMenuButton && profileMenu) {
      const closeMenu = () => {
        profileMenu.classList.remove("is-visible");
        profileMenuButton.setAttribute("aria-expanded", "false");
      };

      const toggleMenu = () => {
        const isOpen = profileMenu.classList.toggle("is-visible");
        profileMenuButton.setAttribute("aria-expanded", String(isOpen));
      };

      profileMenuButton.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleMenu();
      });

      profileMenu.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      document.addEventListener("click", (event) => {
        if (profileMenu.classList.contains("is-visible") && !profileMenu.contains(event.target)) {
          closeMenu();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeMenu();
        }
      });
    }

    if (profileLink) {
      profileLink.addEventListener("click", (event) => {
        event.stopPropagation();
        profileMenu?.classList.remove("is-visible");
        profileMenuButton?.setAttribute("aria-expanded", "false");
        event.preventDefault();
        window.location.assign(profileHref);
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        profileMenu?.classList.remove("is-visible");
        profileMenuButton?.setAttribute("aria-expanded", "false");
        const session = getSession();
        revokeGoogleToken(session?.accessToken || googleAccessToken);
        clearSession();
        context.session = null;
        redirectToLanding();
      });
    }
  });
})();
