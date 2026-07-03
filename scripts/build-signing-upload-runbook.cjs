#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "SIGNING_UPLOAD_RUNBOOK.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "SIGNING_UPLOAD_RUNBOOK.md");

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function list(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function codeBlock(value) {
  return ["```bash", String(value ?? "").trim(), "```"].join("\n");
}

function commandStep(id, command, purpose) {
  return { id, command, purpose };
}

function blockedLabelsForCategory(blockers, categoryId) {
  return (blockers.categories ?? [])
    .find((category) => category.id === categoryId)
    ?.checks?.filter((check) => check.status === "blocked")
    .map((check) => check.label) ?? [];
}

function main() {
  const pkg = readJson("package.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json", { blockers: [], summary: {} });
  const signingAssetReport = readJson("app-store-assets/SIGNING_ASSET_REPORT.json", { summary: {}, identities: {}, provisioningProfiles: {}, redaction: {} });
  const signingBlockers = blockedLabelsForCategory(blockers, "signing-package");
  const publicInputBlockers = blockedLabelsForCategory(blockers, "public-inputs");
  const generatedSiteBlockers = blockedLabelsForCategory(blockers, "generated-site");
  const submissionBlockers = blockedLabelsForCategory(blockers, "submission");
  const buildVersion = pkg.build?.buildVersion ?? pkg.version;
  const appBundlePath = "dist/mas-arm64/Cody Cartridge.app";
  const uploadPackagePattern = "dist/**/*.pkg";

  const runbook = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion,
      category: pkg.build?.mas?.category,
      minimumSystemVersion: pkg.build?.mas?.minimumSystemVersion
    },
    requiredSigningAssets: {
      applicationIdentity:
        "Apple Distribution, Mac App Distribution, or 3rd Party Mac Developer Application identity in the login keychain.",
      installerIdentity: "Mac Installer Distribution or 3rd Party Mac Developer Installer identity in the login keychain.",
      provisioningProfile:
        "Unexpired macOS/Mac App Store distribution provisioning profile matching com.sachittumuluri.codycartridge, with no provisioned devices and get-task-allow=false.",
      entitlements: pkg.build?.mas?.entitlements,
      inheritedEntitlements: pkg.build?.mas?.entitlementsInherit
    },
    signingAssetSnapshot: {
      status: signingAssetReport.summary?.status ?? "missing",
      blockerCount: signingAssetReport.summary?.blockerCount ?? null,
      readyForMasSigning: signingAssetReport.summary?.readyForMasSigning === true,
      applicationDistributionIdentityCount: signingAssetReport.identities?.applicationDistributionIdentityCount ?? 0,
      installerDistributionIdentityCount: signingAssetReport.identities?.installerDistributionIdentityCount ?? 0,
      unexpiredMacDistributionProfileCount: signingAssetReport.provisioningProfiles?.unexpiredMacDistributionProfileCount ?? 0,
      expectedEntitlementProfileCount: signingAssetReport.provisioningProfiles?.expectedEntitlementProfileCount ?? 0,
      redacted:
        signingAssetReport.redaction?.storesIdentityNames === false &&
        signingAssetReport.redaction?.storesProvisioningProfileUuids === false &&
        signingAssetReport.redaction?.storesLocalProfilePaths === false
    },
    expectedPackageOutputs: {
      appBundlePath,
      uploadPackagePattern,
      embeddedProvisioningProfile: `${appBundlePath}/Contents/embedded.provisionprofile`,
      packagedAsar: `${appBundlePath}/Contents/Resources/app.asar`,
      privacyManifest: `${appBundlePath}/Contents/Resources/PrivacyInfo.xcprivacy`
    },
    uploadTooling: [
      "Transporter.app in /Applications or ~/Applications.",
      "xcrun altool from Xcode command-line tools.",
      "xcrun iTMSTransporter from Xcode command-line tools."
    ],
    nodeWrappedShortcuts: [
      commandStep("local-dry-run", "npm run release:store:local:node", "Run the full local non-credentialed release gate through the Node version selected by .nvmrc."),
      commandStep("public-release-refresh", "npm run public-release:store:node", "Run the public URL/contact artifact refresh through the Node version selected by .nvmrc."),
      commandStep("published-public-release-refresh", "npm run public-release:store:published:node", "Run the public URL/contact artifact refresh plus live published-site checks through the Node version selected by .nvmrc."),
      commandStep("strict-preflight", "npm run release:store:preflight:node", "Run the full release-machine preflight through the Node version selected by .nvmrc."),
      commandStep("strict-release-machine-doctor", "npm run check:release-machine:node -- --strict", "Run the aggregate release-machine doctor through the Node version selected by .nvmrc."),
      commandStep("strict-verifier", "npm run verify:store:strict:node", "Run the final strict verifier through the Node version selected by .nvmrc.")
    ],
    signingRemediationChecklist: [
      "Confirm Apple Developer and App Store Connect use bundle id com.sachittumuluri.codycartridge for Cody Cartridge.",
      "Install an application distribution signing identity in the login keychain: Apple Distribution, Mac App Distribution, or 3rd Party Mac Developer Application.",
      "Install an installer distribution signing identity in the login keychain: Mac Installer Distribution or 3rd Party Mac Developer Installer.",
      "Create, download, and install a macOS/Mac App Store distribution provisioning profile for com.sachittumuluri.codycartridge.",
      "Validate the downloaded profile before installation with npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run.",
      "Install the validated profile with npm run install:mas-profile -- --file /path/to/profile.provisionprofile, then rerun the signing asset report.",
      "Confirm the provisioning profile is distribution-style: no provisioned devices, get-task-allow=false, unexpired, and macOS platform.",
      "Confirm the profile supports the MAS entitlements in build/entitlements.mas.plist: app sandbox, user-selected read-only files, and app-scoped bookmarks.",
      "Run npm run signing-assets:store and keep SIGNING_ASSET_REPORT.md with the release evidence.",
      "Run npm run check:mas-signing -- --strict before npm run dist:mas.",
      "Keep certificates, private keys, provisioning profiles, App Store Connect API keys, and upload credentials outside the handoff archive."
    ],
    releaseMachineCommands: [
      commandStep("env", "npm run check:store-env", "Verify public URL, support email, and App Review contact values."),
      commandStep("runtime", "npm run check:release-runtime -- --strict", "Verify the release machine is using the Node 22 packaging runtime."),
      commandStep("version", "npm run check:store-version:source", "Verify package/build versions before generating App Store fields."),
      commandStep("public-release-self-test", "npm run public-release:store -- --self-test", "Validate release-value redaction and public refresh command ordering without raw contact values."),
      commandStep("public-release-self-test-node", "npm run public-release:store:node -- --self-test", "Validate release-value redaction and public refresh command ordering through the Node version selected by .nvmrc."),
      commandStep("public-release-refresh", "npm run public-release:store -- --published", "Regenerate and strictly validate public site, archive, App Store fields, copy map, App Review brief, evidence, manifest, and handoff artifacts."),
      commandStep("public-release-refresh-node", "npm run public-release:store:published:node", "Node-safe shortcut for the same published public-release refresh when the current shell is not already on .nvmrc Node."),
      commandStep("site", "npm run site:store && npm run check:site -- --strict", "Generate and validate public support/privacy pages."),
      commandStep("archive-site", "npm run archive:site && npm run check:site-archive -- --strict", "Build and validate public-site archive."),
      commandStep("publish-packet", "npm run publish-packet:store", "Generate the public-site publish packet for Support/Privacy URL handoff."),
      commandStep("public-host", "npm run public-host:store", "Generate the public host runbook for static-site deployment and live URL verification."),
      commandStep("packet", "npm run packet:store && npm run app-compliance:store && npm run review-brief:store && npm run copy-map:store", "Regenerate App Store fields, compliance packet, App Review brief, and copy map."),
      commandStep("copy", "npm run check:review-brief -- --strict && npm run check:copy-map -- --strict && npm run check:app-compliance && npm run check:store-copy", "Verify copied App Review, App Store, and compliance fields."),
      commandStep("public-release-sync", "npm run check:public-release-sync -- --strict", "Verify generated site, archive manifest, and App Store fields match release env values."),
      commandStep("privacy", "npm run check:app-privacy && npm run check:artifact-privacy", "Verify privacy posture and release artifact privacy."),
      commandStep("urls", "npm run check:store-urls -- --strict", "Verify published App Store URLs are reachable."),
      commandStep("published-site", "npm run check:published-site -- --strict", "Verify every published public-site page is reachable and matches the generated source."),
      commandStep("signing-assets", "npm run signing-assets:store", "Generate the redacted signing identity/profile inventory for this machine."),
      commandStep("profile-install", "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run", "Validate the downloaded MAS provisioning profile before installing it."),
      commandStep("signing", "npm run check:mas-signing -- --strict", "Verify signing identities and provisioning profile."),
      commandStep("package", "npm run dist:mas", "Build the signed MAS app bundle and upload package."),
      commandStep("package-check", "npm run check:mas-package -- --strict", "Verify signed app bundle, embedded profile, entitlements, app.asar, and signed current-version installer package."),
      commandStep("upload-tooling", "npm run check:upload-tooling -- --strict", "Verify Transporter/altool/iTMSTransporter and upload package availability."),
      commandStep("upload-key-install", "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run", "Validate the downloaded App Store Connect API key before installing it in the default private key directory."),
      commandStep("upload-credentials", "npm run check:upload-credentials -- --strict", "Verify App Store Connect API key identifiers and private-key file posture without writing credential values."),
      commandStep("upload-packet", "npm run upload-packet:store", "Generate the redacted upload command packet with package hashes and available upload tools."),
      commandStep("apple-assets", "npm run apple-assets:store", "Generate the redacted Apple Developer/App Store Connect asset request packet for certificates, provisioning profile, package, and upload key."),
      commandStep("upload-evidence", `npm run upload-evidence:store -- --log /path/to/transporter.log --tool transporter --status selected --processed-bundle-id ${pkg.build?.appId} --processed-version ${pkg.version} --processed-build ${buildVersion}`, "Sanitize delivery logs and processed-build proof after App Store Connect processing."),
      commandStep("evidence", "npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store && npm run signing-assets:store && npm run upload-packet:store && npm run copy-map:store && npm run apple-assets:store && npm run signing-runbook:store && npm run resolution-plan:store && npm run submission-checklist:store && npm run machine-report:store && npm run evidence:store && npm run check:evidence && npm run dashboard:store && npm run operator:store && npm run manifest:store && npm run check:manifest && npm run handoff:store", "Regenerate final blocker report, public-input packet, public-site publish packet, public host runbook, signing asset report, upload command packet, copy map, Apple release asset request packet, runbook, resolution plan, submission checklist, release machine report, check release evidence, dashboard, operator queue, check release manifest, and handoff archive."),
      commandStep("release-machine-doctor", "npm run check:release-machine -- --strict", "Run the aggregate release-machine readiness doctor after refreshed blocker, signing, package, upload, and handoff artifacts."),
      commandStep("strict", "npm run verify:store:strict", "Run final strict readiness verification before upload.")
    ],
    uploadChecklist: [
      "Upload the signed MAS .pkg with Transporter, Xcode, altool, or iTMSTransporter.",
      "Run npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run, then rerun without --dry-run only after validation passes.",
      "Run npm run check:upload-credentials -- --strict before entering or exporting App Store Connect API credential values for command-line upload.",
      "Use UPLOAD_COMMAND_PACKET.md to confirm the exact package hash and available upload tool before entering Apple credentials.",
      "Save raw Transporter/altool delivery logs outside the handoff archive, then run npm run upload-evidence:store with the log path to create sanitized UPLOAD_EVIDENCE.md.",
      "Wait for App Store Connect build processing to finish.",
      "Confirm processed build bundle id, version, and build version match this runbook.",
      "Regenerate RELEASE_EVIDENCE.md, RELEASE_MANIFEST.md, and the handoff archive after UPLOAD_EVIDENCE.md is current.",
      "Resolve export-compliance, privacy-manifest, entitlement, or processing warnings against the exact uploaded binary.",
      "Select the processed build on the macOS app version before adding the version for review."
    ],
    remainingBlockers: {
      total: blockers.summary?.blockerCount ?? (blockers.blockers ?? []).length,
      signingPackage: signingBlockers,
      publicInputs: publicInputBlockers,
      generatedSite: generatedSiteBlockers,
      submission: submissionBlockers
    }
  };

  const markdown = `# Cody Cartridge Signing And Upload Runbook

Generated by \`npm run signing-runbook:store\`.

Use this on the release machine after public URL/contact values are available and before uploading the signed MAS package.

## Candidate

- App: ${runbook.app.name}
- Bundle ID: \`${runbook.app.bundleId}\`
- Version: ${runbook.app.version}
- Build version: ${runbook.app.buildVersion}
- Category: ${runbook.app.category}
- Minimum macOS: ${runbook.app.minimumSystemVersion}

## Required Signing Assets

- Application identity: ${runbook.requiredSigningAssets.applicationIdentity}
- Installer identity: ${runbook.requiredSigningAssets.installerIdentity}
- Provisioning profile: ${runbook.requiredSigningAssets.provisioningProfile}
- Entitlements: \`${runbook.requiredSigningAssets.entitlements}\`
- Inherited entitlements: \`${runbook.requiredSigningAssets.inheritedEntitlements}\`

## Redacted Signing Asset Snapshot

- Status: ${runbook.signingAssetSnapshot.status}
- Ready for MAS signing: ${runbook.signingAssetSnapshot.readyForMasSigning ? "yes" : "no"}
- Signing asset blockers: ${runbook.signingAssetSnapshot.blockerCount ?? "missing"}
- Application distribution identities: ${runbook.signingAssetSnapshot.applicationDistributionIdentityCount}
- Installer distribution identities: ${runbook.signingAssetSnapshot.installerDistributionIdentityCount}
- Unexpired macOS distribution profiles: ${runbook.signingAssetSnapshot.unexpiredMacDistributionProfileCount}
- Profiles with expected entitlements: ${runbook.signingAssetSnapshot.expectedEntitlementProfileCount}
- Snapshot redacted: ${runbook.signingAssetSnapshot.redacted ? "yes" : "no"}

## Expected Package Outputs

- App bundle: \`${runbook.expectedPackageOutputs.appBundlePath}\`
- Upload package: \`${runbook.expectedPackageOutputs.uploadPackagePattern}\`
- Embedded provisioning profile: \`${runbook.expectedPackageOutputs.embeddedProvisioningProfile}\`
- Packaged app source: \`${runbook.expectedPackageOutputs.packagedAsar}\`
- Privacy manifest: \`${runbook.expectedPackageOutputs.privacyManifest}\`

## Release-Machine Commands

### Node-Safe Shortcuts

Use these when the shell default is not the \`.nvmrc\` release runtime. They run through \`npm run release:node\` and do not change the global \`nvm\` default.

${codeBlock(runbook.nodeWrappedShortcuts.map((item) => item.command).join("\n"))}

### Detailed Release-Machine Commands

${codeBlock(runbook.releaseMachineCommands.map((item) => item.command).join("\n"))}

### Node-Safe Shortcut Purpose

${runbook.nodeWrappedShortcuts.map((item) => `- ${item.command}: ${item.purpose}`).join("\n")}

### Command Purpose

${runbook.releaseMachineCommands.map((item) => `- ${item.command}: ${item.purpose}`).join("\n")}

## Upload Checklist

${list(runbook.uploadChecklist)}

## Upload Tooling

${list(runbook.uploadTooling)}

## Signing Remediation Checklist

${list(runbook.signingRemediationChecklist)}

## Remaining Blockers Snapshot

- Total blockers: ${runbook.remainingBlockers.total}
- Signing/package blockers: ${runbook.remainingBlockers.signingPackage.length}
- Public input blockers: ${runbook.remainingBlockers.publicInputs.length}
- Generated site blockers: ${runbook.remainingBlockers.generatedSite.length}
- Submission blockers: ${runbook.remainingBlockers.submission.length}
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(runbook, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (runbook.remainingBlockers.total > 0) {
    console.warn(`Signing/upload runbook records ${runbook.remainingBlockers.total} remaining blocker(s).`);
  }
}

main();
