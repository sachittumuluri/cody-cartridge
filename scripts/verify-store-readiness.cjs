const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const failures = [];
const warnings = [];
const passes = [];

function rel(filePath) {
  return path.relative(projectRoot, filePath) || ".";
}

function readText(filePath) {
  return fs.readFileSync(path.join(projectRoot, filePath), "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function exists(filePath) {
  return fs.existsSync(path.join(projectRoot, filePath));
}

function mtimeMs(filePath) {
  return fs.statSync(path.join(projectRoot, filePath)).mtimeMs;
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFullUrl(value) {
  return /^https?:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(String(value ?? ""));
}

function includesInOrder(value, first, second) {
  const text = String(value ?? "");
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex;
}

function releaseMachineCommandBlock(packet) {
  const text = String(packet ?? "");
  const start = text.indexOf("# Release-machine sequence");

  if (start < 0) {
    return "";
  }

  const section = text.slice(start);
  const end = section.indexOf("\n```");

  return end >= 0 ? section.slice(0, end) : section;
}

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  if (strict) {
    fail(message);
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

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  }).trim();
}

function tryRun(command, args, passMessage, failureMessage) {
  try {
    run(command, args);
    pass(passMessage);
    return true;
  } catch {
    fail(failureMessage);
    return false;
  }
}

function outputLinesFromError(error) {
  return `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function runNestedCheck(command, args, passMessage, failureMessage) {
  try {
    run(command, args);
    pass(passMessage);
    return true;
  } catch (error) {
    const outputLines = outputLinesFromError(error);
    const nestedFailures = outputLines
      .filter((line) => line.startsWith("FAIL "))
      .map((line) => line.replace(/^FAIL\s+/, ""));
    const nestedWarnings = outputLines
      .filter((line) => line.startsWith("WARN "))
      .map((line) => line.replace(/^WARN\s+/, ""));
    const nestedMessages = [...nestedFailures, ...nestedWarnings];

    if (nestedMessages.length === 0) {
      fail(failureMessage);
      return false;
    }

    nestedMessages.forEach((message) => fail(`${failureMessage}: ${message}`));
    return false;
  }
}

function lintPlist(filePath) {
  run("plutil", ["-lint", filePath]);
  pass(`${filePath} is valid plist`);
}

function plistToJson(filePath) {
  return JSON.parse(run("plutil", ["-convert", "json", "-o", "-", filePath]));
}

function getScreenshotSize(filePath) {
  const output = run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath]);
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);

  return { width, height };
}

function checkPackageConfig() {
  const pkg = readJson("package.json");
  const lockfile = readJson("package-lock.json");
  const build = pkg.build ?? {};
  const expectedFuses = {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false
  };

  assert(pkg.main === "electron/main.cjs", "Electron main entry is configured");
  assert(pkg.author === "Sachit Tumuluri", "Package author is set");
  assert(pkg.engines?.node === ">=20 <25", "Release Node engine range is source-controlled");
  assert(lockfile.packages?.[""]?.engines?.node === pkg.engines?.node, "Package lock root Node engine matches package.json");
  assert(readText(".nvmrc").trim() === "22", ".nvmrc selects the Node 22 release runtime");
  assert(readText(".node-version").trim() === readText(".nvmrc").trim(), ".node-version matches .nvmrc");
  if (strict) {
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    assert(nodeMajor >= 20 && nodeMajor < 25, "Strict verifier runs under the release Node engine range");
  } else {
    pass("Strict release runtime is enforced by check:release-runtime during preflight");
  }
  assert(/^\d+\.\d+\.\d+$/.test(pkg.version), "Package version is App Store-compatible semantic version");
  assert(build.buildVersion === pkg.version, "App Store build version is explicit and matches package version");
  assert(!build.buildNumber, "App Store build number env override is not configured");
  assert(build.appId === "com.sachittumuluri.codycartridge", "Bundle id is App Store-style reverse DNS");
  assert(build.productName === "Cody Cartridge", "Product name is Cody Cartridge");
  assert(build.mac?.category === "public.app-category.music", "Mac category is Music");
  assert(build.mas?.category === "public.app-category.music", "MAS category is Music");
  assert(build.masDev?.category === "public.app-category.music", "MAS development category is Music");
  assert(build.mac?.icon === "build/icon.icns", "Mac icon points to generated icns");
  assert(build.mas?.icon === "build/icon.icns", "MAS icon points to generated icns");
  assert(build.masDev?.icon === "build/icon.icns", "MAS development icon points to generated icns");
  assert(build.asar === true, "Electron app source is explicitly packaged in app.asar");
  assert(JSON.stringify(build.electronFuses ?? {}) === JSON.stringify(expectedFuses), "Electron package fuses are explicitly configured");
  assert(build.electronFuses?.runAsNode === false, "Electron fuse disables ELECTRON_RUN_AS_NODE");
  assert(build.electronFuses?.enableNodeOptionsEnvironmentVariable === false, "Electron fuse disables NODE_OPTIONS");
  assert(build.electronFuses?.enableNodeCliInspectArguments === false, "Electron fuse disables Node inspector CLI arguments");
  assert(build.electronFuses?.enableEmbeddedAsarIntegrityValidation === true, "Electron fuse enables embedded ASAR integrity validation");
  assert(build.electronFuses?.onlyLoadAppFromAsar === true, "Electron fuse restricts app loading to app.asar");
  assert(build.electronFuses?.grantFileProtocolExtraPrivileges === false, "Electron fuse disables file protocol extra privileges");
  assert(build.mac?.minimumSystemVersion === "12.0", "Mac minimum system version is explicit");
  assert(build.mas?.minimumSystemVersion === "12.0", "MAS minimum system version is explicit");
  assert(build.masDev?.minimumSystemVersion === "12.0", "MAS development minimum system version is explicit");
  assert(build.mas?.entitlements === "build/entitlements.mas.plist", "MAS entitlements configured");
  assert(build.mas?.entitlementsInherit === "build/entitlements.mas.inherit.plist", "MAS child entitlements configured");
  assert(build.masDev?.entitlements === "build/entitlements.mas.plist", "MAS development entitlements configured");
  assert(build.masDev?.entitlementsInherit === "build/entitlements.mas.inherit.plist", "MAS development child entitlements configured");
  assert(pkg.overrides?.["@noble/hashes"] === "1.8.0", "Package overrides pin app-builder-lib hash dependency to CommonJS-compatible @noble/hashes 1.8.0");
  assert(
    lockfile.packages?.["node_modules/app-builder-lib/node_modules/@noble/hashes"]?.version === "1.8.0",
    "Package lock resolves app-builder-lib @noble/hashes to 1.8.0"
  );

  const packageFiles = build.files ?? [];
  assert(
    JSON.stringify(packageFiles) === JSON.stringify(["dist/**/*", "electron/**/*", "package.json"]),
    "Packaged app file allowlist excludes local music, Takeout exports, screenshots, and release drafts"
  );

  const extraResources = JSON.stringify(build.extraResources ?? []);
  assert(extraResources.includes("build/PrivacyInfo.xcprivacy"), "Privacy manifest is included as extra resource");
  assert(extraResources.includes("app-store-assets/THIRD_PARTY_NOTICES.md"), "Third-party notice markdown is included as extra resource");
  assert(extraResources.includes("app-store-assets/THIRD_PARTY_NOTICES.json"), "Third-party notice JSON is included as extra resource");
  assert(extraResources.includes("app-store-assets/PRIVACY_POLICY.md"), "Privacy policy markdown is included as extra resource");
  assert(extraResources.includes("app-store-assets/SUPPORT.md"), "Support markdown is included as extra resource");
  assert(extraResources.includes("app-store-assets/ACCESSIBILITY.md"), "Accessibility markdown is included as extra resource");

  const extendInfo = build.mac?.extendInfo ?? {};
  assert(extendInfo.ITSAppUsesNonExemptEncryption === false, "Info.plist declares no non-exempt encryption in package config");
  [
    "NSAppTransportSecurity",
    "NSAudioCaptureUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription"
  ].forEach((key) => {
    assert(Object.prototype.hasOwnProperty.call(extendInfo, key) && extendInfo[key] === null, `${key} is stripped from packaged Info.plist`);
  });

  [
    "build",
    "version:store",
    "check:store-version",
    "check:store-version:source",
    "check:icons",
    "check:app-privacy",
    "export-compliance:store",
    "check:export-compliance",
    "check:artifact-privacy",
    "notices:store",
    "init:store-env",
    "check:store-env",
    "check:store-copy",
    "copy-map:store",
    "check:copy-map",
    "review-brief:store",
    "check:review-brief",
    "check:public-release-sync",
    "public-release:store",
    "public-release:store:node",
    "public-release:store:published",
    "public-release:store:published:node",
    "check:site",
    "archive:site",
    "check:site-archive",
    "site:archive",
    "check:store-urls",
    "check:electron-security",
    "check:help-docs",
    "check:release-runtime",
    "release:node",
    "check:release-runtime:node",
    "check:release-machine",
    "check:release-machine:node",
    "check:packaging-toolchain",
    "site:store",
    "packet:store",
    "manifest:store",
    "check:manifest",
    "handoff:store",
    "check:handoff",
    "report:store-blockers",
    "public-inputs:store",
    "check:public-inputs",
    "publish-packet:store",
    "check:publish-packet",
    "public-host:store",
    "check:public-host",
    "check:published-site",
    "resolution-plan:store",
    "check:resolution-plan",
    "submission-checklist:store",
    "check:submission-checklist",
    "dashboard:store",
    "check:dashboard",
    "operator:store",
    "check:operator",
    "signing-runbook:store",
    "check:signing-runbook",
    "signing-assets:store",
    "check:signing-assets",
    "apple-assets:store",
    "check:apple-assets",
    "install:mas-profile",
    "install:asc-key",
    "upload-packet:store",
    "check:upload-packet",
    "upload-evidence:store",
    "check:upload-evidence",
    "evidence:store",
    "check:evidence",
    "check:mas-signing",
    "check:mas-package",
    "check:upload-tooling",
    "check:upload-credentials",
    "smoke:store",
    "smoke:a11y",
    "smoke:electron-shell",
    "smoke:clean-profile",
    "smoke:mas-dir",
    "smoke:mas-runtime",
    "check:screenshots",
    "screenshots:store",
    "verify:store",
    "verify:store:strict",
    "verify:store:strict:node",
    "release:store:local",
    "release:store:local:node",
    "release:store:preflight",
    "release:store:preflight:node",
    "dist:mas",
    "dist:mas-dev"
  ].forEach((scriptName) => {
    assert(Boolean(pkg.scripts?.[scriptName]), `npm script ${scriptName} exists`);
  });

  assert(
    pkg.scripts?.["verify:store"] === "node scripts/verify-store-readiness-with-build.cjs",
    "Store verifier runs through MAS-artifact-preserving build wrapper"
  );
  assert(
    pkg.scripts?.["verify:store:strict"] === "node scripts/run-release-node.cjs node scripts/verify-store-readiness.cjs --strict",
    "Strict store verifier skips rebuild after MAS packaging and runs through release Node wrapper"
  );
  assert(
    pkg.scripts?.["verify:store:strict:node"] === "node scripts/run-release-node.cjs npm run verify:store:strict --",
    "Node-safe strict store verifier is wired"
  );
}

function checkSourceAndBuildHtml() {
  const sourceHtml = readText("index.html");
  const builtHtml = readText("dist/index.html");

  assert(sourceHtml.includes("/src/main.tsx"), "Source index.html points to Vite entry");
  assert(!sourceHtml.includes("./assets/index-"), "Source index.html is not a generated build artifact");
  assert(sourceHtml.includes("Content-Security-Policy"), "Source index.html declares renderer Content Security Policy");
  assert(sourceHtml.includes("script-src 'self'"), "Renderer CSP limits scripts to self");
  assert(!sourceHtml.includes("'unsafe-eval'"), "Renderer CSP does not allow unsafe-eval");
  assert(!sourceHtml.includes(" file:"), "Renderer CSP does not grant file: resource access");
  assert(sourceHtml.includes("cody-media:"), "Renderer CSP allows custom media protocol");
  assert(sourceHtml.includes("cody-art:"), "Renderer CSP allows custom artwork protocol");
  assert(builtHtml.includes("Content-Security-Policy"), "Built index.html preserves renderer Content Security Policy");
  assert(!builtHtml.includes(" file:"), "Built index.html does not grant file: resource access");
  assert(builtHtml.includes('src="./assets/'), "Built index.html uses relative script asset");
  assert(builtHtml.includes('href="./assets/'), "Built index.html uses relative stylesheet asset");
  assert(!builtHtml.includes('src="/assets/'), "Built index.html avoids absolute script asset path");
  assert(!builtHtml.includes('href="/assets/'), "Built index.html avoids absolute stylesheet asset path");
}

function checkPlists() {
  ["build/PrivacyInfo.xcprivacy", "build/entitlements.mas.plist", "build/entitlements.mas.inherit.plist"].forEach(lintPlist);

  const privacy = plistToJson("build/PrivacyInfo.xcprivacy");
  const accessedTypes = privacy.NSPrivacyAccessedAPITypes ?? [];
  const accessedTypeNames = accessedTypes.map((item) => item.NSPrivacyAccessedAPIType);
  const findReasons = (type) =>
    accessedTypes.find((item) => item.NSPrivacyAccessedAPIType === type)?.NSPrivacyAccessedAPITypeReasons ?? [];

  assert(privacy.NSPrivacyTracking === false, "Privacy manifest declares no tracking");
  assert(Array.isArray(privacy.NSPrivacyTrackingDomains) && privacy.NSPrivacyTrackingDomains.length === 0, "Privacy manifest has no tracking domains");
  assert(Array.isArray(privacy.NSPrivacyCollectedDataTypes) && privacy.NSPrivacyCollectedDataTypes.length === 0, "Privacy manifest declares no collected data types");
  assert(accessedTypeNames.includes("NSPrivacyAccessedAPICategoryFileTimestamp"), "Privacy manifest declares file timestamp API category");
  assert(findReasons("NSPrivacyAccessedAPICategoryFileTimestamp").includes("3B52.1"), "File timestamp reason covers user-selected files");
  assert(findReasons("NSPrivacyAccessedAPICategoryFileTimestamp").includes("C617.1"), "File timestamp reason covers app container files");
  assert(findReasons("NSPrivacyAccessedAPICategoryUserDefaults").includes("CA92.1"), "UserDefaults reason covers app-local state");
  assert(findReasons("NSPrivacyAccessedAPICategorySystemBootTime").includes("35F9.1"), "System boot time reason covers timers/intervals");

  const entitlements = plistToJson("build/entitlements.mas.plist");
  assert(entitlements["com.apple.security.app-sandbox"] === true, "MAS app sandbox entitlement enabled");
  assert(entitlements["com.apple.security.files.user-selected.read-only"] === true, "MAS user-selected read-only file access enabled");
  assert(entitlements["com.apple.security.files.bookmarks.app-scope"] === true, "MAS app-scoped bookmarks enabled");
  assert(!entitlements["com.apple.security.network.client"], "MAS network client entitlement is not enabled");

  const inherit = plistToJson("build/entitlements.mas.inherit.plist");
  assert(inherit["com.apple.security.app-sandbox"] === true, "Child app sandbox entitlement enabled");
  assert(inherit["com.apple.security.inherit"] === true, "Child inherit entitlement enabled");
}

function checkAssetsAndSubmissionDocs() {
  [
    "build/icon.icns",
    "build/icon.png",
    "app-store-assets/APP_STORE_LISTING.md",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.md",
    "app-store-assets/EXPORT_COMPLIANCE.json",
    "app-store-assets/EXPORT_COMPLIANCE.md",
    "app-store-assets/APP_STORE_COMPLIANCE.json",
    "app-store-assets/APP_STORE_COMPLIANCE.md",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md",
    "app-store-assets/APP_CONTENT_RIGHTS.json",
    "app-store-assets/APP_CONTENT_RIGHTS.md",
    "app-store-assets/APP_REVIEW_BRIEF.json",
    "app-store-assets/APP_REVIEW_BRIEF.md",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.md",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.md",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.md",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md",
    "app-store-assets/RELEASE_DASHBOARD.json",
    "app-store-assets/RELEASE_DASHBOARD.html",
    "app-store-assets/RELEASE_OPERATOR_QUEUE.json",
    "app-store-assets/RELEASE_OPERATOR_QUEUE.md",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.md",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/SIGNING_ASSET_REPORT.md",
    "app-store-assets/APPLE_RELEASE_ASSETS.json",
    "app-store-assets/APPLE_RELEASE_ASSETS.md",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.md",
    "app-store-assets/UPLOAD_EVIDENCE.json",
    "app-store-assets/UPLOAD_EVIDENCE.md",
    "app-store-assets/RELEASE_MANIFEST.json",
	    "app-store-assets/RELEASE_MANIFEST.md",
    "app-store-assets/RELEASE_EVIDENCE.json",
    "app-store-assets/RELEASE_EVIDENCE.md",
	    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/RELEASE_BLOCKERS.md",
    "app-store-assets/THIRD_PARTY_NOTICES.json",
    "app-store-assets/THIRD_PARTY_NOTICES.md",
    "app-store-assets/ACCESSIBILITY.md",
    "app-store-assets/PRIVACY_POLICY.md",
    "app-store-assets/SUBMISSION_PACKET.md",
    "app-store-assets/SUPPORT.md",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/submission-handoff/cody-cartridge-app-store-handoff.zip",
    "app-store-assets/submission-handoff/SUBMISSION_HANDOFF.json",
    "app-store-assets/site.env.example",
    "scripts/build-release-manifest.cjs",
    "scripts/check-release-manifest.cjs",
    "scripts/build-release-blocker-report.cjs",
    "scripts/build-release-evidence.cjs",
    "scripts/check-release-evidence.cjs",
    "scripts/build-public-release-inputs.cjs",
    "scripts/build-public-site-publish-packet.cjs",
    "scripts/build-public-host-runbook.cjs",
    "scripts/build-app-store-copy-map.cjs",
    "scripts/build-app-review-brief.cjs",
    "scripts/build-release-resolution-plan.cjs",
    "scripts/build-final-submission-checklist.cjs",
    "scripts/build-release-dashboard.cjs",
    "scripts/build-release-operator-queue.cjs",
    "scripts/build-signing-upload-runbook.cjs",
    "scripts/build-export-compliance.cjs",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/build-upload-command-packet.cjs",
    "scripts/check-upload-command-packet.cjs",
    "scripts/build-upload-evidence.cjs",
    "scripts/check-upload-evidence.cjs",
    "scripts/build-submission-handoff.cjs",
    "scripts/build-submission-packet.cjs",
    "scripts/install-mas-profile.cjs",
    "scripts/install-asc-key.cjs",
    "scripts/check-store-version.cjs",
    "scripts/check-public-release-inputs.cjs",
    "scripts/check-public-site-publish-packet.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/check-public-release-sync.cjs",
    "scripts/check-app-store-copy-map.cjs",
    "scripts/check-app-review-brief.cjs",
    "scripts/check-release-resolution-plan.cjs",
    "scripts/check-final-submission-checklist.cjs",
    "scripts/check-release-dashboard.cjs",
    "scripts/check-release-operator-queue.cjs",
    "scripts/check-signing-upload-runbook.cjs",
    "scripts/bump-store-version.cjs",
    "scripts/build-public-site-archive.cjs",
    "scripts/build-third-party-notices.cjs",
    "scripts/check-public-site-archive.cjs",
    "scripts/check-icons.cjs",
    "scripts/check-app-privacy.cjs",
    "scripts/check-export-compliance.cjs",
    "scripts/check-artifact-privacy.cjs",
    "scripts/check-submission-handoff.cjs",
    "scripts/check-electron-security.cjs",
    "scripts/check-help-docs.cjs",
    "scripts/check-packaging-toolchain.cjs",
    "scripts/check-release-machine.cjs",
    "scripts/check-store-env.cjs",
    "scripts/configure-store-env.cjs",
    "scripts/refresh-public-release.cjs",
    "scripts/check-store-copy.cjs",
    "scripts/check-store-site.cjs",
    "scripts/check-store-urls.cjs",
	    "scripts/check-store-screenshots.cjs",
    "scripts/init-store-env.cjs",
    "scripts/check-mas-signing.cjs",
    "scripts/check-mas-package.cjs",
    "scripts/check-upload-tooling.cjs",
    "scripts/check-upload-credentials.cjs",
    "scripts/capture-store-screenshots.cjs",
    "scripts/smoke-store-build.cjs",
    "scripts/smoke-accessibility.cjs",
    "scripts/smoke-electron-shell.cjs",
    "scripts/smoke-clean-profile.cjs",
    "scripts/smoke-mas-dir-build.cjs",
    "scripts/smoke-mas-runtime.cjs",
    "scripts/store-env.cjs"
  ].forEach((filePath) => {
    assert(exists(filePath), `${filePath} exists`);
  });

  run("node", ["--check", "scripts/build-submission-packet.cjs"]);
  pass("Submission packet generator parses");
  run("node", ["--check", "scripts/build-release-manifest.cjs"]);
  pass("Release manifest generator parses");
  run("node", ["--check", "scripts/check-release-manifest.cjs"]);
  pass("Release manifest checker parses");
	  run("node", ["--check", "scripts/build-release-blocker-report.cjs"]);
	  pass("Release blocker report generator parses");
  run("node", ["--check", "scripts/build-release-evidence.cjs"]);
  pass("Release evidence generator parses");
  run("node", ["--check", "scripts/check-release-evidence.cjs"]);
  pass("Release evidence checker parses");
  run("node", ["--check", "scripts/run-release-node.cjs"]);
  pass("Release-node wrapper parses");
  run("node", ["--check", "scripts/build-public-release-inputs.cjs"]);
  pass("Public release inputs generator parses");
  run("node", ["--check", "scripts/check-public-release-inputs.cjs"]);
  pass("Public release inputs checker parses");
  run("node", ["scripts/check-public-release-inputs.cjs"]);
  pass("Public release inputs checker passes");
  run("node", ["--check", "scripts/build-public-site-publish-packet.cjs"]);
  pass("Public site publish packet generator parses");
  run("node", ["--check", "scripts/check-public-site-publish-packet.cjs"]);
  pass("Public site publish packet checker parses");
  run("node", ["scripts/check-public-site-publish-packet.cjs"]);
  pass("Public site publish packet checker passes");
  run("node", ["--check", "scripts/build-public-host-runbook.cjs"]);
  pass("Public host runbook generator parses");
  run("node", ["--check", "scripts/check-public-host-runbook.cjs"]);
  pass("Public host runbook checker parses");
  run("node", ["scripts/check-public-host-runbook.cjs"]);
  pass("Public host runbook checker passes");
  run("node", ["--check", "scripts/check-public-site-published.cjs"]);
  pass("Published public site checker parses");
  run("node", ["scripts/check-public-site-published.cjs"]);
  pass("Published public site checker advisory check passes");
  run("node", ["--check", "scripts/check-public-release-sync.cjs"]);
  pass("Public release sync checker parses");
  run("node", ["scripts/check-public-release-sync.cjs"]);
  pass("Public release sync checker advisory check passes");
  run("node", ["--check", "scripts/build-app-store-copy-map.cjs"]);
  pass("App Store Connect copy map generator parses");
  run("node", ["--check", "scripts/check-app-store-copy-map.cjs"]);
  pass("App Store Connect copy map checker parses");
  run("node", ["scripts/check-app-store-copy-map.cjs"]);
  pass("App Store Connect copy map checker passes");
  run("node", ["--check", "scripts/build-app-review-brief.cjs"]);
  pass("App Review brief generator parses");
  run("node", ["--check", "scripts/check-app-review-brief.cjs"]);
  pass("App Review brief checker parses");
  run("node", ["scripts/check-app-review-brief.cjs"]);
  pass("App Review brief checker passes");
  run("node", ["--check", "scripts/build-release-resolution-plan.cjs"]);
  pass("Release resolution plan generator parses");
  run("node", ["--check", "scripts/check-release-resolution-plan.cjs"]);
  pass("Release resolution plan checker parses");
  run("node", ["scripts/check-release-resolution-plan.cjs"]);
  pass("Release resolution plan checker passes");
  run("node", ["--check", "scripts/build-final-submission-checklist.cjs"]);
  pass("Final submission checklist generator parses");
  run("node", ["--check", "scripts/check-final-submission-checklist.cjs"]);
  pass("Final submission checklist checker parses");
  run("node", ["scripts/check-final-submission-checklist.cjs"]);
  pass("Final submission checklist checker passes");
  run("node", ["--check", "scripts/build-release-dashboard.cjs"]);
  pass("Release dashboard generator parses");
  run("node", ["--check", "scripts/check-release-dashboard.cjs"]);
  pass("Release dashboard checker parses");
  run("node", ["scripts/check-release-dashboard.cjs"]);
  pass("Release dashboard checker passes");
  run("node", ["--check", "scripts/build-release-operator-queue.cjs"]);
  pass("Release operator queue generator parses");
  run("node", ["--check", "scripts/check-release-operator-queue.cjs"]);
  pass("Release operator queue checker parses");
  run("node", ["scripts/check-release-operator-queue.cjs"]);
  pass("Release operator queue checker passes");
  run("node", ["--check", "scripts/build-signing-upload-runbook.cjs"]);
  pass("Signing/upload runbook generator parses");
  run("node", ["--check", "scripts/check-signing-upload-runbook.cjs"]);
  pass("Signing/upload runbook checker parses");
  run("node", ["scripts/check-signing-upload-runbook.cjs"]);
  pass("Signing/upload runbook checker passes");
  run("node", ["--check", "scripts/install-mas-profile.cjs"]);
  pass("MAS profile installer script parses");
  run("npm", ["run", "install:mas-profile", "--", "--help"]);
  pass("MAS profile installer help passes");
  run("node", ["--check", "scripts/install-asc-key.cjs"]);
  pass("App Store Connect key installer script parses");
  run("npm", ["run", "install:asc-key", "--", "--help"]);
  pass("App Store Connect key installer help passes");
  run("node", ["--check", "scripts/build-apple-release-assets.cjs"]);
  pass("Apple release asset request generator parses");
  run("node", ["--check", "scripts/check-apple-release-assets.cjs"]);
  pass("Apple release asset request checker parses");
  run("node", ["scripts/check-apple-release-assets.cjs"]);
  pass("Apple release asset request checker advisory check passes");
  run("node", ["--check", "scripts/build-upload-command-packet.cjs"]);
  pass("Upload command packet generator parses");
  run("node", ["--check", "scripts/check-upload-command-packet.cjs"]);
  pass("Upload command packet checker parses");
  run("node", ["scripts/check-upload-command-packet.cjs"]);
  pass("Upload command packet checker advisory check passes");
  run("node", ["--check", "scripts/build-upload-evidence.cjs"]);
  pass("Upload evidence generator parses");
  run("node", ["--check", "scripts/check-upload-evidence.cjs"]);
  pass("Upload evidence checker parses");
  run("node", ["scripts/check-upload-evidence.cjs"]);
  pass("Upload evidence checker advisory check passes");
  run("node", ["scripts/check-release-evidence.cjs"]);
  pass("Release evidence checker passes");
  run("node", ["scripts/check-release-manifest.cjs"]);
  pass("Release manifest checker passes");
  run("node", ["--check", "scripts/build-submission-handoff.cjs"]);
  pass("Submission handoff generator parses");
  run("node", ["--check", "scripts/check-submission-handoff.cjs"]);
  pass("Submission handoff checker parses");
  run("node", ["scripts/check-submission-handoff.cjs"]);
  pass("Submission handoff checker passes");
  run("node", ["--check", "scripts/build-third-party-notices.cjs"]);
  pass("Third-party notices generator parses");
  run("node", ["--check", "scripts/check-store-env.cjs"]);
  pass("Store env preflight script parses");
  run("node", ["--check", "scripts/configure-store-env.cjs"]);
  pass("Store env configurator script parses");
  run("node", ["scripts/configure-store-env.cjs", "--self-test"]);
  pass("Store env configurator quoted-value self-test passes");
  run("node", [
    "scripts/configure-store-env.cjs",
    "--dry-run",
    "--site-url",
    "https://release.example",
    "--support-email",
    "support@release.example",
    "--review-name",
    "Release Contact",
    "--review-email",
    "review@release.example",
    "--review-phone",
    "+1 555 555 5555"
  ]);
  pass("Store env configurator dry-run validates synthetic release values");
  run("node", ["--check", "scripts/refresh-public-release.cjs"]);
  pass("Public release refresh script parses");
  run("node", ["scripts/refresh-public-release.cjs", "--self-test"]);
  pass("Public release refresh self-test passes");
  run("npm", ["run", "public-release:store", "--", "--dry-run"]);
  pass("Public release refresh dry-run passes");
  run("node", ["--check", "scripts/init-store-env.cjs"]);
  pass("Store env initializer script parses");
  run("node", ["scripts/init-store-env.cjs", "--dry-run"]);
  pass("Store env initializer dry-run passes");
  run("node", ["--check", "scripts/check-store-copy.cjs"]);
  pass("Store copy checker script parses");
  run("node", ["--check", "scripts/check-store-version.cjs"]);
  pass("Store version checker script parses");
  run("node", ["--check", "scripts/bump-store-version.cjs"]);
  pass("Store version bump script parses");
  run("node", ["scripts/check-store-version.cjs"]);
  pass("Store version checker passes");
  run("node", ["--check", "scripts/check-electron-security.cjs"]);
  pass("Electron security checker script parses");
  run("node", ["scripts/check-electron-security.cjs"]);
  pass("Electron security checker passes");
  run("node", ["--check", "scripts/check-help-docs.cjs"]);
  pass("Help document checker script parses");
  run("node", ["scripts/check-help-docs.cjs"]);
  pass("Help document checker passes");
  run("node", ["--check", "scripts/check-release-machine.cjs"]);
  pass("Release machine doctor script parses");
  run("node", ["scripts/check-release-machine.cjs"]);
  pass("Release machine doctor advisory check passes");
  run("node", ["--check", "scripts/check-packaging-toolchain.cjs"]);
  pass("Packaging toolchain checker script parses");
  run("node", ["scripts/check-packaging-toolchain.cjs"]);
  pass("Packaging toolchain checker passes");
  run("node", ["--check", "scripts/check-store-site.cjs"]);
  pass("Store site checker script parses");
  run("node", ["--check", "scripts/build-public-site-archive.cjs"]);
  pass("Public site archive generator parses");
  run("node", ["--check", "scripts/check-public-site-archive.cjs"]);
  pass("Public site archive checker script parses");
  run("node", ["--check", "scripts/check-store-urls.cjs"]);
  pass("Store public URL checker script parses");
  run("node", ["--check", "scripts/check-store-screenshots.cjs"]);
  pass("Store screenshot checker script parses");
  run("node", ["--check", "scripts/check-icons.cjs"]);
  pass("Icon audit script parses");
  run("node", ["scripts/check-icons.cjs"]);
  pass("Icon audit passes");
  run("node", ["--check", "scripts/check-app-privacy.cjs"]);
  pass("App privacy checker script parses");
  run("node", ["scripts/check-app-privacy.cjs"]);
  pass("App privacy checker passes");
  run("node", ["--check", "scripts/build-export-compliance.cjs"]);
  pass("Export compliance generator script parses");
  run("node", ["--check", "scripts/check-export-compliance.cjs"]);
  pass("Export compliance checker script parses");
  run("node", ["scripts/check-export-compliance.cjs"]);
  pass("Export compliance checker passes");
  run("node", ["--check", "scripts/build-app-store-compliance.cjs"]);
  pass("App Store compliance generator script parses");
  run("node", ["--check", "scripts/check-app-store-compliance.cjs"]);
  pass("App Store compliance checker script parses");
  run("node", ["scripts/check-app-store-compliance.cjs"]);
  pass("App Store compliance checker passes");
  run("node", ["--check", "scripts/check-artifact-privacy.cjs"]);
  pass("Artifact privacy checker script parses");
  run("node", ["scripts/check-artifact-privacy.cjs"]);
  pass("Artifact privacy checker passes");
  run("node", ["--check", "scripts/check-mas-signing.cjs"]);
  pass("MAS signing preflight script parses");
  run("node", ["--check", "scripts/check-mas-package.cjs"]);
  pass("MAS package boundary checker script parses");
  run("node", ["--check", "scripts/check-upload-tooling.cjs"]);
  pass("App Store upload tooling checker script parses");
  run("node", ["--check", "scripts/check-upload-credentials.cjs"]);
  pass("App Store upload credential checker script parses");
  run("node", ["--check", "scripts/smoke-store-build.cjs"]);
  pass("Store smoke script parses");
  run("node", ["--check", "scripts/smoke-accessibility.cjs"]);
  pass("Accessibility smoke script parses");
  run(path.join(projectRoot, "node_modules", ".bin", "electron"), ["scripts/smoke-accessibility.cjs"]);
  pass("Accessibility smoke test passes");
  run("node", ["--check", "scripts/smoke-electron-shell.cjs"]);
  pass("Electron shell smoke script parses");
  run("node", ["scripts/smoke-electron-shell.cjs"]);
  pass("Electron shell smoke test passes");
  run("node", ["--check", "scripts/smoke-clean-profile.cjs"]);
  pass("Clean-profile smoke script parses");
  run("node", ["scripts/smoke-clean-profile.cjs"]);
  pass("Clean-profile smoke test passes");
  run("node", ["--check", "scripts/smoke-mas-dir-build.cjs"]);
  pass("MAS directory smoke script parses");
  run("node", ["--check", "scripts/smoke-mas-runtime.cjs"]);
  pass("Packaged MAS runtime smoke script parses");
  run("node", ["scripts/check-store-screenshots.cjs"]);
  pass("Store screenshot quality audit passes");
  run("node", ["--check", "scripts/store-env.cjs"]);
  pass("Store env loader script parses");

  const screenshots = [
    "app-store-assets/screenshots/01-library-1440x900.png",
    "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    "app-store-assets/screenshots/03-missing-files-1440x900.png"
  ];
  const screenshotManifestPath = "app-store-assets/screenshots/STORE_SCREENSHOTS.json";
  const acceptedMacScreenshotSizes = new Set(["1280x800", "1440x900", "2560x1600", "2880x1800"]);

  screenshots.forEach((filePath) => {
    assert(exists(filePath), `${filePath} exists`);
    if (exists(filePath)) {
      const { width, height } = getScreenshotSize(filePath);
      assert(width === 1440 && height === 900, `${filePath} is 1440x900 Mac screenshot size`);
      assert(acceptedMacScreenshotSizes.has(`${width}x${height}`), `${filePath} matches Apple Mac screenshot specifications`);
    }
  });

  const screenshotSourceFiles = [
    "index.html",
    "vite.config.ts",
    "src/main.tsx",
    "src/App.tsx",
    "src/styles.css",
    "scripts/capture-store-screenshots.cjs"
  ].filter(exists);
  const newestScreenshotSource = Math.max(...screenshotSourceFiles.map(mtimeMs));

  screenshots.forEach((filePath) => {
    if (!exists(filePath)) {
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestScreenshotSource) {
      pass(`${filePath} is fresh relative to renderer screenshot sources`);
    } else {
      warn(`${filePath} is older than renderer screenshot sources; run npm run screenshots:store`);
    }
  });

  assert(exists(screenshotManifestPath), `${screenshotManifestPath} exists`);
  if (exists(screenshotManifestPath)) {
    const manifest = readJson(screenshotManifestPath);
    assert(manifest.source === "store-demo", "Screenshot manifest records store-demo source");
    assert(manifest.renderer === "dist/index.html", "Screenshot manifest records production renderer source");
    assert(manifest.viewport?.width === 1440 && manifest.viewport?.height === 900, "Screenshot manifest records 1440x900 viewport");
    assert(manifest.appStoreConnectSpec?.platform === "macOS", "Screenshot manifest records macOS App Store platform");
    assert(manifest.appStoreConnectSpec?.requiredFor === "Mac apps", "Screenshot manifest records Mac screenshot requirement");
    assert(manifest.appStoreConnectSpec?.aspectRatio === "16:10", "Screenshot manifest records Mac screenshot aspect ratio");
    assert(manifest.appStoreConnectSpec?.count?.min === 1 && manifest.appStoreConnectSpec?.count?.max === 10, "Screenshot manifest records Apple screenshot count range");
    assert(
      manifest.appStoreConnectSpec?.sourceUrl === "https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/",
      "Screenshot manifest records Apple screenshot specification URL"
    );
    assert(
      (manifest.appStoreConnectSpec?.acceptedSizes ?? []).every((size) => acceptedMacScreenshotSizes.has(`${size.width}x${size.height}`)) &&
        (manifest.appStoreConnectSpec?.acceptedSizes ?? []).length === acceptedMacScreenshotSizes.size,
      "Screenshot manifest records every accepted Mac screenshot size"
    );
    assert(
      manifest.screenshotCount === screenshots.length && Array.isArray(manifest.screenshots) && manifest.screenshots.length === screenshots.length,
      "Screenshot manifest records every expected screenshot"
    );
    screenshots.forEach((filePath) => {
      assert(
        manifest.screenshots?.some(
          (entry) =>
            entry.filePath === filePath &&
            entry.sha256 &&
            entry.format === "png" &&
            entry.appStoreConnectAccepted === true &&
            acceptedMacScreenshotSizes.has(`${entry.width}x${entry.height}`)
        ),
        `Screenshot manifest hashes and marks ${filePath} as an accepted Mac PNG`
      );
    });
    if (mtimeMs(screenshotManifestPath) + 1000 >= newestScreenshotSource) {
      pass(`${screenshotManifestPath} is fresh relative to renderer screenshot sources`);
    } else {
      warn(`${screenshotManifestPath} is older than renderer screenshot sources; run npm run screenshots:store`);
    }
  }

  const iconPngs = [
    "build/icon.iconset/icon_16x16.png",
    "build/icon.iconset/icon_16x16@2x.png",
    "build/icon.iconset/icon_32x32.png",
    "build/icon.iconset/icon_32x32@2x.png",
    "build/icon.iconset/icon_128x128.png",
    "build/icon.iconset/icon_128x128@2x.png",
    "build/icon.iconset/icon_256x256.png",
    "build/icon.iconset/icon_256x256@2x.png",
    "build/icon.iconset/icon_512x512.png",
    "build/icon.iconset/icon_512x512@2x.png"
  ];

  iconPngs.forEach((filePath) => {
    assert(exists(filePath), `${filePath} exists`);
  });

  const listing = readText("app-store-assets/APP_STORE_LISTING.md");
  const packet = readText("app-store-assets/SUBMISSION_PACKET.md");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const copyMap = readJson("app-store-assets/APP_STORE_CONNECT_COPY_MAP.json");
  const copyMapMarkdown = readText("app-store-assets/APP_STORE_CONNECT_COPY_MAP.md");
  const exportCompliance = readJson("app-store-assets/EXPORT_COMPLIANCE.json");
  const exportComplianceMarkdown = readText("app-store-assets/EXPORT_COMPLIANCE.md");
  const appStoreCompliance = readJson("app-store-assets/APP_STORE_COMPLIANCE.json");
  const appStoreComplianceMarkdown = readText("app-store-assets/APP_STORE_COMPLIANCE.md");
  const manualTasks = readJson("app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json");
  const manualTasksMarkdown = readText("app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md");
  const contentRights = readJson("app-store-assets/APP_CONTENT_RIGHTS.json");
  const contentRightsMarkdown = readText("app-store-assets/APP_CONTENT_RIGHTS.md");
  const reviewBrief = readJson("app-store-assets/APP_REVIEW_BRIEF.json");
  const reviewBriefMarkdown = readText("app-store-assets/APP_REVIEW_BRIEF.md");
  const publicReleaseInputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json");
  const publicReleaseInputsMarkdown = readText("app-store-assets/PUBLIC_RELEASE_INPUTS.md");
  const publicSitePublishPacket = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json");
  const publicSitePublishPacketMarkdown = readText("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md");
  const publicHostRunbook = readJson("app-store-assets/PUBLIC_HOST_RUNBOOK.json");
  const publicHostRunbookMarkdown = readText("app-store-assets/PUBLIC_HOST_RUNBOOK.md");
  const releaseResolutionPlan = readJson("app-store-assets/RELEASE_RESOLUTION_PLAN.json");
  const releaseResolutionPlanMarkdown = readText("app-store-assets/RELEASE_RESOLUTION_PLAN.md");
  const finalSubmissionChecklist = readJson("app-store-assets/FINAL_SUBMISSION_CHECKLIST.json");
  const finalSubmissionChecklistMarkdown = readText("app-store-assets/FINAL_SUBMISSION_CHECKLIST.md");
  const releaseDashboard = readJson("app-store-assets/RELEASE_DASHBOARD.json");
  const releaseDashboardHtml = readText("app-store-assets/RELEASE_DASHBOARD.html");
  const releaseOperatorQueue = readJson("app-store-assets/RELEASE_OPERATOR_QUEUE.json");
  const releaseOperatorQueueMarkdown = readText("app-store-assets/RELEASE_OPERATOR_QUEUE.md");
  const signingAssetReport = readJson("app-store-assets/SIGNING_ASSET_REPORT.json");
  const signingAssetReportMarkdown = readText("app-store-assets/SIGNING_ASSET_REPORT.md");
  const appleReleaseAssets = readJson("app-store-assets/APPLE_RELEASE_ASSETS.json");
  const appleReleaseAssetsMarkdown = readText("app-store-assets/APPLE_RELEASE_ASSETS.md");
  const uploadCommandPacket = readJson("app-store-assets/UPLOAD_COMMAND_PACKET.json");
  const uploadCommandPacketMarkdown = readText("app-store-assets/UPLOAD_COMMAND_PACKET.md");
  const uploadEvidence = readJson("app-store-assets/UPLOAD_EVIDENCE.json");
  const uploadEvidenceMarkdown = readText("app-store-assets/UPLOAD_EVIDENCE.md");
  const signingRunbook = readJson("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json");
  const signingRunbookMarkdown = readText("app-store-assets/SIGNING_UPLOAD_RUNBOOK.md");
  const releaseManifest = readJson("app-store-assets/RELEASE_MANIFEST.json");
  const releaseManifestMarkdown = readText("app-store-assets/RELEASE_MANIFEST.md");
  const submissionHandoff = readJson("app-store-assets/submission-handoff/SUBMISSION_HANDOFF.json");
  const releaseEvidence = readJson("app-store-assets/RELEASE_EVIDENCE.json");
  const releaseEvidenceMarkdown = readText("app-store-assets/RELEASE_EVIDENCE.md");
  const releaseMachineReport = readJson("app-store-assets/RELEASE_MACHINE_REPORT.json");
  const releaseMachineReportMarkdown = readText("app-store-assets/RELEASE_MACHINE_REPORT.md");
	  const releaseBlockers = readJson("app-store-assets/RELEASE_BLOCKERS.json");
  const releaseBlockersMarkdown = readText("app-store-assets/RELEASE_BLOCKERS.md");
  const thirdPartyNotices = readJson("app-store-assets/THIRD_PARTY_NOTICES.json");
  const thirdPartyNoticesMarkdown = readText("app-store-assets/THIRD_PARTY_NOTICES.md");
  const pkg = readJson("package.json");
  const privacy = readText("app-store-assets/PRIVACY_POLICY.md");
  const support = readText("app-store-assets/SUPPORT.md");
  const readiness = readText("APP_STORE_READINESS.md");
  const siteGenerator = readText("scripts/build-store-site.cjs");
  const siteArchiveGenerator = readText("scripts/build-public-site-archive.cjs");
  const siteArchiveChecker = readText("scripts/check-public-site-archive.cjs");
  const packetGenerator = readText("scripts/build-submission-packet.cjs");
  const copyMapGenerator = readText("scripts/build-app-store-copy-map.cjs");
  const copyMapChecker = readText("scripts/check-app-store-copy-map.cjs");
  const exportComplianceGenerator = readText("scripts/build-export-compliance.cjs");
  const exportComplianceChecker = readText("scripts/check-export-compliance.cjs");
  const appStoreComplianceGenerator = readText("scripts/build-app-store-compliance.cjs");
  const appStoreComplianceChecker = readText("scripts/check-app-store-compliance.cjs");
  const manualTasksGenerator = readText("scripts/build-app-store-connect-manual-tasks.cjs");
  const manualTasksChecker = readText("scripts/check-app-store-connect-manual-tasks.cjs");
  const contentRightsGenerator = readText("scripts/build-app-content-rights.cjs");
  const contentRightsChecker = readText("scripts/check-app-content-rights.cjs");
  const reviewBriefGenerator = readText("scripts/build-app-review-brief.cjs");
  const reviewBriefChecker = readText("scripts/check-app-review-brief.cjs");
  const releaseBlockerGenerator = readText("scripts/build-release-blocker-report.cjs");
  const releaseResolutionPlanGenerator = readText("scripts/build-release-resolution-plan.cjs");
  const releaseResolutionPlanChecker = readText("scripts/check-release-resolution-plan.cjs");
  const finalSubmissionChecklistGenerator = readText("scripts/build-final-submission-checklist.cjs");
  const finalSubmissionChecklistChecker = readText("scripts/check-final-submission-checklist.cjs");
  const releaseDashboardGenerator = readText("scripts/build-release-dashboard.cjs");
  const releaseDashboardChecker = readText("scripts/check-release-dashboard.cjs");
  const releaseMachineReportGenerator = readText("scripts/build-release-machine-report.cjs");
  const releaseMachineReportChecker = readText("scripts/check-release-machine-report.cjs");
  const releaseOperatorQueueGenerator = readText("scripts/build-release-operator-queue.cjs");
  const releaseOperatorQueueChecker = readText("scripts/check-release-operator-queue.cjs");
  const signingAssetReportGenerator = readText("scripts/build-signing-asset-report.cjs");
  const signingAssetReportChecker = readText("scripts/check-signing-asset-report.cjs");
  const appleReleaseAssetsGenerator = readText("scripts/build-apple-release-assets.cjs");
  const appleReleaseAssetsChecker = readText("scripts/check-apple-release-assets.cjs");
  const masProfileInstaller = readText("scripts/install-mas-profile.cjs");
  const ascKeyInstaller = readText("scripts/install-asc-key.cjs");
  const signingRunbookGenerator = readText("scripts/build-signing-upload-runbook.cjs");
  const signingRunbookChecker = readText("scripts/check-signing-upload-runbook.cjs");
  const uploadCommandPacketGenerator = readText("scripts/build-upload-command-packet.cjs");
  const uploadCommandPacketChecker = readText("scripts/check-upload-command-packet.cjs");
  const uploadEvidenceGenerator = readText("scripts/build-upload-evidence.cjs");
  const uploadEvidenceChecker = readText("scripts/check-upload-evidence.cjs");
  const handoffGenerator = readText("scripts/build-submission-handoff.cjs");
  const handoffChecker = readText("scripts/check-submission-handoff.cjs");
  const releaseManifestGenerator = readText("scripts/build-release-manifest.cjs");
  const releaseManifestChecker = readText("scripts/check-release-manifest.cjs");
  const evidenceGenerator = readText("scripts/build-release-evidence.cjs");
  const evidenceChecker = readText("scripts/check-release-evidence.cjs");
  const publicReleaseInputsGenerator = readText("scripts/build-public-release-inputs.cjs");
  const publicReleaseInputsChecker = readText("scripts/check-public-release-inputs.cjs");
  const publicSitePublishPacketGenerator = readText("scripts/build-public-site-publish-packet.cjs");
  const publicSitePublishPacketChecker = readText("scripts/check-public-site-publish-packet.cjs");
  const publicHostRunbookGenerator = readText("scripts/build-public-host-runbook.cjs");
  const publicHostRunbookChecker = readText("scripts/check-public-host-runbook.cjs");
  const publicSitePublishedChecker = readText("scripts/check-public-site-published.cjs");
  const publicReleaseSyncChecker = readText("scripts/check-public-release-sync.cjs");
  const initStoreEnv = readText("scripts/init-store-env.cjs");
  const configureStoreEnv = readText("scripts/configure-store-env.cjs");
  const publicReleaseRefresh = readText("scripts/refresh-public-release.cjs");
  const storeEnvLoader = readText("scripts/store-env.cjs");
  const releaseRuntimeChecker = readText("scripts/check-release-runtime.cjs");
  const releaseNodeRunner = readText("scripts/run-release-node.cjs");
  const releaseMachineChecker = readText("scripts/check-release-machine.cjs");
  const storeVerifierWithBuild = readText("scripts/verify-store-readiness-with-build.cjs");
  const storeSmoke = readText("scripts/smoke-store-build.cjs");
  const shellSmoke = readText("scripts/smoke-electron-shell.cjs");
  const cleanProfileSmoke = readText("scripts/smoke-clean-profile.cjs");
  const masDirSmoke = readText("scripts/smoke-mas-dir-build.cjs");
  const masRuntimeSmoke = readText("scripts/smoke-mas-runtime.cjs");
  const artifactPrivacy = readText("scripts/check-artifact-privacy.cjs");
  const gitignore = readText(".gitignore");
  const siteEnvExample = readText("app-store-assets/site.env.example");
  const appSource = readText("src/App.tsx");
  const styles = readText("src/styles.css");

  assert(listing.includes("Cody Cartridge"), "Listing draft includes app name");
  assert(listing.includes("does not download music"), "Listing review notes address music download/scraping");
  assert(listing.includes("File > Import Audio Files"), "Listing documents native import menu");
  assert(listing.includes("File > Reset Local Library"), "Listing documents local library reset menu");
  assert(packet.includes("## App Review Notes"), "Submission packet includes review notes");
  assert(packet.includes("## Privacy Answers"), "Submission packet includes privacy answers");
  assert(packet.includes("## Export Compliance"), "Submission packet includes export compliance section");
  assert(packet.includes("## TestFlight Beta Test Plan"), "Submission packet includes TestFlight beta test plan");
  assert(packet.includes("## EU Digital Services Act"), "Submission packet includes EU DSA compliance section");
  assert(packet.includes("## Upload And App Review Submission"), "Submission packet includes upload and App Review submission runbook");
  assert(packet.includes("Post-submit monitoring:"), "Submission packet includes post-submit monitoring guidance");
  assert(packet.includes("## Screenshot Inventory"), "Submission packet includes screenshot inventory");
  assert(packet.includes("STORE_SCREENSHOTS.json"), "Submission packet includes screenshot provenance manifest");
  assert(packet.includes("App Store Connect spec: macOS Mac apps"), "Submission packet includes Mac screenshot specification summary");
  assert(packet.includes("1280 x 800") && packet.includes("2880 x 1800"), "Submission packet includes accepted Mac screenshot sizes");
  assert(packet.includes("accepted Mac screenshot"), "Submission packet marks screenshots accepted for App Store Connect");
  assert(packet.includes("Packaged renderer protocol: `cody-app://`"), "Submission packet includes custom packaged renderer protocol");
  assert(packet.includes("Minimum macOS version: 12.0"), "Submission packet includes explicit minimum macOS version");
  assert(packet.includes("App source archive: app.asar enabled"), "Submission packet includes explicit ASAR packaging note");
  assert(packet.includes("Package file allowlist: `dist/**/*`, `electron/**/*`, `package.json`"), "Submission packet includes package file allowlist");
  assert(packet.includes("Electron fuses: runAsNode=false"), "Submission packet includes Electron fuse summary");
  assert(packet.includes("onlyLoadAppFromAsar=true"), "Submission packet includes only-load-from-ASAR fuse");
  assert(packet.includes("grantFileProtocolExtraPrivileges=false"), "Submission packet includes disabled file protocol fuse state");
  assert(packet.includes("npm run check:app-privacy"), "Submission packet includes App privacy gate");
  assert(packet.includes("npm run export-compliance:store"), "Submission packet includes export compliance generation command");
  assert(packet.includes("npm run check:export-compliance"), "Submission packet includes export compliance gate");
  assert(packet.includes("app-store-assets/EXPORT_COMPLIANCE.json"), "Submission packet includes export compliance artifact path");
  assert(packet.includes("export-compliance-documentation-for-encryption"), "Submission packet includes Apple export-compliance documentation source");
  assert(packet.includes("local playback URL guards"), "Submission packet documents local playback URL guard coverage");
  assert(packet.includes("npm run handoff:store"), "Submission packet includes App Store handoff archive command");
  assert(packet.includes("npm run check:store-version"), "Submission packet includes App Store version gate");
  assert(packet.includes("npm run check:store-version:source"), "Submission packet includes source-only App Store version gate");
  assert(packet.includes("npm run check:store-env"), "Submission packet includes store env gate");
  assert(packet.includes("npm run init:store-env"), "Submission packet includes store env initializer command");
  assert(packet.includes("npm run configure:store-env"), "Submission packet includes store env configurator command");
  assert(packet.includes("npm run public-release:store -- --self-test"), "Submission packet includes public release refresh self-test command");
  assert(packet.includes("npm run public-release:store"), "Submission packet includes public release refresh command");
  assert(packet.includes("npm run check:store-copy"), "Submission packet includes store copy gate");
  assert(packet.includes("npm run check:artifact-privacy"), "Submission packet includes artifact privacy gate");
  assert(packet.includes("npm run check:electron-security"), "Submission packet includes Electron security command");
  assert(packet.includes("npm run check:release-runtime -- --strict"), "Submission packet includes strict release runtime command");
  assert(packet.includes("npm run check:release-machine -- --strict"), "Submission packet includes strict release machine doctor command");
  assert(packet.includes("npm run check:packaging-toolchain"), "Submission packet includes packaging toolchain command");
  assert(releaseRuntimeChecker.includes(">=20 <25"), "Release runtime checker enforces the release Node engine range");
  assert(releaseRuntimeChecker.includes(".nvmrc"), "Release runtime checker validates .nvmrc");
  assert(releaseRuntimeChecker.includes("--strict"), "Release runtime checker supports strict release-machine mode");
  assert(releaseMachineChecker.includes("--strict"), "Release machine doctor supports strict release-machine mode");
  assert(releaseMachineChecker.includes("refresh-public-release.cjs") && releaseMachineChecker.includes("--self-test"), "Release machine doctor checks public release wrapper self-test");
  assert(releaseMachineChecker.includes("check-store-env.cjs"), "Release machine doctor checks public env readiness");
  assert(releaseMachineChecker.includes("check-public-release-sync.cjs"), "Release machine doctor checks generated public release sync");
  assert(releaseMachineChecker.includes("check-public-site-published.cjs"), "Release machine doctor checks full published site");
  assert(releaseMachineChecker.includes("check-mas-package.cjs"), "Release machine doctor checks MAS package boundary");
  assert(releaseMachineChecker.includes("RELEASE_BLOCKERS.json"), "Release machine doctor checks release blocker report");
  assert(storeEnvLoader.includes("getReleaseStoreEnvValue"), "Store env loader exposes placeholder-safe release values");
  assert(storeEnvLoader.includes("isStoreEnvPlaceholder"), "Store env loader centralizes placeholder detection");
  assert(storeEnvLoader.includes("unescapeDoubleQuotedEnvValue"), "Store env loader unescapes quoted release values");
  assert(storeEnvLoader.includes("shellProvidedKeys"), "Store env loader preserves shell-provided release values over file values");
  assert(storeEnvLoader.includes("app-store-assets/site.env.local"), "Store env loader supports local release env overrides");
  assert(publicReleaseRefresh.includes("--self-test"), "Public release refresh supports self-test mode");
  assert(publicReleaseRefresh.includes("sanitize(output, values = process.env)"), "Public release refresh redacts release values through a testable sanitizer");
  assert(publicReleaseRefresh.includes("assertStepBefore"), "Public release refresh self-test checks command order");
  assert(packetGenerator.includes("getReleaseStoreEnvValue"), "Submission packet generator ignores placeholder env values");
  assert(siteGenerator.includes("getReleaseStoreEnvValue"), "Public site generator ignores placeholder env values");
  assert(siteArchiveGenerator.includes("getReleaseStoreEnvValue"), "Public site archive generator ignores placeholder env values");
  assert(packet.includes("npm run check:help-docs"), "Submission packet includes Help document command");
  assert(packet.includes("npm run check:site -- --strict"), "Submission packet includes strict site validation command");
  assert(packet.includes("npm run archive:site"), "Submission packet includes public site archive command");
  assert(packet.includes("npm run check:site-archive -- --strict"), "Submission packet includes strict public site archive validation command");
  assert(packet.includes("Public site archive SHA-256"), "Submission packet includes public site archive hash");
  assert(packet.includes("npm run check:store-urls -- --strict"), "Submission packet includes strict public URL reachability command");
  assert(packet.includes("npm run check:published-site -- --strict"), "Submission packet includes strict published-site command");
  assert(packet.includes("npm run check:public-release-sync -- --strict"), "Submission packet includes strict public release sync command");
  assert(packet.includes("npm run check:icons"), "Submission packet includes icon audit command");
  assert(packet.includes("npm run notices:store"), "Submission packet includes third-party notices command");
  assert(packet.includes("npm run check:mas-signing -- --strict"), "Submission packet includes strict signing gate");
  assert(packet.includes("npm run check:mas-package -- --strict"), "Submission packet includes strict MAS package boundary check");
  assert(packet.includes("npm run check:screenshots"), "Submission packet includes screenshot quality command");
  assert(packet.includes("npm run upload-packet:store"), "Submission packet includes upload command packet command");
  assert(packet.includes("UPLOAD_COMMAND_PACKET.md"), "Submission packet includes upload command packet artifact");
  assert(packet.includes("npm run upload-evidence:store"), "Submission packet includes sanitized upload evidence command");
  assert(packet.includes("UPLOAD_EVIDENCE.md"), "Submission packet includes sanitized upload evidence artifact");
  assert(packet.includes("npm run report:store-blockers"), "Submission packet includes release blocker report command");
  assert(packet.includes("npm run public-inputs:store"), "Submission packet includes public release-input packet command");
  assert(packet.includes("PUBLIC_RELEASE_INPUTS.md"), "Submission packet includes public release-input artifact");
  assert(packet.includes("npm run publish-packet:store"), "Submission packet includes public site publish packet command");
  assert(packet.includes("PUBLIC_SITE_PUBLISH_PACKET.md"), "Submission packet includes public site publish packet artifact");
  assert(packet.includes("npm run public-host:store"), "Submission packet includes public host runbook command");
  assert(packet.includes("PUBLIC_HOST_RUNBOOK.md"), "Submission packet includes public host runbook artifact");
  assert(packet.includes("npm run machine-report:store"), "Submission packet includes release machine report command");
  assert(packet.includes("npm run evidence:store"), "Submission packet includes release evidence command");
  assert(packet.includes("npm run check:evidence"), "Submission packet includes release evidence check command");
	  assert(packet.includes("npm run manifest:store"), "Submission packet includes release manifest command");
  assert(packet.includes("npm run check:manifest"), "Submission packet includes release manifest check command");
	  assert(pkg.scripts?.["report:store-blockers"] === "node scripts/build-release-blocker-report.cjs", "Release blocker report script is wired");
  assert(pkg.scripts?.["public-inputs:store"]?.includes("scripts/build-public-release-inputs.cjs"), "Public release inputs generator script is wired");
  assert(pkg.scripts?.["public-inputs:store"]?.includes("scripts/check-public-release-inputs.cjs"), "Public release inputs checker runs after generation");
  assert(pkg.scripts?.["check:public-inputs"] === "node scripts/check-public-release-inputs.cjs", "Public release inputs standalone checker script is wired");
  assert(pkg.scripts?.["publish-packet:store"]?.includes("scripts/build-public-site-publish-packet.cjs"), "Public site publish packet generator script is wired");
  assert(pkg.scripts?.["publish-packet:store"]?.includes("scripts/check-public-site-publish-packet.cjs"), "Public site publish packet checker runs after generation");
  assert(pkg.scripts?.["check:publish-packet"] === "node scripts/check-public-site-publish-packet.cjs", "Public site publish packet standalone checker script is wired");
  assert(pkg.scripts?.["public-host:store"]?.includes("scripts/build-public-host-runbook.cjs"), "Public host runbook generator script is wired");
  assert(pkg.scripts?.["public-host:store"]?.includes("scripts/check-public-host-runbook.cjs"), "Public host runbook checker runs after generation");
  assert(pkg.scripts?.["check:public-host"] === "node scripts/check-public-host-runbook.cjs", "Public host runbook standalone checker script is wired");
  assert(pkg.scripts?.["check:published-site"] === "node scripts/check-public-site-published.cjs", "Published public site standalone checker script is wired");
  assert(pkg.scripts?.["check:public-release-sync"] === "node scripts/check-public-release-sync.cjs", "Public release sync standalone checker script is wired");
  assert(pkg.scripts?.["evidence:store"]?.includes("scripts/build-release-evidence.cjs"), "Release evidence generator script is wired");
  assert(pkg.scripts?.["evidence:store"]?.includes("scripts/check-release-evidence.cjs"), "Release evidence checker runs after generation");
  assert(pkg.scripts?.["check:evidence"] === "node scripts/check-release-evidence.cjs", "Release evidence standalone checker script is wired");
  assert(pkg.scripts?.["upload-evidence:store"]?.includes("scripts/build-upload-evidence.cjs"), "Upload evidence generator script is wired");
  assert(pkg.scripts?.["upload-evidence:store"]?.includes("scripts/check-upload-evidence.cjs"), "Upload evidence checker runs after generation");
  assert(pkg.scripts?.["check:upload-evidence"] === "node scripts/check-upload-evidence.cjs", "Upload evidence standalone checker script is wired");
  assert(pkg.scripts?.["upload-packet:store"]?.includes("scripts/build-upload-command-packet.cjs"), "Upload command packet generator script is wired");
  assert(pkg.scripts?.["upload-packet:store"]?.includes("scripts/check-upload-command-packet.cjs"), "Upload command packet checker runs after generation");
  assert(pkg.scripts?.["check:upload-packet"] === "node scripts/check-upload-command-packet.cjs", "Upload command packet standalone checker script is wired");
  assert(pkg.scripts?.["apple-assets:store"]?.includes("scripts/build-apple-release-assets.cjs"), "Apple release asset request generator script is wired");
  assert(pkg.scripts?.["apple-assets:store"]?.includes("scripts/check-apple-release-assets.cjs"), "Apple release asset request checker runs after generation");
  assert(pkg.scripts?.["check:apple-assets"] === "node scripts/check-apple-release-assets.cjs", "Apple release asset request standalone checker script is wired");
  assert(pkg.scripts?.["check:upload-credentials"] === "node scripts/check-upload-credentials.cjs", "Upload credential checker script is wired");
  assert(pkg.scripts?.["manifest:store"]?.includes("scripts/build-release-manifest.cjs"), "Release manifest generator script is wired");
  assert(pkg.scripts?.["manifest:store"]?.includes("scripts/check-release-manifest.cjs"), "Release manifest checker runs after generation");
  assert(pkg.scripts?.["check:manifest"] === "node scripts/check-release-manifest.cjs", "Release manifest standalone checker script is wired");
  assert(pkg.scripts?.["check:release-machine"] === "node scripts/check-release-machine.cjs", "Release machine doctor script is wired");
  assert(packet.includes("npm run smoke:store"), "Submission packet includes production store smoke command");
  assert(packet.includes("poisoned localStorage URL sanitization"), "Submission packet documents poisoned-state production smoke coverage");
  assert(packet.includes("desktop layout stability"), "Submission packet documents production store smoke layout coverage");
  assert(packet.includes("npm run smoke:a11y"), "Submission packet includes accessibility smoke command");
  assert(packet.includes("npm run smoke:electron-shell"), "Submission packet includes Electron shell smoke command");
  assert(packet.includes("npm run smoke:clean-profile"), "Submission packet includes clean-profile smoke command");
  assert(packet.includes("npm run smoke:mas-dir"), "Submission packet includes MAS directory smoke command");
  assert(packet.includes("npm run smoke:mas-runtime"), "Submission packet includes packaged MAS runtime smoke command");
  assert(packet.includes("local-only packaged MAS runtime smoke gate"), "Submission packet labels packaged MAS runtime smoke as local-only");
  assert(packet.includes("silent local ad-hoc MAS launch hangs are recorded as advisory"), "Submission packet documents local ad-hoc MAS runtime-smoke limitation");
  assert(packet.includes("local audio import IPC"), "Submission packet describes Electron shell import IPC coverage");
  assert(packet.includes("cody-media byte-range streaming"), "Submission packet describes cody-media streaming coverage");
  assert(packet.includes("npm run verify:store:strict"), "Submission packet includes strict store verifier");
  assert(packet.includes("npm run release:store:preflight"), "Submission packet includes release preflight command");
  assert(releaseManifestMarkdown.includes("## Remaining Blockers"), "Release manifest markdown includes remaining blockers section");
  assert(releaseManifestMarkdown.includes("## Packaging Source Config"), "Release manifest markdown includes packaging source config section");
  assert(packet.includes("npm run release:store:local"), "Submission packet includes local release dry-run command");
  assert(
    includesInOrder(packet.slice(packet.indexOf("# Release-machine sequence")), "npm run screenshots:store", "npm run packet:store"),
    "Submission packet command order refreshes screenshots before packet generation"
  );
  assert(
    (() => {
      const releaseMachineSequence = releaseMachineCommandBlock(packet);
      const signedMasPackageBlock = releaseMachineSequence.slice(
        releaseMachineSequence.indexOf("npm run check:mas-package -- --strict")
      );

      return !signedMasPackageBlock.includes("npm run smoke:mas-runtime") &&
        includesInOrder(signedMasPackageBlock, "npm run check:mas-package -- --strict", "npm run check:upload-tooling -- --strict") &&
        includesInOrder(signedMasPackageBlock, "npm run check:upload-tooling -- --strict", "npm run check:upload-credentials -- --strict") &&
        includesInOrder(signedMasPackageBlock, "npm run check:upload-credentials -- --strict", "npm run upload-packet:store");
    })(),
    "Submission packet command order checks upload credentials before upload packet generation"
  );
  assert(
    includesInOrder(packet.slice(packet.indexOf("# Release-machine sequence")), "npm run export-compliance:store", "npm run packet:store"),
    "Submission packet command order builds export compliance before packet generation"
  );
  assert(
    includesInOrder(packet.slice(packet.indexOf("# Release-machine sequence")), "npm run packet:store", "npm run check:export-compliance"),
    "Submission packet command order checks export compliance after packet generation"
  );
  assert(
    includesInOrder(
      packet.slice(packet.indexOf("# Release-machine sequence")),
      "npm run check:copy-map -- --strict",
      "npm run check:public-release-sync -- --strict"
    ),
    "Submission packet command order checks public release sync after strict copy map check"
  );
  assert(
    includesInOrder(
      packet.slice(packet.indexOf("# Release-machine sequence")),
      "npm run check:public-release-sync -- --strict",
      "npm run check:store-version\n"
    ),
    "Submission packet command order checks generated store version after public release sync"
  );
  assert(
    includesInOrder(packet.slice(packet.indexOf("# Release-machine sequence")), "npm run submission-checklist:store", "npm run machine-report:store") &&
      includesInOrder(packet.slice(packet.indexOf("# Release-machine sequence")), "npm run machine-report:store", "npm run evidence:store"),
    "Submission packet command order records machine report before evidence"
  );
  assert(releaseManifest.app?.bundleId === "com.sachittumuluri.codycartridge", "Release manifest JSON includes bundle id");
  assert(releaseManifest.app?.version === pkg.version, "Release manifest JSON package version matches package.json");
  assert(releaseManifest.app?.buildVersion === pkg.build?.buildVersion, "Release manifest JSON build version matches package config");
  assert(releaseManifest.packaging?.asar === true, "Release manifest records ASAR packaging");
  assert(releaseManifest.packaging?.rendererProtocol === "cody-app://", "Release manifest records packaged renderer protocol");
  assert(releaseManifest.packaging?.electronFuses?.runAsNode === false, "Release manifest records RunAsNode fuse");
  assert(releaseManifest.packaging?.electronFuses?.enableCookieEncryption === true, "Release manifest records cookie encryption fuse");
  assert(
    releaseManifest.packaging?.electronFuses?.enableNodeOptionsEnvironmentVariable === false,
    "Release manifest records NODE_OPTIONS fuse"
  );
  assert(releaseManifest.packaging?.electronFuses?.enableNodeCliInspectArguments === false, "Release manifest records Node inspect fuse");
  assert(
    releaseManifest.packaging?.electronFuses?.enableEmbeddedAsarIntegrityValidation === true,
    "Release manifest records ASAR integrity fuse"
  );
  assert(releaseManifest.packaging?.electronFuses?.onlyLoadAppFromAsar === true, "Release manifest records only-load-from-ASAR fuse");
  assert(
    releaseManifest.packaging?.electronFuses?.grantFileProtocolExtraPrivileges === false,
    "Release manifest records disabled file protocol fuse state"
  );
  assert(releaseManifest.packaging?.macMinimumSystemVersion === "12.0", "Release manifest records Mac minimum system version");
  assert(releaseManifest.packaging?.masMinimumSystemVersion === "12.0", "Release manifest records MAS minimum system version");
  assert(releaseManifest.packaging?.masDevMinimumSystemVersion === "12.0", "Release manifest records MAS development minimum system version");
  assert(releaseManifest.packaging?.infoPlistUsesNonExemptEncryption === false, "Release manifest records no non-exempt encryption Info.plist key");
  assert(
    JSON.stringify(releaseManifest.packaging?.fileAllowlist) === JSON.stringify(["dist/**/*", "electron/**/*", "package.json"]),
    "Release manifest records package file allowlist"
  );
  assert(Array.isArray(releaseManifest.files) && releaseManifest.files.length >= 24, "Release manifest JSON includes file inventory");
	  assert(
	    releaseManifest.files.some((item) => item.path === "app-store-assets/SUBMISSION_PACKET.md" && item.sha256),
	    "Release manifest hashes submission packet"
	  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json" && item.sha256),
    "Release manifest hashes App Store Connect copy map JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_STORE_CONNECT_COPY_MAP.md" && item.sha256),
    "Release manifest hashes App Store Connect copy map markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/EXPORT_COMPLIANCE.json" && item.sha256),
    "Release manifest hashes export compliance JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/EXPORT_COMPLIANCE.md" && item.sha256),
    "Release manifest hashes export compliance markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_STORE_COMPLIANCE.json" && item.sha256),
    "Release manifest hashes App Store compliance JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_STORE_COMPLIANCE.md" && item.sha256),
    "Release manifest hashes App Store compliance markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json" && item.sha256),
    "Release manifest hashes App Store Connect manual tasks JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md" && item.sha256),
    "Release manifest hashes App Store Connect manual tasks markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_CONTENT_RIGHTS.json" && item.sha256),
    "Release manifest hashes content-rights audit JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_CONTENT_RIGHTS.md" && item.sha256),
    "Release manifest hashes content-rights audit markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_REVIEW_BRIEF.json" && item.sha256),
    "Release manifest hashes App Review brief JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APP_REVIEW_BRIEF.md" && item.sha256),
    "Release manifest hashes App Review brief markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/PUBLIC_RELEASE_INPUTS.json" && item.sha256),
    "Release manifest hashes public release inputs JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/PUBLIC_RELEASE_INPUTS.md" && item.sha256),
    "Release manifest hashes public release inputs markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json" && item.sha256),
    "Release manifest hashes public site publish packet JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md" && item.sha256),
    "Release manifest hashes public site publish packet markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/PUBLIC_HOST_RUNBOOK.json" && item.sha256),
    "Release manifest hashes public host runbook JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/PUBLIC_HOST_RUNBOOK.md" && item.sha256),
    "Release manifest hashes public host runbook markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_RESOLUTION_PLAN.json" && item.sha256),
    "Release manifest hashes release resolution plan JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_RESOLUTION_PLAN.md" && item.sha256),
    "Release manifest hashes release resolution plan markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json" && item.sha256),
    "Release manifest hashes final submission checklist JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md" && item.sha256),
    "Release manifest hashes final submission checklist markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_DASHBOARD.json" && item.sha256),
    "Release manifest hashes release dashboard JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_DASHBOARD.html" && item.sha256),
    "Release manifest hashes release dashboard HTML"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_OPERATOR_QUEUE.json" && item.sha256),
    "Release manifest hashes release operator queue JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_OPERATOR_QUEUE.md" && item.sha256),
    "Release manifest hashes release operator queue markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json" && item.sha256),
    "Release manifest hashes signing/upload runbook JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/SIGNING_UPLOAD_RUNBOOK.md" && item.sha256),
    "Release manifest hashes signing/upload runbook markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/SIGNING_ASSET_REPORT.json" && item.sha256),
    "Release manifest hashes signing asset report JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/SIGNING_ASSET_REPORT.md" && item.sha256),
    "Release manifest hashes signing asset report markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APPLE_RELEASE_ASSETS.json" && item.sha256),
    "Release manifest hashes Apple release asset requests JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/APPLE_RELEASE_ASSETS.md" && item.sha256),
    "Release manifest hashes Apple release asset requests markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/UPLOAD_COMMAND_PACKET.json" && item.sha256),
    "Release manifest hashes upload command packet JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/UPLOAD_COMMAND_PACKET.md" && item.sha256),
    "Release manifest hashes upload command packet markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/UPLOAD_EVIDENCE.json" && item.sha256),
    "Release manifest hashes upload evidence JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/UPLOAD_EVIDENCE.md" && item.sha256),
    "Release manifest hashes upload evidence markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_EVIDENCE.json" && item.sha256),
    "Release manifest hashes release evidence JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_EVIDENCE.md" && item.sha256),
    "Release manifest hashes release evidence markdown"
  );
	  assert(
	    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_BLOCKERS.json" && item.sha256),
    "Release manifest hashes release blocker report JSON"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/RELEASE_BLOCKERS.md" && item.sha256),
    "Release manifest hashes release blocker report markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/THIRD_PARTY_NOTICES.md" && item.sha256),
    "Release manifest hashes third-party notice markdown"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/site/third-party-notices.html" && item.sha256),
    "Release manifest hashes public third-party notices page"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/site/robots.txt" && item.sha256),
    "Release manifest hashes public site robots file"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/site/sitemap.xml" && item.sha256),
    "Release manifest hashes public site sitemap"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/site/_headers" && item.sha256),
    "Release manifest hashes public site static host headers"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/site/vercel.json" && item.sha256),
    "Release manifest hashes public site Vercel config"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-store-site.cjs" && item.sha256),
    "Release manifest hashes store site checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-store-version.cjs" && item.sha256),
    "Release manifest hashes store version checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/bump-store-version.cjs" && item.sha256),
    "Release manifest hashes store version bump script"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/public-site/cody-cartridge-public-site.zip" && item.sha256),
    "Release manifest hashes public site archive"
  );
	  assert(
	    releaseManifest.files.some((item) => item.path === "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json" && item.sha256),
	    "Release manifest hashes public site archive manifest"
	  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/site.env.example" && item.sha256),
    "Release manifest hashes store env example"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/init-store-env.cjs" && item.sha256),
    "Release manifest hashes store env initializer"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/configure-store-env.cjs" && item.sha256),
    "Release manifest hashes store env configurator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/store-env.cjs" && item.sha256),
    "Release manifest hashes store env loader"
  );
	  assert(
	    releaseManifest.files.some((item) => item.path === "scripts/check-store-env.cjs" && item.sha256),
	    "Release manifest hashes store env checker"
	  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/refresh-public-release.cjs" && item.sha256),
    "Release manifest hashes public release refresh helper"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-release-evidence.cjs" && item.sha256),
    "Release manifest hashes release evidence generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-release-evidence.cjs" && item.sha256),
    "Release manifest hashes release evidence checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-release-manifest.cjs" && item.sha256),
    "Release manifest hashes release manifest checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-public-release-inputs.cjs" && item.sha256),
    "Release manifest hashes public release inputs generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-public-site-publish-packet.cjs" && item.sha256),
    "Release manifest hashes public site publish packet generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-public-host-runbook.cjs" && item.sha256),
    "Release manifest hashes public host runbook generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-app-store-copy-map.cjs" && item.sha256),
    "Release manifest hashes App Store Connect copy map generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-export-compliance.cjs" && item.sha256),
    "Release manifest hashes export compliance generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-app-review-brief.cjs" && item.sha256),
    "Release manifest hashes App Review brief generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-release-resolution-plan.cjs" && item.sha256),
    "Release manifest hashes release resolution plan generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-final-submission-checklist.cjs" && item.sha256),
    "Release manifest hashes final submission checklist generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-release-dashboard.cjs" && item.sha256),
    "Release manifest hashes release dashboard generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-release-operator-queue.cjs" && item.sha256),
    "Release manifest hashes release operator queue generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-signing-upload-runbook.cjs" && item.sha256),
    "Release manifest hashes signing/upload runbook generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-signing-asset-report.cjs" && item.sha256),
    "Release manifest hashes signing asset report generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-apple-release-assets.cjs" && item.sha256),
    "Release manifest hashes Apple release asset request generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-apple-release-assets.cjs" && item.sha256),
    "Release manifest hashes Apple release asset request checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/install-mas-profile.cjs" && item.sha256),
    "Release manifest hashes MAS profile installer"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/install-asc-key.cjs" && item.sha256),
    "Release manifest hashes App Store Connect key installer"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-upload-command-packet.cjs" && item.sha256),
    "Release manifest hashes upload command packet generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-upload-command-packet.cjs" && item.sha256),
    "Release manifest hashes upload command packet checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-upload-evidence.cjs" && item.sha256),
    "Release manifest hashes upload evidence generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-upload-evidence.cjs" && item.sha256),
    "Release manifest hashes upload evidence checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-app-store-copy-map.cjs" && item.sha256),
    "Release manifest hashes App Store Connect copy map checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-export-compliance.cjs" && item.sha256),
    "Release manifest hashes export compliance checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-app-review-brief.cjs" && item.sha256),
    "Release manifest hashes App Review brief checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-public-release-inputs.cjs" && item.sha256),
    "Release manifest hashes public release inputs checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-public-site-publish-packet.cjs" && item.sha256),
    "Release manifest hashes public site publish packet checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-public-host-runbook.cjs" && item.sha256),
    "Release manifest hashes public host runbook checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-public-site-published.cjs" && item.sha256),
    "Release manifest hashes published public site checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-public-release-sync.cjs" && item.sha256),
    "Release manifest hashes public release sync checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-release-resolution-plan.cjs" && item.sha256),
    "Release manifest hashes release resolution plan checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-final-submission-checklist.cjs" && item.sha256),
    "Release manifest hashes final submission checklist checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-release-dashboard.cjs" && item.sha256),
    "Release manifest hashes release dashboard checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-release-operator-queue.cjs" && item.sha256),
    "Release manifest hashes release operator queue checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-signing-upload-runbook.cjs" && item.sha256),
    "Release manifest hashes signing/upload runbook checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-signing-asset-report.cjs" && item.sha256),
    "Release manifest hashes signing asset report checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-submission-handoff.cjs" && item.sha256),
    "Release manifest hashes submission handoff generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-submission-handoff.cjs" && item.sha256),
    "Release manifest hashes submission handoff checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-public-site-archive.cjs" && item.sha256),
    "Release manifest hashes public site archive generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/build-release-blocker-report.cjs" && item.sha256),
    "Release manifest hashes release blocker report generator"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-public-site-archive.cjs" && item.sha256),
    "Release manifest hashes public site archive checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-electron-security.cjs" && item.sha256),
    "Release manifest hashes Electron security checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-app-privacy.cjs" && item.sha256),
    "Release manifest hashes App privacy checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-artifact-privacy.cjs" && item.sha256),
    "Release manifest hashes artifact privacy checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-store-copy.cjs" && item.sha256),
    "Release manifest hashes store copy checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-store-urls.cjs" && item.sha256),
    "Release manifest hashes public URL checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-help-docs.cjs" && item.sha256),
    "Release manifest hashes Help document checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-packaging-toolchain.cjs" && item.sha256),
    "Release manifest hashes packaging toolchain checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-release-runtime.cjs" && item.sha256),
    "Release manifest hashes release runtime checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/run-release-node.cjs" && item.sha256),
    "Release manifest hashes release-node wrapper"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-release-machine.cjs" && item.sha256),
    "Release manifest hashes release machine doctor"
  );
  assert(
    releaseManifest.files.some((item) => item.path === ".nvmrc" && item.sha256),
    "Release manifest hashes .nvmrc"
  );
  assert(
    releaseManifest.files.some((item) => item.path === ".node-version" && item.sha256),
    "Release manifest hashes .node-version"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-store-screenshots.cjs" && item.sha256),
    "Release manifest hashes store screenshot checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/capture-store-screenshots.cjs" && item.sha256),
    "Release manifest hashes store screenshot capture script"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/screenshots/STORE_SCREENSHOTS.json" && item.sha256),
    "Release manifest hashes store screenshot manifest"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "src/App.tsx" && item.sha256),
    "Release manifest hashes renderer app source"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "src/styles.css" && item.sha256),
    "Release manifest hashes renderer styles source"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-mas-package.cjs" && item.sha256),
    "Release manifest hashes MAS package boundary checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-upload-tooling.cjs" && item.sha256),
    "Release manifest hashes App Store upload tooling checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/check-upload-credentials.cjs" && item.sha256),
    "Release manifest hashes App Store upload credential checker"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/verify-store-readiness.cjs" && item.sha256),
    "Release manifest hashes store readiness verifier"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/verify-store-readiness-with-build.cjs" && item.sha256),
    "Release manifest hashes MAS-artifact-preserving verifier wrapper"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/smoke-store-build.cjs" && item.sha256),
    "Release manifest hashes production store smoke script"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/smoke-accessibility.cjs" && item.sha256),
    "Release manifest hashes accessibility smoke script"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/smoke-electron-shell.cjs" && item.sha256),
    "Release manifest hashes Electron shell smoke script"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/smoke-clean-profile.cjs" && item.sha256),
    "Release manifest hashes clean-profile smoke script"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/smoke-mas-dir-build.cjs" && item.sha256),
    "Release manifest hashes MAS directory smoke script"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "scripts/smoke-mas-runtime.cjs" && item.sha256),
    "Release manifest hashes packaged MAS runtime smoke script"
  );
  assert(
    releaseManifest.files.some((item) => item.path === "app-store-assets/screenshots/01-library-1440x900.png" && item.sha256),
    "Release manifest hashes store screenshots"
  );
	  assert(
	    releaseManifest.packagedApp?.path === "dist/mas-arm64/Cody Cartridge.app",
	    "Release manifest records MAS packaged app path"
	  );
  assert(
    ["missing", "local-rehearsal-only", "submission-ready"].includes(releaseManifest.packagedApp?.mode),
    "Release manifest records MAS app submission posture"
  );
  assert(
    releaseManifest.masSubmission?.bundlePath === "dist/mas-arm64/Cody Cartridge.app",
    "Release manifest records MAS submission bundle path"
  );
  assert(
    releaseManifest.masSubmission?.mode === releaseManifest.packagedApp?.mode,
    "Release manifest packaged app and MAS submission posture agree"
  );
  assert(
    releaseManifest.masSubmission?.submissionReady === releaseManifest.packagedApp?.submissionReady,
    "Release manifest packaged app and MAS submission readiness agree"
  );
  assert(
    releaseManifest.masSubmission?.localRehearsalOnly === releaseManifest.packagedApp?.localRehearsalOnly,
    "Release manifest packaged app and local rehearsal flag agree"
  );
  assert(
    typeof releaseManifest.masSubmission?.hasEmbeddedProvisioningProfile === "boolean",
    "Release manifest records embedded provisioning profile state"
  );
  assert(
    typeof releaseManifest.masSubmission?.codeSignatureVerified === "boolean",
    "Release manifest records MAS app code signature state"
  );
  assert(
    releaseManifest.masSubmission?.uploadPackageCount === releaseManifest.uploadPackages?.length,
    "Release manifest MAS submission upload package count matches inventory"
  );
  assert(
    typeof releaseManifest.masSubmission?.signedUploadPackageCount === "number",
    "Release manifest records signed MAS upload package count"
  );
  assert(typeof releaseManifest.masSubmission?.currentVersionUploadPackageCount === "number", "Release manifest records current-version MAS upload package count");
  assert(
    typeof releaseManifest.masSubmission?.signedCurrentVersionUploadPackageCount === "number",
    "Release manifest records signed current-version MAS upload package count"
  );
  assert(
    (releaseManifest.uploadPackages ?? []).every((item) => typeof item.matchesCurrentVersion === "boolean"),
    "Release manifest records per-package current-version match state"
  );
  assert(
    releaseManifest.masSubmission?.submissionReady !== true ||
      releaseManifest.masSubmission?.hasSignedCurrentVersionUploadPackage === true,
    "Release manifest requires a signed current-version package for MAS submission readiness"
  );
  assert(
    releaseManifest.masSubmission?.mode === releaseEvidence.masSubmission?.mode,
    "Release manifest MAS mode matches release evidence"
  );
  assert(
    releaseManifest.masSubmission?.submissionReady === releaseEvidence.masSubmission?.submissionReady,
    "Release manifest MAS submission readiness matches release evidence"
  );
  assert(
    releaseManifest.masSubmission?.hasEmbeddedProvisioningProfile === releaseEvidence.masSubmission?.hasEmbeddedProvisioningProfile,
    "Release manifest MAS provisioning posture matches release evidence"
  );
  assert(
    releaseManifest.masSubmission?.codeSignatureVerified === releaseEvidence.masSubmission?.codeSignatureVerified,
    "Release manifest MAS code-signature posture matches release evidence"
  );
  assert(
    releaseManifest.masSubmission?.uploadPackageCount === releaseEvidence.masSubmission?.uploadPackageCount &&
      releaseManifest.masSubmission?.signedUploadPackageCount === releaseEvidence.masSubmission?.signedUploadPackageCount &&
      releaseManifest.masSubmission?.currentVersionUploadPackageCount === releaseEvidence.masSubmission?.currentVersionUploadPackageCount &&
      releaseManifest.masSubmission?.signedCurrentVersionUploadPackageCount === releaseEvidence.masSubmission?.signedCurrentVersionUploadPackageCount,
    "Release manifest MAS upload package posture matches release evidence"
  );
  if (releaseManifest.packagedApp?.exists && releaseManifest.masSubmission?.submissionReady !== true) {
    assert(
      releaseManifest.packagedApp?.mode === "local-rehearsal-only" &&
        releaseManifest.packagedApp?.localRehearsalOnly === true,
      "Release manifest labels unsigned/incomplete MAS app bundle as local rehearsal only"
    );
    assert(
      releaseManifestMarkdown.includes("Submission posture: local-rehearsal-only") &&
        releaseManifestMarkdown.includes("Local rehearsal only: yes"),
      "Release manifest markdown calls out local-only MAS rehearsal posture"
    );
    assert(
      (releaseManifest.blockers ?? []).some((item) => /embedded provisioning profile/i.test(item)) ||
        (releaseManifest.blockers ?? []).some((item) => /code signature/i.test(item)) ||
        (releaseManifest.blockers ?? []).some((item) => /upload \.pkg/i.test(item)) ||
        (releaseManifest.blockers ?? []).some((item) => /local-rehearsal-only/i.test(item)),
      "Release manifest keeps final signed MAS artifact blockers when only a local rehearsal bundle exists"
    );
  }
  assert(Array.isArray(releaseManifest.uploadPackages), "Release manifest records MAS upload package inventory");
	  assert(releaseManifestMarkdown.includes("MAS Upload Packages"), "Release manifest markdown includes MAS upload package section");
  assert(uploadCommandPacket.app?.bundleId === "com.sachittumuluri.codycartridge", "Upload command packet records bundle id");
  assert(uploadCommandPacket.app?.version === pkg.version, "Upload command packet package version matches package.json");
  assert(uploadCommandPacket.app?.buildVersion === pkg.build?.buildVersion, "Upload command packet build version matches package config");
  assert(["ready", "blocked"].includes(uploadCommandPacket.summary?.status), "Upload command packet records known readiness status");
  assert(typeof uploadCommandPacket.summary?.availableToolCount === "number", "Upload command packet records available upload tool count");
  assert(typeof uploadCommandPacket.summary?.signedUploadPackageCount === "number", "Upload command packet records signed package count");
  assert(typeof uploadCommandPacket.summary?.currentVersionUploadPackageCount === "number", "Upload command packet records current-version package count");
  assert(typeof uploadCommandPacket.summary?.signedCurrentVersionUploadPackageCount === "number", "Upload command packet records signed current-version package count");
  assert(
    uploadCommandPacket.summary?.masSubmissionReady === (releaseManifest.masSubmission?.submissionReady === true),
    "Upload command packet MAS readiness matches release manifest"
  );
  assert(
    uploadCommandPacket.summary?.uploadEvidenceStatus === (uploadEvidence.upload?.status ?? "pending"),
    "Upload command packet upload evidence status matches upload evidence"
  );
  assert(
    uploadCommandPacket.summary?.signingAssetStatus === (signingAssetReport.summary?.status ?? "unknown"),
    "Upload command packet signing asset status matches signing report"
  );
  assert(
    uploadCommandPacket.redaction?.storesAppleCredentials === false &&
      uploadCommandPacket.redaction?.storesSigningSecrets === false &&
      uploadCommandPacket.redaction?.storesRawUploadLogs === false &&
      uploadCommandPacket.redaction?.credentialPlaceholdersOnly === true,
    "Upload command packet records credential, signing-secret, and raw-log redaction posture"
  );
  assert((uploadCommandPacket.commands ?? []).includes("npm run check:mas-package -- --strict"), "Upload command packet includes strict MAS package check");
  assert((uploadCommandPacket.commands ?? []).includes("npm run check:upload-tooling -- --strict"), "Upload command packet includes strict upload tooling check");
  assert((uploadCommandPacket.commands ?? []).includes("npm run check:upload-credentials -- --strict"), "Upload command packet includes strict upload credential check");
  assert(
    uploadCommandPacket.credentialCheck?.command === "npm run check:upload-credentials -- --strict" &&
      ["ready", "blocked"].includes(uploadCommandPacket.summary?.uploadCredentialStatus),
    "Upload command packet records upload credential preflight status"
  );
  assert(
    (uploadCommandPacket.uploadPackages ?? []).every((item) => typeof item.matchesCurrentVersion === "boolean"),
    "Upload command packet records per-package current-version match state"
  );
  assert(
    uploadCommandPacket.selectedPackageSelection?.policy?.includes("current package.json version/build") &&
      ["signed-current-version", "current-version-needs-signature", "signed-stale-version", "stale-version-needs-rebuild", "pending"].includes(
        uploadCommandPacket.selectedPackageSelection?.reason
      ),
    "Upload command packet records current-version selection policy"
  );
  assert(
    includesInOrder((uploadCommandPacket.commands ?? []).join("\n"), "npm run check:upload-tooling -- --strict", "npm run check:upload-credentials -- --strict") &&
      includesInOrder((uploadCommandPacket.commands ?? []).join("\n"), "npm run check:upload-credentials -- --strict", "open -a Transporter"),
    "Upload command packet runs credential preflight before opening Transporter"
  );
  assert((uploadCommandPacket.commands ?? []).some((command) => command.startsWith("open -a Transporter")), "Upload command packet includes Transporter command");
  assert((uploadCommandPacket.commands ?? []).some((command) => command.startsWith("npm run upload-evidence:store -- --log")), "Upload command packet includes upload evidence command");
  assert((uploadCommandPacket.commands ?? []).some((command) => command.includes("npm run upload-packet:store")), "Upload command packet includes regeneration command");
  assert(
    [
      "package.json",
      "app-store-assets/RELEASE_MANIFEST.json",
      "app-store-assets/SIGNING_ASSET_REPORT.json",
      "app-store-assets/UPLOAD_EVIDENCE.json",
      "scripts/build-upload-command-packet.cjs",
      "scripts/check-upload-command-packet.cjs",
      "scripts/check-mas-package.cjs",
      "scripts/check-upload-tooling.cjs",
      "scripts/check-upload-credentials.cjs"
    ].every((artifact) => uploadCommandPacket.sourceArtifacts?.includes(artifact)),
    "Upload command packet records source artifacts"
  );
  const uploadCommandPacketSecretScan = JSON.stringify(uploadCommandPacket).replaceAll(
    "/path/to/AuthKey_<key-id>.p8",
    "<asc-key-file-placeholder>"
  );
  assert(
    !/-----BEGIN [^-]+PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+/-]+=*|\.p8\b|\.p12\b|\.mobileprovision\b/i.test(
      uploadCommandPacketSecretScan
    ),
    "Upload command packet JSON excludes private key, token, and signing profile material"
  );
  assert(uploadCommandPacketMarkdown.includes("# Cody Cartridge Upload Command Packet"), "Upload command packet markdown includes title");
  assert(uploadCommandPacketMarkdown.includes("## Upload Package"), "Upload command packet markdown includes package section");
  assert(uploadCommandPacketMarkdown.includes("## Upload Tools"), "Upload command packet markdown includes tooling section");
  assert(uploadCommandPacketMarkdown.includes("## Command Order"), "Upload command packet markdown includes command order");
  assert(uploadCommandPacketGenerator.includes("UPLOAD_COMMAND_PACKET.json"), "Upload command packet generator writes JSON output");
  assert(uploadCommandPacketGenerator.includes("UPLOAD_COMMAND_PACKET.md"), "Upload command packet generator writes markdown output");
  assert(uploadCommandPacketGenerator.includes("storesAppleCredentials: false"), "Upload command packet generator records Apple credential redaction posture");
  assert(uploadCommandPacketGenerator.includes("open -a Transporter"), "Upload command packet generator records Transporter command path");
  assert(uploadCommandPacketGenerator.includes("signed-current-version"), "Upload command packet generator prefers signed current-version packages");
  assert(uploadCommandPacketGenerator.includes("current package.json version/build"), "Upload command packet generator documents current-version package selection");
  assert(appleReleaseAssetsGenerator.includes("APPLE_RELEASE_ASSETS.json"), "Apple release asset request generator writes JSON output");
  assert(appleReleaseAssetsGenerator.includes("app-store-connect-api-key"), "Apple release asset request generator records API key asset request");
  assert(appleReleaseAssetsGenerator.includes("mas-provisioning-profile"), "Apple release asset request generator records MAS provisioning profile request");
  assert(appleReleaseAssetsChecker.includes("Apple release asset packet records entitlement"), "Apple release asset request checker validates entitlement coverage");
  assert(appleReleaseAssetsChecker.includes("excludes signing/API secret material"), "Apple release asset request checker validates redaction");
  assert(uploadCommandPacketChecker.includes("rawIncludesSecretMaterial"), "Upload command packet checker rejects secret material");
  assert(uploadCommandPacketChecker.includes("available tool count matches current machine"), "Upload command packet checker validates current upload tooling count");
  assert(uploadCommandPacketChecker.includes("selected package follows signed current-version priority"), "Upload command packet checker validates current-version package selection priority");
  assert(uploadEvidence.app?.bundleId === "com.sachittumuluri.codycartridge", "Upload evidence records bundle id");
  assert(uploadEvidence.app?.version === pkg.version, "Upload evidence package version matches package.json");
  assert(uploadEvidence.app?.buildVersion === pkg.build?.buildVersion, "Upload evidence build version matches package config");
  assert(["pending", "uploaded", "processing", "processed", "selected", "blocked"].includes(uploadEvidence.upload?.status), "Upload evidence records known status");
  assert(uploadEvidence.buildSelection?.requiredStatus === "selected", "Upload evidence records selected-build requirement");
  assert(
    uploadEvidence.buildSelection?.selectedInAppStoreConnect ===
      (uploadEvidence.upload?.status === "selected" && uploadEvidence.processedBuild?.matchesPackage === true),
    "Upload evidence selected-build proof flag is tied to processed build match"
  );
  assert(
    uploadEvidence.buildSelection?.proofComplete ===
      (uploadEvidence.buildSelection?.selectedInAppStoreConnect === true && uploadEvidence.upload?.hasDeliveryLogs === true),
    "Upload evidence proof-complete flag requires delivery logs and selected build"
  );
  assert(uploadEvidence.redaction?.storesRawLogs === false, "Upload evidence records raw-log exclusion");
  assert(uploadEvidence.redaction?.redactsApiCredentials === true, "Upload evidence records API credential redaction");
  assert(uploadEvidence.redaction?.redactsSigningMaterial === true, "Upload evidence records signing-material redaction");
  assert(uploadEvidenceMarkdown.includes("Build Selection Proof"), "Upload evidence markdown includes selected-build proof section");
  assert(uploadEvidenceMarkdown.includes("Sanitized Delivery Logs"), "Upload evidence markdown includes sanitized delivery log section");
  assert(uploadEvidenceMarkdown.includes("Raw delivery logs are not stored"), "Upload evidence markdown documents raw-log exclusion");
  assert(
    uploadEvidenceGenerator.includes("buildSelection") &&
      uploadEvidenceGenerator.includes("selectedInAppStoreConnect") &&
      uploadEvidenceGenerator.includes("redactsLocalPaths"),
    "Upload evidence generator records build-selection proof and sanitizes local paths"
  );
  assert(uploadEvidenceChecker.includes("includesSecretMaterial"), "Upload evidence checker rejects secret material");
  assert(uploadEvidenceChecker.includes("proofComplete"), "Upload evidence checker validates selected-build proof completion");
  assert(
	    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run verify:store:strict"),
	    "Release manifest records strict verifier command"
  );
	  assert(
	    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run release:store:local"),
	    "Release manifest records local release dry-run command"
	  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run init:store-env"),
    "Release manifest records store env initializer command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run public-release:store -- --published"),
    "Release manifest records public release refresh command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run public-release:store -- --self-test"),
    "Release manifest records public release refresh self-test command"
  );
	  assert(
	    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:store-version"),
    "Release manifest records store version command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:store-version:source"),
    "Release manifest records source-only store version command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run smoke:store"),
    "Release manifest records production store smoke command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:electron-security"),
    "Release manifest records Electron security command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:help-docs"),
    "Release manifest records Help document command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run smoke:a11y"),
    "Release manifest records accessibility smoke command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run smoke:electron-shell"),
    "Release manifest records Electron shell smoke command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run smoke:clean-profile"),
    "Release manifest records clean-profile smoke command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:site -- --strict"),
    "Release manifest records strict store site validation command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run archive:site"),
    "Release manifest records public site archive command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:site-archive -- --strict"),
    "Release manifest records strict public site archive command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:screenshots"),
    "Release manifest records store screenshot quality command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && !releaseManifest.releaseCommands.includes("npm run smoke:mas-dir"),
    "Release manifest keeps local-only MAS directory smoke out of signed release commands"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && !releaseManifest.releaseCommands.includes("npm run smoke:mas-runtime"),
    "Release manifest keeps local-only packaged MAS runtime smoke out of signed release commands"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:app-privacy"),
    "Release manifest records App privacy command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run export-compliance:store"),
    "Release manifest records export compliance generation command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:export-compliance"),
    "Release manifest records export compliance check command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run copy-map:store"),
    "Release manifest records App Store Connect copy map generation command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run review-brief:store"),
    "Release manifest records App Review brief generation command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:copy-map -- --strict"),
    "Release manifest records strict App Store Connect copy map check command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:review-brief -- --strict"),
    "Release manifest records strict App Review brief check command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:public-release-sync -- --strict"),
    "Release manifest records strict public release sync command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:artifact-privacy"),
    "Release manifest records artifact privacy command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:store-copy"),
    "Release manifest records store copy command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:packaging-toolchain"),
    "Release manifest records packaging toolchain command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:release-runtime -- --strict"),
    "Release manifest records strict release runtime command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:release-runtime:node -- --strict"),
    "Release manifest records Node-safe strict release runtime command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:release-machine -- --strict"),
    "Release manifest records strict release machine doctor command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:release-machine:node -- --strict"),
    "Release manifest records Node-safe strict release machine doctor command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:store-urls -- --strict"),
    "Release manifest records strict public URL reachability command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:published-site -- --strict"),
    "Release manifest records strict published-site command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:mas-package -- --strict"),
    "Release manifest records strict MAS package boundary command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run report:store-blockers"),
    "Release manifest records release blocker report command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run resolution-plan:store"),
    "Release manifest records release resolution plan command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run submission-checklist:store"),
    "Release manifest records final submission checklist command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run public-inputs:store"),
    "Release manifest records public release-input command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run publish-packet:store"),
    "Release manifest records public site publish packet command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run public-host:store"),
    "Release manifest records public host runbook command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run dashboard:store"),
    "Release manifest records release dashboard command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run operator:store"),
    "Release manifest records release operator queue command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run signing-runbook:store"),
    "Release manifest records signing/upload runbook command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run signing-assets:store"),
    "Release manifest records signing asset report command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.includes("npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run"),
    "Release manifest records MAS profile validation command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run upload-packet:store"),
    "Release manifest records upload command packet command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run apple-assets:store"),
    "Release manifest records Apple release asset request command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run upload-evidence:store"),
    "Release manifest records upload evidence command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run evidence:store"),
    "Release manifest records release evidence command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:evidence"),
    "Release manifest records release evidence check command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run check:manifest"),
    "Release manifest records release manifest check command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run handoff:store"),
    "Release manifest records submission handoff command"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run handoff:store") <
        releaseManifest.releaseCommands.indexOf("npm run check:release-machine -- --strict") &&
      releaseManifest.releaseCommands.indexOf("npm run check:release-machine -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run verify:store:strict"),
    "Release manifest runs release machine doctor between handoff and strict verifier"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.includes("npm run release:store:local:node") &&
      releaseManifest.releaseCommands.includes("npm run release:store:preflight:node") &&
      releaseManifest.releaseCommands.includes("npm run verify:store:strict:node"),
    "Release manifest records Node-safe release shortcut commands"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:upload-tooling -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") &&
      releaseManifest.releaseCommands.indexOf("npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") <
        releaseManifest.releaseCommands.indexOf("npm run check:upload-credentials -- --strict") &&
      releaseManifest.releaseCommands.indexOf("npm run check:upload-credentials -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run upload-packet:store") &&
      releaseManifest.releaseCommands.indexOf("npm run upload-packet:store") <
        releaseManifest.releaseCommands.indexOf("npm run apple-assets:store") &&
      releaseManifest.releaseCommands.indexOf("npm run apple-assets:store") <
        releaseManifest.releaseCommands.indexOf("npm run upload-evidence:store") &&
      releaseManifest.releaseCommands.indexOf("npm run upload-evidence:store") <
        releaseManifest.releaseCommands.indexOf("npm run report:store-blockers"),
    "Release manifest records ASC key validation, upload command packet, and evidence after upload tooling and before blocker report"
  );
  assert(releaseEvidence.app?.bundleId === "com.sachittumuluri.codycartridge", "Release evidence records bundle id");
  assert(releaseEvidence.app?.version === pkg.version, "Release evidence package version matches package.json");
  assert(releaseEvidence.app?.buildVersion === pkg.build?.buildVersion, "Release evidence build version matches package config");
  assert(releaseEvidence.blockers?.blockerCount === releaseBlockers.summary?.blockerCount, "Release evidence blocker count matches blocker report");
  assert(Array.isArray(releaseEvidence.commands) && releaseEvidence.commands.length >= 12, "Release evidence includes command summaries");
  assert(
    releaseEvidence.commands.some((item) => item.id === "mas-package-strict" && item.strict === true),
    "Release evidence includes strict MAS package command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "store-urls-strict" && item.strict === true),
    "Release evidence includes strict public URL command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "published-site-strict" && item.strict === true),
    "Release evidence includes strict published-site command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "upload-evidence"),
    "Release evidence includes upload evidence command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "upload-packet"),
    "Release evidence includes upload command packet summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "publish-packet"),
    "Release evidence includes public site publish packet command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "public-host"),
    "Release evidence includes public host runbook command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "published-site-advisory"),
    "Release evidence includes advisory published-site command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "public-release-sync-advisory"),
    "Release evidence includes advisory public release sync command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "public-release-sync-strict" && item.strict === true),
    "Release evidence includes strict public release sync command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "release-machine-doctor"),
    "Release evidence includes release machine doctor command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "release-machine-doctor-strict" && item.strict === true),
    "Release evidence includes strict release machine doctor command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "artifact-privacy" && item.exitCode === 0),
    "Release evidence includes artifact privacy command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "export-compliance" && item.exitCode === 0),
    "Release evidence includes export compliance command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "copy-map" && item.exitCode === 0),
    "Release evidence includes App Store Connect copy map command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "review-brief" && item.exitCode === 0),
    "Release evidence includes App Review brief command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "public-inputs" && item.exitCode === 0),
    "Release evidence includes public release inputs command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "resolution-plan" && item.exitCode === 0),
    "Release evidence includes release resolution plan command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "submission-checklist" && item.exitCode === 0),
    "Release evidence includes final submission checklist command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "signing-runbook" && item.exitCode === 0),
    "Release evidence includes signing/upload runbook command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "signing-assets" && item.exitCode === 0),
    "Release evidence includes signing asset report command summary"
  );
  assert(
    releaseEvidence.commands.some((item) => item.id === "apple-assets" && item.exitCode === 0),
    "Release evidence includes Apple release asset request command summary"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/SUBMISSION_PACKET.md" && item.sha256),
    "Release evidence hashes submission packet"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json" && item.sha256),
    "Release evidence hashes App Store Connect copy map JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_STORE_CONNECT_COPY_MAP.md" && item.sha256),
    "Release evidence hashes App Store Connect copy map markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/EXPORT_COMPLIANCE.json" && item.sha256),
    "Release evidence hashes export compliance JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/EXPORT_COMPLIANCE.md" && item.sha256),
    "Release evidence hashes export compliance markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_STORE_COMPLIANCE.json" && item.sha256),
    "Release evidence hashes App Store compliance JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_STORE_COMPLIANCE.md" && item.sha256),
    "Release evidence hashes App Store compliance markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json" && item.sha256),
    "Release evidence hashes App Store Connect manual tasks JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md" && item.sha256),
    "Release evidence hashes App Store Connect manual tasks markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_CONTENT_RIGHTS.json" && item.sha256),
    "Release evidence hashes content-rights audit JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_CONTENT_RIGHTS.md" && item.sha256),
    "Release evidence hashes content-rights audit markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_REVIEW_BRIEF.json" && item.sha256),
    "Release evidence hashes App Review brief JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APP_REVIEW_BRIEF.md" && item.sha256),
    "Release evidence hashes App Review brief markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/PUBLIC_RELEASE_INPUTS.json" && item.sha256),
    "Release evidence hashes public release inputs JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/PUBLIC_RELEASE_INPUTS.md" && item.sha256),
    "Release evidence hashes public release inputs markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json" && item.sha256),
    "Release evidence hashes public site publish packet JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md" && item.sha256),
    "Release evidence hashes public site publish packet markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/PUBLIC_HOST_RUNBOOK.json" && item.sha256),
    "Release evidence hashes public host runbook JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/PUBLIC_HOST_RUNBOOK.md" && item.sha256),
    "Release evidence hashes public host runbook markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/RELEASE_RESOLUTION_PLAN.json" && item.sha256),
    "Release evidence hashes release resolution plan JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/RELEASE_RESOLUTION_PLAN.md" && item.sha256),
    "Release evidence hashes release resolution plan markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json" && item.sha256),
    "Release evidence hashes final submission checklist JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md" && item.sha256),
    "Release evidence hashes final submission checklist markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json" && item.sha256),
    "Release evidence hashes signing/upload runbook JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/SIGNING_UPLOAD_RUNBOOK.md" && item.sha256),
    "Release evidence hashes signing/upload runbook markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/SIGNING_ASSET_REPORT.json" && item.sha256),
    "Release evidence hashes signing asset report JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/SIGNING_ASSET_REPORT.md" && item.sha256),
    "Release evidence hashes signing asset report markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APPLE_RELEASE_ASSETS.json" && item.sha256),
    "Release evidence hashes Apple release asset requests JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/APPLE_RELEASE_ASSETS.md" && item.sha256),
    "Release evidence hashes Apple release asset requests markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/UPLOAD_COMMAND_PACKET.json" && item.sha256),
    "Release evidence hashes upload command packet JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/UPLOAD_COMMAND_PACKET.md" && item.sha256),
    "Release evidence hashes upload command packet markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/UPLOAD_EVIDENCE.json" && item.sha256),
    "Release evidence hashes upload evidence JSON"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/UPLOAD_EVIDENCE.md" && item.sha256),
    "Release evidence hashes upload evidence markdown"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "scripts/build-apple-release-assets.cjs" && item.sha256),
    "Release evidence hashes Apple release asset request generator"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "scripts/check-apple-release-assets.cjs" && item.sha256),
    "Release evidence hashes Apple release asset request checker"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "scripts/build-upload-command-packet.cjs" && item.sha256),
    "Release evidence hashes upload command packet generator"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "scripts/check-upload-command-packet.cjs" && item.sha256),
    "Release evidence hashes upload command packet checker"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "scripts/build-upload-evidence.cjs" && item.sha256),
    "Release evidence hashes upload evidence generator"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "scripts/check-upload-evidence.cjs" && item.sha256),
    "Release evidence hashes upload evidence checker"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "scripts/install-mas-profile.cjs" && item.sha256),
    "Release evidence hashes MAS profile installer"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "scripts/install-asc-key.cjs" && item.sha256),
    "Release evidence hashes App Store Connect key installer"
  );
  assert(
    releaseEvidence.artifacts?.some((item) => item.path === "app-store-assets/screenshots/STORE_SCREENSHOTS.json" && item.sha256),
    "Release evidence hashes screenshot manifest"
  );
  assert(
    ["missing", "local-rehearsal-only", "submission-ready"].includes(releaseEvidence.masSubmission?.mode),
    "Release evidence records MAS submission posture"
  );
  assert(
    releaseEvidence.masSubmission?.bundlePath === "dist/mas-arm64/Cody Cartridge.app",
    "Release evidence records MAS submission bundle path"
  );
  assert(
    typeof releaseEvidence.masSubmission?.submissionReady === "boolean",
    "Release evidence records MAS submission readiness"
  );
  assert(
    typeof releaseEvidence.masSubmission?.localRehearsalOnly === "boolean",
    "Release evidence records MAS local rehearsal state"
  );
  assert(
    typeof releaseEvidence.masSubmission?.hasEmbeddedProvisioningProfile === "boolean",
    "Release evidence records embedded provisioning profile state"
  );
  assert(
    typeof releaseEvidence.masSubmission?.codeSignatureVerified === "boolean",
    "Release evidence records MAS app code signature state"
  );
  assert(
    typeof releaseEvidence.masSubmission?.uploadPackageCount === "number" &&
      typeof releaseEvidence.masSubmission?.signedUploadPackageCount === "number" &&
      typeof releaseEvidence.masSubmission?.currentVersionUploadPackageCount === "number" &&
      typeof releaseEvidence.masSubmission?.signedCurrentVersionUploadPackageCount === "number",
    "Release evidence records MAS upload package counts"
  );
  assert(
    releaseEvidence.masSubmission?.submissionReady !== true ||
      releaseEvidence.masSubmission?.hasSignedCurrentVersionUploadPackage === true,
    "Release evidence requires a signed current-version package for MAS submission readiness"
  );
  assert(
    (releaseEvidence.masSubmission?.packageSignatures ?? []).every((item) => typeof item.matchesCurrentVersion === "boolean"),
    "Release evidence records per-package current-version match state"
  );
  assert(releaseEvidenceMarkdown.includes("MAS Submission Posture"), "Release evidence markdown includes MAS submission posture");
  assert(
    releaseEvidenceMarkdown.includes("Local rehearsal only") && releaseEvidenceMarkdown.includes("Signed upload packages"),
    "Release evidence markdown calls out local-only and signed-package MAS posture"
  );
  assert(
    submissionHandoff.archivePath === "app-store-assets/submission-handoff/cody-cartridge-app-store-handoff.zip",
    "Submission handoff manifest records archive path"
  );
  assert(/^[a-f0-9]{64}$/.test(String(submissionHandoff.archiveSha256 ?? "")), "Submission handoff manifest records archive hash");
  assert(submissionHandoff.archiveSizeBytes > 10000, "Submission handoff manifest records plausible archive size");
  assert(submissionHandoff.blockers?.blockerCount === releaseBlockers.summary?.blockerCount, "Submission handoff blocker count matches blocker report");
  assert(
    submissionHandoff.exclusions?.includes("app-store-assets/site.env") &&
      submissionHandoff.exclusions?.includes("local music import directory") &&
      submissionHandoff.exclusions?.includes("app-store-assets/upload-logs/raw/") &&
      submissionHandoff.exclusions?.includes("raw upload delivery logs"),
    "Submission handoff manifest records private/local exclusions"
  );
  assert(
    [
      "SUBMISSION_PACKET.md",
      "APP_STORE_CONNECT_FIELDS.json",
      "APP_STORE_CONNECT_COPY_MAP.json",
      "APP_STORE_CONNECT_COPY_MAP.md",
      "EXPORT_COMPLIANCE.json",
      "EXPORT_COMPLIANCE.md",
      "APP_STORE_COMPLIANCE.json",
      "APP_STORE_COMPLIANCE.md",
      "APP_STORE_CONNECT_MANUAL_TASKS.json",
      "APP_STORE_CONNECT_MANUAL_TASKS.md",
      "APP_CONTENT_RIGHTS.json",
      "APP_CONTENT_RIGHTS.md",
      "APP_REVIEW_BRIEF.json",
      "APP_REVIEW_BRIEF.md",
      "PUBLIC_RELEASE_INPUTS.json",
      "PUBLIC_RELEASE_INPUTS.md",
      "PUBLIC_SITE_PUBLISH_PACKET.json",
      "PUBLIC_SITE_PUBLISH_PACKET.md",
      "PUBLIC_HOST_RUNBOOK.json",
      "PUBLIC_HOST_RUNBOOK.md",
      "RELEASE_RESOLUTION_PLAN.json",
      "RELEASE_RESOLUTION_PLAN.md",
      "FINAL_SUBMISSION_CHECKLIST.json",
      "FINAL_SUBMISSION_CHECKLIST.md",
      "RELEASE_DASHBOARD.json",
      "RELEASE_DASHBOARD.html",
      "RELEASE_OPERATOR_QUEUE.json",
      "RELEASE_OPERATOR_QUEUE.md",
      "SIGNING_UPLOAD_RUNBOOK.json",
      "SIGNING_UPLOAD_RUNBOOK.md",
      "SIGNING_ASSET_REPORT.json",
      "SIGNING_ASSET_REPORT.md",
      "APPLE_RELEASE_ASSETS.json",
      "APPLE_RELEASE_ASSETS.md",
      "UPLOAD_COMMAND_PACKET.json",
      "UPLOAD_COMMAND_PACKET.md",
      "UPLOAD_EVIDENCE.json",
      "UPLOAD_EVIDENCE.md",
      "RELEASE_MANIFEST.json",
      "screenshots/STORE_SCREENSHOTS.json"
    ].every((entryName) =>
      submissionHandoff.entries?.some((entry) => entry.name === entryName && /^[a-f0-9]{64}$/.test(String(entry.sha256 ?? "")))
    ),
    "Submission handoff manifest hashes required handoff entries"
  );
  assert(releaseEvidenceMarkdown.includes("Command Evidence"), "Release evidence markdown includes command evidence table");
  assert(releaseEvidenceMarkdown.includes("Artifact Hashes"), "Release evidence markdown includes artifact hashes");
  assert(releaseEvidenceMarkdown.includes("redacts local paths"), "Release evidence markdown documents redaction");
	  assert(
	    releaseBlockers.app?.bundleId === "com.sachittumuluri.codycartridge",
    "Release blocker report records bundle id"
  );
  assert(
    releaseBlockers.app?.version === pkg.version && releaseBlockers.app?.buildVersion === pkg.build?.buildVersion,
    "Release blocker report records package and build versions"
  );
  assert(
    Array.isArray(releaseBlockers.categories) &&
      ["public-inputs", "generated-site", "signing-package", "submission"].every((id) =>
        releaseBlockers.categories.some((item) => item.id === id)
      ),
    "Release blocker report includes public, site, signing, and submission categories"
  );
  assert(
    releaseBlockers.summary?.blockerCount === (releaseBlockers.blockers ?? []).length,
    "Release blocker report blocker count matches blocker list"
  );
  assert(
    releaseBlockers.summary?.blockerDetailCount === (releaseBlockers.blockerDetails ?? []).length &&
      releaseBlockers.summary?.blockerDetailCount === releaseBlockers.summary?.blockerCount,
    "Release blocker report structured blocker details match blocker count"
  );
  assert(
    (releaseBlockers.blockerDetails ?? []).every(
      (item) =>
        item.id &&
        item.categoryId &&
        item.categoryLabel &&
        item.checkId &&
        item.label &&
        item.owner &&
        item.evidence &&
        item.action &&
        item.status === "blocked"
    ),
    "Release blocker report structured blocker details include category, owner, evidence, and action"
  );
  assert(
    (releaseBlockers.blockerDetails ?? []).every((item) =>
      (releaseBlockers.categories ?? []).some((category) =>
        category.id === item.categoryId && (category.checks ?? []).some((check) => check.id === item.checkId)
      )
    ),
    "Release blocker report structured blocker details map back to category checks"
  );
  assert(
    releaseBlockers.summary?.nextActionCount === (releaseBlockers.nextActionQueue ?? []).length &&
      releaseBlockers.summary?.nextActionCount === releaseBlockers.summary?.blockedCategoryCount,
    "Release blocker report next-action queue matches blocked categories"
  );
  assert(
    (releaseBlockers.nextActionQueue ?? []).every(
      (item) => item.categoryId && item.categoryLabel && item.firstBlockedCheckId && item.nextAction && item.recommendedCommand
    ),
    "Release blocker report next-action queue records first action and command per blocked category"
  );
  assert(
    ["public-inputs", "generated-site", "submission"].every((categoryId) =>
      (releaseBlockers.nextActionQueue ?? []).some(
        (item) =>
          item.categoryId === categoryId &&
          (item.recommendedCommand.includes("npm run public-release:store -- --self-test") ||
            item.recommendedCommand.includes("npm run public-release:store:node -- --self-test"))
      )
    ),
    "Release blocker report routes public-release phases through the wrapper self-test"
  );
  assert(
    (releaseBlockers.categories ?? [])
      .flatMap((category) => category.checks ?? [])
      .some((item) => item.id === "public-release-sync-strict"),
    "Release blocker report includes strict public release sync gate"
  );
  assert(
    !((releaseBlockers.categories ?? [])
      .find((category) => category.id === "public-inputs")
      ?.checks ?? []
    ).some((item) => item.status === "blocked" && item.evidence === "value is present"),
    "Release blocker report explains blocked public inputs without vague present-value evidence"
  );
  assert(
    releaseBlockers.redaction?.includes("redacted") &&
      !releaseBlockersMarkdown.includes("+1-555-555-5555") &&
      !releaseBlockersMarkdown.includes("TODO_REVIEW_CONTACT_PHONE"),
    "Release blocker report documents redaction and avoids raw phone placeholders"
  );
  assert(
    releaseBlockersMarkdown.includes("Ready for strict preflight") &&
      releaseBlockersMarkdown.includes("npm run release:store:preflight"),
    "Release blocker report markdown includes preflight handoff"
  );
  assert(
    releaseBlockersMarkdown.includes("## Next Action Queue") &&
      releaseBlockersMarkdown.includes("## Structured Blocker Details") &&
      releaseBlockersMarkdown.includes("Recommended command"),
    "Release blocker report markdown includes structured action queue"
  );
  assert(releaseBlockersMarkdown.includes("npm run handoff:store"), "Release blocker report includes handoff archive command");
  assert(releaseBlockersMarkdown.includes("npm run public-inputs:store"), "Release blocker report includes public release-input command");
  assert(releaseBlockersMarkdown.includes("npm run check:public-release-sync -- --strict"), "Release blocker report includes strict public release sync command");
  assert(releaseBlockersMarkdown.includes("npm run check:published-site -- --strict"), "Release blocker report includes strict published-site command");
  assert(releaseBlockersMarkdown.includes("npm run dashboard:store"), "Release blocker report includes release dashboard command");
  assert(releaseBlockersMarkdown.includes("npm run operator:store"), "Release blocker report includes release operator queue command");
  assert(
	    Array.isArray(releaseManifest.releaseCommands) &&
	      releaseManifest.releaseCommands.indexOf("npm run init:store-env") <
	        releaseManifest.releaseCommands.indexOf("npm run check:store-env"),
	    "Release manifest command order initializes store env before checking it"
	  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:packaging-toolchain") <
        releaseManifest.releaseCommands.indexOf("npm run public-release:store -- --published") &&
      releaseManifest.releaseCommands.indexOf("npm run public-release:store -- --published") <
        releaseManifest.releaseCommands.indexOf("npm run site:store"),
    "Release manifest command order runs public refresh before expanded public-site commands"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run report:store-blockers") <
        releaseManifest.releaseCommands.indexOf("npm run public-inputs:store"),
    "Release manifest command order builds public release-input packet after blocker report"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run public-inputs:store") <
        releaseManifest.releaseCommands.indexOf("npm run publish-packet:store") &&
      releaseManifest.releaseCommands.indexOf("npm run publish-packet:store") <
        releaseManifest.releaseCommands.indexOf("npm run public-host:store") &&
      releaseManifest.releaseCommands.indexOf("npm run public-host:store") <
        releaseManifest.releaseCommands.lastIndexOf("npm run signing-assets:store") &&
      releaseManifest.releaseCommands.lastIndexOf("npm run signing-assets:store") <
        releaseManifest.releaseCommands.lastIndexOf("npm run upload-packet:store") &&
      releaseManifest.releaseCommands.lastIndexOf("npm run upload-packet:store") <
        releaseManifest.releaseCommands.lastIndexOf("npm run copy-map:store") &&
      releaseManifest.releaseCommands.lastIndexOf("npm run copy-map:store") <
        releaseManifest.releaseCommands.lastIndexOf("npm run apple-assets:store") &&
      releaseManifest.releaseCommands.lastIndexOf("npm run apple-assets:store") <
        releaseManifest.releaseCommands.indexOf("npm run signing-runbook:store"),
    "Release manifest command order refreshes final copy map and Apple asset packet before signing/upload runbook"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:store-urls -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run check:published-site -- --strict") &&
      releaseManifest.releaseCommands.indexOf("npm run check:published-site -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run signing-assets:store") &&
      releaseManifest.releaseCommands.indexOf("npm run signing-assets:store") <
        releaseManifest.releaseCommands.indexOf("npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run") &&
      releaseManifest.releaseCommands.indexOf("npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run") <
        releaseManifest.releaseCommands.indexOf("npm run check:mas-signing -- --strict"),
    "Release manifest command order validates MAS profile before strict signing"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run signing-runbook:store") <
        releaseManifest.releaseCommands.indexOf("npm run resolution-plan:store"),
    "Release manifest command order builds release resolution plan after signing/upload runbook"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run resolution-plan:store") <
        releaseManifest.releaseCommands.indexOf("npm run submission-checklist:store"),
    "Release manifest command order builds final submission checklist after release resolution plan"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run submission-checklist:store") <
        releaseManifest.releaseCommands.indexOf("npm run dashboard:store"),
    "Release manifest command order builds dashboard after final submission checklist"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run evidence:store") <
        releaseManifest.releaseCommands.indexOf("npm run dashboard:store"),
    "Release manifest command order builds dashboard after evidence"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run submission-checklist:store") <
        releaseManifest.releaseCommands.indexOf("npm run evidence:store"),
    "Release manifest command order records final submission checklist before evidence"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.lastIndexOf("npm run signing-assets:store") <
        releaseManifest.releaseCommands.indexOf("npm run signing-runbook:store") &&
      releaseManifest.releaseCommands.indexOf("npm run signing-runbook:store") <
        releaseManifest.releaseCommands.indexOf("npm run evidence:store"),
    "Release manifest command order records signing asset report and runbook before evidence"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run public-inputs:store") <
        releaseManifest.releaseCommands.indexOf("npm run evidence:store"),
    "Release manifest command order records public release inputs before evidence"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run evidence:store") <
        releaseManifest.releaseCommands.indexOf("npm run check:evidence") &&
      releaseManifest.releaseCommands.indexOf("npm run check:evidence") <
        releaseManifest.releaseCommands.indexOf("npm run manifest:store"),
    "Release manifest command order checks evidence before manifest"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run dashboard:store") <
        releaseManifest.releaseCommands.indexOf("npm run operator:store"),
    "Release manifest command order builds operator queue after dashboard"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run operator:store") <
        releaseManifest.releaseCommands.indexOf("npm run manifest:store"),
    "Release manifest command order records operator queue before manifest"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run manifest:store") <
        releaseManifest.releaseCommands.indexOf("npm run check:manifest") &&
      releaseManifest.releaseCommands.indexOf("npm run check:manifest") <
        releaseManifest.releaseCommands.indexOf("npm run handoff:store"),
    "Release manifest command order checks manifest before handoff"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run handoff:store") <
        releaseManifest.releaseCommands.indexOf("npm run verify:store:strict"),
    "Release manifest command order verifies strict readiness after handoff"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run screenshots:store") <
        releaseManifest.releaseCommands.indexOf("npm run export-compliance:store"),
    "Release manifest command order refreshes screenshots before export compliance and packet generation"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:mas-package -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run check:upload-tooling -- --strict"),
    "Release manifest command order checks upload tooling after strict MAS package verification"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:upload-tooling -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") &&
      releaseManifest.releaseCommands.indexOf("npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") <
        releaseManifest.releaseCommands.indexOf("npm run check:upload-credentials -- --strict"),
    "Release manifest command order checks upload credentials after ASC key validation"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run export-compliance:store") <
        releaseManifest.releaseCommands.indexOf("npm run packet:store"),
    "Release manifest command order builds export compliance before packet generation"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run packet:store") <
        releaseManifest.releaseCommands.indexOf("npm run review-brief:store"),
    "Release manifest command order builds App Review brief after packet generation"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run review-brief:store") <
        releaseManifest.releaseCommands.indexOf("npm run copy-map:store"),
    "Release manifest command order builds copy map after App Review brief"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run copy-map:store") <
        releaseManifest.releaseCommands.indexOf("npm run check:review-brief -- --strict"),
    "Release manifest command order strictly checks App Review brief after copy map generation"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:review-brief -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run check:copy-map -- --strict"),
    "Release manifest command order strictly checks copy map after App Review brief"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:copy-map -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run check:public-release-sync -- --strict"),
    "Release manifest command order checks public release sync after strict copy map check"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:public-release-sync -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run check:store-version"),
    "Release manifest command order checks store version after strict public release sync"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run review-brief:store") <
        releaseManifest.releaseCommands.indexOf("npm run check:app-privacy"),
    "Release manifest command order checks App privacy after App Review brief generation"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:app-privacy") <
        releaseManifest.releaseCommands.indexOf("npm run check:export-compliance"),
    "Release manifest command order checks export compliance after App privacy"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:export-compliance") <
        releaseManifest.releaseCommands.indexOf("npm run check:store-copy"),
    "Release manifest command order checks store copy after export compliance"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:store-copy") <
        releaseManifest.releaseCommands.indexOf("npm run check:artifact-privacy"),
    "Release manifest command order checks artifact privacy after store copy"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:artifact-privacy") <
        releaseManifest.releaseCommands.indexOf("npm run check:store-urls -- --strict"),
    "Release manifest command order checks public URLs after artifact privacy"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:store-urls -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run check:published-site -- --strict"),
    "Release manifest command order checks full published site after public URL reachability"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run check:site -- --strict") <
        releaseManifest.releaseCommands.indexOf("npm run archive:site"),
    "Release manifest command order builds public site archive after strict site validation"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run archive:site") <
        releaseManifest.releaseCommands.indexOf("npm run check:site-archive -- --strict"),
    "Release manifest command order validates public site archive after building it"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) &&
      releaseManifest.releaseCommands.indexOf("npm run dist:mas") <
        releaseManifest.releaseCommands.indexOf("npm run check:mas-package -- --strict"),
    "Release manifest command order checks MAS package after packaging"
  );
  assert(
    Array.isArray(releaseManifest.releaseCommands) && releaseManifest.releaseCommands.includes("npm run notices:store"),
    "Release manifest records third-party notices command"
  );
  assert(thirdPartyNotices.app?.bundleId === "com.sachittumuluri.codycartridge", "Third-party notices JSON includes bundle id");
  assert(thirdPartyNotices.app?.version === pkg.version, "Third-party notices JSON package version matches package.json");
  assert(thirdPartyNotices.summary?.totalPackages >= 4, "Third-party notices JSON includes dependency inventory");
  assert(thirdPartyNotices.summary?.unknownLicenseCount === 0, "Third-party notices JSON has no unknown licenses");
  assert(thirdPartyNotices.summary?.licenseCounts?.MIT > 0, "Third-party notices JSON includes MIT license count");
  assert(thirdPartyNotices.summary?.licenseCounts?.ISC > 0, "Third-party notices JSON includes ISC license count");
  assert(
    Array.isArray(thirdPartyNotices.directRuntime) &&
      ["lucide-react", "music-metadata", "react", "react-dom"].every((name) =>
        thirdPartyNotices.directRuntime.some((item) => item.name === name)
      ),
    "Third-party notices JSON includes direct runtime dependencies"
  );
  assert(thirdPartyNoticesMarkdown.includes("# Cody Cartridge Third-Party Notices"), "Third-party notices markdown includes title");
  assert(thirdPartyNoticesMarkdown.includes("Direct Runtime Dependencies"), "Third-party notices markdown includes runtime section");
  assert(thirdPartyNoticesMarkdown.includes("react "), "Third-party notices markdown includes React dependency");
  assert(fields.app?.bundleId === "com.sachittumuluri.codycartridge", "App Store fields JSON includes bundle id");
  assert(fields.app?.packageVersion === pkg.version, "App Store fields JSON package version matches package.json");
  assert(fields.app?.buildVersion === pkg.build?.buildVersion, "App Store fields JSON build version matches package config");
  assert(fields.productPage?.name === "Cody Cartridge", "App Store fields JSON includes app name");
  assert(isNonEmptyString(fields.productPage?.subtitle), "App Store fields JSON includes subtitle");
  assert(isNonEmptyString(fields.productPage?.promotionalText), "App Store fields JSON includes promotional text");
  assert(isNonEmptyString(fields.productPage?.description), "App Store fields JSON includes description");
  assert(isNonEmptyString(fields.productPage?.keywords), "App Store fields JSON includes keywords");
  assert(byteLength(fields.productPage?.promotionalText) <= 170, "Promotional text is within 170-character App Store limit");
  assert(byteLength(fields.productPage?.description) <= 4000, "Description is within 4000-character App Store limit");
  assert(byteLength(fields.productPage?.keywords) <= 100, "Keywords are within 100-byte App Store limit");
  assert(byteLength(fields.review?.notes) <= 4000, "Review notes are within 4000-character App Review notes limit");
  assert(byteLength(fields.distribution?.futureWhatsNew) <= 4000, "Future What's New draft is within 4000-character App Store limit");
  assert(isNonEmptyString(fields.review?.contact?.name), "App Store fields JSON includes App Review contact name");
  assert(isNonEmptyString(fields.review?.contact?.email), "App Store fields JSON includes App Review contact email");
  assert(isNonEmptyString(fields.review?.contact?.phone), "App Store fields JSON includes App Review contact phone");
  assert(fields.review?.demoAccount === "None. The app has no account system.", "Review packet declares no demo account needed");
  assert(
    Array.isArray(fields.review?.testInstructions) &&
      fields.review.testInstructions.some((item) => item.includes("stored security-scoped bookmark")),
    "App Store fields JSON review instructions document MAS dropped-path bookmark requirement"
  );
  assert(fields.testFlight?.betaAppDescription?.includes("local-first macOS music player"), "App Store fields JSON includes TestFlight beta app description");
  assert(fields.testFlight?.feedbackEmail === fields.urls?.supportEmail, "TestFlight feedback email matches support email");
  assert(fields.testFlight?.contactInformation?.email === fields.review?.contact?.email, "TestFlight contact email matches App Review contact email");
  assert(fields.testFlight?.demoAccount?.includes("no account system"), "TestFlight packet declares no demo account needed");
  assert(
    Array.isArray(fields.testFlight?.recommendedGroups) && fields.testFlight.recommendedGroups.some((item) => item.includes("Internal: Store Smoke")),
    "App Store fields JSON includes TestFlight internal group guidance"
  );
  assert(
    Array.isArray(fields.testFlight?.whatToTest) && fields.testFlight.whatToTest.some((item) => item.includes("File > Import Audio Files")),
    "App Store fields JSON includes TestFlight What to Test import flow"
  );
  assert(
    Array.isArray(fields.testFlight?.whatToTest) &&
      fields.testFlight.whatToTest.some((item) => item.includes("already selected bookmarked file or folder")),
    "App Store fields JSON includes TestFlight dropped-path bookmark check"
  );
  assert(
    Array.isArray(fields.testFlight?.whatToTest) && fields.testFlight.whatToTest.some((item) => item.includes("Third-Party Notices")),
    "App Store fields JSON includes TestFlight third-party notices check"
  );
  assert(
    Array.isArray(fields.testFlight?.whatToTest) &&
      fields.testFlight.whatToTest.some(
        (item) => item.includes("Privacy Policy") && item.includes("Support") && item.includes("Accessibility")
      ),
    "App Store fields JSON includes TestFlight bundled Help documents check"
  );
  assert(
    Array.isArray(fields.testFlight?.whatToTest) &&
      fields.testFlight.whatToTest.some((item) => item.includes("Reset Local Library")),
    "App Store fields JSON includes TestFlight local reset check"
  );
  assert(
    Array.isArray(fields.testFlight?.macAcceptanceChecklist) &&
      fields.testFlight.macAcceptanceChecklist.some((item) => item.includes("Clean macOS user account")),
    "App Store fields JSON includes clean-account Mac TestFlight checklist"
  );
  assert(
    Array.isArray(fields.testFlight?.macAcceptanceChecklist) &&
      fields.testFlight.macAcceptanceChecklist.some(
        (item) => item.includes("Privacy Policy") && item.includes("Support") && item.includes("Accessibility")
      ),
    "App Store fields JSON includes packaged Help documents acceptance check"
  );
  assert(
    Array.isArray(fields.testFlight?.macAcceptanceChecklist) &&
      fields.testFlight.macAcceptanceChecklist.some((item) => item.includes("Reset Local Library")),
    "App Store fields JSON includes local reset acceptance check"
  );
  assert(
    Array.isArray(fields.testFlight?.buildHandling) && fields.testFlight.buildHandling.some((item) => item.includes("90-day")),
    "App Store fields JSON includes TestFlight build-window guidance"
  );
  assert(
    Array.isArray(fields.testFlight?.feedbackHandling) && fields.testFlight.feedbackHandling.some((item) => item.includes("TestFlight Feedback")),
    "App Store fields JSON includes TestFlight feedback handling guidance"
  );
  assert(fields.privacy?.tracking === "No tracking.", "App Store fields JSON includes tracking answer");
  assert(Array.isArray(fields.screenshots) && fields.screenshots.length >= 3, "App Store fields JSON includes screenshot inventory");
  assert(fields.screenshotManifest?.filePath === "app-store-assets/screenshots/STORE_SCREENSHOTS.json", "App Store fields JSON includes screenshot manifest inventory");
  assert(fields.screenshotManifest?.appStoreConnectSpec?.platform === "macOS", "App Store fields JSON includes Mac screenshot spec platform");
  assert(fields.screenshotManifest?.appStoreConnectSpec?.count?.min === 1 && fields.screenshotManifest?.appStoreConnectSpec?.count?.max === 10, "App Store fields JSON includes screenshot count range");
  assert(
    fields.screenshots.every((screenshot) => screenshot.format === "png" && screenshot.appStoreConnectAccepted === true),
    "App Store fields JSON marks every screenshot as accepted Mac PNG"
  );
  assert(fields.productPage?.description?.includes("does not download music"), "App Store fields JSON includes full description");
  assert(fields.review?.notes?.includes("Sandbox file access"), "App Store fields JSON includes sandbox review note");
  assert(copyMap.app?.bundleId === fields.app?.bundleId, "App Store copy map bundle id matches generated fields");
  assert(copyMap.app?.packageVersion === fields.app?.packageVersion, "App Store copy map package version matches generated fields");
  assert(Array.isArray(copyMap.fields) && copyMap.fields.length >= 20, "App Store copy map includes broad field coverage");
  assert(copyMap.summary?.fieldCount === copyMap.fields?.length, "App Store copy map summary matches field count");
  assert(
    copyMap.fields?.every((item) => ["missing", "placeholder", "ready"].includes(item.valueState)),
    "App Store copy map records value readiness states"
  );
  assert(
    ["Product Page", "App Review", "TestFlight", "App Privacy", "App Accessibility", "Pricing And Availability", "Business / Compliance"].every((screen) =>
      copyMap.fields?.some((item) => item.screen === screen)
    ),
    "App Store copy map covers major App Store Connect screens"
  );
  assert(
    copyMap.fields?.some((item) => item.screen === "Product Page" && item.field === "Description" && item.limit?.max === 4000) &&
      copyMap.fields?.some((item) => item.screen === "Product Page" && item.field === "Keywords" && item.limit?.unit === "bytes"),
    "App Store copy map records product-page field limits"
  );
  assert(copyMap.workflow?.summary?.stepCount === 7, "App Store copy map records submission workflow steps");
  assert(
    ["product-page", "privacy-accessibility", "pricing-info-compliance", "testflight", "build-upload", "app-review", "submit-review"].every((id) =>
      copyMap.workflow?.steps?.some((item) => item.id === id)
    ),
    "App Store copy map covers the full App Store Connect submission workflow"
  );
  assert(
    copyMap.workflow?.steps?.some((item) => item.id === "build-upload" && item.externalChecks?.some((check) => check.id === "mas-upload-package")) &&
      copyMap.workflow?.steps?.some((item) => item.id === "submit-review" && item.externalChecks?.some((check) => check.id === "release-blockers")),
    "App Store copy map workflow includes build upload and submit gates"
  );
  assert(copyMapMarkdown.includes("## Submission Workflow"), "App Store copy map markdown includes submission workflow");
  assert(copyMapMarkdown.includes("Build Upload"), "App Store copy map markdown includes build upload workflow");
  assert(copyMapMarkdown.includes("Submit For Review"), "App Store copy map markdown includes submit workflow");
  assert(copyMapMarkdown.includes("## Copy Blocks"), "App Store copy map markdown includes copy blocks");
  assert(copyMapMarkdown.includes("Product Page / Description"), "App Store copy map markdown includes product page description block");
  assert(copyMapMarkdown.includes("App Review / Review Notes"), "App Store copy map markdown includes App Review notes block");
  assert(
    !JSON.stringify(copyMap).includes("TODO_PUBLIC_SITE_URL") &&
      !JSON.stringify(copyMap).includes("TODO_SUPPORT_EMAIL") &&
      !JSON.stringify(copyMap).includes("TODO_REVIEW_CONTACT_NAME") &&
      !JSON.stringify(copyMap).includes("TODO_REVIEW_CONTACT_PHONE") &&
      !copyMapMarkdown.includes("TODO_PUBLIC_SITE_URL") &&
      !copyMapMarkdown.includes("TODO_SUPPORT_EMAIL") &&
      !copyMapMarkdown.includes("TODO_REVIEW_CONTACT_NAME") &&
      !copyMapMarkdown.includes("TODO_REVIEW_CONTACT_PHONE"),
    "App Store copy map excludes raw public/contact placeholder tokens"
  );
  assert(reviewBrief.app?.bundleId === fields.app?.bundleId, "App Review brief bundle id matches generated fields");
  assert(reviewBrief.app?.packageVersion === fields.app?.packageVersion, "App Review brief package version matches generated fields");
  assert(reviewBrief.appReview?.notes === fields.review?.notes, "App Review brief notes match generated fields");
  assert(reviewBrief.appReview?.demoAccount === fields.review?.demoAccount, "App Review brief demo account matches generated fields");
  assert(reviewBrief.appReview?.notesBytes <= 4000, "App Review brief notes fit App Review limit");
  assert(
    ["name", "email", "phone"].every((field) => ["missing", "placeholder", "invalid", "ready"].includes(reviewBrief.appReview?.contactState?.[field])),
    "App Review brief records App Review contact readiness states"
  );
  assert(
    ["supportUrl", "privacyPolicyUrl", "accessibilityUrl", "thirdPartyNoticesUrl"].every((field) =>
      ["missing", "placeholder", "invalid", "ready"].includes(reviewBrief.publicLinkState?.[field])
    ),
    "App Review brief records public link readiness states"
  );
  assert(Array.isArray(reviewBrief.appReview?.testInstructions) && reviewBrief.appReview.testInstructions.length >= 5, "App Review brief includes test instructions");
  assert(
    reviewBrief.appReview?.testInstructions?.some((item) => item.includes("security-scoped bookmark")),
    "App Review brief includes sandbox bookmark instructions"
  );
  assert(
    reviewBrief.appReview?.testInstructions?.some((item) => item.includes("Third-Party Notices")),
    "App Review brief includes Help and third-party notices instructions"
  );
  assert(/does not download|no music download/i.test(JSON.stringify(reviewBrief)), "App Review brief includes no-download/no-scraping disclosure");
  assert(reviewBrief.summary?.validationCount === reviewBrief.validations?.length, "App Review brief validation summary matches validations array");
  assert(reviewBriefMarkdown.includes("## App Review Notes Copy Block"), "App Review brief markdown includes review notes copy block");
  assert(reviewBriefMarkdown.includes("## Reviewer Checklist"), "App Review brief markdown includes reviewer checklist");
  assert(reviewBriefMarkdown.includes("## Validation"), "App Review brief markdown includes validation table");
  assert(
    !JSON.stringify(reviewBrief).includes("TODO_PUBLIC_SITE_URL") &&
      !JSON.stringify(reviewBrief).includes("TODO_SUPPORT_EMAIL") &&
      !JSON.stringify(reviewBrief).includes("TODO_REVIEW_CONTACT_NAME") &&
      !JSON.stringify(reviewBrief).includes("TODO_REVIEW_CONTACT_PHONE") &&
      !reviewBriefMarkdown.includes("TODO_PUBLIC_SITE_URL") &&
      !reviewBriefMarkdown.includes("TODO_SUPPORT_EMAIL") &&
      !reviewBriefMarkdown.includes("TODO_REVIEW_CONTACT_NAME") &&
      !reviewBriefMarkdown.includes("TODO_REVIEW_CONTACT_PHONE"),
    "App Review brief excludes raw public/contact placeholder tokens"
  );
  assert(publicReleaseInputs.app?.bundleId === pkg.build?.appId, "Public release inputs bundle id matches package config");
  assert(publicReleaseInputs.app?.version === pkg.version, "Public release inputs version matches package config");
  assert(publicReleaseInputs.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Public release inputs build version matches package config");
  assert(publicReleaseInputs.summary?.requiredCount === publicReleaseInputs.fields?.length, "Public release inputs required count matches fields");
  assert(
    publicReleaseInputs.summary?.blockerCount === publicReleaseInputs.fields?.filter((field) => field.status !== "ready").length,
    "Public release inputs blocker count matches fields"
  );
  assert(
    ["CODY_SITE_URL", "CODY_SUPPORT_EMAIL", "CODY_REVIEW_CONTACT_NAME", "CODY_REVIEW_CONTACT_EMAIL", "CODY_REVIEW_CONTACT_PHONE"].every((key) =>
      publicReleaseInputs.fields?.some((field) => field.key === key && field.redactedValue && !String(field.redactedValue).includes("@"))
    ),
    "Public release inputs records every required CODY field without raw email values"
  );
  assert(
    publicReleaseInputs.releaseEnv?.privateFilesExcludedFromHandoff?.includes("app-store-assets/site.env"),
    "Public release inputs records private env file exclusion"
  );
  assert(
    publicReleaseInputs.releaseEnv?.precedence?.join(" > ") === "shell env > app-store-assets/site.env.local > app-store-assets/site.env",
    "Public release inputs records release env precedence"
  );
  assert(publicReleaseInputs.commands?.includes("npm run check:store-env"), "Public release inputs includes store env check command");
  assert(
    publicReleaseInputs.commands?.some((command) => command.startsWith("npm run configure:store-env -- --dry-run")),
    "Public release inputs includes store env configurator command"
  );
  assert(
    publicReleaseInputs.commands?.includes("npm run public-release:store -- --dry-run"),
    "Public release inputs includes public release refresh dry-run command"
  );
  assert(
    publicReleaseInputs.commands?.includes("npm run public-release:store -- --self-test"),
    "Public release inputs includes public release refresh self-test command"
  );
  assert(
    publicReleaseInputs.commands?.includes("npm run publish-packet:store"),
    "Public release inputs includes public site publish packet command"
  );
  assert(
    publicReleaseInputs.commands?.includes("npm run public-host:store"),
    "Public release inputs includes public host runbook command"
  );
  assert(
    publicReleaseInputs.commands?.includes("npm run check:published-site -- --strict"),
    "Public release inputs includes strict published-site command"
  );
  assert(
    publicReleaseInputs.commands?.includes("npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store"),
    "Public release inputs includes blocker-refresh, publish-packet, and public-host command"
  );
  assert(
    publicReleaseInputs.sourceArtifacts?.includes("scripts/refresh-public-release.cjs"),
    "Public release inputs records public release refresh source artifact"
  );
  assert(
    publicReleaseInputs.sourceArtifacts?.includes("scripts/build-public-host-runbook.cjs"),
    "Public release inputs records public host runbook source artifact"
  );
  assert(!JSON.stringify(publicReleaseInputs).includes("you@example.com"), "Public release inputs JSON excludes placeholder email values");
  assert(!JSON.stringify(publicReleaseInputs).includes("+1-555-555-5555"), "Public release inputs JSON excludes placeholder phone values");
  assert(publicReleaseInputsMarkdown.includes("# Cody Cartridge Public Release Inputs"), "Public release inputs markdown includes title");
  assert(publicReleaseInputsMarkdown.includes("Required Values"), "Public release inputs markdown includes required values table");
  assert(publicReleaseInputsMarkdown.includes("app-store-assets/site.env"), "Public release inputs markdown names ignored env file");
  assert(publicReleaseInputsMarkdown.includes("configure:store-env"), "Public release inputs markdown documents store env configurator");
  assert(publicReleaseInputsMarkdown.includes("public-release:store"), "Public release inputs markdown documents public release refresh helper");
  assert(publicSitePublishPacket.app?.bundleId === pkg.build?.appId, "Public site publish packet bundle id matches package config");
  assert(publicSitePublishPacket.summary?.requiredPageCount === 5, "Public site publish packet records all required pages");
  assert(publicSitePublishPacket.summary?.requiredCompanionFileCount === 2, "Public site publish packet records required companion files");
  assert(publicSitePublishPacket.summary?.requiredHostingConfigFileCount === 2, "Public site publish packet records required static host config files");
  assert(
    publicSitePublishPacket.summary?.readyPageCount + publicSitePublishPacket.summary?.blockedPageCount ===
      publicSitePublishPacket.summary?.requiredPageCount,
    "Public site publish packet page readiness counts are consistent"
  );
  assert(
    publicSitePublishPacket.summary?.readyCompanionFileCount + publicSitePublishPacket.summary?.blockedCompanionFileCount ===
      publicSitePublishPacket.summary?.requiredCompanionFileCount,
    "Public site publish packet companion-file readiness counts are consistent"
  );
  assert(
    publicSitePublishPacket.summary?.readyHostingConfigFileCount + publicSitePublishPacket.summary?.blockedHostingConfigFileCount ===
      publicSitePublishPacket.summary?.requiredHostingConfigFileCount,
    "Public site publish packet static-host config readiness counts are consistent"
  );
  assert(
    ["index.html", "support.html", "privacy.html", "accessibility.html", "third-party-notices.html"].every((fileName) =>
      publicSitePublishPacket.pages?.some((page) => page.fileName === fileName && page.sourcePath === `app-store-assets/site/${fileName}`)
    ),
    "Public site publish packet records every generated public page"
  );
  assert(
    ["robots.txt", "sitemap.xml"].every((fileName) =>
      publicSitePublishPacket.companionFiles?.some((file) => file.fileName === fileName && file.sourcePath === `app-store-assets/site/${fileName}`)
    ),
    "Public site publish packet records every generated companion file"
  );
  assert(
    ["_headers", "vercel.json"].every((fileName) =>
      publicSitePublishPacket.hostingConfigFiles?.some((file) => file.fileName === fileName && file.sourcePath === `app-store-assets/site/${fileName}`)
    ),
    "Public site publish packet records every static host config file"
  );
  const publishPacketHostedFiles = [
    ...(publicSitePublishPacket.pages ?? []),
    ...(publicSitePublishPacket.companionFiles ?? []),
    ...(publicSitePublishPacket.hostingConfigFiles ?? [])
  ];
  assert(
    publishPacketHostedFiles.every((item) => item.publishPath === `/${item.fileName}`),
    "Public site publish packet records rooted publish paths for every hosted file"
  );
  assert(
    (publicSitePublishPacket.pages ?? []).every((page) => page.expectedContentType === "text/html; charset=utf-8"),
    "Public site publish packet records HTML content type for public pages"
  );
  assert(
    publicSitePublishPacket.companionFiles?.some((file) => file.fileName === "robots.txt" && file.expectedContentType === "text/plain; charset=utf-8") &&
      publicSitePublishPacket.companionFiles?.some((file) => file.fileName === "sitemap.xml" && file.expectedContentType === "application/xml; charset=utf-8"),
    "Public site publish packet records companion file content types"
  );
  assert(
    publicSitePublishPacket.hostingConfigFiles?.some((file) => file.fileName === "_headers" && file.expectedContentType === "text/plain; charset=utf-8") &&
      publicSitePublishPacket.hostingConfigFiles?.some((file) => file.fileName === "vercel.json" && file.expectedContentType === "application/json; charset=utf-8"),
    "Public site publish packet records static host config content types"
  );
  assert(
    publicSitePublishPacket.hosting?.httpsRequired === true &&
      publicSitePublishPacket.hosting?.requiredFileCount === publishPacketHostedFiles.length &&
      publicSitePublishPacket.hosting?.uploadSources?.includes("app-store-assets/public-site/cody-cartridge-public-site.zip") &&
      publicSitePublishPacket.hosting?.uploadSources?.includes("app-store-assets/site/"),
    "Public site publish packet records host upload requirements"
  );
  assert(
    publishPacketHostedFiles.every((item) =>
      publicSitePublishPacket.hosting?.requiredFiles?.some(
        (file) =>
          file.fileName === item.fileName &&
          file.publishPath === item.publishPath &&
          file.expectedContentType === item.expectedContentType &&
          file.cacheControl === item.cacheControl
      )
    ),
    "Public site publish packet hosting files mirror page and companion records"
  );
  assert(
    publicSitePublishPacket.archive?.path === "app-store-assets/public-site/cody-cartridge-public-site.zip" &&
      publicSitePublishPacket.archive?.manifestPath === "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "Public site publish packet records archive paths"
  );
  assert(
    publicSitePublishPacket.blockerQueueAction?.categoryId === releaseBlockers.nextActionQueue?.[0]?.categoryId ||
      (!publicSitePublishPacket.blockerQueueAction && (releaseBlockers.nextActionQueue ?? []).length === 0),
    "Public site publish packet first blocker queue action matches blocker report"
  );
  assert(
      publicSitePublishPacket.commands?.includes("npm run check:store-urls -- --strict") &&
      publicSitePublishPacket.commands?.includes("npm run public-release:store -- --self-test") &&
      publicSitePublishPacket.commands?.includes("npm run check:published-site -- --strict") &&
      publicSitePublishPacket.commands?.includes("npm run public-host:store") &&
      publicSitePublishPacket.commands?.includes("npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store"),
    "Public site publish packet records publish verification commands"
  );
  assert(
    publicSitePublishPacket.sourceArtifacts?.includes("app-store-assets/PUBLIC_RELEASE_INPUTS.json") &&
      publicSitePublishPacket.sourceArtifacts?.includes("app-store-assets/RELEASE_BLOCKERS.json") &&
      publicSitePublishPacket.sourceArtifacts?.includes("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json") &&
      publicSitePublishPacket.sourceArtifacts?.includes("scripts/check-public-site-published.cjs") &&
      publicSitePublishPacket.sourceArtifacts?.includes("scripts/build-public-host-runbook.cjs") &&
      publicSitePublishPacket.sourceArtifacts?.includes("scripts/check-public-host-runbook.cjs"),
    "Public site publish packet records source artifacts"
  );
  assert(publicSitePublishPacket.redaction?.privateEnvFileIncluded === false, "Public site publish packet excludes private env file");
  assert(!JSON.stringify(publicSitePublishPacket).includes("you@example.com"), "Public site publish packet excludes placeholder email values");
  assert(!JSON.stringify(publicSitePublishPacket).includes("+1-555-555-5555"), "Public site publish packet excludes placeholder phone values");
  assert(publicSitePublishPacketMarkdown.includes("# Cody Cartridge Public Site Publish Packet"), "Public site publish packet markdown includes title");
  assert(publicSitePublishPacketMarkdown.includes("Pages To Publish"), "Public site publish packet markdown includes page table");
  assert(publicSitePublishPacketMarkdown.includes("Hosting Requirements"), "Public site publish packet markdown includes hosting requirements");
  assert(publicSitePublishPacketMarkdown.includes("Expected content type"), "Public site publish packet markdown includes content-type guidance");
  assert(publicSitePublishPacketMarkdown.includes("Current Blocker Queue"), "Public site publish packet markdown includes blocker queue section");
  assert(publicHostRunbook.app?.bundleId === pkg.build?.appId, "Public host runbook bundle id matches package config");
  assert(publicHostRunbook.site?.sourceDirectory === "app-store-assets/site/", "Public host runbook records generated site directory");
  assert(publicHostRunbook.site?.archivePath === "app-store-assets/public-site/cody-cartridge-public-site.zip", "Public host runbook records public-site archive");
  assert(
    publicHostRunbook.summary?.hostedFileCount === publishPacketHostedFiles.length &&
      publicHostRunbook.hostedFiles?.length === publishPacketHostedFiles.length,
    "Public host runbook mirrors publish-packet hosted files"
  );
  assert(
    ["CODY_SITE_URL", "CODY_SUPPORT_EMAIL", "CODY_REVIEW_CONTACT_NAME", "CODY_REVIEW_CONTACT_EMAIL", "CODY_REVIEW_CONTACT_PHONE"].every((key) =>
      publicHostRunbook.requiredValues?.some((item) => item.key === key)
    ),
    "Public host runbook records every public release value"
  );
  assert(
    ["vercel", "netlify", "cloudflare-pages", "generic-static-host"].every((id) =>
      publicHostRunbook.providerRecipes?.some((item) => item.id === id)
    ),
    "Public host runbook includes static hosting provider recipes"
  );
  assert(
    publicHostRunbook.commands?.includes("npm run public-release:store -- --self-test") &&
      publicHostRunbook.commands?.includes("npm run site:store && npm run site:archive") &&
      publicHostRunbook.commands?.includes("npm run check:store-urls -- --strict") &&
      publicHostRunbook.commands?.includes("npm run check:published-site -- --strict"),
    "Public host runbook records host publish verification commands"
  );
  assert(
    publicHostRunbook.sourceArtifacts?.includes("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json") &&
      publicHostRunbook.sourceArtifacts?.includes("scripts/build-public-host-runbook.cjs") &&
      publicHostRunbook.sourceArtifacts?.includes("scripts/check-public-host-runbook.cjs"),
    "Public host runbook records source artifacts"
  );
  assert(publicHostRunbook.redaction?.storesRawPrivateContactValues === false, "Public host runbook excludes raw private contact values");
  assert(publicHostRunbook.redaction?.storesSigningSecrets === false, "Public host runbook excludes signing secrets");
  assert(publicHostRunbook.redaction?.storesLocalMediaPaths === false, "Public host runbook excludes local media paths");
  assert(!JSON.stringify(publicHostRunbook).includes("you@example.com"), "Public host runbook excludes placeholder email values");
  assert(!JSON.stringify(publicHostRunbook).includes("+1-555-555-5555"), "Public host runbook excludes placeholder phone values");
  assert(publicHostRunbookMarkdown.includes("# Cody Cartridge Public Host Runbook"), "Public host runbook markdown includes title");
  assert(publicHostRunbookMarkdown.includes("Provider Recipes"), "Public host runbook markdown includes provider recipes");
  assert(publicHostRunbookMarkdown.includes("Post-Publish Proof"), "Public host runbook markdown includes post-publish proof");
  const releaseResolutionPlanCommands = (releaseResolutionPlan.phases ?? []).flatMap((phase) => phase.commands ?? []);
  const releaseResolutionPlanCommandText = releaseResolutionPlanCommands.join("\n");
  const releaseResolutionPlanFreezeCommandText =
    releaseResolutionPlan.phases?.find((phase) => phase.id === "freeze-evidence-and-handoff")?.commands?.join("\n") ?? "";
  assert(releaseResolutionPlan.app?.bundleId === pkg.build?.appId, "Release resolution plan bundle id matches package config");
  assert(releaseResolutionPlan.app?.version === pkg.version, "Release resolution plan version matches package config");
  assert(releaseResolutionPlan.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Release resolution plan build version matches package config");
  assert(releaseResolutionPlan.blockerSnapshot?.blockerCount === releaseBlockers.summary?.blockerCount, "Release resolution plan blocker count matches blocker report");
  assert(
    releaseResolutionPlan.blockerSnapshot?.readyForStrictPreflight === Boolean(releaseBlockers.summary?.readyForStrictPreflight),
    "Release resolution plan strict-readiness flag matches blocker report"
  );
  assert(
    ["prepare-public-inputs", "publish-public-site", "sign-and-package", "upload-and-select-build", "freeze-evidence-and-handoff"].every((id) =>
      releaseResolutionPlan.phases?.some((phase) => phase.id === id)
    ),
    "Release resolution plan includes all release-machine phases"
  );
  assert(releaseResolutionPlanCommandText.includes("npm run check:store-env"), "Release resolution plan includes store env gate");
  assert(
    releaseResolutionPlanCommandText.includes("npm run check:release-runtime:node -- --strict"),
    "Release resolution plan includes Node-safe strict release runtime command"
  );
  assert(releaseResolutionPlanCommandText.includes("npm run public-release:store -- --self-test"), "Release resolution plan includes public release refresh self-test command");
  assert(releaseResolutionPlanCommandText.includes("npm run public-release:store -- --published"), "Release resolution plan includes public release refresh command");
  assert(releaseResolutionPlanCommandText.includes("npm run public-inputs:store"), "Release resolution plan includes public release-input packet");
  assert(releaseResolutionPlanCommandText.includes("npm run publish-packet:store"), "Release resolution plan includes public site publish packet");
  assert(releaseResolutionPlanCommandText.includes("npm run public-host:store"), "Release resolution plan includes public host runbook");
  assert(releaseResolutionPlanCommandText.includes("npm run check:public-release-sync -- --strict"), "Release resolution plan includes strict public release sync gate");
  assert(releaseResolutionPlanCommandText.includes("npm run check:store-urls -- --strict"), "Release resolution plan includes strict public URL gate");
  assert(releaseResolutionPlanCommandText.includes("npm run check:published-site -- --strict"), "Release resolution plan includes strict published-site gate");
  assert(
    releaseResolutionPlanCommandText.includes("npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run"),
    "Release resolution plan includes MAS profile validation command"
  );
  assert(releaseResolutionPlanCommandText.includes("npm run check:mas-signing -- --strict"), "Release resolution plan includes strict MAS signing gate");
  assert(releaseResolutionPlanCommandText.includes("npm run dist:mas"), "Release resolution plan includes MAS package command");
  assert(releaseResolutionPlanCommandText.includes("npm run check:mas-package -- --strict"), "Release resolution plan includes strict MAS package gate");
  assert(releaseResolutionPlanCommandText.includes("npm run check:release-machine -- --strict"), "Release resolution plan includes strict release machine doctor gate");
  assert(releaseResolutionPlanCommandText.includes("npm run resolution-plan:store"), "Release resolution plan includes self-regeneration command");
  assert(releaseResolutionPlanCommandText.includes("npm run dashboard:store"), "Release resolution plan includes release dashboard command");
  assert(releaseResolutionPlanCommandText.includes("npm run operator:store"), "Release resolution plan includes release operator queue command");
  assert(releaseResolutionPlanCommandText.includes("npm run verify:store:strict"), "Release resolution plan includes final strict verifier");
  assert(
    Array.isArray(releaseResolutionPlan.nodeWrappedShortcuts) &&
      releaseResolutionPlan.nodeWrappedShortcuts.some((item) => item.command === "npm run release:store:local:node") &&
      releaseResolutionPlan.nodeWrappedShortcuts.some((item) => item.command === "npm run release:store:preflight:node") &&
      releaseResolutionPlan.nodeWrappedShortcuts.some((item) => item.command === "npm run check:release-machine:node -- --strict") &&
      releaseResolutionPlan.nodeWrappedShortcuts.some((item) => item.command === "npm run verify:store:strict:node"),
    "Release resolution plan includes Node-safe release shortcuts"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run check:release-machine -- --strict", "npm run verify:store:strict"),
    "Release resolution plan checks aggregate release-machine readiness before strict verifier"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run public-inputs:store", "npm run publish-packet:store"),
    "Release resolution plan builds publish packet after public-input packet"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run publish-packet:store", "npm run public-host:store"),
    "Release resolution plan builds public host runbook after publish packet"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run public-host:store", "npm run check:store-env"),
    "Release resolution plan builds public host runbook before env check"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run check:store-env", "npm run site:store"),
    "Release resolution plan checks env before generating site"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run check:copy-map -- --strict", "npm run check:public-release-sync -- --strict"),
    "Release resolution plan checks public release sync after strict copy map check"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run check:public-release-sync -- --strict", "npm run check:store-urls -- --strict"),
    "Release resolution plan checks public release sync before public URL reachability"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run check:store-urls -- --strict", "npm run check:mas-signing -- --strict"),
    "Release resolution plan checks public URLs before signing"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run check:store-urls -- --strict", "npm run check:published-site -- --strict") &&
      includesInOrder(releaseResolutionPlanCommandText, "npm run check:published-site -- --strict", "npm run check:mas-signing -- --strict"),
    "Release resolution plan checks full published site before signing"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run signing-assets:store", "npm run check:mas-signing -- --strict"),
    "Release resolution plan builds signing asset report before strict signing"
  );
  assert(
    includesInOrder(
      releaseResolutionPlanCommandText,
      "npm run signing-assets:store",
      "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run"
    ) &&
      includesInOrder(
        releaseResolutionPlanCommandText,
        "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run",
        "npm run check:mas-signing -- --strict"
      ),
    "Release resolution plan validates MAS profile before strict signing"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run check:mas-signing -- --strict", "npm run dist:mas"),
    "Release resolution plan checks signing before MAS packaging"
  );
  assert(
    includesInOrder(releaseResolutionPlanFreezeCommandText, "npm run report:store-blockers", "npm run public-inputs:store"),
    "Release resolution plan refreshes public-input packet after blocker report"
  );
  assert(
    includesInOrder(releaseResolutionPlanFreezeCommandText, "npm run public-inputs:store", "npm run publish-packet:store") &&
      includesInOrder(releaseResolutionPlanFreezeCommandText, "npm run publish-packet:store", "npm run public-host:store") &&
      includesInOrder(releaseResolutionPlanFreezeCommandText, "npm run public-host:store", "npm run signing-assets:store") &&
      includesInOrder(releaseResolutionPlanFreezeCommandText, "npm run signing-assets:store", "npm run upload-packet:store") &&
      includesInOrder(releaseResolutionPlanFreezeCommandText, "npm run upload-packet:store", "npm run copy-map:store") &&
      includesInOrder(releaseResolutionPlanFreezeCommandText, "npm run copy-map:store", "npm run apple-assets:store") &&
      includesInOrder(releaseResolutionPlanFreezeCommandText, "npm run apple-assets:store", "npm run signing-runbook:store"),
    "Release resolution plan refreshes final copy map and Apple asset packet before signing/upload runbook"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run signing-runbook:store", "npm run resolution-plan:store"),
    "Release resolution plan refreshes itself after signing/upload runbook"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run submission-checklist:store", "npm run machine-report:store") &&
      includesInOrder(releaseResolutionPlanCommandText, "npm run machine-report:store", "npm run evidence:store"),
    "Release resolution plan records machine report before evidence"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run submission-checklist:store", "npm run evidence:store"),
    "Release resolution plan builds evidence after final submission checklist"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run evidence:store", "npm run check:evidence") &&
      includesInOrder(releaseResolutionPlanCommandText, "npm run check:evidence", "npm run dashboard:store"),
    "Release resolution plan checks evidence before dashboard"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run dashboard:store", "npm run operator:store"),
    "Release resolution plan builds operator queue after dashboard"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run operator:store", "npm run manifest:store"),
    "Release resolution plan builds manifest after operator queue"
  );
  assert(
    includesInOrder(releaseResolutionPlanCommandText, "npm run manifest:store", "npm run check:manifest") &&
      includesInOrder(releaseResolutionPlanCommandText, "npm run check:manifest", "npm run handoff:store"),
    "Release resolution plan checks manifest before handoff"
  );
  assert(releaseResolutionPlanMarkdown.includes("## Phases"), "Release resolution plan markdown includes phases section");
  assert(releaseResolutionPlanMarkdown.includes("## Current Blockers By Category"), "Release resolution plan markdown includes current blockers section");
  assert(releaseResolutionPlanMarkdown.includes("## Node-Safe Shortcuts"), "Release resolution plan markdown includes Node-safe shortcuts section");
  assert(releaseResolutionPlanMarkdown.includes("npm run release:store:preflight:node"), "Release resolution plan markdown includes Node-safe strict preflight shortcut");
  assert(releaseResolutionPlanMarkdown.includes("## Final Proof"), "Release resolution plan markdown includes final proof section");
  const finalSubmissionChecklistItems = (finalSubmissionChecklist.sections ?? []).flatMap((section) => section.items ?? []);
  const finalSubmissionChecklistBlockers = finalSubmissionChecklistItems.filter((item) => item.status === "blocked").length;
  assert(finalSubmissionChecklist.app?.bundleId === fields.app?.bundleId, "Final submission checklist bundle id matches generated fields");
  assert(finalSubmissionChecklist.app?.version === fields.app?.packageVersion, "Final submission checklist version matches generated fields");
  assert(finalSubmissionChecklist.app?.buildVersion === fields.app?.buildVersion, "Final submission checklist build version matches generated fields");
  assert(finalSubmissionChecklist.summary?.sectionCount === finalSubmissionChecklist.sections?.length, "Final submission checklist section count is accurate");
  assert(finalSubmissionChecklist.summary?.itemCount === finalSubmissionChecklistItems.length, "Final submission checklist item count is accurate");
  assert(finalSubmissionChecklist.summary?.blockerCount === finalSubmissionChecklistBlockers, "Final submission checklist blocker count is accurate");
  assert(
    finalSubmissionChecklist.summary?.readyForAddForReview === (finalSubmissionChecklistBlockers === 0),
    "Final submission checklist Add for Review readiness matches blockers"
  );
  assert(
    ["preflight", "product-page", "screenshots", "privacy-and-compliance", "testflight", "build-upload", "app-review", "submit-for-review"].every((id) =>
      finalSubmissionChecklist.sections?.some((section) => section.id === id)
    ),
    "Final submission checklist includes all App Store Connect sections"
  );
  assert(
    [
      "public-inputs-ready",
      "public-host-runbook",
      "public-release-sync",
      "support-url-ready",
	      "privacy-url-ready",
	      "signing-asset-report-current",
      "apple-release-assets",
      "mas-signing-assets",
      "mas-package-verified",
      "upload-tooling",
      "upload-credentials",
      "review-contact",
      "review-brief-clear",
      "copy-map-clear",
      "blocker-report-clean"
    ].every((id) => finalSubmissionChecklistItems.some((item) => item.id === id)),
    "Final submission checklist includes public inputs, URL, MAS signing/package, upload, contact, copy, review, and blocker gates"
  );
  assert(
    finalSubmissionChecklistItems.some((item) => item.id === "mas-signing-assets" && /MAS signing|strict check|check:mas-signing/.test(`${item.label} ${item.evidence} ${item.action}`)),
    "Final submission checklist ties MAS signing row to strict signing gate"
  );
  assert(
    finalSubmissionChecklistItems.some(
      (item) =>
        item.id === "signing-asset-report-current" &&
        item.evidence.includes(String(signingAssetReport.summary?.blockerCount ?? "missing"))
    ),
    "Final submission checklist ties signing asset row to signing asset report"
  );
  assert(
    finalSubmissionChecklistItems.some(
      (item) =>
        item.id === "apple-release-assets" &&
        item.evidence.includes(String(appleReleaseAssets.summary?.blockerCount ?? "missing")) &&
        item.evidence.includes(String(appleReleaseAssets.summary?.manualCount ?? "missing"))
    ),
    "Final submission checklist ties Apple release asset row to Apple asset request packet"
  );
  assert(
    finalSubmissionChecklistItems.some((item) => item.id === "mas-package-verified" && /MAS package|strict check|check:mas-package/.test(`${item.label} ${item.evidence} ${item.action}`)),
    "Final submission checklist ties MAS package row to strict package gate"
  );
  assert(
    finalSubmissionChecklistItems.some((item) => item.id === "upload-tooling" && /MAS package|strict check|upload-tooling/.test(`${item.label} ${item.evidence} ${item.action}`)),
    "Final submission checklist ties upload tooling row to strict MAS upload package gate"
  );
  assert(
    finalSubmissionChecklistItems.some((item) => item.id === "upload-credentials" && /credentials|check:upload-credentials|strict/.test(`${item.label} ${item.evidence} ${item.action}`)),
    "Final submission checklist ties upload credentials row to strict credential gate"
  );
  assert(
    finalSubmissionChecklistItems.some((item) => item.id === "support-url-ready" && /supportUrl=(?:missing|placeholder|invalid|ready)/.test(String(item.evidence ?? ""))) &&
      finalSubmissionChecklistItems.some((item) => item.id === "privacy-url-ready" && /privacyPolicyUrl=(?:missing|placeholder|invalid|ready)/.test(String(item.evidence ?? ""))),
    "Final submission checklist classifies public URL evidence without raw values"
  );
  assert(
    finalSubmissionChecklistItems.some((item) => item.id === "feedback-email" && /supportEmail=(?:missing|placeholder|invalid|ready)/.test(String(item.evidence ?? ""))),
    "Final submission checklist classifies TestFlight feedback email evidence"
  );
  assert(
    finalSubmissionChecklistItems.some(
      (item) =>
        item.id === "review-contact" &&
        /reviewName=(?:missing|placeholder|invalid|ready)/.test(String(item.evidence ?? "")) &&
        /reviewEmail=(?:missing|placeholder|invalid|ready)/.test(String(item.evidence ?? "")) &&
        /reviewPhone=(?:missing|placeholder|invalid|ready)/.test(String(item.evidence ?? ""))
    ),
    "Final submission checklist classifies App Review contact evidence"
  );
  assert(
    !JSON.stringify(finalSubmissionChecklist).includes("TODO_PUBLIC_SITE_URL") &&
      !JSON.stringify(finalSubmissionChecklist).includes("TODO_SUPPORT_EMAIL") &&
      !JSON.stringify(finalSubmissionChecklist).includes("TODO_REVIEW_CONTACT_NAME") &&
      !JSON.stringify(finalSubmissionChecklist).includes("TODO_REVIEW_CONTACT_PHONE") &&
      !finalSubmissionChecklistMarkdown.includes("TODO_PUBLIC_SITE_URL") &&
      !finalSubmissionChecklistMarkdown.includes("TODO_SUPPORT_EMAIL") &&
      !finalSubmissionChecklistMarkdown.includes("TODO_REVIEW_CONTACT_NAME") &&
      !finalSubmissionChecklistMarkdown.includes("TODO_REVIEW_CONTACT_PHONE"),
    "Final submission checklist excludes raw public/contact placeholder tokens"
  );
  assert(
    finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/APP_STORE_CONNECT_FIELDS.json") &&
      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/APP_STORE_CONNECT_COPY_MAP.json") &&
	      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/EXPORT_COMPLIANCE.json") &&
		      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/PUBLIC_RELEASE_INPUTS.json") &&
			      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json") &&
			      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/PUBLIC_HOST_RUNBOOK.json") &&
			      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/SIGNING_ASSET_REPORT.json") &&
      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/APPLE_RELEASE_ASSETS.json") &&
		      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/UPLOAD_COMMAND_PACKET.json") &&
	      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/RELEASE_BLOCKERS.json") &&
      finalSubmissionChecklist.sourceArtifacts?.includes("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json") &&
      finalSubmissionChecklist.sourceArtifacts?.includes("scripts/install-asc-key.cjs") &&
      finalSubmissionChecklist.sourceArtifacts?.includes("scripts/check-upload-credentials.cjs"),
    "Final submission checklist records source artifacts"
  );
  assert(
    finalSubmissionChecklistItems.some(
      (item) => item.id === "upload-command-packet-current" && /upload-packet:store|signed package|upload tool/i.test(`${item.label} ${item.evidence} ${item.action}`)
    ),
    "Final submission checklist includes upload command packet readiness row"
  );
  assert(
    finalSubmissionChecklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "public-site-publish-packet" &&
          item.evidence.includes(String(publicSitePublishPacket.summary?.readyPageCount ?? "missing"))
      )
    ),
    "Final submission checklist reflects public site publish packet state"
  );
  assert(
    finalSubmissionChecklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "public-host-runbook" &&
          item.evidence.includes(String(publicHostRunbook.summary?.hostedFileCount ?? "missing"))
      )
    ),
    "Final submission checklist reflects public host runbook state"
  );
  assert(
    finalSubmissionChecklistItems.some(
      (item) =>
        item.id === "copy-map-clear" &&
        item.evidence.includes(String(copyMap.summary?.blockerCount ?? "missing")) &&
        item.evidence.includes(String(copyMap.workflow?.summary?.blockerStepCount ?? "missing"))
    ),
    "Final submission checklist reflects copy-map field and workflow blocker counts"
  );
  assert(
    finalSubmissionChecklistItems.some(
      (item) => item.id === "published-site-ready" && String(item.action ?? "").includes("check:published-site -- --strict")
    ),
    "Final submission checklist includes strict published-site readiness action"
  );
  assert(finalSubmissionChecklistMarkdown.includes("Ready for Add for Review"), "Final submission checklist markdown includes Add for Review readiness");
  assert(finalSubmissionChecklistMarkdown.includes("App Store Connect"), "Final submission checklist markdown names App Store Connect");
  assert(releaseDashboard.app?.bundleId === pkg.build?.appId, "Release dashboard bundle id matches package config");
  assert(releaseDashboard.summary?.releaseBlockers === releaseBlockers.summary?.blockerCount, "Release dashboard blocker count matches blocker report");
  assert(releaseDashboard.summary?.publicInputsReady === publicReleaseInputs.summary?.readyCount, "Release dashboard public-input ready count matches source");
  assert(releaseDashboard.summary?.publicInputsRequired === publicReleaseInputs.summary?.requiredCount, "Release dashboard public-input required count matches source");
  assert(releaseDashboard.summary?.publicInputsBlocked === publicReleaseInputs.summary?.blockerCount, "Release dashboard public-input blocker count matches source");
  assert(releaseDashboard.summary?.publishPacketStatus === publicSitePublishPacket.summary?.publishStatus, "Release dashboard publish packet status matches source");
  assert(releaseDashboard.summary?.publishPacketReadyPages === publicSitePublishPacket.summary?.readyPageCount, "Release dashboard publish packet ready page count matches source");
  assert(
    releaseDashboard.summary?.publishPacketRequiredPages === publicSitePublishPacket.summary?.requiredPageCount,
    "Release dashboard publish packet required page count matches source"
  );
  assert(releaseDashboard.summary?.uploadPacketStatus === uploadCommandPacket.summary?.status, "Release dashboard upload packet status matches source");
  assert(
    releaseDashboard.summary?.uploadPacketSignedPackages === uploadCommandPacket.summary?.signedUploadPackageCount,
    "Release dashboard upload packet signed package count matches source"
  );
  assert(
    releaseDashboard.summary?.uploadPacketAvailableTools === uploadCommandPacket.summary?.availableToolCount,
    "Release dashboard upload packet tool count matches source"
  );
  assert(
    releaseDashboard.sourceArtifacts?.includes("app-store-assets/UPLOAD_COMMAND_PACKET.json"),
    "Release dashboard records upload command packet source artifact"
  );
  assert(releaseDashboard.summary?.finalChecklistBlockers === finalSubmissionChecklist.summary?.blockerCount, "Release dashboard final checklist blocker count matches source");
  assert(releaseDashboard.summary?.evidenceCommands === releaseEvidence.commands?.length, "Release dashboard evidence command count matches source");
  assert(releaseDashboard.summary?.evidenceArtifacts === releaseEvidence.artifacts?.length, "Release dashboard evidence artifact count matches source");
  assert(
    releaseDashboard.summary?.masSubmissionReady === (releaseEvidence.masSubmission?.submissionReady === true),
    "Release dashboard MAS readiness flag matches release evidence"
  );
  assert(releaseDashboard.masSubmission?.mode === releaseEvidence.masSubmission?.mode, "Release dashboard MAS mode matches release evidence");
  assert(
    releaseDashboard.masSubmission?.submissionReady === (releaseEvidence.masSubmission?.submissionReady === true),
    "Release dashboard MAS submission readiness matches release evidence"
  );
  assert(
    releaseDashboard.masSubmission?.localRehearsalOnly === (releaseEvidence.masSubmission?.localRehearsalOnly === true),
    "Release dashboard MAS local rehearsal flag matches release evidence"
  );
  assert(
    releaseDashboard.masSubmission?.hasEmbeddedProvisioningProfile === (releaseEvidence.masSubmission?.hasEmbeddedProvisioningProfile === true),
    "Release dashboard MAS provisioning posture matches release evidence"
  );
  assert(
    releaseDashboard.masSubmission?.codeSignatureVerified === (releaseEvidence.masSubmission?.codeSignatureVerified === true),
    "Release dashboard MAS code-signature posture matches release evidence"
  );
  assert(
    releaseDashboard.masSubmission?.uploadPackageCount === Number(releaseEvidence.masSubmission?.uploadPackageCount ?? 0) &&
      releaseDashboard.masSubmission?.signedUploadPackageCount === Number(releaseEvidence.masSubmission?.signedUploadPackageCount ?? 0) &&
      releaseDashboard.masSubmission?.currentVersionUploadPackageCount === Number(releaseEvidence.masSubmission?.currentVersionUploadPackageCount ?? 0) &&
      releaseDashboard.masSubmission?.signedCurrentVersionUploadPackageCount ===
        Number(releaseEvidence.masSubmission?.signedCurrentVersionUploadPackageCount ?? 0),
    "Release dashboard MAS upload package posture matches release evidence"
  );
  assert(
    ["public-inputs", "generated-site", "signing-package", "submission"].every((id) =>
      releaseDashboard.categories?.some((category) => category.id === id)
    ),
    "Release dashboard includes every blocker category"
  );
  assert(Boolean(releaseDashboard.nextAction?.command), "Release dashboard records next command");
  if ((releaseBlockers.nextActionQueue ?? []).length > 0) {
    const firstQueuedAction = releaseBlockers.nextActionQueue[0];
    assert(releaseDashboard.nextAction?.source?.includes("RELEASE_BLOCKERS.json"), "Release dashboard next action is sourced from blocker report queue");
    assert(releaseDashboard.nextAction?.categoryId === firstQueuedAction.categoryId, "Release dashboard next action category matches blocker queue");
    assert(releaseDashboard.nextAction?.checkId === firstQueuedAction.firstBlockedCheckId, "Release dashboard next action check matches blocker queue");
    assert(releaseDashboard.nextAction?.command === firstQueuedAction.recommendedCommand, "Release dashboard next command matches blocker queue");
    assert(releaseDashboard.nextAction?.detail === firstQueuedAction.nextAction, "Release dashboard next detail matches blocker queue");
  }
  if (releaseDashboard.nextAction?.categoryId === "public-inputs") {
    assert(
      releaseDashboard.nextAction.command.includes("npm run configure:store-env") &&
        releaseDashboard.nextAction.command.includes("--site-url") &&
        releaseDashboard.nextAction.command.includes("npm run public-release:store:node -- --self-test") &&
        releaseDashboard.nextAction.command.includes("npm run public-inputs:store") &&
        releaseDashboard.nextAction.command.includes("npm run check:store-env"),
      "Release dashboard public-input action uses validated store env configurator"
    );
  }
  assert(!JSON.stringify(releaseDashboard).includes("you@example.com"), "Release dashboard JSON excludes placeholder email values");
  assert(!JSON.stringify(releaseDashboard).includes("+1-555-555-5555"), "Release dashboard JSON excludes placeholder phone values");
  assert(!/<script\b/i.test(releaseDashboardHtml), "Release dashboard HTML has no script tags");
  assert(releaseDashboardHtml.includes("Cody Cartridge Release Dashboard"), "Release dashboard HTML includes title");
  assert(releaseDashboardHtml.includes("Next release-machine move"), "Release dashboard HTML includes next-action section");
  assert(releaseDashboardHtml.includes("UPLOAD_COMMAND_PACKET.md"), "Release dashboard HTML links upload command packet artifact");
  assert(releaseDashboardHtml.includes("MAS submission posture"), "Release dashboard HTML includes MAS submission posture section");
  assert(
    releaseDashboardHtml.includes("Not ready for upload") || releaseDashboardHtml.includes("Signed package ready"),
    "Release dashboard HTML includes MAS upload readiness copy"
  );
  assert(releaseOperatorQueue.app?.bundleId === pkg.build?.appId, "Release operator queue bundle id matches package config");
  assert(releaseOperatorQueue.summary?.releaseBlockers === releaseBlockers.summary?.blockerCount, "Release operator queue blocker count matches blocker report");
  assert(releaseOperatorQueue.summary?.publicInputsReady === publicReleaseInputs.summary?.readyCount, "Release operator queue public-input ready count matches source");
  assert(releaseOperatorQueue.summary?.publicInputsRequired === publicReleaseInputs.summary?.requiredCount, "Release operator queue public-input required count matches source");
  assert(releaseOperatorQueue.summary?.publicInputsBlocked === publicReleaseInputs.summary?.blockerCount, "Release operator queue public-input blocker count matches source");
  assert(releaseOperatorQueue.summary?.publishPacketStatus === publicSitePublishPacket.summary?.publishStatus, "Release operator queue publish packet status matches source");
  assert(releaseOperatorQueue.summary?.publishPacketReadyPages === publicSitePublishPacket.summary?.readyPageCount, "Release operator queue publish packet ready page count matches source");
  assert(
    releaseOperatorQueue.summary?.publishPacketRequiredPages === publicSitePublishPacket.summary?.requiredPageCount,
    "Release operator queue publish packet required page count matches source"
  );
  assert(releaseOperatorQueue.summary?.finalChecklistBlockers === finalSubmissionChecklist.summary?.blockerCount, "Release operator queue final checklist blocker count matches source");
  assert(
    releaseOperatorQueue.summary?.masSubmissionReady === (releaseDashboard.masSubmission?.submissionReady === true),
    "Release operator queue MAS readiness flag matches dashboard"
  );
  assert(releaseOperatorQueue.masSubmission?.mode === releaseDashboard.masSubmission?.mode, "Release operator queue MAS mode matches dashboard");
  assert(
    releaseOperatorQueue.masSubmission?.submissionReady === (releaseDashboard.masSubmission?.submissionReady === true),
    "Release operator queue MAS submission readiness matches dashboard"
  );
  assert(
    releaseOperatorQueue.masSubmission?.localRehearsalOnly === (releaseDashboard.masSubmission?.localRehearsalOnly === true),
    "Release operator queue MAS local rehearsal flag matches dashboard"
  );
  assert(
    releaseOperatorQueue.masSubmission?.hasEmbeddedProvisioningProfile === (releaseDashboard.masSubmission?.hasEmbeddedProvisioningProfile === true),
    "Release operator queue MAS provisioning posture matches dashboard"
  );
  assert(
    releaseOperatorQueue.masSubmission?.codeSignatureVerified === (releaseDashboard.masSubmission?.codeSignatureVerified === true),
    "Release operator queue MAS code-signature posture matches dashboard"
  );
  assert(
    releaseOperatorQueue.masSubmission?.uploadPackageCount === Number(releaseDashboard.masSubmission?.uploadPackageCount ?? 0) &&
      releaseOperatorQueue.masSubmission?.signedUploadPackageCount === Number(releaseDashboard.masSubmission?.signedUploadPackageCount ?? 0) &&
      releaseOperatorQueue.masSubmission?.currentVersionUploadPackageCount ===
        Number(releaseDashboard.masSubmission?.currentVersionUploadPackageCount ?? 0) &&
      releaseOperatorQueue.masSubmission?.signedCurrentVersionUploadPackageCount ===
        Number(releaseDashboard.masSubmission?.signedCurrentVersionUploadPackageCount ?? 0),
    "Release operator queue MAS upload package posture matches dashboard"
  );
  assert(releaseOperatorQueue.nextAction?.command === releaseDashboard.nextAction?.command, "Release operator queue next command matches dashboard");
  assert(releaseOperatorQueue.strictPreflight?.command === "npm run release:store:preflight", "Release operator queue records strict preflight command");
  assert(
    releaseOperatorQueue.strictPreflight?.nodeCommand === "npm run release:store:preflight:node",
    "Release operator queue records Node-safe strict preflight command"
  );
  assert(
    releaseOperatorQueue.strictPreflight?.ready === Boolean(releaseBlockers.summary?.readyForStrictPreflight),
    "Release operator queue strict preflight readiness matches blocker report"
  );
  assert(
    releaseOperatorQueue.strictPreflight?.blockerCount === releaseBlockers.summary?.blockerCount,
    "Release operator queue strict preflight blocker count matches blocker report"
  );
  assert(
    Array.isArray(releaseOperatorQueue.strictPreflight?.blockedCategories) &&
      releaseOperatorQueue.strictPreflight.blockedCategories.length === (releaseBlockers.nextActionQueue ?? []).length,
    "Release operator queue strict preflight lists current blocked categories"
  );
  assert(
    (releaseOperatorQueue.strictPreflight?.blockedCategories ?? []).every((category, index) => {
      const source = releaseBlockers.nextActionQueue?.[index];
      return (
        category.categoryId === source?.categoryId &&
        category.blockerCount === source?.blockerCount &&
        category.firstBlockedCheckId === source?.firstBlockedCheckId
      );
    }),
    "Release operator queue strict preflight blocked categories match blocker queue"
  );
  assert(
    (releaseOperatorQueue.strictPreflight?.runWhen ?? []).some((item) => item.includes("zero blockers")) &&
      (releaseOperatorQueue.strictPreflight?.runWhen ?? []).some((item) => item.includes("MAS signing assets")),
    "Release operator queue strict preflight records run conditions"
  );
  if ((releaseBlockers.nextActionQueue ?? []).length > 0) {
    const firstQueuedAction = releaseBlockers.nextActionQueue[0];
    assert(releaseOperatorQueue.blockerQueueAction?.categoryId === firstQueuedAction.categoryId, "Release operator queue records blocker queue category");
    assert(releaseOperatorQueue.blockerQueueAction?.firstBlockedCheckId === firstQueuedAction.firstBlockedCheckId, "Release operator queue records blocker queue check");
    assert(releaseOperatorQueue.blockerQueueAction?.recommendedCommand === firstQueuedAction.recommendedCommand, "Release operator queue records blocker queue command");
    assert(releaseOperatorQueue.nextAction?.source === releaseDashboard.nextAction?.source, "Release operator queue next-action source matches dashboard");
  }
  if (releaseOperatorQueue.nextAction?.phaseId === "prepare-public-inputs") {
    assert(
      releaseOperatorQueue.nextAction.command.includes("npm run configure:store-env") &&
        releaseOperatorQueue.nextAction.command.includes("--site-url") &&
        releaseOperatorQueue.nextAction.command.includes("npm run check:store-env"),
      "Release operator queue public-input action uses validated store env configurator"
    );
    assert(
      releaseOperatorQueue.nextAction.validateCommand?.includes("npm run configure:store-env -- --dry-run") &&
        releaseOperatorQueue.nextAction.validateCommand?.includes("npm run public-release:store:node -- --self-test"),
      "Release operator queue public-input validation command dry-runs values through Node-safe self-test"
    );
    assert(
      releaseOperatorQueue.nextAction.applyCommand?.includes("npm run configure:store-env -- --dry-run") &&
        releaseOperatorQueue.nextAction.applyCommand?.includes("npm run configure:store-env -- --site-url") &&
        releaseOperatorQueue.nextAction.applyCommand?.includes("npm run public-release:store:node -- --self-test") &&
        releaseOperatorQueue.nextAction.applyCommand?.includes("npm run public-inputs:store") &&
        releaseOperatorQueue.nextAction.applyCommand?.includes("npm run check:store-env") &&
        releaseOperatorQueue.nextAction.applyCommand?.includes("npm run check:release-runtime:node -- --strict"),
      "Release operator queue public-input apply command writes env overlay and runs Node-safe validation"
    );
    assert(
      (releaseOperatorQueue.nextAction.stopWhen ?? []).some((item) => item.includes("check:release-runtime:node -- --strict")),
      "Release operator queue public-input stop criteria include Node-safe strict runtime check"
    );
  }
  assert((releaseOperatorQueue.queue ?? []).length === (releaseResolutionPlan.phases ?? []).length, "Release operator queue records every resolution-plan phase");
  assert(
    JSON.stringify(releaseOperatorQueue.releaseMachineCommands ?? []) ===
      JSON.stringify((signingRunbook.releaseMachineCommands ?? []).map((item) => item.command)),
    "Release operator queue mirrors signing/upload runbook commands"
  );
  assert(
    [
      "app-store-assets/RELEASE_BLOCKERS.json",
      "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
      "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
	      "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
	      "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
	      "app-store-assets/SIGNING_ASSET_REPORT.json",
	      "app-store-assets/UPLOAD_COMMAND_PACKET.json",
	      "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
      "app-store-assets/RELEASE_EVIDENCE.json",
      "app-store-assets/RELEASE_DASHBOARD.json"
    ].every((artifact) => releaseOperatorQueue.sourceArtifacts?.includes(artifact)),
    "Release operator queue records source artifacts"
  );
  assert(releaseOperatorQueue.redaction?.storesRawContactValues === false, "Release operator queue records raw-contact redaction posture");
  assert(releaseOperatorQueue.redaction?.storesSigningSecrets === false, "Release operator queue records signing-secret redaction posture");
  assert(!JSON.stringify(releaseOperatorQueue).includes("you@example.com"), "Release operator queue JSON excludes placeholder email values");
  assert(!JSON.stringify(releaseOperatorQueue).includes("+1-555-555-5555"), "Release operator queue JSON excludes placeholder phone values");
  assert(releaseOperatorQueueMarkdown.includes("# Cody Cartridge Release Operator Queue"), "Release operator queue markdown includes title");
  assert(releaseOperatorQueueMarkdown.includes("## Immediate Action"), "Release operator queue markdown includes immediate action");
  assert(releaseOperatorQueueMarkdown.includes("**Validate Values**"), "Release operator queue markdown includes value-validation command");
  assert(releaseOperatorQueueMarkdown.includes("**Apply Values And Refresh**"), "Release operator queue markdown includes apply-and-refresh command");
  assert(releaseOperatorQueueMarkdown.includes("## Strict Preflight Trigger"), "Release operator queue markdown includes strict preflight trigger");
  assert(
    releaseOperatorQueueMarkdown.includes("npm run release:store:preflight"),
    "Release operator queue markdown includes strict preflight command"
  );
  assert(
    releaseOperatorQueueMarkdown.includes("npm run release:store:preflight:node"),
    "Release operator queue markdown includes Node-safe strict preflight command"
  );
  assert(releaseOperatorQueueMarkdown.includes("RELEASE_DASHBOARD.html"), "Release operator queue markdown points to dashboard");
  assert(releaseOperatorQueueMarkdown.includes("MAS posture"), "Release operator queue markdown includes MAS posture");
  assert(releaseOperatorQueueMarkdown.includes("MAS submission ready"), "Release operator queue markdown includes MAS submission readiness");
  const signingRunbookCommands = (signingRunbook.releaseMachineCommands ?? []).map((item) => item.command);
  const releaseBlockerLabelsForCategory = (categoryId) =>
    (releaseBlockers.categories ?? [])
      .find((category) => category.id === categoryId)
      ?.checks?.filter((check) => check.status === "blocked")
      .map((check) => check.label) ?? [];
  assert(signingAssetReport.app?.bundleId === pkg.build?.appId, "Signing asset report bundle id matches package config");
  assert(signingAssetReport.app?.version === pkg.version, "Signing asset report version matches package config");
  assert(signingAssetReport.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Signing asset report build version matches package config");
  assert(signingAssetReport.summary?.blockerCount === (signingAssetReport.blockers ?? []).length, "Signing asset report blocker count is accurate");
  assert(
    signingAssetReport.summary?.readyForMasSigning === ((signingAssetReport.blockers ?? []).length === 0),
    "Signing asset report readiness matches blockers"
  );
  assert(
    signingAssetReport.entitlements?.path === pkg.build?.mas?.entitlements &&
      signingAssetReport.entitlements?.appSandbox === true &&
      signingAssetReport.entitlements?.userSelectedReadOnly === true &&
      signingAssetReport.entitlements?.appScopeBookmarks === true &&
      signingAssetReport.entitlements?.networkClient === false,
    "Signing asset report records MAS entitlement posture"
  );
  assert(
    signingAssetReport.redaction?.storesIdentityNames === false &&
      signingAssetReport.redaction?.storesCertificateHashes === false &&
      signingAssetReport.redaction?.storesProvisioningProfileNames === false &&
      signingAssetReport.redaction?.storesProvisioningProfileUuids === false &&
      signingAssetReport.redaction?.storesLocalProfilePaths === false &&
      signingAssetReport.redaction?.storesAppleAccountValues === false,
    "Signing asset report records redaction posture"
  );
  assert(!JSON.stringify(signingAssetReport).includes(os.homedir()), "Signing asset report excludes home-directory paths");
  assert(!/Apple (?:Distribution|Development|Mac App Distribution|Mac Installer Distribution):\s/i.test(JSON.stringify(signingAssetReport)), "Signing asset report excludes signing identity names");
  assert(signingAssetReportMarkdown.includes("# Cody Cartridge Signing Asset Report"), "Signing asset report markdown includes title");
  assert(signingAssetReportMarkdown.includes("Provisioning Profile Inventory"), "Signing asset report markdown includes profile inventory");
  assert(Number.isInteger(signingAssetReport.provisioningProfiles?.storageIssueCount), "Signing asset report records provisioning profile storage issues");
  assert(signingAssetReportMarkdown.includes("Redaction"), "Signing asset report markdown includes redaction section");
  assert(appleReleaseAssets.app?.bundleId === pkg.build?.appId, "Apple release asset packet bundle id matches package config");
  assert(appleReleaseAssets.app?.version === pkg.version, "Apple release asset packet version matches package config");
  assert(appleReleaseAssets.summary?.assetRequestCount === appleReleaseAssets.assetRequests?.length, "Apple release asset packet request count is accurate");
  assert(
    [
      "app-store-connect-app-record",
      "application-distribution-certificate",
      "installer-distribution-certificate",
      "mas-provisioning-profile",
      "signed-mas-package",
      "app-store-connect-api-key"
    ].every((id) => appleReleaseAssets.assetRequests?.some((item) => item.id === id)),
    "Apple release asset packet records every required Apple-side asset request"
  );
  assert(
    [
      "com.apple.security.app-sandbox",
      "com.apple.security.files.user-selected.read-only",
      "com.apple.security.files.bookmarks.app-scope"
    ].every((key) => appleReleaseAssets.entitlements?.required?.includes(key)),
    "Apple release asset packet records required MAS entitlement keys"
  );
  assert(
    ["npm run signing-assets:store", "npm run apple-assets:store", "npm run check:mas-signing -- --strict", "npm run upload-packet:store", "npm run check:upload-credentials -- --strict"].every((command) =>
      appleReleaseAssets.validationFlow?.includes(command)
    ),
    "Apple release asset packet records signing and upload validation flow"
  );
  assert(
    appleReleaseAssets.redaction?.storesCertificateNames === false &&
      appleReleaseAssets.redaction?.storesProvisioningProfileUuids === false &&
      appleReleaseAssets.redaction?.storesApiKeyIds === false &&
      appleReleaseAssets.redaction?.storesPrivateKeyPaths === false,
    "Apple release asset packet records certificate/profile/API redaction posture"
  );
  assert(!JSON.stringify(appleReleaseAssets).includes("BEGIN PRIVATE KEY"), "Apple release asset packet excludes private-key material");
  assert(appleReleaseAssetsMarkdown.includes("# Cody Cartridge Apple Release Asset Requests"), "Apple release asset markdown includes title");
  assert(appleReleaseAssetsMarkdown.includes("## Request Table"), "Apple release asset markdown includes request table");
  assert(appleReleaseAssetsMarkdown.includes("## Validation Flow"), "Apple release asset markdown includes validation flow");
  assert(signingRunbook.app?.bundleId === pkg.build?.appId, "Signing/upload runbook bundle id matches package config");
  assert(signingRunbook.app?.version === pkg.version, "Signing/upload runbook version matches package config");
  assert(signingRunbook.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Signing/upload runbook build version matches package config");
  assert(signingRunbook.remainingBlockers?.total === releaseBlockers.summary?.blockerCount, "Signing/upload runbook blocker total matches blocker report");
  assert(
    JSON.stringify(signingRunbook.remainingBlockers?.publicInputs ?? []) ===
      JSON.stringify(releaseBlockerLabelsForCategory("public-inputs")),
    "Signing/upload runbook public-input blockers match blocker report"
  );
  assert(
    JSON.stringify(signingRunbook.remainingBlockers?.generatedSite ?? []) ===
      JSON.stringify(releaseBlockerLabelsForCategory("generated-site")),
    "Signing/upload runbook generated-site blockers match blocker report"
  );
  assert(
    JSON.stringify(signingRunbook.remainingBlockers?.signingPackage ?? []) ===
      JSON.stringify(releaseBlockerLabelsForCategory("signing-package")),
    "Signing/upload runbook signing/package blockers match blocker report"
  );
  assert(
    JSON.stringify(signingRunbook.remainingBlockers?.submission ?? []) ===
      JSON.stringify(releaseBlockerLabelsForCategory("submission")),
    "Signing/upload runbook submission blockers match blocker report"
  );
  assert(signingRunbook.requiredSigningAssets?.entitlements === pkg.build?.mas?.entitlements, "Signing/upload runbook entitlements path matches package config");
  assert(signingRunbook.requiredSigningAssets?.inheritedEntitlements === pkg.build?.mas?.entitlementsInherit, "Signing/upload runbook inherited entitlements path matches package config");
  assert(signingRunbook.signingAssetSnapshot?.status === signingAssetReport.summary?.status, "Signing/upload runbook signing asset status matches report");
  assert(signingRunbook.signingAssetSnapshot?.blockerCount === signingAssetReport.summary?.blockerCount, "Signing/upload runbook signing asset blocker count matches report");
  assert(signingRunbook.signingAssetSnapshot?.readyForMasSigning === (signingAssetReport.summary?.readyForMasSigning === true), "Signing/upload runbook signing asset readiness matches report");
  assert(signingRunbook.signingAssetSnapshot?.redacted === true, "Signing/upload runbook signing asset snapshot is redacted");
  assert(
    /Apple Distribution|Mac App Distribution|3rd Party Mac Developer Application/.test(signingRunbook.requiredSigningAssets?.applicationIdentity ?? ""),
    "Signing/upload runbook names required application signing identities"
  );
  assert(
    /Mac Installer Distribution|3rd Party Mac Developer Installer/.test(signingRunbook.requiredSigningAssets?.installerIdentity ?? ""),
    "Signing/upload runbook names required installer signing identities"
  );
  assert(/get-task-allow=false/.test(signingRunbook.requiredSigningAssets?.provisioningProfile ?? ""), "Signing/upload runbook requires distribution provisioning profile posture");
  assert(signingRunbook.expectedPackageOutputs?.appBundlePath === "dist/mas-arm64/Cody Cartridge.app", "Signing/upload runbook records MAS app bundle path");
  assert(signingRunbook.expectedPackageOutputs?.uploadPackagePattern === "dist/**/*.pkg", "Signing/upload runbook records MAS upload package pattern");
  assert(signingRunbook.uploadTooling?.some((item) => item.includes("Transporter")), "Signing/upload runbook includes Transporter upload path");
  assert(signingRunbook.uploadTooling?.some((item) => item.includes("altool")), "Signing/upload runbook includes altool upload path");
  assert(signingRunbook.uploadTooling?.some((item) => item.includes("iTMSTransporter")), "Signing/upload runbook includes iTMSTransporter upload path");
  assert(signingRunbookCommands.includes("npm run upload-packet:store"), "Signing/upload runbook includes upload command packet generation");
  assert(signingRunbookCommands.includes("npm run apple-assets:store"), "Signing/upload runbook includes Apple release asset request generation");
  assert(
    signingRunbookCommands.includes(
      "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run"
    ),
    "Signing/upload runbook includes App Store Connect key install dry-run"
  );
  assert(signingRunbookCommands.includes("npm run check:upload-credentials -- --strict"), "Signing/upload runbook includes strict upload credential gate");
  assert(
    includesInOrder(signingRunbookCommands.join("\n"), "npm run check:upload-tooling -- --strict", "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") &&
      includesInOrder(signingRunbookCommands.join("\n"), "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run", "npm run check:upload-credentials -- --strict") &&
      includesInOrder(signingRunbookCommands.join("\n"), "npm run check:upload-credentials -- --strict", "npm run upload-packet:store") &&
      includesInOrder(signingRunbookCommands.join("\n"), "npm run upload-packet:store", "npm run apple-assets:store") &&
      includesInOrder(signingRunbookCommands.join("\n"), "npm run apple-assets:store", "npm run upload-evidence:store"),
    "Signing/upload runbook orders ASC key validation, upload packet, Apple asset packet, and upload evidence"
  );
  assert(signingRunbookMarkdown.includes("UPLOAD_COMMAND_PACKET.md"), "Signing/upload runbook markdown points to upload command packet");
  assert(Array.isArray(signingRunbook.signingRemediationChecklist), "Signing/upload runbook includes signing remediation checklist");
  assert(
    signingRunbook.signingRemediationChecklist?.some((item) => item.includes(pkg.build?.appId)),
    "Signing/upload runbook remediation checklist names bundle id"
  );
  assert(
    signingRunbook.signingRemediationChecklist?.some((item) => /Apple Distribution|Mac App Distribution|3rd Party Mac Developer Application/.test(item)),
    "Signing/upload runbook remediation checklist includes application identity"
  );
  assert(
    signingRunbook.signingRemediationChecklist?.some((item) => /Mac Installer Distribution|3rd Party Mac Developer Installer/.test(item)),
    "Signing/upload runbook remediation checklist includes installer identity"
  );
  assert(
    signingRunbook.signingRemediationChecklist?.some((item) => /provisioning profile/i.test(item) && item.includes(pkg.build?.appId)),
    "Signing/upload runbook remediation checklist includes matching profile"
  );
  assert(
    signingRunbook.signingRemediationChecklist?.some((item) => /get-task-allow=false/.test(item) && /unexpired/.test(item)),
    "Signing/upload runbook remediation checklist includes distribution profile posture"
  );
  assert(
    signingRunbook.signingRemediationChecklist?.some((item) => item.includes("npm run install:mas-profile")),
    "Signing/upload runbook remediation checklist includes MAS profile validation helper"
  );
  assert(
    signingRunbook.signingRemediationChecklist?.some((item) => item.includes("build/entitlements.mas.plist")),
    "Signing/upload runbook remediation checklist includes entitlement confirmation"
  );
  assert(
    signingRunbook.signingRemediationChecklist?.some((item) => /private keys|provisioning profiles|upload credentials/i.test(item)),
    "Signing/upload runbook remediation checklist keeps signing secrets out of handoff"
  );
  assert(signingRunbookCommands.some((item) => item.includes("npm run check:mas-signing -- --strict")), "Signing/upload runbook includes strict signing gate");
  assert(signingRunbookCommands.some((item) => item.includes("npm run dist:mas")), "Signing/upload runbook includes MAS package command");
  assert(signingRunbookCommands.some((item) => item.includes("npm run check:mas-package -- --strict")), "Signing/upload runbook includes strict MAS package gate");
  assert(signingRunbookCommands.some((item) => item.includes("npm run check:upload-tooling -- --strict")), "Signing/upload runbook includes strict upload tooling gate");
  assert(signingRunbookCommands.some((item) => item.includes("npm run check:release-machine -- --strict")), "Signing/upload runbook includes strict release machine doctor gate");
  assert(signingRunbookCommands.some((item) => item.includes("npm run check:public-release-sync -- --strict")), "Signing/upload runbook includes strict public release sync gate");
  assert(signingRunbookCommands.some((item) => item.includes("npm run check:published-site -- --strict")), "Signing/upload runbook includes strict published-site gate");
  assert(signingRunbookCommands.some((item) => item.includes("npm run signing-assets:store")), "Signing/upload runbook includes signing asset report command");
  assert(
    signingRunbookCommands.some((item) => item.includes("npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run")),
    "Signing/upload runbook includes MAS profile validation command"
  );
  assert(signingRunbookCommands.some((item) => item.includes("npm run public-inputs:store")), "Signing/upload runbook includes public release-input packet command");
  assert(signingRunbookCommands.some((item) => item.includes("npm run publish-packet:store")), "Signing/upload runbook includes public site publish packet command");
  assert(signingRunbookCommands.some((item) => item.includes("npm run public-host:store")), "Signing/upload runbook includes public host runbook command");
  assert(signingRunbookCommands.some((item) => item.includes("npm run dashboard:store")), "Signing/upload runbook includes release dashboard command");
  assert(signingRunbookCommands.some((item) => item.includes("npm run signing-runbook:store")), "Signing/upload runbook includes self-regeneration command");
  assert(
    Array.isArray(signingRunbook.nodeWrappedShortcuts) &&
      signingRunbook.nodeWrappedShortcuts.some((item) => item.command === "npm run release:store:local:node") &&
      signingRunbook.nodeWrappedShortcuts.some((item) => item.command === "npm run release:store:preflight:node") &&
      signingRunbook.nodeWrappedShortcuts.some((item) => item.command === "npm run check:release-machine:node -- --strict") &&
      signingRunbook.nodeWrappedShortcuts.some((item) => item.command === "npm run verify:store:strict:node"),
    "Signing/upload runbook includes Node-safe release shortcuts"
  );
  assert(
    signingRunbookCommands.indexOf("npm run check:mas-signing -- --strict") <
      signingRunbookCommands.indexOf("npm run dist:mas"),
    "Signing/upload runbook checks signing before MAS packaging"
  );
  assert(
    signingRunbookCommands.indexOf("npm run dist:mas") <
      signingRunbookCommands.indexOf("npm run check:mas-package -- --strict"),
    "Signing/upload runbook checks package after MAS packaging"
  );
  assert(
    signingRunbookCommands.indexOf("npm run check:public-release-sync -- --strict") <
      signingRunbookCommands.indexOf("npm run check:store-urls -- --strict"),
    "Signing/upload runbook checks public release sync before URL reachability"
  );
  assert(
    signingRunbookCommands.indexOf("npm run check:store-urls -- --strict") <
      signingRunbookCommands.indexOf("npm run check:published-site -- --strict") &&
      signingRunbookCommands.indexOf("npm run check:published-site -- --strict") <
        signingRunbookCommands.indexOf("npm run signing-assets:store"),
    "Signing/upload runbook checks full published site before signing assets"
  );
  assert(
    signingRunbookCommands.indexOf("npm run archive:site && npm run check:site-archive -- --strict") <
      signingRunbookCommands.indexOf("npm run publish-packet:store"),
    "Signing/upload runbook builds publish packet after site archive validation"
  );
  assert(
      signingRunbookCommands.indexOf("npm run publish-packet:store") <
      signingRunbookCommands.indexOf("npm run public-host:store") &&
      signingRunbookCommands.indexOf("npm run public-host:store") <
        signingRunbookCommands.indexOf("npm run packet:store && npm run app-compliance:store && npm run review-brief:store && npm run copy-map:store"),
    "Signing/upload runbook builds public host runbook before App Store packet refresh"
  );
  assert(
    signingRunbookCommands.indexOf("npm run check:store-urls -- --strict") <
      signingRunbookCommands.indexOf("npm run signing-assets:store") &&
      signingRunbookCommands.indexOf("npm run signing-assets:store") <
        signingRunbookCommands.indexOf("npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run") &&
      signingRunbookCommands.indexOf("npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run") <
        signingRunbookCommands.indexOf("npm run check:mas-signing -- --strict"),
    "Signing/upload runbook validates MAS profile before strict signing"
  );
  assert(
    signingRunbookCommands.indexOf("npm run check:release-machine -- --strict") <
      signingRunbookCommands.indexOf("npm run verify:store:strict"),
    "Signing/upload runbook runs release machine doctor before strict verification"
  );
  assert(signingRunbookMarkdown.includes("## Required Signing Assets"), "Signing/upload runbook markdown includes signing assets section");
  assert(signingRunbookMarkdown.includes("## Redacted Signing Asset Snapshot"), "Signing/upload runbook markdown includes signing asset snapshot");
  assert(signingRunbookMarkdown.includes("### Node-Safe Shortcuts"), "Signing/upload runbook markdown includes Node-safe shortcuts section");
  assert(signingRunbookMarkdown.includes("npm run release:store:preflight:node"), "Signing/upload runbook markdown includes Node-safe strict preflight shortcut");
  assert(signingRunbookMarkdown.includes("## Upload Checklist"), "Signing/upload runbook markdown includes upload checklist");
  assert(signingRunbookMarkdown.includes("## Signing Remediation Checklist"), "Signing/upload runbook markdown includes signing remediation checklist");
  assert(
    fields.review?.testInstructions?.some((item) => item.includes("Third-Party Notices")),
    "App Store fields JSON review instructions include third-party notices check"
  );
  assert(
    fields.review?.testInstructions?.some(
      (item) => item.includes("Privacy Policy") && item.includes("Support") && item.includes("Accessibility")
    ),
    "App Store fields JSON review instructions include bundled Help documents check"
  );
  assert(
    fields.review?.testInstructions?.some((item) => item.includes("Reset Local Library")),
    "App Store fields JSON review instructions include local reset check"
  );
  assert(fields.accessibility?.reducedMotion?.includes("prefers-reduced-motion"), "App Store fields JSON includes Reduced Motion accessibility answer");
  assert(fields.accessibility?.accessibilityUrl?.includes("accessibility.html"), "App Store fields JSON includes optional accessibility URL");
  assert(fields.urls?.thirdPartyNoticesUrl?.includes("third-party-notices.html"), "App Store fields JSON includes third-party notices URL");
  assert(fields.urls?.publicSiteArchivePath?.includes("cody-cartridge-public-site.zip"), "App Store fields JSON includes public site archive path");
  assert(/^[a-f0-9]{64}$|^missing$/.test(String(fields.urls?.publicSiteArchiveSha256 ?? "")), "App Store fields JSON includes public site archive hash");
  assert(fields.accessibility?.voiceOverCandidate?.includes("VoiceOver"), "App Store fields JSON includes VoiceOver accessibility guidance");
  assert(fields.ageRating?.expectedRating?.includes("4+"), "App Store fields JSON includes age-rating candidate");
  assert(Array.isArray(fields.ageRating?.questionnaireNotes) && fields.ageRating.questionnaireNotes.length >= 5, "App Store fields JSON includes age-rating questionnaire notes");
  assert(fields.distribution?.price?.includes("Free"), "App Store fields JSON includes pricing candidate");
  assert(fields.distribution?.availability?.includes("All countries"), "App Store fields JSON includes availability candidate");
  assert(fields.distribution?.releaseOption?.includes("Manual release"), "App Store fields JSON includes release option candidate");
  assert(fields.distribution?.firstVersionWhatsNew?.includes("first version"), "App Store fields JSON documents first-version What's New behavior");
  assert(isNonEmptyString(fields.distribution?.futureWhatsNew), "App Store fields JSON includes future What's New draft");
	  assert(
	    fields.submission?.upload?.artifactExpectation?.includes("npm run dist:mas"),
	    "App Store fields JSON includes signed MAS upload artifact expectation"
	  );
	  assert(
	    fields.submission?.upload?.artifactExpectation?.includes(".pkg"),
	    "App Store fields JSON identifies signed MAS installer package"
	  );
  assert(
    Array.isArray(fields.submission?.upload?.supportedUploadMethods) &&
      fields.submission.upload.supportedUploadMethods.some((item) => item.includes("Transporter")),
    "App Store fields JSON includes Transporter upload guidance"
  );
  assert(
    Array.isArray(fields.submission?.upload?.processingChecks) &&
      fields.submission.upload.processingChecks.some((item) => item.includes("App Store Connect processing")),
    "App Store fields JSON includes App Store Connect processing checks"
  );
  assert(
    Array.isArray(fields.submission?.buildSelection?.notes) &&
      fields.submission.buildSelection.notes.some((item) => item.includes("Only one uploaded build")),
    "App Store fields JSON includes one-build-per-version selection guidance"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.steps) &&
      fields.submission.appReviewSubmission.steps.some((item) => item.includes("Submit for Review")),
    "App Store fields JSON includes final Submit for Review guidance"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("verify:store:strict")),
    "App Store fields JSON includes strict pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("smoke:store")),
    "App Store fields JSON includes production smoke pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("smoke:a11y")),
    "App Store fields JSON includes accessibility smoke pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("smoke:electron-shell")),
    "App Store fields JSON includes Electron shell smoke pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("smoke:clean-profile")),
    "App Store fields JSON includes clean-profile smoke pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("smoke:mas-dir")),
    "App Store fields JSON includes MAS directory smoke pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("local-only packaged MAS runtime smoke gate")),
    "App Store fields JSON includes local-only packaged MAS runtime smoke pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("check:site")),
    "App Store fields JSON includes strict site pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("check:electron-security")),
    "App Store fields JSON includes Electron security pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("check:help-docs")),
    "App Store fields JSON includes Help document pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("screenshot quality")),
    "App Store fields JSON includes screenshot quality pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("report:store-blockers")),
    "App Store fields JSON includes release blocker report pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("check:upload-tooling")),
    "App Store fields JSON includes upload tooling pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.preSubmitChecklist) &&
      fields.submission.appReviewSubmission.preSubmitChecklist.some((item) => item.includes("check:upload-credentials")),
    "App Store fields JSON includes upload credential pre-submit checklist"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.postSubmitMonitoring) &&
      fields.submission.appReviewSubmission.postSubmitMonitoring.some((item) => item.includes("App Review status")) &&
      fields.submission.appReviewSubmission.postSubmitMonitoring.some((item) => item.includes("strict preflight")),
    "App Store fields JSON includes post-submit monitoring guidance"
  );
  assert(fields.rightsAndCompliance?.contentRights?.includes("ships without music"), "App Store fields JSON includes content-rights statement");
  assert(fields.rightsAndCompliance?.exportCompliance?.includes("encryption"), "App Store fields JSON includes export-compliance note");
  assert(fields.rightsAndCompliance?.exportCompliance?.includes("Apple operating system"), "App Store fields JSON includes Apple OS encryption guidance");
  assert(pkg.build?.mac?.extendInfo?.ITSAppUsesNonExemptEncryption === false, "Package config includes ITSAppUsesNonExemptEncryption=false");
  assert(fields.exportCompliance?.artifactPath === "app-store-assets/EXPORT_COMPLIANCE.json", "App Store fields JSON includes export compliance artifact path");
  assert(fields.exportCompliance?.summary?.status === "ready-for-app-store-connect-questionnaire", "App Store fields JSON includes ready export compliance status");
  assert(
    fields.exportCompliance?.appStoreConnect?.sourceUrls?.includes(
      "https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/"
    ),
    "App Store fields JSON includes Apple export-compliance documentation source"
  );
  assert(
    Array.isArray(fields.exportCompliance?.binaryFacts) && fields.exportCompliance.binaryFacts.every((item) => item.status === "pass"),
    "App Store fields JSON includes passing export compliance binary facts"
  );
  assert(fields.rightsAndCompliance?.digitalServicesAct?.status?.includes("trader"), "App Store fields JSON includes EU DSA trader status guidance");
  assert(fields.rightsAndCompliance?.digitalServicesAct?.traderContactDisplay?.includes("address"), "App Store fields JSON includes EU DSA trader contact guidance");
  assert(privacy.includes("does not collect personal data"), "Privacy policy states no collection");
  assert(privacy.includes("does not provide, download, scrape, or redistribute music"), "Privacy policy addresses music rights");
  assert(privacy.includes("File > Reset Local Library"), "Privacy policy explains in-app local data reset");
  assert(support.includes("Use File > Import Audio Files"), "Support draft explains import flow");
  assert(support.includes("File > Reset Local Library"), "Support draft explains local library reset");
  assert(readText("app-store-assets/ACCESSIBILITY.md").includes("Reduced Motion"), "Accessibility draft explains Reduced Motion support");
  assert(appSource.includes("function isLocalPlaybackUrl"), "Renderer has a local playback URL allowlist");
  assert(appSource.includes("function sanitizeStoredState"), "Renderer sanitizes persisted library state on boot");
  assert(appSource.includes("if (!isLocalPlaybackUrl(track.url))"), "Renderer guards audio analysis fetches behind local playback URL checks");
  assert(appSource.includes("!track?.url || !isLocalPlaybackUrl(track.url)"), "Renderer guards audio playback assignment behind local playback URL checks");
  assert(appSource.includes("tracks.filter((track) => isDurablePlaybackUrl(track.url))"), "Renderer persists only durable cody-media playback URLs");
  assert(appSource.includes("window.matchMedia(reducedMotionQuery)"), "App reads system Reduced Motion preference");
  assert(styles.includes("@media (prefers-reduced-motion: reduce)"), "Styles include OS-level Reduced Motion fallback");
  assert(styles.includes("animation-iteration-count: 1 !important"), "Reduced Motion styles collapse repeated animations");
  assert(siteGenerator.includes("loadStoreEnv(projectRoot)"), "Static site generator loads store env file");
  assert(siteGenerator.includes("THIRD_PARTY_NOTICES.md"), "Static site generator renders third-party notices page");
  assert(siteArchiveGenerator.includes("fixedDosDate"), "Public site archive generator uses deterministic ZIP timestamps");
  assert(siteArchiveChecker.includes("parseZip"), "Public site archive checker parses ZIP entries");
  assert(siteArchiveChecker.includes("check:site-archive"), "Public site archive checker reports the archive gate");
  assert(packetGenerator.includes("loadStoreEnv(projectRoot)"), "Submission packet generator loads store env file");
  assert(handoffGenerator.includes("cody-cartridge-app-store-handoff.zip"), "Submission handoff generator writes deterministic archive");
  assert(handoffGenerator.includes("app-store-assets/site.env"), "Submission handoff generator records private env exclusion");
  assert(handoffGenerator.includes("app-store-assets/upload-logs/raw/"), "Submission handoff generator records raw upload log exclusion");
  assert(handoffChecker.includes("upload-logs/raw"), "Submission handoff checker forbids raw upload logs");
  assert(handoffGenerator.includes("Apple signing certificates/private keys"), "Submission handoff generator records signing secret exclusion");
  assert(handoffGenerator.includes("App Store Connect API keys/credentials"), "Submission handoff generator records App Store Connect credential exclusion");
  assert(handoffChecker.includes("parseZip"), "Submission handoff checker parses ZIP entries");
  assert(handoffChecker.includes("forbiddenEntryPatterns"), "Submission handoff checker blocks local/private archive entries");
  assert(handoffChecker.includes("mobileprovision") && handoffChecker.includes("provisionprofile"), "Submission handoff checker blocks provisioning profile archive entries");
  assert(handoffChecker.includes("p8|p12|cer"), "Submission handoff checker blocks signing key/certificate archive entries");
  assert(evidenceGenerator.includes("RELEASE_EVIDENCE.json"), "Release evidence generator writes JSON evidence");
  assert(evidenceGenerator.includes("RELEASE_EVIDENCE.md"), "Release evidence generator writes markdown evidence");
  assert(evidenceGenerator.includes("sanitizeLine"), "Release evidence generator redacts command output");
  assert(evidenceGenerator.includes("mas-package-strict"), "Release evidence generator records strict MAS package command");
  assert(evidenceGenerator.includes("public-release-sync-strict"), "Release evidence generator records strict public release sync command");
  assert(evidenceGenerator.includes("release-machine-doctor-strict"), "Release evidence generator records strict release machine doctor command");
  assert(evidenceGenerator.includes("inspectMasSubmission"), "Release evidence generator inspects MAS submission posture");
  assert(evidenceGenerator.includes("MAS Submission Posture"), "Release evidence generator renders MAS submission posture");
  assert(evidenceChecker.includes("Release evidence command count matches expected gate set"), "Release evidence checker validates command set");
  assert(evidenceChecker.includes("Release evidence artifact hash matches disk"), "Release evidence checker validates artifact hashes");
  assert(evidenceChecker.includes("Release evidence redacts project root path"), "Release evidence checker validates redaction");
  assert(packetGenerator.includes("postSubmitMonitoring"), "Submission packet generator records post-submit monitoring guidance");
  assert(packetGenerator.includes("npm run machine-report:store"), "Submission packet generator records machine report command");
  assert(packetGenerator.includes("npm run check:evidence"), "Submission packet generator records evidence check command");
  assert(packetGenerator.includes("npm run check:manifest"), "Submission packet generator records manifest check command");
  assert(releaseResolutionPlanGenerator.includes("npm run machine-report:store"), "Release resolution plan generator records machine report generation");
  assert(releaseResolutionPlanGenerator.includes("npm run check:evidence"), "Release resolution plan generator records evidence check command");
  assert(releaseResolutionPlanGenerator.includes("npm run check:manifest"), "Release resolution plan generator records manifest check command");
  assert(signingRunbookGenerator.includes("npm run machine-report:store"), "Signing/upload runbook generator records machine report generation");
  assert(signingRunbookGenerator.includes("npm run check:evidence"), "Signing/upload runbook generator records evidence check command");
  assert(signingRunbookGenerator.includes("npm run check:manifest"), "Signing/upload runbook generator records manifest check command");
  assert(signingRunbookChecker.includes("Runbook records machine report between final checklist and evidence"), "Signing/upload runbook checker validates machine-report ordering");
  assert(signingRunbookChecker.includes("Runbook regenerates machine report and checks evidence before strict verification"), "Signing/upload runbook checker validates checked evidence refresh");
  assert(releaseManifestGenerator.includes("check-release-manifest.cjs"), "Release manifest generator inventories its checker");
  assert(releaseManifestGenerator.includes("npm run check:manifest"), "Release manifest generator records manifest check command");
  assert(releaseManifestChecker.includes("Release manifest inventory hash matches disk"), "Release manifest checker validates file hashes");
  assert(releaseManifestChecker.includes("Release manifest MAS mode matches release evidence"), "Release manifest checker validates MAS posture sync");
  assert(publicReleaseInputsGenerator.includes("PUBLIC_RELEASE_INPUTS.json"), "Public release inputs generator writes JSON output");
  assert(publicReleaseInputsGenerator.includes("PUBLIC_RELEASE_INPUTS.md"), "Public release inputs generator writes markdown output");
  assert(publicReleaseInputsGenerator.includes("redactedValue"), "Public release inputs generator redacts configured values");
  assert(publicReleaseInputsChecker.includes("Public release inputs blocker count is accurate"), "Public release inputs checker validates blocker count");
  assert(publicReleaseInputsChecker.includes("chmod 600"), "Public release inputs checker validates private env file permission guidance");
  assert(publicSitePublishPacketGenerator.includes("PUBLIC_SITE_PUBLISH_PACKET.json"), "Public site publish packet generator writes JSON output");
  assert(publicSitePublishPacketGenerator.includes("PUBLIC_SITE_PUBLISH_PACKET.md"), "Public site publish packet generator writes markdown output");
  assert(publicSitePublishPacketGenerator.includes("blockerQueueAction"), "Public site publish packet generator records blocker queue action");
  assert(publicSitePublishPacketGenerator.includes("hostingRequirements"), "Public site publish packet generator records hosting requirements");
  assert(publicSitePublishPacketGenerator.includes("expectedContentType"), "Public site publish packet generator records expected content types");
  assert(publicSitePublishPacketChecker.includes("source/archive match state is accurate"), "Public site publish packet checker validates source/archive match state");
  assert(publicSitePublishPacketChecker.includes("Publish packet hosting file count covers pages and companion files"), "Public site publish packet checker validates hosting file coverage");
  assert(publicSitePublishPacketChecker.includes("expected content type is recorded"), "Public site publish packet checker validates content-type metadata");
  assert(publicSitePublishPacketChecker.includes("check:store-urls -- --strict"), "Public site publish packet checker validates URL verification command");
  assert(publicSitePublishPacketChecker.includes("check:published-site -- --strict"), "Public site publish packet checker validates published-site verification command");
  assert(publicHostRunbookGenerator.includes("PUBLIC_HOST_RUNBOOK.json"), "Public host runbook generator writes JSON output");
  assert(publicHostRunbookGenerator.includes("PUBLIC_HOST_RUNBOOK.md"), "Public host runbook generator writes markdown output");
  assert(publicHostRunbookGenerator.includes("providerRecipes"), "Public host runbook generator records provider recipes");
  assert(publicHostRunbookGenerator.includes("readyForLiveVerification"), "Public host runbook generator records live-verification readiness");
  assert(publicHostRunbookChecker.includes("Public host runbook mirrors every publish-packet hosted file"), "Public host runbook checker validates hosted file coverage");
  assert(publicHostRunbookChecker.includes("providerRecipes?.some") && publicHostRunbookChecker.includes("generic-static-host"), "Public host runbook checker validates provider recipes");
  assert(publicHostRunbookChecker.includes("check:published-site -- --strict"), "Public host runbook checker validates post-publish proof command");
  assert(publicSitePublishedChecker.includes("requestUrl"), "Published public site checker fetches live pages");
  assert(publicSitePublishedChecker.includes("comparePublishedBody"), "Published public site checker compares live pages against generated source");
  assert(publicSitePublishedChecker.includes("expectedContentType"), "Published public site checker reads expected content types");
  assert(publicSitePublishedChecker.includes("checkPublishedContentType"), "Published public site checker validates response content types");
  assert(publicSitePublishedChecker.includes("PUBLIC_SITE_PUBLISH_PACKET.json"), "Published public site checker reads the publish packet");
  assert(publicReleaseSyncChecker.includes("isReleaseStoreEnvValue"), "Public release sync checker validates release-ready env values");
  assert(publicReleaseSyncChecker.includes("APP_STORE_CONNECT_FIELDS.json"), "Public release sync checker reads generated App Store fields");
  assert(publicReleaseSyncChecker.includes("PUBLIC_SITE_ARCHIVE.json"), "Public release sync checker reads generated public-site archive manifest");
  assert(publicReleaseSyncChecker.includes("Public release sync checks"), "Public release sync checker reports gate summary");
 	  assert(initStoreEnv.includes("site.env.example"), "Store env initializer reads the example template");
  assert(initStoreEnv.includes("site.env"), "Store env initializer writes the ignored release env file");
  assert(initStoreEnv.includes("--dry-run"), "Store env initializer supports a dry-run mode");
  assert(initStoreEnv.includes("--force"), "Store env initializer requires an explicit force flag to overwrite");
  assert(initStoreEnv.includes("0o600"), "Store env initializer restricts generated env file permissions");
  assert(pkg.scripts?.["configure:store-env"] === "node scripts/configure-store-env.cjs", "Package exposes store env configurator command");
  assert(configureStoreEnv.includes("app-store-assets/site.env.local"), "Store env configurator defaults to the local release env overlay");
  assert(configureStoreEnv.includes("isReleaseStoreEnvValue"), "Store env configurator validates release env values before writing");
  assert(configureStoreEnv.includes("https://release.example/support.html"), "Store env configurator self-test rejects path-valued public site origins");
  assert(configureStoreEnv.includes("quoteEnvValue"), "Store env configurator quotes shell-sensitive release env values");
  assert(configureStoreEnv.includes("--self-test"), "Store env configurator exposes a quoted-value self-test");
  assert(configureStoreEnv.includes("isSymbolicLink"), "Store env configurator rejects symlink targets");
  assert(configureStoreEnv.includes("0o600"), "Store env configurator writes private env file permissions");
  assert(configureStoreEnv.includes("--dry-run"), "Store env configurator supports dry-run validation");
  assert(storeEnvLoader.includes("normalizedHttpsOrigin") && storeEnvLoader.includes("parsed.origin"), "Store env loader validates CODY_SITE_URL as an HTTPS origin");
  assert(publicReleaseInputsGenerator.includes("isReleaseStoreEnvValue(key, value)"), "Public release inputs generator uses release-env origin validation");
  assert(publicReleaseInputsChecker.includes("isReleaseStoreEnvValue(key, value)"), "Public release inputs checker uses release-env origin validation");
  assert(pkg.scripts?.["public-release:store"] === "node scripts/refresh-public-release.cjs", "Package exposes public release refresh command");
  assert(
    pkg.scripts?.["public-release:store:node"] === "node scripts/run-release-node.cjs npm run public-release:store --",
    "Package exposes Node-safe public release refresh command"
  );
  assert(
    pkg.scripts?.["public-release:store:published"] === "node scripts/refresh-public-release.cjs --published",
    "Package exposes published public release refresh command"
  );
  assert(
    pkg.scripts?.["public-release:store:published:node"] === "node scripts/run-release-node.cjs npm run public-release:store:published --",
    "Package exposes Node-safe published public release refresh command"
  );
  assert(publicReleaseRefresh.includes("loadStoreEnv(projectRoot)"), "Public release refresh loads release env values");
  assert(publicReleaseRefresh.includes("isReleaseStoreEnvValue"), "Public release refresh reports release env readiness");
  assert(publicReleaseRefresh.includes("--dry-run"), "Public release refresh supports dry-run mode");
  assert(publicReleaseRefresh.includes("--published"), "Public release refresh supports published URL verification mode");
  assert(publicReleaseRefresh.includes("check:public-release-sync") && publicReleaseRefresh.includes("--strict"), "Public release refresh runs strict public-release sync");
  assert(publicReleaseRefresh.includes("check:store-urls") && publicReleaseRefresh.includes("--published"), "Public release refresh can run strict published URL checks");
  assert(publicReleaseRefresh.includes("check:published-site") && publicReleaseRefresh.includes("publish-packet-live"), "Public release refresh can run strict full published-site checks");
  assert(publicReleaseRefresh.includes("sanitize") && publicReleaseRefresh.includes("<redacted-release-value>"), "Public release refresh redacts configured release values from output");
  assert(storeSmoke.includes("smokePoisonedStoredState"), "Production store smoke includes poisoned stored-state coverage");
  assert(storeSmoke.includes("https://example.com/remote-probe.mp3"), "Production store smoke seeds a remote playback URL probe");
  assert(storeSmoke.includes("externalResources.length === 0"), "Production store smoke verifies poisoned state does not trigger external network resources");
  assert(storeSmoke.includes("shelfFlowStyleLock"), "Production store smoke verifies shelf slider CSS is locked during playback");
  assert(storeSmoke.includes("shelfThumbBassDeltaY <= 1"), "Production store smoke verifies shelf slider thumb stays centered during bass pulses");
  assert(storeSmoke.includes("shelfRailBassShiftY <= 0.5"), "Production store smoke verifies shelf slider rail does not shift during bass pulses");
  assert(storeSmoke.includes("transitionProperty === \"none\""), "Production store smoke verifies shelf slider transition lock");
  assert(
    storeSmoke.includes("Math.abs(style.transformY - beforeStyle.transformY) <= 0.01"),
    "Production store smoke verifies shelf slider has no vertical transform drift"
  );
  assert(storeSmoke.includes("layoutStable"), "Production store smoke verifies desktop layout stability");
  assert(storeSmoke.includes("layout.noHorizontalOverflow"), "Production store smoke verifies no horizontal page overflow");
  assert(storeSmoke.includes("layout.bayGap >= 8"), "Production store smoke verifies player and library panels do not overlap");
  assert(storeSmoke.includes("containsX(layout.nowPlayingBay, layout.transport)"), "Production store smoke verifies transport controls stay inside player panel");
  assert(storeSmoke.includes("containsX(layout.libraryBay, layout.metadataPanel)"), "Production store smoke verifies catalog metadata stays inside library panel");
  assert(readText("scripts/capture-store-screenshots.cjs").includes("STORE_SCREENSHOTS.json"), "Screenshot capture script writes screenshot provenance manifest");
  assert(readText("scripts/capture-store-screenshots.cjs").includes("appStoreConnectSpec"), "Screenshot capture script records App Store Connect screenshot specification");
  assert(readText("scripts/check-store-screenshots.cjs").includes("checkManifest"), "Screenshot checker validates screenshot provenance manifest");
  assert(readText("scripts/check-store-screenshots.cjs").includes("sourceUrl"), "Screenshot checker validates screenshot source URLs");
  assert(readText("scripts/check-store-screenshots.cjs").includes("acceptedSizes"), "Screenshot checker validates accepted Mac screenshot sizes");
  assert(shellSmoke.includes("Smoke Import Probe.wav"), "Electron shell smoke generates a local audio import fixture");
  assert(shellSmoke.includes("CODY_SHELL_SMOKE_AUDIO_PATH"), "Electron shell smoke passes local audio fixture to main process");
  assert(shellSmoke.includes("createSmokeWavBuffer"), "Electron shell smoke builds a deterministic WAV fixture");
  assert(cleanProfileSmoke.includes("CODY_SHELL_SMOKE_USER_DATA_DIR"), "Clean-profile smoke uses isolated Electron userData");
  assert(cleanProfileSmoke.includes("CODY_SHELL_SMOKE_RESET_PROBE"), "Clean-profile smoke runs reset probe");
  assert(cleanProfileSmoke.includes("security-scoped-bookmarks.json"), "Clean-profile smoke verifies bookmark reset");
  assert(masDirSmoke.includes("CSC_IDENTITY_AUTO_DISCOVERY"), "MAS directory smoke disables signing auto-discovery");
  assert(masDirSmoke.includes("skipped macOS application code signing"), "MAS directory smoke accepts expected signing boundary");
  assert(masDirSmoke.includes("scripts/check-mas-package.cjs"), "MAS directory smoke runs advisory MAS package boundary check");
  assert(masDirSmoke.includes("warningLines"), "MAS directory smoke parses advisory package warnings");
  assert(masDirSmoke.includes("isExpectedUnsignedMasWarning"), "MAS directory smoke allowlists expected unsigned-local warnings");
  assert(masRuntimeSmoke.includes("dist\", \"mas-arm64\", \"Cody Cartridge.app"), "Packaged MAS runtime smoke targets the built MAS app bundle");
  assert(masRuntimeSmoke.includes("signLocalRuntimeBundle"), "Packaged MAS runtime smoke applies a local-only runtime signature to the rehearsal bundle");
  assert(masRuntimeSmoke.includes("copyBundleForRuntime") && masRuntimeSmoke.includes("ditto"), "Packaged MAS runtime smoke signs a temporary bundle copy");
  assert(masRuntimeSmoke.includes('identity: "-"'), "Packaged MAS runtime smoke uses a local-only ad-hoc launch signature");
  assert(masRuntimeSmoke.includes("preEmbedProvisioningProfile: false"), "Packaged MAS runtime smoke does not embed a fake provisioning profile");
  assert(masRuntimeSmoke.includes("CODY_SHELL_SMOKE") && masRuntimeSmoke.includes("CODY_SHELL_SMOKE_RESET_PROBE"), "Packaged MAS runtime smoke uses shell smoke and reset probe modes");
  assert(masRuntimeSmoke.includes("security-scoped-bookmarks.json"), "Packaged MAS runtime smoke verifies bookmark cleanup");
  assert(masRuntimeSmoke.includes("custom app/media/art protocol rejection"), "Packaged MAS runtime smoke requires custom protocol rejection coverage");
  assert(
    masDirSmoke.includes("unexpected advisory warnings") &&
      masDirSmoke.includes("Packaged MAS app does not contain Contents/embedded.provisionprofile") &&
      masDirSmoke.includes("No MAS upload .pkg artifact found in dist") &&
      masDirSmoke.includes("Packaged MAS app code signature does not verify"),
    "MAS directory smoke fails unexpected package warnings while allowing unsigned-local signing warnings"
  );
  assert(readText("scripts/check-electron-security.cjs").includes("setWindowOpenHandler"), "Electron security checker verifies popup guard");
  assert(readText("scripts/check-help-docs.cjs").includes("resourceFileName"), "Help document checker verifies native Help menu resource mappings");
  assert(readText("scripts/check-app-privacy.cjs").includes("Privacy manifest declares no tracking"), "App privacy checker verifies no-tracking manifest state");
  assert(readText("scripts/check-app-privacy.cjs").includes("Dependencies do not include telemetry/ad SDK packages"), "App privacy checker verifies telemetry/ad dependency absence");
  assert(readText("scripts/check-app-privacy.cjs").includes("Renderer audio playback assignment is guarded"), "App privacy checker verifies local playback URL guards");
  assert(exportCompliance.app?.bundleId === fields.app?.bundleId, "Export compliance artifact bundle id matches App Store fields");
  assert(exportCompliance.summary?.status === "ready-for-app-store-connect-questionnaire", "Export compliance artifact records ready status");
  assert(exportCompliance.summary?.appStoreConnectDraftAnswer?.includes("no custom or proprietary encryption"), "Export compliance artifact records no custom/proprietary encryption answer");
  assert(exportCompliance.summary?.appStoreConnectDraftAnswer?.includes("Apple operating system"), "Export compliance artifact records Apple OS encryption guidance");
  assert(exportCompliance.evidence?.infoPlistExportKey === false, "Export compliance artifact records Info.plist non-exempt encryption key");
  assert(exportComplianceMarkdown.includes("ITSAppUsesNonExemptEncryption=false"), "Export compliance markdown documents Info.plist non-exempt encryption key");
  assert(exportCompliance.appStoreConnect?.sourceUrls?.some((url) => url.includes("overview-of-export-compliance")), "Export compliance artifact links Apple overview source");
  assert(exportCompliance.appStoreConnect?.sourceUrls?.some((url) => url.includes("export-compliance-documentation-for-encryption")), "Export compliance artifact links Apple encryption documentation source");
  assert(Array.isArray(exportCompliance.binaryFacts) && exportCompliance.binaryFacts.every((item) => item.status === "pass"), "Export compliance artifact facts all pass");
  assert(exportComplianceMarkdown.includes("# Cody Cartridge Export Compliance Prep"), "Export compliance markdown includes title");
  assert(exportComplianceGenerator.includes("customCryptoPatterns"), "Export compliance generator audits custom crypto dependencies");
  assert(exportComplianceChecker.includes("exact signed MAS binary"), "Export compliance checker validates final-binary requirement wording");
  assert(appStoreCompliance.app?.bundleId === fields.app?.bundleId, "App Store compliance packet bundle id matches App Store fields");
  assert(appStoreCompliance.summary?.status === "ready-for-app-store-connect-entry", "App Store compliance packet is ready for App Store Connect entry");
  assert(appStoreCompliance.summary?.blockerCount === 0, "App Store compliance packet has no source blockers");
  assert((appStoreCompliance.summary?.manualCount ?? 0) >= 3, "App Store compliance packet records manual App Store Connect items");
  assert(
    ["age-rating", "privacy-data", "pricing-availability", "rights-compliance"].every((id) =>
      appStoreCompliance.sections?.some((section) => section.id === id)
    ),
    "App Store compliance packet includes expected sections"
  );
  assert(
    JSON.stringify(appStoreCompliance).includes("ships without music") &&
      JSON.stringify(appStoreCompliance).includes("EU DSA") &&
      JSON.stringify(appStoreCompliance).includes("ready-for-app-store-connect-questionnaire"),
    "App Store compliance packet records content rights, DSA, and export-compliance evidence"
  );
  assert(appStoreComplianceMarkdown.includes("# Cody Cartridge App Store Compliance Packet"), "App Store compliance markdown includes title");
  assert(appStoreComplianceMarkdown.includes("## Compliance Matrix"), "App Store compliance markdown includes compliance matrix");
  assert(appStoreComplianceGenerator.includes("APP_STORE_COMPLIANCE.json"), "App Store compliance generator writes JSON output");
  assert(appStoreComplianceGenerator.includes("manualItemsAreAccountOrAppStoreConnectTasks"), "App Store compliance generator separates manual account tasks");
  assert(appStoreComplianceChecker.includes("App Store compliance content-rights answer is local-file only"), "App Store compliance checker validates content-rights answer");
  const manualTaskItems = (manualTasks.sections ?? []).flatMap((section) => section.tasks ?? []);
  assert(manualTasks.app?.bundleId === fields.app?.bundleId, "App Store Connect manual tasks bundle id matches App Store fields");
  assert(manualTasks.summary?.taskCount === manualTaskItems.length, "App Store Connect manual tasks task count is accurate");
  assert((manualTasks.summary?.manualCount ?? 0) >= 10, "App Store Connect manual tasks record prepared account-side tasks");
  assert((manualTasks.summary?.blockedCount ?? 0) >= 4, "App Store Connect manual tasks record blocked account-side prerequisites");
  assert(manualTasks.summary?.contactValuesRedacted === true, "App Store Connect manual tasks record contact redaction posture");
  assert(
    ["app-record", "product-page", "privacy-compliance", "testflight-review"].every((id) =>
      manualTasks.sections?.some((section) => section.id === id)
    ),
    "App Store Connect manual tasks include expected sections"
  );
  assert(
    ["app-record-create", "product-page-copy", "support-url", "privacy-policy-url", "rights-export-dsa", "app-review-contact", "processed-build-selection"].every((id) =>
      manualTaskItems.some((item) => item.id === id)
    ),
    "App Store Connect manual tasks include key App Store Connect account tasks"
  );
  assert(
    !JSON.stringify(manualTasks).includes("TODO_PUBLIC_SITE_URL") &&
      !JSON.stringify(manualTasks).includes("TODO_SUPPORT_EMAIL") &&
      !JSON.stringify(manualTasks).includes("TODO_REVIEW_CONTACT_NAME") &&
      !JSON.stringify(manualTasks).includes("TODO_REVIEW_CONTACT_PHONE"),
    "App Store Connect manual tasks exclude raw public/contact placeholder values"
  );
  assert(manualTasksMarkdown.includes("# Cody Cartridge App Store Connect Manual Tasks"), "App Store Connect manual tasks markdown includes title");
  assert(manualTasksMarkdown.includes("## Task Matrix"), "App Store Connect manual tasks markdown includes task matrix");
  assert(manualTasksGenerator.includes("APP_STORE_CONNECT_MANUAL_TASKS.json"), "App Store Connect manual task generator writes JSON output");
  assert(manualTasksChecker.includes("Manual tasks exclude raw public/contact placeholder values"), "App Store Connect manual task checker validates redaction");
  const contentRightFacts = contentRights.facts ?? [];
  assert(contentRights.app?.bundleId === fields.app?.bundleId, "Content-rights audit bundle id matches App Store fields");
  assert(contentRights.summary?.status === "ready-for-app-store-content-rights", "Content-rights audit is ready");
  assert(contentRights.summary?.factCount === contentRightFacts.length, "Content-rights audit fact count is accurate");
  assert(contentRights.summary?.failedCount === 0, "Content-rights audit has no failed facts");
  assert(contentRights.summary?.packagedMediaFileCount === 0, "Content-rights audit records no packaged media files");
  assert(contentRights.summary?.highRiskDependencyCount === 0, "Content-rights audit records no media-downloader dependencies");
  assert(contentRights.summary?.highRiskRuntimeReferenceCount === 0, "Content-rights audit records no downloader/scraping runtime references");
  assert(
    ["no-packaged-media", "no-high-risk-deps", "no-high-risk-runtime-refs", "takeout-metadata-only", "local-media-protocols", "sandbox-no-network", "rights-copy"].every((id) =>
      contentRightFacts.some((item) => item.id === id && item.status === "pass")
    ),
    "Content-rights audit includes expected passing media-rights facts"
  );
  assert(contentRightsMarkdown.includes("# Cody Cartridge Content Rights And Media Audit"), "Content-rights audit markdown includes title");
  assert(contentRightsMarkdown.includes("## Audit Matrix"), "Content-rights audit markdown includes audit matrix");
  assert(contentRightsGenerator.includes("APP_CONTENT_RIGHTS.json"), "Content-rights audit generator writes JSON output");
  assert(contentRightsChecker.includes("Content-rights audit records no packaged media files"), "Content-rights audit checker validates packaged media absence");
  assert(artifactPrivacy.includes("collectLocalTrackNames"), "Artifact privacy checker scans local music filenames");
  assert(artifactPrivacy.includes("privateEnvFiles"), "Artifact privacy checker treats real release env files as private inputs");
  assert(artifactPrivacy.includes("privateArtifactDirectories"), "Artifact privacy checker treats raw upload logs as private inputs");
  assert(artifactPrivacy.includes("ignoredSecretPatterns"), "Artifact privacy checker validates signing/App Store secret ignore patterns");
  assert(artifactPrivacy.includes("Release manifest excludes private env file"), "Artifact privacy checker verifies private env files stay out of release manifest");
  assert(artifactPrivacy.includes("Submission handoff excludes private env file"), "Artifact privacy checker verifies private env files stay out of submission handoff");
  assert(artifactPrivacy.includes("\\/Users\\/"), "Artifact privacy checker scans for real local home paths");
  assert(artifactPrivacy.includes("Desktop") && artifactPrivacy.includes("Takeout"), "Artifact privacy checker scans for developer Desktop music/Takeout paths");
  assert(artifactPrivacy.includes("y2mate"), "Artifact privacy checker scans for downloader-site references");
  assert(artifactPrivacy.includes("\\/var\\/folders\\/"), "Artifact privacy checker scans for temporary macOS capture paths");
  assert(readText("scripts/check-store-copy.cjs").includes("Generated description matches listing source"), "Store copy checker compares generated fields to listing source");
  assert(readText("scripts/check-store-copy.cjs").includes("does not download music"), "Store copy checker verifies no-download wording");
  assert(readText("scripts/check-store-urls.cjs").includes("Cody Cartridge"), "Store public URL checker verifies Cody Cartridge page content");
  assert(readText("scripts/check-store-urls.cjs").includes("loadStoreEnv(projectRoot)"), "Store public URL checker loads store env file");
  assert(readText("scripts/check-packaging-toolchain.cjs").includes("app-builder-lib/out/targets/blockmap/blockmap.js"), "Packaging toolchain checker verifies app-builder-lib blockmap loading");
  assert(readText("scripts/check-packaging-toolchain.cjs").includes("@noble/hashes"), "Packaging toolchain checker verifies the @noble/hashes override");
  assert(readText("scripts/check-mas-package.cjs").includes("app.asar"), "MAS package boundary checker verifies packaged app.asar");
  assert(readText("scripts/check-mas-package.cjs").includes("codesign"), "MAS package boundary checker verifies code signature state");
  assert(readText("scripts/check-mas-package.cjs").includes("embedded.provisionprofile"), "MAS package boundary checker verifies embedded provisioning profile");
  assert(readText("scripts/check-mas-package.cjs").includes("pkgutil"), "MAS package boundary checker verifies upload package");
  assert(readText("scripts/check-mas-package.cjs").includes("packageMatchesCurrentApp"), "MAS package boundary checker matches upload packages against current package version/build");
  assert(
    readText("scripts/check-mas-package.cjs").includes("No signed current-version MAS upload .pkg artifact found"),
    "MAS package boundary checker fails strict mode without a signed current-version upload package"
  );
  assert(readText("scripts/check-upload-tooling.cjs").includes("iTMSTransporter"), "Upload tooling checker verifies Transporter command-line availability");
  assert(readText("scripts/check-upload-tooling.cjs").includes("pkgutil"), "Upload tooling checker verifies MAS upload package signatures");
  assert(readText("scripts/check-upload-tooling.cjs").includes("MAS upload package signature verifies"), "Upload tooling checker reports signed upload packages");
  assert(readText("scripts/check-upload-tooling.cjs").includes("No signed MAS .pkg upload artifact found"), "Upload tooling checker fails strict mode when no signed MAS package is present");
  assert(readText("scripts/check-upload-tooling.cjs").includes("packageMatchesCurrentApp"), "Upload tooling checker matches MAS packages against current package version/build");
  assert(readText("scripts/check-upload-tooling.cjs").includes("No signed current-version MAS .pkg upload artifact found"), "Upload tooling checker fails strict mode without a signed current-version package");
  assert(
    readText("scripts/check-upload-tooling.cjs").includes("No MAS .pkg upload artifact found") &&
      readText("scripts/check-upload-tooling.cjs").includes("before upload\", true"),
    "Upload tooling checker fails strict mode when MAS upload package is missing"
  );
  assert(readText("scripts/check-upload-credentials.cjs").includes("ASC_KEY_ID"), "Upload credential checker reads ASC key id env");
  assert(readText("scripts/check-upload-credentials.cjs").includes("ASC_ISSUER_ID"), "Upload credential checker reads ASC issuer id env");
  assert(readText("scripts/check-upload-credentials.cjs").includes("ASC_PRIVATE_KEY_PATH"), "Upload credential checker reads ASC private key path env");
  assert(readText("scripts/check-upload-credentials.cjs").includes(".appstoreconnect"), "Upload credential checker supports the default App Store Connect private key directory");
  assert(readText("scripts/check-upload-credentials.cjs").includes("isSymbolicLink"), "Upload credential checker rejects private key symlinks");
  assert(readText("scripts/check-upload-credentials.cjs").includes("chmod 600"), "Upload credential checker enforces private key permissions");
  assert(readText("scripts/check-upload-credentials.cjs").includes("must live outside the project"), "Upload credential checker keeps private keys outside the project and handoff archive");
  assert(readText("scripts/install-asc-key.cjs").includes(".appstoreconnect"), "App Store Connect key install helper targets the default private key directory");
  assert(readText("scripts/install-asc-key.cjs").includes("--dry-run"), "App Store Connect key install helper supports dry-run validation");
  assert(readText("scripts/install-asc-key.cjs").includes("fs.chmodSync(destinationPath, 0o600)"), "App Store Connect key install helper writes private key files with private permissions");
  assert(readText("scripts/install-asc-key.cjs").includes("isInsideProject"), "App Store Connect key install helper rejects project-local key files");
  assert(readText("scripts/install-asc-key.cjs").includes("validateInstallDirectory"), "App Store Connect key install helper validates the install directory");
  assert(readText("scripts/install-asc-key.cjs").includes("validateDestinationFile"), "App Store Connect key install helper validates the destination file before copy");
  assert(
    readText("scripts/install-asc-key.cjs").includes("directory must not be a symlink") &&
      readText("scripts/install-asc-key.cjs").includes("destination must not be a symlink"),
    "App Store Connect key install helper rejects symlinked key destinations"
  );
  assert(readText("scripts/check-mas-signing.cjs").includes("isMacPlatformProfile"), "MAS signing checker requires macOS provisioning profiles");
  assert(
    readText("scripts/check-mas-signing.cjs").includes("Provisioning profile directory must not be a symlink") &&
      readText("scripts/check-mas-signing.cjs").includes("Provisioning profile file must not be a symlink"),
    "MAS signing checker rejects symlinked provisioning profile storage"
  );
  assert(
    readText("scripts/check-mas-package.cjs").includes("checkElectronFrameworkSymlinks"),
    "MAS package checker validates Electron Framework symlink layout"
  );
  assert(
    readText("scripts/check-mas-package.cjs").includes("symlink target is relative"),
    "MAS package checker rejects absolute Electron Framework symlink targets"
  );
  assert(readText("scripts/check-store-env.cjs").includes("loadStoreEnv(projectRoot)"), "Store env preflight loads store env file");
  assert(readText("scripts/check-store-env.cjs").includes("isHttpsOrigin"), "Store env preflight requires CODY_SITE_URL to be an HTTPS origin");
  assert(readText("scripts/check-store-env.cjs").includes("isStoreEnvPlaceholder"), "Store env preflight reuses centralized placeholder detection");
  assert(readText("scripts/check-store-env.cjs").includes("npm run init:store-env"), "Store env preflight points missing-env users at the initializer");
  assert(readText("scripts/check-store-env.cjs").includes("lstatSync"), "Store env preflight rejects symlinked env files");
  assert(readText("scripts/check-store-env.cjs").includes("chmod 600"), "Store env preflight requires private env file permissions");
  assert(readText("scripts/check-store-site.cjs").includes("loadStoreEnv(projectRoot)"), "Store site checker loads store env file");
  assert(storeVerifierWithBuild.includes("collectPreservedArtifacts"), "Store verifier wrapper collects preservable MAS artifacts");
  assert(storeVerifierWithBuild.includes("snapshotArtifacts"), "Store verifier wrapper snapshots MAS artifacts before renderer build");
  assert(storeVerifierWithBuild.includes("restoreArtifacts"), "Store verifier wrapper restores MAS artifacts after renderer build");
  assert(storeVerifierWithBuild.includes("verbatimSymlinks: true"), "Store verifier wrapper preserves MAS artifact symlink targets verbatim");
  assert(storeVerifierWithBuild.includes("preserveTimestamps: true"), "Store verifier wrapper preserves MAS artifact timestamps");
  assert(storeVerifierWithBuild.includes("npm") && storeVerifierWithBuild.includes("build"), "Store verifier wrapper runs production build");
  assert(
    storeVerifierWithBuild.includes("scripts/verify-store-readiness.cjs"),
    "Store verifier wrapper delegates to normal readiness verifier"
  );
  assert(readText("scripts/verify-store-readiness.cjs").includes("runNestedCheck"), "Strict verifier aggregates nested gate failures");
  assert(copyMapGenerator.includes("APP_STORE_CONNECT_COPY_MAP.json"), "App Store Connect copy map generator writes JSON output");
  assert(copyMapGenerator.includes("APP_STORE_CONNECT_COPY_MAP.md"), "App Store Connect copy map generator writes markdown output");
  assert(copyMapGenerator.includes("Product Page") && copyMapGenerator.includes("App Review"), "App Store Connect copy map generator covers product and review screens");
  assert(copyMapGenerator.includes("buildSubmissionWorkflow") && copyMapGenerator.includes("Submit For Review"), "App Store Connect copy map generator builds submission workflow");
  assert(copyMapGenerator.includes("displayValue"), "App Store Connect copy map generator redacts placeholder display values");
  assert(copyMapChecker.includes("--strict"), "App Store Connect copy map checker supports strict mode");
  assert(copyMapChecker.includes("Copy map blocker count is accurate"), "App Store Connect copy map checker validates blocker counts");
  assert(copyMapChecker.includes("Copy map workflow includes seven App Store Connect steps"), "App Store Connect copy map checker validates submission workflow");
  assert(copyMapChecker.includes("Copy map excludes raw public/contact placeholder tokens"), "App Store Connect copy map checker validates placeholder redaction");
  assert(reviewBriefGenerator.includes("APP_REVIEW_BRIEF.json"), "App Review brief generator writes JSON output");
  assert(reviewBriefGenerator.includes("APP_REVIEW_BRIEF.md"), "App Review brief generator writes markdown output");
  assert(reviewBriefGenerator.includes("security-scoped bookmark"), "App Review brief generator includes sandbox bookmark disclosure");
  assert(reviewBriefGenerator.includes("contactState"), "App Review brief generator emits contact readiness states");
  assert(reviewBriefGenerator.includes("publicLinkState"), "App Review brief generator emits public link readiness states");
  assert(reviewBriefChecker.includes("--strict"), "App Review brief checker supports strict mode");
  assert(reviewBriefChecker.includes("Review brief blocker count is accurate"), "App Review brief checker validates blocker counts");
  assert(reviewBriefChecker.includes("Review brief excludes raw public/contact placeholder tokens"), "App Review brief checker validates placeholder redaction");
  assert(releaseResolutionPlanGenerator.includes("RELEASE_RESOLUTION_PLAN.json"), "Release resolution plan generator writes JSON output");
  assert(releaseResolutionPlanGenerator.includes("RELEASE_RESOLUTION_PLAN.md"), "Release resolution plan generator writes markdown output");
  assert(releaseResolutionPlanGenerator.includes("prepare-public-inputs"), "Release resolution plan generator includes public input phase");
  assert(releaseResolutionPlanGenerator.includes("configure:store-env -- --dry-run"), "Release resolution plan generator validates public env values before writing");
  assert(releaseResolutionPlanGenerator.includes("configure:store-env -- --site-url"), "Release resolution plan generator writes private public-env overlay");
  assert(releaseResolutionPlanGenerator.includes("signed current-version dist/**/*.pkg"), "Release resolution plan requires a signed current-version MAS upload package");
  assert(
    releaseResolutionPlanChecker.includes("Resolution plan validates public env values before writing private overlay"),
    "Release resolution plan checker validates public-env write order"
  );
  assert(releaseResolutionPlanGenerator.includes("sign-and-package"), "Release resolution plan generator includes signing/package phase");
  assert(releaseResolutionPlanChecker.includes("Resolution plan blocker count matches blocker report"), "Release resolution plan checker validates blocker count");
  assert(releaseResolutionPlanChecker.includes("Resolution plan checks signing before packaging"), "Release resolution plan checker validates signing/package order");
  assert((releaseResolutionPlan.releaseMachineCommands ?? []).includes("npm run upload-packet:store"), "Release resolution plan includes upload command packet generation");
  assert(
    (releaseResolutionPlan.releaseMachineCommands ?? []).includes(
      "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run"
    ),
    "Release resolution plan includes App Store Connect key install dry-run"
  );
  assert((releaseResolutionPlan.releaseMachineCommands ?? []).includes("npm run check:upload-credentials -- --strict"), "Release resolution plan includes upload credential preflight");
  assert(
    includesInOrder((releaseResolutionPlan.releaseMachineCommands ?? []).join("\n"), "npm run check:upload-tooling -- --strict", "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") &&
      includesInOrder((releaseResolutionPlan.releaseMachineCommands ?? []).join("\n"), "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run", "npm run check:upload-credentials -- --strict") &&
      includesInOrder((releaseResolutionPlan.releaseMachineCommands ?? []).join("\n"), "npm run check:upload-credentials -- --strict", "npm run upload-packet:store") &&
      includesInOrder((releaseResolutionPlan.releaseMachineCommands ?? []).join("\n"), "npm run upload-packet:store", "npm run upload-evidence:store"),
    "Release resolution plan orders ASC key validation and upload credential preflight before upload packet and upload evidence"
  );
  assert(releaseBlockerGenerator.includes("check-public-release-sync.cjs"), "Release blocker report generator runs public release sync checker");
  assert(releaseBlockerGenerator.includes("public-release-sync-strict"), "Release blocker report generator emits strict public release sync gate");
  assert(finalSubmissionChecklistGenerator.includes("FINAL_SUBMISSION_CHECKLIST.json"), "Final submission checklist generator writes JSON output");
  assert(finalSubmissionChecklistGenerator.includes("FINAL_SUBMISSION_CHECKLIST.md"), "Final submission checklist generator writes markdown output");
  assert(finalSubmissionChecklistGenerator.includes("public-release-sync"), "Final submission checklist generator includes public release sync gate");
  assert(finalSubmissionChecklistGenerator.includes("mas-signing-strict"), "Final submission checklist generator includes strict MAS signing gate");
  assert(finalSubmissionChecklistGenerator.includes("mas-package-strict"), "Final submission checklist generator includes strict MAS package gate");
  assert(finalSubmissionChecklistGenerator.includes("upload-credentials-strict"), "Final submission checklist generator includes strict upload credential gate");
  assert(finalSubmissionChecklistGenerator.includes("submit-for-review"), "Final submission checklist generator includes Submit for Review section");
  assert(finalSubmissionChecklistChecker.includes("Final submission checklist blocker count is accurate"), "Final submission checklist checker validates blocker count");
  assert(finalSubmissionChecklistChecker.includes("public-release-sync"), "Final submission checklist checker validates public release sync gate");
  assert(finalSubmissionChecklistGenerator.includes("SIGNING_ASSET_REPORT.json"), "Final submission checklist generator includes signing asset report source");
  assert(finalSubmissionChecklistChecker.includes("signing-asset-report-current"), "Final submission checklist checker validates signing asset report row");
  assert(finalSubmissionChecklistChecker.includes("mas-signing-assets"), "Final submission checklist checker validates MAS signing checklist row");
  assert(finalSubmissionChecklistChecker.includes("mas-package-verified"), "Final submission checklist checker validates MAS package checklist row");
  assert(finalSubmissionChecklistChecker.includes("upload-credentials"), "Final submission checklist checker validates upload credential checklist row");
  assert(!finalSubmissionChecklistChecker.includes("mas-runtime-smoke"), "Final submission checklist checker omits local-only packaged MAS runtime smoke row");
  assert(finalSubmissionChecklistChecker.includes("Final submission checklist includes ${id} section"), "Final submission checklist checker validates required sections");
  assert(releaseMachineReport.app?.bundleId === fields.app?.bundleId, "Release machine report bundle id matches App Store fields");
  assert(releaseMachineReport.summary?.releaseBlockers === releaseBlockers.summary?.blockerCount, "Release machine report blocker count matches blocker report");
  assert(releaseMachineReport.summary?.gateCount === 13, "Release machine report records expected gate count");
  assert(
    releaseMachineReport.gates?.some((gate) => gate.id === "public-release-self-test" && gate.status === "pass"),
    "Release machine report includes passing public-release self-test gate"
  );
  assert(
    releaseMachineReport.sourceArtifacts?.includes("app-store-assets/UPLOAD_COMMAND_PACKET.json"),
    "Release machine report records upload command packet source artifact"
  );
  assert(
    releaseMachineReport.sourceArtifacts?.includes("scripts/refresh-public-release.cjs"),
    "Release machine report records public release refresh helper source artifact"
  );
  assert(
    releaseMachineReport.sourceArtifacts?.includes("scripts/install-asc-key.cjs"),
    "Release machine report records App Store Connect key install helper source artifact"
  );
  assert(
    releaseMachineReport.sourceArtifacts?.includes("scripts/check-upload-credentials.cjs"),
    "Release machine report records upload credential checker source artifact"
  );
  assert(
    releaseMachineReport.gates?.some((gate) => gate.id === "published-site"),
    "Release machine report includes published-site gate"
  );
  assert(
    releaseMachineReport.gates?.some((gate) => gate.id === "upload-credentials"),
    "Release machine report includes upload credential gate"
  );
  assert(
    !releaseMachineReport.gates?.some((gate) => gate.id === "mas-runtime"),
    "Release machine report omits local-only packaged MAS runtime smoke gate"
  );
  assert(releaseMachineReport.strictEquivalentCommand === "npm run check:release-machine -- --strict", "Release machine report records strict equivalent command");
  assert(releaseMachineReport.redaction?.storesRawContactValues === false, "Release machine report records raw-contact redaction posture");
  assert(releaseMachineReport.redaction?.storesSigningSecrets === false, "Release machine report records signing-secret redaction posture");
  assert(releaseMachineReportMarkdown.includes("# Cody Cartridge Release Machine Report"), "Release machine report markdown includes title");
  assert(releaseMachineReportMarkdown.includes("## Gates"), "Release machine report markdown includes gate table");
  assert(releaseMachineReportGenerator.includes("RELEASE_MACHINE_REPORT.json"), "Release machine report generator writes JSON output");
  assert(releaseMachineReportGenerator.includes("RELEASE_MACHINE_REPORT.md"), "Release machine report generator writes markdown output");
  assert(releaseMachineReportGenerator.includes("strictEquivalentCommand"), "Release machine report generator records strict equivalent command");
  assert(releaseMachineReportGenerator.includes("sanitizeText"), "Release machine report generator redacts captured check output");
  assert(
    releaseMachineReportGenerator.includes("check-store-env.cjs") &&
	      releaseMachineReportGenerator.includes("refresh-public-release.cjs") &&
	      releaseMachineReportGenerator.includes("check-mas-signing.cjs") &&
	      releaseMachineReportGenerator.includes("check-upload-tooling.cjs") &&
	      releaseMachineReportGenerator.includes("check-upload-credentials.cjs") &&
	      releaseMachineReportGenerator.includes("check-public-site-published.cjs"),
    "Release machine report generator covers public env, signing, and upload gates"
  );
  assert(
    releaseMachineReportChecker.includes("Release machine report blocker count matches blocker report"),
    "Release machine report checker validates blocker count"
  );
  assert(
    releaseMachineReportChecker.includes("Release machine report redacts public-site placeholder token"),
    "Release machine report checker validates placeholder redaction"
  );
  assert(releaseDashboardGenerator.includes("RELEASE_DASHBOARD.json"), "Release dashboard generator writes JSON output");
  assert(releaseDashboardGenerator.includes("RELEASE_DASHBOARD.html"), "Release dashboard generator writes HTML output");
  assert(releaseDashboardGenerator.includes("Next release-machine move"), "Release dashboard generator renders next-action section");
  assert(releaseDashboardGenerator.includes("masSubmission"), "Release dashboard generator carries MAS submission posture");
  assert(releaseDashboardGenerator.includes("RELEASE_MACHINE_REPORT.json"), "Release dashboard generator reads release machine report");
  assert(releaseDashboardGenerator.includes("nextActionFromBlockers"), "Release dashboard generator sources next action from blocker queue");
  assert(releaseDashboardChecker.includes("Release dashboard blocker count matches blocker report"), "Release dashboard checker validates blocker count");
  assert(releaseDashboardChecker.includes("Release dashboard MAS mode matches release evidence"), "Release dashboard checker validates MAS posture");
  assert(
    releaseDashboardChecker.includes("Release dashboard next command matches blocker queue"),
    "Release dashboard checker validates blocker-queue next command"
  );
  assert(
    releaseDashboardChecker.includes("Release dashboard public-input action uses validated store env configurator"),
    "Release dashboard checker validates public-input next action"
  );
  assert(
    releaseDashboardChecker.includes("Release dashboard machine-report blocked gate count matches source"),
    "Release dashboard checker validates machine-report counts"
  );
  assert(releaseOperatorQueueGenerator.includes("RELEASE_OPERATOR_QUEUE.json"), "Release operator queue generator writes JSON output");
  assert(releaseOperatorQueueGenerator.includes("RELEASE_OPERATOR_QUEUE.md"), "Release operator queue generator writes markdown output");
  assert(releaseOperatorQueueGenerator.includes("Immediate Action"), "Release operator queue generator renders immediate action section");
  assert(releaseOperatorQueueGenerator.includes("validateCommand") && releaseOperatorQueueGenerator.includes("applyCommand"), "Release operator queue generator renders separate validate/apply commands");
  assert(releaseOperatorQueueGenerator.includes("masSubmission"), "Release operator queue generator carries MAS submission posture");
  assert(releaseOperatorQueueGenerator.includes("blockerQueueAction"), "Release operator queue generator carries blocker queue action");
  assert(releaseOperatorQueueChecker.includes("Release operator queue blocker count matches blocker report"), "Release operator queue checker validates blocker count");
  assert(
    releaseOperatorQueueChecker.includes("Release operator queue records blocker queue command"),
    "Release operator queue checker validates blocker-queue command"
  );
  assert(
    releaseOperatorQueueChecker.includes("Release operator queue public-input action uses validated store env configurator"),
    "Release operator queue checker validates public-input next action"
  );
  assert(releaseOperatorQueueChecker.includes("Release operator queue MAS mode matches dashboard"), "Release operator queue checker validates MAS posture");
  assert(signingRunbookGenerator.includes("SIGNING_UPLOAD_RUNBOOK.json"), "Signing/upload runbook generator writes JSON output");
  assert(signingRunbookGenerator.includes("SIGNING_UPLOAD_RUNBOOK.md"), "Signing/upload runbook generator writes markdown output");
  assert(signingRunbookGenerator.includes("Mac Installer Distribution"), "Signing/upload runbook generator documents installer identity requirement");
  assert(signingRunbookGenerator.includes("signingRemediationChecklist"), "Signing/upload runbook generator writes signing remediation checklist");
  assert(signingRunbookGenerator.includes("get-task-allow=false"), "Signing/upload runbook generator documents distribution profile posture");
  assert(signingAssetReportGenerator.includes("SIGNING_ASSET_REPORT.json"), "Signing asset report generator writes JSON output");
  assert(signingAssetReportGenerator.includes("SIGNING_ASSET_REPORT.md"), "Signing asset report generator writes markdown output");
  assert(signingAssetReportGenerator.includes("storesIdentityNames"), "Signing asset report generator records identity-name redaction");
  assert(signingAssetReportGenerator.includes("storageIssueCount"), "Signing asset report generator records provisioning profile storage issue count");
  assert(signingAssetReportChecker.includes("Signing asset report bundle id matches package config"), "Signing asset report checker validates package metadata");
  assert(signingAssetReportChecker.includes("Signing asset report blocks symlinked provisioning profile storage"), "Signing asset report checker validates provisioning profile storage issues");
  assert(signingAssetReportChecker.includes("Signing asset report excludes certificate/profile secret material"), "Signing asset report checker validates secret exclusion");
  assert(signingRunbookChecker.includes("Runbook bundle id matches package config"), "Signing/upload runbook checker validates package metadata");
  assert(signingRunbookGenerator.includes("signingAssetSnapshot"), "Signing/upload runbook generator includes signing asset snapshot");
  assert(
    signingRunbookChecker.includes("Runbook signing asset snapshot status matches report"),
    "Signing/upload runbook checker validates signing asset snapshot"
  );
  assert(signingRunbookChecker.includes("Runbook remediation includes application identity step"), "Signing/upload runbook checker validates signing remediation steps");
  assert(signingRunbookChecker.includes("Runbook checks signing before MAS packaging"), "Signing/upload runbook checker validates command order");
  assert(gitignore.includes("app-store-assets/site.env"), "Local store env file is ignored");
  assert(gitignore.includes("app-store-assets/upload-logs/raw/"), "Raw upload delivery log directory is ignored");
  assert(gitignore.includes("*.p8"), "App Store Connect API key files are ignored");
	  assert(siteEnvExample.includes("CODY_REVIEW_CONTACT_NAME"), "Store env example includes App Review contact name");
	  assert(siteEnvExample.includes("CODY_REVIEW_CONTACT_EMAIL"), "Store env example includes App Review contact email");
	  assert(siteEnvExample.includes("CODY_REVIEW_CONTACT_PHONE"), "Store env example includes App Review contact phone");
  assert(siteEnvExample.includes("npm run init:store-env"), "Store env example documents the initializer command");
  assert(pkg.scripts?.["init:store-env"] === "node scripts/init-store-env.cjs", "Store env initializer script is wired");
  assert(pkg.scripts?.["copy-map:store"]?.includes("scripts/build-app-store-copy-map.cjs"), "App Store Connect copy map generator script is wired");
  assert(pkg.scripts?.["copy-map:store"]?.includes("scripts/check-app-store-copy-map.cjs"), "App Store Connect copy map checker runs after generation");
  assert(pkg.scripts?.["check:copy-map"] === "node scripts/check-app-store-copy-map.cjs", "App Store Connect copy map standalone checker script is wired");
  assert(pkg.scripts?.["review-brief:store"]?.includes("scripts/build-app-review-brief.cjs"), "App Review brief generator script is wired");
  assert(pkg.scripts?.["review-brief:store"]?.includes("scripts/check-app-review-brief.cjs"), "App Review brief checker runs after generation");
  assert(pkg.scripts?.["check:review-brief"] === "node scripts/check-app-review-brief.cjs", "App Review brief standalone checker script is wired");
  assert(pkg.scripts?.["public-inputs:store"]?.includes("scripts/build-public-release-inputs.cjs"), "Public release inputs generator script is wired");
  assert(pkg.scripts?.["public-inputs:store"]?.includes("scripts/check-public-release-inputs.cjs"), "Public release inputs checker runs after generation");
  assert(pkg.scripts?.["check:public-inputs"] === "node scripts/check-public-release-inputs.cjs", "Public release inputs standalone checker script is wired");
  assert(pkg.scripts?.["publish-packet:store"]?.includes("scripts/build-public-site-publish-packet.cjs"), "Public site publish packet generator script is wired");
  assert(pkg.scripts?.["publish-packet:store"]?.includes("scripts/check-public-site-publish-packet.cjs"), "Public site publish packet checker runs after generation");
  assert(pkg.scripts?.["check:publish-packet"] === "node scripts/check-public-site-publish-packet.cjs", "Public site publish packet standalone checker script is wired");
  assert(pkg.scripts?.["check:published-site"] === "node scripts/check-public-site-published.cjs", "Published public site standalone checker script is wired");
  assert(pkg.scripts?.["check:public-release-sync"] === "node scripts/check-public-release-sync.cjs", "Public release sync standalone checker script is wired");
  assert(pkg.scripts?.["resolution-plan:store"]?.includes("scripts/build-release-resolution-plan.cjs"), "Release resolution plan generator script is wired");
  assert(pkg.scripts?.["resolution-plan:store"]?.includes("scripts/check-release-resolution-plan.cjs"), "Release resolution plan checker runs after generation");
  assert(pkg.scripts?.["check:resolution-plan"] === "node scripts/check-release-resolution-plan.cjs", "Release resolution plan standalone checker script is wired");
  assert(pkg.scripts?.["submission-checklist:store"]?.includes("scripts/build-final-submission-checklist.cjs"), "Final submission checklist generator script is wired");
  assert(pkg.scripts?.["submission-checklist:store"]?.includes("scripts/check-final-submission-checklist.cjs"), "Final submission checklist checker runs after generation");
  assert(pkg.scripts?.["check:submission-checklist"] === "node scripts/check-final-submission-checklist.cjs", "Final submission checklist standalone checker script is wired");
  assert(pkg.scripts?.["dashboard:store"]?.includes("scripts/build-release-dashboard.cjs"), "Release dashboard generator script is wired");
  assert(pkg.scripts?.["dashboard:store"]?.includes("scripts/check-release-dashboard.cjs"), "Release dashboard checker runs after generation");
  assert(pkg.scripts?.["check:dashboard"] === "node scripts/check-release-dashboard.cjs", "Release dashboard standalone checker script is wired");
  assert(pkg.scripts?.["operator:store"]?.includes("scripts/build-release-operator-queue.cjs"), "Release operator queue generator script is wired");
  assert(pkg.scripts?.["operator:store"]?.includes("scripts/check-release-operator-queue.cjs"), "Release operator queue checker runs after generation");
  assert(pkg.scripts?.["check:operator"] === "node scripts/check-release-operator-queue.cjs", "Release operator queue standalone checker script is wired");
  assert(pkg.scripts?.["machine-report:store"]?.includes("scripts/build-release-machine-report.cjs"), "Release machine report generator script is wired");
  assert(pkg.scripts?.["machine-report:store"]?.includes("scripts/check-release-machine-report.cjs"), "Release machine report checker runs after generation");
  assert(pkg.scripts?.["check:machine-report"] === "node scripts/check-release-machine-report.cjs", "Release machine report standalone checker script is wired");
  assert(pkg.scripts?.["signing-runbook:store"]?.includes("scripts/build-signing-upload-runbook.cjs"), "Signing/upload runbook generator script is wired");
  assert(pkg.scripts?.["signing-runbook:store"]?.includes("scripts/check-signing-upload-runbook.cjs"), "Signing/upload runbook checker runs after generation");
  assert(pkg.scripts?.["check:signing-runbook"] === "node scripts/check-signing-upload-runbook.cjs", "Signing/upload runbook standalone checker script is wired");
  assert(pkg.scripts?.["signing-assets:store"]?.includes("scripts/build-signing-asset-report.cjs"), "Signing asset report generator script is wired");
  assert(pkg.scripts?.["signing-assets:store"]?.includes("scripts/check-signing-asset-report.cjs"), "Signing asset report checker runs after generation");
  assert(pkg.scripts?.["check:signing-assets"] === "node scripts/check-signing-asset-report.cjs", "Signing asset report standalone checker script is wired");
  assert(pkg.scripts?.["install:mas-profile"] === "node scripts/install-mas-profile.cjs", "MAS profile installer script is wired");
  assert(pkg.scripts?.["install:asc-key"] === "node scripts/install-asc-key.cjs", "App Store Connect key installer script is wired");
  assert(masProfileInstaller.includes("security") && masProfileInstaller.includes("cms"), "MAS profile installer decodes signed provisioning profiles");
  assert(masProfileInstaller.includes("plutil"), "MAS profile installer parses decoded plist payloads");
  assert(masProfileInstaller.includes("isSymbolicLink"), "MAS profile installer rejects symlinked profile paths");
  assert(masProfileInstaller.includes("isInsideProject"), "MAS profile installer rejects project-local profile sources");
  assert(masProfileInstaller.includes("must live outside the project and handoff archive"), "MAS profile installer documents profile source boundary");
  assert(masProfileInstaller.includes("validateInstallDirectory"), "MAS profile installer validates the install directory");
  assert(masProfileInstaller.includes("validateDestinationFile"), "MAS profile installer validates the destination file before copy");
  assert(
    masProfileInstaller.includes("install directory must not be a symlink") &&
      masProfileInstaller.includes("destination must not be a symlink"),
    "MAS profile installer rejects symlinked profile install destinations"
  );
  assert(masProfileInstaller.includes("--dry-run"), "MAS profile installer supports dry-run validation");
  assert(masProfileInstaller.includes("0o600"), "MAS profile installer writes installed profiles with private permissions");
  assert(masProfileInstaller.includes("get-task-allow"), "MAS profile installer rejects development-style profiles");
  assert(ascKeyInstaller.includes(".appstoreconnect"), "App Store Connect key installer targets the default private key directory");
  assert(ascKeyInstaller.includes("--dry-run"), "App Store Connect key installer supports dry-run validation");
  assert(ascKeyInstaller.includes("fs.chmodSync(destinationPath, 0o600)"), "App Store Connect key installer writes installed keys with private permissions");
  assert(ascKeyInstaller.includes("isInsideProject"), "App Store Connect key installer rejects project-local key files");
  assert(masProfileInstaller.includes("ProvisionedDevices"), "MAS profile installer rejects device-provisioned profiles");
  assert(masProfileInstaller.includes("com.apple.security.app-sandbox"), "MAS profile installer checks sandbox entitlement");
  assert(masProfileInstaller.includes("com.apple.security.files.user-selected.read-only"), "MAS profile installer checks file import entitlement");
  assert(masProfileInstaller.includes("com.apple.security.files.bookmarks.app-scope"), "MAS profile installer checks bookmark entitlement");
  assert(masProfileInstaller.includes("check:mas-signing -- --strict"), "MAS profile installer points operators to strict signing check");
  assert(pkg.scripts?.["handoff:store"]?.includes("scripts/build-submission-handoff.cjs"), "Submission handoff generator script is wired");
  assert(pkg.scripts?.["handoff:store"]?.includes("scripts/check-submission-handoff.cjs"), "Submission handoff checker runs after generation");
  assert(pkg.scripts?.["check:handoff"] === "node scripts/check-submission-handoff.cjs", "Submission handoff standalone checker script is wired");
  assert(pkg.scripts?.["release:node"] === "node scripts/run-release-node.cjs", "Release-node wrapper script is wired");
  assert(pkg.scripts?.["check:release-runtime:node"] === "node scripts/run-release-node.cjs npm run check:release-runtime --", "Node-safe release runtime checker script is wired");
  assert(pkg.scripts?.["check:release-machine:node"] === "node scripts/run-release-node.cjs npm run check:release-machine --", "Node-safe release machine doctor script is wired");
  assert(pkg.scripts?.["release:store:local:node"] === "node scripts/run-release-node.cjs npm run release:store:local --", "Node-safe local release dry-run script is wired");
  assert(pkg.scripts?.["release:store:preflight:node"] === "node scripts/run-release-node.cjs npm run release:store:preflight --", "Node-safe release preflight script is wired");
  [
    "check:release-runtime:node",
    "check:release-machine:node",
    "public-release:store:node",
    "public-release:store:published:node",
    "verify:store:strict:node",
    "release:store:local:node",
    "release:store:preflight:node"
  ].forEach((scriptName) => {
    assert(
      pkg.scripts?.[scriptName]?.endsWith(" --"),
      `${scriptName} preserves arguments passed after npm's -- separator`
    );
  });
  assert(releaseNodeRunner.includes(".nvmrc"), "Release-node wrapper reads the repo release Node version");
  assert(releaseNodeRunner.includes("nvm exec"), "Release-node wrapper runs commands through nvm exec");
  assert(releaseNodeRunner.includes("does not mutate") || releaseNodeRunner.includes("without changing"), "Release-node wrapper documents non-mutating nvm behavior");
  assert(pkg.scripts?.["release:store:preflight"]?.startsWith("npm run check:store-env"), "Release preflight starts with store env validation");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:icons"), "Release preflight checks icon assets");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:electron-security"), "Release preflight runs Electron security check");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:release-runtime -- --strict"), "Release preflight runs strict release runtime check");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run public-release:store -- --self-test"), "Release preflight runs public release wrapper self-test");
  assert(pkg.scripts?.["public-release:store:node"]?.includes("scripts/run-release-node.cjs"), "Node-safe public release refresh uses release-node wrapper");
  assert(pkg.scripts?.["public-release:store:published:node"]?.includes("scripts/run-release-node.cjs"), "Node-safe published public release refresh uses release-node wrapper");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:packaging-toolchain"), "Release preflight runs packaging toolchain check");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:help-docs"), "Release preflight runs Help document check");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run notices:store"), "Release preflight generates third-party notices");
  assert(pkg.scripts?.["site:store"]?.includes("npm run notices:store"), "Static site generation refreshes third-party notices");
  assert(pkg.scripts?.["site:store"]?.includes("npm run check:site"), "Static site generation runs site validation");
  assert(pkg.scripts?.["site:archive"]?.includes("npm run check:site-archive"), "Public site archive generation runs archive validation");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:site -- --strict"), "Release preflight runs strict site validation");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:site-archive -- --strict"), "Release preflight runs strict public site archive validation");
  assert(pkg.scripts?.["screenshots:store"]?.includes("npm run check:screenshots"), "Screenshot generation runs screenshot quality audit");
  assert(pkg.scripts?.["dist:mas"]?.includes("npm run notices:store"), "MAS packaging refreshes third-party notices");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:icons"), "Local release dry-run checks icon assets");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:electron-security"), "Local release dry-run runs Electron security check");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:release-runtime"), "Local release dry-run records advisory release runtime check");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run public-release:store -- --self-test"), "Local release dry-run runs public release wrapper self-test");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:packaging-toolchain"), "Local release dry-run runs packaging toolchain check");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:help-docs"), "Local release dry-run runs Help document check");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run site:store"), "Local release dry-run generates and checks static site");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run site:archive"), "Local release dry-run generates public site archive");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:store-version:source"), "Local release dry-run checks source App Store version metadata");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:store-version"), "Local release dry-run checks generated App Store version metadata");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run packet:store"), "Local release dry-run generates submission packet");
  assert(pkg.scripts?.["export-compliance:store"]?.includes("scripts/build-export-compliance.cjs"), "Export compliance generator script is wired");
  assert(pkg.scripts?.["export-compliance:store"]?.includes("scripts/check-export-compliance.cjs"), "Export compliance checker runs after generation");
  assert(pkg.scripts?.["check:export-compliance"] === "node scripts/check-export-compliance.cjs", "Export compliance standalone checker script is wired");
  assert(pkg.scripts?.["app-compliance:store"]?.includes("scripts/build-app-store-compliance.cjs"), "App Store compliance generator script is wired");
  assert(pkg.scripts?.["app-compliance:store"]?.includes("scripts/check-app-store-compliance.cjs"), "App Store compliance checker runs after generation");
  assert(pkg.scripts?.["app-compliance:store"]?.includes("npm run manual-tasks:store"), "App Store compliance script refreshes App Store Connect manual tasks");
  assert(pkg.scripts?.["app-compliance:store"]?.includes("npm run content-rights:store"), "App Store compliance script refreshes content-rights audit");
  assert(pkg.scripts?.["check:app-compliance"] === "node scripts/check-app-store-compliance.cjs", "App Store compliance standalone checker script is wired");
  assert(pkg.scripts?.["manual-tasks:store"]?.includes("scripts/build-app-store-connect-manual-tasks.cjs"), "App Store Connect manual task generator script is wired");
  assert(pkg.scripts?.["manual-tasks:store"]?.includes("scripts/check-app-store-connect-manual-tasks.cjs"), "App Store Connect manual task checker runs after generation");
  assert(pkg.scripts?.["check:manual-tasks"] === "node scripts/check-app-store-connect-manual-tasks.cjs", "App Store Connect manual task standalone checker script is wired");
  assert(pkg.scripts?.["content-rights:store"]?.includes("scripts/build-app-content-rights.cjs"), "Content-rights audit generator script is wired");
  assert(pkg.scripts?.["content-rights:store"]?.includes("scripts/check-app-content-rights.cjs"), "Content-rights audit checker runs after generation");
  assert(pkg.scripts?.["check:content-rights"] === "node scripts/check-app-content-rights.cjs", "Content-rights audit standalone checker script is wired");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run export-compliance:store"), "Local release dry-run generates export compliance prep");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run app-compliance:store"), "Local release dry-run generates App Store compliance packet");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run copy-map:store"), "Local release dry-run generates App Store Connect copy map");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run review-brief:store"), "Local release dry-run generates App Review brief");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:public-release-sync"), "Local release dry-run runs advisory public release sync");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:app-privacy"), "Local release dry-run checks App privacy after packet generation");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:export-compliance"), "Local release dry-run checks export compliance after packet generation");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:app-compliance"), "Local release dry-run checks App Store compliance packet");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:store-copy"), "Local release dry-run checks App Store copy after packet generation");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:artifact-privacy"), "Local release dry-run checks artifact privacy after packet generation");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run publish-packet:store"), "Local release dry-run builds public site publish packet");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:store-urls"), "Local release dry-run reports advisory public URL reachability state");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:published-site"), "Local release dry-run reports advisory full published-site state");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run smoke:store"), "Local release dry-run runs production store smoke test");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run smoke:a11y"), "Local release dry-run runs accessibility smoke test");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run smoke:electron-shell"), "Local release dry-run runs Electron shell smoke test");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run smoke:clean-profile"), "Local release dry-run runs clean-profile smoke test");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run screenshots:store"), "Local release dry-run regenerates screenshots");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run smoke:mas-dir"), "Local release dry-run runs MAS directory smoke test");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run smoke:mas-runtime"), "Local release dry-run runs packaged MAS runtime smoke test");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:mas-signing"), "Local release dry-run reports advisory MAS signing state");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run signing-assets:store"), "Local release dry-run generates signing asset report");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:mas-package"), "Local release dry-run reports advisory MAS package boundary state");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:upload-tooling"), "Local release dry-run reports advisory App Store upload tooling state");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:upload-credentials"), "Local release dry-run reports advisory App Store upload credential state");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run report:store-blockers"), "Local release dry-run generates release blocker report");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run public-inputs:store"), "Local release dry-run generates public release-input packet");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run publish-packet:store"), "Local release dry-run generates public site publish packet");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run public-host:store"), "Local release dry-run generates public host runbook");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run resolution-plan:store"), "Local release dry-run generates release resolution plan");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run submission-checklist:store"), "Local release dry-run generates final submission checklist");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run machine-report:store"), "Local release dry-run generates release machine report");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run dashboard:store"), "Local release dry-run generates release dashboard");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run operator:store"), "Local release dry-run generates release operator queue");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run signing-runbook:store"), "Local release dry-run generates signing/upload runbook");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run evidence:store"), "Local release dry-run generates release evidence");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run manifest:store"), "Local release dry-run regenerates release manifest");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run handoff:store"), "Local release dry-run builds submission handoff archive");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run verify:store"), "Local release dry-run ends with store verifier");
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:store-version:source", "npm run check:release-runtime"),
    "Local release dry-run checks release runtime after source version"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:release-runtime", "npm run public-release:store -- --self-test") &&
      includesInOrder(pkg.scripts?.["release:store:local"], "npm run public-release:store -- --self-test", "npm run check:icons"),
    "Local release dry-run runs public release self-test before artifact generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run screenshots:store", "npm run packet:store"),
    "Local release dry-run refreshes screenshots before packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run screenshots:store", "npm run smoke:mas-dir"),
    "Local release dry-run runs MAS directory smoke after screenshots"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run smoke:mas-dir", "npm run packet:store"),
    "Local release dry-run runs MAS directory smoke before packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run smoke:mas-dir", "npm run smoke:mas-runtime") &&
      includesInOrder(pkg.scripts?.["release:store:local"], "npm run smoke:mas-runtime", "npm run packet:store"),
    "Local release dry-run smoke-tests packaged MAS runtime after MAS directory build"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run export-compliance:store", "npm run packet:store"),
    "Local release dry-run builds export compliance before packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run packet:store", "npm run app-compliance:store"),
    "Local release dry-run builds App Store compliance packet after packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run app-compliance:store", "npm run review-brief:store"),
    "Local release dry-run builds App Review brief after App Store compliance packet"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run review-brief:store", "npm run copy-map:store"),
    "Local release dry-run builds copy map after App Review brief"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run copy-map:store", "npm run check:public-release-sync"),
    "Local release dry-run checks public release sync after copy map generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:public-release-sync", "npm run check:store-version && npm run check:app-privacy"),
    "Local release dry-run checks generated store version after public release sync"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:app-privacy", "npm run check:export-compliance"),
    "Local release dry-run checks export compliance after App privacy"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:export-compliance", "npm run check:app-compliance"),
    "Local release dry-run checks App Store compliance after export compliance"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:app-compliance", "npm run check:store-copy"),
    "Local release dry-run checks store copy after App Store compliance"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run site:store", "npm run site:archive"),
    "Local release dry-run builds public site archive after site generation"
  );
	  assert(
	    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:packaging-toolchain", "npm run check:mas-package"),
	    "Local release dry-run checks packaging toolchain before MAS package boundary"
	  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run report:store-blockers", "npm run evidence:store"),
    "Local release dry-run records blockers before evidence"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run report:store-blockers", "npm run public-inputs:store"),
    "Local release dry-run builds public release-input packet after blocker report"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run public-inputs:store", "npm run publish-packet:store"),
    "Local release dry-run builds public site publish packet after public-input packet"
  );
  assert(
    (() => {
      const text = String(pkg.scripts?.["release:store:local"] ?? "");
      const afterPublicHost = text.slice(text.indexOf("npm run public-host:store"));

      return (
        includesInOrder(afterPublicHost, "npm run public-host:store", "npm run check:published-site") &&
        includesInOrder(afterPublicHost, "npm run check:published-site", "npm run signing-assets:store") &&
        includesInOrder(afterPublicHost, "npm run signing-assets:store", "npm run upload-packet:store") &&
        includesInOrder(afterPublicHost, "npm run upload-packet:store", "npm run copy-map:store") &&
        includesInOrder(afterPublicHost, "npm run copy-map:store", "npm run apple-assets:store") &&
        includesInOrder(afterPublicHost, "npm run apple-assets:store", "npm run signing-runbook:store")
      );
    })(),
    "Local release dry-run builds Apple release asset packet before signing/upload runbook"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:store-copy", "npm run check:artifact-privacy"),
    "Local release dry-run checks artifact privacy after store copy"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:artifact-privacy", "npm run check:store-urls"),
    "Local release dry-run checks public URLs after artifact privacy"
  );
  assert(
    (() => {
      const text = String(pkg.scripts?.["release:store:local"] ?? "");
      const afterPublishPacket = text.slice(text.indexOf("npm run publish-packet:store"));
      return includesInOrder(afterPublishPacket, "npm run publish-packet:store", "npm run public-host:store") &&
        includesInOrder(afterPublishPacket, "npm run public-host:store", "npm run check:published-site") &&
        includesInOrder(afterPublishPacket, "npm run check:published-site", "npm run signing-assets:store");
    })(),
    "Local release dry-run checks full published site after public host runbook"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:mas-signing", "npm run signing-assets:store") &&
      includesInOrder(pkg.scripts?.["release:store:local"], "npm run signing-assets:store", "npm run check:mas-package"),
    "Local release dry-run records signing asset report between advisory signing and package checks"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run evidence:store", "npm run manifest:store"),
    "Local release dry-run records evidence before manifest"
  );
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:evidence"), "Local release dry-run explicitly checks release evidence");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:manifest"), "Local release dry-run explicitly checks release manifest");
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run evidence:store", "npm run check:evidence") &&
      includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:evidence", "npm run dashboard:store"),
    "Local release dry-run checks evidence before dashboard"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run manifest:store", "npm run check:manifest") &&
      includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:manifest", "npm run handoff:store"),
    "Local release dry-run checks manifest before handoff"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run report:store-blockers", "npm run signing-runbook:store"),
    "Local release dry-run builds signing/upload runbook after blocker report"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run report:store-blockers", "npm run resolution-plan:store"),
    "Local release dry-run builds release resolution plan after blocker report"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run signing-runbook:store", "npm run resolution-plan:store"),
    "Local release dry-run builds release resolution plan after signing/upload runbook"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run resolution-plan:store", "npm run submission-checklist:store"),
    "Local release dry-run builds final submission checklist after release resolution plan"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run submission-checklist:store", "npm run evidence:store"),
    "Local release dry-run records evidence after final submission checklist"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run submission-checklist:store", "npm run machine-report:store") &&
      includesInOrder(pkg.scripts?.["release:store:local"], "npm run machine-report:store", "npm run evidence:store"),
    "Local release dry-run records machine report before evidence"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run submission-checklist:store", "npm run dashboard:store"),
    "Local release dry-run builds dashboard after final submission checklist"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run evidence:store", "npm run dashboard:store"),
    "Local release dry-run builds dashboard after evidence"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run dashboard:store", "npm run manifest:store"),
    "Local release dry-run records dashboard before manifest"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run dashboard:store", "npm run operator:store"),
    "Local release dry-run builds operator queue after dashboard"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run operator:store", "npm run manifest:store"),
    "Local release dry-run records operator queue before manifest"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run signing-runbook:store", "npm run evidence:store"),
    "Local release dry-run records evidence after signing/upload runbook"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run manifest:store", "npm run handoff:store"),
    "Local release dry-run builds handoff after manifest"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run handoff:store", "npm run verify:store"),
    "Local release dry-run verifies readiness after handoff"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run handoff:store", "npm run check:release-machine"),
    "Local release dry-run runs release machine doctor after handoff"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:release-machine", "npm run verify:store"),
    "Local release dry-run runs release machine doctor before verifier"
  );
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run smoke:store"), "Release preflight runs production store smoke test");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run smoke:a11y"), "Release preflight runs accessibility smoke test");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run smoke:electron-shell"), "Release preflight runs Electron shell smoke test");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run smoke:clean-profile"), "Release preflight runs clean-profile smoke test");
  assert(!pkg.scripts?.["release:store:preflight"]?.includes("npm run smoke:mas-runtime"), "Release preflight keeps local-only packaged MAS runtime smoke out of signed upload path");
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:store-env", "npm run check:release-runtime -- --strict"),
    "Release preflight checks release runtime immediately after store env"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:release-runtime -- --strict", "npm run check:store-version:source"),
    "Release preflight checks source version after release runtime"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:store-version:source", "npm run public-release:store -- --self-test") &&
      includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run public-release:store -- --self-test", "npm run check:icons"),
    "Release preflight runs public release self-test before artifact generation"
  );
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:store-version:source"), "Release preflight checks source App Store version metadata");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:store-version"), "Release preflight checks generated App Store version metadata");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run app-compliance:store"), "Release preflight generates App Store compliance packet");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run copy-map:store"), "Release preflight generates App Store Connect copy map");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run review-brief:store"), "Release preflight generates App Review brief");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:copy-map -- --strict"), "Release preflight strictly checks App Store Connect copy map");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:review-brief -- --strict"), "Release preflight strictly checks App Review brief");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:public-release-sync -- --strict"), "Release preflight strictly checks public release sync");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:app-privacy"), "Release preflight checks App privacy");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run export-compliance:store"), "Release preflight generates export compliance prep");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:export-compliance"), "Release preflight checks export compliance");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:app-compliance"), "Release preflight checks App Store compliance packet");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:store-copy"), "Release preflight checks App Store copy");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:artifact-privacy"), "Release preflight checks artifact privacy");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:store-urls -- --strict"), "Release preflight runs strict public URL reachability check");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:published-site -- --strict"), "Release preflight runs strict published-site check");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run signing-assets:store"), "Release preflight generates signing asset report");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:mas-package -- --strict"), "Release preflight runs strict MAS package boundary check");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:upload-tooling -- --strict"), "Release preflight runs strict App Store upload tooling check");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:upload-credentials -- --strict"), "Release preflight runs strict App Store upload credential check");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run upload-packet:store"), "Release preflight generates upload command packet");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run upload-evidence:store"), "Release preflight generates sanitized upload evidence");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:release-machine -- --strict"), "Release preflight runs strict release machine doctor");
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:packaging-toolchain", "npm run dist:mas"),
    "Release preflight checks packaging toolchain before MAS packaging"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:store-urls -- --strict", "npm run signing-assets:store") &&
      includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run signing-assets:store", "npm run check:mas-signing -- --strict"),
    "Release preflight records signing asset report before strict signing"
  );
  assert(
    (() => {
      const text = String(pkg.scripts?.["release:store:preflight"] ?? "");
      const afterPublishPacket = text.slice(text.indexOf("npm run publish-packet:store"));
      return includesInOrder(afterPublishPacket, "npm run publish-packet:store", "npm run public-host:store") &&
        includesInOrder(afterPublishPacket, "npm run public-host:store", "npm run check:published-site -- --strict") &&
        includesInOrder(afterPublishPacket, "npm run check:published-site -- --strict", "npm run signing-assets:store");
    })(),
    "Release preflight checks full published site after public host runbook and before signing assets"
  );
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run report:store-blockers"), "Release preflight generates release blocker report");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run public-inputs:store"), "Release preflight generates public release-input packet");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run publish-packet:store"), "Release preflight generates public site publish packet");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run public-host:store"), "Release preflight generates public host runbook");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run resolution-plan:store"), "Release preflight generates release resolution plan");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run submission-checklist:store"), "Release preflight generates final submission checklist");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run machine-report:store"), "Release preflight generates release machine report");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run dashboard:store"), "Release preflight generates release dashboard");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run operator:store"), "Release preflight generates release operator queue");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run signing-runbook:store"), "Release preflight generates signing/upload runbook");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run evidence:store"), "Release preflight generates release evidence");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:evidence"), "Release preflight explicitly checks release evidence");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run manifest:store"), "Release preflight generates release manifest");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run check:manifest"), "Release preflight explicitly checks release manifest");
  assert(pkg.scripts?.["release:store:preflight"]?.includes("npm run handoff:store"), "Release preflight builds submission handoff archive");
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run dist:mas", "npm run check:mas-package -- --strict"),
    "Release preflight checks MAS package after packaging"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:mas-package -- --strict", "npm run report:store-blockers"),
    "Release preflight reports blockers after MAS package inspection"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:mas-package -- --strict", "npm run check:upload-tooling -- --strict"),
    "Release preflight checks upload tooling after MAS package inspection"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:mas-package -- --strict", "npm run check:upload-tooling -- --strict"),
    "Release preflight checks upload tooling directly after strict MAS package verification"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:upload-tooling -- --strict", "npm run check:upload-credentials -- --strict"),
    "Release preflight checks upload credentials after upload tooling"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:upload-tooling -- --strict", "npm run report:store-blockers"),
    "Release preflight reports blockers after upload tooling inspection"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:upload-credentials -- --strict", "npm run upload-evidence:store") &&
      includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run upload-evidence:store", "npm run report:store-blockers"),
    "Release preflight records upload evidence after upload credentials and before blocker report"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:upload-credentials -- --strict", "npm run upload-packet:store") &&
      includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run upload-packet:store", "npm run upload-evidence:store"),
    "Release preflight records upload command packet after upload credentials and before upload evidence"
  );
	  assert(
	    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run report:store-blockers", "npm run manifest:store"),
	    "Release preflight records blocker report before manifest generation"
	  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run report:store-blockers", "npm run evidence:store"),
    "Release preflight records blocker report before evidence generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run report:store-blockers", "npm run public-inputs:store"),
    "Release preflight builds public release-input packet after blocker report"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run public-inputs:store", "npm run publish-packet:store"),
    "Release preflight builds public site publish packet after public-input packet"
  );
  assert(
    (() => {
      const text = String(pkg.scripts?.["release:store:preflight"] ?? "");
      const afterPublicHost = text.slice(text.indexOf("npm run public-host:store"));

      return (
        includesInOrder(afterPublicHost, "npm run public-host:store", "npm run check:published-site -- --strict") &&
        includesInOrder(afterPublicHost, "npm run check:published-site -- --strict", "npm run signing-assets:store") &&
        includesInOrder(afterPublicHost, "npm run signing-assets:store", "npm run upload-packet:store") &&
        includesInOrder(afterPublicHost, "npm run upload-packet:store", "npm run copy-map:store") &&
        includesInOrder(afterPublicHost, "npm run copy-map:store", "npm run check:copy-map -- --strict") &&
        includesInOrder(afterPublicHost, "npm run check:copy-map -- --strict", "npm run apple-assets:store") &&
        includesInOrder(afterPublicHost, "npm run apple-assets:store", "npm run signing-runbook:store")
      );
    })(),
    "Release preflight builds Apple release asset packet before signing/upload runbook"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run report:store-blockers", "npm run signing-runbook:store"),
    "Release preflight builds signing/upload runbook after blocker report"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run report:store-blockers", "npm run resolution-plan:store"),
    "Release preflight builds release resolution plan after blocker report"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run signing-runbook:store", "npm run resolution-plan:store"),
    "Release preflight builds release resolution plan after signing/upload runbook"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run resolution-plan:store", "npm run submission-checklist:store"),
    "Release preflight builds final submission checklist after release resolution plan"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run submission-checklist:store", "npm run evidence:store"),
    "Release preflight records evidence after final submission checklist"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run submission-checklist:store", "npm run machine-report:store") &&
      includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run machine-report:store", "npm run evidence:store"),
    "Release preflight records machine report before evidence"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run submission-checklist:store", "npm run dashboard:store"),
    "Release preflight builds dashboard after final submission checklist"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run evidence:store", "npm run check:evidence") &&
      includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:evidence", "npm run dashboard:store"),
    "Release preflight checks evidence before dashboard"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run dashboard:store", "npm run manifest:store"),
    "Release preflight records dashboard before manifest"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run dashboard:store", "npm run operator:store"),
    "Release preflight builds operator queue after dashboard"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run operator:store", "npm run manifest:store"),
    "Release preflight records operator queue before manifest"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run signing-runbook:store", "npm run evidence:store"),
    "Release preflight records evidence after signing/upload runbook"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run upload-evidence:store", "npm run evidence:store"),
    "Release preflight records upload evidence before release evidence"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run evidence:store", "npm run check:evidence") &&
      includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:evidence", "npm run manifest:store"),
    "Release preflight records checked evidence before manifest generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run manifest:store", "npm run check:manifest") &&
      includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:manifest", "npm run handoff:store"),
    "Release preflight builds handoff after manifest check"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run handoff:store", "npm run verify:store:strict"),
    "Release preflight verifies strict readiness after handoff"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run handoff:store", "npm run check:release-machine -- --strict"),
    "Release preflight runs release machine doctor after handoff"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:release-machine -- --strict", "npm run verify:store:strict"),
    "Release preflight runs release machine doctor before strict verification"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run packet:store", "npm run check:store-urls -- --strict"),
    "Release preflight checks public URLs after packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run packet:store", "npm run app-compliance:store"),
    "Release preflight builds App Store compliance packet after packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run app-compliance:store", "npm run review-brief:store"),
    "Release preflight builds App Review brief after App Store compliance packet"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run review-brief:store", "npm run copy-map:store"),
    "Release preflight builds copy map after App Review brief"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run copy-map:store", "npm run check:review-brief -- --strict"),
    "Release preflight strictly checks App Review brief after copy map generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:review-brief -- --strict", "npm run check:copy-map -- --strict"),
    "Release preflight strictly checks copy map after App Review brief"
  );
  assert(
    includesInOrder(
      pkg.scripts?.["release:store:preflight"],
      "npm run check:copy-map -- --strict",
      "npm run check:public-release-sync -- --strict"
    ),
    "Release preflight checks public release sync after strict copy map check"
  );
  assert(
    includesInOrder(
      pkg.scripts?.["release:store:preflight"],
      "npm run check:public-release-sync -- --strict",
      "npm run check:store-version && npm run check:app-privacy"
    ),
    "Release preflight checks generated store version after strict public release sync"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run packet:store", "npm run check:store-copy"),
    "Release preflight checks App Store copy after packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run export-compliance:store", "npm run packet:store"),
    "Release preflight builds export compliance before packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run packet:store", "npm run check:export-compliance"),
    "Release preflight checks export compliance after packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:export-compliance", "npm run check:app-compliance"),
    "Release preflight checks App Store compliance after export compliance"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:app-compliance", "npm run check:store-copy"),
    "Release preflight checks App Store copy after App Store compliance"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:store-copy", "npm run check:artifact-privacy"),
    "Release preflight checks artifact privacy after store copy"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:artifact-privacy", "npm run check:store-urls -- --strict"),
    "Release preflight checks strict public URLs after artifact privacy"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run packet:store", "npm run check:app-privacy"),
    "Release preflight checks App privacy after packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run packet:store", "npm run check:store-version && npm run check:app-privacy"),
    "Release preflight rechecks store version after packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run screenshots:store", "npm run packet:store"),
    "Release preflight refreshes screenshots before packet generation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run check:site -- --strict", "npm run archive:site"),
    "Release preflight builds public site archive after strict site validation"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:preflight"], "npm run archive:site", "npm run check:site-archive -- --strict"),
    "Release preflight validates public site archive after building it"
  );
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run upload-evidence:store"), "Local release dry-run generates sanitized upload evidence");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run upload-packet:store"), "Local release dry-run generates upload command packet");
  assert(pkg.scripts?.["release:store:local"]?.includes("npm run check:upload-credentials"), "Local release dry-run reports advisory App Store upload credential state");
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:upload-credentials", "npm run upload-evidence:store") &&
      includesInOrder(pkg.scripts?.["release:store:local"], "npm run upload-evidence:store", "npm run report:store-blockers"),
    "Local release dry-run records upload evidence after upload credentials and before blocker report"
  );
  assert(
    includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:upload-tooling", "npm run check:upload-credentials") &&
      includesInOrder(pkg.scripts?.["release:store:local"], "npm run check:upload-credentials", "npm run upload-packet:store") &&
      includesInOrder(pkg.scripts?.["release:store:local"], "npm run upload-packet:store", "npm run upload-evidence:store"),
    "Local release dry-run records upload command packet after upload credentials and before upload evidence"
  );
	  assert(readiness.includes("check:store-env"), "Readiness guide documents store env preflight");
  assert(readiness.includes("no path/query/fragment"), "Readiness guide documents CODY_SITE_URL origin-only validation");
  assert(readiness.includes("0600"), "Readiness guide documents private store env file permissions");
  assert(readiness.includes("init:store-env"), "Readiness guide documents store env initializer");
  assert(readiness.includes("site.env.local") && readiness.includes("Precedence is shell env"), "Readiness guide documents release env override precedence");
  assert(readiness.includes("quotes and escapes"), "Readiness guide documents quoted release env writer behavior");
  assert(readiness.includes("configure:store-env"), "Readiness guide documents store env configurator");
  assert(
    readiness.includes("public-release:store") &&
      readiness.includes("public-release:store:published") &&
      readiness.includes("public-release:store:node") &&
      readiness.includes("public-release:store:published:node"),
    "Readiness guide documents public release refresh commands"
  );
  assert(readiness.includes("check:store-version"), "Readiness guide documents App Store version check");
  assert(readiness.includes("check:app-privacy"), "Readiness guide documents App privacy check");
  assert(readiness.includes("export-compliance:store"), "Readiness guide documents export compliance generation");
  assert(readiness.includes("check:export-compliance"), "Readiness guide documents export compliance check");
  assert(readiness.includes("Export Compliance Prep"), "Readiness guide documents export compliance prep");
  assert(readiness.includes("app-compliance:store") && readiness.includes("check:app-compliance"), "Readiness guide documents App Store compliance packet");
  assert(readiness.includes("manual-tasks:store") && readiness.includes("check:manual-tasks"), "Readiness guide documents App Store Connect manual task packet");
  assert(readiness.includes("check:store-copy"), "Readiness guide documents App Store copy check");
  assert(readiness.includes("copy-map:store"), "Readiness guide documents App Store Connect copy map generation");
  assert(readiness.includes("check:copy-map"), "Readiness guide documents App Store Connect copy map validation");
  assert(readiness.includes("review-brief:store"), "Readiness guide documents App Review brief generation");
  assert(readiness.includes("check:review-brief"), "Readiness guide documents App Review brief validation");
  assert(readiness.includes("public-inputs:store"), "Readiness guide documents public release-input generation");
  assert(readiness.includes("check:public-inputs"), "Readiness guide documents public release-input validation");
  assert(readiness.includes("check:public-release-sync"), "Readiness guide documents public release sync validation");
  assert(readiness.includes("resolution-plan:store"), "Readiness guide documents release resolution plan generation");
  assert(readiness.includes("check:resolution-plan"), "Readiness guide documents release resolution plan validation");
  assert(readiness.includes("submission-checklist:store"), "Readiness guide documents final submission checklist generation");
  assert(readiness.includes("check:submission-checklist"), "Readiness guide documents final submission checklist validation");
  assert(readiness.includes("dashboard:store"), "Readiness guide documents release dashboard generation");
  assert(readiness.includes("check:dashboard"), "Readiness guide documents release dashboard validation");
  assert(readiness.includes("operator:store"), "Readiness guide documents release operator queue generation");
  assert(readiness.includes("check:operator"), "Readiness guide documents release operator queue validation");
  assert(readiness.includes("signing-runbook:store"), "Readiness guide documents signing/upload runbook generation");
  assert(readiness.includes("check:signing-runbook"), "Readiness guide documents signing/upload runbook validation");
  assert(readiness.includes("signing-assets:store"), "Readiness guide documents signing asset report generation");
  assert(readiness.includes("check:signing-assets"), "Readiness guide documents signing asset report validation");
  assert(readiness.includes("SIGNING_ASSET_REPORT.md"), "Readiness guide documents signing asset report artifact");
  assert(readiness.includes("install:mas-profile") && readiness.includes("--dry-run"), "Readiness guide documents MAS profile validation helper");
  assert(readiness.includes("profile source file outside the project and handoff archive"), "Readiness guide documents private MAS profile source handling");
  assert(readiness.includes("symlinked profile install directories"), "Readiness guide documents MAS profile install destination symlink rejection");
  assert(readiness.includes("upload-packet:store"), "Readiness guide documents upload command packet generation");
  assert(readiness.includes("check:upload-packet"), "Readiness guide documents upload command packet validation");
  assert(readiness.includes("UPLOAD_COMMAND_PACKET.md"), "Readiness guide documents upload command packet artifact");
  assert(readiness.includes("upload-evidence:store"), "Readiness guide documents upload evidence generation");
  assert(readiness.includes("check:upload-evidence"), "Readiness guide documents upload evidence validation");
  assert(readiness.includes("UPLOAD_EVIDENCE.md"), "Readiness guide documents upload evidence artifact");
  assert(readiness.includes("raw delivery logs outside the handoff archive"), "Readiness guide documents private raw upload log handling");
  assert(readiness.includes("check:artifact-privacy"), "Readiness guide documents artifact privacy check");
  assert(readiness.includes("check:electron-security"), "Readiness guide documents Electron security check");
  assert(readiness.includes("check:release-runtime"), "Readiness guide documents release runtime check");
  assert(readiness.includes("release:node -- <command>"), "Readiness guide documents release-node wrapper");
  assert(readiness.includes("check:release-machine"), "Readiness guide documents release machine doctor");
  assert(readiness.includes("machine-report:store"), "Readiness guide documents release machine report generation");
  assert(readiness.includes("check:machine-report"), "Readiness guide documents release machine report validation");
  assert(readiness.includes("check:packaging-toolchain"), "Readiness guide documents packaging toolchain check");
  assert(readiness.includes("check:help-docs"), "Readiness guide documents Help document check");
  assert(readiness.includes("check:site"), "Readiness guide documents store site validation");
  assert(readiness.includes("check:site-archive"), "Readiness guide documents public site archive validation");
  assert(readiness.includes("check:store-urls"), "Readiness guide documents public URL reachability check");
  assert(readiness.includes("check:published-site"), "Readiness guide documents full published-site check");
  assert(readiness.includes("check:screenshots"), "Readiness guide documents screenshot quality audit");
  assert(readiness.includes("smoke:a11y"), "Readiness guide documents accessibility smoke test");
  assert(readiness.includes("smoke:electron-shell"), "Readiness guide documents Electron shell smoke test");
  assert(readiness.includes("smoke:clean-profile"), "Readiness guide documents clean-profile smoke test");
  assert(readiness.includes("smoke:mas-dir"), "Readiness guide documents MAS directory smoke test");
  assert(readiness.includes("smoke:mas-runtime"), "Readiness guide documents packaged MAS runtime smoke test");
  assert(readiness.includes("local audio import IPC"), "Readiness guide documents Electron shell import IPC coverage");
  assert(readiness.includes("byte-range media streaming"), "Readiness guide documents Electron shell media streaming coverage");
  assert(readiness.includes("Minimum macOS version is explicitly set to `12.0`"), "Readiness guide documents explicit minimum macOS version");
  assert(readiness.includes("App code is explicitly packaged into `app.asar`"), "Readiness guide documents explicit ASAR packaging");
  assert(readiness.includes("Electron package fuses are source-controlled"), "Readiness guide documents Electron package fuses");
  assert(readiness.includes("grantFileProtocolExtraPrivileges` is disabled"), "Readiness guide documents disabled file protocol fuse");
  assert(readiness.includes("packaged app file allowlist"), "Readiness guide documents package file allowlist");
  assert(readiness.includes("check:mas-signing"), "Readiness guide documents MAS signing preflight");
  assert(readiness.includes("macOS/Mac App Store provisioning profile"), "Readiness guide documents macOS provisioning profile requirement");
  assert(readiness.includes("signed current-version installer package"), "Readiness guide documents signed current-version installer package requirement");
  assert(readiness.includes("check:upload-tooling"), "Readiness guide documents App Store upload tooling check");
  assert(readiness.includes("install:asc-key"), "Readiness guide documents App Store Connect key install helper");
  assert(readiness.includes("symlinked install directories"), "Readiness guide documents ASC key install destination symlink rejection");
  assert(readiness.includes("check:upload-credentials"), "Readiness guide documents App Store upload credential check");
  assert(readiness.includes("package signatures") || readiness.includes("upload package signature"), "Readiness guide documents MAS upload signature validation");
  assert(readiness.includes("check:mas-package"), "Readiness guide documents MAS package boundary check");
  assert(readiness.includes("verify:store:strict"), "Readiness guide documents strict store verifier");
  assert(readiness.includes("smoke:store"), "Readiness guide documents production store smoke test");
  assert(readiness.includes("desktop layout stability"), "Readiness guide documents production store smoke layout stability");
  assert(readiness.includes("release:store:preflight"), "Readiness guide documents release preflight");
  assert(readiness.includes("release:store:local"), "Readiness guide documents local release dry-run");
  assert(readiness.includes("manifest:store"), "Readiness guide documents release manifest generation");
  assert(readiness.includes("check:manifest"), "Readiness guide documents release manifest validation");
  assert(readiness.includes("report:store-blockers"), "Readiness guide documents release blocker report");
  assert(readiness.includes("PUBLIC_RELEASE_INPUTS.md"), "Readiness guide documents public release-input artifact");
  assert(readiness.includes("RELEASE_RESOLUTION_PLAN.md"), "Readiness guide documents release resolution plan artifact");
  assert(readiness.includes("FINAL_SUBMISSION_CHECKLIST.md"), "Readiness guide documents final submission checklist artifact");
  assert(readiness.includes("RELEASE_MACHINE_REPORT.md"), "Readiness guide documents release machine report artifact");
  assert(readiness.includes("RELEASE_DASHBOARD.html"), "Readiness guide documents release dashboard artifact");
  assert(readiness.includes("RELEASE_OPERATOR_QUEUE.md"), "Readiness guide documents release operator queue artifact");
  assert(readiness.includes("evidence:store"), "Readiness guide documents release evidence generation");
  assert(readiness.includes("check:evidence"), "Readiness guide documents release evidence validation");
  assert(readiness.includes("handoff:store"), "Readiness guide documents submission handoff archive generation");
  assert(readiness.includes("notices:store"), "Readiness guide documents third-party notices generation");
  assert(readiness.includes("Accessibility Nutrition Labels"), "Readiness guide documents accessibility labels");
  assert(readiness.includes("Age rating"), "Readiness guide documents age-rating draft");
  assert(readiness.includes("Pricing, Availability, And Release"), "Readiness guide documents pricing and release draft");
  assert(readiness.includes("TestFlight Beta Test"), "Readiness guide documents TestFlight beta test draft");
  assert(readiness.includes("Upload And App Review Submission"), "Readiness guide documents upload and App Review submission draft");
  assert(readiness.includes("EU DSA Compliance"), "Readiness guide documents EU DSA compliance draft");

  if (listing.includes("TODO:")) {
    warn("Listing draft still has TODOs for public URLs.");
  }
  if (privacy.includes("TODO:")) {
    warn("Privacy policy draft still needs public contact/support details.");
  }
  if (support.includes("TODO:")) {
    warn("Support page draft still needs a public support email/contact.");
  }
  if (
    packet.includes("TODO_PUBLIC_SITE_URL") ||
    packet.includes("TODO_SUPPORT_EMAIL") ||
    packet.includes("TODO_REVIEW_CONTACT_NAME") ||
    packet.includes("TODO_REVIEW_CONTACT_PHONE")
  ) {
    warn("Submission packet still uses placeholder public URL, support email, or App Review contact details.");
  }
  if (!isFullUrl(fields.productPage?.supportUrl)) {
    warn("Support URL is not a complete http(s) URL.");
  }
  if (!isFullUrl(fields.productPage?.privacyPolicyUrl)) {
    warn("Privacy Policy URL is not a complete http(s) URL.");
  }
  if (fields.productPage?.marketingUrl !== "Optional or TODO_PUBLIC_SITE_URL/index.html" && !isFullUrl(fields.productPage?.marketingUrl)) {
    warn("Marketing URL is not empty/optional or a complete http(s) URL.");
  }
}

function checkGeneratedPacketFreshness() {
  const generatedFiles = ["app-store-assets/SUBMISSION_PACKET.md", "app-store-assets/APP_STORE_CONNECT_FIELDS.json"];
  const sourceFiles = [
    "package.json",
    "app-store-assets/APP_STORE_LISTING.md",
    "app-store-assets/ACCESSIBILITY.md",
    "app-store-assets/PRIVACY_POLICY.md",
    "app-store-assets/SUPPORT.md",
    "app-store-assets/THIRD_PARTY_NOTICES.json",
    "app-store-assets/THIRD_PARTY_NOTICES.md",
    "app-store-assets/EXPORT_COMPLIANCE.json",
    "app-store-assets/EXPORT_COMPLIANCE.md",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "build/PrivacyInfo.xcprivacy",
    "scripts/build-submission-packet.cjs",
    "scripts/store-env.cjs",
    "scripts/check-public-release-sync.cjs",
    "scripts/check-store-version.cjs",
    "scripts/bump-store-version.cjs",
    "scripts/build-public-site-archive.cjs",
    "scripts/check-public-site-archive.cjs",
    "scripts/check-app-privacy.cjs",
    "scripts/build-export-compliance.cjs",
    "scripts/check-export-compliance.cjs",
    "scripts/check-artifact-privacy.cjs",
    "scripts/check-store-copy.cjs",
    "scripts/check-store-urls.cjs",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/screenshots/01-library-1440x900.png",
    "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    "app-store-assets/screenshots/03-missing-files-1440x900.png"
  ].filter(exists);

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to submission sources`);
    } else {
      warn(`${filePath} is older than one or more submission sources; run npm run packet:store`);
    }
  });
}

function checkGeneratedCopyMapFreshness() {
  const generatedFiles = ["app-store-assets/APP_STORE_CONNECT_COPY_MAP.json", "app-store-assets/APP_STORE_CONNECT_COPY_MAP.md"];
  const sourceFiles = [
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_REVIEW_BRIEF.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "scripts/build-app-store-copy-map.cjs",
    "scripts/check-app-store-copy-map.cjs"
  ].filter(exists);

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to App Store Connect copy map sources`);
    } else {
      warn(`${filePath} is older than one or more copy map sources; run npm run copy-map:store`);
    }
  });
}

function checkGeneratedAppStoreComplianceFreshness() {
  const generatedFiles = ["app-store-assets/APP_STORE_COMPLIANCE.json", "app-store-assets/APP_STORE_COMPLIANCE.md"];
  const sourceFiles = [
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/EXPORT_COMPLIANCE.json",
    "app-store-assets/EXPORT_COMPLIANCE.md",
    "APP_STORE_READINESS.md",
    "scripts/build-app-store-compliance.cjs",
    "scripts/check-app-store-compliance.cjs"
  ].filter(exists);

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to App Store compliance sources`);
    } else {
      warn(`${filePath} is older than one or more App Store compliance sources; run npm run app-compliance:store`);
    }
  });
}

function checkGeneratedManualTasksFreshness() {
  const generatedFiles = [
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md"
  ];
  const sourceFiles = [
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_STORE_COMPLIANCE.json",
    "app-store-assets/APP_STORE_COMPLIANCE.md",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "APP_STORE_READINESS.md",
    "scripts/build-app-store-connect-manual-tasks.cjs",
    "scripts/check-app-store-connect-manual-tasks.cjs"
  ].filter(exists);

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to App Store Connect manual task sources`);
    } else {
      warn(`${filePath} is older than one or more App Store Connect manual task sources; run npm run manual-tasks:store`);
    }
  });
}

function checkGeneratedReviewBriefFreshness() {
  const generatedFiles = ["app-store-assets/APP_REVIEW_BRIEF.json", "app-store-assets/APP_REVIEW_BRIEF.md"];
  const sourceFiles = [
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "scripts/build-app-review-brief.cjs",
    "scripts/check-app-review-brief.cjs"
  ].filter(exists);

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to App Review brief sources`);
    } else {
      warn(`${filePath} is older than one or more App Review brief sources; run npm run review-brief:store`);
    }
  });
}

function checkGeneratedReleaseManifestFreshness() {
  const generatedFiles = ["app-store-assets/RELEASE_MANIFEST.json", "app-store-assets/RELEASE_MANIFEST.md"];
  const sourceFiles = [
    "package.json",
    "package-lock.json",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.md",
    "app-store-assets/EXPORT_COMPLIANCE.json",
    "app-store-assets/EXPORT_COMPLIANCE.md",
    "app-store-assets/APP_STORE_COMPLIANCE.json",
    "app-store-assets/APP_STORE_COMPLIANCE.md",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md",
    "app-store-assets/APP_REVIEW_BRIEF.json",
    "app-store-assets/APP_REVIEW_BRIEF.md",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.md",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.md",
    "app-store-assets/SUBMISSION_PACKET.md",
    "app-store-assets/RELEASE_EVIDENCE.json",
    "app-store-assets/RELEASE_EVIDENCE.md",
    "app-store-assets/RELEASE_MACHINE_REPORT.json",
    "app-store-assets/RELEASE_MACHINE_REPORT.md",
    "app-store-assets/RELEASE_DASHBOARD.json",
    "app-store-assets/RELEASE_DASHBOARD.html",
    "app-store-assets/RELEASE_OPERATOR_QUEUE.json",
    "app-store-assets/RELEASE_OPERATOR_QUEUE.md",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/RELEASE_BLOCKERS.md",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.md",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.md",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/SIGNING_ASSET_REPORT.md",
    "app-store-assets/APPLE_RELEASE_ASSETS.json",
    "app-store-assets/APPLE_RELEASE_ASSETS.md",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.md",
    "app-store-assets/APP_STORE_LISTING.md",
    "app-store-assets/ACCESSIBILITY.md",
    "app-store-assets/PRIVACY_POLICY.md",
    "app-store-assets/SUPPORT.md",
    "app-store-assets/THIRD_PARTY_NOTICES.json",
    "app-store-assets/THIRD_PARTY_NOTICES.md",
    "app-store-assets/site/index.html",
    "app-store-assets/site/privacy.html",
    "app-store-assets/site/support.html",
    "app-store-assets/site/accessibility.html",
    "app-store-assets/site/third-party-notices.html",
    "app-store-assets/site/robots.txt",
    "app-store-assets/site/sitemap.xml",
    "app-store-assets/site/_headers",
    "app-store-assets/site/vercel.json",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/site.env.example",
    "build/PrivacyInfo.xcprivacy",
    "build/entitlements.mas.plist",
    "build/entitlements.mas.inherit.plist",
    "build/icon.icns",
    "build/icon.png",
    "build/icon.iconset/icon_16x16.png",
    "build/icon.iconset/icon_16x16@2x.png",
    "build/icon.iconset/icon_32x32.png",
    "build/icon.iconset/icon_32x32@2x.png",
    "build/icon.iconset/icon_128x128.png",
    "build/icon.iconset/icon_128x128@2x.png",
    "build/icon.iconset/icon_256x256.png",
    "build/icon.iconset/icon_256x256@2x.png",
    "build/icon.iconset/icon_512x512.png",
    "build/icon.iconset/icon_512x512@2x.png",
    "scripts/check-icons.cjs",
    "scripts/check-app-privacy.cjs",
    "scripts/build-export-compliance.cjs",
    "scripts/check-export-compliance.cjs",
    "scripts/check-artifact-privacy.cjs",
    "scripts/check-store-version.cjs",
    "scripts/bump-store-version.cjs",
    "scripts/check-electron-security.cjs",
    "scripts/build-public-site-archive.cjs",
    "scripts/check-public-site-archive.cjs",
    "scripts/check-store-copy.cjs",
    "scripts/check-store-urls.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/init-store-env.cjs",
    "scripts/store-env.cjs",
    "scripts/check-store-screenshots.cjs",
    "scripts/capture-store-screenshots.cjs",
    "scripts/check-release-runtime.cjs",
    "scripts/run-release-node.cjs",
    "scripts/check-release-machine.cjs",
    "scripts/check-packaging-toolchain.cjs",
    "scripts/check-mas-package.cjs",
    "scripts/check-upload-tooling.cjs",
    "scripts/check-upload-credentials.cjs",
    "scripts/build-upload-command-packet.cjs",
    "scripts/check-upload-command-packet.cjs",
    "scripts/build-upload-evidence.cjs",
    "scripts/check-upload-evidence.cjs",
    "scripts/install-mas-profile.cjs",
    "scripts/install-asc-key.cjs",
    "scripts/verify-store-readiness.cjs",
    "scripts/verify-store-readiness-with-build.cjs",
    "scripts/check-release-manifest.cjs",
    "scripts/check-release-evidence.cjs",
	    "scripts/smoke-accessibility.cjs",
    "scripts/smoke-clean-profile.cjs",
    "scripts/smoke-electron-shell.cjs",
    "scripts/smoke-mas-dir-build.cjs",
    "index.html",
    "vite.config.ts",
    "src/main.tsx",
    "src/App.tsx",
    "src/styles.css",
    ".nvmrc",
    ".node-version",
    "scripts/build-release-manifest.cjs",
    "scripts/check-release-manifest.cjs",
    "scripts/build-release-evidence.cjs",
    "scripts/check-release-evidence.cjs",
    "scripts/build-release-machine-report.cjs",
    "scripts/check-release-machine-report.cjs",
    "scripts/build-release-dashboard.cjs",
    "scripts/check-release-dashboard.cjs",
    "scripts/build-release-operator-queue.cjs",
    "scripts/check-release-operator-queue.cjs",
    "scripts/build-public-release-inputs.cjs",
    "scripts/check-public-release-inputs.cjs",
    "scripts/build-public-host-runbook.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/check-public-release-sync.cjs",
    "scripts/build-app-store-copy-map.cjs",
    "scripts/check-app-store-copy-map.cjs",
    "scripts/build-app-review-brief.cjs",
    "scripts/check-app-review-brief.cjs",
    "scripts/build-submission-handoff.cjs",
    "scripts/check-submission-handoff.cjs",
    "scripts/build-release-blocker-report.cjs",
    "scripts/build-release-resolution-plan.cjs",
    "scripts/check-release-resolution-plan.cjs",
    "scripts/build-final-submission-checklist.cjs",
    "scripts/check-final-submission-checklist.cjs",
    "scripts/build-signing-upload-runbook.cjs",
    "scripts/check-signing-upload-runbook.cjs",
    "scripts/build-signing-asset-report.cjs",
    "scripts/check-signing-asset-report.cjs",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/build-third-party-notices.cjs",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/screenshots/01-library-1440x900.png",
    "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    "app-store-assets/screenshots/03-missing-files-1440x900.png"
  ].filter(exists);

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to release manifest sources`);
    } else {
      warn(`${filePath} is older than one or more release manifest sources; run npm run manifest:store`);
    }
  });
}

function checkGeneratedSubmissionHandoffFreshness() {
  const generatedFiles = [
    "app-store-assets/submission-handoff/cody-cartridge-app-store-handoff.zip",
    "app-store-assets/submission-handoff/SUBMISSION_HANDOFF.json"
  ];
  const sourceFiles = [
    "APP_STORE_READINESS.md",
    "app-store-assets/SUBMISSION_PACKET.md",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.md",
    "app-store-assets/EXPORT_COMPLIANCE.json",
    "app-store-assets/EXPORT_COMPLIANCE.md",
    "app-store-assets/APP_STORE_COMPLIANCE.json",
    "app-store-assets/APP_STORE_COMPLIANCE.md",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md",
    "app-store-assets/APP_REVIEW_BRIEF.json",
    "app-store-assets/APP_REVIEW_BRIEF.md",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.md",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.md",
    "app-store-assets/APP_STORE_LISTING.md",
    "app-store-assets/PRIVACY_POLICY.md",
    "app-store-assets/SUPPORT.md",
    "app-store-assets/ACCESSIBILITY.md",
    "app-store-assets/THIRD_PARTY_NOTICES.json",
    "app-store-assets/THIRD_PARTY_NOTICES.md",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/RELEASE_BLOCKERS.md",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.md",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md",
    "app-store-assets/RELEASE_DASHBOARD.json",
    "app-store-assets/RELEASE_DASHBOARD.html",
    "app-store-assets/RELEASE_MACHINE_REPORT.json",
    "app-store-assets/RELEASE_MACHINE_REPORT.md",
    "app-store-assets/RELEASE_OPERATOR_QUEUE.json",
    "app-store-assets/RELEASE_OPERATOR_QUEUE.md",
    "app-store-assets/RELEASE_EVIDENCE.json",
    "app-store-assets/RELEASE_EVIDENCE.md",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.md",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/SIGNING_ASSET_REPORT.md",
    "app-store-assets/APPLE_RELEASE_ASSETS.json",
    "app-store-assets/APPLE_RELEASE_ASSETS.md",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.md",
    "app-store-assets/UPLOAD_EVIDENCE.json",
    "app-store-assets/UPLOAD_EVIDENCE.md",
    "app-store-assets/RELEASE_MANIFEST.json",
    "app-store-assets/RELEASE_MANIFEST.md",
    "app-store-assets/site.env.example",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/screenshots/01-library-1440x900.png",
    "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    "app-store-assets/screenshots/03-missing-files-1440x900.png",
    "scripts/build-submission-handoff.cjs",
    "scripts/check-submission-handoff.cjs",
    "scripts/build-public-release-inputs.cjs",
    "scripts/check-public-release-inputs.cjs",
    "scripts/build-public-host-runbook.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/build-release-resolution-plan.cjs",
    "scripts/check-release-resolution-plan.cjs",
    "scripts/build-final-submission-checklist.cjs",
    "scripts/check-final-submission-checklist.cjs",
    "scripts/build-release-dashboard.cjs",
    "scripts/check-release-dashboard.cjs",
    "scripts/build-release-machine-report.cjs",
    "scripts/check-release-machine-report.cjs",
    "scripts/build-release-operator-queue.cjs",
    "scripts/check-release-operator-queue.cjs",
    "scripts/build-signing-upload-runbook.cjs",
    "scripts/check-signing-upload-runbook.cjs",
    "scripts/build-signing-asset-report.cjs",
    "scripts/check-signing-asset-report.cjs",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/install-mas-profile.cjs",
    "scripts/install-asc-key.cjs",
    "scripts/build-upload-evidence.cjs",
    "scripts/check-upload-evidence.cjs",
    "scripts/build-app-store-copy-map.cjs",
    "scripts/check-app-store-copy-map.cjs",
    "scripts/build-app-store-compliance.cjs",
    "scripts/check-app-store-compliance.cjs",
    "scripts/build-app-review-brief.cjs",
    "scripts/check-app-review-brief.cjs"
  ].filter(exists);

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to submission handoff sources`);
    } else {
      warn(`${filePath} is older than one or more submission handoff sources; run npm run handoff:store`);
    }
  });
}

function checkGeneratedReleaseEvidenceFreshness() {
  const generatedFiles = ["app-store-assets/RELEASE_EVIDENCE.json", "app-store-assets/RELEASE_EVIDENCE.md"];
  const sourceFiles = [
    "package.json",
    "package-lock.json",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.md",
    "app-store-assets/EXPORT_COMPLIANCE.json",
    "app-store-assets/EXPORT_COMPLIANCE.md",
    "app-store-assets/APP_STORE_COMPLIANCE.json",
    "app-store-assets/APP_STORE_COMPLIANCE.md",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md",
    "app-store-assets/APP_REVIEW_BRIEF.json",
    "app-store-assets/APP_REVIEW_BRIEF.md",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.md",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.md",
    "app-store-assets/SUBMISSION_PACKET.md",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/RELEASE_BLOCKERS.md",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.md",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md",
    "app-store-assets/RELEASE_MACHINE_REPORT.json",
    "app-store-assets/RELEASE_MACHINE_REPORT.md",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.md",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/SIGNING_ASSET_REPORT.md",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.md",
    "app-store-assets/UPLOAD_EVIDENCE.json",
    "app-store-assets/UPLOAD_EVIDENCE.md",
    "app-store-assets/THIRD_PARTY_NOTICES.md",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/screenshots/01-library-1440x900.png",
    "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    "app-store-assets/screenshots/03-missing-files-1440x900.png",
    "build/icon.icns",
    "build/PrivacyInfo.xcprivacy",
    "build/entitlements.mas.plist",
    "build/entitlements.mas.inherit.plist",
    "scripts/build-release-evidence.cjs",
    "scripts/check-release-evidence.cjs",
    "scripts/build-release-machine-report.cjs",
    "scripts/check-release-machine-report.cjs",
    "scripts/check-release-manifest.cjs",
    "scripts/store-env.cjs",
    "scripts/build-public-release-inputs.cjs",
    "scripts/build-public-site-publish-packet.cjs",
    "scripts/check-public-site-publish-packet.cjs",
    "scripts/build-public-host-runbook.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/check-public-release-inputs.cjs",
    "scripts/check-public-release-sync.cjs",
    "scripts/check-store-version.cjs",
    "scripts/check-icons.cjs",
    "scripts/check-electron-security.cjs",
    "scripts/check-packaging-toolchain.cjs",
    "scripts/check-help-docs.cjs",
    "scripts/check-app-privacy.cjs",
    "scripts/check-artifact-privacy.cjs",
    "scripts/check-store-copy.cjs",
    "scripts/check-store-site.cjs",
    "scripts/check-public-site-archive.cjs",
    "scripts/check-store-urls.cjs",
    "scripts/run-release-node.cjs",
    "scripts/check-release-machine.cjs",
    "scripts/check-mas-signing.cjs",
    "scripts/check-mas-package.cjs",
    "scripts/check-upload-tooling.cjs",
    "scripts/check-upload-credentials.cjs",
    "scripts/build-upload-command-packet.cjs",
    "scripts/check-upload-command-packet.cjs",
    "scripts/build-upload-evidence.cjs",
    "scripts/check-upload-evidence.cjs",
    "scripts/build-release-resolution-plan.cjs",
    "scripts/check-release-resolution-plan.cjs",
    "scripts/build-final-submission-checklist.cjs",
    "scripts/check-final-submission-checklist.cjs",
    "scripts/build-signing-upload-runbook.cjs",
    "scripts/check-signing-upload-runbook.cjs",
    "scripts/build-signing-asset-report.cjs",
    "scripts/check-signing-asset-report.cjs",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/build-app-store-copy-map.cjs",
    "scripts/check-app-store-copy-map.cjs",
    "scripts/build-app-review-brief.cjs",
    "scripts/check-app-review-brief.cjs",
    "scripts/store-env.cjs"
  ].filter(exists);

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to release evidence sources`);
    } else {
      warn(`${filePath} is older than one or more release evidence sources; run npm run evidence:store`);
    }
  });
}

function checkGeneratedUploadEvidenceFreshness() {
  const generatedFiles = ["app-store-assets/UPLOAD_EVIDENCE.json", "app-store-assets/UPLOAD_EVIDENCE.md"];
  const sourceFiles = [
    "package.json",
    "scripts/build-upload-evidence.cjs",
    "scripts/check-upload-evidence.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Upload evidence freshness sources are missing; run npm run upload-evidence:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to upload evidence sources`);
    } else {
      warn(`${filePath} is older than one or more upload evidence sources; run npm run upload-evidence:store`);
    }
  });
}

function checkGeneratedUploadCommandPacketFreshness() {
  const generatedFiles = ["app-store-assets/UPLOAD_COMMAND_PACKET.json", "app-store-assets/UPLOAD_COMMAND_PACKET.md"];
  const sourceFiles = [
    "package.json",
    "scripts/build-upload-command-packet.cjs",
    "scripts/check-upload-command-packet.cjs",
    "scripts/check-mas-package.cjs",
    "scripts/check-upload-tooling.cjs",
    "scripts/install-asc-key.cjs",
    "scripts/check-upload-credentials.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Upload command packet freshness sources are missing; run npm run upload-packet:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to upload command packet sources`);
    } else {
      warn(`${filePath} is older than one or more upload command packet sources; run npm run upload-packet:store`);
    }
  });
}

function checkGeneratedAppleReleaseAssetsFreshness() {
  const generatedFiles = ["app-store-assets/APPLE_RELEASE_ASSETS.json", "app-store-assets/APPLE_RELEASE_ASSETS.md"];
  const sourceFiles = [
    "package.json",
    "build/entitlements.mas.plist",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/SIGNING_ASSET_REPORT.md",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.md",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/install-mas-profile.cjs",
    "scripts/install-asc-key.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Apple release asset request freshness sources are missing; run npm run apple-assets:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to Apple release asset request sources`);
    } else {
      warn(`${filePath} is older than one or more Apple release asset request sources; run npm run apple-assets:store`);
    }
  });
}

function checkGeneratedReleaseMachineReportFreshness() {
  const generatedFiles = ["app-store-assets/RELEASE_MACHINE_REPORT.json", "app-store-assets/RELEASE_MACHINE_REPORT.md"];
  const sourceFiles = [
    "package.json",
    "package-lock.json",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/RELEASE_BLOCKERS.md",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.md",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/SIGNING_ASSET_REPORT.md",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/APPLE_RELEASE_ASSETS.json",
    "app-store-assets/APPLE_RELEASE_ASSETS.md",
    "scripts/build-release-machine-report.cjs",
    "scripts/check-release-machine-report.cjs",
    "scripts/store-env.cjs",
    "scripts/check-store-env.cjs",
    "scripts/check-public-release-sync.cjs",
    "scripts/check-release-runtime.cjs",
    "scripts/run-release-node.cjs",
    "scripts/check-store-version.cjs",
    "scripts/check-packaging-toolchain.cjs",
    "scripts/check-store-urls.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/check-mas-signing.cjs",
    "scripts/check-mas-package.cjs",
    "scripts/check-upload-tooling.cjs",
    "scripts/install-asc-key.cjs",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/check-upload-credentials.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Release machine report freshness sources are missing; run npm run machine-report:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to release machine report sources`);
    } else {
      warn(`${filePath} is older than one or more release machine report sources; run npm run machine-report:store`);
    }
  });
}

function checkGeneratedReleaseDashboardFreshness() {
  const generatedFiles = ["app-store-assets/RELEASE_DASHBOARD.json", "app-store-assets/RELEASE_DASHBOARD.html"];
  const sourceFiles = [
    "package.json",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/RELEASE_MACHINE_REPORT.json",
    "app-store-assets/RELEASE_EVIDENCE.json",
    "scripts/build-release-dashboard.cjs",
    "scripts/check-release-dashboard.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Release dashboard freshness sources are missing; run npm run dashboard:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to release dashboard sources`);
    } else {
      warn(`${filePath} is older than one or more release dashboard sources; run npm run dashboard:store`);
    }
  });
}

function checkGeneratedReleaseOperatorQueueFreshness() {
  const generatedFiles = ["app-store-assets/RELEASE_OPERATOR_QUEUE.json", "app-store-assets/RELEASE_OPERATOR_QUEUE.md"];
  const sourceFiles = [
    "package.json",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/RELEASE_DASHBOARD.json",
    "scripts/build-release-operator-queue.cjs",
    "scripts/check-release-operator-queue.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Release operator queue freshness sources are missing; run npm run operator:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to release operator queue sources`);
    } else {
      warn(`${filePath} is older than one or more release operator queue sources; run npm run operator:store`);
    }
  });
}

function checkGeneratedReleaseBlockerFreshness() {
  const generatedFiles = ["app-store-assets/RELEASE_BLOCKERS.json", "app-store-assets/RELEASE_BLOCKERS.md"];
  const sourceFiles = [
    "package.json",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/site/index.html",
    "app-store-assets/site/privacy.html",
    "app-store-assets/site/support.html",
    "app-store-assets/site/accessibility.html",
    "app-store-assets/site/third-party-notices.html",
    "app-store-assets/site/robots.txt",
    "app-store-assets/site/sitemap.xml",
    "app-store-assets/site/README.txt",
    "app-store-assets/site/_headers",
    "app-store-assets/site/vercel.json",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
	    "scripts/build-release-blocker-report.cjs",
    "scripts/check-mas-signing.cjs",
    "scripts/check-packaging-toolchain.cjs",
	    "scripts/check-mas-package.cjs",
    "scripts/check-public-site-published.cjs",
	    "scripts/check-upload-tooling.cjs",
	    "scripts/check-upload-credentials.cjs",
	    "scripts/store-env.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Release blocker report freshness sources are missing; run npm run report:store-blockers");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to blocker report sources`);
    } else {
      warn(`${filePath} is older than one or more blocker report sources; run npm run report:store-blockers`);
    }
  });
}

function checkGeneratedPublicReleaseInputsFreshness() {
  const generatedFiles = ["app-store-assets/PUBLIC_RELEASE_INPUTS.json", "app-store-assets/PUBLIC_RELEASE_INPUTS.md"];
  const sourceFiles = [
    "package.json",
    "app-store-assets/site.env.example",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "scripts/build-public-release-inputs.cjs",
    "scripts/check-public-release-inputs.cjs",
    "scripts/check-public-release-sync.cjs",
    "scripts/store-env.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Public release inputs freshness sources are missing; run npm run public-inputs:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to public release-input sources`);
    } else {
      warn(`${filePath} is older than one or more public release-input sources; run npm run public-inputs:store`);
    }
  });
}

function checkGeneratedPublicSitePublishPacketFreshness() {
  const generatedFiles = [
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md"
  ];
  const sourceFiles = [
    "package.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/site/index.html",
    "app-store-assets/site/support.html",
    "app-store-assets/site/privacy.html",
    "app-store-assets/site/accessibility.html",
    "app-store-assets/site/third-party-notices.html",
    "app-store-assets/site/robots.txt",
    "app-store-assets/site/sitemap.xml",
    "app-store-assets/site/_headers",
    "app-store-assets/site/vercel.json",
    "scripts/build-public-site-publish-packet.cjs",
    "scripts/check-public-site-publish-packet.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/store-env.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Public site publish packet freshness sources are missing; run npm run publish-packet:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to public site publish-packet sources`);
    } else {
      warn(`${filePath} is older than one or more public site publish-packet sources; run npm run publish-packet:store`);
    }
  });
}

function checkGeneratedPublicHostRunbookFreshness() {
  const generatedFiles = [
    "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.md"
  ];
  const sourceFiles = [
    "package.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/site/index.html",
    "app-store-assets/site/support.html",
    "app-store-assets/site/privacy.html",
    "app-store-assets/site/accessibility.html",
    "app-store-assets/site/third-party-notices.html",
    "app-store-assets/site/robots.txt",
    "app-store-assets/site/sitemap.xml",
    "app-store-assets/site/_headers",
    "app-store-assets/site/vercel.json",
    "scripts/build-public-host-runbook.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/build-public-site-publish-packet.cjs",
    "scripts/check-public-site-publish-packet.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/check-store-urls.cjs",
    "scripts/configure-store-env.cjs",
    "scripts/store-env.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Public host runbook freshness sources are missing; run npm run public-host:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to public host runbook sources`);
    } else {
      warn(`${filePath} is older than one or more public host runbook sources; run npm run public-host:store`);
    }
  });
}

function checkGeneratedResolutionPlanFreshness() {
  const generatedFiles = ["app-store-assets/RELEASE_RESOLUTION_PLAN.json", "app-store-assets/RELEASE_RESOLUTION_PLAN.md"];
  const sourceFiles = [
    "package.json",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "scripts/build-release-resolution-plan.cjs",
    "scripts/check-release-resolution-plan.cjs",
    "scripts/check-public-release-sync.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Release resolution plan freshness sources are missing; run npm run resolution-plan:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to release resolution plan sources`);
    } else {
      warn(`${filePath} is older than one or more release resolution plan sources; run npm run resolution-plan:store`);
    }
  });
}

function checkGeneratedFinalSubmissionChecklistFreshness() {
  const generatedFiles = ["app-store-assets/FINAL_SUBMISSION_CHECKLIST.json", "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md"];
  const sourceFiles = [
    "package.json",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_STORE_COMPLIANCE.json",
    "app-store-assets/APP_STORE_COMPLIANCE.md",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json",
    "app-store-assets/APP_REVIEW_BRIEF.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/APPLE_RELEASE_ASSETS.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "scripts/build-final-submission-checklist.cjs",
    "scripts/check-final-submission-checklist.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Final submission checklist freshness sources are missing; run npm run submission-checklist:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to final submission checklist sources`);
    } else {
      warn(`${filePath} is older than one or more final submission checklist sources; run npm run submission-checklist:store`);
    }
  });
}

function checkGeneratedSigningAssetReportFreshness() {
  const generatedFiles = ["app-store-assets/SIGNING_ASSET_REPORT.json", "app-store-assets/SIGNING_ASSET_REPORT.md"];
  const sourceFiles = [
    "package.json",
    "build/entitlements.mas.plist",
    "build/entitlements.mas.inherit.plist",
    "scripts/build-signing-asset-report.cjs",
    "scripts/check-signing-asset-report.cjs",
    "scripts/check-mas-signing.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Signing asset report freshness sources are missing; run npm run signing-assets:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to signing asset report sources`);
    } else {
      warn(`${filePath} is older than one or more signing asset report sources; run npm run signing-assets:store`);
    }
  });
}

function checkGeneratedSigningRunbookFreshness() {
  const generatedFiles = ["app-store-assets/SIGNING_UPLOAD_RUNBOOK.json", "app-store-assets/SIGNING_UPLOAD_RUNBOOK.md"];
  const sourceFiles = [
    "package.json",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "scripts/build-signing-upload-runbook.cjs",
    "scripts/check-signing-upload-runbook.cjs",
    "scripts/build-signing-asset-report.cjs",
    "scripts/check-signing-asset-report.cjs",
    "scripts/check-public-release-sync.cjs",
    "scripts/check-public-site-published.cjs"
  ].filter(exists);

  if (sourceFiles.length === 0) {
    warn("Signing/upload runbook freshness sources are missing; run npm run signing-runbook:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  generatedFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      fail(`${filePath} is missing`);
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to signing/upload runbook sources`);
    } else {
      warn(`${filePath} is older than one or more signing/upload runbook sources; run npm run signing-runbook:store`);
    }
  });
}

function checkGeneratedStoreSite() {
  const siteFiles = [
    "app-store-assets/site/index.html",
    "app-store-assets/site/privacy.html",
    "app-store-assets/site/support.html",
    "app-store-assets/site/accessibility.html",
    "app-store-assets/site/third-party-notices.html",
    "app-store-assets/site/robots.txt",
    "app-store-assets/site/sitemap.xml",
    "app-store-assets/site/README.txt",
    "app-store-assets/site/_headers",
    "app-store-assets/site/vercel.json"
  ];
  const sourceFiles = [
    "app-store-assets/APP_STORE_LISTING.md",
    "app-store-assets/PRIVACY_POLICY.md",
    "app-store-assets/SUPPORT.md",
    "app-store-assets/ACCESSIBILITY.md",
    "app-store-assets/THIRD_PARTY_NOTICES.md",
    "scripts/build-store-site.cjs",
    "scripts/check-store-site.cjs",
    "scripts/store-env.cjs"
  ].filter(exists);

  if (!exists("app-store-assets/site")) {
    warn("Generated support/privacy site is missing. Run npm run site:store before publishing public URLs.");
    return;
  }

  siteFiles.forEach((filePath) => {
    assert(exists(filePath), `${filePath} exists`);
  });

  run("node", ["scripts/check-store-site.cjs"]);
  pass("Generated store site validation passes");

  if (
    !exists("app-store-assets/site/privacy.html") ||
    !exists("app-store-assets/site/support.html") ||
    !exists("app-store-assets/site/accessibility.html") ||
    !exists("app-store-assets/site/third-party-notices.html") ||
    !exists("app-store-assets/site/robots.txt") ||
    !exists("app-store-assets/site/sitemap.xml") ||
    !exists("app-store-assets/site/_headers") ||
    !exists("app-store-assets/site/vercel.json")
  ) {
    return;
  }

  const indexHtml = readText("app-store-assets/site/index.html");
  const privacyHtml = readText("app-store-assets/site/privacy.html");
  const supportHtml = readText("app-store-assets/site/support.html");
  const accessibilityHtml = readText("app-store-assets/site/accessibility.html");
  const noticesHtml = readText("app-store-assets/site/third-party-notices.html");
  const robotsTxt = readText("app-store-assets/site/robots.txt");
  const sitemapXml = readText("app-store-assets/site/sitemap.xml");
  const headersTxt = readText("app-store-assets/site/_headers");
  const vercelJson = readText("app-store-assets/site/vercel.json");

  assert(indexHtml.includes("Cody Cartridge"), "Generated site homepage includes app name");
  assert(privacyHtml.includes("does not collect personal data"), "Generated privacy page includes no-collection statement");
  assert(supportHtml.includes("Use File &gt; Import Audio Files"), "Generated support page includes import instructions");
  assert(accessibilityHtml.includes("Reduced Motion"), "Generated accessibility page includes Reduced Motion support");
  assert(noticesHtml.includes("Third-Party Notices"), "Generated third-party notices page includes notices title");
  assert(noticesHtml.includes("react"), "Generated third-party notices page includes dependency inventory");
  assert(robotsTxt.includes("User-agent: *") && robotsTxt.includes("Sitemap:"), "Generated public site includes robots.txt");
  assert(
    sitemapXml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') &&
      ["index.html", "privacy.html", "support.html", "accessibility.html", "third-party-notices.html"].every((fileName) =>
        sitemapXml.includes(`/${fileName}`)
      ),
    "Generated public site includes sitemap.xml with every public page"
  );
  assert(headersTxt.includes("Content-Type: text/html; charset=utf-8"), "Generated public site includes static host _headers file");
  assert(
    vercelJson.includes('"headers"') && vercelJson.includes("text/html; charset=utf-8"),
    "Generated public site includes Vercel static host config"
  );

  const combined = `${indexHtml}\n${privacyHtml}\n${supportHtml}\n${accessibilityHtml}\n${noticesHtml}\n${robotsTxt}\n${sitemapXml}\n${headersTxt}\n${vercelJson}`;

  if (combined.includes("TODO_SUPPORT_EMAIL") || combined.includes("you@example.com")) {
    warn("Generated support/privacy site still uses placeholder support email.");
  }

  if (combined.includes("TODO_PUBLIC_SITE_URL") || combined.includes("https://example.com")) {
    warn("Generated support/privacy site still uses placeholder public URL.");
  }

  if (sourceFiles.length === 0) {
    warn("Generated support/privacy site freshness sources are missing; run npm run site:store");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  siteFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to generated public site sources`);
    } else {
      warn(`${filePath} is older than generated public site sources; run npm run site:store`);
    }
  });
}

function checkPublicSiteArchive() {
  const archiveFiles = [
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json"
  ];
  const sourceFiles = [
    "app-store-assets/site/index.html",
    "app-store-assets/site/privacy.html",
    "app-store-assets/site/support.html",
    "app-store-assets/site/accessibility.html",
    "app-store-assets/site/third-party-notices.html",
    "app-store-assets/site/robots.txt",
    "app-store-assets/site/sitemap.xml",
    "app-store-assets/site/README.txt",
    "app-store-assets/site/_headers",
    "app-store-assets/site/vercel.json",
    "scripts/build-public-site-archive.cjs",
    "scripts/store-env.cjs",
    "scripts/check-public-site-archive.cjs"
  ].filter(exists);

  archiveFiles.forEach((filePath) => {
    assert(exists(filePath), `${filePath} exists`);
  });

  if (strict) {
    runNestedCheck(
      "node",
      ["scripts/check-public-site-archive.cjs", "--strict"],
      "Public site archive validation passes",
      "Public site archive strict validation failed"
    );
  } else {
    run("node", ["scripts/check-public-site-archive.cjs"]);
    pass("Public site archive validation passes");
  }

  if (exists("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json")) {
    const manifest = readJson("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json");
    const placeholderFiles = manifest.placeholders?.files ?? [];

    if (manifest.placeholders?.supportEmail || manifest.placeholders?.siteUrl || placeholderFiles.length > 0) {
      warn(
        `Public site archive still uses placeholder publish values${
          placeholderFiles.length > 0 ? ` in ${placeholderFiles.join(", ")}` : ""
        }.`
      );
    } else {
      pass("Public site archive has publish-ready URL and contact values");
    }
  }

  if (sourceFiles.length === 0) {
    warn("Public site archive freshness sources are missing; run npm run site:store && npm run site:archive");
    return;
  }

  const newestSource = Math.max(...sourceFiles.map(mtimeMs));

  archiveFiles.forEach((filePath) => {
    if (!exists(filePath)) {
      return;
    }

    if (mtimeMs(filePath) + 1000 >= newestSource) {
      pass(`${filePath} is fresh relative to generated public site sources`);
    } else {
      warn(`${filePath} is older than generated public site sources; run npm run site:archive`);
    }
  });
}

function checkElectronShell() {
  const main = readText("electron/main.cjs");
  const preload = readText("electron/preload.cjs");
  const app = readText("src/App.tsx");
  const viteEnv = readText("src/vite-env.d.ts");

  assert(main.includes("Menu.buildFromTemplate"), "Electron native menu is built");
  assert(main.includes("CODY_FORCE_DIST"), "Electron shell supports forced production-dist smoke mode");
  assert(main.includes("CODY_SHELL_SMOKE"), "Electron shell supports runtime shell smoke mode");
  assert(main.includes("CODY_SHELL_SMOKE_USER_DATA_DIR"), "Electron shell supports isolated smoke userData");
  assert(main.includes("CODY_SHELL_SMOKE_RESET_PROBE"), "Electron shell supports clean-profile reset probe");
  assert(main.includes("runShellSmoke"), "Electron shell includes runtime smoke assertions");
  assert(main.includes("scheme: \"cody-app\""), "Electron shell registers custom app protocol");
  assert(main.includes("protocol.handle(\"cody-app\""), "Electron shell handles custom app protocol");
  assert(main.includes("getAppProtocolFilePath"), "Electron shell guards custom app protocol path resolution");
  assert(main.includes("loadURL(getRendererUrl())"), "Electron shell loads packaged renderer through custom app protocol");
  assert(main.includes("Import Audio Files..."), "Native menu includes audio file import");
  assert(main.includes("Import Music Folder..."), "Native menu includes folder import");
  assert(main.includes("Import YouTube Music Takeout..."), "Native menu includes Takeout import");
  assert(main.includes("Reset Local Library..."), "Native menu includes local library reset");
  assert(main.includes("clearSecurityScopedBookmarks"), "Electron shell can clear stored security-scoped bookmarks");
  assert(main.includes("Privacy Summary"), "Native menu includes privacy summary");
  assert(main.includes("Privacy Policy"), "Native menu includes privacy policy");
  assert(main.includes("Support"), "Native menu includes support");
  assert(main.includes("Accessibility"), "Native menu includes accessibility");
  assert(main.includes("Third-Party Notices"), "Native menu includes third-party notices");
  assert(main.includes("readBundledMarkdown"), "Electron shell can read bundled markdown documents");
  assert(main.includes("contextIsolation: true"), "BrowserWindow keeps context isolation enabled");
  assert(main.includes("nodeIntegration: false"), "BrowserWindow keeps node integration disabled");
  assert(main.includes("sandbox: true"), "BrowserWindow keeps renderer sandbox enabled");
  assert(main.includes("setPermissionRequestHandler"), "Electron shell denies permission requests");
  assert(main.includes("setWindowOpenHandler"), "Electron shell denies new window requests");
  assert(main.includes("will-navigate"), "Electron shell guards top-level navigation");
  assert(main.includes("withTrustedRenderer"), "Electron shell guards music IPC handlers by trusted renderer");
  assert((main.match(/ipcMain\.handle\("music:[^"]+", withTrustedRenderer/g) ?? []).length === 8, "All music IPC handlers use trusted renderer guard");
  assert(main.includes("filterRendererProvidedPaths"), "Electron shell filters renderer-provided file paths");
  assert(main.includes("findSecurityScopedBookmark(filePath)"), "MAS renderer-provided paths require stored security-scoped bookmarks");
  assert(main.includes("function isAllowedMediaPath(filePath)"), "Electron shell centralizes media path access policy");
  assert(main.includes("return filePaths.filter(isAllowedMediaPath);"), "Renderer-provided path filtering reuses media path access policy");
  assert(
    (main.match(/if \(!isAllowedMediaPath\(mediaPath\)\) {\n\s+return new Response\("", { status: 404 }\);\n\s+}/g) ?? []).length === 2,
    "Custom media/art protocol handlers reject paths before filesystem access"
  );
  assert(
    main.includes("music:import-audio-paths\", withTrustedRenderer(async (_event, filePaths) => {\n    const safePaths = filterRendererProvidedPaths(filePaths);"),
    "Renderer audio path imports use MAS-aware path filter"
  );
  assert(
    main.includes("music:read-takeout-csv-paths\", withTrustedRenderer(async (_event, filePaths) => {\n    const safePaths = filterRendererProvidedPaths(filePaths);"),
    "Renderer Takeout CSV path imports use MAS-aware path filter"
  );
  assert(preload.includes("onMenuCommand"), "Preload exposes narrow menu command bridge");
  assert(viteEnv.includes("onMenuCommand"), "Renderer type contract includes menu command bridge");
  assert(app.includes("window.musicHost.onMenuCommand"), "Renderer handles native menu commands");
  assert(viteEnv.includes("reset-local-library"), "Renderer type contract includes reset menu command");
  assert(app.includes("resetLocalLibraryState"), "Renderer implements local library reset");
  assert(app.includes("window.localStorage.removeItem(storageKey)"), "Renderer clears local storage during reset");
}

function checkPackagedBundleIfPresent() {
  const pkg = readJson("package.json");
  const expectedBuildVersion = pkg.build?.buildVersion ?? pkg.version;
  const appRoot = "dist/mas-arm64/Cody Cartridge.app";
  const absoluteAppRoot = path.join(projectRoot, appRoot);
  const infoPath = `${appRoot}/Contents/Info.plist`;
  const resourcesPath = `${appRoot}/Contents/Resources`;

  if (!exists(appRoot)) {
    warn("MAS app bundle is not present. Run the MAS package boundary check before final submission.");
    return;
  }

  lintPlist(infoPath);
  assert(exists(`${resourcesPath}/icon.icns`), "Packaged MAS app contains icon.icns");
  assert(exists(`${resourcesPath}/PrivacyInfo.xcprivacy`), "Packaged MAS app contains PrivacyInfo.xcprivacy");
  assert(exists(`${resourcesPath}/PRIVACY_POLICY.md`), "Packaged MAS app contains privacy policy markdown");
  assert(exists(`${resourcesPath}/SUPPORT.md`), "Packaged MAS app contains support markdown");
  assert(exists(`${resourcesPath}/ACCESSIBILITY.md`), "Packaged MAS app contains accessibility markdown");
	  assert(exists(`${resourcesPath}/THIRD_PARTY_NOTICES.md`), "Packaged MAS app contains third-party notice markdown");
	  assert(exists(`${resourcesPath}/THIRD_PARTY_NOTICES.json`), "Packaged MAS app contains third-party notice JSON");
	  assert(exists(`${resourcesPath}/app.asar`), "Packaged MAS app contains app.asar");
  if (exists(`${appRoot}/Contents/embedded.provisionprofile`)) {
    pass("Packaged MAS app contains embedded provisioning profile");
  } else {
    warn("Packaged MAS app does not contain an embedded provisioning profile");
  }

  const info = plistToJson(infoPath);
  assert(info.CFBundleIdentifier === "com.sachittumuluri.codycartridge", "Packaged bundle id matches package config");
  assert(info.CFBundleShortVersionString === pkg.version, "Packaged short version matches package version");
  assert(info.CFBundleVersion === expectedBuildVersion, "Packaged build version matches package config");
  assert(info.CFBundleIconFile === "icon.icns", "Packaged bundle points to icon.icns");
  assert(info.LSApplicationCategoryType === "public.app-category.music", "Packaged bundle category is Music");
  assert(info.LSMinimumSystemVersion === "12.0", "Packaged minimum macOS version is 12.0");
  assert(info.ITSAppUsesNonExemptEncryption === false, "Packaged Info.plist declares no non-exempt encryption");

  [
    "NSAppTransportSecurity",
    "NSAudioCaptureUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription"
  ].forEach((key) => {
    assert(!(key in info), `Packaged Info.plist does not include ${key}`);
  });

  const asarList = run(path.join(projectRoot, "node_modules", ".bin", "asar"), ["list", `${resourcesPath}/app.asar`]);
  assert(asarList.includes("/dist/index.html"), "Packaged asar contains dist/index.html");
  assert(asarList.includes("/electron/main.cjs"), "Packaged asar contains Electron main");
  assert(asarList.includes("/electron/preload.cjs"), "Packaged asar contains Electron preload");

  const fuseOutput = run(path.join(projectRoot, "node_modules", ".bin", "electron-fuses"), ["read", "--app", absoluteAppRoot]);
  assert(fuseOutput.includes("RunAsNode is Disabled"), "Packaged Electron fuse disables ELECTRON_RUN_AS_NODE");
  assert(fuseOutput.includes("EnableCookieEncryption is Enabled"), "Packaged Electron fuse enables cookie encryption");
  assert(fuseOutput.includes("EnableNodeOptionsEnvironmentVariable is Disabled"), "Packaged Electron fuse disables NODE_OPTIONS");
  assert(fuseOutput.includes("EnableNodeCliInspectArguments is Disabled"), "Packaged Electron fuse disables Node inspector CLI arguments");
  assert(fuseOutput.includes("EnableEmbeddedAsarIntegrityValidation is Enabled"), "Packaged Electron fuse enables ASAR integrity validation");
  assert(fuseOutput.includes("OnlyLoadAppFromAsar is Enabled"), "Packaged Electron fuse restricts app loading to app.asar");
  assert(
    fuseOutput.includes("LoadBrowserProcessSpecificV8Snapshot is Disabled"),
    "Packaged Electron fuse does not require a missing browser-process V8 snapshot"
  );
  assert(fuseOutput.includes("GrantFileProtocolExtraPrivileges is Disabled"), "Packaged Electron fuse disables file protocol extra privileges");

  if (strict) {
    tryRun(
      "codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", absoluteAppRoot],
      "Packaged MAS app code signature verifies",
      "Packaged MAS app code signature does not verify"
    );
  }
}

function checkStrictReleaseGates() {
  if (!strict) {
    return;
  }

  runNestedCheck(
    "node",
    ["scripts/check-public-release-sync.cjs", "--strict"],
    "Public release sync strict check passes",
    "Public release sync strict check failed"
  );
  runNestedCheck(
    "node",
    ["scripts/check-mas-signing.cjs", "--strict"],
    "MAS signing strict preflight passes",
    "MAS signing strict preflight failed"
  );
}

function main() {
  try {
    checkPackageConfig();
    checkSourceAndBuildHtml();
    checkPlists();
    checkAssetsAndSubmissionDocs();
	    checkGeneratedPacketFreshness();
    checkGeneratedAppStoreComplianceFreshness();
    checkGeneratedManualTasksFreshness();
    checkGeneratedCopyMapFreshness();
    checkGeneratedReviewBriefFreshness();
    checkGeneratedReleaseBlockerFreshness();
    checkGeneratedPublicReleaseInputsFreshness();
    checkGeneratedPublicSitePublishPacketFreshness();
    checkGeneratedPublicHostRunbookFreshness();
    checkGeneratedResolutionPlanFreshness();
    checkGeneratedSigningAssetReportFreshness();
    checkGeneratedSigningRunbookFreshness();
    checkGeneratedFinalSubmissionChecklistFreshness();
    checkGeneratedReleaseMachineReportFreshness();
    checkGeneratedUploadCommandPacketFreshness();
    checkGeneratedAppleReleaseAssetsFreshness();
    checkGeneratedUploadEvidenceFreshness();
    checkGeneratedReleaseEvidenceFreshness();
    checkGeneratedReleaseDashboardFreshness();
    checkGeneratedReleaseOperatorQueueFreshness();
    checkGeneratedReleaseManifestFreshness();
    checkGeneratedSubmissionHandoffFreshness();
    checkGeneratedStoreSite();
    checkPublicSiteArchive();
    checkElectronShell();
    checkPackagedBundleIfPresent();
    checkStrictReleaseGates();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  console.log(`Store readiness checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);

  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
