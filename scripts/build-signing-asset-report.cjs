#!/usr/bin/env node

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "SIGNING_ASSET_REPORT.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "SIGNING_ASSET_REPORT.md");
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const appId = pkg.build?.appId ?? "";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    available: !result.error || result.error.code !== "ENOENT",
    ok: result.status === 0,
    status: typeof result.status === "number" ? result.status : null,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    error: result.error ? result.error.message : null
  };
}

function plistToJson(filePath) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", filePath], { encoding: "utf8" }));
}

function plistXmlToJson(xml, label) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cody-signing-report-"));
  const tmpPath = path.join(tmpDir, `${label}.plist`);

  try {
    fs.writeFileSync(tmpPath, xml);
    return plistToJson(tmpPath);
  } finally {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  }
}

function parseIdentityName(line) {
  return line.match(/^\s*\d+\)\s+[A-Fa-f0-9]{40}\s+"([^"]+)"/)?.[1] ?? null;
}

function teamIdFromName(name) {
  return name.match(/\(([A-Z0-9]{10})\)\s*$/)?.[1] ?? null;
}

function getSigningIdentities() {
  const result = run("security", ["find-identity", "-v", "-p", "codesigning"]);

  if (!result.ok) {
    return {
      toolAvailable: result.available,
      commandStatus: result.status,
      identities: []
    };
  }

  return {
    toolAvailable: result.available,
    commandStatus: result.status,
    identities: result.stdout
      .split(/\r?\n/)
      .map(parseIdentityName)
      .filter(Boolean)
      .map((name) => ({
        teamId: teamIdFromName(name),
        isApplicationDistribution:
          name.startsWith("3rd Party Mac Developer Application:") ||
          name.startsWith("Mac App Distribution:") ||
          name.startsWith("Apple Distribution:"),
        isInstallerDistribution:
          name.startsWith("3rd Party Mac Developer Installer:") || name.startsWith("Mac Installer Distribution:"),
        isDevelopment: name.startsWith("Mac Developer:") || name.startsWith("Apple Development:")
      }))
  };
}

function profileDirectories() {
  return [
    path.join(os.homedir(), "Library", "MobileDevice", "Provisioning Profiles"),
    path.join(os.homedir(), "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles")
  ];
}

