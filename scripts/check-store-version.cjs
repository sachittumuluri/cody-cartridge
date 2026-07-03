#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourceOnly = process.argv.includes("--source-only");
const passes = [];
const failures = [];

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
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

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function isStoreVersion(value) {
  const match = String(value ?? "").match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);

  if (!match) {
    return false;
  }

  return match.slice(1).every((segment) => Number(segment) <= 2147483647);
}

function main() {
  const pkg = readJson("package.json");
  const lock = exists("package-lock.json") ? readJson("package-lock.json") : null;
  const fields = !sourceOnly && exists("app-store-assets/APP_STORE_CONNECT_FIELDS.json")
    ? readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json")
    : null;

  assert(isStoreVersion(pkg.version), "package.json version is App Store-compatible x.y.z numeric version");
  assert(!/[+-]/.test(String(pkg.version)), "package.json version has no prerelease or build metadata");
  assert(pkg.build?.buildVersion === pkg.version, "electron-builder buildVersion is explicit and matches package version");
  assert(!pkg.build?.buildNumber, "electron-builder buildNumber is not configured");

  if (lock) {
    assert(lock.version === pkg.version, "package-lock top-level version matches package.json");
    assert(lock.packages?.[""]?.version === pkg.version, "package-lock root package version matches package.json");
  } else {
    fail("package-lock.json is missing");
  }

  if (fields) {
    assert(fields.app?.packageVersion === pkg.version, "Generated App Store fields package version matches package.json");
    assert(fields.app?.buildVersion === pkg.build?.buildVersion, "Generated App Store fields build version matches package config");
    assert(
      fields.submission?.upload?.processingChecks?.some((item) => item.includes(`version ${pkg.version}`)),
      "Generated App Store fields processing checks mention current version"
    );
  }

  if (sourceOnly) {
    pass("Generated App Store fields check skipped in source-only mode");
  }

  console.log(`Store version checks${sourceOnly ? " (source-only)" : ""}: ${passes.length} passed, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
