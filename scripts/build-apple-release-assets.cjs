#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "APPLE_RELEASE_ASSETS.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "APPLE_RELEASE_ASSETS.md");

function readJson(relativePath, fallback = null) {
  const filePath = path.join(projectRoot, relativePath);
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
}

function plistToJson(relativePath) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path.join(projectRoot, relativePath)], { encoding: "utf8" }));
}

function expectedEntitlements(pkg) {
  const entitlementsPath = pkg.build?.mas?.entitlements ?? "build/entitlements.mas.plist";
  const values = fs.existsSync(path.join(projectRoot, entitlementsPath)) ? plistToJson(entitlementsPath) : {};

  return {
    path: entitlementsPath,
    required: [
      "com.apple.security.app-sandbox",
      "com.apple.security.files.user-selected.read-only",
      "com.apple.security.files.bookmarks.app-scope"
    ].filter((key) => values[key] === true),
    forbidden: ["com.apple.security.network.client"].filter((key) => values[key] === true),
    values
  };
}

function statusFromReady(ready, fallback = "blocked") {
  return ready ? "ready" : fallback;
}

function buildAssetRequests({ pkg, entitlements, signingReport, uploadPacket }) {
  const bundleId = pkg.build?.appId ?? "";
  const signingSummary = signingReport?.summary ?? {};
  const identities = signingReport?.identities ?? {};
  const profiles = signingReport?.provisioningProfiles ?? {};
  const uploadSummary = uploadPacket?.summary ?? {};

  return [
    {
      id: "app-store-connect-app-record",
      label: "App Store Connect app record",
      ownerSystem: "App Store Connect",
      status: bundleId ? "manual" : "blocked",
      request: `Create or select the macOS app record for bundle id ${bundleId || "<bundle-id>"}.`,
      acceptanceCriteria: [
        "The macOS app record uses the same bundle id as package.json build.appId.",
        "The SKU, name, category, and version metadata match APP_STORE_CONNECT_FIELDS.json.",
        "The app record is available for TestFlight build selection after upload processing."
      ],
      validationCommands: ["npm run packet:store", "npm run copy-map:store"],
      evidence: bundleId ? `bundle id ${bundleId}` : "bundle id missing"
    },
    {
      id: "application-distribution-certificate",
      label: "Application distribution signing identity",
      ownerSystem: "Apple Developer Certificates",
      status: statusFromReady((identities.applicationDistributionCount ?? 0) > 0),
      request: "Install an Apple Distribution, Mac App Distribution, or 3rd Party Mac Developer Application certificate with its private key in the login keychain.",
      acceptanceCriteria: [
        "security find-identity reports at least one application distribution identity.",
        "The private key is present locally and is not exported into the project or handoff archive.",
        "The certificate team can match the MAS provisioning profile team."
      ],
      validationCommands: ["npm run signing-assets:store", "npm run check:mas-signing -- --strict"],
      evidence: `${identities.applicationDistributionCount ?? 0} application distribution identity/identities`
    },
    {
      id: "installer-distribution-certificate",
      label: "Installer distribution signing identity",
      ownerSystem: "Apple Developer Certificates",
      status: statusFromReady((identities.installerDistributionCount ?? 0) > 0),
      request: "Install a Mac Installer Distribution or 3rd Party Mac Developer Installer certificate with its private key in the login keychain.",
      acceptanceCriteria: [
        "security find-identity reports at least one installer distribution identity.",
        "The identity can sign the final MAS installer package.",
        "The private key remains outside the project and handoff archive."
      ],
      validationCommands: ["npm run signing-assets:store", "npm run check:mas-package -- --strict"],
      evidence: `${identities.installerDistributionCount ?? 0} installer distribution identity/identities`
    },
    {
      id: "mas-provisioning-profile",
      label: "Mac App Store provisioning profile",
      ownerSystem: "Apple Developer Profiles",
      status: statusFromReady(Boolean(signingSummary.readyForMasSigning) || (profiles.teamMatchedProfileCount ?? 0) > 0),
      request: `Create and download a macOS/Mac App Store distribution provisioning profile for ${bundleId || "<bundle-id>"}.`,
      acceptanceCriteria: [
        "The profile is unexpired and targets macOS.",
        "The profile matches the bundle id.",
        "The profile is distribution-style: no provisioned devices and get-task-allow=false.",
        `The profile includes required MAS entitlements: ${entitlements.required.join(", ") || "none recorded"}.`,
        "The profile team matches an installed distribution signing identity."
      ],
      validationCommands: [
        "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run",
        "npm run install:mas-profile -- --file /path/to/profile.provisionprofile",
        "npm run signing-assets:store",
        "npm run check:mas-signing -- --strict"
      ],
      evidence: `${profiles.teamMatchedProfileCount ?? 0} team-matched entitlement-ready profile(s)`
    },
    {
      id: "signed-mas-package",
      label: "Signed current-version MAS upload package",
      ownerSystem: "Release machine",
      status: statusFromReady(Boolean(uploadSummary.masSubmissionReady)),
      request: "Build the signed Mac App Store app bundle and current-version installer package on the release machine.",
      acceptanceCriteria: [
        "dist/mas-arm64/Cody Cartridge.app contains Contents/embedded.provisionprofile.",
        "codesign verification succeeds for the app bundle.",
        "The signed .pkg matches package.json version/build.",
        "UPLOAD_COMMAND_PACKET.json selects that signed current-version package."
      ],
      validationCommands: ["npm run dist:mas", "npm run check:mas-package -- --strict", "npm run upload-packet:store"],
      evidence: `upload packet status ${uploadSummary.status ?? "unknown"}`
    },
    {
      id: "app-store-connect-api-key",
      label: "App Store Connect upload API key",
      ownerSystem: "App Store Connect Users and Access",
      status: statusFromReady(uploadSummary.uploadCredentialStatus === "ready" || uploadPacket?.credentialCheck?.ready === true),
      request: "Create or select an App Store Connect API key permitted to upload this app, then install the private key outside the project after dry-run validation.",
      acceptanceCriteria: [
        "ASC_KEY_ID and ASC_ISSUER_ID are available only in the release shell or secure local environment.",
        "The .p8 private key file is outside the project and handoff archive.",
        "The credential preflight passes before command-line upload.",
        "Transporter.app may be used interactively instead when command-line credentials are not configured."
      ],
      validationCommands: [
        "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run",
        "npm run check:upload-credentials -- --strict",
        "npm run upload-packet:store"
      ],
      evidence: `upload credential status ${uploadSummary.uploadCredentialStatus ?? "unknown"}`
    }
  ];
}

