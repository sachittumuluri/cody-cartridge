#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "RELEASE_OPERATOR_QUEUE.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "RELEASE_OPERATOR_QUEUE.md");

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function blockedChecksForCategory(blockers, categoryId) {
  return (blockers.categories ?? [])
    .find((category) => category.id === categoryId)
    ?.checks?.filter((check) => check.status === "blocked") ?? [];
}

function blockerCountForPhase(blockers, phase) {
  return (phase.blockerCategoryIds ?? []).reduce(
    (count, categoryId) => count + blockedChecksForCategory(blockers, categoryId).length,
    0
  );
}

function phaseCommand(phase) {
  const commands = phase.commands ?? [];
  return commands.length > 0 ? commands[0] : "npm run verify:store:strict";
}

function redactText(value) {
  return String(value ?? "")
    .replaceAll("TODO_PUBLIC_SITE_URL", "public-site placeholder token")
    .replaceAll("TODO_SUPPORT_EMAIL", "support-email placeholder token")
    .replaceAll("https://example.com", "placeholder public URL")
    .replaceAll("you@example.com", "placeholder email")
    .replaceAll("+1-555-555-5555", "placeholder phone");
}

function queueRows(phases, blockers) {
  return phases.map((phase, index) => {
    const blockerCount = blockerCountForPhase(blockers, phase);
    return {
      index: index + 1,
      id: phase.id,
      title: phase.title,
      status: blockerCount > 0 ? "blocked" : "ready",
      blockerCount,
      command: phaseCommand(phase),
      commands: phase.commands ?? [],
      exitCriteria: (phase.exitCriteria ?? []).map(redactText),
      evidenceToKeep: (phase.evidence ?? []).map(redactText)
    };
  });
}

