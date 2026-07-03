#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const jsonPath = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_COPY_MAP.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_COPY_MAP.md");
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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com/i.test(String(value ?? ""));
}

function assert(condition, message) {
  if (condition) {
    pass(message);
  } else {
    fail(message);
  }
}

function fieldByName(copyMap, screen, field) {
  return copyMap.fields?.find((item) => item.screen === screen && item.field === field);
}

function workflowStep(copyMap, id) {
  return copyMap.workflow?.steps?.find((item) => item.id === id);
}

function main() {
  assert(exists(jsonPath), "App Store Connect copy map JSON exists");
  assert(exists(markdownPath), "App Store Connect copy map markdown exists");

  if (!exists(jsonPath) || !exists(markdownPath)) {
    console.log(`App Store Connect copy-map checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
    return;
  }

  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const copyMap = readJson("app-store-assets/APP_STORE_CONNECT_COPY_MAP.json");
  const markdown = readText("app-store-assets/APP_STORE_CONNECT_COPY_MAP.md");

  assert(copyMap.app?.bundleId === fields.app?.bundleId, "Copy map bundle id matches App Store fields");
  assert(copyMap.app?.packageVersion === fields.app?.packageVersion, "Copy map package version matches App Store fields");
  assert(Array.isArray(copyMap.fields) && copyMap.fields.length >= 20, "Copy map includes broad App Store Connect field coverage");

  const requiredFields = [
    ["Product Page", "Name"],
    ["Product Page", "Subtitle"],
    ["Product Page", "Promotional Text"],
    ["Product Page", "Description"],
    ["Product Page", "Keywords"],
    ["Product Page", "Support URL"],
    ["Product Page", "Privacy Policy URL"],
    ["App Review", "App Review Contact"],
    ["App Review", "Review Notes"],
    ["TestFlight", "What To Test"],
    ["App Privacy", "App Privacy Answers"],
    ["App Information", "Age Rating Notes"],
    ["Pricing And Availability", "Pricing And Availability"],
    ["Business / Compliance", "Rights And Compliance"],
    ["Business / Compliance", "Export Compliance"],
    ["App Version", "Upload And Build Selection"]
  ];

  requiredFields.forEach(([screen, field]) => {
    const item = fieldByName(copyMap, screen, field);
    assert(Boolean(item), `Copy map includes ${screen} / ${field}`);
    assert(item?.required === true, `${screen} / ${field} is marked required`);
  });

  copyMap.fields.forEach((item) => {
    assert(["missing", "placeholder", "ready"].includes(item.valueState), `${item.screen} / ${item.field} has known value state`);

    if (item.limit) {
      assert(item.limit.used <= item.limit.max, `${item.screen} / ${item.field} is within ${item.limit.max} ${item.limit.unit}`);
    }

    if (item.required && item.placeholder) {
      warn(`${item.screen} / ${item.field} still has placeholder value`);
    }

    if (item.required && String(item.valuePreview ?? "").trim().length === 0) {
      fail(`${item.screen} / ${item.field} has empty preview`);
    }

    if (item.status === "blocker" && !(item.required && (item.placeholder || String(item.valuePreview ?? "").trim().length === 0))) {
      fail(`${item.screen} / ${item.field} is marked blocker without required placeholder or empty value`);
    }
  });

  const statusCounts = copyMap.fields.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});

  assert(copyMap.summary?.fieldCount === copyMap.fields.length, "Copy map field count matches fields array");
  assert(copyMap.summary?.readyCount === (statusCounts.ready ?? 0), "Copy map ready count is accurate");
  assert(copyMap.summary?.warningCount === (statusCounts.warning ?? 0), "Copy map warning count is accurate");
  assert(copyMap.summary?.blockerCount === (statusCounts.blocker ?? 0), "Copy map blocker count is accurate");

  const workflowStatusCounts = (copyMap.workflow?.steps ?? []).reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});

  assert(copyMap.workflow?.summary?.stepCount === 7, "Copy map workflow includes seven App Store Connect steps");
  assert(copyMap.summary?.workflowStepCount === copyMap.workflow?.summary?.stepCount, "Copy map summary workflow step count matches workflow");
  assert(copyMap.summary?.workflowReadyStepCount === (workflowStatusCounts.ready ?? 0), "Copy map workflow ready count is accurate");
  assert(copyMap.summary?.workflowWarningStepCount === (workflowStatusCounts.warning ?? 0), "Copy map workflow warning count is accurate");
  assert(copyMap.summary?.workflowBlockerStepCount === (workflowStatusCounts.blocker ?? 0), "Copy map workflow blocker count is accurate");

  [
    "product-page",
    "privacy-accessibility",
    "pricing-info-compliance",
    "testflight",
    "build-upload",
    "app-review",
    "submit-review"
  ].forEach((id) => {
    const step = workflowStep(copyMap, id);
    assert(Boolean(step), `Copy map workflow includes ${id}`);
    assert(["ready", "warning", "blocker"].includes(step?.status), `${id} workflow step has known status`);
    assert(String(step?.appStoreConnectLocation ?? "").length > 0, `${id} workflow step records App Store Connect location`);
    assert(Array.isArray(step?.commands) && step.commands.length > 0, `${id} workflow step records verification commands`);
  });

  assert(
    workflowStep(copyMap, "product-page")?.externalChecks?.some((item) => item.id === "screenshots" && item.command === "npm run screenshots:store"),
    "Product page workflow records screenshot generation command"
  );
  assert(
    workflowStep(copyMap, "product-page")?.externalChecks?.some((item) => item.id === "public-inputs"),
    "Product page workflow records public URL/contact gate"
  );
  assert(
    workflowStep(copyMap, "build-upload")?.externalChecks?.some((item) => item.id === "mas-upload-package" && item.command === "npm run upload-packet:store"),
    "Build upload workflow records upload packet gate"
  );
  assert(
    workflowStep(copyMap, "app-review")?.externalChecks?.some((item) => item.id === "review-brief" && item.command === "npm run review-brief:store"),
    "App Review workflow records review brief gate"
  );
  assert(
    workflowStep(copyMap, "submit-review")?.externalChecks?.some((item) => item.id === "release-blockers" && item.command === "npm run release:store:preflight:node"),
    "Submit workflow records strict release preflight gate"
  );
  [
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_REVIEW_BRIEF.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/RELEASE_BLOCKERS.json"
  ].forEach((artifact) => {
    assert(copyMap.workflow?.sourceArtifacts?.includes(artifact), `Copy map workflow records source artifact ${artifact}`);
  });

  assert(markdown.includes("# Cody Cartridge App Store Connect Copy Map"), "Copy map markdown includes title");
  assert(markdown.includes("## Submission Workflow"), "Copy map markdown includes submission workflow");
  assert(markdown.includes("## Submission Workflow Details"), "Copy map markdown includes submission workflow details");
  assert(markdown.includes("Build Upload"), "Copy map markdown includes build upload workflow");
  assert(markdown.includes("Submit For Review"), "Copy map markdown includes submit workflow");
  assert(markdown.includes("## Field Map"), "Copy map markdown includes field map");
  assert(markdown.includes("## Copy Blocks"), "Copy map markdown includes copy blocks");
  assert(markdown.includes("Product Page / Description"), "Copy map markdown includes product page copy block");
  assert(markdown.includes("App Review / Review Notes"), "Copy map markdown includes review notes copy block");
  assert(markdown.includes("TestFlight / What To Test"), "Copy map markdown includes TestFlight copy block");
  assert(
    !JSON.stringify(copyMap).includes("TODO_PUBLIC_SITE_URL") &&
      !JSON.stringify(copyMap).includes("TODO_SUPPORT_EMAIL") &&
      !JSON.stringify(copyMap).includes("TODO_REVIEW_CONTACT_NAME") &&
      !JSON.stringify(copyMap).includes("TODO_REVIEW_CONTACT_PHONE") &&
      !markdown.includes("TODO_PUBLIC_SITE_URL") &&
      !markdown.includes("TODO_SUPPORT_EMAIL") &&
      !markdown.includes("TODO_REVIEW_CONTACT_NAME") &&
      !markdown.includes("TODO_REVIEW_CONTACT_PHONE"),
    "Copy map excludes raw public/contact placeholder tokens"
  );

  if (copyMap.summary?.blockerCount > 0) {
    warn(`Copy map records ${copyMap.summary.blockerCount} blocker field(s)`);
  } else {
    pass("Copy map has no blocker fields");
  }

  if (copyMap.workflow?.summary?.blockerStepCount > 0) {
    warn(`Copy map workflow records ${copyMap.workflow.summary.blockerStepCount} blocker step(s)`);
  } else {
    pass("Copy map workflow has no blocker steps");
  }

  console.log(`App Store Connect copy-map checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
