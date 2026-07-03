#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "APP_STORE_COMPLIANCE.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "APP_STORE_COMPLIANCE.md");

function readJson(relativePath, fallback = null) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function includes(value, needle) {
  return String(value ?? "").toLowerCase().includes(String(needle).toLowerCase());
}

function item(id, section, label, status, evidence, action, appStoreConnectLocation) {
  return {
    id,
    section,
    label,
    status,
    evidence,
    action,
    appStoreConnectLocation
  };
}

function section(id, title, items) {
  return {
    id,
    title,
    readyCount: items.filter((entry) => entry.status === "ready").length,
    manualCount: items.filter((entry) => entry.status === "manual").length,
    blockerCount: items.filter((entry) => entry.status === "blocked").length,
    items
  };
}

function tableRows(items) {
  return items
    .map(
      (entry) =>
        `| ${entry.section} | ${entry.status} | ${entry.label} | ${entry.evidence} | ${entry.action} |`
    )
    .join("\n");
}

function bulletList(items) {
  return items.map((entry) => `- ${entry}`).join("\n");
}

function main() {
  const pkg = readJson("package.json", {});
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json", {});
  const exportCompliance = readJson("app-store-assets/EXPORT_COMPLIANCE.json", {});
  const ageRating = fields.ageRating ?? {};
  const distribution = fields.distribution ?? {};
  const rights = fields.rightsAndCompliance ?? {};
  const dsa = rights.digitalServicesAct ?? {};
  const privacy = fields.privacy ?? {};
  const app = {
    name: fields.app?.name ?? pkg.build?.productName ?? pkg.name,
    bundleId: fields.app?.bundleId ?? pkg.build?.appId,
    version: fields.app?.packageVersion ?? pkg.version,
    buildVersion: fields.app?.buildVersion ?? pkg.build?.buildVersion ?? pkg.version
  };
  const sections = [
    section("age-rating", "Age Rating", [
      item(
        "age-rating-candidate",
        "Age Rating",
        "4+ candidate rationale is present",
        includes(ageRating.expectedRating, "4+") ? "ready" : "blocked",
        ageRating.expectedRating ?? "missing",
        "Answer Apple's age-rating questionnaire from the final shipped app behavior.",
        ageRating.appStoreConnectLocation ?? "General > App Information > Age Ratings"
      ),
      item(
        "age-rating-risk-answers",
        "Age Rating",
        "Questionnaire risk answers are documented",
        Array.isArray(ageRating.questionnaireNotes) && ageRating.questionnaireNotes.length >= 5 ? "ready" : "blocked",
        `${ageRating.questionnaireNotes?.length ?? 0} note(s)`,
        "Use these notes while answering Apple age-rating questions; user-owned local media is outside the app bundle.",
        ageRating.appStoreConnectLocation ?? "General > App Information > Age Ratings"
      )
    ]),
    section("privacy-data", "Privacy And Data", [
      item(
        "privacy-no-collection",
        "Privacy And Data",
        "No data collection answer is present",
        includes(privacy.appPrivacyDataCollection, "does not collect data") ? "ready" : "blocked",
        privacy.appPrivacyDataCollection ?? "missing",
        "Copy the App Privacy answer into App Store Connect and keep it aligned with the signed binary.",
        "App Privacy"
      ),
      item(
        "privacy-no-tracking",
        "Privacy And Data",
        "No tracking answer is present",
        includes(privacy.tracking, "No tracking") ? "ready" : "blocked",
        privacy.tracking ?? "missing",
        "Confirm no analytics, ads, tracking domains, or off-device developer collection are added before upload.",
        "App Privacy"
      ),
      item(
        "privacy-local-processing",
        "Privacy And Data",
        "Local data processing is disclosed",
        includes(privacy.localDataProcessed, "Selected audio files") &&
          includes(privacy.localDataProcessed, "security-scoped bookmarks")
          ? "ready"
          : "blocked",
        privacy.localDataProcessed ?? "missing",
        "Use this wording to explain local-only library state if App Review asks.",
        "App Privacy / App Review Notes"
      )
    ]),
    section("pricing-availability", "Pricing And Availability", [
      item(
        "pricing",
        "Pricing And Availability",
        "First-release price candidate is documented",
        distribution.price ? "manual" : "blocked",
        distribution.price ?? "missing",
        "Set the final price in App Store Connect.",
        distribution.pricingAndAvailabilityLocation ?? "Monetization > Pricing and Availability"
      ),
      item(
        "availability",
        "Pricing And Availability",
        "Availability candidate is documented",
        distribution.availability ? "manual" : "blocked",
        distribution.availability ?? "missing",
        "Confirm launch countries/regions in App Store Connect.",
        distribution.pricingAndAvailabilityLocation ?? "Monetization > Pricing and Availability"
      ),
      item(
        "release-option",
        "Pricing And Availability",
        "Manual release recommendation is documented",
        includes(distribution.releaseOption, "Manual release") ? "manual" : "blocked",
        distribution.releaseOption ?? "missing",
        "Choose the App Store version release option in App Store Connect.",
        "App Store version > Pricing and Availability"
      ),
      item(
        "tax-category",
        "Pricing And Availability",
        "Tax category candidate is documented",
        distribution.taxCategory ? "manual" : "blocked",
        distribution.taxCategory ?? "missing",
        "Confirm the final tax category in App Store Connect.",
        distribution.pricingAndAvailabilityLocation ?? "Monetization > Pricing and Availability"
      )
    ]),
    section("rights-compliance", "Rights And Compliance", [
      item(
        "content-rights",
        "Rights And Compliance",
        "Content rights answer is local-file only",
        includes(rights.contentRights, "ships without music") && includes(rights.contentRights, "user-selected files")
          ? "ready"
          : "blocked",
        rights.contentRights ?? "missing",
        "Use this answer for content-rights questions and App Review clarification.",
        "App Information / Rights and Compliance"
      ),
      item(
        "export-compliance",
        "Rights And Compliance",
        "Export compliance answer matches prep artifact",
        exportCompliance.summary?.status === "ready-for-app-store-connect-questionnaire" &&
          includes(rights.exportCompliance, "no custom or proprietary encryption")
          ? "ready"
          : "blocked",
        exportCompliance.summary?.status ?? "missing export-compliance artifact",
        "Use EXPORT_COMPLIANCE.md for the final signed-binary export-compliance answer.",
        "App Information > Export Compliance"
      ),
      item(
        "dsa-status",
        "Rights And Compliance",
        "EU DSA account answer is called out",
        dsa.status ? "manual" : "blocked",
        dsa.status ?? "missing",
        "Answer trader/non-trader status in App Store Connect before enabling EU availability.",
        dsa.location ?? "Business / Compliance information > European Union Digital Services Act"
      ),
      item(
        "login-iap-medical",
        "Rights And Compliance",
        "No login, IAP, or regulated medical device flow",
        rights.loginRequired === "No." && rights.inAppPurchases && rights.regulatedMedicalDevice === "No."
          ? "ready"
          : "blocked",
        `login=${rights.loginRequired ?? "missing"} iap=${rights.inAppPurchases ?? "missing"} medical=${rights.regulatedMedicalDevice ?? "missing"}`,
        "Keep these answers aligned with the signed binary and App Store Connect capabilities.",
        "App Review / Compliance"
      )
    ])
  ];
  const allItems = sections.flatMap((entry) => entry.items);
  const artifact = {
    generatedAt: new Date().toISOString(),
    app,
    summary: {
      status: allItems.some((entry) => entry.status === "blocked")
        ? "needs-compliance-source-fix"
        : "ready-for-app-store-connect-entry",
      itemCount: allItems.length,
      readyCount: allItems.filter((entry) => entry.status === "ready").length,
      manualCount: allItems.filter((entry) => entry.status === "manual").length,
      blockerCount: allItems.filter((entry) => entry.status === "blocked").length,
      manualItemsAreAccountOrAppStoreConnectTasks: true
    },
    sourceArtifacts: [
      "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
      "app-store-assets/EXPORT_COMPLIANCE.json",
      "app-store-assets/EXPORT_COMPLIANCE.md",
      "APP_STORE_READINESS.md"
    ],
    sections,
    finalSubmissionNotes: [
      "Manual items are not represented as code blockers because they must be answered in App Store Connect against the final account and distribution choices.",
      "Re-run npm run app-compliance:store after changing App Store fields, export-compliance prep, pricing, availability, or DSA guidance.",
      "Re-run npm run check:app-compliance after the signed MAS binary is available and before Add for Review."
    ]
  };
  const markdown = `# Cody Cartridge App Store Compliance Packet

Generated by \`npm run app-compliance:store\`.

This packet separates code-proven compliance answers from App Store Connect manual/account answers. It does not store support contacts, signing secrets, Apple credentials, or private release env values.

## Candidate

- App: ${artifact.app.name}
- Bundle ID: \`${artifact.app.bundleId}\`
- Version: ${artifact.app.version}
- Build version: ${artifact.app.buildVersion}
- Status: ${artifact.summary.status}
- Ready items: ${artifact.summary.readyCount}
- Manual App Store Connect items: ${artifact.summary.manualCount}
- Blockers: ${artifact.summary.blockerCount}

## Compliance Matrix

| Section | Status | Check | Evidence | Action |
| --- | --- | --- | --- | --- |
${tableRows(allItems)}

## Final Submission Notes

${bulletList(artifact.finalSubmissionNotes)}

## Source Artifacts

${bulletList(artifact.sourceArtifacts.map((entry) => `\`${entry}\``))}
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (artifact.summary.blockerCount > 0) {
    console.warn(`App Store compliance packet records ${artifact.summary.blockerCount} blocker(s).`);
  }
}

main();
