#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_COPY_MAP.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_COPY_MAP.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readJsonIfExists(relativePath, fallback = null) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function charLength(value) {
  return String(value ?? "").length;
}

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com/i.test(String(value ?? ""));
}

function isEmpty(value) {
  return Array.isArray(value) ? value.length === 0 : String(value ?? "").trim().length === 0;
}

function valueState(value) {
  const text = formatValue(value);

  if (isEmpty(value)) {
    return "missing";
  }

  if (isPlaceholder(text)) {
    return "placeholder";
  }

  return "ready";
}

function displayLabel(label) {
  return String(label ?? "value")
    .replace(/[^a-z0-9]+(.)/gi, (_, character) => character.toUpperCase())
    .replace(/^[A-Z]/, (character) => character.toLowerCase());
}

function displayValue(label, value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => displayValue(`${displayLabel(label)}${index + 1}`, item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayValue(key, item)]));
  }

  const text = String(value ?? "");

  return isPlaceholder(text) ? `${displayLabel(label)}=${valueState(text)}` : text;
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.every((item) => item === null || ["string", "number", "boolean", "undefined"].includes(typeof item))
      ? value.join("\n")
      : JSON.stringify(value, null, 2);
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value ?? "");
}

function preview(value) {
  const text = formatValue(value).replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function statusFor({ required, value, max, unit }) {
  const text = formatValue(value);
  const measured = unit === "bytes" ? byteLength(text) : charLength(text);

  if (required && isEmpty(value)) {
    return "blocker";
  }

  if (required && isPlaceholder(text)) {
    return "blocker";
  }

  if (max && measured > max) {
    return "blocker";
  }

  if (!required && isPlaceholder(text)) {
    return "warning";
  }

  return "ready";
}

function addField(fields, config) {
  const value = config.value;
  const text = formatValue(value);
  const displayedValue = displayValue(config.field, value);
  const unit = config.unit ?? "characters";
  const measured = unit === "bytes" ? byteLength(text) : charLength(text);
  const status = statusFor({ ...config, unit });

  fields.push({
    screen: config.screen,
    section: config.section,
    field: config.field,
    required: Boolean(config.required),
    status,
    placeholder: isPlaceholder(text),
    valueState: valueState(value),
    limit: config.max ? { max: config.max, unit, used: measured } : null,
    value: displayedValue,
    valuePreview: preview(displayedValue),
    source: config.source
  });
}

function buildFields(fields) {
  const rows = [];

  addField(rows, {
    field: "Name",
    max: 30,
    required: true,
    screen: "Product Page",
    section: "App Information",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.name",
    value: fields.productPage?.name
  });
  addField(rows, {
    field: "Subtitle",
    max: 30,
    required: true,
    screen: "Product Page",
    section: "Product Page Metadata",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.subtitle",
    value: fields.productPage?.subtitle
  });
  addField(rows, {
    field: "Promotional Text",
    max: 170,
    required: true,
    screen: "Product Page",
    section: "Product Page Metadata",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.promotionalText",
    value: fields.productPage?.promotionalText
  });
  addField(rows, {
    field: "Description",
    max: 4000,
    required: true,
    screen: "Product Page",
    section: "Product Page Metadata",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.description",
    value: fields.productPage?.description
  });
  addField(rows, {
    field: "Keywords",
    max: 100,
    required: true,
    screen: "Product Page",
    section: "Product Page Metadata",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.keywords",
    unit: "bytes",
    value: fields.productPage?.keywords
  });
  addField(rows, {
    field: "Category",
    required: true,
    screen: "Product Page",
    section: "App Information",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.category",
    value: fields.productPage?.category
  });
  addField(rows, {
    field: "Support URL",
    required: true,
    screen: "Product Page",
    section: "URLs",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.supportUrl",
    value: fields.productPage?.supportUrl
  });
  addField(rows, {
    field: "Privacy Policy URL",
    required: true,
    screen: "Product Page",
    section: "URLs",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.privacyPolicyUrl",
    value: fields.productPage?.privacyPolicyUrl
  });
  addField(rows, {
    field: "Marketing URL",
    required: false,
    screen: "Product Page",
    section: "URLs",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.marketingUrl",
    value: fields.productPage?.marketingUrl
  });
  addField(rows, {
    field: "Copyright",
    required: true,
    screen: "Product Page",
    section: "App Information",
    source: "APP_STORE_CONNECT_FIELDS.json productPage.copyright",
    value: fields.productPage?.copyright
  });

  addField(rows, {
    field: "App Review Contact",
    required: true,
    screen: "App Review",
    section: "Contact Information",
    source: "APP_STORE_CONNECT_FIELDS.json review.contact",
    value: fields.review?.contact
  });
  addField(rows, {
    field: "Demo Account",
    required: true,
    screen: "App Review",
    section: "Sign-In Information",
    source: "APP_STORE_CONNECT_FIELDS.json review.demoAccount",
    value: fields.review?.demoAccount
  });
  addField(rows, {
    field: "Review Notes",
    max: 4000,
    required: true,
    screen: "App Review",
    section: "Review Notes",
    source: "APP_STORE_CONNECT_FIELDS.json review.notes",
    value: fields.review?.notes
  });
  addField(rows, {
    field: "Review Test Instructions",
    required: true,
    screen: "App Review",
    section: "Review Notes",
    source: "APP_STORE_CONNECT_FIELDS.json review.testInstructions",
    value: fields.review?.testInstructions
  });

  addField(rows, {
    field: "Beta App Description",
    max: 4000,
    required: true,
    screen: "TestFlight",
    section: "Test Information",
    source: "APP_STORE_CONNECT_FIELDS.json testFlight.betaAppDescription",
    value: fields.testFlight?.betaAppDescription
  });
  addField(rows, {
    field: "What To Test",
    required: true,
    screen: "TestFlight",
    section: "Build Test Details",
    source: "APP_STORE_CONNECT_FIELDS.json testFlight.whatToTest",
    value: fields.testFlight?.whatToTest
  });
  addField(rows, {
    field: "Internal Group Guidance",
    required: false,
    screen: "TestFlight",
    section: "Internal Testing",
    source: "APP_STORE_CONNECT_FIELDS.json testFlight.recommendedGroups",
    value: fields.testFlight?.recommendedGroups
  });

  addField(rows, {
    field: "App Privacy Answers",
    required: true,
    screen: "App Privacy",
    section: "Privacy Questionnaire",
    source: "APP_STORE_CONNECT_FIELDS.json privacy",
    value: fields.privacy
  });
  addField(rows, {
    field: "Accessibility Labels",
    required: false,
    screen: "App Accessibility",
    section: "Accessibility Nutrition Labels",
    source: "APP_STORE_CONNECT_FIELDS.json accessibility",
    value: fields.accessibility
  });
  addField(rows, {
    field: "Age Rating Notes",
    required: true,
    screen: "App Information",
    section: "Age Ratings",
    source: "APP_STORE_CONNECT_FIELDS.json ageRating",
    value: fields.ageRating
  });
  addField(rows, {
    field: "Pricing And Availability",
    required: true,
    screen: "Pricing And Availability",
    section: "Availability",
    source: "APP_STORE_CONNECT_FIELDS.json distribution",
    value: fields.distribution
  });
  addField(rows, {
    field: "Rights And Compliance",
    required: true,
    screen: "Business / Compliance",
    section: "Rights, Export Compliance, DSA",
    source: "APP_STORE_CONNECT_FIELDS.json rightsAndCompliance",
    value: fields.rightsAndCompliance
  });
  addField(rows, {
    field: "Export Compliance",
    required: true,
    screen: "Business / Compliance",
    section: "App Encryption Documentation",
    source: "APP_STORE_CONNECT_FIELDS.json exportCompliance",
    value: fields.exportCompliance
  });
  addField(rows, {
    field: "Upload And Build Selection",
    required: true,
    screen: "App Version",
    section: "Build",
    source: "APP_STORE_CONNECT_FIELDS.json submission",
    value: fields.submission
  });
  addField(rows, {
    field: "Screenshot Inventory",
    required: true,
    screen: "Product Page",
    section: "Screenshots",
    source: "APP_STORE_CONNECT_FIELDS.json screenshots",
    value: fields.screenshots
  });

  return rows;
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function table(fields) {
  return [
    "| Screen | Field | Required | Status | Limit | Source | Preview |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...fields.map((item) => {
      const limit = item.limit ? `${item.limit.used}/${item.limit.max} ${item.limit.unit}` : "-";
      return `| ${escapeCell(item.screen)} | ${escapeCell(item.field)} | ${item.required ? "Yes" : "No"} | ${item.status} | ${limit} | \`${escapeCell(
        item.source
      )}\` | ${escapeCell(item.valuePreview)} |`;
    })
  ].join("\n");
}