function findProfileFiles(storageIssues) {
  const files = [];

  profileDirectories().forEach((directory) => {
    if (!fs.existsSync(directory)) {
      return;
    }

    const directoryStat = fs.lstatSync(directory);

    if (directoryStat.isSymbolicLink()) {
      storageIssues.push("Provisioning profile directory is a symlink.");
      return;
    }

    if (!directoryStat.isDirectory()) {
      storageIssues.push("Provisioning profile path is not a directory.");
      return;
    }

    fs.readdirSync(directory).forEach((entry) => {
      const entryPath = path.join(directory, entry);

      if (!entry.endsWith(".provisionprofile") && !entry.endsWith(".mobileprovision")) {
        return;
      }

      const entryStat = fs.lstatSync(entryPath);

      if (entryStat.isSymbolicLink()) {
        storageIssues.push("Provisioning profile file is a symlink.");
        return;
      }

      if (entryStat.isFile()) {
        files.push(entryPath);
      }
    });
  });

  return [...new Set(files)].sort();
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

function teamIdsForProfile(profile, entitlements) {
  return [
    ...flatten(profile.TeamIdentifier),
    ...flatten(profile.ApplicationIdentifierPrefix),
    ...flatten(entitlements["com.apple.developer.team-identifier"])
  ].filter(Boolean);
}

function decodeProfile(filePath) {
  const result = run("security", ["cms", "-D", "-i", filePath]);

  if (!result.ok) {
    return {
      decoded: false
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
      decoded: true,
      entitlements,
      expirationDate,
      getTaskAllow,
      isDistributionCandidate: provisionedDevices.length === 0 && !getTaskAllow,
      isExpired: expirationDate ? expirationDate.getTime() <= Date.now() : true,
      isMacPlatformProfile: platform.some((item) => /^(OSX|macOS)$/i.test(item)),
      matchesBundleId: appIdentifierMatches(applicationIdentifier),
      provisionedDeviceCount: provisionedDevices.length,
      teamIds: teamIdsForProfile(profile, entitlements)
    };
  } catch {
    return {
      decoded: false
    };
  }
}

function getExpectedEntitlements() {
  const entitlementsPath = pkg.build?.mas?.entitlements ?? "build/entitlements.mas.plist";
  const absolutePath = path.join(projectRoot, entitlementsPath);

  if (!fs.existsSync(absolutePath)) {
    return {
      path: entitlementsPath,
      exists: false,
      values: {}
    };
  }

  try {
    return {
      path: entitlementsPath,
      exists: true,
      values: plistToJson(absolutePath)
    };
  } catch {
    return {
      path: entitlementsPath,
      exists: true,
      values: {},
      parseError: true
    };
  }
}

function expectedEntitlementKeys(entitlements) {
  return [
    "com.apple.security.app-sandbox",
    "com.apple.security.files.user-selected.read-only",
    "com.apple.security.files.bookmarks.app-scope"
  ].filter((key) => entitlements[key] === true);
}

function summarizeProfiles(profiles, expectedKeys, distributionTeamIds) {
  const decoded = profiles.filter((profile) => profile.decoded);
  const matching = decoded.filter((profile) => profile.matchesBundleId);
  const distribution = matching.filter((profile) => profile.isDistributionCandidate);
  const macDistribution = distribution.filter((profile) => profile.isMacPlatformProfile);
  const unexpiredMacDistribution = macDistribution.filter((profile) => !profile.isExpired);
  const expectedEntitlementReady = unexpiredMacDistribution.filter((profile) =>
    expectedKeys.every((key) => profile.entitlements[key] === true)
  );
  const teamMatched = expectedEntitlementReady.filter((profile) => {
    if (distributionTeamIds.size === 0) {
      return false;
    }

    return profile.teamIds.some((teamId) => distributionTeamIds.has(teamId));
  });

  return {
    scannedProfileCount: profiles.length,
    decodedProfileCount: decoded.length,
    decodeErrorCount: profiles.length - decoded.length,
    matchingBundleIdProfileCount: matching.length,
    distributionStyleProfileCount: distribution.length,
    macDistributionProfileCount: macDistribution.length,
    unexpiredMacDistributionProfileCount: unexpiredMacDistribution.length,
    expectedEntitlementProfileCount: expectedEntitlementReady.length,
    teamMatchedProfileCount: teamMatched.length,
    developmentOrDeviceProfileCount: matching.filter((profile) => profile.provisionedDeviceCount > 0 || profile.getTaskAllow).length
  };
}

function buildReport() {
  const profileStorageIssues = [];
  const identityResult = getSigningIdentities();
  const identities = identityResult.identities;
  const applicationIdentities = identities.filter((identity) => identity.isApplicationDistribution);
  const installerIdentities = identities.filter((identity) => identity.isInstallerDistribution);
  const developmentIdentities = identities.filter((identity) => identity.isDevelopment);
  const distributionTeamIds = new Set(
    applicationIdentities
      .concat(installerIdentities)
      .map((identity) => identity.teamId)
      .filter(Boolean)
  );
  const expectedEntitlements = getExpectedEntitlements();
  const expectedKeys = expectedEntitlementKeys(expectedEntitlements.values);
  const profiles = findProfileFiles(profileStorageIssues).map(decodeProfile);
  const profileSummary = summarizeProfiles(profiles, expectedKeys, distributionTeamIds);
  profileSummary.storageIssueCount = profileStorageIssues.length;
  const identitySummary = {
    securityToolAvailable: identityResult.toolAvailable,
    securityCommandStatus: identityResult.commandStatus,
    codeSigningIdentityCount: identities.length,
    applicationDistributionIdentityCount: applicationIdentities.length,
    installerDistributionIdentityCount: installerIdentities.length,
    developmentIdentityCount: developmentIdentities.length,
    distributionTeamIdCount: distributionTeamIds.size
  };
  const entitlementSummary = {
    path: expectedEntitlements.path,
    exists: expectedEntitlements.exists,
    parseError: expectedEntitlements.parseError === true,
    appSandbox: expectedEntitlements.values["com.apple.security.app-sandbox"] === true,
    userSelectedReadOnly: expectedEntitlements.values["com.apple.security.files.user-selected.read-only"] === true,
    appScopeBookmarks: expectedEntitlements.values["com.apple.security.files.bookmarks.app-scope"] === true,
    networkClient: expectedEntitlements.values["com.apple.security.network.client"] === true,
    expectedProfileEntitlementKeys: expectedKeys
  };
  const readiness = {
    bundleIdConfigured: Boolean(appId),
    hasApplicationDistributionIdentity: applicationIdentities.length > 0,
    hasInstallerDistributionIdentity: installerIdentities.length > 0,
    hasMatchingUnexpiredMacDistributionProfile: profileSummary.unexpiredMacDistributionProfileCount > 0,
    hasExpectedEntitlementProfile: profileSummary.expectedEntitlementProfileCount > 0,
    hasTeamMatchedProfile: distributionTeamIds.size === 0 ? false : profileSummary.teamMatchedProfileCount > 0,
    entitlementsConfigured:
      entitlementSummary.appSandbox &&
      entitlementSummary.userSelectedReadOnly &&
      entitlementSummary.appScopeBookmarks &&
      !entitlementSummary.networkClient
  };
  const blockers = [
    !readiness.bundleIdConfigured ? "package.json build.appId is missing." : "",
    !readiness.hasApplicationDistributionIdentity
      ? "Missing Apple Distribution, Mac App Distribution, or 3rd Party Mac Developer Application identity."
      : "",
    !readiness.hasInstallerDistributionIdentity
      ? "Missing Mac Installer Distribution or 3rd Party Mac Developer Installer identity."
      : "",
    !readiness.hasMatchingUnexpiredMacDistributionProfile
      ? `Missing unexpired macOS/Mac App Store distribution provisioning profile for ${appId}.`
      : "",
    readiness.hasMatchingUnexpiredMacDistributionProfile && !readiness.hasExpectedEntitlementProfile
      ? "Matching distribution profile is missing the expected sandbox/file-access entitlements."
      : "",
    distributionTeamIds.size > 0 && readiness.hasExpectedEntitlementProfile && !readiness.hasTeamMatchedProfile
      ? "Matching distribution profile team does not align with installed distribution signing identities."
      : "",
    profileStorageIssues.length > 0
      ? "Provisioning profile directories and files must be regular files, not symlinks."
      : "",
    !readiness.entitlementsConfigured ? "MAS entitlements file is missing expected sandbox/read-only/bookmark posture." : ""
  ].filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName ?? pkg.name,
      bundleId: appId,
      version: pkg.version,
      buildVersion: pkg.build?.buildVersion ?? pkg.version
    },
    summary: {
      status: blockers.length === 0 ? "ready" : "blocked",
      blockerCount: blockers.length,
      readyForMasSigning: blockers.length === 0
    },
    identities: identitySummary,
    provisioningProfiles: profileSummary,
    entitlements: entitlementSummary,
    readiness,
    blockers,
    commands: [
      "npm run check:signing-assets",
      "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run",
      "npm run check:mas-signing -- --strict",
      "npm run dist:mas",
      "npm run check:mas-package -- --strict"
    ],
    redaction: {
      storesIdentityNames: false,
      storesCertificateHashes: false,
      storesProvisioningProfileNames: false,
      storesProvisioningProfileUuids: false,
      storesLocalProfilePaths: false,
      storesAppleAccountValues: false
    },
    sourceArtifacts: [
      "package.json",
      "build/entitlements.mas.plist",
      "build/entitlements.mas.inherit.plist",
      "scripts/install-mas-profile.cjs",
      "scripts/check-mas-signing.cjs"
    ]
  };
}

