#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const { isHttpsOrigin, isStoreEnvPlaceholder, loadStoreEnv, releaseEnvKeys } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const loadedFiles = loadStoreEnv(projectRoot);
const failures = [];
const passes = [];
const requiredKeys = releaseEnvKeys;

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
}

function isPhone(value) {
  return /^\+?[0-9][0-9 ().-]{6,}[0-9]$/.test(String(value ?? ""));
}

function check(key, label, predicate) {
  const value = process.env[key];

  if (!value || isStoreEnvPlaceholder(value) || !predicate(value)) {
    failures.push(`${label} is missing, placeholder, or invalid (${key}).`);
    return;
  }

  passes.push(`${label} is set`);
}

function checkLoadedFilePosture(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const linkStats = fs.lstatSync(absolutePath);

  if (linkStats.isSymbolicLink()) {
    failures.push(`${relativePath} must be a regular private file, not a symlink.`);
    return;
  }

  const stats = fs.statSync(absolutePath);

  if (!stats.isFile()) {
    failures.push(`${relativePath} must be a regular private file.`);
    return;
  }

  const mode = stats.mode & 0o777;
  const modeText = mode.toString(8).padStart(3, "0");

  if ((mode & 0o077) !== 0) {
    failures.push(`${relativePath} permissions are too broad (${modeText}); run chmod 600 ${relativePath}.`);
    return;
  }

  passes.push(`${relativePath} permissions are private (${modeText})`);
}

if (loadedFiles.length === 0 && requiredKeys.some((key) => !process.env[key])) {
  failures.push(`No store env file found. Run npm run init:store-env and fill ignored app-store-assets/site.env with real values, or export ${requiredKeys.join(", ")} in the shell.`);
}

loadedFiles.forEach(checkLoadedFilePosture);

check("CODY_SITE_URL", "Public site URL origin", isHttpsOrigin);
check("CODY_SUPPORT_EMAIL", "Support email", isEmail);
check("CODY_REVIEW_CONTACT_NAME", "App Review contact name", (value) => String(value).trim().length >= 2);
check("CODY_REVIEW_CONTACT_EMAIL", "App Review contact email", isEmail);
check("CODY_REVIEW_CONTACT_PHONE", "App Review contact phone", isPhone);

console.log(`Store env preflight: ${passes.length} passed, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
