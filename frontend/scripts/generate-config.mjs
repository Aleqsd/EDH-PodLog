#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveCommitInfo,
  deriveCommitMessage,
  deriveCommitTimestamp,
  mergeEnv,
  parseEnv,
} from "./lib/config-utils.mjs";

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

const loadEnv = async () => {
  let env = mergeEnv(process.env);
  for (const fileName of envFiles) {
    const filePath = resolve(envRoot, fileName);
    if (!existsSync(filePath)) {
      continue;
    }
    const fileContent = await readFile(filePath, "utf8");
    const parsed = parseEnv(fileContent);
    env = mergeEnv(env, parsed);
  }
  return env;
};

const resolveGitCommitSha = () => {
  try {
    return execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch (error) {
    console.warn("[generate-config] Impossible de déterminer le commit courant :", error.message);
    return "";
  }
};

const resolveGitCommitEpoch = () => {
  try {
    return execSync("git show -s --format=%ct HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    console.warn("[generate-config] Impossible de déterminer la date du commit :", error.message);
    return null;
  }
};

const resolveGitCommitMessage = () => {
  try {
    return execSync("git show -s --format=%s HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    console.warn("[generate-config] Impossible de déterminer le message du commit :", error.message);
    return "";
  }
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

  const commitInfo = deriveCommitInfo(env, { getFallbackSha: resolveGitCommitSha });
  if (commitInfo.short) {
    config.APP_REVISION = commitInfo.short;
  }
  if (commitInfo.full) {
    config.APP_REVISION_FULL = commitInfo.full;
  }
  const commitTimestamp = deriveCommitTimestamp(env, { getFallbackEpoch: resolveGitCommitEpoch });
  if (commitTimestamp) {
    config.APP_REVISION_DATE = commitTimestamp;
  }
  const commitMessage = deriveCommitMessage(env, { getFallbackMessage: resolveGitCommitMessage });
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
