#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const jsonPath = path.join(projectRoot, "app-store-assets", "SIGNING_ASSET_REPORT.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "SIGNING_ASSET_REPORT.md");
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

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function includesSecretMaterial(value) {
  const normalized = String(value)
    .replaceAll("/path/to/profile.provisionprofile", "<profile-placeholder>")
    .replaceAll("/path/to/profile.mobileprovision", "<profile-placeholder>");

  return (
    /BEGIN (?:RSA |EC |DSA |OPENSSH |)?PRIVATE KEY/i.test(normalized) ||
    /BEGIN CERTIFICATE/i.test(normalized) ||
    /\.p(?:12|8)\b/i.test(normalized) ||
    /\.cer\b/i.test(normalized) ||
    /\.mobileprovision\b/i.test(normalized) ||
    /\.provisionprofile\b/i.test(normalized) ||
    /Library\/MobileDevice\/Provisioning Profiles/i.test(normalized) ||
    /Library\/Developer\/Xcode\/UserData\/Provisioning Profiles/i.test(normalized) ||
    /Apple (?:Distribution|Development|Mac App Distribution|Mac Installer Distribution|Developer ID Application):\s/i.test(normalized)
  );
}

function main() {
  assert(exists(jsonPath), "Signing asset report JSON exists");
  assert(exists(markdownPath), "Signing asset report markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    return;
  }

  const pkg = readJson("package.json");
  const report = readJson("app-store-assets/SIGNING_ASSET_REPORT.json");
  const markdown = readText("app-store-assets/SIGNING_ASSET_REPORT.md");
  const raw = `${JSON.stringify(report)}\n${markdown}`;
  const blockers = report.blockers ?? [];

  assert(report.app?.bundleId === pkg.build?.appId, "Signing asset report bundle id matches package config");
  assert(report.app?.version === pkg.version, "Signing asset report version matches package config");
  assert(report.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Signing asset report build version matches package config");
  assert(["ready", "blocked"].includes(report.summary?.status), "Signing asset report records valid status");
  assert(report.summary?.blockerCount === blockers.length, "Signing asset report blocker count is accurate");
  assert(report.summary?.readyForMasSigning === (blockers.length === 0), "Signing asset report readiness matches blockers");

  [
    report.identities?.codeSigningIdentityCount,
    report.identities?.applicationDistributionIdentityCount,
    report.identities?.installerDistributionIdentityCount,
    report.identities?.developmentIdentityCount,
    report.identities?.distributionTeamIdCount,
    report.provisioningProfiles?.scannedProfileCount,
    report.provisioningProfiles?.decodedProfileCount,
    report.provisioningProfiles?.decodeErrorCount,
    report.provisioningProfiles?.storageIssueCount,
    report.provisioningProfiles?.matchingBundleIdProfileCount,
    report.provisioningProfiles?.distributionStyleProfileCount,
    report.provisioningProfiles?.macDistributionProfileCount,
    report.provisioningProfiles?.unexpiredMacDistributionProfileCount,
    report.provisioningProfiles?.expectedEntitlementProfileCount,
    report.provisioningProfiles?.teamMatchedProfileCount,
    report.provisioningProfiles?.developmentOrDeviceProfileCount
  ].forEach((value, index) => {
    assert(isNonNegativeInteger(value), `Signing asset report count ${index + 1} is a non-negative integer`);
  });

  assert(
    report.identities?.applicationDistributionIdentityCount <= report.identities?.codeSigningIdentityCount,
    "Signing asset report application identity count is bounded by total identities"
  );
  assert(
    report.identities?.installerDistributionIdentityCount <= report.identities?.codeSigningIdentityCount,
    "Signing asset report installer identity count is bounded by total identities"
  );
  assert(
    report.provisioningProfiles?.decodedProfileCount + report.provisioningProfiles?.decodeErrorCount ===
      report.provisioningProfiles?.scannedProfileCount,
    "Signing asset report profile decode counts add up"
  );
  assert(
    report.provisioningProfiles?.storageIssueCount === 0 ||
      blockers.includes("Provisioning profile directories and files must be regular files, not symlinks."),
    "Signing asset report blocks symlinked provisioning profile storage"
  );
  assert(
    report.provisioningProfiles?.unexpiredMacDistributionProfileCount <= report.provisioningProfiles?.macDistributionProfileCount,
    "Signing asset report unexpired macOS profile count is bounded"
  );
  assert(
    report.provisioningProfiles?.expectedEntitlementProfileCount <=
      report.provisioningProfiles?.unexpiredMacDistributionProfileCount,
    "Signing asset report entitlement-ready profile count is bounded"
  );
  assert(
    report.provisioningProfiles?.teamMatchedProfileCount <= report.provisioningProfiles?.expectedEntitlementProfileCount,
    "Signing asset report team-matched profile count is bounded"
  );

  assert(report.entitlements?.path === pkg.build?.mas?.entitlements, "Signing asset report entitlements path matches package config");
  assert(report.entitlements?.exists === true, "Signing asset report sees MAS entitlements file");
  assert(report.entitlements?.appSandbox === true, "Signing asset report requires app sandbox entitlement");
  assert(report.entitlements?.userSelectedReadOnly === true, "Signing asset report requires user-selected read-only entitlement");
  assert(report.entitlements?.appScopeBookmarks === true, "Signing asset report requires app-scope bookmarks entitlement");
  assert(report.entitlements?.networkClient === false, "Signing asset report records no network client entitlement");

  assert(report.readiness?.bundleIdConfigured === Boolean(pkg.build?.appId), "Signing asset report bundle-id readiness matches package config");
  assert(
    report.readiness?.hasApplicationDistributionIdentity ===
      ((report.identities?.applicationDistributionIdentityCount ?? 0) > 0),
    "Signing asset report application identity readiness matches count"
  );
  assert(
    report.readiness?.hasInstallerDistributionIdentity === ((report.identities?.installerDistributionIdentityCount ?? 0) > 0),
    "Signing asset report installer identity readiness matches count"
  );
  assert(
    report.readiness?.hasMatchingUnexpiredMacDistributionProfile ===
      ((report.provisioningProfiles?.unexpiredMacDistributionProfileCount ?? 0) > 0),
    "Signing asset report profile readiness matches count"
  );

  [
    "npm run check:signing-assets",
    "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run",
    "npm run check:mas-signing -- --strict",
    "npm run dist:mas",
    "npm run check:mas-package -- --strict"
  ].forEach((command) => {
    assert((report.commands ?? []).includes(command), `Signing asset report includes ${command}`);
  });

  assert(report.redaction?.storesIdentityNames === false, "Signing asset report records identity-name redaction");
  assert(report.redaction?.storesCertificateHashes === false, "Signing asset report records certificate-hash redaction");
  assert(report.redaction?.storesProvisioningProfileNames === false, "Signing asset report records profile-name redaction");
  assert(report.redaction?.storesProvisioningProfileUuids === false, "Signing asset report records profile-UUID redaction");
  assert(report.redaction?.storesLocalProfilePaths === false, "Signing asset report records local-profile-path redaction");
  assert(report.redaction?.storesAppleAccountValues === false, "Signing asset report records Apple-account redaction");
  assert(!raw.includes(os.homedir()), "Signing asset report excludes home-directory paths");
  assert(!includesSecretMaterial(raw), "Signing asset report excludes certificate/profile secret material");
  assert(!/<script\b/i.test(markdown), "Signing asset report markdown contains no script tags");
  assert(markdown.includes("# Cody Cartridge Signing Asset Report"), "Signing asset report markdown includes title");
  assert((report.sourceArtifacts ?? []).includes("scripts/install-mas-profile.cjs"), "Signing asset report records MAS profile installer source");
  assert(markdown.includes("Identity Inventory"), "Signing asset report markdown includes identity inventory");
  assert(markdown.includes("Provisioning Profile Inventory"), "Signing asset report markdown includes provisioning profile inventory");
  assert(markdown.includes("Redaction"), "Signing asset report markdown includes redaction section");

  if (blockers.length > 0) {
    warn(`Signing asset report records ${blockers.length} blocker(s)`);
  } else {
    pass("Signing asset report records no blockers");
  }
}

main();

console.log(`Signing asset report checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
