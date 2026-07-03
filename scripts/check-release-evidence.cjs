#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "RELEASE_EVIDENCE.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "RELEASE_EVIDENCE.md");
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

function sha256(absolutePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
}

function artifactFor(evidence, filePath) {
  return (evidence.artifacts ?? []).find((item) => item.path === filePath);
}

function commandFor(evidence, id) {
  return (evidence.commands ?? []).find((item) => item.id === id);
}

function validateArtifactHash(item) {
  if (!item?.path) {
    fail("Release evidence artifact has a path");
    return;
  }

  const absolutePath = path.join(projectRoot, item.path);

  if (item.exists === true) {
    assert(exists(absolutePath), `Release evidence artifact exists on disk: ${item.path}`);

    if (exists(absolutePath)) {
      const stat = fs.statSync(absolutePath);
      assert(stat.isFile(), `Release evidence artifact is a file: ${item.path}`);
      assert(item.sizeBytes === stat.size, `Release evidence artifact size matches disk: ${item.path}`);
      assert(item.sha256 === sha256(absolutePath), `Release evidence artifact hash matches disk: ${item.path}`);
    }

    return;
  }

  assert(!exists(absolutePath), `Release evidence missing artifact status matches disk: ${item.path}`);
}

function main() {
  assert(exists(jsonPath), "Release evidence JSON exists");
  assert(exists(markdownPath), "Release evidence markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    return;
  }

  const evidence = readJson("app-store-assets/RELEASE_EVIDENCE.json");
  const markdown = readText("app-store-assets/RELEASE_EVIDENCE.md");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json");
  const pkg = readJson("package.json");
  const raw = `${JSON.stringify(evidence)}\n${markdown}`;
  const expectedCommands = [
    "store-version",
    "icons",
    "electron-security",
    "packaging-toolchain",
    "help-docs",
    "copy-map",
    "review-brief",
    "app-compliance",
    "manual-tasks",
    "content-rights",
    "app-privacy",
    "export-compliance",
    "store-copy",
    "artifact-privacy",
    "site-advisory",
    "site-archive-advisory",
    "public-release-sync-advisory",
    "store-urls-advisory",
    "public-inputs",
    "publish-packet",
    "public-host",
    "published-site-advisory",
    "mas-signing-advisory",
    "signing-assets",
    "apple-assets",
    "mas-package-advisory",
    "upload-tooling-advisory",
    "upload-credentials-advisory",
    "release-machine-doctor",
    "resolution-plan",
    "submission-checklist",
    "machine-report",
    "signing-runbook",
    "upload-packet",
    "upload-evidence",
    "public-release-sync-strict",
    "store-urls-strict",
    "published-site-strict",
    "mas-signing-strict",
    "mas-package-strict",
    "upload-tooling-strict",
    "upload-credentials-strict",
    "release-machine-doctor-strict"
  ];
  const requiredArtifacts = [
    "package.json",
    "package-lock.json",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.md",
    "app-store-assets/EXPORT_COMPLIANCE.json",
    "app-store-assets/EXPORT_COMPLIANCE.md",
    "app-store-assets/APP_STORE_COMPLIANCE.json",
    "app-store-assets/APP_STORE_COMPLIANCE.md",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md",
    "app-store-assets/APP_CONTENT_RIGHTS.json",
    "app-store-assets/APP_CONTENT_RIGHTS.md",
    "app-store-assets/APP_REVIEW_BRIEF.json",
    "app-store-assets/APP_REVIEW_BRIEF.md",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.md",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.md",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.md",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md",
    "app-store-assets/RELEASE_MACHINE_REPORT.json",
    "app-store-assets/RELEASE_MACHINE_REPORT.md",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.md",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/SIGNING_ASSET_REPORT.md",
    "app-store-assets/APPLE_RELEASE_ASSETS.json",
    "app-store-assets/APPLE_RELEASE_ASSETS.md",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.md",
    "app-store-assets/UPLOAD_EVIDENCE.json",
    "app-store-assets/UPLOAD_EVIDENCE.md",
    "app-store-assets/SUBMISSION_PACKET.md",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/RELEASE_BLOCKERS.md",
    "app-store-assets/THIRD_PARTY_NOTICES.md",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/screenshots/01-library-1440x900.png",
    "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    "app-store-assets/screenshots/03-missing-files-1440x900.png",
    "build/icon.icns",
    "build/PrivacyInfo.xcprivacy",
    "build/entitlements.mas.plist",
    "build/entitlements.mas.inherit.plist",
    "scripts/build-release-evidence.cjs",
    "scripts/check-release-evidence.cjs",
    "scripts/build-public-site-publish-packet.cjs",
    "scripts/check-public-site-publish-packet.cjs",
    "scripts/build-public-host-runbook.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/configure-store-env.cjs",
    "scripts/refresh-public-release.cjs",
    "scripts/install-mas-profile.cjs",
    "scripts/install-asc-key.cjs",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/build-upload-command-packet.cjs",
    "scripts/check-upload-command-packet.cjs",
    "scripts/check-upload-credentials.cjs",
    "scripts/build-upload-evidence.cjs",
    "scripts/check-upload-evidence.cjs"
  ];

  assert(evidence.app?.bundleId === pkg.build?.appId, "Release evidence bundle id matches package config");
  assert(evidence.app?.version === pkg.version, "Release evidence version matches package config");
  assert(evidence.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Release evidence build version matches package config");
  assert(evidence.blockers?.blockerCount === blockers.summary?.blockerCount, "Release evidence blocker count matches blocker report");
  assert(
    evidence.blockers?.readyForStrictPreflight === Boolean(blockers.summary?.readyForStrictPreflight),
    "Release evidence strict-readiness flag matches blocker report"
  );
  assert(Array.isArray(evidence.releaseEnv?.loadedFiles), "Release evidence records loaded release env files");
  assert(Array.isArray(evidence.commands), "Release evidence records command evidence");
  assert(evidence.commands?.length === expectedCommands.length, "Release evidence command count matches expected gate set");

  expectedCommands.forEach((id) => {
    const command = commandFor(evidence, id);
    assert(Boolean(command), `Release evidence includes ${id} command summary`);

    if (command) {
      assert(typeof command.command === "string" && command.command.startsWith("node scripts/"), `Release evidence ${id} command is runnable`);
      assert(typeof command.exitCode === "number", `Release evidence ${id} exit code is numeric`);
      assert(typeof command.failureCount === "number", `Release evidence ${id} failure count is numeric`);
      assert(typeof command.warningCount === "number", `Release evidence ${id} warning count is numeric`);
      assert(Array.isArray(command.failures), `Release evidence ${id} failures are listed`);
      assert(Array.isArray(command.warnings), `Release evidence ${id} warnings are listed`);
      assert(command.strict === id.endsWith("-strict"), `Release evidence ${id} strict flag matches id`);
    }
  });

  const expectedStrictCommandCount = expectedCommands.filter((id) => id.endsWith("-strict")).length;
  assert(
    (evidence.commands ?? []).filter((item) => item.strict === true).length === expectedStrictCommandCount,
    "Release evidence records the strict release-machine gates"
  );
  assert(
    (evidence.commands ?? []).filter((item) => item.strict !== true).every((item) => item.exitCode === 0 && item.failureCount === 0),
    "Release evidence advisory commands are non-failing"
  );

  requiredArtifacts.forEach((filePath) => {
    assert(Boolean(artifactFor(evidence, filePath)), `Release evidence hashes ${filePath}`);
  });
  (evidence.artifacts ?? []).forEach(validateArtifactHash);

  assert(evidence.masSubmission?.bundlePath === "dist/mas-arm64/Cody Cartridge.app", "Release evidence records MAS bundle path");
  assert(typeof evidence.masSubmission?.submissionReady === "boolean", "Release evidence records MAS submission readiness");
  assert(typeof evidence.masSubmission?.localRehearsalOnly === "boolean", "Release evidence records MAS local rehearsal state");
  assert(typeof evidence.masSubmission?.hasEmbeddedProvisioningProfile === "boolean", "Release evidence records embedded provisioning profile state");
  assert(typeof evidence.masSubmission?.codeSignatureVerified === "boolean", "Release evidence records code-signature state");
  assert(typeof evidence.masSubmission?.uploadPackageCount === "number", "Release evidence records upload package count");
  assert(typeof evidence.masSubmission?.signedUploadPackageCount === "number", "Release evidence records signed upload package count");
  assert(
    typeof evidence.masSubmission?.currentVersionUploadPackageCount === "number",
    "Release evidence records current-version upload package count"
  );
  assert(
    typeof evidence.masSubmission?.signedCurrentVersionUploadPackageCount === "number",
    "Release evidence records signed current-version upload package count"
  );
  assert(
    evidence.masSubmission?.submissionReady !== true || evidence.masSubmission?.hasSignedCurrentVersionUploadPackage === true,
    "Release evidence requires a signed current-version package for MAS submission readiness"
  );
  assert(
    (evidence.masSubmission?.packageSignatures ?? []).every((item) => typeof item.matchesCurrentVersion === "boolean"),
    "Release evidence records per-package current-version match state"
  );
  assert(markdown.includes("# Cody Cartridge Release Evidence"), "Release evidence markdown includes title");
  assert(markdown.includes("## MAS Submission Posture"), "Release evidence markdown includes MAS submission posture");
  assert(markdown.includes("## Artifact Hashes"), "Release evidence markdown includes artifact hashes");
  assert(markdown.includes("## Command Evidence"), "Release evidence markdown includes command evidence");
  assert(markdown.includes("redacts local paths"), "Release evidence markdown documents redaction");
  assert(!raw.includes(projectRoot), "Release evidence redacts project root path");
  assert(!raw.includes(os.homedir()), "Release evidence redacts home directory path");

  const blockingCommandCount = (evidence.commands ?? []).filter((item) => item.exitCode !== 0 || item.failureCount > 0).length;
  if (blockingCommandCount > 0 || (evidence.blockers?.blockerCount ?? 0) > 0) {
    warn(
      `Release evidence records ${blockingCommandCount} blocking command(s) and ${evidence.blockers?.blockerCount ?? 0} release blocker(s)`
    );
  } else {
    pass("Release evidence records no blocking commands or release blockers");
  }
}

main();

console.log(`Release evidence checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
