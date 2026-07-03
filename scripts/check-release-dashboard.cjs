#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "RELEASE_DASHBOARD.json");
const htmlPath = path.join(projectRoot, "app-store-assets", "RELEASE_DASHBOARD.html");
const passes = [];
const warnings = [];
const failures = [];

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

function main() {
  assert(exists(jsonPath), "Release dashboard JSON exists");
  assert(exists(htmlPath), "Release dashboard HTML exists");

  if (!exists(jsonPath) || !exists(htmlPath)) {
    return;
  }

  const dashboard = readJson("app-store-assets/RELEASE_DASHBOARD.json");
  const html = readText("app-store-assets/RELEASE_DASHBOARD.html");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json");
  const publicInputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json");
  const publishPacket = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json");
  const finalChecklist = readJson("app-store-assets/FINAL_SUBMISSION_CHECKLIST.json");
  const machineReport = readJson("app-store-assets/RELEASE_MACHINE_REPORT.json");
  const evidence = readJson("app-store-assets/RELEASE_EVIDENCE.json");
  const pkg = readJson("package.json");
  const raw = `${JSON.stringify(dashboard)}\n${html}`;

  assert(dashboard.app?.bundleId === pkg.build?.appId, "Release dashboard bundle id matches package config");
  assert(dashboard.app?.version === pkg.version, "Release dashboard version matches package config");
  assert(dashboard.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Release dashboard build version matches package config");
  assert(dashboard.summary?.releaseBlockers === blockers.summary?.blockerCount, "Release dashboard blocker count matches blocker report");
  assert(dashboard.summary?.readyForStrictPreflight === Boolean(blockers.summary?.readyForStrictPreflight), "Release dashboard strict-readiness flag matches blocker report");
  assert(dashboard.summary?.publicInputsReady === publicInputs.summary?.readyCount, "Release dashboard public-input ready count matches source");
  assert(dashboard.summary?.publicInputsRequired === publicInputs.summary?.requiredCount, "Release dashboard public-input required count matches source");
  assert(dashboard.summary?.publicInputsBlocked === publicInputs.summary?.blockerCount, "Release dashboard public-input blocker count matches source");
  assert(dashboard.summary?.publishPacketStatus === publishPacket.summary?.publishStatus, "Release dashboard publish packet status matches source");
  assert(dashboard.summary?.publishPacketReadyPages === publishPacket.summary?.readyPageCount, "Release dashboard publish packet ready page count matches source");
  assert(
    dashboard.summary?.publishPacketRequiredPages === publishPacket.summary?.requiredPageCount,
    "Release dashboard publish packet required page count matches source"
  );
  assert(dashboard.summary?.finalChecklistBlockers === finalChecklist.summary?.blockerCount, "Release dashboard final checklist blocker count matches source");
  assert(
    dashboard.summary?.machineReportBlockedGates === machineReport.summary?.blockedGateCount,
    "Release dashboard machine-report blocked gate count matches source"
  );
  assert(
    dashboard.summary?.machineReportWarningGates === machineReport.summary?.warningGateCount,
    "Release dashboard machine-report warning gate count matches source"
  );
  assert(dashboard.summary?.evidenceCommands === evidence.commands?.length, "Release dashboard evidence command count matches source");
  assert(dashboard.summary?.evidenceArtifacts === evidence.artifacts?.length, "Release dashboard evidence artifact count matches source");
  assert(
    dashboard.summary?.masSubmissionReady === (evidence.masSubmission?.submissionReady === true),
    "Release dashboard MAS readiness flag matches release evidence"
  );
  assert(dashboard.masSubmission?.mode === evidence.masSubmission?.mode, "Release dashboard MAS mode matches release evidence");
  assert(
    dashboard.masSubmission?.submissionReady === (evidence.masSubmission?.submissionReady === true),
    "Release dashboard MAS submission readiness matches release evidence"
  );
  assert(
    dashboard.masSubmission?.localRehearsalOnly === (evidence.masSubmission?.localRehearsalOnly === true),
    "Release dashboard MAS local rehearsal flag matches release evidence"
  );
  assert(
    dashboard.masSubmission?.hasEmbeddedProvisioningProfile === (evidence.masSubmission?.hasEmbeddedProvisioningProfile === true),
    "Release dashboard MAS provisioning posture matches release evidence"
  );
  assert(
    dashboard.masSubmission?.codeSignatureVerified === (evidence.masSubmission?.codeSignatureVerified === true),
    "Release dashboard MAS code-signature posture matches release evidence"
  );
  assert(
    dashboard.masSubmission?.uploadPackageCount === Number(evidence.masSubmission?.uploadPackageCount ?? 0) &&
      dashboard.masSubmission?.signedUploadPackageCount === Number(evidence.masSubmission?.signedUploadPackageCount ?? 0) &&
      dashboard.masSubmission?.currentVersionUploadPackageCount === Number(evidence.masSubmission?.currentVersionUploadPackageCount ?? 0) &&
      dashboard.masSubmission?.signedCurrentVersionUploadPackageCount === Number(evidence.masSubmission?.signedCurrentVersionUploadPackageCount ?? 0),
    "Release dashboard MAS upload package posture matches release evidence"
  );
  assert(Array.isArray(dashboard.categories) && dashboard.categories.length === (blockers.categories?.length ?? 0), "Release dashboard records every blocker category");
  assert(
    ["public-inputs", "generated-site", "signing-package", "submission"].every((id) => dashboard.categories?.some((category) => category.id === id)),
    "Release dashboard includes every release blocker category"
  );
  assert(Boolean(dashboard.nextAction?.command), "Release dashboard records next command");
  if ((blockers.nextActionQueue ?? []).length > 0) {
    const firstQueuedAction = blockers.nextActionQueue[0];
    assert(dashboard.nextAction?.source?.includes("RELEASE_BLOCKERS.json"), "Release dashboard next action is sourced from blocker report queue");
    assert(dashboard.nextAction?.categoryId === firstQueuedAction.categoryId, "Release dashboard next action category matches blocker queue");
    assert(dashboard.nextAction?.checkId === firstQueuedAction.firstBlockedCheckId, "Release dashboard next action check matches blocker queue");
    assert(dashboard.nextAction?.command === firstQueuedAction.recommendedCommand, "Release dashboard next command matches blocker queue");
    assert(dashboard.nextAction?.detail === firstQueuedAction.nextAction, "Release dashboard next detail matches blocker queue");
  } else {
    assert(dashboard.nextAction?.command === "npm run release:store:preflight", "Release dashboard falls back to strict preflight when blocker queue is empty");
  }
  assert((dashboard.sourceArtifacts ?? []).includes("app-store-assets/RELEASE_BLOCKERS.json"), "Release dashboard records blocker source artifact");
  assert((dashboard.sourceArtifacts ?? []).includes("app-store-assets/PUBLIC_RELEASE_INPUTS.json"), "Release dashboard records public-input source artifact");
  assert((dashboard.sourceArtifacts ?? []).includes("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json"), "Release dashboard records publish-packet source artifact");
  assert((dashboard.sourceArtifacts ?? []).includes("app-store-assets/UPLOAD_COMMAND_PACKET.json"), "Release dashboard records upload-packet source artifact");
  assert((dashboard.sourceArtifacts ?? []).includes("app-store-assets/FINAL_SUBMISSION_CHECKLIST.json"), "Release dashboard records final checklist source artifact");
  assert((dashboard.sourceArtifacts ?? []).includes("app-store-assets/RELEASE_MACHINE_REPORT.json"), "Release dashboard records machine-report source artifact");
  assert(!raw.includes("you@example.com"), "Release dashboard excludes placeholder email values");
  assert(!raw.includes("+1-555-555-5555"), "Release dashboard excludes placeholder phone values");
  assert(!raw.includes("Your Name"), "Release dashboard excludes placeholder names");
  assert(!/<script\b/i.test(html), "Release dashboard HTML contains no script tags");
  assert(html.includes("Cody Cartridge Release Dashboard"), "Release dashboard HTML includes title");
  assert(html.includes("Next release-machine move"), "Release dashboard HTML includes next-action section");
  assert(html.includes("MAS submission posture"), "Release dashboard HTML includes MAS submission posture section");
  assert(html.includes("UPLOAD_COMMAND_PACKET.md"), "Release dashboard HTML links the upload-packet artifact by name");
  assert(html.includes("Not ready for upload") || html.includes("Signed package ready"), "Release dashboard HTML includes MAS upload readiness copy");
  if (dashboard.nextAction?.categoryId === "public-inputs") {
    assert(
      dashboard.nextAction?.command?.includes("npm run check:release-runtime:node -- --strict"),
      "Release dashboard public-input action includes Node-safe strict release runtime check"
    );
    assert(
      dashboard.nextAction.command.includes("npm run configure:store-env") && dashboard.nextAction.command.includes("--site-url"),
      "Release dashboard public-input action uses validated store env configurator"
    );
    assert(
      dashboard.nextAction.command.includes("npm run public-inputs:store") &&
        dashboard.nextAction.command.includes("npm run check:store-env"),
      "Release dashboard public-input action regenerates and checks public release inputs"
    );
  }
  assert(html.includes("Release blockers"), "Release dashboard HTML includes blocker summary");
  assert(html.includes("PUBLIC_RELEASE_INPUTS.md"), "Release dashboard HTML links the public-input artifact by name");
  assert(html.includes("PUBLIC_SITE_PUBLISH_PACKET.md"), "Release dashboard HTML links the publish-packet artifact by name");
  assert(html.includes("RELEASE_MACHINE_REPORT.md"), "Release dashboard HTML links the machine-report artifact by name");

  if ((dashboard.summary?.releaseBlockers ?? 0) > 0) {
    warn(`Release dashboard records ${dashboard.summary.releaseBlockers} blocker(s)`);
  } else {
    pass("Release dashboard records no blockers");
  }
}

main();

console.log(`Release dashboard checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