function renderMarkdown(report) {
  const blockerList =
    report.blockers.length > 0 ? report.blockers.map((item) => `- ${item}`).join("\n") : "- None";

  return `# Cody Cartridge Signing Asset Report

Generated by \`npm run signing-assets:store\`.

This report is a redacted MAS signing inventory. It records readiness counts and blockers without certificate names, certificate hashes, profile names, profile UUIDs, local profile paths, or Apple account values.

## Candidate

- App: ${report.app.name}
- Bundle ID: \`${report.app.bundleId}\`
- Version: ${report.app.version}
- Build version: ${report.app.buildVersion}
- Status: ${report.summary.status}
- Ready for MAS signing: ${report.summary.readyForMasSigning ? "yes" : "no"}
- Blockers: ${report.summary.blockerCount}

## Identity Inventory

- Code-signing identities: ${report.identities.codeSigningIdentityCount}
- Application distribution identities: ${report.identities.applicationDistributionIdentityCount}
- Installer distribution identities: ${report.identities.installerDistributionIdentityCount}
- Development identities: ${report.identities.developmentIdentityCount}
- Distribution team IDs represented: ${report.identities.distributionTeamIdCount}

## Provisioning Profile Inventory

- Profiles scanned: ${report.provisioningProfiles.scannedProfileCount}
- Profiles decoded: ${report.provisioningProfiles.decodedProfileCount}
- Decode errors: ${report.provisioningProfiles.decodeErrorCount}
- Profile storage issues: ${report.provisioningProfiles.storageIssueCount}
- Matching bundle ID profiles: ${report.provisioningProfiles.matchingBundleIdProfileCount}
- macOS distribution profiles: ${report.provisioningProfiles.macDistributionProfileCount}
- Unexpired macOS distribution profiles: ${report.provisioningProfiles.unexpiredMacDistributionProfileCount}
- Profiles with expected entitlements: ${report.provisioningProfiles.expectedEntitlementProfileCount}
- Profiles team-matched to installed identities: ${report.provisioningProfiles.teamMatchedProfileCount}

## Entitlement Posture

- Entitlements file: \`${report.entitlements.path}\` (${report.entitlements.exists ? "present" : "missing"})
- App sandbox: ${report.entitlements.appSandbox ? "yes" : "no"}
- User-selected read-only files: ${report.entitlements.userSelectedReadOnly ? "yes" : "no"}
- App-scope bookmarks: ${report.entitlements.appScopeBookmarks ? "yes" : "no"}
- Network client entitlement: ${report.entitlements.networkClient ? "yes" : "no"}

## Current Blockers

${blockerList}

## Commands

${report.commands.map((command) => `- \`${command}\``).join("\n")}

## Redaction

- Identity names, certificate hashes, profile names, profile UUIDs, local profile paths, and Apple account values are not written here.
- Keep Apple certificates, private keys, provisioning profiles, App Store Connect API keys, and delivery credentials outside the handoff archive.
`;
}

function main() {
  const report = buildReport();

  fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderMarkdown(report));

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (!report.summary.readyForMasSigning) {
    console.warn(`Signing asset report records ${report.summary.blockerCount} blocker(s).`);
  }
}

main();
