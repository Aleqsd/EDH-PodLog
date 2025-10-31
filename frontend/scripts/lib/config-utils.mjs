export const DEFAULT_COMMIT_SHA_CANDIDATES = [
  "EDH_PODLOG_COMMIT",
  "EDH_PODLOG_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "NETLIFY_COMMIT_REF",
  "COMMIT_SHA",
  "COMMIT_REF",
  "GIT_COMMIT",
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "SOURCE_VERSION",
  "BUILD_SOURCEVERSION",
  "TRAVIS_COMMIT",
];

export const DEFAULT_COMMIT_TIMESTAMP_CANDIDATES = [
  "EDH_PODLOG_COMMIT_TS",
  "EDH_PODLOG_COMMIT_TIME",
  "VERCEL_GIT_COMMIT_TIME",
  "NETLIFY_COMMIT_TIME",
  "CI_COMMIT_TIMESTAMP",
  "BUILD_TIMESTAMP",
];

export const DEFAULT_COMMIT_MESSAGE_CANDIDATES = [
  "EDH_PODLOG_COMMIT_MESSAGE",
  "EDH_PODLOG_COMMIT_MSG",
  "GIT_COMMIT_MESSAGE",
  "CI_COMMIT_MESSAGE",
  "VERCEL_GIT_COMMIT_MESSAGE",
  "NETLIFY_COMMIT_MESSAGE",
];

export const parseEnv = (raw) =>
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((acc, line) => {
      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) {
        return acc;
      }
      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      acc[key] = value;
      return acc;
    }, {});

export const mergeEnv = (baseEnv, ...overrides) =>
  overrides.reduce(
    (acc, override) => (override ? { ...acc, ...override } : acc),
    { ...baseEnv },
  );

export const normalizeCommitSha = (value) => {
  if (!value || typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /^[0-9a-f]+$/i.test(trimmed) ? trimmed : "";
};

export const normalizeEpoch = (value) => {
  if (value == null) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Math.floor(value.getTime() / 1000);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 1e12) {
      return Math.floor(numeric / 1000);
    }
    return Math.floor(numeric);
  }
  const parsed = Date.parse(String(value));
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return null;
};

export const deriveCommitInfo = (
  env,
  { getFallbackSha = () => "" } = {},
) => {
  for (const key of DEFAULT_COMMIT_SHA_CANDIDATES) {
    const normalized = normalizeCommitSha(env?.[key]);
    if (normalized) {
      return {
        full: normalized,
        short: normalized.slice(0, 8),
      };
    }
  }

  const fallbackSha = normalizeCommitSha(getFallbackSha());
  if (fallbackSha) {
    return {
      full: fallbackSha,
      short: fallbackSha.slice(0, 8),
    };
  }

  return {
    full: "",
    short: "",
  };
};

export const deriveCommitTimestamp = (
  env,
  {
    getFallbackEpoch = () => null,
    now = () => new Date(),
  } = {},
) => {
  for (const key of DEFAULT_COMMIT_TIMESTAMP_CANDIDATES) {
    const epochSeconds = normalizeEpoch(env?.[key]);
    if (epochSeconds) {
      return new Date(epochSeconds * 1000).toISOString();
    }
  }

  const fallbackEpoch = normalizeEpoch(getFallbackEpoch());
  if (fallbackEpoch) {
    return new Date(fallbackEpoch * 1000).toISOString();
  }

  return now().toISOString();
};

export const deriveCommitMessage = (
  env,
  { getFallbackMessage = () => "" } = {},
) => {
  for (const key of DEFAULT_COMMIT_MESSAGE_CANDIDATES) {
    const candidate = env?.[key];
    if (candidate && typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const fallbackMessage = getFallbackMessage();
  if (fallbackMessage && typeof fallbackMessage === "string" && fallbackMessage.trim()) {
    return fallbackMessage.trim();
  }

  return "";
};
