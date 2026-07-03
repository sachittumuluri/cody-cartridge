#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "APP_STORE_COMPLIANCE.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "APP_STORE_COMPLIANCE.md");
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

function includes(value, needle) {
  return String(value ?? "").toLowerCase().includes(String(needle).toLowerCase());
}

function allItems(artifact) {
  return (artifact.sections ?? []).flatMap((section) => section.items ?? []);
}

function itemById(artifact, id) {
  return allItems(artifact).find((item) => item.id === id);
}

function statusCount(items, status) {
  return items.filter((item) => item.status === status).length;
}

function scriptIncludes(pkg, scriptName, command) {
  return String(pkg.scripts?.[scriptName] ?? "").includes(command);
}

function main() {
  assert(exists(jsonPath), "App Store compliance JSON exists");
  assert(exists(markdownPath), "App Store compliance markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    console.log(`App Store compliance checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const pkg = readJson("package.json");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const exportCompliance = readJson("app-store-assets/EXPORT_COMPLIANCE.json");
  const artifact = readJson("app-store-assets/APP_STORE_COMPLIANCE.json");
  const markdown = readText("app-store-assets/APP_STORE_COMPLIANCE.md");
  const readiness = readText("APP_STORE_READINESS.md");
  const raw = `${JSON.stringify(artifact)}\n${markdown}`;
  const items = allItems(artifact);

  assert(artifact.app?.bundleId === (fields.app?.bundleId ?? pkg.build?.appId), "App Store compliance bundle id matches generated fields");
  assert(artifact.app?.version === (fields.app?.packageVersion ?? pkg.version), "App Store compliance version matches generated fields");
  assert(artifact.app?.buildVersion === (fields.app?.buildVersion ?? pkg.build?.buildVersion ?? pkg.version), "App Store compliance build version matches generated fields");
  assert(artifact.summary?.itemCount === items.length, "App Store compliance item count is accurate");
  assert(artifact.summary?.readyCount === statusCount(items, "ready"), "App Store compliance ready count is accurate");
  assert(artifact.summary?.manualCount === statusCount(items, "manual"), "App Store compliance manual count is accurate");
  assert(artifact.summary?.blockerCount === statusCount(items, "blocked"), "App Store compliance blocker count is accurate");
  assert(artifact.summary?.manualItemsAreAccountOrAppStoreConnectTasks === true, "App Store compliance marks manual items as account/App Store Connect tasks");
  assert(
    artifact.summary?.status === (statusCount(items, "blocked") > 0 ? "needs-compliance-source-fix" : "ready-for-app-store-connect-entry"),
    "App Store compliance status matches blockers"
  );

  ["age-rating", "privacy-data", "pricing-availability", "rights-compliance"].forEach((id) => {
    assert((artifact.sections ?? []).some((section) => section.id === id), `App Store compliance includes ${id} section`);
  });

  [
    "age-rating-candidate",
    "age-rating-risk-answers",
    "privacy-no-collection",
    "privacy-no-tracking",
    "privacy-local-processing",
    "pricing",
    "availability",
    "release-option",
    "tax-category",
    "content-rights",
    "export-compliance",
    "dsa-status",
    "login-iap-medical"
  ].forEach((id) => {
    assert(Boolean(itemById(artifact, id)), `App Store compliance includes ${id} item`);
  });

  assert(itemById(artifact, "age-rating-candidate")?.status === "ready", "App Store compliance marks age-rating candidate ready");
  assert(itemById(artifact, "privacy-no-collection")?.status === "ready", "App Store compliance marks no-data-collection answer ready");
  assert(itemById(artifact, "privacy-no-tracking")?.status === "ready", "App Store compliance marks no-tracking answer ready");
  assert(itemById(artifact, "pricing")?.status === "manual", "App Store compliance treats pricing as manual App Store Connect entry");
  assert(itemById(artifact, "availability")?.status === "manual", "App Store compliance treats availability as manual App Store Connect entry");
  assert(itemById(artifact, "dsa-status")?.status === "manual", "App Store compliance treats EU DSA as manual account/legal entry");
  assert(
    itemById(artifact, "content-rights")?.status === "ready" &&
      includes(itemById(artifact, "content-rights")?.evidence, "ships without music") &&
      includes(itemById(artifact, "content-rights")?.evidence, "user-selected files"),
    "App Store compliance content-rights answer is local-file only"
  );
  assert(
    itemById(artifact, "export-compliance")?.status === "ready" &&
      exportCompliance.summary?.status === "ready-for-app-store-connect-questionnaire",
    "App Store compliance export-compliance item matches export-compliance artifact"
  );
  assert(
    artifact.sourceArtifacts?.includes("app-store-assets/APP_STORE_CONNECT_FIELDS.json") &&
      artifact.sourceArtifacts?.includes("app-store-assets/EXPORT_COMPLIANCE.json") &&
      artifact.sourceArtifacts?.includes("app-store-assets/EXPORT_COMPLIANCE.md") &&
      artifact.sourceArtifacts?.includes("APP_STORE_READINESS.md"),
    "App Store compliance records source artifacts"
  );
  assert(
    !raw.includes("TODO_PUBLIC_SITE_URL") &&
      !raw.includes("TODO_SUPPORT_EMAIL") &&
      !raw.includes("TODO_REVIEW_CONTACT_NAME") &&
      !raw.includes("TODO_REVIEW_CONTACT_PHONE") &&
      !raw.includes("you@example.com") &&
      !raw.includes("+1-555-555-5555"),
    "App Store compliance excludes raw public/contact placeholder values"
  );
  assert(markdown.includes("# Cody Cartridge App Store Compliance Packet"), "App Store compliance markdown includes title");
  assert(markdown.includes("## Compliance Matrix"), "App Store compliance markdown includes matrix section");
  assert(markdown.includes("Manual App Store Connect items"), "App Store compliance markdown calls out manual items");
  assert(markdown.includes("EU DSA"), "App Store compliance markdown includes EU DSA guidance");

  assert(scriptIncludes(pkg, "app-compliance:store", "scripts/build-app-store-compliance.cjs"), "package.json has app-compliance build script");
  assert(scriptIncludes(pkg, "app-compliance:store", "scripts/check-app-store-compliance.cjs"), "package.json app-compliance script runs checker");
  assert(scriptIncludes(pkg, "check:app-compliance", "scripts/check-app-store-compliance.cjs"), "package.json has app-compliance standalone checker");
  assert(scriptIncludes(pkg, "release:store:local", "npm run app-compliance:store"), "Local release dry-run builds App Store compliance packet");
  assert(scriptIncludes(pkg, "release:store:preflight", "npm run app-compliance:store"), "Release preflight builds App Store compliance packet");
  assert(readiness.includes("app-compliance:store"), "Readiness guide documents App Store compliance packet");

  if ((artifact.summary?.manualCount ?? 0) > 0) {
    warn(`App Store compliance packet records ${artifact.summary.manualCount} manual App Store Connect item(s)`);
  }

  console.log(`App Store compliance checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
