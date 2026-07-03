#!/usr/bin/env node

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const appId = packageJson.build?.appId;

const passes = [];
const warnings = [];
const failures = [];
const notes = [];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function pass(message) {
  passes.push(message);
}

function note(message) {
  notes.push(message);
}

function warn(message, strictFailure = false) {
  if (strict && strictFailure) {
    failures.push(message);
  } else {
    warnings.push(message);
  }
}

function plistToJson(filePath) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", filePath], { encoding: "utf8" }));
}

function plistXmlToJson(xml, label) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cody-profile-"));
  const tmpPath = path.join(tmpDir, `${label}.plist`);

  try {
    fs.writeFileSync(tmpPath, xml);
    return plistToJson(tmpPath);
  } finally {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  }
}

function parseIdentityName(line) {
  const match = line.match(/^\s*\d+\)\s+[A-Fa-f0-9]{40}\s+"([^"]+)"/);
  return match?.[1] ?? null;
}

function teamIdFromName(name) {
  return name.match(/\(([A-Z0-9]{10})\)\s*$/)?.[1] ?? null;
}

function getSigningIdentities() {
  const result = run("security", ["find-identity", "-v", "-p", "codesigning"]);

  if (result.error) {
    warn(`Unable to run security find-identity: ${result.error.message}`, true);
    return [];
  }

  if (result.status !== 0) {
    warn(`Unable to read code-signing identities: ${(result.stderr || result.stdout).trim()}`, true);
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map(parseIdentityName)
    .filter(Boolean)
    .map((name) => ({
      name,
      teamId: teamIdFromName(name),
      isApplicationDistribution:
        name.startsWith("3rd Party Mac Developer Application:") ||
        name.startsWith("Mac App Distribution:") ||
        name.startsWith("Apple Distribution:"),
      isInstallerDistribution:
        name.startsWith("3rd Party Mac Developer Installer:") || name.startsWith("Mac Installer Distribution:"),
      isDevelopment: name.startsWith("Mac Developer:") || name.startsWith("Apple Development:")
    }));
}

function profileDirectories() {
  return [
    path.join(os.homedir(), "Library", "MobileDevice", "Provisioning Profiles"),
    path.join(os.homedir(), "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles")
  ];
}

function displayPath(filePath) {
  const homeRelative = path.relative(os.homedir(), filePath);

  if (homeRelative && !homeRelative.startsWith("..") && !path.isAbsolute(homeRelative)) {
    return path.join("~", homeRelative);
  }

  const projectRelative = path.relative(projectRoot, filePath);

  if (projectRelative === "" || (!projectRelative.startsWith("..") && !path.isAbsolute(projectRelative))) {
    return path.join("<project>", projectRelative);
  }

  return filePath;
}

function findProfileFiles() {
  const files = [];

  for (const directory of profileDirectories()) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    const directoryStat = fs.lstatSync(directory);

    if (directoryStat.isSymbolicLink()) {
      warn(`Provisioning profile directory must not be a symlink: ${displayPath(directory)}`, true);
      continue;
    }

    if (!directoryStat.isDirectory()) {
      warn(`Provisioning profile path must be a directory: ${displayPath(directory)}`, true);
      continue;
    }

    for (const entry of fs.readdirSync(directory)) {
      const entryPath = path.join(directory, entry);

      if (!entry.endsWith(".provisionprofile") && !entry.endsWith(".mobileprovision")) {
        continue;
      }

      const entryStat = fs.lstatSync(entryPath);

      if (entryStat.isSymbolicLink()) {
        warn(`Provisioning profile file must not be a symlink: ${displayPath(entryPath)}`, true);
        continue;
      }

      if (entryStat.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return [...new Set(files)].sort();
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

function getProfileTeamIds(profile, entitlements) {
  return [
    ...flatten(profile.TeamIdentifier),
    ...flatten(profile.ApplicationIdentifierPrefix),
    ...flatten(entitlements["com.apple.developer.team-identifier"])
  ].filter(Boolean);
}

function appIdentifierMatches(identifier) {
  if (!identifier) {
    return false;
  }

  return identifier === appId || identifier.endsWith(`.${appId}`);
}

function decodeProvisioningProfile(filePath) {
  const result = run("security", ["cms", "-D", "-i", filePath]);

  if (result.status !== 0 || result.error) {
    return {
      filePath,
      error: result.error?.message || (result.stderr || result.stdout).trim() || "security cms decode failed"
    };
  }

  try {
    const profile = plistXmlToJson(result.stdout, path.basename(filePath, path.extname(filePath)));
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
      filePath,
      getTaskAllow,
      isExpired: expirationDate ? expirationDate.getTime() <= Date.now() : true,
      isMacPlatformProfile: platform.some((item) => /^(OSX|macOS)$/i.test(item)),
      isDistributionCandidate: provisionedDevices.length === 0 && !getTaskAllow,
      matchesBundleId: appIdentifierMatches(applicationIdentifier),
      name: profile.Name ?? path.basename(filePath),
      platform,
      provisionedDeviceCount: provisionedDevices.length,
      teamIds: getProfileTeamIds(profile, entitlements),
      uuid: profile.UUID ?? path.basename(filePath, path.extname(filePath))
    };
  } catch (error) {
    return {
      filePath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function getExpectedEntitlements() {
  try {
    return plistToJson(path.join(projectRoot, packageJson.build?.mas?.entitlements ?? "build/entitlements.mas.plist"));
  } catch (error) {
    warn(`Unable to read MAS entitlements: ${error instanceof Error ? error.message : String(error)}`, true);
    return {};
  }
}

function reportIdentityState(identities) {
  const applicationIdentities = identities.filter((identity) => identity.isApplicationDistribution);
  const installerIdentities = identities.filter((identity) => identity.isInstallerDistribution);
  const developmentIdentities = identities.filter((identity) => identity.isDevelopment);

  if (identities.length > 0) {
    pass(`Found ${identities.length} valid code-signing identity/identities in the keychain`);
  } else {
    warn("No valid code-signing identities found in the keychain", true);
  }

  if (applicationIdentities.length > 0) {
    pass("Found an Apple Distribution, Mac App Distribution, or 3rd Party Mac Developer Application identity");
  } else {
    warn("Missing Apple Distribution, Mac App Distribution, or 3rd Party Mac Developer Application identity", true);
  }

  if (installerIdentities.length > 0) {
    pass("Found a Mac Installer Distribution or 3rd Party Mac Developer Installer identity for MAS package export");
  } else {
    warn("Missing Mac Installer Distribution or 3rd Party Mac Developer Installer identity for final MAS package export", true);
  }

  if (developmentIdentities.length > 0) {
    note(`Development signing identities present: ${developmentIdentities.map((identity) => identity.name).join("; ")}`);
  }

  applicationIdentities.concat(installerIdentities).forEach((identity) => note(`Identity: ${identity.name}`));

  return {
    applicationIdentities,
    developmentIdentities,
    installerIdentities
  };
}

function reportProfileState(profiles, expectedEntitlements, identityState) {
  if (profiles.length > 0) {
    pass(`Found ${profiles.length} installed provisioning profile(s)`);
  } else {
    warn("No installed provisioning profiles found", true);
    return;
  }

  const decodeErrors = profiles.filter((profile) => profile.error);
  decodeErrors.forEach((profile) => warn(`Could not decode ${profile.filePath}: ${profile.error}`));

  const decodedProfiles = profiles.filter((profile) => !profile.error);
  const matchingProfiles = decodedProfiles.filter((profile) => profile.matchesBundleId);
  const distributionProfiles = matchingProfiles.filter((profile) => profile.isDistributionCandidate);
  const macDistributionProfiles = distributionProfiles.filter((profile) => profile.isMacPlatformProfile);
  const unexpiredDistributionProfiles = macDistributionProfiles.filter((profile) => !profile.isExpired);

  if (matchingProfiles.length > 0) {
    pass(`Found ${matchingProfiles.length} profile(s) matching ${appId}`);
  } else {
    warn(`No provisioning profile matches bundle id ${appId}`, true);
  }

  if (unexpiredDistributionProfiles.length > 0) {
    pass("Found an unexpired macOS distribution-style provisioning profile for this bundle id");
  } else if (distributionProfiles.length > 0) {
    const hasOnlyWrongPlatformProfiles =
      distributionProfiles.some((profile) => !profile.isExpired) && macDistributionProfiles.length === 0;
    if (hasOnlyWrongPlatformProfiles) {
      warn("Distribution-style profiles for this bundle id are not macOS profiles; App Store upload needs a macOS/Mac App Store profile", true);
    } else {
      warn("Only expired macOS distribution-style profiles were found for this bundle id", true);
    }
  } else {
    warn("No distribution-style profile found for this bundle id; App Store upload needs a macOS/Mac App Store profile", true);
  }

  const expectedKeys = [
    "com.apple.security.app-sandbox",
    "com.apple.security.files.user-selected.read-only",
    "com.apple.security.files.bookmarks.app-scope"
  ].filter((key) => expectedEntitlements[key] === true);

  unexpiredDistributionProfiles.forEach((profile) => {
    const missingEntitlements = expectedKeys.filter((key) => profile.entitlements[key] !== true);
    const profileTeams = new Set(profile.teamIds);
    const identityTeams = identityState.applicationIdentities
      .concat(identityState.installerIdentities)
      .map((identity) => identity.teamId)
      .filter(Boolean);
    const hasTeamMatch = identityTeams.some((teamId) => profileTeams.has(teamId));

    note(
      `Profile: ${profile.name} (${profile.uuid}) expires ${formatDate(profile.expirationDate)} ` +
        `team ${profile.teamIds.join(",") || "unknown"} platform ${profile.platform.join(",") || "unknown"} app ${profile.applicationIdentifier}`
    );

    if (missingEntitlements.length === 0) {
      pass(`Profile "${profile.name}" contains expected sandbox/file-access entitlements`);
    } else {
      warn(`Profile "${profile.name}" is missing expected entitlement(s): ${missingEntitlements.join(", ")}`, true);
    }

    if (identityTeams.length === 0) {
      warn(`Cannot compare profile "${profile.name}" team id with signing identities because no distribution identities were found`, true);
    } else if (hasTeamMatch) {
      pass(`Profile "${profile.name}" team id matches an installed distribution identity`);
    } else {
      warn(`Profile "${profile.name}" team id does not match any installed distribution identity`, true);
    }
  });

  const developmentMatches = matchingProfiles.filter((profile) => profile.provisionedDeviceCount > 0 || profile.getTaskAllow);
  developmentMatches.forEach((profile) => {
    note(
      `Development/non-App-Store profile also matched ${appId}: ${profile.name} ` +
        `(devices ${profile.provisionedDeviceCount}, get-task-allow ${profile.getTaskAllow})`
    );
  });
}

function main() {
  if (!appId) {
    warn("package.json build.appId is missing", true);
  } else {
    pass(`Bundle id configured as ${appId}`);
  }

  const expectedEntitlements = getExpectedEntitlements();
  const identities = getSigningIdentities();
  const identityState = reportIdentityState(identities);
  const profileFiles = findProfileFiles();
  const profiles = profileFiles.map(decodeProvisioningProfile);
  reportProfileState(profiles, expectedEntitlements, identityState);

  console.log(`MAS signing preflight: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);

  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));
  failures.forEach((message) => console.error(`FAIL ${message}`));
  notes.forEach((message) => console.log(`INFO ${message}`));

  if (strict && failures.length > 0) {
    process.exitCode = 1;
  }

  if (!strict && warnings.length > 0) {
    console.log("INFO Run `npm run check:mas-signing -- --strict` on the release machine after installing Apple signing assets.");
  }
}

main();
