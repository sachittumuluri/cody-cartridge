#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "UPLOAD_EVIDENCE.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "UPLOAD_EVIDENCE.md");
const strict = process.argv.includes("--strict");
const passes = [];
const warnings = [];
const failures = [];

function pass(message) {
  passes.push(message);
}

function warn(message) {
  if (strict) {
    failures.push(message);
  } else {
    warnings.push(message);
  }
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

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function includesSecretMaterial(value) {
  return (
    /BEGIN (?:RSA |EC |DSA |OPENSSH |)?PRIVATE KEY/i.test(value) ||
    /\.p(?:12|8)\b/i.test(value) ||
    /\.cer\b/i.test(value) ||
    /\.mobileprovision\b/i.test(value) ||
    /\.provisionprofile\b/i.test(value) ||
    /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/i.test(value) ||
    /\b(?:api[_-]?key|issuer[_-]?id|key[_-]?id|token|password|secret|authorization)\s*[:=]\s*["']?[^"',\s<]+/i.test(value) ||
    /Apple (?:Distribution|Development|Mac Distribution|Mac App Distribution|Mac Installer Distribution):\s/i.test(value)
  );
}

function validateHash(value, label) {
  assert(/^[a-f0-9]{64}$/i.test(String(value ?? "")), `${label} is a SHA-256 hash`);
}

function main() {
  assert(exists(jsonPath), "Upload evidence JSON exists");
  assert(exists(markdownPath), "Upload evidence markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    finish();
    return;
  }

  const pkg = readJson("package.json");
  const evidence = readJson("app-store-assets/UPLOAD_EVIDENCE.json");
  const markdown = readText("app-store-assets/UPLOAD_EVIDENCE.md");
  const raw = `${JSON.stringify(evidence)}\n${markdown}`;

  assert(evidence.app?.bundleId === pkg.build?.appId, "Upload evidence bundle id matches package config");
  assert(evidence.app?.version === pkg.version, "Upload evidence version matches package config");
  assert(evidence.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Upload evidence build version matches package config");
  assert(["pending", "uploaded", "processing", "processed", "selected", "blocked"].includes(evidence.upload?.status), "Upload evidence status is known");
  assert(evidence.upload?.logCount === (evidence.logs ?? []).length, "Upload evidence log count matches logs");
  assert(evidence.upload?.hasDeliveryLogs === ((evidence.logs ?? []).length > 0), "Upload evidence delivery-log flag matches logs");
  assert(evidence.redaction?.storesRawLogs === false, "Upload evidence records raw-log exclusion");
  assert(evidence.redaction?.redactsApiCredentials === true, "Upload evidence records API credential redaction");
  assert(evidence.redaction?.redactsSigningMaterial === true, "Upload evidence records signing-material redaction");
  assert(evidence.buildSelection?.appStoreConnectLocation === "App Store Connect > macOS app version > Build", "Upload evidence records App Store Connect build-selection location");
  assert(evidence.buildSelection?.requiredStatus === "selected", "Upload evidence records selected-build status requirement");
  assert(evidence.buildSelection?.status === evidence.upload?.status, "Upload evidence build-selection status mirrors upload status");
  assert(
    evidence.buildSelection?.hasDeliveryLogs === evidence.upload?.hasDeliveryLogs,
    "Upload evidence build-selection delivery-log flag mirrors upload evidence"
  );

  if (evidence.processedBuild?.bundleId || evidence.processedBuild?.version || evidence.processedBuild?.buildVersion) {
    assert(
      evidence.processedBuild?.matchesPackage ===
        (evidence.processedBuild?.bundleId === pkg.build?.appId &&
          evidence.processedBuild?.version === pkg.version &&
          evidence.processedBuild?.buildVersion === (pkg.build?.buildVersion ?? pkg.version)),
      "Upload evidence processed-build match flag is accurate"
    );
  }
  assert(
    evidence.buildSelection?.hasProcessedBuildValues ===
      Boolean(evidence.processedBuild?.bundleId && evidence.processedBuild?.version && evidence.processedBuild?.buildVersion),
    "Upload evidence build-selection processed-value flag is accurate"
  );
  assert(
    evidence.buildSelection?.processedBuildMatchesPackage === evidence.processedBuild?.matchesPackage,
    "Upload evidence build-selection package-match flag mirrors processed build"
  );
  assert(
    evidence.buildSelection?.selectedInAppStoreConnect ===
      (evidence.upload?.status === "selected" && evidence.processedBuild?.matchesPackage === true),
    "Upload evidence selected-build flag is accurate"
  );
  assert(
    evidence.buildSelection?.proofComplete ===
      (evidence.buildSelection?.selectedInAppStoreConnect === true && evidence.upload?.hasDeliveryLogs === true),
    "Upload evidence build-selection proof-complete flag is accurate"
  );
  assert(
    Array.isArray(evidence.buildSelection?.requiredProof) && evidence.buildSelection.requiredProof.length >= 4,
    "Upload evidence records required build-selection proof checklist"
  );
  assert(
    (evidence.buildSelection?.postSelectionCommands ?? []).includes("npm run check:upload-evidence -- --strict"),
    "Upload evidence records strict post-selection proof command"
  );

  (evidence.logs ?? []).forEach((item, index) => {
    assert(typeof item.label === "string" && item.label.length > 0 && !item.label.includes("/"), `Upload evidence log ${index + 1} has basename label`);
    assert(["transporter", "altool", "xcode", "other", "unspecified"].includes(item.tool), `Upload evidence log ${index + 1} tool is classified`);
    validateHash(item.rawSha256, `Upload evidence log ${index + 1} raw hash`);
    assert(Number.isInteger(item.sizeBytes) && item.sizeBytes > 0, `Upload evidence log ${index + 1} has positive size`);
    assert(Number.isInteger(item.lineCount) && item.lineCount >= item.sanitizedLineCount, `Upload evidence log ${index + 1} line counts are valid`);
    assert(Array.isArray(item.sanitizedInterestingLines), `Upload evidence log ${index + 1} sanitized lines are listed`);
    assert(item.sanitizedInterestingLines.length <= 80, `Upload evidence log ${index + 1} stores bounded sanitized excerpts`);
  });

  [
    "npm run upload-evidence:store",
    "npm run check:upload-evidence",
    "npm run check:upload-evidence -- --strict",
    "npm run evidence:store",
    "npm run manifest:store",
    "npm run handoff:store"
  ].forEach((command) => {
    assert((evidence.commands ?? []).includes(command), `Upload evidence records command: ${command}`);
  });

  assert(markdown.includes("# Cody Cartridge Upload Evidence"), "Upload evidence markdown includes title");
  assert(markdown.includes("Build Selection Proof"), "Upload evidence markdown includes build-selection proof section");
  assert(markdown.includes("App Store Connect > macOS app version > Build"), "Upload evidence markdown names App Store Connect build field");
  assert(markdown.includes("Sanitized Delivery Logs"), "Upload evidence markdown includes delivery log section");
  assert(markdown.includes("Redaction"), "Upload evidence markdown includes redaction section");
  assert(!raw.includes(projectRoot), "Upload evidence redacts project root path");
  assert(!raw.includes(os.homedir()), "Upload evidence redacts home directory path");
  assert(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(raw), "Upload evidence redacts raw email addresses");
  assert(!includesSecretMaterial(raw), "Upload evidence excludes credential and signing secret material");

  if (evidence.buildSelection?.proofComplete !== true || evidence.upload?.hasProcessedBuildProof !== true) {
    warn("Upload evidence is pending delivery logs, processed-build proof, or selected-build proof");
  } else {
    pass("Upload evidence records delivery logs, processed-build proof, and selected-build proof");
  }

  finish();
}

function finish() {
  console.log(`Upload evidence checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));
  failures.forEach((message) => console.error(`FAIL ${message}`));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
