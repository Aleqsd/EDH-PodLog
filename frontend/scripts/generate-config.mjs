#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "REMPLACEZ_MOI_PAR_VOTRE_CLIENT_ID";
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const repoRoot = resolve(projectRoot, "..");
const envRoot = process.env.EDH_PODLOG_ENV_ROOT
  ? resolve(repoRoot, process.env.EDH_PODLOG_ENV_ROOT)
  : repoRoot;
const outputPath = process.env.EDH_PODLOG_CONFIG_OUT
  ? resolve(repoRoot, process.env.EDH_PODLOG_CONFIG_OUT)
  : resolve(projectRoot, "public/config.js");
const swVersionOutputPath = resolve(projectRoot, "public/service-worker.version.js");
const envFiles = process.env.EDH_PODLOG_ENV_FILES
  ? process.env.EDH_PODLOG_ENV_FILES.split(":").filter(Boolean)
  : [".env", ".env.local"];

const parseEnv = (raw) =>
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

const loadEnv = async () => {
  const env = { ...process.env };
  for (const fileName of envFiles) {
    const filePath = resolve(envRoot, fileName);
    if (!existsSync(filePath)) {
      continue;
    }
    const fileContent = await readFile(filePath, "utf8");
    const parsed = parseEnv(fileContent);
    Object.assign(env, parsed);
  }
  return env;
};

const normalizeCommitSha = (value) => {
  if (!value || typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /^[0-9a-f]+$/i.test(trimmed) ? trimmed : "";
};

const deriveCommitInfo = (env) => {
  const candidates = [
    env.EDH_PODLOG_COMMIT,
    env.EDH_PODLOG_COMMIT_SHA,
    env.VERCEL_GIT_COMMIT_SHA,
    env.NETLIFY_COMMIT_REF,
    env.COMMIT_SHA,
    env.COMMIT_REF,
    env.GIT_COMMIT,
    env.GITHUB_SHA,
    env.CI_COMMIT_SHA,
    env.SOURCE_VERSION,
    env.BUILD_SOURCEVERSION,
    env.TRAVIS_COMMIT,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCommitSha(candidate);
    if (normalized) {
      return {
        full: normalized,
        short: normalized.slice(0, 8),
      };
    }
  }

  try {
    const full = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
    if (full && /^[0-9a-f]+$/i.test(full)) {
      return {
        full,
        short: full.slice(0, 8),
      };
    }
  } catch (error) {
    console.warn("[generate-config] Impossible de déterminer le commit courant :", error.message);
  }

  return {
    full: "",
    short: "",
  };
};

const normalizeEpoch = (value) => {
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

const deriveCommitTimestamp = (env) => {
  const timestampCandidates = [
    env.EDH_PODLOG_COMMIT_TS,
    env.EDH_PODLOG_COMMIT_TIME,
    env.VERCEL_GIT_COMMIT_TIME,
    env.NETLIFY_COMMIT_TIME,
    env.CI_COMMIT_TIMESTAMP,
    env.BUILD_TIMESTAMP,
  ];

  for (const candidate of timestampCandidates) {
    const epochSeconds = normalizeEpoch(candidate);
    if (epochSeconds) {
      return new Date(epochSeconds * 1000).toISOString();
    }
  }

  try {
    const raw = execSync("git show -s --format=%ct HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const epochSeconds = normalizeEpoch(raw);
    if (epochSeconds) {
      return new Date(epochSeconds * 1000).toISOString();
    }
  } catch (error) {
    console.warn("[generate-config] Impossible de déterminer la date du commit :", error.message);
  }

  return new Date().toISOString();
};

const deriveCommitMessage = (env) => {
  const candidateMessages = [
    env.EDH_PODLOG_COMMIT_MESSAGE,
    env.EDH_PODLOG_COMMIT_MSG,
    env.GIT_COMMIT_MESSAGE,
    env.CI_COMMIT_MESSAGE,
    env.VERCEL_GIT_COMMIT_MESSAGE,
    env.NETLIFY_COMMIT_MESSAGE,
  ];

  for (const candidate of candidateMessages) {
    if (candidate && typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  try {
    const message = execSync("git show -s --format=%s HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    if (message) {
      return message;
    }
  } catch (error) {
    console.warn("[generate-config] Impossible de déterminer le message du commit :", error.message);
  }

  return "";
};

const main = async () => {
  const env = await loadEnv();
  const clientId = env.GOOGLE_CLIENT_ID ?? PLACEHOLDER;
  const apiBaseUrl = env.API_BASE_URL ?? "http://localhost:4310";

  if (!env.GOOGLE_CLIENT_ID) {
    console.warn(
      "[generate-config] Aucun GOOGLE_CLIENT_ID détecté. Un placeholder sera écrit dans public/config.js."
    );
  }

  const config = {
    GOOGLE_CLIENT_ID: clientId,
    API_BASE_URL: apiBaseUrl,
  };

  const commitInfo = deriveCommitInfo(env);
  if (commitInfo.short) {
    config.APP_REVISION = commitInfo.short;
  }
  if (commitInfo.full) {
    config.APP_REVISION_FULL = commitInfo.full;
  }
  const commitTimestamp = deriveCommitTimestamp(env);
  if (commitTimestamp) {
    config.APP_REVISION_DATE = commitTimestamp;
  }
  const commitMessage = deriveCommitMessage(env);
  if (commitMessage) {
    config.APP_REVISION_MESSAGE = commitMessage;
  }

  const fileContent = `window.EDH_PODLOG_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
  await writeFile(outputPath, fileContent, "utf8");
  console.log(`[generate-config] Fichier généré : ${outputPath}`);

  const swVersion = commitInfo.full || `dev-${Date.now()}`;
  const swVersionContent = `self.EDH_PODLOG_SW_VERSION = ${JSON.stringify(swVersion)};\n`;
  await writeFile(swVersionOutputPath, swVersionContent, "utf8");
  console.log(`[generate-config] Version du service worker écrite dans : ${swVersionOutputPath}`);
};

main().catch((error) => {
  console.error("[generate-config] Échec de la génération du fichier config.js");
  console.error(error);
  process.exit(1);
});