function firstBlocked(queue) {
  return queue.find((phase) => phase.status === "blocked") ?? queue[queue.length - 1] ?? null;
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function table(rows) {
  return [
    "| # | Phase | Status | Blockers | First command |",
    "| ---: | --- | --- | ---: | --- |",
    ...rows.map((row) => `| ${row.index} | ${escapeCell(row.title)} | ${row.status} | ${row.blockerCount} | \`${escapeCell(row.command)}\` |`)
  ].join("\n");
}

function codeBlock(commands) {
  return ["```bash", commands.join("\n"), "```"].join("\n");
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function publicInputConfigureCommand(dryRun) {
  return `npm run configure:store-env --${dryRun ? " --dry-run" : ""} --site-url https://your-public-site.example --support-email "<support-email>" --review-name "<review-contact-name>" --review-email "<review-contact-email>" --review-phone "<review-contact-phone>"`;
}

function immediateCommandsFor(nextAction) {
  if (nextAction.phaseId === "prepare-public-inputs") {
    return {
      validateCommand: `${publicInputConfigureCommand(true)} && npm run public-release:store:node -- --self-test`,
      applyCommand: `${publicInputConfigureCommand(true)} && ${publicInputConfigureCommand(false)} && npm run public-release:store:node -- --self-test && npm run public-inputs:store && npm run check:store-env && npm run check:release-runtime:node -- --strict`,
      verificationCommand: "npm run public-inputs:store && npm run check:store-env && npm run check:release-runtime:node -- --strict"
    };
  }

  return {
    validateCommand: nextAction.command,
    applyCommand: nextAction.command,
    verificationCommand: nextAction.command
  };
}

function main() {
  const pkg = readJson("package.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json", { summary: {}, categories: [] });
  const publicInputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json", { summary: {} });
  const publishPacket = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json", { summary: {} });
  const finalChecklist = readJson("app-store-assets/FINAL_SUBMISSION_CHECKLIST.json", { summary: {} });
  const resolutionPlan = readJson("app-store-assets/RELEASE_RESOLUTION_PLAN.json", { phases: [], releaseMachineCommands: [] });
  const runbook = readJson("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json", { releaseMachineCommands: [] });
  const dashboard = readJson("app-store-assets/RELEASE_DASHBOARD.json", { nextAction: {} });
  const masSubmission = dashboard.masSubmission ?? {
    mode: "missing",
    submissionReady: false,
    localRehearsalOnly: false,
    bundlePath: "dist/mas-arm64/Cody Cartridge.app",
    hasEmbeddedProvisioningProfile: false,
    codeSignatureVerified: false,
    uploadPackageCount: 0,
    signedUploadPackageCount: 0,
    currentVersionUploadPackageCount: 0,
    signedCurrentVersionUploadPackageCount: 0,
    hasSignedUploadPackage: false,
    hasCurrentVersionUploadPackage: false,
    hasSignedCurrentVersionUploadPackage: false
  };
  const queue = queueRows(resolutionPlan.phases ?? [], blockers);
  const currentPhase = firstBlocked(queue);
  const blockerQueueAction = blockers.nextActionQueue?.[0] ?? null;
  const nextAction = {
    phaseId: currentPhase?.id ?? "strict-preflight",
    label: currentPhase?.title ?? "Run strict preflight",
    command: dashboard.nextAction?.command || currentPhase?.command || "npm run verify:store:strict",
    source: dashboard.nextAction?.source ?? "release dashboard",
    stopWhen: currentPhase?.exitCriteria ?? ["npm run verify:store:strict exits with 0."]
  };
  Object.assign(nextAction, immediateCommandsFor(nextAction));
  const strictPreflight = {
    ready: Boolean(blockers.summary?.readyForStrictPreflight),
    command: "npm run release:store:preflight",
    nodeCommand: "npm run release:store:preflight:node",
    blockerCount: blockers.summary?.blockerCount ?? 0,
    blockedCategories: (blockers.nextActionQueue ?? []).map((action) => ({
      order: action.order,
      categoryId: action.categoryId,
      categoryLabel: redactText(action.categoryLabel),
      blockerCount: action.blockerCount,
      firstBlockedCheckId: action.firstBlockedCheckId,
      firstBlockedCheckLabel: redactText(action.firstBlockedCheckLabel)
    })),
    runWhen: [
      "Release blocker report records zero blockers.",
      "Public site URL, support contact, and App Review contact inputs are real and synced.",
      "Generated public site, site archive, copy map, review brief, and submission packet pass strict checks.",
      "MAS signing assets, signed MAS package, upload tooling, and upload credentials pass strict checks.",
      "Dashboard, operator queue, manifest, evidence, and handoff artifacts have been regenerated."
    ]
  };
  const operatorQueue = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName ?? pkg.name,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion: pkg.build?.buildVersion ?? pkg.version
    },
    summary: {
      status: (blockers.summary?.blockerCount ?? 0) > 0 ? "blocked" : "ready",
      releaseBlockers: blockers.summary?.blockerCount ?? 0,
      readyForStrictPreflight: Boolean(blockers.summary?.readyForStrictPreflight),
      publicInputsReady: publicInputs.summary?.readyCount ?? 0,
      publicInputsRequired: publicInputs.summary?.requiredCount ?? 0,
      publicInputsBlocked: publicInputs.summary?.blockerCount ?? 0,
      publishPacketStatus: publishPacket.summary?.publishStatus ?? "missing",
      publishPacketReadyPages: publishPacket.summary?.readyPageCount ?? 0,
      publishPacketRequiredPages: publishPacket.summary?.requiredPageCount ?? 0,
      finalChecklistBlockers: finalChecklist.summary?.blockerCount ?? 0,
      masSubmissionReady: masSubmission.submissionReady === true
    },
    masSubmission,
    blockerQueueAction,
    nextAction,
    strictPreflight,
    queue,
    releaseMachineCommands: (runbook.releaseMachineCommands ?? []).map((item) => item.command),
    sourceArtifacts: [
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
    ],
    redaction: {
      storesRawContactValues: false,
      storesSigningSecrets: false,
      privateEnvFileIncluded: false
    }
  };

  const markdown = `# Cody Cartridge Release Operator Queue

Generated by \`npm run operator:store\`.

This is the short release-machine queue. It points to the current phase, the next command, and the exit criteria without storing public contact values, signing secrets, or App Store credentials.

## Status Snapshot

- App: ${operatorQueue.app.name}
- Bundle ID: \`${operatorQueue.app.bundleId}\`
- Version: ${operatorQueue.app.version}
- Build version: ${operatorQueue.app.buildVersion}
- Release blockers: ${operatorQueue.summary.releaseBlockers}
- Public inputs ready: ${operatorQueue.summary.publicInputsReady}/${operatorQueue.summary.publicInputsRequired}
- Publish packet: ${operatorQueue.summary.publishPacketStatus} (${operatorQueue.summary.publishPacketReadyPages}/${operatorQueue.summary.publishPacketRequiredPages} pages)
- Final checklist blockers: ${operatorQueue.summary.finalChecklistBlockers}
- Ready for strict preflight: ${operatorQueue.summary.readyForStrictPreflight ? "yes" : "no"}
- MAS posture: ${operatorQueue.masSubmission.mode}
- MAS submission ready: ${operatorQueue.summary.masSubmissionReady ? "yes" : "no"}
- Signed upload packages: ${operatorQueue.masSubmission.signedUploadPackageCount}/${operatorQueue.masSubmission.uploadPackageCount}
- Signed current-version upload packages: ${operatorQueue.masSubmission.signedCurrentVersionUploadPackageCount ?? 0}/${operatorQueue.masSubmission.uploadPackageCount}
- MAS local rehearsal only: ${operatorQueue.masSubmission.localRehearsalOnly ? "yes" : "no"}

## Immediate Action

- Current phase: ${nextAction.label}
- Source dashboard: \`RELEASE_DASHBOARD.html\`

${codeBlock([nextAction.command])}

**Validate Values**

${codeBlock([nextAction.validateCommand])}

**Apply Values And Refresh**

${codeBlock([nextAction.applyCommand])}

**Stop When**

${list(nextAction.stopWhen)}

## Strict Preflight Trigger

- Ready now: ${strictPreflight.ready ? "yes" : "no"}
- Current release blockers: ${strictPreflight.blockerCount}
- Command:

${codeBlock([strictPreflight.command])}

- Node-safe command:

${codeBlock([strictPreflight.nodeCommand])}

**Run When**

${list(strictPreflight.runWhen)}

**Still Blocking**

${list(
  strictPreflight.blockedCategories.map(
    (category) =>
      `${category.order}. ${category.categoryLabel}: ${category.blockerCount} blocker(s), first failing check \`${category.firstBlockedCheckId}\` (${category.firstBlockedCheckLabel})`
  )
)}

## Phase Queue

${table(queue)}

## Release-Machine Order

${codeBlock(operatorQueue.releaseMachineCommands)}

## Source Artifacts

${list(operatorQueue.sourceArtifacts.map((artifact) => `\`${artifact}\``))}

## Redaction

- Raw public/support/App Review contact values are not written here.
- Apple signing secrets, certificates, profiles, credentials, and private env files are not written here.
- Use ignored \`app-store-assets/site.env\` or shell environment variables on the release machine.
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(operatorQueue, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (operatorQueue.summary.releaseBlockers > 0) {
    console.warn(`Release operator queue records ${operatorQueue.summary.releaseBlockers} blocker(s).`);
  }
}

main();
