#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_MANUAL_TASKS.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_MANUAL_TASKS.md");

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function isPlaceholder(value) {
  const text = String(value ?? "").trim();
  return !text || /TODO_|placeholder/i.test(text);
}

function safePublic(value, label) {
  return isPlaceholder(value) ? `${label}=placeholder` : String(value);
}

function safePrivate(value, label) {
  return isPlaceholder(value) ? `${label}=placeholder` : `${label}=configured`;
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function task(id, section, label, status, location, evidence, action, sourceArtifact) {
  return {
    id,
    section,
    label,
    status,
    location,
    evidence,
    action,
    sourceArtifact
  };
}

function section(id, title, tasks) {
  return {
    id,
    title,
    taskCount: tasks.length,
    manualCount: tasks.filter((entry) => entry.status === "manual").length,
    blockedCount: tasks.filter((entry) => entry.status === "blocked").length,
    tasks
  };
}

function tableRows(tasks) {
  return tasks
    .map(
      (entry) =>
        `| ${entry.section} | ${entry.status} | ${entry.label} | ${entry.location} | ${entry.evidence} | ${entry.action} |`
    )
    .join("\n");
}

function bulletList(items) {
  return items.map((entry) => `- ${entry}`).join("\n");
}

function main() {
  const pkg = readJson("package.json");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const compliance = readJson("app-store-assets/APP_STORE_COMPLIANCE.json", { summary: {}, sections: [] });
  const screenshots = readJson("app-store-assets/screenshots/STORE_SCREENSHOTS.json", { screenshots: [] });
  const app = fields.app ?? {};
  const productPage = fields.productPage ?? {};
  const urls = fields.urls ?? {};
  const review = fields.review ?? {};
  const reviewContact = review.contact ?? {};
  const testFlight = fields.testFlight ?? {};
  const distribution = fields.distribution ?? {};
  const rights = fields.rightsAndCompliance ?? {};
  const dsa = rights.digitalServicesAct ?? {};
  const ageRating = fields.ageRating ?? {};
  const privacy = fields.privacy ?? {};
  const screenshotCount = screenshots.summary?.count ?? screenshots.screenshots?.length ?? 0;
  const supportUrlBlocked = isPlaceholder(urls.supportUrl);
  const privacyUrlBlocked = isPlaceholder(urls.privacyPolicyUrl);
  const supportEmailBlocked = isPlaceholder(urls.supportEmail);
  const reviewContactBlocked =
    isPlaceholder(reviewContact.name) || isPlaceholder(reviewContact.email) || isPlaceholder(reviewContact.phone);

  const sections = [
    section("app-record", "App Record", [
      task(
        "app-record-create",
        "App Record",
        "Create or verify the App Store Connect app record",
        app.bundleId && app.sku && app.name ? "manual" : "blocked",
        "My Apps > New App / App Information",
        `name=${app.name ?? "missing"} bundleId=${app.bundleId ?? pkg.build?.appId ?? "missing"} sku=${app.sku ?? "missing"}`,
        "Create the macOS app record or confirm the existing record uses this bundle id, SKU, category, and copyright.",
        "app-store-assets/APP_STORE_CONNECT_FIELDS.json"
      )
    ]),
    section("product-page", "Product Page", [
      task(
        "product-page-copy",
        "Product Page",
        "Enter product page copy",
        productPage.name && productPage.description && productPage.keywords ? "manual" : "blocked",
        "Product Page > App Information / Version Information",
        `name=${byteLength(productPage.name)}/30 subtitle=${byteLength(productPage.subtitle)}/30 keywords=${byteLength(productPage.keywords)}/100 description=${byteLength(productPage.description)}/4000`,
        "Paste name, subtitle, promotional text, description, keywords, category, and copyright from the generated packet.",
        "app-store-assets/APP_STORE_CONNECT_FIELDS.json"
      ),
      task(
        "product-page-screenshots",
        "Product Page",
        "Upload Mac screenshots",
        screenshotCount >= 3 ? "manual" : "blocked",
        "Product Page > Media Manager",
        `${screenshotCount} screenshot(s) in store screenshot manifest`,
        "Upload the generated Mac screenshots in order and re-check the App Store screenshot inventory.",
        "app-store-assets/screenshots/STORE_SCREENSHOTS.json"
      ),
      task(
        "support-url",
        "Product Page",
        "Enter Support URL",
        supportUrlBlocked ? "blocked" : "manual",
        "Product Page > Support URL",
        safePublic(urls.supportUrl, "supportUrl"),
        "Publish the support page, then enter the public HTTPS support URL.",
        "app-store-assets/APP_STORE_CONNECT_FIELDS.json"
      ),
      task(
        "privacy-policy-url",
        "Product Page",
        "Enter Privacy Policy URL",
        privacyUrlBlocked ? "blocked" : "manual",
        "Product Page > Privacy Policy URL",
        safePublic(urls.privacyPolicyUrl, "privacyPolicyUrl"),
        "Publish the privacy page, then enter the public HTTPS privacy policy URL.",
        "app-store-assets/APP_STORE_CONNECT_FIELDS.json"
      )
    ]),
    section("privacy-compliance", "Privacy And Compliance", [
      task(
        "app-privacy",
        "Privacy And Compliance",
        "Complete App Privacy answers",
        privacy.appPrivacyDataCollection ? "manual" : "blocked",
        "App Privacy",
        privacy.appPrivacyDataCollection ?? "missing",
        "Answer App Privacy as no data collected and confirm no tracking, analytics, ads, or developer off-device data collection were added.",
        "app-store-assets/APP_STORE_COMPLIANCE.json"
      ),
      task(
        "age-rating",
        "Privacy And Compliance",
        "Complete age rating questionnaire",
        ageRating.expectedRating ? "manual" : "blocked",
        ageRating.appStoreConnectLocation ?? "General > App Information > Age Ratings",
        `${ageRating.expectedRating ?? "missing"}; ${ageRating.questionnaireNotes?.length ?? 0} questionnaire note(s)`,
        "Answer Apple's questionnaire against the final shipped app behavior.",
        "app-store-assets/APP_STORE_COMPLIANCE.json"
      ),
      task(
        "pricing",
        "Privacy And Compliance",
        "Set price",
        distribution.price ? "manual" : "blocked",
        distribution.pricingAndAvailabilityLocation ?? "Monetization > Pricing and Availability",
        distribution.price ?? "missing",
        "Set the final launch price in App Store Connect.",
        "app-store-assets/APP_STORE_COMPLIANCE.json"
      ),
      task(
        "availability",
        "Privacy And Compliance",
        "Set availability",
        distribution.availability ? "manual" : "blocked",
        distribution.pricingAndAvailabilityLocation ?? "Monetization > Pricing and Availability",
        distribution.availability ?? "missing",
        "Confirm launch countries and regions, especially EU availability if DSA status is incomplete.",
        "app-store-assets/APP_STORE_COMPLIANCE.json"
      ),
      task(
        "release-option",
        "Privacy And Compliance",
        "Select release option",
        distribution.releaseOption ? "manual" : "blocked",
        "App Store version > Version Release",
        distribution.releaseOption ?? "missing",
        "Use manual release for the first submission so the approved build can be checked before launch.",
        "app-store-assets/APP_STORE_COMPLIANCE.json"
      ),
      task(
        "tax-category",
        "Privacy And Compliance",
        "Confirm tax category",
        distribution.taxCategory ? "manual" : "blocked",
        distribution.pricingAndAvailabilityLocation ?? "Monetization > Pricing and Availability",
        distribution.taxCategory ?? "missing",
        "Confirm the final tax category in App Store Connect.",
        "app-store-assets/APP_STORE_COMPLIANCE.json"
      ),
      task(
        "rights-export-dsa",
        "Privacy And Compliance",
        "Complete rights, export compliance, and EU DSA entries",
        rights.contentRights && rights.exportCompliance && dsa.status ? "manual" : "blocked",
        "App Information / Business / Compliance",
        `contentRights=${rights.contentRights ? "prepared" : "missing"} export=${rights.exportCompliance ? "prepared" : "missing"} dsa=${dsa.status ? "manual" : "missing"}`,
        "Copy content-rights/export-compliance answers and complete trader/non-trader status before EU distribution.",
        "app-store-assets/APP_STORE_COMPLIANCE.json"
      )
    ]),
    section("testflight-review", "TestFlight And Review", [
      task(
        "testflight-internal-group",
        "TestFlight And Review",
        "Create internal TestFlight group",
        Array.isArray(testFlight.recommendedGroups) && testFlight.recommendedGroups.length > 0 ? "manual" : "blocked",
        "TestFlight > Internal Testing",
        `${testFlight.recommendedGroups?.length ?? 0} recommended group(s)`,
        "Create the internal smoke group, add the processed build, and paste What To Test.",
        "app-store-assets/APP_STORE_CONNECT_FIELDS.json"
      ),
      task(
        "testflight-feedback-email",
        "TestFlight And Review",
        "Set TestFlight feedback email",
        supportEmailBlocked ? "blocked" : "manual",
        "TestFlight > Test Information",
        safePrivate(testFlight.feedbackEmail ?? urls.supportEmail, "feedbackEmail"),
        "Set the public support inbox as the TestFlight feedback email.",
        "app-store-assets/APP_STORE_CONNECT_FIELDS.json"
      ),
      task(
        "app-review-contact",
        "TestFlight And Review",
        "Set App Review contact",
        reviewContactBlocked ? "blocked" : "manual",
        "App Review Information",
        [
          safePrivate(reviewContact.name, "reviewName"),
          safePrivate(reviewContact.email, "reviewEmail"),
          safePrivate(reviewContact.phone, "reviewPhone")
        ].join(" "),
        "Enter private App Review contact details in App Store Connect.",
        "app-store-assets/APP_STORE_CONNECT_FIELDS.json"
      ),
      task(
        "app-review-notes",
        "TestFlight And Review",
        "Paste App Review notes",
        review.notes ? "manual" : "blocked",
        "App Review Information > Notes",
        `${byteLength(review.notes)}/4000 bytes`,
        "Paste the generated review notes and keep the no-download/no-scraping disclosure intact.",
        "app-store-assets/APP_STORE_CONNECT_FIELDS.json"
      ),
      task(
        "processed-build-selection",
        "TestFlight And Review",
        "Select the processed signed build",
        "blocked",
        "App Store version > Build",
        "requires uploaded, processed, current-version signed MAS build",
        "Upload the signed MAS package, wait for processing, then select the matching build before Add for Review.",
        "app-store-assets/APP_STORE_CONNECT_FIELDS.json"
      )
    ])
  ];
  const tasks = sections.flatMap((entry) => entry.tasks);
  const artifact = {
    generatedAt: new Date().toISOString(),
    app: {
      name: app.name ?? pkg.build?.productName ?? pkg.name,
      bundleId: app.bundleId ?? pkg.build?.appId,
      sku: app.sku,
      version: app.packageVersion ?? pkg.version,
      buildVersion: app.buildVersion ?? pkg.build?.buildVersion ?? pkg.version,
      category: app.category ?? pkg.build?.mac?.category
    },
    summary: {
      status: tasks.some((entry) => entry.status === "blocked") ? "blocked" : "ready-for-manual-entry",
      sectionCount: sections.length,
      taskCount: tasks.length,
      manualCount: tasks.filter((entry) => entry.status === "manual").length,
      blockedCount: tasks.filter((entry) => entry.status === "blocked").length,
      complianceManualCount: compliance.summary?.manualCount ?? 0,
      contactValuesRedacted: true
    },
    sourceArtifacts: [
      "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
      "app-store-assets/APP_STORE_COMPLIANCE.json",
      "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
      "APP_STORE_READINESS.md"
    ],
    sections,
    finalNotes: [
      "Manual tasks are account/App Store Connect actions; they are not proven complete by local source code.",
      "Private contact values are redacted in this artifact. Enter them directly in App Store Connect from the private release env.",
      "Re-run npm run app-compliance:store after changing App Store fields, public URL/contact inputs, screenshots, or compliance guidance."
    ]
  };
  const markdown = `# Cody Cartridge App Store Connect Manual Tasks

Generated by \`npm run manual-tasks:store\`.

This packet consolidates account-side App Store Connect tasks that cannot be completed by code. It avoids storing private contact values.

## Candidate

- App: ${artifact.app.name}
- Bundle ID: \`${artifact.app.bundleId}\`
- SKU: \`${artifact.app.sku ?? "missing"}\`
- Version: ${artifact.app.version}
- Build version: ${artifact.app.buildVersion}
- Status: ${artifact.summary.status}
- Manual tasks ready for account entry: ${artifact.summary.manualCount}
- Blocked tasks: ${artifact.summary.blockedCount}

## Task Matrix

| Section | Status | Task | App Store Connect Location | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
${tableRows(tasks)}

## Final Notes

${bulletList(artifact.finalNotes)}
`;

  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);
  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);
  console.log(`App Store Connect manual task packet records ${artifact.summary.blockedCount} blocked task(s).`);
}

main();
