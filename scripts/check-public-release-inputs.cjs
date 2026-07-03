#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { isReleaseStoreEnvValue, loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const jsonPath = path.join(projectRoot, "app-store-assets", "PUBLIC_RELEASE_INPUTS.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "PUBLIC_RELEASE_INPUTS.md");
loadStoreEnv(projectRoot);

const passes = [];
const warnings = [];
const failures = [];
const requiredKeys = [
  "CODY_SITE_URL",
  "CODY_SUPPORT_EMAIL",
  "CODY_REVIEW_CONTACT_NAME",
  "CODY_REVIEW_CONTACT_EMAIL",
  "CODY_REVIEW_CONTACT_PHONE"
];

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  if (strict) {
    failures.push(message);
  } else {
    warnings.push(message);
  }
}

function assert(condition, message) {
  if (condition) {
    pass(message);
  } else {
    fail(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
}

function isPhone(value) {
  return /^\+?[0-9][0-9 ().-]{6,}[0-9]$/.test(String(value ?? ""));
}

function isPlaceholder(value) {
  return /^(?:TODO|your name|you@example\.com|https:\/\/example\.com|\+1-555-555-5555)/i.test(String(value ?? "").trim());
}

function currentStateForKey(key) {
  const value = process.env[key] ?? "";

  if (!value) {
    return "missing";
  }

  if (isPlaceholder(value)) {
    return "placeholder";
  }

  if (key === "CODY_SITE_URL" && !isReleaseStoreEnvValue(key, value)) {
    return "invalid";
  }

  if ((key === "CODY_SUPPORT_EMAIL" || key === "CODY_REVIEW_CONTACT_EMAIL") && !isEmail(value)) {
    return "invalid";
  }

  if (key === "CODY_REVIEW_CONTACT_NAME" && String(value).trim().length < 2) {
    return "invalid";
  }

  if (key === "CODY_REVIEW_CONTACT_PHONE" && !isPhone(value)) {
    return "invalid";
  }

  return "ready";
}

function main() {
  assert(fs.existsSync(jsonPath), "Public release inputs JSON exists");
  assert(fs.existsSync(markdownPath), "Public release inputs markdown exists");

  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath)) {
    return;
  }

  const inputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json");
  const markdown = readText("app-store-assets/PUBLIC_RELEASE_INPUTS.md");
  const pkg = readJson("package.json");
  const fields = inputs.fields ?? [];
  const keySet = new Set(fields.map((field) => field.key));
  const readyFields = fields.filter((field) => field.status === "ready");
  const blockedFields = fields.filter((field) => field.status !== "ready");
  const rawJson = JSON.stringify(inputs);

  assert(inputs.app?.bundleId === pkg.build?.appId, "Public release inputs bundle id matches package config");
  assert(inputs.app?.version === pkg.version, "Public release inputs version matches package config");
  assert(inputs.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Public release inputs build version matches package config");
  assert(fields.length === requiredKeys.length, "Public release inputs record every required field");
  requiredKeys.forEach((key) => {
    assert(keySet.has(key), `Public release inputs include ${key}`);
  });
  assert(inputs.summary?.requiredCount === fields.length, "Public release inputs required count is accurate");
  assert(inputs.summary?.readyCount === readyFields.length, "Public release inputs ready count is accurate");
  assert(inputs.summary?.blockerCount === blockedFields.length, "Public release inputs blocker count is accurate");
  assert(inputs.summary?.readyForPublicInputs === (blockedFields.length === 0), "Public release inputs readiness flag matches blocked fields");

  fields.forEach((field) => {
    const expectedState = currentStateForKey(field.key);
    assert(field.valueState === expectedState, `Public release inputs ${field.key} value state matches current env`);
    assert(field.status === (expectedState === "ready" ? "ready" : "blocked"), `Public release inputs ${field.key} status matches current env`);
    assert(field.redactedValue === (expectedState === "ready" ? "configured" : expectedState), `Public release inputs ${field.key} value is redacted`);
    assert(Boolean(field.appStoreUse), `Public release inputs ${field.key} records App Store use`);
    assert(Boolean(field.nextAction), `Public release inputs ${field.key} records next action`);
  });

  assert(inputs.releaseEnv?.privateFilesExcludedFromHandoff?.includes("app-store-assets/site.env"), "Public release inputs records private env exclusion");
  assert(
    Array.isArray(inputs.releaseEnv?.precedence) &&
      inputs.releaseEnv.precedence.join(" > ") === "shell env > app-store-assets/site.env.local > app-store-assets/site.env",
    "Public release inputs records release env precedence"
  );
  assert((inputs.sourceArtifacts ?? []).includes("app-store-assets/site.env.example"), "Public release inputs records env template source");
  assert((inputs.sourceArtifacts ?? []).includes("app-store-assets/RELEASE_BLOCKERS.json"), "Public release inputs records blocker source");
  assert((inputs.sourceArtifacts ?? []).includes("scripts/refresh-public-release.cjs"), "Public release inputs records public release refresh source");
  assert((inputs.sourceArtifacts ?? []).includes("scripts/build-public-host-runbook.cjs"), "Public release inputs records public host runbook source");
  assert((inputs.commands ?? []).includes("npm run check:store-env"), "Public release inputs includes env check command");
  assert(
    (inputs.commands ?? []).some((command) => command.startsWith("npm run configure:store-env -- --dry-run")),
    "Public release inputs includes store env configurator dry-run command"
  );
  assert((inputs.commands ?? []).includes("npm run public-release:store -- --self-test"), "Public release inputs includes public release refresh self-test command");
  assert((inputs.commands ?? []).includes("npm run public-release:store:node -- --self-test"), "Public release inputs includes Node-safe public release refresh self-test command");
  assert((inputs.commands ?? []).includes("npm run public-release:store -- --dry-run"), "Public release inputs includes public release refresh dry-run command");
  assert((inputs.commands ?? []).includes("npm run public-release:store:node -- --dry-run"), "Public release inputs includes Node-safe public release dry-run command");
  assert((inputs.commands ?? []).includes("npm run public-release:store:published:node"), "Public release inputs includes Node-safe published public release refresh command");
  assert((inputs.commands ?? []).includes("npm run publish-packet:store"), "Public release inputs includes public site publish packet command");
  assert((inputs.commands ?? []).includes("npm run public-host:store"), "Public release inputs includes public host runbook command");
  assert((inputs.commands ?? []).includes("npm run check:published-site -- --strict"), "Public release inputs includes strict published-site check command");
  assert(
    (inputs.commands ?? []).includes("npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store"),
    "Public release inputs includes blocker-refresh, publish-packet, and public-host command"
  );
  assert(!rawJson.includes("you@example.com"), "Public release inputs JSON excludes placeholder email values");
  assert(!rawJson.includes("+1-555-555-5555"), "Public release inputs JSON excludes placeholder phone values");
  assert(!rawJson.includes("Your Name"), "Public release inputs JSON excludes placeholder names");
  assert(markdown.includes("# Cody Cartridge Public Release Inputs"), "Public release inputs markdown includes title");
  assert(markdown.includes("Required Values"), "Public release inputs markdown includes required values table");
  assert(markdown.includes("app-store-assets/site.env"), "Public release inputs markdown names ignored env file");
  assert(markdown.includes("site.env.local") && markdown.includes("overrides"), "Public release inputs markdown documents local env override");
  assert(markdown.includes("configure:store-env"), "Public release inputs markdown documents store env configurator");
  assert(markdown.includes("public-release:store"), "Public release inputs markdown documents public release refresh helper");
  assert(markdown.includes("chmod 600 app-store-assets/site.env"), "Public release inputs markdown documents private env file permissions");
  assert(markdown.includes("release:store:preflight") || markdown.includes("check:store-env"), "Public release inputs markdown includes release validation command");

  if (blockedFields.length > 0) {
    warn(`Public release inputs record ${blockedFields.length} blocked field(s)`);
  } else {
    pass("Public release inputs record no blocked fields");
  }
}

main();

console.log(`Public release inputs checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
