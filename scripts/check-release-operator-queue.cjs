#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "RELEASE_OPERATOR_QUEUE.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "RELEASE_OPERATOR_QUEUE.md");
const passes = [];
const warnings = [];
const failures = [];

function pass(message) {
  passes.push(message);
}

function warn(message) {
  warnings.push(message);
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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function blockedCountForPhase(blockers, phase) {
  return (phase.blockerCategoryIds ?? []).reduce((count, categoryId) => {
    const category = (blockers.categories ?? []).find((item) => item.id === categoryId);
    return count + (category?.checks ?? []).filter((check) => check.status === "blocked").length;
  }, 0);
}

function firstBlocked(queue) {
  return queue.find((phase) => phase.status === "blocked") ?? queue[queue.length - 1] ?? null;
}

function main() {
  assert(exists(jsonPath), "Release operator queue JSON exists");
  assert(exists(markdownPath), "Release operator queue markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    return;
  }

  const pkg = readJson("package.json");
  const queue = readJson("app-store-assets/RELEASE_OPERATOR_QUEUE.json");
  const markdown = readText("app-store-assets/RELEASE_OPERATOR_QUEUE.md");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json");
  const publicInputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json");
  const publishPacket = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json");
  const finalChecklist = readJson("app-store-assets/FINAL_SUBMISSION_CHECKLIST.json");
  const resolutionPlan = readJson("app-store-assets/RELEASE_RESOLUTION_PLAN.json");
  const runbook = readJson("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json");
  const dashboard = readJson("app-store-assets/RELEASE_DASHBOARD.json");
  const raw = `${JSON.stringify(queue)}\n${markdown}`;

  assert(queue.app?.bundleId === pkg.build?.appId, "Release operator queue bundle id matches package config");
  assert(queue.app?.version === pkg.version, "Release operator queue version matches package config");
  assert(queue.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Release operator queue build version matches package config");
  assert(queue.summary?.releaseBlockers === blockers.summary?.blockerCount, "Release operator queue blocker count matches blocker report");
  assert(queue.summary?.readyForStrictPreflight === Boolean(blockers.summary?.readyForStrictPreflight), "Release operator queue strict-readiness flag matches blocker report");
  assert(queue.summary?.publicInputsReady === publicInputs.summary?.readyCount, "Release operator queue public-input ready count matches source");
  assert(queue.summary?.publicInputsRequired === publicInputs.summary?.requiredCount, "Release operator queue public-input required count matches source");
  assert(queue.summary?.publicInputsBlocked === publicInputs.summary?.blockerCount, "Release operator queue public-input blocker count matches source");
  assert(queue.summary?.publishPacketStatus === publishPacket.summary?.publishStatus, "Release operator queue publish packet status matches source");
  assert(queue.summary?.publishPacketReadyPages === publishPacket.summary?.readyPageCount, "Release operator queue publish packet ready page count matches source");
  assert(
    queue.summary?.publishPacketRequiredPages === publishPacket.summary?.requiredPageCount,
    "Release operator queue publish packet required page count matches source"
  );
  assert(queue.summary?.finalChecklistBlockers === finalChecklist.summary?.blockerCount, "Release operator queue final checklist blocker count matches source");
  assert(
    queue.summary?.masSubmissionReady === (dashboard.masSubmission?.submissionReady === true),
    "Release operator queue MAS readiness flag matches dashboard"
  );
  assert(queue.masSubmission?.mode === dashboard.masSubmission?.mode, "Release operator queue MAS mode matches dashboard");
  assert(
    queue.masSubmission?.submissionReady === (dashboard.masSubmission?.submissionReady === true),
    "Release operator queue MAS submission readiness matches dashboard"
  );
  assert(
    queue.masSubmission?.localRehearsalOnly === (dashboard.masSubmission?.localRehearsalOnly === true),
    "Release operator queue MAS local rehearsal flag matches dashboard"
  );
  assert(
    queue.masSubmission?.hasEmbeddedProvisioningProfile === (dashboard.masSubmission?.hasEmbeddedProvisioningProfile === true),
    "Release operator queue MAS provisioning posture matches dashboard"
  );
  assert(
    queue.masSubmission?.codeSignatureVerified === (dashboard.masSubmission?.codeSignatureVerified === true),
    "Release operator queue MAS code-signature posture matches dashboard"
  );
  assert(
    queue.masSubmission?.uploadPackageCount === Number(dashboard.masSubmission?.uploadPackageCount ?? 0) &&
      queue.masSubmission?.signedUploadPackageCount === Number(dashboard.masSubmission?.signedUploadPackageCount ?? 0) &&
      queue.masSubmission?.currentVersionUploadPackageCount === Number(dashboard.masSubmission?.currentVersionUploadPackageCount ?? 0) &&
      queue.masSubmission?.signedCurrentVersionUploadPackageCount === Number(dashboard.masSubmission?.signedCurrentVersionUploadPackageCount ?? 0),
    "Release operator queue MAS upload package posture matches dashboard"
  );
  assert(Array.isArray(queue.queue) && queue.queue.length === (resolutionPlan.phases?.length ?? 0), "Release operator queue records every resolution-plan phase");
  assert(queue.queue?.every((phase, index) => phase.id === resolutionPlan.phases?.[index]?.id), "Release operator queue preserves resolution-plan phase order");
  assert(
    queue.queue?.every((phase, index) => phase.blockerCount === blockedCountForPhase(blockers, resolutionPlan.phases?.[index] ?? {})),
    "Release operator queue phase blocker counts match blocker report"
  );
  assert(
    queue.nextAction?.phaseId === firstBlocked(queue.queue ?? [])?.id,
    "Release operator queue next action points at first blocked phase"
  );
  assert(queue.nextAction?.command === dashboard.nextAction?.command, "Release operator queue next command matches dashboard next action");
  assert(queue.strictPreflight?.command === "npm run release:store:preflight", "Release operator queue records strict preflight command");
  assert(queue.strictPreflight?.nodeCommand === "npm run release:store:preflight:node", "Release operator queue records Node-safe strict preflight command");
  assert(
    queue.strictPreflight?.ready === Boolean(blockers.summary?.readyForStrictPreflight),
    "Release operator queue strict preflight readiness matches blocker report"
  );
  assert(
    queue.strictPreflight?.blockerCount === blockers.summary?.blockerCount,
    "Release operator queue strict preflight blocker count matches blocker report"
  );
  assert(
    Array.isArray(queue.strictPreflight?.blockedCategories) &&
      queue.strictPreflight.blockedCategories.length === (blockers.nextActionQueue ?? []).length,
    "Release operator queue strict preflight lists current blocked categories"
  );
  assert(
    (queue.strictPreflight?.blockedCategories ?? []).every((category, index) => {
      const source = blockers.nextActionQueue?.[index];
      return (
        category.categoryId === source?.categoryId &&
        category.blockerCount === source?.blockerCount &&
        category.firstBlockedCheckId === source?.firstBlockedCheckId
      );
    }),
    "Release operator queue strict preflight blocked categories match blocker queue"
  );
  assert(
    (queue.strictPreflight?.runWhen ?? []).some((item) => item.includes("zero blockers")) &&
      (queue.strictPreflight?.runWhen ?? []).some((item) => item.includes("MAS signing assets")),
    "Release operator queue strict preflight records run conditions"
  );
  if ((blockers.nextActionQueue ?? []).length > 0) {
    const firstQueuedAction = blockers.nextActionQueue[0];
    assert(queue.blockerQueueAction?.categoryId === firstQueuedAction.categoryId, "Release operator queue records blocker queue category");
    assert(queue.blockerQueueAction?.firstBlockedCheckId === firstQueuedAction.firstBlockedCheckId, "Release operator queue records blocker queue check");
    assert(queue.blockerQueueAction?.recommendedCommand === firstQueuedAction.recommendedCommand, "Release operator queue records blocker queue command");
    assert(queue.nextAction?.source === dashboard.nextAction?.source, "Release operator queue next-action source matches dashboard");
  }
  if (queue.nextAction?.phaseId === "prepare-public-inputs") {
    assert(
      queue.nextAction.command.includes("npm run configure:store-env") && queue.nextAction.command.includes("--site-url"),
      "Release operator queue public-input action uses validated store env configurator"
    );
    assert(queue.nextAction.command.includes("npm run check:store-env"), "Release operator queue public-input action checks release env after writing overlay");
    assert(
      queue.nextAction.validateCommand?.includes("npm run configure:store-env -- --dry-run") &&
        queue.nextAction.validateCommand?.includes("npm run public-release:store:node -- --self-test"),
      "Release operator queue public-input validation command dry-runs values through Node-safe self-test"
    );
    assert(
      queue.nextAction.applyCommand?.includes("npm run configure:store-env -- --dry-run") &&
        queue.nextAction.applyCommand?.includes("npm run configure:store-env -- --site-url") &&
        queue.nextAction.applyCommand?.includes("npm run public-release:store:node -- --self-test") &&
        queue.nextAction.applyCommand?.includes("npm run public-inputs:store") &&
        queue.nextAction.applyCommand?.includes("npm run check:store-env") &&
        queue.nextAction.applyCommand?.includes("npm run check:release-runtime:node -- --strict"),
      "Release operator queue public-input apply command writes env overlay and runs Node-safe validation"
    );
    assert(
      queue.nextAction.verificationCommand?.includes("npm run public-inputs:store") &&
        queue.nextAction.verificationCommand?.includes("npm run check:store-env") &&
        queue.nextAction.verificationCommand?.includes("npm run check:release-runtime:node -- --strict"),
      "Release operator queue public-input verification command checks refreshed public inputs"
    );
    assert(
      (queue.nextAction.stopWhen ?? []).some((item) => item.includes("check:release-runtime:node -- --strict")),
      "Release operator queue public-input stop criteria include Node-safe strict runtime check"
    );
  }
  assert(
    JSON.stringify(queue.releaseMachineCommands ?? []) === JSON.stringify((runbook.releaseMachineCommands ?? []).map((item) => item.command)),
    "Release operator queue mirrors runbook release-machine commands"
  );
  assert(
    (queue.releaseMachineCommands ?? []).some((command) => command.includes("npm run check:release-runtime -- --strict")),
    "Release operator queue includes strict release runtime command"
  );
  [
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/RELEASE_MACHINE_REPORT.json",
    "app-store-assets/RELEASE_EVIDENCE.json",
    "app-store-assets/RELEASE_DASHBOARD.json"
  ].forEach((artifact) => {
    assert(queue.sourceArtifacts?.includes(artifact), `Release operator queue records ${artifact} source`);
  });
  assert(queue.redaction?.storesRawContactValues === false, "Release operator queue records raw-contact redaction posture");
  assert(queue.redaction?.storesSigningSecrets === false, "Release operator queue records signing-secret redaction posture");
  assert(queue.redaction?.privateEnvFileIncluded === false, "Release operator queue excludes private env file");
  assert(!raw.includes("you@example.com"), "Release operator queue excludes placeholder email values");
  assert(!raw.includes("+1-555-555-5555"), "Release operator queue excludes placeholder phone values");
  assert(!raw.includes("Your Name"), "Release operator queue excludes placeholder names");
  assert(!raw.includes("TODO_PUBLIC_SITE_URL"), "Release operator queue excludes raw public-site placeholder token");
  assert(!/<script\b/i.test(markdown), "Release operator queue markdown contains no script tags");
  assert(markdown.includes("# Cody Cartridge Release Operator Queue"), "Release operator queue markdown includes title");
  assert(markdown.includes("## Immediate Action"), "Release operator queue markdown includes immediate action");
  assert(markdown.includes("**Validate Values**"), "Release operator queue markdown includes value-validation command");
  assert(markdown.includes("**Apply Values And Refresh**"), "Release operator queue markdown includes apply-and-refresh command");
  assert(markdown.includes("## Strict Preflight Trigger"), "Release operator queue markdown includes strict preflight trigger");
  assert(markdown.includes("npm run release:store:preflight"), "Release operator queue markdown includes strict preflight command");
  assert(markdown.includes("npm run release:store:preflight:node"), "Release operator queue markdown includes Node-safe strict preflight command");
  assert(markdown.includes("Publish packet:"), "Release operator queue markdown includes publish-packet status");
  assert(markdown.includes("## Phase Queue"), "Release operator queue markdown includes phase queue");
  assert(markdown.includes("RELEASE_DASHBOARD.html"), "Release operator queue markdown points to dashboard");
  assert(markdown.includes("MAS posture"), "Release operator queue markdown includes MAS posture");
  assert(markdown.includes("MAS submission ready"), "Release operator queue markdown includes MAS submission readiness");

  if ((queue.summary?.releaseBlockers ?? 0) > 0) {
    warn(`Release operator queue records ${queue.summary.releaseBlockers} blocker(s)`);
  } else {
    pass("Release operator queue records no blockers");
  }
}

main();

console.log(`Release operator queue checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
