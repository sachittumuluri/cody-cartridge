#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const {
  isReleaseStoreEnvValue,
  loadStoreEnv,
  releaseEnvKeys
} = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
loadStoreEnv(projectRoot);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const published = args.has("--published");
const selfTest = args.has("--self-test");
const allowedArgs = new Set(["--dry-run", "--published", "--self-test", "--help", "-h"]);
const unknownArgs = [...args].filter((arg) => !allowedArgs.has(arg));

function usage() {
  return `Usage:
  npm run public-release:store -- --dry-run
  npm run public-release:store -- --self-test
  npm run public-release:store
  npm run public-release:store -- --published

Modes:
  --dry-run    Print the command plan and current release-env readiness without running commands.
  --self-test  Validate redaction and command-order invariants without using real release values.
  --published  Also verify published Support/Privacy URLs and every publish-packet page with strict live checks.`;
}

function step(id, command, purpose) {
  return { id, command, purpose };
}

function commandPlan(options = {}) {
  const includePublished = options.includePublished ?? published;
  const commands = [
    step("env", ["npm", "run", "check:store-env"], "Validate public URL/contact/App Review release values."),
    step("runtime", ["npm", "run", "check:release-runtime", "--", "--strict"], "Validate the release runtime before regenerating artifacts."),
    step("site", ["npm", "run", "site:store"], "Generate static support/privacy/accessibility/notices pages."),
    step("site-strict", ["npm", "run", "check:site", "--", "--strict"], "Strictly validate generated public site pages."),
    step("archive-site", ["npm", "run", "archive:site"], "Build the deterministic public-site archive."),
    step("archive-strict", ["npm", "run", "check:site-archive", "--", "--strict"], "Strictly validate the public-site archive."),
    step("export-compliance", ["npm", "run", "export-compliance:store"], "Refresh export-compliance prep before field generation."),
    step("packet", ["npm", "run", "packet:store"], "Regenerate App Store Connect fields and submission packet."),
    step("app-compliance", ["npm", "run", "app-compliance:store"], "Regenerate checked App Store compliance packet."),
    step("copy-map", ["npm", "run", "copy-map:store"], "Regenerate and check App Store Connect copy map."),
    step("review-brief", ["npm", "run", "review-brief:store"], "Regenerate and check standalone App Review brief."),
    step("copy-map-strict", ["npm", "run", "check:copy-map", "--", "--strict"], "Strictly validate copy-map readiness."),
    step("review-brief-strict", ["npm", "run", "check:review-brief", "--", "--strict"], "Strictly validate App Review brief readiness."),
    step("public-sync", ["npm", "run", "check:public-release-sync", "--", "--strict"], "Confirm site/archive/fields match current CODY_* values."),
    step("version", ["npm", "run", "check:store-version"], "Confirm generated App Store fields match package/build versions."),
    step("privacy", ["npm", "run", "check:app-privacy"], "Validate App privacy answers and local-only privacy posture."),
    step("export-check", ["npm", "run", "check:export-compliance"], "Validate generated export-compliance answers."),
    step("app-compliance-check", ["npm", "run", "check:app-compliance"], "Validate App Store compliance packet."),
    step("copy-check", ["npm", "run", "check:store-copy"], "Validate App Store copy limits and claims."),
    step("artifact-privacy", ["npm", "run", "check:artifact-privacy"], "Scan release artifacts for private local data leakage.")
  ];

  if (includePublished) {
    commands.push(
      step("publish-packet-live", ["npm", "run", "publish-packet:store"], "Refresh the public-site publish packet before live URL verification."),
      step("published-urls", ["npm", "run", "check:store-urls", "--", "--strict"], "Verify published App Store Support/Privacy URLs are reachable and contain expected content."),
      step("published-site", ["npm", "run", "check:published-site", "--", "--strict"], "Verify every public-site publish-packet page is live and matches the generated source.")
    );
  }

  return commands.concat([
    step("blockers", ["npm", "run", "report:store-blockers"], "Refresh release blocker report after public artifact changes."),
    step("public-inputs", ["npm", "run", "public-inputs:store"], "Refresh redacted public-input packet."),
    step("publish-packet", ["npm", "run", "publish-packet:store"], "Refresh the public-site publish packet for Support/Privacy URL handoff."),
    step("public-host", ["npm", "run", "public-host:store"], "Refresh the public host runbook for static-site deployment."),
    step("checklist", ["npm", "run", "submission-checklist:store"], "Refresh final submission checklist."),
    step("machine-report", ["npm", "run", "machine-report:store"], "Refresh release-machine gate report."),
    step("evidence", ["npm", "run", "evidence:store"], "Refresh checked release evidence and artifact hashes."),
    step("dashboard", ["npm", "run", "dashboard:store"], "Refresh release dashboard."),
    step("operator", ["npm", "run", "operator:store"], "Refresh release operator queue."),
    step("manifest", ["npm", "run", "manifest:store"], "Refresh release manifest and hashes."),
    step("handoff", ["npm", "run", "handoff:store"], "Refresh deterministic App Store handoff archive."),
    step("verify", ["npm", "run", "verify:store"], "Run advisory store verifier after public artifact refresh.")
  ]);
}

function commandText(command) {
  return command.join(" ");
}

function redactionValues(values = process.env) {
  return releaseEnvKeys
    .map((key) => String(values[key] ?? "").trim())
    .filter((value) => value.length >= 4);
}

function sanitize(output, values = process.env) {
  let sanitized = String(output ?? "");

  for (const value of redactionValues(values)) {
    sanitized = sanitized.split(value).join("<redacted-release-value>");
  }

  return sanitized;
}

function assertSelfTest(condition, message) {
  if (!condition) {
    throw new Error(`self-test failed: ${message}`);
  }
}

