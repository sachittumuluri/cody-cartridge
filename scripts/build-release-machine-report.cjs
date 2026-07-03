#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "RELEASE_MACHINE_REPORT.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "RELEASE_MACHINE_REPORT.md");
const homeDir = os.homedir();
const loadedEnvFiles = loadStoreEnv(projectRoot);

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function sanitizeText(value) {
  return String(value ?? "")
    .replaceAll(projectRoot, "<project>")
    .replaceAll(homeDir, "~")
    .replaceAll("TODO_PUBLIC_SITE_URL", "public-site placeholder token")
    .replaceAll("TODO_SUPPORT_EMAIL", "support-email placeholder token")
    .replaceAll("TODO_REVIEW_CONTACT_NAME", "review-contact-name placeholder token")
    .replaceAll("TODO_REVIEW_CONTACT_PHONE", "review-contact-phone placeholder token")
    .replaceAll("https://example.com", "placeholder public URL")
    .replaceAll("you@example.com", "placeholder email")
    .replaceAll("+1-555-555-5555", "placeholder phone")
    .replace(/([A-Z0-9._%+-])[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})/gi, "$1***$2")
    .replace(/(\+?\d)[\d ().-]{5,}(\d{2})/g, "$1***$2")
    .replace(/\b[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\b/gi, "<uuid>")
    .replace(
      /Apple (?:Distribution|Development|Mac Distribution|Mac App Distribution|Mac Installer Distribution):[^\n]+/gi,
      "Apple signing identity: <redacted>"
    )
    .trim();
}

function outputLines(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .split(/\r?\n/)
    .map(sanitizeText)
    .filter(Boolean);
}

function nestedIssues(lines, prefix) {
  return lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.replace(new RegExp(`^${prefix}\\s+`), ""));
}

function summarize(lines) {
  return (
    lines.find((line) => /checks|preflight|version|tooling|boundary|doctor|report/i.test(line)) ??
    lines[0] ??
    "No output captured."
  );
}

