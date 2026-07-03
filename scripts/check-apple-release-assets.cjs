#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const jsonPath = path.join(projectRoot, "app-store-assets", "APPLE_RELEASE_ASSETS.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "APPLE_RELEASE_ASSETS.md");
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

function exists(filePath) {
  return fs.existsSync(path.join(projectRoot, filePath));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (condition) {
    pass(message);
  } else {
    fail(message);
  }
}

function includesSecretMaterial(value) {
  const text = JSON.stringify(value);
  return (
    /BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY/i.test(text) ||
    /AuthKey_[A-Z0-9]{6,}\.p8/.test(text) ||
    /[A-F0-9]{40}\s+"(?:Apple|Mac|3rd Party)/i.test(text) ||
    /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i.test(text) ||
    /Library\/MobileDevice\/Provisioning Profiles/i.test(text) ||
    /Library\/Developer\/Xcode\/UserData\/Provisioning Profiles/i.test(text)
  );
}

function main() {
  assert(fs.existsSync(jsonPath), "Apple release asset packet JSON exists");
  assert(fs.existsSync(markdownPath), "Apple release asset packet markdown exists");

  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath)) {
    console.log(`Apple release asset checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const pkg = readJson("package.json");
  const packet = readJson("app-store-assets/APPLE_RELEASE_ASSETS.json");
  const markdown = readText("app-store-assets/APPLE_RELEASE_ASSETS.md");
  const requests = packet.assetRequests ?? [];
  const requestIds = requests.map((item) => item.id);
  const statusCounts = requests.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});

  assert(packet.app?.bundleId === pkg.build?.appId, "Apple release asset packet bundle id matches package config");
  assert(packet.app?.version === pkg.version, "Apple release asset packet version matches package config");
  assert(packet.summary?.assetRequestCount === requests.length, "Apple release asset packet request count matches array");
  assert(packet.summary?.readyCount === (statusCounts.ready ?? 0), "Apple release asset packet ready count is accurate");
  assert(packet.summary?.manualCount === (statusCounts.manual ?? 0), "Apple release asset packet manual count is accurate");
  assert(packet.summary?.blockerCount === (statusCounts.blocked ?? 0), "Apple release asset packet blocker count is accurate");
  assert(packet.summary?.readyForSigningAndUpload === ((statusCounts.blocked ?? 0) === 0), "Apple release asset packet readiness flag matches blockers");
  [
    "app-store-connect-app-record",
    "application-distribution-certificate",
    "installer-distribution-certificate",
    "mas-provisioning-profile",
    "signed-mas-package",
    "app-store-connect-api-key"
  ].forEach((id) => {
    assert(requestIds.includes(id), `Apple release asset packet includes ${id}`);
  });
  requests.forEach((item) => {
    assert(["ready", "manual", "blocked"].includes(item.status), `${item.id} has known status`);
    assert(String(item.ownerSystem ?? "").length > 0, `${item.id} records owner system`);
    assert(String(item.request ?? "").length > 0, `${item.id} records request`);
    assert(Array.isArray(item.acceptanceCriteria) && item.acceptanceCriteria.length >= 3, `${item.id} records acceptance criteria`);
    assert(Array.isArray(item.validationCommands) && item.validationCommands.length > 0, `${item.id} records validation commands`);
  });
  [
    "com.apple.security.app-sandbox",
    "com.apple.security.files.user-selected.read-only",
    "com.apple.security.files.bookmarks.app-scope"
  ].forEach((key) => {
    assert(packet.entitlements?.required?.includes(key), `Apple release asset packet records entitlement ${key}`);
  });
  [
    "npm run signing-assets:store",
    "npm run apple-assets:store",
    "npm run check:mas-signing -- --strict",
    "npm run dist:mas",
    "npm run check:mas-package -- --strict",
    "npm run upload-packet:store",
    "npm run check:upload-credentials -- --strict"
  ].forEach((command) => {
    assert(packet.validationFlow?.includes(command), `Apple release asset packet includes validation command ${command}`);
  });
  [
    "package.json",
    "build/entitlements.mas.plist",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/install-mas-profile.cjs",
    "scripts/install-asc-key.cjs"
  ].forEach((artifact) => {
    assert(packet.sourceArtifacts?.includes(artifact), `Apple release asset packet records source artifact ${artifact}`);
    assert(exists(artifact), `Apple release asset packet source artifact exists: ${artifact}`);
  });
  assert(packet.redaction?.storesCertificateNames === false, "Apple release asset packet records certificate-name redaction");
  assert(packet.redaction?.storesCertificateHashes === false, "Apple release asset packet records certificate-hash redaction");
  assert(packet.redaction?.storesProvisioningProfileNames === false, "Apple release asset packet records profile-name redaction");
  assert(packet.redaction?.storesProvisioningProfileUuids === false, "Apple release asset packet records profile-UUID redaction");
  assert(packet.redaction?.storesAppleAccountEmails === false, "Apple release asset packet records Apple-account redaction");
  assert(packet.redaction?.storesApiKeyIds === false, "Apple release asset packet records API-key-id redaction");
  assert(packet.redaction?.storesPrivateKeyPaths === false, "Apple release asset packet records private-key path redaction");
  assert(packet.redaction?.storesLocalProfilePaths === false, "Apple release asset packet records local profile path redaction");
  assert(!includesSecretMaterial(packet) && !includesSecretMaterial(markdown), "Apple release asset packet excludes signing/API secret material");
  assert(markdown.includes("# Cody Cartridge Apple Release Asset Requests"), "Apple release asset markdown includes title");
  assert(markdown.includes("## Request Table"), "Apple release asset markdown includes request table");
  assert(markdown.includes("## Asset Details"), "Apple release asset markdown includes details");
  assert(markdown.includes("## Validation Flow"), "Apple release asset markdown includes validation flow");

  const pkgScripts = pkg.scripts ?? {};
  assert(pkgScripts["apple-assets:store"]?.includes("scripts/build-apple-release-assets.cjs"), "package.json has Apple release asset generator script");
  assert(pkgScripts["apple-assets:store"]?.includes("scripts/check-apple-release-assets.cjs"), "package.json Apple release asset script runs checker");
  assert(pkgScripts["check:apple-assets"] === "node scripts/check-apple-release-assets.cjs", "package.json has Apple release asset standalone checker");

  if ((packet.summary?.blockerCount ?? 0) > 0) {
    warn(`Apple release asset packet records ${packet.summary.blockerCount} blocked asset request(s)`);
  } else {
    pass("Apple release asset packet has no blocked asset requests");
  }

  console.log(`Apple release asset checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
