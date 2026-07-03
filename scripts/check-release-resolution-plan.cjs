#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "RELEASE_RESOLUTION_PLAN.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "RELEASE_RESOLUTION_PLAN.md");
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

function commandExists(commands, expected) {
  return commands.some((command) => command.includes(expected));
}

function phaseById(plan, id) {
  return (plan.phases ?? []).find((phase) => phase.id === id);
}

function includesInOrder(commands, first, second) {
  const firstIndex = commands.findIndex((command) => command.includes(first));
  const secondIndex = commands.findIndex((command) => command.includes(second));
  return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex;
}

function main() {
  assert(exists(jsonPath), "Release resolution plan JSON exists");
  assert(exists(markdownPath), "Release resolution plan markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    console.log(`Release resolution plan checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const pkg = readJson("package.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json");
  const runbook = readJson("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json");
  const plan = readJson("app-store-assets/RELEASE_RESOLUTION_PLAN.json");
  const markdown = readText("app-store-assets/RELEASE_RESOLUTION_PLAN.md");
  const allCommands = (plan.phases ?? []).flatMap((phase) => phase.commands ?? []);
  const uploadCommands = phaseById(plan, "upload-and-select-build")?.commands ?? [];
  const freezeCommands = phaseById(plan, "freeze-evidence-and-handoff")?.commands ?? [];
  const publishSiteCommands = phaseById(plan, "publish-public-site")?.commands ?? [];
  const expectedBlockerCount = blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0;

  assert(plan.app?.bundleId === pkg.build?.appId, "Resolution plan bundle id matches package config");
  assert(plan.app?.version === pkg.version, "Resolution plan package version matches package config");
  assert(plan.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Resolution plan build version matches package config");
  assert(plan.blockerSnapshot?.blockerCount === expectedBlockerCount, "Resolution plan blocker count matches blocker report");
  assert(plan.blockerSnapshot?.readyForStrictPreflight === Boolean(blockers.summary?.readyForStrictPreflight), "Resolution plan strict-readiness flag matches blocker report");
  assert(Array.isArray(plan.phases) && plan.phases.length === 5, "Resolution plan has five ordered phases");

  [
    "prepare-public-inputs",
    "publish-public-site",
    "sign-and-package",
    "upload-and-select-build",
    "freeze-evidence-and-handoff"
  ].forEach((id) => {
    assert(Boolean(phaseById(plan, id)), `Resolution plan includes ${id} phase`);
  });

  [
    "npm run init:store-env",
    "npm run configure:store-env -- --dry-run",
    "npm run configure:store-env -- --site-url",
    "npm run public-release:store -- --self-test",
    "npm run public-release:store:node -- --self-test",
    "npm run public-release:store -- --dry-run",
    "npm run public-inputs:store",
    "npm run publish-packet:store",
    "npm run public-host:store",
    "npm run check:store-env",
    "npm run check:release-runtime -- --strict",
    "npm run check:release-runtime:node -- --strict",
    "npm run public-release:store -- --published",
    "npm run public-release:store:published:node",
    "npm run site:store",
    "npm run check:site -- --strict",
    "npm run archive:site",
    "npm run check:site-archive -- --strict",
    "npm run export-compliance:store",
    "npm run packet:store",
    "npm run app-compliance:store",
    "npm run review-brief:store",
    "npm run copy-map:store",
    "npm run check:review-brief -- --strict",
    "npm run check:copy-map -- --strict",
    "npm run check:public-release-sync -- --strict",
    "npm run check:export-compliance",
    "npm run check:app-compliance",
    "npm run check:store-copy",
    "npm run check:artifact-privacy",
    "npm run check:store-urls -- --strict",
    "npm run check:published-site -- --strict",
    "npm run signing-assets:store",
    "npm run apple-assets:store",
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
    "npm run report:store-blockers",
    "npm run public-inputs:store",
    "npm run resolution-plan:store",
    "npm run signing-runbook:store",
    "npm run machine-report:store",
    "npm run evidence:store",
    "npm run check:evidence",
    "npm run submission-checklist:store",
    "npm run dashboard:store",
    "npm run operator:store",
    "npm run manifest:store",
    "npm run check:manifest",
    "npm run handoff:store",
    "npm run check:release-machine -- --strict",
    "npm run verify:store:strict"
  ].forEach((command) => {
    assert(commandExists(allCommands, command), `Resolution plan includes ${command}`);
  });

  const publicInputCommands = phaseById(plan, "prepare-public-inputs")?.commands ?? [];
  assert(
    publicInputCommands[0]?.includes("npm run configure:store-env -- --dry-run"),
    "Resolution plan starts public-input phase with store env configurator dry-run"
  );
  assert(
    includesInOrder(publicInputCommands, "npm run configure:store-env -- --dry-run", "npm run configure:store-env -- --site-url"),
    "Resolution plan validates public env values before writing private overlay"
  );
  assert(
    includesInOrder(publicInputCommands, "npm run configure:store-env -- --site-url", "npm run public-inputs:store"),
    "Resolution plan writes private overlay before regenerating public-input packet"
  );
  assert(includesInOrder(publicInputCommands, "npm run public-inputs:store", "npm run publish-packet:store"), "Resolution plan builds publish packet after public-input packet");
  assert(includesInOrder(publicInputCommands, "npm run publish-packet:store", "npm run public-host:store"), "Resolution plan builds public host runbook after publish packet");
  assert(includesInOrder(allCommands, "npm run public-host:store", "npm run check:store-env"), "Resolution plan builds public host runbook before env check");
  assert(includesInOrder(allCommands, "npm run check:store-env", "npm run check:release-runtime -- --strict"), "Resolution plan checks release runtime after env");
  assert(
    includesInOrder(allCommands, "npm run check:release-runtime -- --strict", "npm run check:release-runtime:node -- --strict"),
    "Resolution plan includes Node-safe strict release runtime check after raw runtime check"
  );
  assert(
    includesInOrder(allCommands, "npm run check:release-runtime:node -- --strict", "npm run site:store"),
    "Resolution plan checks Node-safe runtime before site generation"
  );
  assert(includesInOrder(allCommands, "npm run check:release-runtime -- --strict", "npm run site:store"), "Resolution plan checks runtime before site generation");
  assert(includesInOrder(allCommands, "npm run site:store", "npm run check:site -- --strict"), "Resolution plan checks generated site after building it");
  assert(includesInOrder(publishSiteCommands, "npm run check:site-archive -- --strict", "npm run publish-packet:store"), "Resolution plan refreshes publish packet after strict site archive validation");
  assert(includesInOrder(publishSiteCommands, "npm run publish-packet:store", "npm run public-host:store"), "Resolution plan refreshes public host runbook after publish packet");
  assert(includesInOrder(allCommands, "npm run public-host:store", "npm run packet:store"), "Resolution plan refreshes packet after public host runbook");
  assert(includesInOrder(allCommands, "npm run export-compliance:store", "npm run packet:store"), "Resolution plan builds export compliance before packet generation");
  assert(includesInOrder(allCommands, "npm run packet:store", "npm run app-compliance:store"), "Resolution plan builds App Store compliance packet after packet generation");
  assert(includesInOrder(allCommands, "npm run app-compliance:store", "npm run review-brief:store"), "Resolution plan builds App Review brief after App Store compliance packet");
  assert(includesInOrder(allCommands, "npm run review-brief:store", "npm run copy-map:store"), "Resolution plan builds copy map after App Review brief");
  assert(includesInOrder(allCommands, "npm run packet:store", "npm run check:export-compliance"), "Resolution plan checks export compliance after packet generation");
  assert(includesInOrder(allCommands, "npm run check:export-compliance", "npm run check:app-compliance"), "Resolution plan checks App Store compliance after export compliance");
  assert(includesInOrder(allCommands, "npm run check:app-compliance", "npm run check:store-copy"), "Resolution plan checks store copy after App Store compliance");
  assert(
    includesInOrder(allCommands, "npm run check:copy-map -- --strict", "npm run check:public-release-sync -- --strict"),
    "Resolution plan checks public release sync after strict copy map check"
  );
  assert(
    includesInOrder(allCommands, "npm run check:public-release-sync -- --strict", "npm run check:store-urls -- --strict"),
    "Resolution plan checks public release sync before public URL reachability"
  );
  assert(includesInOrder(allCommands, "npm run check:store-urls -- --strict", "npm run check:mas-signing -- --strict"), "Resolution plan checks public URLs before signing/package phase");
  assert(includesInOrder(allCommands, "npm run check:store-urls -- --strict", "npm run check:published-site -- --strict"), "Resolution plan checks full published site after App Store URL reachability");
  assert(includesInOrder(allCommands, "npm run check:published-site -- --strict", "npm run check:mas-signing -- --strict"), "Resolution plan checks published site before signing/package phase");
  assert(includesInOrder(allCommands, "npm run check:published-site -- --strict", "npm run signing-assets:store"), "Resolution plan builds signing asset report after full published-site check");
  assert(
    includesInOrder(allCommands, "npm run signing-assets:store", "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run"),
    "Resolution plan validates downloaded MAS profile after signing asset report"
  );
  assert(includesInOrder(allCommands, "npm run signing-assets:store", "npm run apple-assets:store"), "Resolution plan generates Apple release asset packet after signing asset report");
  assert(
    includesInOrder(allCommands, "npm run apple-assets:store", "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run"),
    "Resolution plan validates downloaded MAS profile after Apple release asset packet"
  );
  assert(
    includesInOrder(
      allCommands,
      "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run",
      "npm run check:mas-signing -- --strict"
    ),
    "Resolution plan validates downloaded MAS profile before strict signing"
  );
  assert(includesInOrder(allCommands, "npm run check:mas-signing -- --strict", "npm run dist:mas"), "Resolution plan checks signing before packaging");
  assert(includesInOrder(allCommands, "npm run dist:mas", "npm run check:mas-package -- --strict"), "Resolution plan checks MAS package after packaging");
  assert(includesInOrder(allCommands, "npm run check:mas-package -- --strict", "npm run check:upload-tooling -- --strict"), "Resolution plan checks upload tooling after package boundary");
  assert(
    includesInOrder(allCommands, "npm run check:upload-tooling -- --strict", "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run"),
    "Resolution plan validates App Store Connect API key after upload-tooling check"
  );
  assert(
    includesInOrder(allCommands, "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run", "npm run check:upload-credentials -- --strict"),
    "Resolution plan checks upload credentials after API key install dry-run"
  );
  assert(
    includesInOrder(allCommands, "npm run check:upload-credentials -- --strict", "npm run upload-packet:store"),
    "Resolution plan builds upload command packet after upload-credential check"
  );
  assert(includesInOrder(uploadCommands, "npm run upload-packet:store", "npm run apple-assets:store"), "Resolution plan refreshes Apple release asset packet after upload command packet");
  assert(
    includesInOrder(uploadCommands, "npm run apple-assets:store", "npm run upload-evidence:store"),
    "Resolution plan captures upload evidence after Apple release asset packet"
  );
  assert(
    includesInOrder(allCommands, "npm run upload-evidence:store", "npm run report:store-blockers"),
    "Resolution plan refreshes blocker report after upload evidence"
  );
  assert(includesInOrder(freezeCommands, "npm run report:store-blockers", "npm run public-inputs:store"), "Resolution plan regenerates public-input packet after blocker report");
  assert(includesInOrder(freezeCommands, "npm run public-inputs:store", "npm run publish-packet:store"), "Resolution plan regenerates publish packet after public-input packet");
  assert(includesInOrder(freezeCommands, "npm run publish-packet:store", "npm run public-host:store"), "Resolution plan regenerates public host runbook after publish packet");
  assert(includesInOrder(freezeCommands, "npm run public-host:store", "npm run signing-assets:store"), "Resolution plan regenerates signing asset report after public host runbook");
  assert(includesInOrder(freezeCommands, "npm run signing-assets:store", "npm run upload-packet:store"), "Resolution plan regenerates upload command packet after signing asset report");
  assert(includesInOrder(freezeCommands, "npm run upload-packet:store", "npm run copy-map:store"), "Resolution plan regenerates copy map after upload command packet");
  assert(includesInOrder(freezeCommands, "npm run copy-map:store", "npm run apple-assets:store"), "Resolution plan regenerates Apple release asset packet after final copy map refresh");
  assert(includesInOrder(freezeCommands, "npm run apple-assets:store", "npm run signing-runbook:store"), "Resolution plan regenerates signing/upload runbook after Apple release asset packet");
  assert(includesInOrder(allCommands, "npm run signing-runbook:store", "npm run resolution-plan:store"), "Resolution plan regenerates itself after signing/upload runbook");
  assert(includesInOrder(allCommands, "npm run resolution-plan:store", "npm run submission-checklist:store"), "Resolution plan builds final submission checklist after itself");
  assert(includesInOrder(allCommands, "npm run submission-checklist:store", "npm run machine-report:store"), "Resolution plan builds release machine report after final submission checklist");
  assert(includesInOrder(allCommands, "npm run machine-report:store", "npm run evidence:store"), "Resolution plan builds evidence after release machine report");
  assert(includesInOrder(allCommands, "npm run submission-checklist:store", "npm run evidence:store"), "Resolution plan builds evidence after final submission checklist");
  assert(includesInOrder(allCommands, "npm run evidence:store", "npm run check:evidence"), "Resolution plan checks release evidence after building it");
  assert(includesInOrder(allCommands, "npm run check:evidence", "npm run dashboard:store"), "Resolution plan builds dashboard after evidence check");
  assert(includesInOrder(allCommands, "npm run dashboard:store", "npm run operator:store"), "Resolution plan builds operator queue after dashboard");
  assert(includesInOrder(allCommands, "npm run operator:store", "npm run manifest:store"), "Resolution plan builds manifest after operator queue");
  assert(includesInOrder(allCommands, "npm run manifest:store", "npm run check:manifest"), "Resolution plan checks release manifest after building it");
  assert(includesInOrder(allCommands, "npm run check:manifest", "npm run handoff:store"), "Resolution plan builds handoff after manifest check");
  assert(includesInOrder(allCommands, "npm run handoff:store", "npm run verify:store:strict"), "Resolution plan verifies after handoff generation");
  assert(includesInOrder(allCommands, "npm run handoff:store", "npm run check:release-machine -- --strict"), "Resolution plan runs release-machine doctor after handoff generation");
  assert(includesInOrder(allCommands, "npm run check:release-machine -- --strict", "npm run verify:store:strict"), "Resolution plan runs release-machine doctor before strict verification");

  assert(
    JSON.stringify(plan.releaseMachineCommands ?? []) === JSON.stringify((runbook.releaseMachineCommands ?? []).map((item) => item.command)),
    "Resolution plan mirrors signing/upload runbook release-machine commands"
  );
  assert(
    Array.isArray(plan.nodeWrappedShortcuts) &&
      plan.nodeWrappedShortcuts.some((item) => item.command === "npm run release:store:local:node") &&
      plan.nodeWrappedShortcuts.some((item) => item.command === "npm run public-release:store:node") &&
      plan.nodeWrappedShortcuts.some((item) => item.command === "npm run public-release:store:published:node") &&
      plan.nodeWrappedShortcuts.some((item) => item.command === "npm run release:store:preflight:node") &&
      plan.nodeWrappedShortcuts.some((item) => item.command === "npm run check:release-machine:node -- --strict") &&
      plan.nodeWrappedShortcuts.some((item) => item.command === "npm run verify:store:strict:node"),
    "Resolution plan records Node-safe release shortcuts"
  );
  assert(
    JSON.stringify(plan.nodeWrappedShortcuts ?? []) === JSON.stringify(runbook.nodeWrappedShortcuts ?? []),
    "Resolution plan mirrors signing/upload runbook Node-safe shortcuts"
  );
  assert(
    ["public-inputs", "generated-site", "signing-package", "submission"].every((id) =>
      Object.prototype.hasOwnProperty.call(plan.blockerSnapshot?.blockedChecks ?? {}, id)
    ),
    "Resolution plan records every blocker category"
  );
  assert(
      (plan.finalProof ?? []).some((item) => item.includes("verify:store:strict")) &&
      (plan.finalProof ?? []).some((item) => item.includes("check:release-machine")) &&
      (plan.finalProof ?? []).some((item) => item.includes("check:public-release-sync")) &&
      (plan.finalProof ?? []).some((item) => item.includes("check:upload-evidence")) &&
      (plan.finalProof ?? []).some((item) => item.includes("RELEASE_BLOCKERS.json")),
    "Resolution plan final proof includes release-machine doctor, public release sync, upload evidence, strict verifier, and blocker report"
  );
  assert(markdown.includes("# Cody Cartridge Release Resolution Plan"), "Resolution plan markdown includes title");
  assert(markdown.includes("## Phases"), "Resolution plan markdown includes phases section");
  assert(markdown.includes("## Current Blockers By Category"), "Resolution plan markdown includes blocker section");
  assert(markdown.includes("## Node-Safe Shortcuts"), "Resolution plan markdown includes Node-safe shortcuts section");
  assert(markdown.includes("npm run public-release:store:published:node"), "Resolution plan markdown includes Node-safe published public-release shortcut");
  assert(markdown.includes("npm run release:store:preflight:node"), "Resolution plan markdown includes Node-safe strict preflight shortcut");
  assert(markdown.includes("npm run verify:store:strict:node"), "Resolution plan markdown includes Node-safe strict verifier shortcut");
  assert(markdown.includes("## Final Proof"), "Resolution plan markdown includes final proof section");

  if (expectedBlockerCount > 0) {
    warn(`Resolution plan records ${expectedBlockerCount} remaining blocker(s)`);
  }

  console.log(`Release resolution plan checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
