#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_MANUAL_TASKS.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_MANUAL_TASKS.md");
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

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function isPlaceholder(value) {
  const text = String(value ?? "").trim();
  return !text || /TODO_|placeholder/i.test(text);
}

function allTasks(artifact) {
  return (artifact.sections ?? []).flatMap((section) => section.tasks ?? []);
}

function taskById(artifact, id) {
  return allTasks(artifact).find((task) => task.id === id);
}

function countStatus(tasks, status) {
  return tasks.filter((task) => task.status === status).length;
}

function scriptIncludes(pkg, scriptName, command) {
  return String(pkg.scripts?.[scriptName] ?? "").includes(command);
}

function main() {
  assert(exists(jsonPath), "App Store Connect manual tasks JSON exists");
  assert(exists(markdownPath), "App Store Connect manual tasks markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    console.log(`App Store Connect manual task checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const pkg = readJson("package.json");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const compliance = readJson("app-store-assets/APP_STORE_COMPLIANCE.json");
  const artifact = readJson("app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json");
  const markdown = readText("app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md");
  const readiness = readText("APP_STORE_READINESS.md");
  const tasks = allTasks(artifact);
  const raw = `${JSON.stringify(artifact)}\n${markdown}`;
  const supportUrlPlaceholder = isPlaceholder(fields.urls?.supportUrl);
  const privacyUrlPlaceholder = isPlaceholder(fields.urls?.privacyPolicyUrl);
  const supportEmailPlaceholder = isPlaceholder(fields.urls?.supportEmail);
  const reviewContactPlaceholder =
    isPlaceholder(fields.review?.contact?.name) ||
    isPlaceholder(fields.review?.contact?.email) ||
    isPlaceholder(fields.review?.contact?.phone);

  assert(artifact.app?.bundleId === (fields.app?.bundleId ?? pkg.build?.appId), "Manual tasks bundle id matches generated fields");
  assert(artifact.app?.version === (fields.app?.packageVersion ?? pkg.version), "Manual tasks version matches generated fields");
  assert(artifact.app?.buildVersion === (fields.app?.buildVersion ?? pkg.build?.buildVersion ?? pkg.version), "Manual tasks build version matches generated fields");
  assert(artifact.app?.sku === fields.app?.sku, "Manual tasks SKU matches generated fields");
  assert(artifact.summary?.sectionCount === (artifact.sections ?? []).length, "Manual tasks section count is accurate");
  assert(artifact.summary?.taskCount === tasks.length, "Manual tasks task count is accurate");
  assert(artifact.summary?.manualCount === countStatus(tasks, "manual"), "Manual tasks manual count is accurate");
  assert(artifact.summary?.blockedCount === countStatus(tasks, "blocked"), "Manual tasks blocked count is accurate");
  assert(artifact.summary?.complianceManualCount === compliance.summary?.manualCount, "Manual tasks compliance manual count matches compliance packet");
  assert(artifact.summary?.contactValuesRedacted === true, "Manual tasks record contact-value redaction posture");
  assert(
    artifact.summary?.status === (countStatus(tasks, "blocked") > 0 ? "blocked" : "ready-for-manual-entry"),
    "Manual tasks status matches blocked task count"
  );

  ["app-record", "product-page", "privacy-compliance", "testflight-review"].forEach((id) => {
    assert((artifact.sections ?? []).some((section) => section.id === id), `Manual tasks include ${id} section`);
  });

  [
    "app-record-create",
    "product-page-copy",
    "product-page-screenshots",
    "support-url",
    "privacy-policy-url",
    "app-privacy",
    "age-rating",
    "pricing",
    "availability",
    "release-option",
    "tax-category",
    "rights-export-dsa",
    "testflight-internal-group",
    "testflight-feedback-email",
    "app-review-contact",
    "app-review-notes",
    "processed-build-selection"
  ].forEach((id) => {
    assert(Boolean(taskById(artifact, id)), `Manual tasks include ${id}`);
  });

  assert(taskById(artifact, "app-record-create")?.status === "manual", "Manual tasks app record is ready for account entry");
  assert(taskById(artifact, "product-page-copy")?.status === "manual", "Manual tasks product copy is ready for account entry");
  assert(taskById(artifact, "support-url")?.status === (supportUrlPlaceholder ? "blocked" : "manual"), "Manual tasks support URL status matches generated fields");
  assert(taskById(artifact, "privacy-policy-url")?.status === (privacyUrlPlaceholder ? "blocked" : "manual"), "Manual tasks privacy URL status matches generated fields");
  assert(taskById(artifact, "testflight-feedback-email")?.status === (supportEmailPlaceholder ? "blocked" : "manual"), "Manual tasks feedback email status matches generated fields");
  assert(taskById(artifact, "app-review-contact")?.status === (reviewContactPlaceholder ? "blocked" : "manual"), "Manual tasks App Review contact status matches generated fields");
  assert(taskById(artifact, "processed-build-selection")?.status === "blocked", "Manual tasks keep processed build selection blocked until upload");
  assert(taskById(artifact, "rights-export-dsa")?.evidence?.includes("dsa=manual"), "Manual tasks include EU DSA account action evidence");

  assert(
    artifact.sourceArtifacts?.includes("app-store-assets/APP_STORE_CONNECT_FIELDS.json") &&
      artifact.sourceArtifacts?.includes("app-store-assets/APP_STORE_COMPLIANCE.json") &&
      artifact.sourceArtifacts?.includes("app-store-assets/screenshots/STORE_SCREENSHOTS.json") &&
      artifact.sourceArtifacts?.includes("APP_STORE_READINESS.md"),
    "Manual tasks record source artifacts"
  );
  assert(
    !raw.includes("TODO_PUBLIC_SITE_URL") &&
      !raw.includes("TODO_SUPPORT_EMAIL") &&
      !raw.includes("TODO_REVIEW_CONTACT_NAME") &&
      !raw.includes("TODO_REVIEW_CONTACT_PHONE") &&
      !raw.includes("you@example.com") &&
      !raw.includes("+1-555-555-5555"),
    "Manual tasks exclude raw public/contact placeholder values"
  );
  assert(markdown.includes("# Cody Cartridge App Store Connect Manual Tasks"), "Manual tasks markdown includes title");
  assert(markdown.includes("## Task Matrix"), "Manual tasks markdown includes task matrix");
  assert(markdown.includes("App Store Connect Location"), "Manual tasks markdown includes App Store Connect locations");
  assert(markdown.includes("Blocked tasks"), "Manual tasks markdown includes blocked task summary");

  assert(scriptIncludes(pkg, "manual-tasks:store", "scripts/build-app-store-connect-manual-tasks.cjs"), "package.json has manual task generator script");
  assert(scriptIncludes(pkg, "manual-tasks:store", "scripts/check-app-store-connect-manual-tasks.cjs"), "package.json manual task script runs checker");
  assert(scriptIncludes(pkg, "check:manual-tasks", "scripts/check-app-store-connect-manual-tasks.cjs"), "package.json has manual task standalone checker");
  assert(scriptIncludes(pkg, "app-compliance:store", "npm run manual-tasks:store"), "App Store compliance script refreshes manual tasks");
  assert(readiness.includes("manual-tasks:store"), "Readiness guide documents manual task packet");

  if ((artifact.summary?.blockedCount ?? 0) > 0) {
    warn(`App Store Connect manual task packet records ${artifact.summary.blockedCount} blocked task(s)`);
  }

  console.log(`App Store Connect manual task checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
