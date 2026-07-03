#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourceOnly = process.argv.includes("--source-only");
const jsonPath = path.join(projectRoot, "app-store-assets", "EXPORT_COMPLIANCE.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "EXPORT_COMPLIANCE.md");
const passes = [];
const failures = [];
const expectedSourceUrls = [
  "https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/",
  "https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/"
];

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

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function main() {
  assert(exists(jsonPath), "Export compliance JSON exists");
  assert(exists(markdownPath), "Export compliance markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    console.log(`Export compliance checks: ${passes.length} passed, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const pkg = readJson("package.json");
  const artifact = readJson("app-store-assets/EXPORT_COMPLIANCE.json");
  const markdown = readText("app-store-assets/EXPORT_COMPLIANCE.md");
  const readiness = readText("APP_STORE_READINESS.md");
  const appEntitlements = readText("build/entitlements.mas.plist");
  const packageScripts = pkg.scripts ?? {};
  const fieldsPath = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_FIELDS.json");
  const fields = exists(fieldsPath) ? readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json") : null;
  const packetPath = path.join(projectRoot, "app-store-assets", "SUBMISSION_PACKET.md");
  const packet = exists(packetPath) ? readText("app-store-assets/SUBMISSION_PACKET.md") : "";

  assert(artifact.app?.bundleId === pkg.build?.appId, "Export compliance bundle id matches package config");
  assert(artifact.app?.version === pkg.version, "Export compliance package version matches package config");
  assert(artifact.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Export compliance build version matches package config");
  assert(artifact.artifactPath === "app-store-assets/EXPORT_COMPLIANCE.json", "Export compliance artifact path is stable");
  assert(artifact.markdownPath === "app-store-assets/EXPORT_COMPLIANCE.md", "Export compliance markdown path is stable");
  assert(artifact.summary?.status === "ready-for-app-store-connect-questionnaire", "Export compliance prep status is ready");
  assert(artifact.summary?.reviewCount === 0, "Export compliance facts have no review flags");
  assert(
    artifact.summary?.appStoreConnectDraftAnswer?.includes("no custom or proprietary encryption") &&
      artifact.summary?.appStoreConnectDraftAnswer?.includes("Apple operating system"),
    "Export compliance draft answer covers no custom encryption and Apple OS encryption"
  );
  assert(
    artifact.summary?.finalBinaryRequirement?.includes("exact signed MAS binary"),
    "Export compliance final-binary requirement is explicit"
  );
  assert(
    JSON.stringify(artifact.appStoreConnect?.sourceUrls ?? []) === JSON.stringify(expectedSourceUrls),
    "Export compliance records the expected Apple source URLs"
  );
  assert(
    artifact.appStoreConnect?.documentationExpectation?.includes("No documentation expected") &&
      artifact.appStoreConnect?.documentationExpectation?.includes("Apple operating system"),
    "Export compliance documentation expectation matches Apple OS encryption guidance"
  );
  assert(Array.isArray(artifact.binaryFacts) && artifact.binaryFacts.length >= 8, "Export compliance records binary facts");
  assert(artifact.binaryFacts.every((item) => item.status === "pass"), "All export compliance binary facts pass");
  assert(artifact.evidence?.networkClientEntitlement === false, "Export compliance evidence records no network client entitlement");
  assert(artifact.evidence?.infoPlistExportKey === false, "Export compliance evidence records ITSAppUsesNonExemptEncryption=false");
  assert(!appEntitlements.includes("com.apple.security.network.client"), "MAS app entitlements still omit network client access");
  assert(pkg.build?.mac?.extendInfo?.ITSAppUsesNonExemptEncryption === false, "Package config stamps ITSAppUsesNonExemptEncryption=false into Info.plist");
  assert(Array.isArray(artifact.evidence?.customCryptoDependencies) && artifact.evidence.customCryptoDependencies.length === 0, "Export compliance evidence has no direct custom crypto dependencies");
  assert(Array.isArray(artifact.evidence?.unexpectedRemoteUrls) && artifact.evidence.unexpectedRemoteUrls.length === 0, "Export compliance evidence has no unexpected remote URLs");
  assert(markdown.includes("# Cody Cartridge Export Compliance Prep"), "Export compliance markdown includes title");
  assert(markdown.includes("## App Store Connect Draft"), "Export compliance markdown includes App Store Connect draft section");
  assert(markdown.includes("ITSAppUsesNonExemptEncryption=false"), "Export compliance markdown includes Info.plist export key");
  assert(markdown.includes("## Apple Sources"), "Export compliance markdown includes Apple sources section");
  expectedSourceUrls.forEach((url) => {
    assert(markdown.includes(url), `Export compliance markdown links ${url}`);
  });

  if (!sourceOnly && fields) {
    assert(fields.exportCompliance?.artifactPath === "app-store-assets/EXPORT_COMPLIANCE.json", "App Store fields include export compliance artifact path");
    assert(
      fields.exportCompliance?.summary?.appStoreConnectDraftAnswer === artifact.summary.appStoreConnectDraftAnswer,
      "App Store fields export compliance draft matches artifact"
    );
    assert(
      fields.rightsAndCompliance?.exportCompliance?.includes("Apple operating system"),
      "Rights/compliance field includes Apple operating system export guidance"
    );
  }

  if (!sourceOnly && packet) {
    assert(packet.includes("## Export Compliance"), "Submission packet includes export compliance section");
    assert(packet.includes("npm run check:export-compliance"), "Submission packet includes export compliance gate");
  }

  assert(packageScripts["export-compliance:store"]?.includes("scripts/build-export-compliance.cjs"), "package.json has export-compliance build script");
  assert(packageScripts["export-compliance:store"]?.includes("--source-only"), "package.json export-compliance build script uses source-only pre-packet check");
  assert(packageScripts["check:export-compliance"]?.includes("scripts/check-export-compliance.cjs"), "package.json has export-compliance check script");
  assert(packageScripts["release:store:local"]?.includes("npm run export-compliance:store"), "Local release dry-run builds export compliance prep");
  assert(packageScripts["release:store:local"]?.includes("npm run check:export-compliance"), "Local release dry-run checks export compliance prep after packet");
  assert(packageScripts["release:store:preflight"]?.includes("npm run export-compliance:store"), "Release preflight builds export compliance prep");
  assert(packageScripts["release:store:preflight"]?.includes("npm run check:export-compliance"), "Release preflight checks export compliance prep after packet");
  assert(readiness.includes("npm run check:export-compliance"), "Readiness guide documents export compliance checker");
  assert(readiness.includes("Export Compliance Prep"), "Readiness guide documents export compliance prep section");

  console.log(`Export compliance checks: ${passes.length} passed, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
