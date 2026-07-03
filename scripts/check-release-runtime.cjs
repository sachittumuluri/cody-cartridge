#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
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

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8").trim();
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function assert(condition, message) {
  if (condition) {
    pass(message);
  } else {
    fail(message);
  }
}

function checkRuntimeMetadata() {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const nvmrc = readText(".nvmrc");
  const nodeVersion = readText(".node-version");

  assert(pkg.engines?.node === ">=20 <25", "package.json engines.node pins the release runtime range");
  assert(lock.packages?.[""]?.engines?.node === pkg.engines?.node, "package-lock root engines.node matches package.json");
  assert(nvmrc === "22", ".nvmrc selects the Node 22 release runtime");
  assert(nodeVersion === nvmrc, ".node-version matches .nvmrc");
}

function checkCurrentRuntime() {
  const major = Number(process.versions.node.split(".")[0]);

  if (major >= 20 && major < 25) {
    pass(`Current Node ${process.version} satisfies the release runtime range`);
    return;
  }

  const message = `Current Node ${process.version} is outside the release runtime range >=20 <25. Use Node 22 on the signed release machine.`;

  if (strict) {
    fail(message);
  } else {
    warn(`${message} Local advisory checks can continue.`);
  }
}

function main() {
  checkRuntimeMetadata();
  checkCurrentRuntime();

  console.log(`Release runtime checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