function table(rows) {
  return [
    "| Asset | System | Status | Evidence |",
    "| --- | --- | --- | --- |",
    ...rows.map((item) => `| ${item.label} | ${item.ownerSystem} | ${item.status} | ${item.evidence.replace(/\|/g, "\\|")} |`)
  ].join("\n");
}

function details(rows) {
  return rows
    .map(
      (item) => `### ${item.label}

- ID: \`${item.id}\`
- System: ${item.ownerSystem}
- Status: ${item.status}
- Request: ${item.request}
- Evidence: ${item.evidence}

Acceptance criteria:
${item.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}

Validation commands:
${item.validationCommands.map((command) => `- \`${command}\``).join("\n")}`
    )
    .join("\n\n");
}

function main() {
  const pkg = readJson("package.json", {});
  const signingReport = readJson("app-store-assets/SIGNING_ASSET_REPORT.json", { summary: {}, identities: {}, provisioningProfiles: {} });
  const uploadPacket = readJson("app-store-assets/UPLOAD_COMMAND_PACKET.json", { summary: {}, credentialCheck: {} });
  const entitlements = expectedEntitlements(pkg);
  const assetRequests = buildAssetRequests({ pkg, entitlements, signingReport, uploadPacket });
  const statusCounts = assetRequests.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const packet = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName ?? pkg.productName ?? pkg.name,
      bundleId: pkg.build?.appId ?? "",
      version: pkg.version ?? "",
      buildVersion: pkg.build?.buildVersion ?? pkg.version ?? ""
    },
    summary: {
      assetRequestCount: assetRequests.length,
      readyCount: statusCounts.ready ?? 0,
      manualCount: statusCounts.manual ?? 0,
      blockerCount: statusCounts.blocked ?? 0,
      readyForSigningAndUpload: (statusCounts.blocked ?? 0) === 0
    },
    entitlements: {
      path: entitlements.path,
      required: entitlements.required,
      forbiddenPresent: entitlements.forbidden
    },
    assetRequests,
    validationFlow: [
      "npm run signing-assets:store",
      "npm run apple-assets:store",
      "npm run check:mas-signing -- --strict",
      "npm run dist:mas",
      "npm run check:mas-package -- --strict",
      "npm run upload-packet:store",
      "npm run check:upload-credentials -- --strict"
    ],
    sourceArtifacts: [
      "package.json",
      "build/entitlements.mas.plist",
      "app-store-assets/SIGNING_ASSET_REPORT.json",
      "app-store-assets/UPLOAD_COMMAND_PACKET.json",
      "scripts/build-apple-release-assets.cjs",
      "scripts/check-apple-release-assets.cjs",
      "scripts/install-mas-profile.cjs",
      "scripts/install-asc-key.cjs"
    ],
    redaction: {
      storesCertificateNames: false,
      storesCertificateHashes: false,
      storesProvisioningProfileNames: false,
      storesProvisioningProfileUuids: false,
      storesAppleAccountEmails: false,
      storesApiKeyIds: false,
      storesPrivateKeyPaths: false,
      storesLocalProfilePaths: false
    }
  };
  const markdown = `# Cody Cartridge Apple Release Asset Requests

Generated by \`npm run apple-assets:store\`.

Use this before signing and upload to request or verify the Apple Developer and App Store Connect assets required by this release. It is intentionally redacted: it records asset classes, counts, commands, and acceptance criteria, not certificate names, profile UUIDs, API key identifiers, private key paths, or Apple account values.

## Summary

- Bundle ID: \`${packet.app.bundleId}\`
- Version: ${packet.app.version}
- Build version: ${packet.app.buildVersion}
- Asset requests: ${packet.summary.assetRequestCount}
- Ready: ${packet.summary.readyCount}
- Manual/account-confirmation: ${packet.summary.manualCount}
- Blocked: ${packet.summary.blockerCount}
- Ready for signing and upload: ${packet.summary.readyForSigningAndUpload ? "yes" : "no"}

## Request Table

${table(assetRequests)}

## Asset Details

${details(assetRequests)}

## Required MAS Entitlements

- Entitlements file: \`${packet.entitlements.path}\`
${packet.entitlements.required.map((key) => `- ${key}`).join("\n") || "- None recorded"}

## Validation Flow

${packet.validationFlow.map((command) => `- \`${command}\``).join("\n")}

## Redaction

- Certificate names and SHA-1 hashes are not stored.
- Provisioning profile names, UUIDs, and local paths are not stored.
- Apple account emails, App Store Connect API key identifiers, private keys, and private key paths are not stored.
- Keep certificates, private keys, provisioning profiles, API keys, and delivery logs outside the project and handoff archive.
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(packet, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);
  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (packet.summary.blockerCount > 0) {
    console.warn(`Apple release asset packet records ${packet.summary.blockerCount} blocked asset request(s).`);
  }
}

main();
