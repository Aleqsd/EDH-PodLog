#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

  const fileContent = `window.EDH_PODLOG_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
  await writeFile(outputPath, fileContent, "utf8");
  console.log(`[generate-config] Fichier généré : ${outputPath}`);
};

main().catch((error) => {
  console.error("[generate-config] Échec de la génération du fichier config.js");
  console.error(error);
  process.exit(1);
});
