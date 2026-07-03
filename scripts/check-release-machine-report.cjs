#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "RELEASE_MACHINE_REPORT.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "RELEASE_MACHINE_REPORT.md");
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

function gateFor(report, id) {
  return (report.gates ?? []).find((gate) => gate.id === id);
}

function main() {
  assert(exists(jsonPath), "Release machine report JSON exists");
  assert(exists(markdownPath), "Release machine report markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    return;
  }

  const report = readJson("app-store-assets/RELEASE_MACHINE_REPORT.json");
  const markdown = readText("app-store-assets/RELEASE_MACHINE_REPORT.md");
  const pkg = readJson("package.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json");
  const raw = `${JSON.stringify(report)}\n${markdown}`;
  const expectedGateIds = [
    "public-release-self-test",
    "env",
    "public-release-sync",
    "runtime",
    "source-version",
    "packaging-toolchain",
    "public-urls",
    "published-site",
    "mas-signing",
    "mas-package",
    "upload-tooling",
    "upload-credentials",
    "release-blockers"
  ];

  assert(report.app?.bundleId === pkg.build?.appId, "Release machine report bundle id matches package config");
  assert(report.app?.version === pkg.version, "Release machine report version matches package config");
  assert(
    report.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version),
    "Release machine report build version matches package config"
  );
  assert(report.summary?.releaseBlockers === blockers.summary?.blockerCount, "Release machine report blocker count matches blocker report");
  assert(
    report.summary?.readyForStrictPreflight === Boolean(blockers.summary?.readyForStrictPreflight),
    "Release machine report strict-readiness flag matches blocker report"
  );
  assert(Array.isArray(report.environment?.loadedReleaseEnvFiles), "Release machine report records loaded env files as a list");
  assert(Array.isArray(report.gates) && report.gates.length === expectedGateIds.length, "Release machine report records every expected gate");

  expectedGateIds.forEach((id) => {
    const gate = gateFor(report, id);
    assert(Boolean(gate), `Release machine report includes ${id} gate`);

    if (gate) {
      assert(["pass", "warning", "blocked"].includes(gate.status), `Release machine report ${id} gate status is valid`);
      assert(typeof gate.command === "string" && gate.command.length > 0, `Release machine report ${id} gate records command`);
      assert(typeof gate.strictCommand === "string" && gate.strictCommand.length > 0, `Release machine report ${id} gate records strict command`);
      assert(typeof gate.exitCode === "number", `Release machine report ${id} gate exit code is numeric`);
      assert(typeof gate.failureCount === "number", `Release machine report ${id} gate failure count is numeric`);
      assert(typeof gate.warningCount === "number", `Release machine report ${id} gate warning count is numeric`);
      assert(Array.isArray(gate.failures), `Release machine report ${id} failures are listed`);
      assert(Array.isArray(gate.warnings), `Release machine report ${id} warnings are listed`);
    }
  });

  assert(
    report.summary?.gateCount === expectedGateIds.length &&
      report.summary?.blockedGateCount === (report.gates ?? []).filter((gate) => gate.status === "blocked").length &&
      report.summary?.warningGateCount === (report.gates ?? []).filter((gate) => gate.status === "warning").length,
    "Release machine report summary counts match gates"
  );
  assert(report.strictEquivalentCommand === "npm run check:release-machine -- --strict", "Release machine report records strict equivalent command");
  assert(Boolean(report.nextAction?.command), "Release machine report records next action command");
  assert((report.sourceArtifacts ?? []).includes("app-store-assets/RELEASE_BLOCKERS.json"), "Release machine report records blocker source artifact");
  assert((report.sourceArtifacts ?? []).includes("app-store-assets/RELEASE_RESOLUTION_PLAN.json"), "Release machine report records resolution-plan source artifact");
  assert((report.sourceArtifacts ?? []).includes("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json"), "Release machine report records publish-packet source artifact");
  assert((report.sourceArtifacts ?? []).includes("app-store-assets/PUBLIC_HOST_RUNBOOK.json"), "Release machine report records public host runbook source artifact");
  assert((report.sourceArtifacts ?? []).includes("app-store-assets/UPLOAD_COMMAND_PACKET.json"), "Release machine report records upload-packet source artifact");
  assert((report.sourceArtifacts ?? []).includes("app-store-assets/APPLE_RELEASE_ASSETS.json"), "Release machine report records Apple release asset request source artifact");
  assert((report.sourceArtifacts ?? []).includes("scripts/refresh-public-release.cjs"), "Release machine report records public release refresh helper source");
  assert((report.sourceArtifacts ?? []).includes("scripts/install-asc-key.cjs"), "Release machine report records App Store Connect key install helper source");
  assert((report.sourceArtifacts ?? []).includes("scripts/check-upload-credentials.cjs"), "Release machine report records upload credential checker source");
  assert(report.redaction?.storesRawContactValues === false, "Release machine report records raw-contact redaction posture");
  assert(report.redaction?.storesSigningSecrets === false, "Release machine report records signing-secret redaction posture");
  assert(report.redaction?.privateEnvFileIncluded === false, "Release machine report excludes private env file");
  assert(!raw.includes(projectRoot), "Release machine report redacts project root path");
  assert(!raw.includes(os.homedir()), "Release machine report redacts home directory path");
  assert(!raw.includes("TODO_PUBLIC_SITE_URL"), "Release machine report redacts public-site placeholder token");
  assert(!raw.includes("TODO_SUPPORT_EMAIL"), "Release machine report redacts support-email placeholder token");
  assert(!raw.includes("TODO_REVIEW_CONTACT_NAME"), "Release machine report redacts review contact name placeholder token");
  assert(!raw.includes("TODO_REVIEW_CONTACT_PHONE"), "Release machine report redacts review contact phone placeholder token");
  assert(!raw.includes("you@example.com"), "Release machine report excludes placeholder email values");
  assert(!raw.includes("+1-555-555-5555"), "Release machine report excludes placeholder phone values");
  assert(!raw.includes("Your Name"), "Release machine report excludes placeholder names");
  assert(!/<script\b/i.test(markdown), "Release machine report markdown contains no script tags");
  assert(markdown.includes("# Cody Cartridge Release Machine Report"), "Release machine report markdown includes title");
  assert(markdown.includes("## Next Action"), "Release machine report markdown includes next action");
  assert(markdown.includes("## Gates"), "Release machine report markdown includes gate table");
  assert(markdown.includes("## Redaction"), "Release machine report markdown documents redaction");

  if ((report.summary?.blockedGateCount ?? 0) > 0 || (report.summary?.releaseBlockers ?? 0) > 0) {
    warn(
      `Release machine report records ${report.summary.blockedGateCount} blocked gate(s) and ${report.summary.releaseBlockers} release blocker(s)`
    );
  } else if ((report.summary?.warningGateCount ?? 0) > 0) {
    warn(`Release machine report records ${report.summary.warningGateCount} warning gate(s)`);
  } else {
    pass("Release machine report records no blocked or warning gates");
  }
}

main();

console.log(`Release machine report checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
