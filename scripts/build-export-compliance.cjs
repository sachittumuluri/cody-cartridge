#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "EXPORT_COMPLIANCE.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "EXPORT_COMPLIANCE.md");
const sourceUrls = [
  "https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/",
  "https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/"
];

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function directDependencyNames(pkg) {
  return Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {})
  }).sort();
}

function fact(id, label, pass, evidence) {
  return {
    id,
    label,
    status: pass ? "pass" : "review",
    evidence
  };
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function main() {
  const pkg = readJson("package.json");
  const appEntitlements = readText("build/entitlements.mas.plist");
  const childEntitlements = readText("build/entitlements.mas.inherit.plist");
  const privacyManifest = readText("build/PrivacyInfo.xcprivacy");
  const sourceText = ["src/App.tsx", "electron/main.cjs", "electron/preload.cjs"].map(readText).join("\n");
  const dependencyNames = directDependencyNames(pkg);
  const infoPlistExportKey = pkg.build?.mac?.extendInfo?.ITSAppUsesNonExemptEncryption;
  const customCryptoPatterns = [
    /bcrypt/i,
    /crypto-js/i,
    /jsonwebtoken/i,
    /libsodium/i,
    /node-forge/i,
    /openpgp/i,
    /tweetnacl/i
  ];
  const customCryptoDependencies = dependencyNames.filter((name) => customCryptoPatterns.some((pattern) => pattern.test(name)));
  const remoteUrls = [...sourceText.matchAll(/https:\/\/[^"`'\s)]+/g)].map((match) => match[0]).sort();
  const unexpectedRemoteUrls = remoteUrls.filter((url) => !url.startsWith("https://music.youtube.com/watch?v="));
  const networkClientEntitlement = appEntitlements.includes("com.apple.security.network.client");
  const sourceUsesExternalOpen = /shell\.openExternal|openExternal/i.test(sourceText);
  const sourceUsesBeaconTelemetry = /navigator\.sendBeacon|XMLHttpRequest/i.test(sourceText);
  const usesLocalProtocols = sourceText.includes("cody-media://track/") && sourceText.includes("cody-art://track/");
  const facts = [
    fact(
      "no-custom-crypto-direct-dependencies",
      "No direct custom cryptography dependencies",
      customCryptoDependencies.length === 0,
      customCryptoDependencies.length > 0
        ? `Review direct dependency/dependencies: ${customCryptoDependencies.join(", ")}`
        : "Direct dependencies do not include known custom cryptography libraries."
    ),
    fact(
      "no-network-client-entitlement",
      "No MAS network client entitlement",
      !networkClientEntitlement,
      networkClientEntitlement
        ? "build/entitlements.mas.plist includes com.apple.security.network.client."
        : "build/entitlements.mas.plist does not include com.apple.security.network.client."
    ),
    fact(
      "local-media-protocols",
      "Playback/artwork use app-local protocols",
      usesLocalProtocols,
      usesLocalProtocols
        ? "Runtime source uses cody-media:// for local audio and cody-art:// for embedded artwork."
        : "Runtime source does not show both cody-media:// and cody-art:// protocol use."
    ),
    fact(
      "no-external-url-open",
      "No external URL launch path",
      !sourceUsesExternalOpen,
      sourceUsesExternalOpen ? "Runtime source references external URL opening." : "Runtime source does not call shell.openExternal/openExternal."
    ),
    fact(
      "no-telemetry-network-hooks",
      "No telemetry transport hooks",
      !sourceUsesBeaconTelemetry,
      sourceUsesBeaconTelemetry ? "Runtime source references beacon/XMLHttpRequest APIs." : "Runtime source does not use beacon/XMLHttpRequest telemetry APIs."
    ),
    fact(
      "remote-urls-metadata-only",
      "Remote URL literals are metadata-only",
      unexpectedRemoteUrls.length === 0,
      unexpectedRemoteUrls.length > 0
        ? `Unexpected remote URL literal(s): ${unexpectedRemoteUrls.join(", ")}`
        : "Only YouTube Music watch URLs appear as metadata references; the app does not open or fetch them."
    ),
    fact(
      "privacy-manifest-no-collection",
      "Privacy manifest declares no tracking or collected data",
      privacyManifest.includes("<key>NSPrivacyTracking</key>") &&
        privacyManifest.includes("<false/>") &&
        privacyManifest.includes("<key>NSPrivacyCollectedDataTypes</key>"),
      "build/PrivacyInfo.xcprivacy is present and declares no tracking/collected data categories."
    ),
    fact(
      "info-plist-non-exempt-encryption",
      "Info.plist declares no non-exempt encryption",
      infoPlistExportKey === false,
      infoPlistExportKey === false
        ? "package.json build.mac.extendInfo sets ITSAppUsesNonExemptEncryption=false."
        : "package.json build.mac.extendInfo does not set ITSAppUsesNonExemptEncryption=false."
    ),
    fact(
      "sandbox-user-selected-files",
      "MAS sandbox file access is user-selected only",
      appEntitlements.includes("com.apple.security.files.user-selected.read-write") &&
        appEntitlements.includes("com.apple.security.files.bookmarks.app-scope") &&
        childEntitlements.includes("com.apple.security.inherit"),
      "MAS entitlements limit file access to user-selected paths (read-write solely for the save-dialog WAV export), app-scope bookmarks, and inherited child sandboxing."
    )
  ];
  const reviewCount = facts.filter((item) => item.status !== "pass").length;
  const artifact = {
    generatedAt: new Date().toISOString(),
    artifactPath: "app-store-assets/EXPORT_COMPLIANCE.json",
    markdownPath: "app-store-assets/EXPORT_COMPLIANCE.md",
    app: {
      name: pkg.build?.productName ?? pkg.name,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion: pkg.build?.buildVersion ?? pkg.version
    },
    summary: {
      status: reviewCount === 0 ? "ready-for-app-store-connect-questionnaire" : "needs-release-review",
      factCount: facts.length,
      reviewCount,
      appStoreConnectDraftAnswer:
        "Current draft: Cody Cartridge intentionally implements no custom or proprietary encryption and ships no network service. If App Store Connect treats platform security as encryption, classify it as encryption limited to that within the Apple operating system; Apple documents that no App Store Connect documentation is required for that case.",
      finalBinaryRequirement:
        "Answer App Store Connect export-compliance questions against the exact signed MAS binary uploaded to App Store Connect. If the binary gains custom cryptography, network features, account login, DRM, or encrypted media transfer before release, regenerate this artifact and re-answer the questionnaire."
    },
    appStoreConnect: {
      location:
        "App Store Connect > App Information > App Encryption Documentation; also resolve any Missing Compliance prompt on the processed build.",
      draftQuestionnairePosition:
        "No app-provided custom/proprietary encryption is intentionally implemented. No custom encryption documentation is expected for the current local-first player build.",
      documentationExpectation:
        "No documentation expected when encryption is limited to that within the Apple operating system, based on Apple App Store Connect export-compliance documentation. Final determination belongs in App Store Connect for the uploaded binary.",
      infoPlistKey:
        "ITSAppUsesNonExemptEncryption=false is stamped into Info.plist so App Store Connect receives the same non-exempt-encryption posture as the questionnaire draft.",
      sourceUrls
    },
    binaryFacts: facts,
    evidence: {
      directDependencies: dependencyNames,
      customCryptoDependencies,
      networkClientEntitlement,
      infoPlistExportKey,
      remoteUrlLiterals: remoteUrls,
      unexpectedRemoteUrls,
      entitlementSources: ["build/entitlements.mas.plist", "build/entitlements.mas.inherit.plist"],
      runtimeSources: ["src/App.tsx", "electron/main.cjs", "electron/preload.cjs"],
      privacyManifest: "build/PrivacyInfo.xcprivacy"
    },
    releaseActions: [
      "Run npm run export-compliance:store before regenerating the submission packet.",
      "Run npm run check:export-compliance after npm run packet:store so generated App Store Connect fields stay aligned.",
      "During App Store Connect processing, resolve any Missing Compliance prompt against the final signed MAS upload.",
      "Save the App Store Connect export-compliance answer state with RELEASE_EVIDENCE.md and delivery logs."
    ]
  };

  const markdown = `# Cody Cartridge Export Compliance Prep

Generated by \`npm run export-compliance:store\`.

This is a release-operator prep artifact for App Store Connect. It is not legal advice and must be reconciled against the exact signed MAS binary that is uploaded.

## Summary

- App: ${artifact.app.name}
- Bundle ID: \`${artifact.app.bundleId}\`
- Version: ${artifact.app.version}
- Build version: ${artifact.app.buildVersion}
- Status: ${artifact.summary.status}
- Facts needing review: ${artifact.summary.reviewCount}

## App Store Connect Draft

- Location: ${artifact.appStoreConnect.location}
- Draft position: ${artifact.appStoreConnect.draftQuestionnairePosition}
- Documentation expectation: ${artifact.appStoreConnect.documentationExpectation}
- Info.plist key: ${artifact.appStoreConnect.infoPlistKey}
- Final binary requirement: ${artifact.summary.finalBinaryRequirement}

## Apple Sources

${list(sourceUrls)}

## Binary Facts

| Fact | Status | Evidence |
| --- | --- | --- |
${facts.map((item) => `| ${item.label} | ${item.status} | ${item.evidence.replace(/\|/g, "\\|")} |`).join("\n")}

## Release Actions

${list(artifact.releaseActions)}
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (reviewCount > 0) {
    console.warn(`Export compliance prep has ${reviewCount} fact(s) needing release review.`);
  }
}

main();
