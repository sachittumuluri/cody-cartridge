#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const homeDir = os.homedir();
const passes = [];
const warnings = [];
const failures = [];
const details = [];

function sanitizeLine(line) {
  return String(line ?? "")
    .replaceAll(projectRoot, "<project>")
    .replaceAll(homeDir, "~")
    .replace(/([A-Z0-9._%+-])[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})/gi, "$1***$2")
    .replace(/(\+?\d)[\d ().-]{5,}(\d{2})/g, "$1***$2")
    .replace(/Apple (?:Distribution|Development|Mac Distribution|Mac App Distribution|Mac Installer Distribution):[^\n]+/gi, "Apple signing identity: <redacted>")
    .trim();
}

function outputLines(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .split(/\r?\n/)
    .map(sanitizeLine)
    .filter(Boolean);
}

function summarize(lines) {
  return lines.find((line) => /checks|preflight|version|tooling|boundary|doctor/i.test(line)) ?? lines[0] ?? "No output captured.";
}

function nestedIssues(lines, prefix) {
  return lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.replace(new RegExp(`^${prefix}\\s+`), ""));
}

function recordPass(message) {
  passes.push(message);
}

function recordWarning(message) {
  warnings.push(message);
}

function recordFailure(message) {
  failures.push(message);
}

function runCheck(id, label, args) {
  const result = spawnSync("node", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const lines = outputLines(result);
  const command = ["node", ...args].join(" ");
  const failureLines = nestedIssues(lines, "FAIL");
  const warningLines = nestedIssues(lines, "WARN");
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const failed = exitCode !== 0 || failureLines.length > 0 || Boolean(result.error);
  const summary = summarize(lines);
  const detail = {
    id,
    label,
    command,
    exitCode,
    summary,
    failureCount: failureLines.length + (result.error ? 1 : 0),
    warningCount: warningLines.length,
    failures: result.error ? [sanitizeLine(result.error.message), ...failureLines] : failureLines,
    warnings: warningLines
  };

  details.push(detail);

  if (failed) {
    const message = `${label}: ${summary}`;

    if (strict) {
      recordFailure(message);
    } else {
      recordWarning(message);
    }
    return;
  }

  if (warningLines.length > 0) {
    recordWarning(`${label}: ${summary}`);
    return;
  }

  recordPass(`${label}: ${summary}`);
}

function readReleaseBlockerSummary() {
  const blockersPath = path.join(projectRoot, "app-store-assets", "RELEASE_BLOCKERS.json");

  if (!fs.existsSync(blockersPath)) {
    return null;
  }

  try {
    const blockers = JSON.parse(fs.readFileSync(blockersPath, "utf8"));
    const blockerCount = blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0;
    return {
      blockerCount,
      readyForStrictPreflight: Boolean(blockers.summary?.readyForStrictPreflight),
      generatedAt: blockers.generatedAt ?? blockers.summary?.generatedAt ?? null
    };
  } catch {
    return null;
  }
}

function checkReleaseBlockerReport() {
  const summary = readReleaseBlockerSummary();

  if (!summary) {
    const message = "Release blocker report is missing or unreadable. Run npm run report:store-blockers.";

    if (strict) {
      recordFailure(message);
    } else {
      recordWarning(message);
    }
    return;
  }

  if (summary.blockerCount > 0) {
    const message = `Release blocker report records ${summary.blockerCount} blocker(s).`;

    if (strict) {
      recordFailure(message);
    } else {
      recordWarning(message);
    }
    return;
  }

  recordPass("Release blocker report records zero blockers.");
}

const checkArgs = [
  {
    id: "public-release-self-test",
    label: "Public release refresh self-test",
    args: ["scripts/refresh-public-release.cjs", "--self-test"]
  },
  {
    id: "env",
    label: "Public URL/contact env",
    args: ["scripts/check-store-env.cjs"]
  },
  {
    id: "public-release-sync",
    label: "Public release generated-field sync",
    args: strict ? ["scripts/check-public-release-sync.cjs", "--strict"] : ["scripts/check-public-release-sync.cjs"]
  },
  {
    id: "runtime",
    label: "Release Node runtime",
    args: strict ? ["scripts/check-release-runtime.cjs", "--strict"] : ["scripts/check-release-runtime.cjs"]
  },
  {
    id: "source-version",
    label: "Source App Store version",
    args: ["scripts/check-store-version.cjs", "--source-only"]
  },
  {
    id: "packaging-toolchain",
    label: "Packaging toolchain",
    args: ["scripts/check-packaging-toolchain.cjs"]
  },
  {
    id: "public-urls",
    label: "Published support/privacy URLs",
    args: strict ? ["scripts/check-store-urls.cjs", "--strict"] : ["scripts/check-store-urls.cjs"]
  },
  {
    id: "published-site",
    label: "Published public site pages",
    args: strict ? ["scripts/check-public-site-published.cjs", "--strict"] : ["scripts/check-public-site-published.cjs"]
  },
  {
    id: "mas-signing",
    label: "MAS signing assets",
    args: strict ? ["scripts/check-mas-signing.cjs", "--strict"] : ["scripts/check-mas-signing.cjs"]
  },
  {
    id: "mas-package",
    label: "MAS package boundary",
    args: strict ? ["scripts/check-mas-package.cjs", "--strict"] : ["scripts/check-mas-package.cjs"]
  },
  {
    id: "upload-tooling",
    label: "App Store upload tooling",
    args: strict ? ["scripts/check-upload-tooling.cjs", "--strict"] : ["scripts/check-upload-tooling.cjs"]
  },
  {
    id: "upload-credentials",
    label: "App Store upload credentials",
    args: strict ? ["scripts/check-upload-credentials.cjs", "--strict"] : ["scripts/check-upload-credentials.cjs"]
  }
];

checkArgs.forEach((check) => runCheck(check.id, check.label, check.args));
checkReleaseBlockerReport();

console.log(`Release machine doctor${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));
failures.forEach((message) => console.error(`FAIL ${message}`));

if (details.length > 0) {
  console.log("INFO Checked gates:");
  details.forEach((detail) => {
    console.log(`INFO ${detail.id}: ${detail.command} -> exit ${detail.exitCode}, ${detail.failureCount} failure(s), ${detail.warningCount} warning(s)`);
  });
}

if (failures.length > 0) {
  process.exitCode = 1;
}
