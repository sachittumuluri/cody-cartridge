#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const jsonPath = path.join(projectRoot, "app-store-assets", "APP_REVIEW_BRIEF.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "APP_REVIEW_BRIEF.md");
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
  if (strict) {
    failures.push(message);
  } else {
    warnings.push(message);
  }
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

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function main() {
  assert(exists(jsonPath), "App Review brief JSON exists");
  assert(exists(markdownPath), "App Review brief markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    console.log(`App Review brief checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const brief = readJson("app-store-assets/APP_REVIEW_BRIEF.json");
  const markdown = readText("app-store-assets/APP_REVIEW_BRIEF.md");

  assert(brief.app?.bundleId === fields.app?.bundleId, "Review brief bundle id matches App Store fields");
  assert(brief.app?.packageVersion === fields.app?.packageVersion, "Review brief package version matches App Store fields");
  assert(brief.appReview?.notes === fields.review?.notes, "Review brief review notes match generated fields");
  assert(brief.appReview?.demoAccount === fields.review?.demoAccount, "Review brief demo account matches generated fields");
  assert(brief.appReview?.notesBytes === byteLength(fields.review?.notes), "Review brief note byte count is accurate");
  assert(brief.appReview?.notesBytes <= 4000, "Review brief notes fit App Review limit");
  assert(
    ["name", "email", "phone"].every((field) => ["missing", "placeholder", "invalid", "ready"].includes(brief.appReview?.contactState?.[field])),
    "Review brief records App Review contact readiness states"
  );
  assert(
    ["supportUrl", "privacyPolicyUrl", "accessibilityUrl", "thirdPartyNoticesUrl"].every((field) =>
      ["missing", "placeholder", "invalid", "ready"].includes(brief.publicLinkState?.[field])
    ),
    "Review brief records public link readiness states"
  );
  assert(Array.isArray(brief.appReview?.testInstructions) && brief.appReview.testInstructions.length >= 5, "Review brief includes test instructions");
  assert(
    brief.appReview?.testInstructions?.some((item) => item.includes("security-scoped bookmark")),
    "Review brief includes sandbox bookmark instructions"
  );
  assert(
    brief.appReview?.testInstructions?.some((item) => item.includes("Third-Party Notices")),
    "Review brief includes Help and third-party notices instructions"
  );
  assert(/does not download|no music download/i.test(JSON.stringify(brief)), "Review brief includes no-download/no-scraping disclosure");
  assert(/no account system/i.test(brief.appReview?.demoAccount ?? ""), "Review brief declares no demo account needed");
  assert(Array.isArray(brief.reviewerChecklist) && brief.reviewerChecklist.length >= 5, "Review brief includes reviewer checklist");
  assert(
    brief.reviewerChecklist.some((item) => item.includes("Reset Local Library")),
    "Review brief checklist includes reset flow"
  );

  const statusCounts = (brief.validations ?? []).reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});

  assert(brief.summary?.validationCount === brief.validations?.length, "Review brief validation count matches validations array");
  assert(brief.summary?.readyCount === (statusCounts.ready ?? 0), "Review brief ready count is accurate");
  assert(brief.summary?.blockerCount === (statusCounts.blocker ?? 0), "Review brief blocker count is accurate");

  (brief.validations ?? []).forEach((item) => {
    assert(["ready", "blocker"].includes(item.status), `Review brief validation ${item.id} has known status`);
    if (item.status === "blocker") {
      warn(`Review brief blocker remains: ${item.label}`);
    }
  });

  assert(
    !JSON.stringify(brief).includes("TODO_PUBLIC_SITE_URL") &&
      !JSON.stringify(brief).includes("TODO_SUPPORT_EMAIL") &&
      !JSON.stringify(brief).includes("TODO_REVIEW_CONTACT_NAME") &&
      !JSON.stringify(brief).includes("TODO_REVIEW_CONTACT_PHONE") &&
      !markdown.includes("TODO_PUBLIC_SITE_URL") &&
      !markdown.includes("TODO_SUPPORT_EMAIL") &&
      !markdown.includes("TODO_REVIEW_CONTACT_NAME") &&
      !markdown.includes("TODO_REVIEW_CONTACT_PHONE"),
    "Review brief excludes raw public/contact placeholder tokens"
  );
  assert(markdown.includes("# Cody Cartridge App Review Brief"), "Review brief markdown includes title");
  assert(markdown.includes("## App Review Notes Copy Block"), "Review brief markdown includes notes copy block");
  assert(markdown.includes("## Test Instructions"), "Review brief markdown includes test instructions");
  assert(markdown.includes("## Reviewer Checklist"), "Review brief markdown includes reviewer checklist");
  assert(markdown.includes("## Validation"), "Review brief markdown includes validation table");

  console.log(`App Review brief checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
