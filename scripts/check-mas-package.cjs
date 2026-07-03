#!/usr/bin/env node

const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const appId = packageJson.build?.appId;
const expectedBuildVersion = packageJson.build?.buildVersion ?? packageJson.version;
const appRoot = path.join(projectRoot, "dist", "mas-arm64", "Cody Cartridge.app");
const distRoot = path.join(projectRoot, "dist");
const relativeAppRoot = path.relative(projectRoot, appRoot);

const passes = [];
const warnings = [];
const failures = [];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  }).trim();
}

function spawn(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function exists(filePath) {
  return fs.existsSync(path.join(projectRoot, filePath));
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

function requireStrict(condition, passMessage, warningMessage = passMessage) {
  if (condition) {
    pass(passMessage);
  } else {
    warn(warningMessage);
  }
}

function lintPlist(filePath) {
  run("plutil", ["-lint", filePath]);
  pass(`${path.relative(projectRoot, filePath)} is valid plist`);
}

function plistToJson(filePath) {
  return JSON.parse(run("plutil", ["-convert", "json", "-o", "-", filePath]));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function flatten(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value.flatMap(flatten) : [String(value)];
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(String(value));
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function formatDate(date) {
  return date ? date.toISOString().slice(0, 10) : "unknown";
}

function appIdentifierMatches(identifier) {
  if (!identifier || !appId) {
    return false;
  }

  return identifier === appId || identifier.endsWith(`.${appId}`);
}

function listFilesByExtension(rootPath, extension) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const matches = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    entries.forEach((entry) => {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        return;
      }

      if (entry.isFile() && entry.name.endsWith(extension)) {
        matches.push(entryPath);
      }
    });
  }

  return matches.sort();
}

function getProfileTeamIds(profile, entitlements) {
  return [
    ...flatten(profile.TeamIdentifier),
    ...flatten(profile.ApplicationIdentifierPrefix),
    ...flatten(entitlements["com.apple.developer.team-identifier"])
  ].filter(Boolean);
}

function getMasUploadPackages() {
  return listFilesByExtension(distRoot, ".pkg").filter((filePath) => {
    const baseName = path.basename(filePath).toLowerCase();
    return baseName.includes("cody") || baseName.includes("cartridge");
  });
}

function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function currentPackageTokens() {
  return [...new Set([packageJson.version, expectedBuildVersion].filter(Boolean))];
}

function packageMatchesCurrentApp(relativePath) {
  const fileName = path.basename(relativePath).toLowerCase();
  const normalizedFileName = normalizeToken(fileName);

  return currentPackageTokens().some((token) => {
    const normalizedToken = normalizeToken(token);

    return fileName.includes(String(token).toLowerCase()) || Boolean(normalizedToken && normalizedFileName.includes(normalizedToken));
  });
}

function assertSameFile(sourceRelativePath, packagedRelativePath, message) {
  const sourcePath = path.join(projectRoot, sourceRelativePath);
  const packagedPath = path.join(projectRoot, packagedRelativePath);

  assert(fs.existsSync(sourcePath), `${sourceRelativePath} exists`);
  assert(fs.existsSync(packagedPath), `${packagedRelativePath} exists`);

  if (fs.existsSync(sourcePath) && fs.existsSync(packagedPath)) {
    assert(sha256(sourcePath) === sha256(packagedPath), message);
  }
}

function checkRelativeSymlink(linkPath, expectedTarget, label) {
  if (!fs.existsSync(linkPath)) {
    fail(`${label} symlink is missing`);
    return;
  }

  const stat = fs.lstatSync(linkPath);
  assert(stat.isSymbolicLink(), `${label} is a symlink`);

  if (!stat.isSymbolicLink()) {
    return;
  }

  const target = fs.readlinkSync(linkPath);
  assert(target === expectedTarget, `${label} points to ${expectedTarget}`);
  assert(!path.isAbsolute(target), `${label} symlink target is relative`);
  assert(fs.existsSync(path.resolve(path.dirname(linkPath), target)), `${label} symlink target exists`);
}

function checkElectronFrameworkSymlinks() {
  const frameworkRoot = path.join(appRoot, "Contents", "Frameworks", "Electron Framework.framework");

  if (!fs.existsSync(frameworkRoot)) {
    fail("Packaged MAS app is missing Electron Framework.framework");
    return;
  }

  checkRelativeSymlink(
    path.join(frameworkRoot, "Electron Framework"),
    "Versions/Current/Electron Framework",
    "Electron Framework binary"
  );
  checkRelativeSymlink(path.join(frameworkRoot, "Libraries"), "Versions/Current/Libraries", "Electron Framework Libraries");
  checkRelativeSymlink(path.join(frameworkRoot, "Resources"), "Versions/Current/Resources", "Electron Framework Resources");
  checkRelativeSymlink(path.join(frameworkRoot, "Versions", "Current"), "A", "Electron Framework Current version");
}

function parsePlistXml(xml, label) {
  const start = xml.indexOf("<?xml");
  const fallbackStart = xml.indexOf("<plist");
  const plistStart = start >= 0 ? start : fallbackStart;

  if (plistStart < 0) {
    throw new Error(`${label} did not include plist XML`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cody-mas-package-"));
  const tmpPath = path.join(tmpDir, `${label}.plist`);

  try {
    fs.writeFileSync(tmpPath, xml.slice(plistStart));
    return plistToJson(tmpPath);
  } finally {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  }
}

function decodeProvisioningProfile(filePath) {
  const result = spawn("security", ["cms", "-D", "-i", filePath]);

  if (result.status !== 0 || result.error) {
    warn(`Unable to decode embedded provisioning profile: ${result.error?.message || (result.stderr || result.stdout).trim()}`);
    return null;
  }

  try {
    const profile = parsePlistXml(result.stdout, "embedded-provisionprofile");
    const entitlements = profile.Entitlements ?? {};
    const applicationIdentifier =
      entitlements["application-identifier"] ?? entitlements["com.apple.application-identifier"] ?? "";
    const expirationDate = parseDate(profile.ExpirationDate);
    const provisionedDevices = Array.isArray(profile.ProvisionedDevices) ? profile.ProvisionedDevices : [];
    const getTaskAllow =
      entitlements["get-task-allow"] === true || entitlements["com.apple.security.get-task-allow"] === true;
    const platform = flatten(profile.Platform);

    return {
      applicationIdentifier,
      entitlements,
      expirationDate,
      getTaskAllow,
      isDistributionCandidate: provisionedDevices.length === 0 && !getTaskAllow,
      isExpired: expirationDate ? expirationDate.getTime() <= Date.now() : true,
      isMacPlatformProfile: platform.some((item) => /^(OSX|macOS)$/i.test(item)),
      name: profile.Name ?? path.basename(filePath),
      platform,
      provisionedDeviceCount: provisionedDevices.length,
      teamIds: getProfileTeamIds(profile, entitlements),
      uuid: profile.UUID ?? path.basename(filePath, path.extname(filePath)),
      matchesBundleId: appIdentifierMatches(applicationIdentifier)
    };
  } catch (error) {
    warn(`Unable to parse embedded provisioning profile: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function checkBundleStructure() {
  const infoPath = path.join(appRoot, "Contents", "Info.plist");
  const resourcesPath = path.join(appRoot, "Contents", "Resources");
  const appAsarPath = path.join(resourcesPath, "app.asar");

  lintPlist(infoPath);

  [
    "icon.icns",
    "PrivacyInfo.xcprivacy",
    "PRIVACY_POLICY.md",
    "SUPPORT.md",
    "ACCESSIBILITY.md",
    "THIRD_PARTY_NOTICES.md",
    "THIRD_PARTY_NOTICES.json",
    "app.asar"
  ].forEach((fileName) => {
    assert(fs.existsSync(path.join(resourcesPath, fileName)), `Packaged MAS app contains ${fileName}`);
  });

  assertSameFile(
    "build/PrivacyInfo.xcprivacy",
    "dist/mas-arm64/Cody Cartridge.app/Contents/Resources/PrivacyInfo.xcprivacy",
    "Packaged privacy manifest matches source privacy manifest"
  );
  assertSameFile(
    "app-store-assets/PRIVACY_POLICY.md",
    "dist/mas-arm64/Cody Cartridge.app/Contents/Resources/PRIVACY_POLICY.md",
    "Packaged privacy policy matches source privacy policy"
  );
  assertSameFile(
    "app-store-assets/SUPPORT.md",
    "dist/mas-arm64/Cody Cartridge.app/Contents/Resources/SUPPORT.md",
    "Packaged support document matches source support document"
  );

  const info = plistToJson(infoPath);
  assert(info.CFBundleIdentifier === packageJson.build?.appId, "Packaged bundle id matches package config");
  assert(info.CFBundleShortVersionString === packageJson.version, "Packaged short version matches package version");
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

  const asarList = run(path.join(projectRoot, "node_modules", ".bin", "asar"), ["list", appAsarPath]);
  assert(asarList.includes("/dist/index.html"), "Packaged app.asar contains dist/index.html");
  assert(asarList.includes("/electron/main.cjs"), "Packaged app.asar contains Electron main");
  assert(asarList.includes("/electron/preload.cjs"), "Packaged app.asar contains Electron preload");
  assert(!asarList.includes("/app-store-assets/screenshots"), "Packaged app.asar excludes App Store screenshots");
    assert(!asarList.includes("/Takeout/"), "Packaged app.asar excludes local Takeout exports");
  assert(!asarList.includes("/music/"), "Packaged app.asar excludes local music folders");

  checkElectronFrameworkSymlinks();
}

function checkFuses() {
  const fuseOutput = run(path.join(projectRoot, "node_modules", ".bin", "electron-fuses"), ["read", "--app", appRoot]);

  [
    ["RunAsNode is Disabled", "Packaged Electron fuse disables ELECTRON_RUN_AS_NODE"],
    ["EnableCookieEncryption is Enabled", "Packaged Electron fuse enables cookie encryption"],
    ["EnableNodeOptionsEnvironmentVariable is Disabled", "Packaged Electron fuse disables NODE_OPTIONS"],
    ["EnableNodeCliInspectArguments is Disabled", "Packaged Electron fuse disables Node inspector CLI arguments"],
    ["EnableEmbeddedAsarIntegrityValidation is Enabled", "Packaged Electron fuse enables ASAR integrity validation"],
    ["OnlyLoadAppFromAsar is Enabled", "Packaged Electron fuse restricts app loading to app.asar"],
    ["LoadBrowserProcessSpecificV8Snapshot is Disabled", "Packaged Electron fuse does not require a missing browser-process V8 snapshot"],
    ["GrantFileProtocolExtraPrivileges is Disabled", "Packaged Electron fuse disables file protocol extra privileges"]
  ].forEach(([needle, message]) => {
    assert(fuseOutput.includes(needle), message);
  });
}

function checkEmbeddedProvisioningProfile() {
  const profilePath = path.join(appRoot, "Contents", "embedded.provisionprofile");

  if (!fs.existsSync(profilePath)) {
    warn("Packaged MAS app does not contain Contents/embedded.provisionprofile");
    return;
  }

  pass("Packaged MAS app contains embedded provisioning profile");

  const profile = decodeProvisioningProfile(profilePath);
  if (!profile) {
    return;
  }

  const expectedEntitlements = plistToJson(path.join(projectRoot, packageJson.build?.mas?.entitlements ?? "build/entitlements.mas.plist"));
  const expectedKeys = [
    "com.apple.security.app-sandbox",
    "com.apple.security.files.user-selected.read-only",
    "com.apple.security.files.bookmarks.app-scope"
  ].filter((key) => expectedEntitlements[key] === true);
  const missingEntitlements = expectedKeys.filter((key) => profile.entitlements[key] !== true);

  assert(profile.matchesBundleId, `Embedded provisioning profile matches bundle id ${appId}`);
  assert(profile.isMacPlatformProfile, "Embedded provisioning profile is for macOS");
  assert(profile.isDistributionCandidate, "Embedded provisioning profile is distribution-style for App Store upload");
  assert(!profile.isExpired, `Embedded provisioning profile is unexpired (expires ${formatDate(profile.expirationDate)})`);
  assert(missingEntitlements.length === 0, "Embedded provisioning profile contains expected sandbox/file-access entitlements");
  assert(profile.teamIds.length > 0, "Embedded provisioning profile includes a team identifier");

  pass(
    `Embedded provisioning profile "${profile.name}" (${profile.uuid}) targets ${profile.applicationIdentifier} on ` +
      `${profile.platform.join(",") || "unknown platform"}`
  );
}

function checkUploadPackage() {
  const uploadPackages = getMasUploadPackages();
  let signedUploadPackageCount = 0;
  let currentVersionUploadPackageCount = 0;
  let signedCurrentVersionUploadPackageCount = 0;

  if (uploadPackages.length === 0) {
    warn("No MAS upload .pkg artifact found in dist; Transporter upload expects a signed current-version installer package");
    return;
  }

  pass(`Found ${uploadPackages.length} MAS upload .pkg artifact(s)`);

  uploadPackages.forEach((packagePath) => {
    const relativePackagePath = path.relative(projectRoot, packagePath);
    const matchesCurrentVersion = packageMatchesCurrentApp(relativePackagePath);
    const sizeBytes = fs.statSync(packagePath).size;
    let signatureOk = false;

    assert(sizeBytes > 0, `${relativePackagePath} is not empty`);

    const signature = spawn("pkgutil", ["--check-signature", packagePath]);
    if (signature.status === 0) {
      signatureOk = true;
      signedUploadPackageCount += 1;
      pass(`${relativePackagePath} package signature verifies`);
    } else {
      warn(`${relativePackagePath} package signature does not verify`);
    }

    if (matchesCurrentVersion) {
      currentVersionUploadPackageCount += 1;
      pass(`${relativePackagePath} package matches current package version/build`);

      if (signatureOk) {
        signedCurrentVersionUploadPackageCount += 1;
        pass(`${relativePackagePath} signed package matches current package version/build`);
      }
    } else {
      warn(
        `${relativePackagePath} package does not match current package version/build ` +
          `${packageJson.version}/${expectedBuildVersion}; remove stale packages before upload`
      );
    }

    const payload = spawn("pkgutil", ["--payload-files", packagePath]);
    if (payload.status !== 0 || payload.error) {
      warn(`${relativePackagePath} package payload could not be inspected`);
      return;
    }

    const payloadFiles = payload.stdout.split(/\r?\n/);
    assert(
      payloadFiles.some((item) => item.includes("Cody Cartridge.app/Contents/Info.plist")),
      `${relativePackagePath} payload contains Cody Cartridge.app Info.plist`
    );
    assert(
      payloadFiles.some((item) => item.includes("Cody Cartridge.app/Contents/embedded.provisionprofile")),
      `${relativePackagePath} payload contains Cody Cartridge.app embedded provisioning profile`
    );
    assert(
      payloadFiles.some((item) => item.includes("Cody Cartridge.app/Contents/Resources/app.asar")),
      `${relativePackagePath} payload contains Cody Cartridge.app app.asar`
    );
  });

  if (signedUploadPackageCount > 0) {
    pass(`Found ${signedUploadPackageCount} signed MAS upload .pkg artifact(s)`);
  } else {
    warn("No signed MAS .pkg upload artifact found in dist; run npm run dist:mas on the release machine before upload");
  }

  if (currentVersionUploadPackageCount > 0) {
    pass(`Found ${currentVersionUploadPackageCount} current-version MAS upload .pkg artifact(s)`);
  } else {
    warn("No MAS .pkg upload artifact matches the current package version/build; remove stale packages and rerun npm run dist:mas");
  }

  if (signedCurrentVersionUploadPackageCount > 0) {
    pass(`Found ${signedCurrentVersionUploadPackageCount} signed current-version MAS upload .pkg artifact(s)`);
  } else {
    warn("No signed current-version MAS upload .pkg artifact found in dist; rerun npm run dist:mas and verify the generated package");
  }
}

function checkSignature() {
  const verify = spawn("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appRoot]);

  if (verify.status === 0) {
    pass("Packaged MAS app code signature verifies");
  } else {
    warn("Packaged MAS app code signature does not verify");
    return;
  }

  const entitlementsResult = spawn("codesign", ["-d", "--entitlements", ":-", appRoot]);
  const entitlementsXml = `${entitlementsResult.stdout ?? ""}\n${entitlementsResult.stderr ?? ""}`;

  if (entitlementsResult.status !== 0) {
    warn("Unable to read packaged MAS app entitlements");
    return;
  }

  try {
    const entitlements = parsePlistXml(entitlementsXml, "entitlements");
    requireStrict(
      entitlements["com.apple.security.app-sandbox"] === true,
      "Packaged MAS app signature includes sandbox entitlement",
      "Packaged MAS app signature is missing sandbox entitlement"
    );
    requireStrict(
      entitlements["com.apple.security.files.user-selected.read-only"] === true,
      "Packaged MAS app signature includes user-selected read-only file entitlement",
      "Packaged MAS app signature is missing user-selected read-only file entitlement"
    );
    requireStrict(
      entitlements["com.apple.security.files.bookmarks.app-scope"] === true,
      "Packaged MAS app signature includes app-scoped bookmark entitlement",
      "Packaged MAS app signature is missing app-scoped bookmark entitlement"
    );
    assert(!entitlements["com.apple.security.network.client"], "Packaged MAS app signature does not include network client entitlement");
  } catch (error) {
    warn(`Unable to parse packaged MAS app entitlements: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main() {
  if (!fs.existsSync(appRoot)) {
    warn(`MAS app bundle is missing at ${relativeAppRoot}; run npm run dist:mas on the release machine before upload.`);
  } else {
    checkBundleStructure();
    checkFuses();
    checkEmbeddedProvisioningProfile();
    checkUploadPackage();
    checkSignature();
  }

  console.log(`MAS package boundary checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));
  failures.forEach((message) => console.error(`FAIL ${message}`));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