function copyBlocks(fields) {
  return fields
    .map((item) => {
      const value = formatValue(item.value).trim();
      return `### ${item.screen} / ${item.field}\n\n- Status: ${item.status}\n- Required: ${item.required ? "yes" : "no"}\n- Source: \`${item.source}\`\n\n\`\`\`text\n${value}\n\`\`\``;
    })
    .join("\n\n");
}

function statusRank(status) {
  return { ready: 0, warning: 1, blocker: 2 }[status] ?? 2;
}

function worstStatus(items) {
  return items.reduce((status, item) => (statusRank(item.status) > statusRank(status) ? item.status : status), "ready");
}

function fieldReference(fields, screen, field) {
  const item = fields.find((candidate) => candidate.screen === screen && candidate.field === field);
  return item
    ? {
        screen: item.screen,
        field: item.field,
        section: item.section,
        status: item.status,
        required: item.required,
        source: item.source,
        valuePreview: item.valuePreview
      }
    : {
        screen,
        field,
        status: "blocker",
        required: true,
        source: "missing field reference",
        valuePreview: ""
      };
}

function externalCheck(id, label, status, command, action, evidence) {
  return { id, label, status, command, action, evidence };
}

function buildSubmissionWorkflow(copyFields, sources) {
  const publicInputsReady = Boolean(sources.publicInputs?.summary?.readyForPublicInputs);
  const uploadReady = Boolean(sources.uploadPacket?.summary?.masSubmissionReady);
  const uploadStatus = sources.uploadPacket?.summary?.status ?? "blocked";
  const reviewBriefBlockers = sources.reviewBrief?.summary?.blockerCount ?? 0;
  const screenshotCount = sources.screenshots?.screenshotCount ?? 0;
  const screenshotsAccepted = Array.isArray(sources.screenshots?.screenshots) && sources.screenshots.screenshots.every((item) => item.appStoreConnectAccepted === true);
  const blockerCount = sources.releaseBlockers?.summary?.blockerCount ?? sources.releaseBlockers?.blockers?.length ?? 0;
  const publicFieldBlockers = sources.publicInputs?.fields?.filter((item) => item.status === "blocked") ?? [];

  const steps = [
    {
      id: "product-page",
      order: 1,
      screen: "Product Page",
      appStoreConnectLocation: "Apps > Cody Cartridge > macOS App > Product Page",
      intent: "Paste product copy, public URLs, copyright, category, and screenshots.",
      fields: [
        fieldReference(copyFields, "Product Page", "Name"),
        fieldReference(copyFields, "Product Page", "Subtitle"),
        fieldReference(copyFields, "Product Page", "Promotional Text"),
        fieldReference(copyFields, "Product Page", "Description"),
        fieldReference(copyFields, "Product Page", "Keywords"),
        fieldReference(copyFields, "Product Page", "Category"),
        fieldReference(copyFields, "Product Page", "Support URL"),
        fieldReference(copyFields, "Product Page", "Privacy Policy URL"),
        fieldReference(copyFields, "Product Page", "Marketing URL"),
        fieldReference(copyFields, "Product Page", "Copyright"),
        fieldReference(copyFields, "Product Page", "Screenshot Inventory")
      ],
      externalChecks: [
        externalCheck(
          "public-inputs",
          "Public support/privacy URLs are real",
          publicInputsReady ? "ready" : "blocker",
          "npm run public-release:store:published:node",
          publicInputsReady ? "Use the generated public URLs from the copy blocks." : "Set CODY_SITE_URL and CODY_SUPPORT_EMAIL, publish the static site, then regenerate the packet.",
          `${sources.publicInputs?.summary?.readyCount ?? 0}/${sources.publicInputs?.summary?.requiredCount ?? 5} public release value(s) ready`
        ),
        externalCheck(
          "screenshots",
          "macOS screenshots are accepted by App Store Connect dimensions",
          screenshotCount > 0 && screenshotsAccepted ? "ready" : "blocker",
          "npm run screenshots:store",
          "Regenerate screenshots if any image is missing or rejected.",
          `${screenshotCount} screenshot(s) recorded`
        )
      ],
      commands: ["npm run copy-map:store", "npm run screenshots:store"]
    },
    {
      id: "privacy-accessibility",
      order: 2,
      screen: "Privacy And Accessibility",
      appStoreConnectLocation: "App Privacy and App Accessibility",
      intent: "Answer App Privacy, tracking, accessibility, and support-document fields from generated local-first disclosures.",
      fields: [
        fieldReference(copyFields, "App Privacy", "App Privacy Answers"),
        fieldReference(copyFields, "App Accessibility", "Accessibility Labels")
      ],
      externalChecks: [
        externalCheck("privacy-artifact", "Privacy manifest and generated privacy copy are current", "ready", "npm run check:app-privacy", "Use the no-collection/no-tracking answers in the copy blocks.", "No data collection is declared.")
      ],
      commands: ["npm run check:app-privacy", "npm run copy-map:store"]
    },
    {
      id: "pricing-info-compliance",
      order: 3,
      screen: "App Information, Pricing, Compliance",
      appStoreConnectLocation: "General > App Information, Pricing and Availability, Business",
      intent: "Set rating, pricing, availability, rights, export compliance, and DSA/compliance notes.",
      fields: [
        fieldReference(copyFields, "App Information", "Age Rating Notes"),
        fieldReference(copyFields, "Pricing And Availability", "Pricing And Availability"),
        fieldReference(copyFields, "Business / Compliance", "Rights And Compliance"),
        fieldReference(copyFields, "Business / Compliance", "Export Compliance")
      ],
      externalChecks: [
        externalCheck("export-compliance", "Export compliance artifact is generated", "ready", "npm run export-compliance:store", "Use the generated export compliance notes.", "Standard local playback app, no proprietary encryption feature.")
      ],
      commands: ["npm run export-compliance:store", "npm run copy-map:store"]
    },
    {
      id: "testflight",
      order: 4,
      screen: "TestFlight",
      appStoreConnectLocation: "TestFlight > Test Information and Internal Testing",
      intent: "Prepare internal testing text and smoke-test guidance before selecting the processed build.",
      fields: [
        fieldReference(copyFields, "TestFlight", "Beta App Description"),
        fieldReference(copyFields, "TestFlight", "What To Test"),
        fieldReference(copyFields, "TestFlight", "Internal Group Guidance")
      ],
      externalChecks: [
        externalCheck("clean-profile", "Clean-profile smoke flow exists", "ready", "npm run smoke:clean-profile", "Use the TestFlight text after a signed build is uploaded.", "Local smoke command is wired into release:store:local.")
      ],
      commands: ["npm run smoke:clean-profile", "npm run copy-map:store"]
    },
    {
      id: "build-upload",
      order: 5,
      screen: "Build Upload",
      appStoreConnectLocation: "TestFlight or App Version > Build",
      intent: "Upload the signed current-version MAS installer package, wait for processing, and select that build.",
      fields: [fieldReference(copyFields, "App Version", "Upload And Build Selection")],
      externalChecks: [
        externalCheck(
          "mas-upload-package",
          "Signed current-version MAS package is ready",
          uploadReady ? "ready" : "blocker",
          "npm run upload-packet:store",
          uploadReady ? "Upload the selected package recorded in UPLOAD_COMMAND_PACKET." : "Run strict signing/package/upload credential gates on the release machine before selecting a build.",
          `Upload packet status: ${uploadStatus}`
        )
      ],
      commands: ["npm run check:mas-package -- --strict", "npm run upload-packet:store", "npm run check:upload-credentials -- --strict"]
    },
    {
      id: "app-review",
      order: 6,
      screen: "App Review",
      appStoreConnectLocation: "App Review Information and app version Review Notes",
      intent: "Paste review contact, demo-account declaration, reviewer notes, and local-file test instructions.",
      fields: [
        fieldReference(copyFields, "App Review", "App Review Contact"),
        fieldReference(copyFields, "App Review", "Demo Account"),
        fieldReference(copyFields, "App Review", "Review Notes"),
        fieldReference(copyFields, "App Review", "Review Test Instructions")
      ],
      externalChecks: [
        externalCheck(
          "review-brief",
          "App Review brief has no contact/public-link blockers",
          reviewBriefBlockers === 0 ? "ready" : "blocker",
          "npm run review-brief:store",
          reviewBriefBlockers === 0 ? "Paste the generated review notes and contact fields." : "Set real App Review contact and public URLs before submission.",
          `${reviewBriefBlockers} App Review blocker(s)`
        )
      ],
      commands: ["npm run review-brief:store", "npm run copy-map:store"]
    },
    {
      id: "submit-review",
      order: 7,
      screen: "Submit For Review",
      appStoreConnectLocation: "App Version > Add for Review > Submit for Review",
      intent: "Submit only after public site, signing, upload, metadata, and release evidence gates are clean.",
      fields: [],
      externalChecks: [
        externalCheck(
          "release-blockers",
          "Release blocker report is empty",
          blockerCount === 0 ? "ready" : "blocker",
          "npm run release:store:preflight:node",
          blockerCount === 0 ? "Submit the prepared draft for review." : "Resolve every blocker before clicking Submit for Review.",
          `${blockerCount} release blocker(s)`
        )
      ],
      commands: ["npm run release:store:preflight:node"]
    }
  ].map((step) => {
    const status = worstStatus([...(step.fields ?? []), ...(step.externalChecks ?? [])]);
    const blockerReasons = [
      ...(step.fields ?? []).filter((item) => item.status === "blocker").map((item) => `${item.screen} / ${item.field}`),
      ...(step.externalChecks ?? []).filter((item) => item.status === "blocker").map((item) => item.label)
    ];
    const warningReasons = [
      ...(step.fields ?? []).filter((item) => item.status === "warning").map((item) => `${item.screen} / ${item.field}`),
      ...(step.externalChecks ?? []).filter((item) => item.status === "warning").map((item) => item.label)
    ];

    return {
      ...step,
      status,
      blockerReasons,
      warningReasons,
      nextAction: blockerReasons.length > 0 ? `Resolve: ${blockerReasons.join("; ")}` : "Paste the mapped values, save the screen, and continue."
    };
  });

  const stepStatusCounts = steps.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    summary: {
      stepCount: steps.length,
      readyStepCount: stepStatusCounts.ready ?? 0,
      warningStepCount: stepStatusCounts.warning ?? 0,
      blockerStepCount: stepStatusCounts.blocker ?? 0,
      publicInputBlockerCount: publicFieldBlockers.length,
      releaseBlockerCount: blockerCount,
      uploadReady
    },
    sourceArtifacts: [
      "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
      "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json",
      "app-store-assets/APP_REVIEW_BRIEF.json",
      "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
      "app-store-assets/UPLOAD_COMMAND_PACKET.json",
      "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
      "app-store-assets/RELEASE_BLOCKERS.json"
    ],
    steps
  };
}

