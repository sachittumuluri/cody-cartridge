#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "APP_CONTENT_RIGHTS.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "APP_CONTENT_RIGHTS.md");
const passes = [];
const failures = [];

function pass(message) {
  passes.push(message);
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

function allFacts(artifact) {
  return artifact.facts ?? [];
}

function factById(artifact, id) {
  return allFacts(artifact).find((fact) => fact.id === id);
}

function scriptIncludes(pkg, scriptName, command) {
  return String(pkg.scripts?.[scriptName] ?? "").includes(command);
}

function main() {
  assert(exists(jsonPath), "Content-rights audit JSON exists");
  assert(exists(markdownPath), "Content-rights audit markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    console.log(`Content-rights audit checks: ${passes.length} passed, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const pkg = readJson("package.json");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const artifact = readJson("app-store-assets/APP_CONTENT_RIGHTS.json");
  const markdown = readText("app-store-assets/APP_CONTENT_RIGHTS.md");
  const readiness = readText("APP_STORE_READINESS.md");
  const raw = `${JSON.stringify(artifact)}\n${markdown}`;
  const facts = allFacts(artifact);

  assert(artifact.app?.bundleId === (fields.app?.bundleId ?? pkg.build?.appId), "Content-rights audit bundle id matches generated fields");
  assert(artifact.app?.version === (fields.app?.packageVersion ?? pkg.version), "Content-rights audit version matches generated fields");
  assert(artifact.app?.buildVersion === (fields.app?.buildVersion ?? pkg.build?.buildVersion ?? pkg.version), "Content-rights audit build version matches generated fields");
  assert(artifact.summary?.factCount === facts.length, "Content-rights audit fact count is accurate");
  assert(artifact.summary?.passedCount === facts.filter((fact) => fact.status === "pass").length, "Content-rights audit passed count is accurate");
  assert(artifact.summary?.failedCount === facts.filter((fact) => fact.status !== "pass").length, "Content-rights audit failed count is accurate");
  assert(artifact.summary?.status === "ready-for-app-store-content-rights", "Content-rights audit is ready");
  assert(artifact.summary?.packagedMediaFileCount === 0, "Content-rights audit records no packaged media files");
  assert(artifact.summary?.highRiskDependencyCount === 0, "Content-rights audit records no media-downloader dependencies");
  assert(artifact.summary?.highRiskRuntimeReferenceCount === 0, "Content-rights audit records no downloader/scraping source references");
  assert(artifact.summary?.contactValuesStored === false, "Content-rights audit stores no private contact values");

  [
    "no-packaged-media",
    "no-high-risk-deps",
    "no-high-risk-runtime-refs",
    "no-external-open",
    "takeout-metadata-only",
    "local-media-protocols",
    "sandbox-no-network",
    "rights-copy",
    "store-demo-synthetic",
    "compliance-linkage"
  ].forEach((id) => {
    assert(factById(artifact, id)?.status === "pass", `Content-rights audit passes ${id}`);
  });

  assert(
    artifact.sourceArtifacts?.includes("package.json") &&
      artifact.sourceArtifacts?.includes("electron/main.cjs") &&
      artifact.sourceArtifacts?.includes("src/App.tsx") &&
      artifact.sourceArtifacts?.includes("app-store-assets/APP_STORE_CONNECT_FIELDS.json") &&
      artifact.sourceArtifacts?.includes("app-store-assets/APP_STORE_COMPLIANCE.json"),
    "Content-rights audit records source artifacts"
  );
  assert(
    !raw.includes("TODO_PUBLIC_SITE_URL") &&
      !raw.includes("TODO_SUPPORT_EMAIL") &&
      !raw.includes("TODO_REVIEW_CONTACT_NAME") &&
      !raw.includes("TODO_REVIEW_CONTACT_PHONE"),
    "Content-rights audit excludes raw public/contact placeholder values"
  );
  assert(!/\by2mate\b/i.test(raw), "Content-rights audit excludes downloader-site names from generated artifacts");
  assert(markdown.includes("# Cody Cartridge Content Rights And Media Audit"), "Content-rights audit markdown includes title");
  assert(markdown.includes("## Audit Matrix"), "Content-rights audit markdown includes audit matrix");
  assert(markdown.includes("ships without music"), "Content-rights audit markdown explains local user-media rights posture");

  assert(scriptIncludes(pkg, "content-rights:store", "scripts/build-app-content-rights.cjs"), "package.json has content-rights generator script");
  assert(scriptIncludes(pkg, "content-rights:store", "scripts/check-app-content-rights.cjs"), "package.json content-rights script runs checker");
  assert(scriptIncludes(pkg, "check:content-rights", "scripts/check-app-content-rights.cjs"), "package.json has content-rights standalone checker");
  assert(scriptIncludes(pkg, "app-compliance:store", "npm run content-rights:store"), "App Store compliance script refreshes content-rights audit");
  assert(readiness.includes("content-rights:store"), "Readiness guide documents content-rights audit");

  console.log(`Content-rights audit checks: ${passes.length} passed, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
