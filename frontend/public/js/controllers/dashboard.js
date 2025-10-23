(() => {
  const api = window.EDH_PODLOG?.controllers;
  if (!api) {
    return;
  }

  api.registerPageController("dashboard", () => {
    // Dashboard currently relies on shared shell initialisation only.
    // Placeholder to attach future interactive widgets.
  });
})();
