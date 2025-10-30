(() => {
  const config = window.EDH_PODLOG?.config ?? null;
  if (!config) {
    console.warn("EDH PodLog config unavailable; revision badge not initialised.");
    return;
  }

  const revision = config.revision ?? {};

  const parseRevisionDate = (raw) => {
    if (!raw || typeof raw !== "string") {
      return null;
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatRevisionDate = (date) => {
    if (!(date instanceof Date)) {
      return "";
    }
    try {
      const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      return `${dateFormatter.format(date)} à ${timeFormatter.format(date)}`;
    } catch (error) {
      console.warn("EDH PodLog failed to format revision date:", error);
      return date.toISOString();
    }
  };

  const revisionDate = parseRevisionDate(revision.dateRaw);

  const mountRevisionBadge = () => {
    if (!revision.short || typeof document === "undefined") {
      return;
    }

    const body = document.body;
    if (!body || document.getElementById("appRevisionBadge")) {
      return;
    }

    const badge = document.createElement("aside");
    badge.id = "appRevisionBadge";
    badge.className = "app-revision-badge";

    if (revision.message) {
      badge.setAttribute(
        "aria-label",
        `Dernière mise à jour : ${revision.message} (${revision.short})`
      );
    } else {
      badge.setAttribute("aria-label", `Révision ${revision.short}`);
    }
    badge.dataset.revision = revision.short;

    if (revision.full) {
      badge.title = `Commit ${revision.full}`;
      badge.dataset.revisionFull = revision.full;
    }

    const previewMessage = (() => {
      if (!revision.message) {
        return `Révision ${revision.short}`;
      }
      const maxLength = 80;
      if (revision.message.length <= maxLength) {
        return revision.message;
      }
      return `${revision.message.slice(0, maxLength - 1)}…`;
    })();

    const header = document.createElement("span");
    header.className = "app-revision-header";

    const messageSpan = document.createElement("span");
    messageSpan.className = "app-revision-message";
    messageSpan.textContent = previewMessage;

    const revisionSpan = document.createElement("span");
    revisionSpan.className = "app-revision-value";
    revisionSpan.textContent = `(${revision.short})`;

    header.append(messageSpan, revisionSpan);
    badge.append(header);

    if (revision.message) {
      badge.dataset.revisionMessage = revision.message;
      const tooltip = document.createElement("div");
      tooltip.className = "app-revision-tooltip";
      tooltip.textContent = revision.message;
      tooltip.id = "appRevisionTooltip";
      badge.setAttribute("aria-describedby", tooltip.id);
      badge.append(tooltip);
    }

    if (revisionDate) {
      const display = formatRevisionDate(revisionDate);
      if (display) {
        const dateEl = document.createElement("time");
        dateEl.className = "app-revision-date";
        dateEl.dateTime = revisionDate.toISOString();
        dateEl.textContent = `Mis à jour le ${display}`;
        badge.dataset.revisionDate = revisionDate.toISOString();
        badge.append(dateEl);
      }
    }

    body.appendChild(badge);
  };

  window.EDH_PODLOG = window.EDH_PODLOG || {};
  window.EDH_PODLOG.ui = {
    ...(window.EDH_PODLOG.ui || {}),
    mountRevisionBadge,
  };
})();
