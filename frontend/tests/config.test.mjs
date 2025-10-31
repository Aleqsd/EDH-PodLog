import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  deriveCommitInfo,
  deriveCommitMessage,
  deriveCommitTimestamp,
  mergeEnv,
  parseEnv,
} from "../scripts/lib/config-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/generate-config.mjs", import.meta.url));
const versionFilePath = fileURLToPath(new URL("../../VERSION", import.meta.url));

const readGeneratedConfig = async (outputPath) => {
  const raw = await readFile(outputPath, "utf8");
  const cleaned = raw
    .replace(/^window\.EDH_PODLOG_CONFIG\s*=\s*/u, "")
    .trim()
    .replace(/;$/u, "");
  return JSON.parse(cleaned);
};

test("parseEnv parses key/value lines and strips quotes", () => {
  const parsed = parseEnv(
    [
      "# comment to ignore",
      "FOO=bar",
      "QUOTED='value with spaces'",
      "DOUBLE=\"quoted\"",
      "EMPTY=",
    ].join("\n"),
  );

  assert.deepEqual(parsed, {
    FOO: "bar",
    QUOTED: "value with spaces",
    DOUBLE: "quoted",
    EMPTY: "",
  });
});

test("mergeEnv clones base env and applies overrides in order", () => {
  const base = { FOO: "1", BAR: "2" };
  const merged = mergeEnv(base, { BAR: "override" }, { BAZ: "3" });

  assert.deepEqual(merged, { FOO: "1", BAR: "override", BAZ: "3" });
  assert.notEqual(merged, base);
});

test("deriveCommitInfo prefers env values before fallback", () => {
  const env = {
    EDH_PODLOG_COMMIT_SHA: "abc123def456",
  };
  const info = deriveCommitInfo(env, { getFallbackSha: () => "should-not-be-used" });

  assert.equal(info.full, "abc123def456");
  assert.equal(info.short, "abc123de");
});

test("deriveCommitInfo uses fallback when env is empty", () => {
  const info = deriveCommitInfo({}, { getFallbackSha: () => "cafebabecafebabe" });
  assert.equal(info.full, "cafebabecafebabe");
  assert.equal(info.short, "cafebabe");
});

test("deriveCommitTimestamp reads epoch from env or uses fallback", () => {
  const envTimestamp = deriveCommitTimestamp(
    { EDH_PODLOG_COMMIT_TS: "1700000000" },
    { now: () => new Date("2024-01-01T00:00:00.000Z") },
  );
  assert.equal(envTimestamp, new Date(1700000000 * 1000).toISOString());

  const fallbackTimestamp = deriveCommitTimestamp(
    {},
    {
      getFallbackEpoch: () => "1700000001",
      now: () => new Date("2024-01-01T00:00:00.000Z"),
    },
  );
  assert.equal(fallbackTimestamp, new Date(1700000001 * 1000).toISOString());
});

test("deriveCommitMessage trims env values and respects fallback", () => {
  const messageFromEnv = deriveCommitMessage({ EDH_PODLOG_COMMIT_MESSAGE: "  shipping  " });
  assert.equal(messageFromEnv, "shipping");

  const messageFromFallback = deriveCommitMessage({}, { getFallbackMessage: () => "fallback message" });
  assert.equal(messageFromFallback, "fallback message");
});

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
  const projectVersion = (await readFile(versionFilePath, "utf8")).trim();
  assert.equal(config.APP_VERSION, projectVersion);

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
  const projectVersion = (await readFile(versionFilePath, "utf8")).trim();
  assert.equal(config.APP_VERSION, projectVersion);

  await rm(tempRoot, { recursive: true, force: true });
});
