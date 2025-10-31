(() => {
  const config = window.EDH_PODLOG?.config ?? null;
  if (!config) {
    console.warn("EDH PodLog config unavailable; revision badge not initialised.");
    return;
  }

  const revision = config.revision ?? {};
  const rawVersion = typeof config.version === "string" ? config.version.trim() : "";
  const normalizedVersion = rawVersion
    ? rawVersion.startsWith("v")
      ? rawVersion
      : `v${rawVersion}`
    : "";

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
    if ((!revision.short && !normalizedVersion) || typeof document === "undefined") {
      return;
    }

    const body = document.body;
    if (!body || document.getElementById("appRevisionBadge")) {
      return;
    }

    const badge = document.createElement("aside");
    badge.id = "appRevisionBadge";
    badge.className = "app-revision-badge";

    const ariaParts = [];
    if (revision.message) {
      ariaParts.push(`Dernière mise à jour : ${revision.message}`);
    }
    if (normalizedVersion) {
      ariaParts.push(`Version ${normalizedVersion}`);
    } else if (revision.short) {
      ariaParts.push(`Révision ${revision.short}`);
    }
    if (ariaParts.length) {
      badge.setAttribute("aria-label", ariaParts.join(" • "));
    }

    if (revision.short) {
      badge.dataset.revision = revision.short;
    }
    if (normalizedVersion) {
      badge.dataset.version = normalizedVersion;
    }

    if (revision.full) {
      badge.title = normalizedVersion
        ? `Version ${normalizedVersion}\nCommit ${revision.full}`
        : `Commit ${revision.full}`;
      badge.dataset.revisionFull = revision.full;
    }

    const previewMessage = (() => {
      if (!revision.message) {
        if (normalizedVersion) {
          return `Version ${normalizedVersion}`;
        }
        return revision.short ? `Révision ${revision.short}` : "Révision inconnue";
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
    if (normalizedVersion) {
      revisionSpan.textContent = normalizedVersion;
    } else if (revision.short) {
      revisionSpan.textContent = `(${revision.short})`;
    }

    header.append(messageSpan, revisionSpan);
    badge.append(header);

    const tooltipLines = [];
    if (revision.message) {
      badge.dataset.revisionMessage = revision.message;
      tooltipLines.push(revision.message);
    }
    if (revision.full) {
      tooltipLines.push(`Commit ${revision.full}`);
    } else if (revision.short) {
      tooltipLines.push(`Commit ${revision.short}`);
    }
    if (normalizedVersion) {
      tooltipLines.unshift(`Version ${normalizedVersion}`);
    }
    if (tooltipLines.length) {
      const tooltip = document.createElement("div");
      tooltip.className = "app-revision-tooltip";
      tooltip.textContent = tooltipLines.join("\n");
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
