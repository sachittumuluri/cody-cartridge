#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const failures = [];
const passes = [];

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function plistToJson(relativePath) {
  return JSON.parse(run("plutil", ["-convert", "json", "-o", "-", relativePath]));
}

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

function flattenText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function includes(value, needle) {
  return flattenText(value).includes(needle.toLowerCase());
}

function findAccessedApiReasons(privacy, type) {
  const accessedTypes = privacy.NSPrivacyAccessedAPITypes ?? [];
  return accessedTypes.find((item) => item.NSPrivacyAccessedAPIType === type)?.NSPrivacyAccessedAPITypeReasons ?? [];
}

function checkPrivacyManifest() {
  run("plutil", ["-lint", "build/PrivacyInfo.xcprivacy"]);
  pass("PrivacyInfo.xcprivacy is valid plist");

  const privacy = plistToJson("build/PrivacyInfo.xcprivacy");
  const accessedTypes = privacy.NSPrivacyAccessedAPITypes ?? [];
  const accessedTypeNames = accessedTypes.map((item) => item.NSPrivacyAccessedAPIType);

  assert(privacy.NSPrivacyTracking === false, "Privacy manifest declares no tracking");
  assert(Array.isArray(privacy.NSPrivacyTrackingDomains) && privacy.NSPrivacyTrackingDomains.length === 0, "Privacy manifest has no tracking domains");
  assert(Array.isArray(privacy.NSPrivacyCollectedDataTypes) && privacy.NSPrivacyCollectedDataTypes.length === 0, "Privacy manifest declares no collected data types");
  assert(accessedTypeNames.length === 3, "Privacy manifest declares only the expected required-reason API categories");
  assert(accessedTypeNames.includes("NSPrivacyAccessedAPICategoryFileTimestamp"), "Privacy manifest declares file timestamp access");
  assert(accessedTypeNames.includes("NSPrivacyAccessedAPICategoryUserDefaults"), "Privacy manifest declares UserDefaults access");
  assert(accessedTypeNames.includes("NSPrivacyAccessedAPICategorySystemBootTime"), "Privacy manifest declares system boot time access");
  assert(
    findAccessedApiReasons(privacy, "NSPrivacyAccessedAPICategoryFileTimestamp").includes("3B52.1") &&
      findAccessedApiReasons(privacy, "NSPrivacyAccessedAPICategoryFileTimestamp").includes("C617.1"),
    "Privacy manifest file timestamp reasons cover user-selected and app-container files"
  );
  assert(
    findAccessedApiReasons(privacy, "NSPrivacyAccessedAPICategoryUserDefaults").includes("CA92.1"),
    "Privacy manifest UserDefaults reason covers app-local state"
  );
  assert(
    findAccessedApiReasons(privacy, "NSPrivacyAccessedAPICategorySystemBootTime").includes("35F9.1"),
    "Privacy manifest system boot time reason covers timers"
  );
}

function checkEntitlementsAndPackaging() {
  const pkg = readJson("package.json");
  const entitlements = plistToJson("build/entitlements.mas.plist");
  const inherit = plistToJson("build/entitlements.mas.inherit.plist");
  const extendInfo = pkg.build?.mac?.extendInfo ?? {};
  const extraResources = JSON.stringify(pkg.build?.extraResources ?? []);

  assert(entitlements["com.apple.security.app-sandbox"] === true, "MAS sandbox entitlement is enabled");
  assert(entitlements["com.apple.security.files.user-selected.read-only"] === true, "MAS file access is user-selected read-only");
  assert(entitlements["com.apple.security.files.bookmarks.app-scope"] === true, "MAS app-scoped bookmarks are enabled");
  assert(!entitlements["com.apple.security.network.client"], "MAS network client entitlement is not enabled");
  assert(inherit["com.apple.security.app-sandbox"] === true && inherit["com.apple.security.inherit"] === true, "Child helper inherits sandbox entitlement");
  assert(extraResources.includes("build/PrivacyInfo.xcprivacy"), "Privacy manifest is packaged as an extra resource");

  [
    "NSAudioCaptureUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription"
  ].forEach((key) => {
    assert(Object.prototype.hasOwnProperty.call(extendInfo, key) && extendInfo[key] === null, `${key} is stripped from packaged Info.plist`);
  });
}

function checkGeneratedPrivacyAnswers() {
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const privacy = fields.privacy ?? {};
  const rights = fields.rightsAndCompliance ?? {};

  assert(includes(privacy.appPrivacyDataCollection, "does not collect data"), "App Store privacy answer says no data collection");
  assert(privacy.tracking === "No tracking.", "App Store privacy answer says no tracking");
  assert(privacy.trackingDomains === "None.", "App Store privacy answer says no tracking domains");
  assert(privacy.dataSentOffDeviceByDeveloperApp === "None.", "App Store privacy answer says no developer data export");
  assert(includes(privacy.localDataProcessed, "Selected audio files"), "App Store privacy answer lists selected audio files as local data");
  assert(includes(privacy.localDataProcessed, "YouTube Music Takeout CSV"), "App Store privacy answer lists user-imported Takeout CSV data");
  assert(includes(privacy.localDataProcessed, "security-scoped bookmarks"), "App Store privacy answer lists local security-scoped bookmarks");
  assert(includes(privacy.privacyManifestSummary, "no tracking"), "App Store privacy answer summarizes no tracking");
  assert(includes(privacy.privacyManifestSummary, "no collected data"), "App Store privacy answer summarizes no collected data");
  assert(includes(rights.contentRights, "ships without music"), "Content-rights answer says the app ships without music");
  assert(includes(rights.contentRights, "plays only user-selected files"), "Content-rights answer says playback is user-selected files only");
}

