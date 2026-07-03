#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
const electronBuilderBinary = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder"
);

const passes = [];
const warnings = [];
const failures = [];

function pass(message) {
  passes.push(message);
}

function warn(message) {
  warnings.push(message);
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

function run(command, args) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function checkBuilderDependencyOverride() {
  const override = packageJson.overrides?.["@noble/hashes"];
  const lockedHashes = packageLock.packages?.["node_modules/app-builder-lib/node_modules/@noble/hashes"];

  assert(override === "1.8.0", "package.json pins @noble/hashes to the CommonJS-compatible 1.8.0 release");
  assert(lockedHashes?.version === "1.8.0", "package-lock resolves app-builder-lib @noble/hashes to 1.8.0");

  if (lockedHashes?.version && !String(lockedHashes.version).startsWith("1.")) {
    fail(`app-builder-lib resolved @noble/hashes ${lockedHashes.version}, which is ESM-only for the builder's CommonJS require path`);
  }
}

function checkBuilderCanLoadBlockmap() {
  try {
    require("app-builder-lib/out/targets/blockmap/blockmap.js");
    pass("app-builder-lib blockmap module loads without ERR_REQUIRE_ESM");
  } catch (error) {
    fail(`app-builder-lib blockmap module failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function checkElectronBuilderCli() {
  assert(fs.existsSync(electronBuilderBinary), "electron-builder binary exists in node_modules");

  if (!fs.existsSync(electronBuilderBinary)) {
    return;
  }

  const result = run(electronBuilderBinary, ["--version"]);
  const output = `${result.stdout}${result.stderr}`.trim();

  if (result.status === 0 && /^26\.15\.5\b/.test(output)) {
    pass("electron-builder CLI loads and reports version 26.15.5");
  } else {
    fail(`electron-builder CLI failed to load cleanly: ${output || result.error?.message || `exit ${result.status}`}`);
  }
}

function checkNodeRuntime() {
  const major = Number(process.versions.node.split(".")[0]);

  if (major >= 20 && major < 25) {
    pass(`Node ${process.version} satisfies the preferred packaging runtime`);
  } else {
    warn(`Node ${process.version} can run the local gates, but the release machine should use Node >=20 <25, preferably the Node 22 version selected by .nvmrc.`);
  }
}

function main() {
  checkBuilderDependencyOverride();
  checkBuilderCanLoadBlockmap();
  checkElectronBuilderCli();
  checkNodeRuntime();

  console.log(`Packaging toolchain checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