function workflowTable(workflow) {
  return [
    "| # | Screen | Status | App Store Connect Location | What To Do Next |",
    "| ---: | --- | --- | --- | --- |",
    ...workflow.steps.map((step) => `| ${step.order} | ${escapeCell(step.screen)} | ${step.status} | ${escapeCell(step.appStoreConnectLocation)} | ${escapeCell(step.nextAction)} |`)
  ].join("\n");
}

function workflowDetails(workflow) {
  return workflow.steps
    .map((step) => {
      const fields = step.fields.length
        ? step.fields.map((item) => `- ${item.screen} / ${item.field}: ${item.status} (${item.source})`).join("\n")
        : "- No direct copy fields; this is a release gate.";
      const externalChecks = step.externalChecks.length
        ? step.externalChecks.map((item) => `- ${item.label}: ${item.status} | ${item.evidence} | ${item.command}`).join("\n")
        : "- None";
      const commands = step.commands.map((command) => `- \`${command}\``).join("\n");

      return `### ${step.order}. ${step.screen}

- Status: ${step.status}
- Location: ${step.appStoreConnectLocation}
- Intent: ${step.intent}
- Next action: ${step.nextAction}

Fields:
${fields}

External checks:
${externalChecks}

Commands:
${commands}`;
    })
    .join("\n\n");
}

