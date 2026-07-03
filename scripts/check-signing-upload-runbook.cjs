#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "SIGNING_UPLOAD_RUNBOOK.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "SIGNING_UPLOAD_RUNBOOK.md");
const passes = [];
const failures = [];
const warnings = [];

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function assert(condition, message) {
  if (condition) {
    pass(message);
  } else {
    fail(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function includesInOrder(values, first, second) {
  const firstIndex = values.findIndex((value) => String(value).includes(first));
  const secondIndex = values.findIndex((value) => String(value).includes(second));
  return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex;
}

function commandIncludesInOrder(values, commandNeedle, ...needles) {
  const command = values.find((value) => String(value).includes(commandNeedle));

  if (!command) {
    return false;
  }

  let cursor = -1;
  const text = String(command);

  for (const needle of needles) {
    const next = text.indexOf(needle, cursor + 1);

    if (next < 0) {
      return false;
    }

    cursor = next;
  }

  return true;
}

function blockedLabelsForCategory(blockers, categoryId) {
  return (blockers.categories ?? [])
    .find((category) => category.id === categoryId)
    ?.checks?.filter((check) => check.status === "blocked")
    .map((check) => check.label) ?? [];
}

function main() {
  assert(exists(jsonPath), "Signing/upload runbook JSON exists");
  assert(exists(markdownPath), "Signing/upload runbook markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    console.log(`Signing/upload runbook checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const pkg = readJson("package.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json");
  const signingAssetReport = readJson("app-store-assets/SIGNING_ASSET_REPORT.json");
  const runbook = readJson("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json");
  const markdown = readText("app-store-assets/SIGNING_UPLOAD_RUNBOOK.md");
  const commands = (runbook.releaseMachineCommands ?? []).map((item) => item.command);

  assert(runbook.app?.bundleId === pkg.build?.appId, "Runbook bundle id matches package config");
  assert(runbook.app?.version === pkg.version, "Runbook package version matches package config");
  assert(runbook.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Runbook build version matches package config");
  assert(runbook.app?.minimumSystemVersion === pkg.build?.mas?.minimumSystemVersion, "Runbook minimum macOS version matches MAS config");
  assert(runbook.remainingBlockers?.total === (blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0), "Runbook blocker total matches release blocker report");
  assert(
    JSON.stringify(runbook.remainingBlockers?.publicInputs ?? []) === JSON.stringify(blockedLabelsForCategory(blockers, "public-inputs")),
    "Runbook public-input blockers match blocker report"
  );
  assert(
    JSON.stringify(runbook.remainingBlockers?.generatedSite ?? []) === JSON.stringify(blockedLabelsForCategory(blockers, "generated-site")),
    "Runbook generated-site blockers match blocker report"
  );
  assert(
    JSON.stringify(runbook.remainingBlockers?.signingPackage ?? []) === JSON.stringify(blockedLabelsForCategory(blockers, "signing-package")),
    "Runbook signing/package blockers match blocker report"
  );
  assert(
    JSON.stringify(runbook.remainingBlockers?.submission ?? []) === JSON.stringify(blockedLabelsForCategory(blockers, "submission")),
    "Runbook submission blockers match blocker report"
  );
  assert(runbook.requiredSigningAssets?.entitlements === pkg.build?.mas?.entitlements, "Runbook entitlements path matches package config");
  assert(runbook.requiredSigningAssets?.inheritedEntitlements === pkg.build?.mas?.entitlementsInherit, "Runbook inherited entitlements path matches package config");
  assert(runbook.signingAssetSnapshot?.status === signingAssetReport.summary?.status, "Runbook signing asset snapshot status matches report");
  assert(runbook.signingAssetSnapshot?.blockerCount === signingAssetReport.summary?.blockerCount, "Runbook signing asset blocker count matches report");
  assert(
    runbook.signingAssetSnapshot?.readyForMasSigning === (signingAssetReport.summary?.readyForMasSigning === true),
    "Runbook signing asset readiness matches report"
  );
  assert(
    runbook.signingAssetSnapshot?.applicationDistributionIdentityCount ===
      signingAssetReport.identities?.applicationDistributionIdentityCount,
    "Runbook signing asset application identity count matches report"
  );
  assert(
    runbook.signingAssetSnapshot?.installerDistributionIdentityCount ===
      signingAssetReport.identities?.installerDistributionIdentityCount,
    "Runbook signing asset installer identity count matches report"
  );
  assert(
    runbook.signingAssetSnapshot?.unexpiredMacDistributionProfileCount ===
      signingAssetReport.provisioningProfiles?.unexpiredMacDistributionProfileCount,
    "Runbook signing asset profile count matches report"
  );
  assert(runbook.signingAssetSnapshot?.redacted === true, "Runbook signing asset snapshot is redacted");

  assert(/Apple Distribution|Mac App Distribution|3rd Party Mac Developer Application/.test(runbook.requiredSigningAssets?.applicationIdentity ?? ""), "Runbook names required application signing identities");
  assert(/Mac Installer Distribution|3rd Party Mac Developer Installer/.test(runbook.requiredSigningAssets?.installerIdentity ?? ""), "Runbook names required installer signing identities");
  assert(/get-task-allow=false/.test(runbook.requiredSigningAssets?.provisioningProfile ?? ""), "Runbook requires distribution provisioning profile posture");
  assert(runbook.expectedPackageOutputs?.appBundlePath === "dist/mas-arm64/Cody Cartridge.app", "Runbook records expected MAS app bundle path");
  assert(runbook.expectedPackageOutputs?.uploadPackagePattern === "dist/**/*.pkg", "Runbook records expected MAS upload package pattern");
  assert(runbook.expectedPackageOutputs?.packagedAsar?.endsWith("/app.asar"), "Runbook records packaged app.asar path");
  assert(Array.isArray(runbook.uploadTooling) && runbook.uploadTooling.some((item) => item.includes("Transporter")), "Runbook includes Transporter upload option");
  assert(runbook.uploadTooling?.some((item) => item.includes("altool")), "Runbook includes altool upload option");
  assert(runbook.uploadTooling?.some((item) => item.includes("iTMSTransporter")), "Runbook includes iTMSTransporter upload option");
  assert(
    Array.isArray(runbook.nodeWrappedShortcuts) &&
      runbook.nodeWrappedShortcuts.some((item) => item.command === "npm run release:store:local:node") &&
      runbook.nodeWrappedShortcuts.some((item) => item.command === "npm run public-release:store:node") &&
      runbook.nodeWrappedShortcuts.some((item) => item.command === "npm run public-release:store:published:node") &&
      runbook.nodeWrappedShortcuts.some((item) => item.command === "npm run release:store:preflight:node") &&
      runbook.nodeWrappedShortcuts.some((item) => item.command === "npm run check:release-machine:node -- --strict") &&
      runbook.nodeWrappedShortcuts.some((item) => item.command === "npm run verify:store:strict:node"),
    "Runbook includes Node-safe release shortcut commands"
  );
  assert(
    (runbook.nodeWrappedShortcuts ?? []).every((item) => item.purpose?.includes(".nvmrc")),
    "Runbook Node-safe shortcut purposes mention .nvmrc release runtime"
  );
  assert(Array.isArray(runbook.signingRemediationChecklist), "Runbook records signing remediation checklist");
  assert(runbook.signingRemediationChecklist?.some((item) => item.includes(pkg.build?.appId)), "Runbook remediation names bundle id");
  assert(
    runbook.signingRemediationChecklist?.some((item) => /Apple Distribution|Mac App Distribution|3rd Party Mac Developer Application/.test(item)),
    "Runbook remediation includes application identity step"
  );
  assert(
    runbook.signingRemediationChecklist?.some((item) => /Mac Installer Distribution|3rd Party Mac Developer Installer/.test(item)),
    "Runbook remediation includes installer identity step"
  );
  assert(
    runbook.signingRemediationChecklist?.some((item) => /provisioning profile/i.test(item) && item.includes(pkg.build?.appId)),
    "Runbook remediation includes matching provisioning profile step"
  );
  assert(
    runbook.signingRemediationChecklist?.some((item) => item.includes("npm run install:mas-profile")),
    "Runbook remediation includes MAS profile installer"
  );
  assert(
    runbook.signingRemediationChecklist?.some((item) => /get-task-allow=false/.test(item) && /unexpired/.test(item)),
    "Runbook remediation includes distribution profile posture"
  );
  assert(
    runbook.signingRemediationChecklist?.some((item) => item.includes("build/entitlements.mas.plist")),
    "Runbook remediation includes entitlement confirmation"
  );
  assert(
    runbook.signingRemediationChecklist?.some((item) => item.includes("npm run signing-assets:store")),
    "Runbook remediation includes signing asset report refresh"
  );
  assert(
    runbook.signingRemediationChecklist?.some((item) => item.includes("npm run check:mas-signing -- --strict")),
    "Runbook remediation includes strict signing gate"
  );
  assert(
    runbook.signingRemediationChecklist?.some((item) => /private keys|provisioning profiles|upload credentials/i.test(item)),
    "Runbook remediation keeps signing secrets out of handoff"
  );

	  [
    "npm run check:store-env",
    "npm run check:release-runtime -- --strict",
    "npm run public-release:store -- --self-test",
    "npm run public-release:store:node -- --self-test",
    "npm run public-release:store -- --published",
    "npm run public-release:store:published:node",
    "npm run app-compliance:store",
    "npm run check:app-compliance",
    "npm run check:public-release-sync -- --strict",
    "npm run check:published-site -- --strict",
    "npm run signing-assets:store",
    "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run",
    "npm run check:mas-signing -- --strict",
    "npm run dist:mas",
    "npm run check:mas-package -- --strict",
    "npm run check:upload-tooling -- --strict",
    "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run",
    "npm run check:upload-credentials -- --strict",
    "npm run upload-packet:store",
    "npm run apple-assets:store",
    "npm run upload-evidence:store",
    "npm run check:release-machine -- --strict",
    "npm run public-inputs:store",
    "npm run publish-packet:store",
    "npm run public-host:store",
    "npm run signing-runbook:store",
    "npm run resolution-plan:store",
    "npm run submission-checklist:store",
    "npm run machine-report:store",
    "npm run check:evidence",
    "npm run dashboard:store",
    "npm run operator:store",
    "npm run check:manifest",
    "npm run verify:store:strict"
  ].forEach((command) => {
    assert(commands.some((item) => item.includes(command)), `Runbook includes ${command}`);
  });

  assert(includesInOrder(commands, "npm run check:store-env", "npm run check:release-runtime -- --strict"), "Runbook checks release runtime after public env");
  assert(includesInOrder(commands, "npm run check:release-runtime -- --strict", "npm run check:store-version:source"), "Runbook checks source version after release runtime");
  assert(includesInOrder(commands, "npm run check:store-version:source", "npm run public-release:store -- --self-test"), "Runbook runs public-release self-test after source version check");
  assert(includesInOrder(commands, "npm run public-release:store -- --self-test", "npm run public-release:store:node -- --self-test"), "Runbook includes Node-safe public-release self-test after raw self-test");
  assert(includesInOrder(commands, "npm run public-release:store -- --self-test", "npm run public-release:store -- --published"), "Runbook runs public-release refresh after wrapper self-test");
  assert(includesInOrder(commands, "npm run public-release:store -- --published", "npm run public-release:store:published:node"), "Runbook includes Node-safe published public-release shortcut after raw refresh");
  assert(includesInOrder(commands, "npm run public-release:store -- --published", "npm run site:store && npm run check:site -- --strict"), "Runbook expands public-release refresh into detailed site checks");
  assert(includesInOrder(commands, "npm run archive:site && npm run check:site-archive -- --strict", "npm run publish-packet:store"), "Runbook builds publish packet after site archive validation");
  assert(includesInOrder(commands, "npm run publish-packet:store", "npm run public-host:store"), "Runbook builds public host runbook after publish packet");
  assert(includesInOrder(commands, "npm run public-host:store", "npm run packet:store && npm run app-compliance:store"), "Runbook refreshes App Store packet after public host runbook");
  assert(
    includesInOrder(
      commands,
      "npm run check:review-brief -- --strict && npm run check:copy-map -- --strict && npm run check:app-compliance && npm run check:store-copy",
      "npm run check:public-release-sync -- --strict"
    ),
    "Runbook checks public release sync after generated copy checks"
  );
  assert(
    includesInOrder(commands, "npm run check:public-release-sync -- --strict", "npm run check:store-urls -- --strict"),
    "Runbook checks public release sync before published URL reachability"
  );
  assert(includesInOrder(commands, "npm run check:store-urls -- --strict", "npm run check:published-site -- --strict"), "Runbook checks full published site after URL reachability");
  assert(includesInOrder(commands, "npm run check:published-site -- --strict", "npm run signing-assets:store"), "Runbook builds signing asset report after full published-site check");
  assert(includesInOrder(commands, "npm run signing-assets:store", "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run"), "Runbook validates MAS profile after signing asset report");
  assert(includesInOrder(commands, "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run", "npm run check:mas-signing -- --strict"), "Runbook validates MAS profile before strict signing check");
  assert(includesInOrder(commands, "npm run signing-assets:store", "npm run check:mas-signing -- --strict"), "Runbook builds signing asset report before strict signing check");
  assert(includesInOrder(commands, "npm run check:mas-signing -- --strict", "npm run dist:mas"), "Runbook checks signing before MAS packaging");
  assert(includesInOrder(commands, "npm run dist:mas", "npm run check:mas-package -- --strict"), "Runbook checks package after MAS packaging");
  assert(includesInOrder(commands, "npm run check:mas-package -- --strict", "npm run check:upload-tooling -- --strict"), "Runbook checks upload tooling after package boundary");
  assert(
    includesInOrder(commands, "npm run check:upload-tooling -- --strict", "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run"),
    "Runbook validates App Store Connect API key after upload tooling"
  );
  assert(
    includesInOrder(commands, "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run", "npm run check:upload-credentials -- --strict"),
    "Runbook checks upload credentials after API key validation"
  );
  assert(includesInOrder(commands, "npm run check:upload-credentials -- --strict", "npm run upload-packet:store"), "Runbook builds upload command packet after upload credentials");
  assert(
    commandIncludesInOrder(
      commands,
      "npm run report:store-blockers && npm run public-inputs:store",
      "npm run upload-packet:store",
      "npm run copy-map:store"
    ),
    "Runbook refreshes copy map after upload command packet"
  );
  assert(
    commandIncludesInOrder(
      commands,
      "npm run report:store-blockers && npm run public-inputs:store",
      "npm run copy-map:store",
      "npm run apple-assets:store"
    ),
    "Runbook builds Apple release asset packet after final copy map refresh"
  );
  assert(includesInOrder(commands, "npm run apple-assets:store", "npm run upload-evidence:store"), "Runbook captures sanitized upload evidence after Apple release asset packet");
  assert(
    includesInOrder(
      commands,
      "npm run upload-evidence:store",
      "npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store && npm run signing-assets:store && npm run upload-packet:store && npm run copy-map:store && npm run apple-assets:store && npm run signing-runbook:store && npm run resolution-plan:store && npm run submission-checklist:store && npm run machine-report:store && npm run evidence:store"
    ),
    "Runbook captures upload evidence before regenerating release evidence"
  );
  assert(
    commands.some((command) => command.includes("npm run submission-checklist:store && npm run machine-report:store && npm run evidence:store")),
    "Runbook records machine report between final checklist and evidence"
  );
  assert(includesInOrder(commands, "npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store && npm run signing-assets:store && npm run upload-packet:store && npm run copy-map:store && npm run apple-assets:store && npm run signing-runbook:store && npm run resolution-plan:store && npm run submission-checklist:store && npm run machine-report:store && npm run evidence:store && npm run check:evidence && npm run dashboard:store && npm run operator:store && npm run manifest:store && npm run check:manifest && npm run handoff:store", "npm run verify:store:strict"), "Runbook regenerates machine report and checks evidence before strict verification");
  assert(includesInOrder(commands, "npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store && npm run signing-assets:store && npm run upload-packet:store && npm run copy-map:store && npm run apple-assets:store && npm run signing-runbook:store && npm run resolution-plan:store && npm run submission-checklist:store && npm run machine-report:store && npm run evidence:store && npm run check:evidence && npm run dashboard:store && npm run operator:store && npm run manifest:store && npm run check:manifest && npm run handoff:store", "npm run check:release-machine -- --strict"), "Runbook runs release-machine doctor after checked artifact refresh");
  assert(includesInOrder(commands, "npm run check:release-machine -- --strict", "npm run verify:store:strict"), "Runbook runs release-machine doctor before strict verification");

  assert(markdown.includes("# Cody Cartridge Signing And Upload Runbook"), "Runbook markdown includes title");
  assert(markdown.includes("## Required Signing Assets"), "Runbook markdown includes signing assets section");
  assert(markdown.includes("## Redacted Signing Asset Snapshot"), "Runbook markdown includes signing asset snapshot");
  assert(markdown.includes("## Release-Machine Commands"), "Runbook markdown includes command section");
  assert(markdown.includes("### Node-Safe Shortcuts"), "Runbook markdown includes Node-safe shortcuts section");
  assert(markdown.includes("npm run public-release:store:published:node"), "Runbook markdown includes Node-safe published public-release shortcut");
  assert(markdown.includes("npm run release:store:preflight:node"), "Runbook markdown includes Node-safe strict preflight shortcut");
  assert(markdown.includes("npm run verify:store:strict:node"), "Runbook markdown includes Node-safe strict verifier shortcut");
  assert(markdown.includes("## Upload Checklist"), "Runbook markdown includes upload checklist");
  assert(markdown.includes("UPLOAD_EVIDENCE.md"), "Runbook markdown includes upload evidence artifact");
  assert(markdown.includes("UPLOAD_COMMAND_PACKET.md"), "Runbook markdown includes upload command packet artifact");
  assert(markdown.includes("install:asc-key"), "Runbook markdown includes App Store Connect key installer helper");
  assert(markdown.includes("check:upload-credentials"), "Runbook markdown includes upload credential preflight");
  assert(markdown.includes("## Signing Remediation Checklist"), "Runbook markdown includes signing remediation checklist");
  assert(markdown.includes("dist/mas-arm64/Cody Cartridge.app"), "Runbook markdown includes MAS app path");
  assert(markdown.includes("Generated site blockers"), "Runbook markdown includes generated-site blocker count");

  if ((runbook.remainingBlockers?.total ?? 0) > 0) {
    warn(`Runbook records ${runbook.remainingBlockers.total} remaining blocker(s)`);
  }

  console.log(`Signing/upload runbook checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