function runGate(id, label, args, strictArgs = args) {
  const result = spawnSync("node", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const lines = outputLines(result);
  const failures = nestedIssues(lines, "FAIL");
  const warnings = nestedIssues(lines, "WARN");
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const error = result.error ? sanitizeText(result.error.message) : null;
  const failed = exitCode !== 0 || failures.length > 0 || Boolean(error);
  const status = failed ? "blocked" : warnings.length > 0 ? "warning" : "pass";

  return {
    id,
    label,
    status,
    command: ["node", ...args].join(" "),
    strictCommand: ["node", ...strictArgs].join(" "),
    exitCode,
    failureCount: failures.length + (error ? 1 : 0),
    warningCount: warnings.length,
    summary: summarize(lines),
    failures: error ? [error, ...failures] : failures,
    warnings
  };
}

function releaseBlockerGate(blockers) {
  const blockerCount = blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0;
  const readyForStrictPreflight = Boolean(blockers.summary?.readyForStrictPreflight);
  const categories = (blockers.categories ?? [])
    .filter((category) => (category.blockerCount ?? 0) > 0)
    .map((category) => `${category.label}: ${category.blockerCount} blocker(s)`);
  const status = blockerCount > 0 ? "blocked" : readyForStrictPreflight ? "pass" : "warning";

  return {
    id: "release-blockers",
    label: "Release blocker report",
    status,
    command: "node scripts/build-release-blocker-report.cjs",
    strictCommand: "npm run report:store-blockers && npm run verify:store:strict",
    exitCode: 0,
    failureCount: blockerCount,
    warningCount: status === "warning" ? 1 : 0,
    summary:
      blockerCount > 0
        ? `Release blocker report records ${blockerCount} blocker(s).`
        : "Release blocker report records zero blockers.",
    failures: categories,
    warnings: status === "warning" ? ["Strict preflight is not marked ready yet."] : []
  };
}

function firstBlockedPhase(resolutionPlan) {
  return (resolutionPlan.phases ?? []).find((phase) => (phase.blockerCategoryIds ?? []).length > 0) ?? null;
}

function gateTable(gates) {
  return [
    "| Gate | Status | Failures | Warnings | Summary |",
    "| --- | --- | ---: | ---: | --- |",
    ...gates.map((gate) => {
      const summary = sanitizeText(gate.summary).replaceAll("|", "\\|");
      return `| ${gate.label} | ${gate.status} | ${gate.failureCount} | ${gate.warningCount} | ${summary} |`;
    })
  ].join("\n");
}

function issueList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderMarkdown(report) {
  const blockedGates = report.gates.filter((gate) => gate.status === "blocked");
  const warningGates = report.gates.filter((gate) => gate.status === "warning");

  return `# Cody Cartridge Release Machine Report

Generated by \`npm run machine-report:store\`.

This report is a redacted, persistent snapshot of the release-machine gate state. It is advisory by default so it can be regenerated before public URLs, Apple signing assets, and upload credentials exist.

## Status

- App: ${report.app.name}
- Bundle ID: \`${report.app.bundleId}\`
- Version: ${report.app.version}
- Build version: ${report.app.buildVersion}
- Status: ${report.summary.status}
- Blocked gates: ${report.summary.blockedGateCount}
- Warning gates: ${report.summary.warningGateCount}
- Release blockers: ${report.summary.releaseBlockers}
- Strict equivalent: \`${report.strictEquivalentCommand}\`

## Next Action

- Phase: ${report.nextAction.phaseTitle}
- Command: \`${report.nextAction.command}\`
- Stop when: ${report.nextAction.stopWhen}

## Gates

${gateTable(report.gates)}

## Blocking Details

${blockedGates
  .map(
    (gate) => `### ${gate.label}

Failures:
${issueList(gate.failures)}

Warnings:
${issueList(gate.warnings)}`
  )
  .join("\n\n") || "No blocked gates recorded."}

## Warning Details

${warningGates
  .map(
    (gate) => `### ${gate.label}

${issueList(gate.warnings)}`
  )
  .join("\n\n") || "No warning gates recorded."}

## Redaction

- Project paths are replaced with \`<project>\`.
- Home paths are replaced with \`~\`.
- Public URL/contact placeholders are labeled without raw values.
- Apple signing identity names, profile UUIDs, email addresses, and phone numbers are redacted.
- The ignored \`app-store-assets/site.env\` file is not copied into generated artifacts.
`;
}

function main() {
  const pkg = readJson("package.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json", { summary: {}, categories: [] });
  const resolutionPlan = readJson("app-store-assets/RELEASE_RESOLUTION_PLAN.json", { phases: [] });
  const nextPhase = firstBlockedPhase(resolutionPlan);
  const app = {
    name: pkg.build?.productName ?? pkg.name,
    bundleId: pkg.build?.appId,
    version: pkg.version,
    buildVersion: pkg.build?.buildVersion ?? pkg.version
  };
  const gates = [
    runGate("public-release-self-test", "Public release refresh self-test", [
      "scripts/refresh-public-release.cjs",
      "--self-test"
    ]),
    runGate("env", "Public URL/contact env", ["scripts/check-store-env.cjs"]),
    runGate("public-release-sync", "Public release generated-field sync", ["scripts/check-public-release-sync.cjs"], [
      "scripts/check-public-release-sync.cjs",
      "--strict"
    ]),
    runGate("runtime", "Release Node runtime", ["scripts/check-release-runtime.cjs"], [
      "scripts/check-release-runtime.cjs",
      "--strict"
    ]),
    runGate("source-version", "Source App Store version", ["scripts/check-store-version.cjs", "--source-only"]),
    runGate("packaging-toolchain", "Packaging toolchain", ["scripts/check-packaging-toolchain.cjs"]),
    runGate("public-urls", "Published support/privacy URLs", ["scripts/check-store-urls.cjs"], [
      "scripts/check-store-urls.cjs",
      "--strict"
    ]),
    runGate("published-site", "Published public site pages", ["scripts/check-public-site-published.cjs"], [
      "scripts/check-public-site-published.cjs",
      "--strict"
    ]),
    runGate("mas-signing", "MAS signing assets", ["scripts/check-mas-signing.cjs"], [
      "scripts/check-mas-signing.cjs",
      "--strict"
    ]),
    runGate("mas-package", "MAS package boundary", ["scripts/check-mas-package.cjs"], [
      "scripts/check-mas-package.cjs",
      "--strict"
    ]),
    runGate("upload-tooling", "App Store upload tooling", ["scripts/check-upload-tooling.cjs"], [
      "scripts/check-upload-tooling.cjs",
      "--strict"
    ]),
    runGate("upload-credentials", "App Store upload credentials", ["scripts/check-upload-credentials.cjs"], [
      "scripts/check-upload-credentials.cjs",
      "--strict"
    ]),
    releaseBlockerGate(blockers)
  ];
  const blockedGateCount = gates.filter((gate) => gate.status === "blocked").length;
  const warningGateCount = gates.filter((gate) => gate.status === "warning").length;
  const releaseBlockers = blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0;
  const nextAction = {
    phaseId: nextPhase?.id ?? "strict-preflight",
    phaseTitle: nextPhase?.title ?? "Run strict release preflight",
    command: nextPhase?.commands?.[0] ?? "npm run release:store:preflight",
    stopWhen: nextPhase?.exitCriteria?.[0] ?? "npm run verify:store:strict exits with 0."
  };
  const report = {
    generatedAt: new Date().toISOString(),
    app,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      loadedReleaseEnvFiles: loadedEnvFiles.map((filePath) => sanitizeText(filePath))
    },
    summary: {
      status: blockedGateCount > 0 || releaseBlockers > 0 ? "blocked" : warningGateCount > 0 ? "warning" : "ready",
      gateCount: gates.length,
      blockedGateCount,
      warningGateCount,
      releaseBlockers,
      readyForStrictPreflight: Boolean(blockers.summary?.readyForStrictPreflight)
    },
    nextAction,
    strictEquivalentCommand: "npm run check:release-machine -- --strict",
    gates,
    sourceArtifacts: [
      "app-store-assets/RELEASE_BLOCKERS.json",
      "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
      "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
      "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
      "app-store-assets/UPLOAD_COMMAND_PACKET.json",
      "app-store-assets/SIGNING_ASSET_REPORT.json",
      "app-store-assets/APPLE_RELEASE_ASSETS.json",
      "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
      "scripts/refresh-public-release.cjs",
      "scripts/install-asc-key.cjs",
      "scripts/check-upload-credentials.cjs"
    ],
    redaction: {
      storesRawContactValues: false,
      storesSigningSecrets: false,
      privateEnvFileIncluded: false
    }
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderMarkdown(report));

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (report.summary.status !== "ready") {
    console.warn(
      `Release machine report records ${report.summary.blockedGateCount} blocked gate(s), ${report.summary.warningGateCount} warning gate(s), and ${report.summary.releaseBlockers} release blocker(s).`
    );
  }
}

main();
