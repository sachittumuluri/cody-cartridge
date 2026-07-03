#!/usr/bin/env node

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const appId = pkg.build?.appId ?? "";
const entitlementsPath = path.join(projectRoot, pkg.build?.mas?.entitlements ?? "build/entitlements.mas.plist");
const defaultInstallDir = path.join(os.homedir(), "Library", "MobileDevice", "Provisioning Profiles");

function usage() {
  return `Usage:
  npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run
  npm run install:mas-profile -- --file /path/to/profile.provisionprofile

Validates that the profile is an unexpired macOS/Mac App Store distribution profile for ${appId || "<bundle-id>"} before installing it.`;
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function isInsideProject(absolutePath) {
  const relative = path.relative(projectRoot, absolutePath);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    file: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--file") {
      const value = argv[index + 1];
      index += 1;

      if (!value) {
        throw new Error("--file requires a path.");
      }

      options.file = value;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function plistToJson(filePath) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", filePath], { encoding: "utf8" }));
}

function plistXmlToJson(xml) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cody-mas-profile-"));
  const tmpPath = path.join(tmpDir, "profile.plist");

  try {
    fs.writeFileSync(tmpPath, xml);
    return plistToJson(tmpPath);
  } finally {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  }
}

function decodeProfile(filePath) {
  const result = spawnSync("security", ["cms", "-D", "-i", filePath], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    throw new Error(`Unable to run security cms: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error("Unable to decode provisioning profile. Confirm the file is a signed Apple provisioning profile.");
  }

  return plistXmlToJson(result.stdout);
}

function flatten(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value.flatMap(flatten) : [String(value)];
}

function parseDate(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function appIdentifierMatches(identifier) {
  return Boolean(identifier && appId && (identifier === appId || identifier.endsWith(`.${appId}`)));
}

function expectedEntitlementKeys() {
  if (!fs.existsSync(entitlementsPath)) {
    throw new Error(`MAS entitlements file is missing: ${path.relative(projectRoot, entitlementsPath)}`);
  }

  const entitlements = plistToJson(entitlementsPath);

  return [
    "com.apple.security.app-sandbox",
    "com.apple.security.files.user-selected.read-only",
    "com.apple.security.files.bookmarks.app-scope"
  ].filter((key) => entitlements[key] === true);
}

function validateProfile(profile) {
  const entitlements = profile.Entitlements ?? {};
  const applicationIdentifier =
    entitlements["application-identifier"] ?? entitlements["com.apple.application-identifier"] ?? "";
  const expirationDate = parseDate(profile.ExpirationDate);
  const provisionedDevices = Array.isArray(profile.ProvisionedDevices) ? profile.ProvisionedDevices : [];
  const getTaskAllow =
    entitlements["get-task-allow"] === true || entitlements["com.apple.security.get-task-allow"] === true;
  const platform = flatten(profile.Platform);
  const expectedKeys = expectedEntitlementKeys();
  const missingEntitlements = expectedKeys.filter((key) => entitlements[key] !== true);
  const failures = [];

  if (!appId) {
    failures.push("package.json build.appId is missing.");
  }

  if (!profile.UUID) {
    failures.push("Profile UUID is missing.");
  }

  if (!appIdentifierMatches(applicationIdentifier)) {
    failures.push(`Profile does not match bundle id ${appId}.`);
  }

  if (!platform.some((item) => /^(OSX|macOS)$/i.test(item))) {
    failures.push("Profile is not a macOS/Mac App Store profile.");
  }

  if (provisionedDevices.length > 0 || getTaskAllow) {
    failures.push("Profile is not distribution-style; expected no provisioned devices and get-task-allow=false.");
  }

  if (!expirationDate || expirationDate.getTime() <= Date.now()) {
    failures.push("Profile is expired or missing an expiration date.");
  }

  if (missingEntitlements.length > 0) {
    failures.push(`Profile is missing expected entitlement(s): ${missingEntitlements.join(", ")}.`);
  }

  return {
    applicationIdentifier,
    expirationDate,
    failures,
    platform,
    uuid: String(profile.UUID ?? "")
  };
}

function validateSourceFile(filePath) {
  if (!filePath) {
    throw new Error("--file is required.");
  }

  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error("Profile file does not exist.");
  }

  const stat = fs.lstatSync(absolutePath);

  if (stat.isSymbolicLink()) {
    throw new Error("Profile file must not be a symlink.");
  }

  if (!stat.isFile()) {
    throw new Error("Profile path must be a regular file.");
  }

  if (!absolutePath.endsWith(".provisionprofile") && !absolutePath.endsWith(".mobileprovision")) {
    throw new Error("Profile file must end with .provisionprofile or .mobileprovision.");
  }

  if (isInsideProject(absolutePath)) {
    throw new Error("MAS provisioning profile source file must live outside the project and handoff archive.");
  }

  return absolutePath;
}

function validateInstallDirectory({ create = false } = {}) {
  if (!fs.existsSync(defaultInstallDir)) {
    if (!create) {
      return;
    }

    fs.mkdirSync(defaultInstallDir, { recursive: true, mode: 0o700 });
  } else {
    const stat = fs.lstatSync(defaultInstallDir);

    if (stat.isSymbolicLink()) {
      throw new Error("MAS provisioning profile install directory must not be a symlink.");
    }

    if (!stat.isDirectory()) {
      throw new Error("MAS provisioning profile install directory path must be a directory.");
    }
  }

  const realInstallDir = fs.realpathSync(defaultInstallDir);

  if (isInsideProject(realInstallDir)) {
    throw new Error("MAS provisioning profile install directory must resolve outside the project and handoff archive.");
  }

  if (create) {
    fs.chmodSync(defaultInstallDir, 0o700);
  }
}

function profileDestinationPath(uuid) {
  return path.join(defaultInstallDir, `${uuid}.provisionprofile`);
}

function validateDestinationFile(destinationPath) {
  if (!fs.existsSync(destinationPath)) {
    return;
  }

  const stat = fs.lstatSync(destinationPath);

  if (stat.isSymbolicLink()) {
    throw new Error("Installed MAS provisioning profile destination must not be a symlink.");
  }

  if (!stat.isFile()) {
    throw new Error("Installed MAS provisioning profile destination must be a regular file.");
  }
}

function installProfile(sourcePath, uuid) {
  validateInstallDirectory({ create: true });

  const destinationPath = profileDestinationPath(uuid);
  validateDestinationFile(destinationPath);

  fs.copyFileSync(sourcePath, destinationPath);
  fs.chmodSync(destinationPath, 0o600);
}

function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return;
  }

  let sourcePath;

  try {
    sourcePath = validateSourceFile(options.file);
    validateInstallDirectory();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  let decodedProfile;

  try {
    decodedProfile = decodeProfile(sourcePath);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const validation = validateProfile(decodedProfile);

  if (validation.failures.length > 0) {
    validation.failures.forEach(fail);
    return;
  }

  try {
    validateDestinationFile(profileDestinationPath(validation.uuid));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  console.log(`PASS Profile matches ${appId}`);
  console.log(`PASS Profile is macOS distribution-style`);
  console.log(`PASS Profile contains expected MAS entitlements`);
  console.log("PASS MAS provisioning profile install destination is safe");
  console.log(`PASS Profile expires ${validation.expirationDate.toISOString().slice(0, 10)}`);

  if (options.dryRun) {
    console.log("MAS profile install dry-run: no files were written.");
    return;
  }

  installProfile(sourcePath, validation.uuid);
  console.log("Installed MAS provisioning profile into the standard user provisioning profile directory.");
  console.log("Run npm run check:mas-signing -- --strict next.");
}

main();