function stepIndex(commands, id) {
  return commands.findIndex((item) => item.id === id);
}

function assertStepBefore(commands, firstId, secondId) {
  const firstIndex = stepIndex(commands, firstId);
  const secondIndex = stepIndex(commands, secondId);
  assertSelfTest(firstIndex !== -1, `missing ${firstId} step`);
  assertSelfTest(secondIndex !== -1, `missing ${secondId} step`);
  assertSelfTest(firstIndex < secondIndex, `${firstId} must run before ${secondId}`);
}

function assertUniqueStepIds(commands) {
  const ids = commands.map((item) => item.id);
  assertSelfTest(new Set(ids).size === ids.length, "command plan step ids must be unique");
}

function selfTestPublicReleaseRefresh() {
  const syntheticEnv = {
    CODY_SITE_URL: "https://release.example",
    CODY_SUPPORT_EMAIL: "support+store@release.example",
    CODY_REVIEW_CONTACT_NAME: "Release Contact #1",
    CODY_REVIEW_CONTACT_EMAIL: "review+store@release.example",
    CODY_REVIEW_CONTACT_PHONE: "+1 (555) 555-5555"
  };
  const syntheticValues = redactionValues(syntheticEnv);
  const noisyOutput = [
    "stdout:",
    ...releaseEnvKeys.map((key) => `${key}=${syntheticEnv[key]}`),
    "stderr:",
    ...releaseEnvKeys.map((key) => `raw ${key}: ${syntheticEnv[key]}`)
  ].join("\n");
  const sanitized = sanitize(noisyOutput, syntheticEnv);

  assertSelfTest(syntheticValues.length === releaseEnvKeys.length, "synthetic release values cover every release env key");
  for (const value of syntheticValues) {
    assertSelfTest(!sanitized.includes(value), "sanitize must redact release values");
  }
  assertSelfTest(sanitized.includes("<redacted-release-value>"), "sanitize must leave a redaction marker");

  const defaultPlan = commandPlan({ includePublished: false });
  assertUniqueStepIds(defaultPlan);
  assertStepBefore(defaultPlan, "env", "site");
  assertStepBefore(defaultPlan, "runtime", "site");
  assertStepBefore(defaultPlan, "site", "archive-site");
  assertStepBefore(defaultPlan, "archive-site", "packet");
  assertStepBefore(defaultPlan, "packet", "copy-map");
  assertStepBefore(defaultPlan, "packet", "review-brief");
  assertStepBefore(defaultPlan, "copy-map", "public-sync");
  assertStepBefore(defaultPlan, "review-brief", "public-sync");
  assertStepBefore(defaultPlan, "public-sync", "blockers");
  assertStepBefore(defaultPlan, "blockers", "public-inputs");
  assertStepBefore(defaultPlan, "publish-packet", "public-host");
  assertStepBefore(defaultPlan, "public-host", "checklist");
  assertStepBefore(defaultPlan, "evidence", "manifest");
  assertStepBefore(defaultPlan, "manifest", "handoff");
  assertStepBefore(defaultPlan, "handoff", "verify");
  assertSelfTest(stepIndex(defaultPlan, "published-urls") === -1, "default plan must skip published URL checks");
  assertSelfTest(stepIndex(defaultPlan, "published-site") === -1, "default plan must skip published site checks");

  const publishedPlan = commandPlan({ includePublished: true });
  assertUniqueStepIds(publishedPlan);
  assertStepBefore(publishedPlan, "public-sync", "publish-packet-live");
  assertStepBefore(publishedPlan, "publish-packet-live", "published-urls");
  assertStepBefore(publishedPlan, "published-urls", "published-site");
  assertStepBefore(publishedPlan, "published-site", "blockers");

  console.log("Public release refresh self-test: redaction and command order passed.");
}

function printPlan(commands) {
  console.log(`Public release refresh plan (${published ? "published URL check included" : "published URL check skipped"}):`);
  commands.forEach((item, index) => {
    console.log(`${String(index + 1).padStart(2, "0")}. ${commandText(item.command)} - ${item.purpose}`);
  });
}

function printEnvReadiness() {
  console.log("Release env readiness:");
  releaseEnvKeys.forEach((key) => {
    console.log(`- ${key}: ${isReleaseStoreEnvValue(key, process.env[key]) ? "ready" : "blocked"}`);
  });
}

function runStep(item) {
  console.log(`\n## ${commandText(item.command)}`);
  const [command, ...commandArgs] = item.command;
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdout = sanitize(result.stdout);
  const stderr = sanitize(result.stderr);

  if (stdout.trim()) {
    process.stdout.write(stdout);
    if (!stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }

  if (stderr.trim()) {
    process.stderr.write(stderr);
    if (!stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }

  if (result.error) {
    console.error(`FAIL ${item.id}: ${result.error.message}`);
    return false;
  }

  if (result.status !== 0) {
    console.error(`FAIL ${item.id}: exited ${result.status}`);
    return false;
  }

  return true;
}

function main() {
  if (args.has("--help") || args.has("-h")) {
    console.log(usage());
    return;
  }

  if (unknownArgs.length > 0) {
    console.error(`FAIL Unknown option(s): ${unknownArgs.join(", ")}`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (selfTest) {
    try {
      selfTestPublicReleaseRefresh();
    } catch (error) {
      console.error(`FAIL ${error.message}`);
      process.exitCode = 1;
    }
    return;
  }

  const commands = commandPlan();

  if (dryRun) {
    printPlan(commands);
    printEnvReadiness();
    return;
  }

  for (const item of commands) {
    if (!runStep(item)) {
      console.error("Public release refresh stopped before completing all steps.");
      process.exitCode = 1;
      return;
    }
  }

  console.log("\nPublic release refresh completed.");
}

main();
