(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  api.registerPageController("landing", (context) => {
    landingSignInButton = document.getElementById("googleSignIn");
    const footnote = document.querySelector(".signin-footnote .footnote-text");
    landingFootnoteTextEl = footnote ?? null;
    if (landingFootnoteTextEl && landingFootnoteTextEl.textContent.trim().length > 0) {
      defaultFootnoteText = landingFootnoteTextEl.textContent.trim();
    }

    const yearEl = document.getElementById("footerYear");
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }

    if (!landingSignInButton) {
      return;
    }

    const label = landingSignInButton.querySelector("span");
    if (label && label.textContent.trim().length > 0) {
      defaultSignInLabel = label.textContent.trim();
    }

    setSignInButtonDisabled(true);
    updateSignInButtonState();

    landingSignInButton.addEventListener("click", (event) => {
      event.preventDefault();

      if (!isGoogleClientConfigured()) {
        explainMissingGoogleConfig();
        return;
      }

      if (!tokenClient) {
        window.alert(
          "La librairie Google n'est pas encore prête. Veuillez patienter une seconde puis réessayer."
        );
        return;
      }

      setSignInButtonLoading(true);
      tokenClient.requestAccessToken({
        prompt: context.session ? "" : "consent",
      });
    });
  });
})();
