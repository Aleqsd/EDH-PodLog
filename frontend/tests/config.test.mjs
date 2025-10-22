import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/generate-config.mjs", import.meta.url));

const readGeneratedConfig = async (outputPath) => {
  const raw = await readFile(outputPath, "utf8");
  const cleaned = raw
    .replace(/^window\.EDH_PODLOG_CONFIG\s*=\s*/u, "")
    .trim()
    .replace(/;$/u, "");
  return JSON.parse(cleaned);
};

test("generate-config falls back to defaults without env files", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "edh-podlog-config-default-"));
  const outputPath = join(tempRoot, "config.js");

  const env = { ...process.env };
  delete env.GOOGLE_CLIENT_ID;
  delete env.API_BASE_URL;
  env.EDH_PODLOG_ENV_ROOT = tempRoot;
  env.EDH_PODLOG_CONFIG_OUT = outputPath;

  await execFileAsync("node", [scriptPath], { env });

  const config = await readGeneratedConfig(outputPath);
  assert.equal(config.GOOGLE_CLIENT_ID, "REMPLACEZ_MOI_PAR_VOTRE_CLIENT_ID");
  assert.equal(config.API_BASE_URL, "http://localhost:4310");

  await rm(tempRoot, { recursive: true, force: true });
});

test("generate-config honours values provided in env files", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "edh-podlog-config-env-"));
  const outputPath = join(tempRoot, "config.js");
  const envFile = join(tempRoot, ".env");

  await writeFile(
    envFile,
    [
      "GOOGLE_CLIENT_ID=unit-test-client",
      "API_BASE_URL=http://localhost:9999",
    ].join("\n"),
    "utf8",
  );

  const env = { ...process.env };
  env.EDH_PODLOG_ENV_ROOT = tempRoot;
  env.EDH_PODLOG_CONFIG_OUT = outputPath;
  delete env.GOOGLE_CLIENT_ID;
  delete env.API_BASE_URL;

  await execFileAsync("node", [scriptPath], { env });

  const config = await readGeneratedConfig(outputPath);
  assert.equal(config.GOOGLE_CLIENT_ID, "unit-test-client");
  assert.equal(config.API_BASE_URL, "http://localhost:9999");

  await rm(tempRoot, { recursive: true, force: true });
});