function main() {
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const copyFields = buildFields(fields);
  const workflow = buildSubmissionWorkflow(copyFields, {
    publicInputs: readJsonIfExists("app-store-assets/PUBLIC_RELEASE_INPUTS.json", {}),
    uploadPacket: readJsonIfExists("app-store-assets/UPLOAD_COMMAND_PACKET.json", {}),
    reviewBrief: readJsonIfExists("app-store-assets/APP_REVIEW_BRIEF.json", {}),
    screenshots: readJsonIfExists("app-store-assets/screenshots/STORE_SCREENSHOTS.json", {}),
    releaseBlockers: readJsonIfExists("app-store-assets/RELEASE_BLOCKERS.json", {})
  });
  const statusCounts = copyFields.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const copyMap = {
    generatedAt: new Date().toISOString(),
    app: fields.app,
    summary: {
      fieldCount: copyFields.length,
      readyCount: statusCounts.ready ?? 0,
      warningCount: statusCounts.warning ?? 0,
      blockerCount: statusCounts.blocker ?? 0,
      workflowStepCount: workflow.summary.stepCount,
      workflowReadyStepCount: workflow.summary.readyStepCount,
      workflowWarningStepCount: workflow.summary.warningStepCount,
      workflowBlockerStepCount: workflow.summary.blockerStepCount
    },
    fields: copyFields,
    workflow
  };
  const markdown = `# Cody Cartridge App Store Connect Copy Map

Generated by \`npm run copy-map:store\`.

Use this as the screen-by-screen source of truth while filling App Store Connect. The JSON companion file is \`app-store-assets/APP_STORE_CONNECT_COPY_MAP.json\`.

## Summary

- Fields: ${copyMap.summary.fieldCount}
- Ready: ${copyMap.summary.readyCount}
- Warnings: ${copyMap.summary.warningCount}
- Blockers: ${copyMap.summary.blockerCount}
- Workflow steps: ${copyMap.summary.workflowStepCount}
- Workflow blockers: ${copyMap.summary.workflowBlockerStepCount}

## Submission Workflow

${workflowTable(workflow)}

## Submission Workflow Details

${workflowDetails(workflow)}

## Field Map

${table(copyFields)}

## Copy Blocks

${copyBlocks(copyFields)}
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(copyMap, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (copyMap.summary.blockerCount > 0) {
    console.warn(`Copy map records ${copyMap.summary.blockerCount} blocker field(s).`);
  }
}

main();
