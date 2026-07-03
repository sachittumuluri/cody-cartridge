#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const help = args.includes("--help") || args.includes("-h");
const nextVersion = args.find((arg) => !arg.startsWith("-"));

function usage() {
  console.log(`Usage: npm run version:store -- <x.y.z> [--dry-run]

Updates:
- package.json version
- package.json build.buildVersion
- package-lock.json top-level/root package version

Then run:
- npm run packet:store
- npm run check:store-version
- npm run manifest:store`);
}

function isStoreVersion(value) {
  const match = String(value ?? "").match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);

  if (!match) {
    return false;
  }

  return match.slice(1).every((segment) => Number(segment) <= 2147483647);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(projectRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

if (help) {
  usage();
  process.exit(0);
}

if (!isStoreVersion(nextVersion)) {
  usage();
  console.error("\nVersion must be numeric x.y.z with no prerelease/build metadata, for example 1.0.0.");
  process.exit(1);
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const currentVersion = pkg.version;

pkg.version = nextVersion;
pkg.build = pkg.build ?? {};
pkg.build.buildVersion = nextVersion;

lock.version = nextVersion;
lock.packages = lock.packages ?? {};
lock.packages[""] = lock.packages[""] ?? {};
lock.packages[""].version = nextVersion;

if (!dryRun) {
  writeJson("package.json", pkg);
  writeJson("package-lock.json", lock);
}

console.log(`${dryRun ? "Would update" : "Updated"} store version ${currentVersion} -> ${nextVersion}`);
console.log(`${dryRun ? "Would set" : "Set"} electron-builder buildVersion to ${nextVersion}`);

if (dryRun) {
  console.log("Dry run only; no files were changed.");
}
