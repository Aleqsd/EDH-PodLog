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

  const fileContent = `window.EDH_PODLOG_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
  await writeFile(outputPath, fileContent, "utf8");
  console.log(`[generate-config] Fichier généré : ${outputPath}`);
};

main().catch((error) => {
  console.error("[generate-config] Échec de la génération du fichier config.js");
  console.error(error);
  process.exit(1);
});
