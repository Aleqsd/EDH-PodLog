(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  api.registerPageController("profile", (context) => {
    if (context.session) {
      updateProfileDetails(context.session);
    }
  });
})();