function checkPolicyDocs() {
  const privacyPolicy = readText("app-store-assets/PRIVACY_POLICY.md");
  const support = readText("app-store-assets/SUPPORT.md");
  const listing = readText("app-store-assets/APP_STORE_LISTING.md");

  assert(includes(privacyPolicy, "does not collect personal data"), "Privacy policy says no personal data collection");
  assert(includes(privacyPolicy, "does not transmit your music library"), "Privacy policy says music library is not transmitted");
  assert(includes(privacyPolicy, "does not track you"), "Privacy policy says no tracking");
  assert(includes(privacyPolicy, "does not include advertising SDKs, analytics SDKs"), "Privacy policy says no ad or analytics SDKs");
  assert(includes(privacyPolicy, "does not provide, download, scrape, or redistribute music"), "Privacy policy says no music download/scraping/redistribution");
  assert(includes(privacyPolicy, "File > Reset Local Library"), "Privacy policy documents local data reset");
  assert(includes(support, "does not download, scrape, or redistribute music"), "Support page says no music download/scraping/redistribution");
  assert(includes(listing, "does not download music, scrape streaming services"), "Listing description says no music download/scraping");
  assert(includes(listing, "does not download music, scrape YouTube Music"), "Review notes say no YouTube Music download/scraping");
}

function checkRuntimeAndDependencies() {
  const pkg = readJson("package.json");
  const dependencyNames = Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {})
  });
  const bannedDependencyPatterns = [
    /analytics/i,
    /amplitude/i,
    /appcenter/i,
    /firebase/i,
    /google-analytics/i,
    /mixpanel/i,
    /posthog/i,
    /sentry/i,
    /segment/i,
    /telemetry/i,
    /admob/i
  ];
  const bannedDependencies = dependencyNames.filter((name) => bannedDependencyPatterns.some((pattern) => pattern.test(name)));

  assert(bannedDependencies.length === 0, `Dependencies do not include telemetry/ad SDK packages${bannedDependencies.length ? `: ${bannedDependencies.join(", ")}` : ""}`);

  const sourceText = ["src/App.tsx", "electron/main.cjs", "electron/preload.cjs"]
    .map((filePath) => readText(filePath))
    .join("\n");

  assert(!/navigator\.sendBeacon|XMLHttpRequest/i.test(sourceText), "Runtime source does not use browser beacon or XMLHttpRequest telemetry APIs");
  assert(!/shell\.openExternal|openExternal/i.test(sourceText), "Electron source does not open external URLs");
  assert(!/posthog|mixpanel|amplitude|segment|firebase|google-analytics|admob|sentry/i.test(sourceText), "Runtime source does not reference common analytics/ad SDKs");
  assert(sourceText.includes("function isLocalPlaybackUrl"), "Renderer defines a local playback URL allowlist");
  assert(sourceText.includes("function isDurablePlaybackUrl"), "Renderer separates persistent cody-media URLs from temporary playback URLs");
  assert(sourceText.includes("sanitizeStoredState"), "Renderer sanitizes persisted library state before reuse");
  assert(
    sourceText.includes("if (!isLocalPlaybackUrl(track.url))") && sourceText.includes('fetch(track.url)'),
    "Renderer audio analysis fetch is guarded by the local playback URL allowlist"
  );
  assert(
    sourceText.includes("!track?.url || !isLocalPlaybackUrl(track.url)") && sourceText.includes("audio.src = track.url"),
    "Renderer audio playback assignment is guarded by the local playback URL allowlist"
  );
  assert(
    sourceText.includes("tracks.filter((track) => isDurablePlaybackUrl(track.url))"),
    "Renderer persists only durable cody-media playback URLs"
  );
  assert(sourceText.includes('fetch("/__cody_music__/library")'), "Renderer demo library fetch is local to the app origin");
  assert(sourceText.includes("cody-media://track/"), "Runtime uses cody-media for local playback");
  assert(sourceText.includes("cody-art://track/"), "Runtime uses cody-art for local artwork");

  const remoteUrlMatches = [...sourceText.matchAll(/https:\/\/[^"`'\s)]+/g)].map((match) => match[0]);
  const unexpectedRemoteUrls = remoteUrlMatches.filter((url) => !url.startsWith("https://music.youtube.com/watch?v="));

  assert(unexpectedRemoteUrls.length === 0, `Runtime source has no unexpected remote URLs${unexpectedRemoteUrls.length ? `: ${unexpectedRemoteUrls.join(", ")}` : ""}`);
}

function main() {
  checkPrivacyManifest();
  checkEntitlementsAndPackaging();
  checkGeneratedPrivacyAnswers();
  checkPolicyDocs();
  checkRuntimeAndDependencies();

  console.log(`App privacy checks: ${passes.length} passed, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
