(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  const AVATAR_MAX_BYTES = 512 * 1024;

  const normalize = (value) => (typeof value === "string" ? value.trim() : "");

  const clampDescription = (value) => {
    if (typeof value !== "string") {
      return "";
    }
    return value.length > 1000 ? value.slice(0, 1000) : value;
  };

  const showStatus = (element, message, variant = "neutral") => {
    if (!element) {
      return;
    }
    element.textContent = message || "";
    element.classList.remove("is-error", "is-success");
    if (!message) {
      return;
    }
    if (variant === "error") {
      element.classList.add("is-error");
    } else if (variant === "success") {
      element.classList.add("is-success");
    }
  };

  const updateCharCount = (input, counter) => {
    if (!counter) {
      return;
    }
    const value = typeof input?.value === "string" ? input.value : "";
    counter.textContent = `${value.length} / 1000`;
  };

  const initializeProfileForm = (context) => {
    const formEl = document.getElementById("profileForm");
    if (!formEl) {
      return;
    }

    const displayNameInput = document.getElementById("profileDisplayName");
    const bioInput = document.getElementById("profileBioInput");
    const bioCounter = document.getElementById("profileBioCount");
    const statusEl = document.getElementById("profileFormStatus");
    const submitBtn = document.getElementById("profileFormSubmit");
    const avatarPreview = document.getElementById("profileAvatarPreview");
    const avatarUploadBtn = document.getElementById("profileAvatarUploadButton");
    const avatarClearBtn = document.getElementById("profileAvatarClearButton");
    const avatarInput = document.getElementById("profileAvatarInput");
    const publicToggle = document.getElementById("profileIsPublic");

    if (!context.session) {
      Array.from(formEl.elements).forEach((element) => {
        element.disabled = true;
      });
      showStatus(statusEl, "Session expirée. Rechargez la page pour continuer.", "error");
      return;
    }

    const state = {
      displayName: context.session.profileDisplayName ?? "",
      description:
        typeof context.session.profileDescription === "string"
          ? context.session.profileDescription
          : "",
      savedPicture: context.session.picture || "",
      identityPicture: context.session.identityPicture || "",
      editedPicture: undefined,
      isPublic: Boolean(context.session?.profileIsPublic),
      initialIsPublic: Boolean(context.session?.profileIsPublic),
    };

    const hasCustomSavedAvatar = () =>
      Boolean(state.savedPicture) && state.savedPicture !== state.identityPicture;

    const computePreviewPicture = () => {
      if (state.editedPicture === null) {
        return state.identityPicture || "";
      }
      if (typeof state.editedPicture === "string") {
        return state.editedPicture;
      }
      return state.savedPicture || state.identityPicture || "";
    };

    const refreshAvatarPreview = () => {
      if (avatarPreview && typeof applyAvatarStyles === "function") {
        const previewSession = {
          ...context.session,
          picture: computePreviewPicture(),
        };
        applyAvatarStyles(avatarPreview, previewSession);
      }

      if (avatarClearBtn) {
        const pendingCustom = typeof state.editedPicture === "string";
        const pendingReset = state.editedPicture === null && Boolean(state.identityPicture);
        avatarClearBtn.disabled = !(pendingCustom || hasCustomSavedAvatar() || pendingReset);
      }
    };

    const refreshFormFields = () => {
      if (displayNameInput) {
        displayNameInput.value = state.displayName;
      }
      if (bioInput) {
        bioInput.value = state.description;
        updateCharCount(bioInput, bioCounter);
      }
      if (publicToggle) {
        publicToggle.checked = Boolean(state.isPublic);
      }
      refreshAvatarPreview();
    };

    refreshFormFields();

    if (bioInput) {
      bioInput.addEventListener("input", () => {
        if (bioInput.value.length > 1000) {
          bioInput.value = clampDescription(bioInput.value);
        }
        updateCharCount(bioInput, bioCounter);
      });
    }

    if (avatarUploadBtn && avatarInput) {
      avatarUploadBtn.addEventListener("click", () => {
        avatarInput.click();
      });
    }

    if (avatarInput) {
      avatarInput.addEventListener("change", (event) => {
        const file = event.target?.files?.[0];
        if (!file) {
          return;
        }

        if (!file.type.startsWith("image/")) {
          showStatus(statusEl, "Veuillez sélectionner un fichier image.", "error");
          avatarInput.value = "";
          return;
        }

        if (file.size > AVATAR_MAX_BYTES) {
          showStatus(statusEl, "Image trop volumineuse (512 Ko maximum).", "error");
          avatarInput.value = "";
          return;
        }

        const reader = new FileReader();
        reader.addEventListener("load", () => {
          if (typeof reader.result === "string") {
            state.editedPicture = reader.result;
            refreshAvatarPreview();
            showStatus(
              statusEl,
              "Aperçu mis à jour. Enregistrez pour appliquer la nouvelle image.",
              "success"
            );
          }
        });
        reader.addEventListener("error", () => {
          showStatus(
            statusEl,
            "Nous n'avons pas pu lire cette image. Essayez un autre fichier.",
            "error"
          );
        });
        reader.readAsDataURL(file);
      });
    }

    if (avatarClearBtn) {
      avatarClearBtn.addEventListener("click", () => {
        if (avatarClearBtn.disabled) {
          return;
        }
        state.editedPicture = null;
        if (avatarInput) {
          avatarInput.value = "";
        }
        refreshAvatarPreview();
        showStatus(
          statusEl,
          "L'avatar Google sera utilisé après l'enregistrement.",
          "success"
        );
      });
    }

    if (publicToggle) {
      publicToggle.addEventListener("change", () => {
        state.isPublic = Boolean(publicToggle.checked);
      });
    }

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (
        typeof upsertBackendProfile !== "function" ||
        typeof applyProfileToSession !== "function" ||
        typeof persistSession !== "function"
      ) {
        showStatus(
          statusEl,
          "Configuration incomplète : impossible de mettre à jour le profil.",
          "error"
        );
        return;
      }

      if (!context.session?.googleSub) {
        showStatus(
          statusEl,
          "Session expirée. Veuillez vous reconnecter pour continuer.",
          "error"
        );
        return;
      }

      const payload = {};
      const currentDisplayName = displayNameInput ? displayNameInput.value : "";
      const normalizedCurrentName = normalize(currentDisplayName);
      const normalizedInitialName = normalize(state.displayName);

      if (normalizedCurrentName !== normalizedInitialName) {
        payload.display_name =
          normalizedCurrentName.length > 0 ? normalizedCurrentName : null;
      }

      const currentDescription = bioInput ? clampDescription(bioInput.value) : "";
      if (currentDescription !== state.description) {
        const trimmedDescription = normalize(currentDescription);
        payload.description = trimmedDescription.length > 0 ? currentDescription : null;
      }

      if (typeof state.isPublic === "boolean" && state.isPublic !== state.initialIsPublic) {
        payload.is_public = state.isPublic;
      }

      if (state.editedPicture !== undefined) {
        payload.picture =
          typeof state.editedPicture === "string" ? state.editedPicture : null;
      }

      if (Object.keys(payload).length === 0) {
        showStatus(statusEl, "Aucune modification détectée.", "success");
        return;
      }

      showStatus(statusEl, "Enregistrement en cours…");
      if (submitBtn) {
        submitBtn.disabled = true;
      }

      try {
        const profile = await upsertBackendProfile(context.session.googleSub, payload);
        if (!profile) {
          throw new Error("Profil indisponible");
        }
        const merged = applyProfileToSession(context.session, profile);
        persistSession(merged);
        context.session = merged;

        state.displayName = merged.profileDisplayName ?? "";
        state.description =
          typeof merged.profileDescription === "string" ? merged.profileDescription : "";
        state.savedPicture = merged.picture || "";
        state.identityPicture = merged.identityPicture || state.identityPicture || "";
        state.editedPicture = undefined;
        state.isPublic = Boolean(merged.profileIsPublic);
        state.initialIsPublic = state.isPublic;

        if (avatarInput) {
          avatarInput.value = "";
        }
        refreshFormFields();

        if (typeof updateProfileBadge === "function") {
          updateProfileBadge(merged);
        }
        updateProfileDetails(merged);

        showStatus(statusEl, "Profil mis à jour.", "success");
      } catch (error) {
        console.error("Impossible d'enregistrer le profil :", error);
        showStatus(
          statusEl,
          "Impossible d'enregistrer le profil. Réessayez dans un instant.",
          "error"
        );
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
        }
      }
    });
  };

  api.registerPageController("profile", (context) => {
    if (context.session) {
      updateProfileDetails(context.session);
    }
    initializeProfileForm(context);
  });
})();
