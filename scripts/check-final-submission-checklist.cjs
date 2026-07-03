#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "FINAL_SUBMISSION_CHECKLIST.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "FINAL_SUBMISSION_CHECKLIST.md");
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

function sectionById(checklist, id) {
  return (checklist.sections ?? []).find((section) => section.id === id);
}

function itemExists(checklist, id) {
  return (checklist.sections ?? []).some((section) => section.items?.some((item) => item.id === id));
}

function itemById(checklist, id) {
  return (checklist.sections ?? [])
    .flatMap((section) => section.items ?? [])
    .find((item) => item.id === id);
}

function main() {
  assert(exists(jsonPath), "Final submission checklist JSON exists");
  assert(exists(markdownPath), "Final submission checklist markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    console.log(`Final submission checklist checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const pkg = readJson("package.json");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const copyMap = readJson("app-store-assets/APP_STORE_CONNECT_COPY_MAP.json");
  const reviewBrief = readJson("app-store-assets/APP_REVIEW_BRIEF.json");
  const appCompliance = readJson("app-store-assets/APP_STORE_COMPLIANCE.json");
  const contentRights = readJson("app-store-assets/APP_CONTENT_RIGHTS.json");
  const publishPacket = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json");
  const releaseBlockers = readJson("app-store-assets/RELEASE_BLOCKERS.json");
  const signingAssetReport = readJson("app-store-assets/SIGNING_ASSET_REPORT.json");
  const appleReleaseAssets = readJson("app-store-assets/APPLE_RELEASE_ASSETS.json");
  const checklist = readJson("app-store-assets/FINAL_SUBMISSION_CHECKLIST.json");
  const markdown = readText("app-store-assets/FINAL_SUBMISSION_CHECKLIST.md");
  const expectedItemCount = (checklist.sections ?? []).reduce((total, section) => total + (section.items?.length ?? 0), 0);
  const expectedBlockerCount = (checklist.sections ?? []).reduce(
    (total, section) => total + (section.items ?? []).filter((item) => item.status === "blocked").length,
    0
  );

  assert(checklist.app?.bundleId === (fields.app?.bundleId ?? pkg.build?.appId), "Final submission checklist bundle id matches generated fields");
  assert(checklist.app?.version === (fields.app?.packageVersion ?? pkg.version), "Final submission checklist version matches generated fields");
  assert(checklist.app?.buildVersion === (fields.app?.buildVersion ?? pkg.build?.buildVersion ?? pkg.version), "Final submission checklist build version matches generated fields");
  assert(checklist.summary?.sectionCount === checklist.sections?.length, "Final submission checklist section count is accurate");
  assert(checklist.summary?.itemCount === expectedItemCount, "Final submission checklist item count is accurate");
  assert(checklist.summary?.blockerCount === expectedBlockerCount, "Final submission checklist blocker count is accurate");
  assert(checklist.summary?.readyForAddForReview === (expectedBlockerCount === 0), "Final submission checklist readiness flag matches blockers");

  [
    "preflight",
    "product-page",
    "screenshots",
    "privacy-and-compliance",
    "testflight",
    "build-upload",
    "app-review",
    "submit-for-review"
  ].forEach((id) => {
    assert(Boolean(sectionById(checklist, id)), `Final submission checklist includes ${id} section`);
  });

  [
    "strict-verifier-clean",
    "public-inputs-ready",
    "public-site-publish-packet",
    "public-host-runbook",
    "public-release-sync",
    "support-url-ready",
    "privacy-url-ready",
    "published-site-ready",
    "screenshots-present",
    "screenshots-apple-mac-spec",
    "privacy-no-collection",
    "app-compliance-packet",
    "age-rating-draft",
    "pricing-draft",
    "export-compliance-draft",
    "rights-dsa-draft",
    "content-rights-audit",
    "what-to-test",
    "signing-asset-report-current",
    "apple-release-assets",
    "upload-command-packet-current",
    "mas-signing-assets",
    "mas-package-verified",
    "upload-tooling",
    "upload-credentials",
    "processed-build-match",
    "review-contact",
    "review-brief-clear",
    "copy-map-clear",
    "blocker-report-clean",
    "post-submit-monitoring"
  ].forEach((id) => {
    assert(itemExists(checklist, id), `Final submission checklist includes ${id} check`);
  });

  assert(
      checklist.sourceArtifacts?.includes("app-store-assets/APP_STORE_CONNECT_FIELDS.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/APP_STORE_COMPLIANCE.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/APP_STORE_COMPLIANCE.md") &&
      checklist.sourceArtifacts?.includes("app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md") &&
      checklist.sourceArtifacts?.includes("app-store-assets/APP_CONTENT_RIGHTS.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/APP_CONTENT_RIGHTS.md") &&
      checklist.sourceArtifacts?.includes("app-store-assets/EXPORT_COMPLIANCE.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/PUBLIC_RELEASE_INPUTS.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/PUBLIC_HOST_RUNBOOK.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/SIGNING_ASSET_REPORT.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/APPLE_RELEASE_ASSETS.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/UPLOAD_COMMAND_PACKET.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/RELEASE_BLOCKERS.json") &&
      checklist.sourceArtifacts?.includes("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json") &&
      checklist.sourceArtifacts?.includes("scripts/install-asc-key.cjs") &&
      checklist.sourceArtifacts?.includes("scripts/check-upload-credentials.cjs"),
    "Final submission checklist records source artifacts"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "app-compliance-packet" &&
          item.evidence.includes(String(appCompliance.summary?.blockerCount ?? "missing")) &&
          item.evidence.includes(String(appCompliance.summary?.manualCount ?? "missing"))
      )
    ),
    "Final submission checklist reflects App Store compliance packet state"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "content-rights-audit" &&
          item.evidence.includes(String(contentRights.summary?.passedCount ?? "missing")) &&
          item.evidence.includes(String(contentRights.summary?.failedCount ?? "missing"))
      )
    ),
    "Final submission checklist reflects content-rights audit state"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "public-site-publish-packet" &&
          item.evidence.includes(String(publishPacket.summary?.readyPageCount ?? "missing")) &&
          item.evidence.includes(String(publishPacket.summary?.requiredPageCount ?? "missing"))
      )
    ),
    "Final submission checklist reflects public site publish packet state"
  );
  const publicHostRunbook = readJson("app-store-assets/PUBLIC_HOST_RUNBOOK.json");
  assert(
    checklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "public-host-runbook" &&
          item.evidence.includes(String(publicHostRunbook.summary?.hostedFileCount ?? "missing"))
      )
    ),
    "Final submission checklist reflects public host runbook state"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "apple-release-assets" &&
          item.evidence.includes(String(appleReleaseAssets.summary?.blockerCount ?? "missing")) &&
          item.evidence.includes(String(appleReleaseAssets.summary?.manualCount ?? "missing"))
      )
    ),
    "Final submission checklist reflects Apple release asset request state"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "copy-map-clear" &&
          item.evidence.includes(String(copyMap.summary?.blockerCount ?? 0)) &&
          item.evidence.includes(String(copyMap.workflow?.summary?.blockerStepCount ?? 0))
      )
    ),
    "Final submission checklist reflects copy-map field and workflow blocker counts"
  );
  assert(
    checklist.sections?.some((section) => section.items?.some((item) => item.id === "review-brief-clear" && item.evidence.includes(String(reviewBrief.summary?.blockerCount ?? 0)))),
    "Final submission checklist reflects App Review brief blocker count"
  );
  assert(
    checklist.sections?.some((section) => section.items?.some((item) => item.id === "blocker-report-clean" && item.evidence.includes(String(releaseBlockers.summary?.blockerCount ?? 0)))),
    "Final submission checklist reflects release blocker count"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some((item) => item.id === "public-release-sync" && /sync|gate|strict/i.test(`${item.label} ${item.evidence} ${item.action}`))
    ),
    "Final submission checklist reflects public release sync gate"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some((item) => item.id === "mas-signing-assets" && /MAS signing|check:mas-signing|strict/i.test(`${item.label} ${item.evidence} ${item.action}`))
    ),
    "Final submission checklist reflects strict MAS signing gate"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "signing-asset-report-current" &&
          item.evidence.includes(String(signingAssetReport.summary?.blockerCount ?? "missing"))
      )
    ),
    "Final submission checklist reflects signing asset report state"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some((item) => item.id === "mas-package-verified" && /MAS package|check:mas-package|strict/i.test(`${item.label} ${item.evidence} ${item.action}`))
    ),
    "Final submission checklist reflects strict signed MAS package gate"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some((item) => item.id === "upload-tooling" && /MAS package|check:upload-tooling|strict/i.test(`${item.label} ${item.evidence} ${item.action}`))
    ),
    "Final submission checklist reflects strict upload tooling and package gate"
  );
  assert(
    checklist.sections?.some((section) =>
      section.items?.some(
        (item) =>
          item.id === "upload-credentials" &&
          /credentials|check:upload-credentials|install:asc-key|strict/i.test(`${item.label} ${item.evidence} ${item.action}`)
      )
    ),
    "Final submission checklist reflects strict upload credential gate"
  );
  assert(
    itemById(checklist, "support-url-ready")?.evidence === "supportUrl=placeholder" ||
      itemById(checklist, "support-url-ready")?.evidence === "supportUrl=ready",
    "Final submission checklist redacts Support URL evidence"
  );
  assert(
    itemById(checklist, "privacy-url-ready")?.evidence === "privacyPolicyUrl=placeholder" ||
      itemById(checklist, "privacy-url-ready")?.evidence === "privacyPolicyUrl=ready",
    "Final submission checklist redacts Privacy Policy URL evidence"
  );
  assert(
    /supportEmail=(?:missing|placeholder|invalid|ready)/.test(String(itemById(checklist, "feedback-email")?.evidence ?? "")),
    "Final submission checklist classifies TestFlight feedback email evidence"
  );
  assert(
    /reviewName=(?:missing|placeholder|invalid|ready)/.test(String(itemById(checklist, "review-contact")?.evidence ?? "")) &&
      /reviewEmail=(?:missing|placeholder|invalid|ready)/.test(String(itemById(checklist, "review-contact")?.evidence ?? "")) &&
      /reviewPhone=(?:missing|placeholder|invalid|ready)/.test(String(itemById(checklist, "review-contact")?.evidence ?? "")),
    "Final submission checklist classifies App Review contact evidence"
  );
  assert(
    !JSON.stringify(checklist).includes("TODO_PUBLIC_SITE_URL") &&
      !JSON.stringify(checklist).includes("TODO_SUPPORT_EMAIL") &&
      !JSON.stringify(checklist).includes("TODO_REVIEW_CONTACT_NAME") &&
      !JSON.stringify(checklist).includes("TODO_REVIEW_CONTACT_PHONE") &&
      !markdown.includes("TODO_PUBLIC_SITE_URL") &&
      !markdown.includes("TODO_SUPPORT_EMAIL") &&
      !markdown.includes("TODO_REVIEW_CONTACT_NAME") &&
      !markdown.includes("TODO_REVIEW_CONTACT_PHONE"),
    "Final submission checklist excludes raw public/contact placeholder tokens"
  );
  assert(
    itemById(checklist, "post-submit-monitoring")?.status === "ready" &&
      /[1-9]\d* item\(s\)/.test(String(itemById(checklist, "post-submit-monitoring")?.evidence ?? "")),
    "Final submission checklist marks post-submission monitoring guidance ready"
  );
  assert(markdown.includes("# Cody Cartridge Final Submission Checklist"), "Final submission checklist markdown includes title");
  assert(markdown.includes("## Checklist"), "Final submission checklist markdown includes checklist table");
  assert(markdown.includes("Ready for Add for Review"), "Final submission checklist markdown includes readiness summary");
  assert(markdown.includes("App Store Connect"), "Final submission checklist markdown names App Store Connect");

  if ((checklist.summary?.blockerCount ?? 0) > 0) {
    warn(`Final submission checklist records ${checklist.summary.blockerCount} blocker(s)`);
  }

  console.log(`Final submission checklist checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
