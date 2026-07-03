#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "FINAL_SUBMISSION_CHECKLIST.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "FINAL_SUBMISSION_CHECKLIST.md");

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function isFullHttpsUrl(value) {
  return /^https:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(String(value ?? ""));
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
}

function isPhone(value) {
  return /^\+?[0-9][0-9 ().-]{6,}[0-9]$/.test(String(value ?? ""));
}

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com|\+1-555-555-5555/i.test(String(value ?? ""));
}

function valueState(value, validator = () => true) {
  const trimmedValue = String(value ?? "").trim();

  if (!trimmedValue) {
    return "missing";
  }

  if (isPlaceholder(trimmedValue)) {
    return "placeholder";
  }

  if (!validator(trimmedValue)) {
    return "invalid";
  }

  return "ready";
}

function redactedEvidence(label, value, validator = () => true) {
  return `${label}=${valueState(value, validator)}`;
}

function reviewContactEvidence(contact) {
  return [
    redactedEvidence("reviewName", contact.name, (value) => value.length >= 2),
    redactedEvidence("reviewEmail", contact.email, isEmail),
    redactedEvidence("reviewPhone", contact.phone, isPhone)
  ].join(" ");
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function statusFor(ready) {
  return ready ? "ready" : "blocked";
}

function checklistItem(id, label, ready, evidence, action) {
  return {
    id,
    label,
    status: statusFor(ready),
    evidence,
    action: ready ? "" : action
  };
}

function blockerCheckById(blockers, id) {
  return (blockers.categories ?? [])
    .flatMap((category) => category.checks ?? [])
    .find((item) => item.id === id);
}

function section(id, title, appStoreConnectLocation, items) {
  const blockerCount = items.filter((item) => item.status === "blocked").length;

  return {
    id,
    title,
    appStoreConnectLocation,
    status: blockerCount === 0 ? "ready" : "blocked",
    blockerCount,
    items
  };
}

function markdownTable(sections) {
  const rows = sections.flatMap((sectionItem) =>
    sectionItem.items.map(
      (item) =>
        `| ${sectionItem.title} | ${item.status} | ${item.label} | ${String(item.evidence).replace(/\|/g, "\\|")} | ${
          item.action ? String(item.action).replace(/\|/g, "\\|") : "-"
        } |`
    )
  );

  return ["| Section | Status | Check | Evidence | Action |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

function main() {
  const pkg = readJson("package.json");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const copyMap = readJson("app-store-assets/APP_STORE_CONNECT_COPY_MAP.json", { summary: {}, fields: [] });
  const reviewBrief = readJson("app-store-assets/APP_REVIEW_BRIEF.json", { summary: {} });
  const appCompliance = readJson("app-store-assets/APP_STORE_COMPLIANCE.json", { summary: {}, sections: [] });
  const contentRights = readJson("app-store-assets/APP_CONTENT_RIGHTS.json", { summary: {}, facts: [] });
  const publicInputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json", { summary: {} });
  const publishPacket = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json", { summary: {} });
  const publicHostRunbook = readJson("app-store-assets/PUBLIC_HOST_RUNBOOK.json", { summary: {} });
  const signingAssetReport = readJson("app-store-assets/SIGNING_ASSET_REPORT.json", { summary: {} });
  const appleReleaseAssets = readJson("app-store-assets/APPLE_RELEASE_ASSETS.json", { summary: {}, assetRequests: [] });
  const uploadPacket = readJson("app-store-assets/UPLOAD_COMMAND_PACKET.json", { summary: {} });
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json", { summary: {}, blockers: [] });
  const runbook = readJson("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json", { expectedPackageOutputs: {}, uploadTooling: [] });
  const resolutionPlan = readJson("app-store-assets/RELEASE_RESOLUTION_PLAN.json", { phases: [], finalProof: [] });
  const supportUrl = fields.productPage?.supportUrl ?? "";
  const privacyPolicyUrl = fields.productPage?.privacyPolicyUrl ?? "";
  const supportEmail = fields.urls?.supportEmail ?? fields.testFlight?.feedbackEmail ?? "";
  const reviewContact = fields.review?.contact ?? {};
  const copyBlockers = copyMap.summary?.blockerCount ?? copyMap.fields?.filter((field) => field.status === "blocker").length ?? 0;
  const copyWorkflowBlockers = copyMap.workflow?.summary?.blockerStepCount ?? copyMap.workflow?.steps?.filter((step) => step.status === "blocker").length ?? 0;
  const copyWorkflowWarnings = copyMap.workflow?.summary?.warningStepCount ?? copyMap.workflow?.steps?.filter((step) => step.status === "warning").length ?? 0;
  const reviewBlockers = reviewBrief.summary?.blockerCount ?? 0;
  const releaseBlockers = blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0;
  const publicReleaseSync = blockerCheckById(blockers, "public-release-sync-strict");
  const publishedSite = blockerCheckById(blockers, "published-site-strict");
  const masSigning = blockerCheckById(blockers, "mas-signing-strict");
  const masPackage = blockerCheckById(blockers, "mas-package-strict");
  const uploadTooling = blockerCheckById(blockers, "upload-tooling-strict");
  const uploadCredentials = blockerCheckById(blockers, "upload-credentials-strict");

  const sections = [
    section("preflight", "Release Preflight", "Local release machine", [
      checklistItem(
        "strict-verifier-clean",
        "Strict verifier exits cleanly",
        releaseBlockers === 0,
        `release blocker count: ${releaseBlockers}`,
        "Clear public URL/contact, generated site, signing, package, and submission blockers, then run npm run verify:store:strict."
      ),
      checklistItem(
        "public-inputs-ready",
        "Public release-input packet is ready",
        Boolean(publicInputs.summary?.readyForPublicInputs),
        `${publicInputs.summary?.blockerCount ?? "missing"} blocked public input(s)`,
        "Run npm run public-inputs:store after setting CODY_* public URL/contact values."
      ),
      checklistItem(
        "public-site-publish-packet",
        "Public site publish packet is current",
        publishPacket.summary?.publishStatus === "ready",
        `${publishPacket.summary?.readyPageCount ?? "missing"} ready / ${publishPacket.summary?.requiredPageCount ?? "missing"} public page(s)`,
        "Run npm run publish-packet:store after rebuilding the public site archive."
      ),
      checklistItem(
        "public-host-runbook",
        "Public host runbook is current",
        publicHostRunbook.summary?.readyForLiveVerification === true,
        `${publicHostRunbook.summary?.hostedFileCount ?? "missing"} hosted file(s) · public values ${publicHostRunbook.summary?.publicValuesReady ? "ready" : "blocked"}`,
        "Run npm run public-host:store after rebuilding the public site archive and publish packet."
      ),
      checklistItem(
        "public-release-sync",
        "Generated public release values are synced",
        publicReleaseSync?.status === "pass",
        publicReleaseSync ? publicReleaseSync.evidence : "public-release-sync-strict gate missing from RELEASE_BLOCKERS.json",
        "Set real CODY_* values, rebuild site/archive/packet/copy/review artifacts, then run npm run check:public-release-sync -- --strict and npm run report:store-blockers."
      ),
      checklistItem(
        "resolution-plan-current",
        "Resolution plan has final proof steps",
        Array.isArray(resolutionPlan.finalProof) && resolutionPlan.finalProof.length >= 4,
        `${resolutionPlan.finalProof?.length ?? 0} final proof item(s)`,
        "Run npm run resolution-plan:store."
      ),
      checklistItem(
        "runbook-current",
        "Signing/upload runbook records MAS outputs",
        Boolean(runbook.expectedPackageOutputs?.appBundlePath && runbook.expectedPackageOutputs?.uploadPackagePattern),
        `${runbook.expectedPackageOutputs?.appBundlePath ?? "missing"} / ${runbook.expectedPackageOutputs?.uploadPackagePattern ?? "missing"}`,
        "Run npm run signing-runbook:store."
      ),
      checklistItem(
        "signing-asset-report-current",
        "Redacted signing asset report is current",
        typeof signingAssetReport.summary?.blockerCount === "number",
        `${signingAssetReport.summary?.status ?? "missing"} · ${signingAssetReport.summary?.blockerCount ?? "missing"} signing asset blocker(s)`,
        "Run npm run signing-assets:store before strict MAS signing/package checks."
      ),
      checklistItem(
        "upload-command-packet-current",
        "Upload command packet is current",
        typeof uploadPacket.summary?.blockerCount === "number",
        `${uploadPacket.summary?.status ?? "missing"} · ${uploadPacket.summary?.signedUploadPackageCount ?? "missing"} signed package(s) · ${uploadPacket.summary?.availableToolCount ?? "missing"} upload tool(s)`,
        "Run npm run upload-packet:store after MAS packaging, upload-tooling, and upload-credential checks."
      )
    ]),
    section("product-page", "Product Page", "App Store Connect > App version > Product Page", [
      checklistItem("name-ready", "Name is ready", Boolean(fields.productPage?.name), fields.productPage?.name ?? "missing", "Regenerate packet from listing copy."),
      checklistItem("subtitle-ready", "Subtitle is ready", Boolean(fields.productPage?.subtitle), fields.productPage?.subtitle ?? "missing", "Regenerate packet from listing copy."),
      checklistItem("description-ready", "Description is ready and local-only", /does not download music/i.test(fields.productPage?.description ?? ""), "description inspected", "Keep no-download/no-scraping language in listing copy."),
      checklistItem("keywords-ready", "Keywords fit App Store limit", Buffer.byteLength(String(fields.productPage?.keywords ?? ""), "utf8") <= 100, `${Buffer.byteLength(String(fields.productPage?.keywords ?? ""), "utf8")}/100 bytes`, "Shorten keywords in APP_STORE_LISTING.md."),
      checklistItem(
        "support-url-ready",
        "Support URL is public HTTPS",
        isFullHttpsUrl(supportUrl) && !isPlaceholder(supportUrl),
        redactedEvidence("supportUrl", supportUrl, isFullHttpsUrl),
        "Set CODY_SITE_URL, rebuild site/archive/publish packet, and publish the site."
      ),
      checklistItem(
        "privacy-url-ready",
        "Privacy Policy URL is public HTTPS",
        isFullHttpsUrl(privacyPolicyUrl) && !isPlaceholder(privacyPolicyUrl),
        redactedEvidence("privacyPolicyUrl", privacyPolicyUrl, isFullHttpsUrl),
        "Set CODY_SITE_URL, rebuild site/archive/publish packet, and publish the site."
      ),
      checklistItem(
        "published-site-ready",
        "Published public-site pages match the generated source",
        publishedSite?.status === "pass",
        publishedSite ? publishedSite.evidence : "published-site-strict gate missing from RELEASE_BLOCKERS.json",
        "Publish the generated site directory or archive contents, then run npm run check:published-site -- --strict."
      )
    ]),
    section("screenshots", "Screenshots", "App Store Connect > Product Page > Mac screenshots", [
      checklistItem("screenshots-present", "Screenshot inventory has at least three Mac screenshots", (fields.screenshots ?? []).length >= 3, `${fields.screenshots?.length ?? 0} screenshot(s)`, "Run npm run screenshots:store."),
      checklistItem(
        "screenshots-apple-mac-spec",
        "Screenshots match Apple Mac screenshot specifications",
        fields.screenshotManifest?.appStoreConnectSpec?.platform === "macOS" &&
          fields.screenshotManifest?.appStoreConnectSpec?.count?.min === 1 &&
          fields.screenshotManifest?.appStoreConnectSpec?.count?.max === 10 &&
          (fields.screenshots ?? []).every((screenshot) => screenshot.appStoreConnectAccepted === true && screenshot.format === "png"),
        fields.screenshotManifest?.appStoreConnectSpec
          ? `${fields.screenshotManifest.appStoreConnectSpec.aspectRatio} · ${(fields.screenshotManifest.appStoreConnectSpec.acceptedSizes ?? [])
              .map((size) => `${size.width}x${size.height}`)
              .join(", ")}`
          : "missing",
        "Run npm run screenshots:store and npm run check:screenshots."
      ),
      checklistItem("screenshot-manifest", "Screenshot manifest is recorded", fields.screenshotManifest?.filePath === "app-store-assets/screenshots/STORE_SCREENSHOTS.json", fields.screenshotManifest?.filePath ?? "missing", "Run npm run screenshots:store.")
    ]),
    section("privacy-and-compliance", "Privacy And Compliance", "App Store Connect > App Privacy, Age Rating, Pricing, Compliance, DSA", [
      checklistItem("privacy-no-collection", "App Privacy declares no data collection", /does not collect/i.test(fields.privacy?.appPrivacyDataCollection ?? ""), fields.privacy?.appPrivacyDataCollection ?? "missing", "Regenerate packet and confirm App Privacy answers in App Store Connect."),
      checklistItem(
        "app-compliance-packet",
        "Standalone compliance packet is ready",
        appCompliance.summary?.status === "ready-for-app-store-connect-entry" && appCompliance.summary?.blockerCount === 0,
        `${appCompliance.summary?.readyCount ?? "missing"} ready / ${appCompliance.summary?.manualCount ?? "missing"} manual / ${appCompliance.summary?.blockerCount ?? "missing"} blocker(s)`,
        "Run npm run app-compliance:store after packet/export-compliance changes."
      ),
      checklistItem("age-rating-draft", "Age rating draft is present", Boolean(fields.ageRating?.expectedRating), fields.ageRating?.expectedRating ?? "missing", "Answer Apple's age-rating questionnaire from shipped binary behavior."),
      checklistItem("pricing-draft", "Pricing and availability draft is present", Boolean(fields.distribution?.price), fields.distribution?.price ?? "missing", "Set pricing, availability, tax category, and manual release option in App Store Connect."),
      checklistItem(
        "export-compliance-draft",
        "Export compliance draft and evidence are present",
        fields.exportCompliance?.artifactPath === "app-store-assets/EXPORT_COMPLIANCE.json" &&
          fields.exportCompliance?.summary?.status === "ready-for-app-store-connect-questionnaire" &&
          fields.exportCompliance?.appStoreConnect?.sourceUrls?.some((url) => String(url).includes("export-compliance-documentation-for-encryption")),
        fields.exportCompliance?.artifactPath ?? "missing",
        "Run npm run export-compliance:store, then npm run packet:store and npm run check:export-compliance."
      ),
      checklistItem(
        "rights-dsa-draft",
        "Rights and DSA guidance is present",
        Boolean(fields.rightsAndCompliance?.contentRights && fields.rightsAndCompliance?.digitalServicesAct?.status),
        "rights/DSA fields inspected",
        "Complete EU DSA account/legal answers in App Store Connect."
      ),
      checklistItem(
        "content-rights-audit",
        "Content-rights and media audit is ready",
        contentRights.summary?.status === "ready-for-app-store-content-rights" && contentRights.summary?.failedCount === 0,
        `${contentRights.summary?.passedCount ?? "missing"} passed / ${contentRights.summary?.failedCount ?? "missing"} failed`,
        "Run npm run content-rights:store after import/playback, Takeout, packaging, screenshot-demo, or rights-copy changes."
      )
    ]),
    section("testflight", "TestFlight", "App Store Connect > TestFlight", [
      checklistItem("beta-description", "Beta app description is present", Boolean(fields.testFlight?.betaAppDescription), fields.testFlight?.betaAppDescription ? "present" : "missing", "Regenerate packet."),
      checklistItem("what-to-test", "What To Test has clean-account coverage", fields.testFlight?.whatToTest?.some((item) => item.includes("Clean") || item.includes("local audio") || item.includes("Reset Local Library")), `${fields.testFlight?.whatToTest?.length ?? 0} item(s)`, "Regenerate packet and keep import/playback/reset coverage."),
      checklistItem(
        "feedback-email",
        "Feedback email is public support contact",
        isEmail(supportEmail) && !isPlaceholder(supportEmail),
        redactedEvidence("supportEmail", supportEmail, isEmail),
        "Set CODY_SUPPORT_EMAIL and regenerate packet."
      )
    ]),
    section("build-upload", "Build Upload", "Transporter/Xcode/altool > App Store Connect processing", [
      checklistItem(
        "apple-release-assets",
        "Apple Developer/App Store Connect release assets are requested",
        appleReleaseAssets.summary?.readyForSigningAndUpload === true,
        `${appleReleaseAssets.summary?.blockerCount ?? "missing"} blocked asset request(s); ${appleReleaseAssets.summary?.manualCount ?? "missing"} manual/account confirmation(s)`,
        "Use APPLE_RELEASE_ASSETS.md to request certificates, provisioning profile, signed package, and upload API key, then run npm run apple-assets:store."
      ),
      checklistItem(
        "mas-signing-assets",
        "MAS signing assets are verified",
        masSigning?.status === "pass",
        masSigning ? masSigning.evidence : "mas-signing-strict gate missing from RELEASE_BLOCKERS.json",
        "Install Apple Distribution/Mac App Distribution plus Mac Installer Distribution identities and a matching macOS/Mac App Store provisioning profile, then run npm run signing-assets:store and npm run check:mas-signing -- --strict."
      ),
      checklistItem(
        "mas-package-verified",
        "Signed current-version MAS package boundary is verified",
        masPackage?.status === "pass",
        masPackage ? masPackage.evidence : "mas-package-strict gate missing from RELEASE_BLOCKERS.json",
        "Run npm run dist:mas, then npm run check:mas-package -- --strict."
      ),
      checklistItem(
        "upload-tooling",
        "Upload tooling and MAS package are verified",
        uploadTooling?.status === "pass",
        uploadTooling ? uploadTooling.evidence : "upload-tooling-strict gate missing from RELEASE_BLOCKERS.json",
        "Run npm run dist:mas, npm run check:mas-package -- --strict, then npm run check:upload-tooling -- --strict."
      ),
      checklistItem(
        "upload-credentials",
        "Upload credentials are verified",
        uploadCredentials?.status === "pass",
        uploadCredentials ? uploadCredentials.evidence : "upload-credentials-strict gate missing from RELEASE_BLOCKERS.json",
        "Run npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run, install the key after validation, export ASC_KEY_ID and ASC_ISSUER_ID, then run npm run check:upload-credentials -- --strict."
      ),
      checklistItem("mas-package-path", "MAS package output expectation is documented", Boolean(runbook.expectedPackageOutputs?.uploadPackagePattern), runbook.expectedPackageOutputs?.uploadPackagePattern ?? "missing", "Run npm run signing-runbook:store."),
      checklistItem("processed-build-match", "Processed build must match package metadata", Boolean(fields.app?.bundleId && fields.app?.packageVersion && fields.app?.buildVersion), `${fields.app?.bundleId ?? "missing"} ${fields.app?.packageVersion ?? "missing"} (${fields.app?.buildVersion ?? "missing"})`, "After upload processing, confirm App Store Connect build metadata matches this candidate.")
    ]),
    section("app-review", "App Review", "App version > App Review > Add for Review", [
      checklistItem(
        "review-contact",
        "App Review contact fields are real",
        Boolean(reviewContact.name && reviewContact.email && reviewContact.phone) &&
          !isPlaceholder(`${reviewContact.name} ${reviewContact.email} ${reviewContact.phone}`) &&
          isEmail(reviewContact.email) &&
          isPhone(reviewContact.phone),
        reviewContactEvidence(reviewContact),
        "Set CODY_REVIEW_CONTACT_* values and regenerate packet/review brief."
      ),
      checklistItem("review-brief-clear", "App Review brief has no blockers", reviewBlockers === 0, `${reviewBlockers} blocker(s)`, "Run npm run review-brief:store after real public/contact values are available."),
      checklistItem(
        "copy-map-clear",
        "App Store Connect copy map workflow has no blockers",
        copyBlockers === 0 && copyWorkflowBlockers === 0,
        `${copyBlockers} blocker field(s); ${copyWorkflowBlockers} blocker workflow step(s); ${copyWorkflowWarnings} warning workflow step(s)`,
        "Run npm run copy-map:store after real public/contact values, signed MAS package, and upload readiness are available."
      ),
      checklistItem("demo-account-none", "Demo account declares no account system", /no account system/i.test(fields.review?.demoAccount ?? ""), fields.review?.demoAccount ?? "missing", "Keep demo account answer aligned with the shipped app.")
    ]),
    section("submit-for-review", "Submit For Review", "App Review > Draft Submissions > Submit for Review", [
      checklistItem("blocker-report-clean", "Release blocker report is clean", releaseBlockers === 0, `${releaseBlockers} blocker(s)`, "Run npm run report:store-blockers after signing/package/public URL work is complete."),
      checklistItem("final-evidence", "Final proof includes evidence and manifest", resolutionPlan.finalProof?.some((item) => item.includes("RELEASE_BLOCKERS.json")) && resolutionPlan.finalProof?.some((item) => item.includes("verify:store:strict")), "final proof inspected", "Run npm run resolution-plan:store and npm run evidence:store before submission."),
      checklistItem("post-submit-monitoring", "Post-submission monitoring guidance is present", fields.submission?.appReviewSubmission?.postSubmitMonitoring?.length > 0, `${fields.submission?.appReviewSubmission?.postSubmitMonitoring?.length ?? 0} item(s)`, "Regenerate packet.")
    ])
  ];
  const blockerCount = sections.reduce((total, item) => total + item.blockerCount, 0);
  const checklist = {
    generatedAt: new Date().toISOString(),
    app: {
      name: fields.app?.name ?? pkg.build?.productName,
      bundleId: fields.app?.bundleId ?? pkg.build?.appId,
      version: fields.app?.packageVersion ?? pkg.version,
      buildVersion: fields.app?.buildVersion ?? pkg.build?.buildVersion ?? pkg.version
    },
    summary: {
      sectionCount: sections.length,
      itemCount: sections.reduce((total, item) => total + item.items.length, 0),
      blockerCount,
      readyForAddForReview: blockerCount === 0
    },
    sourceArtifacts: [
      "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
      "app-store-assets/APP_STORE_COMPLIANCE.json",
      "app-store-assets/APP_STORE_COMPLIANCE.md",
      "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json",
      "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md",
      "app-store-assets/APP_CONTENT_RIGHTS.json",
      "app-store-assets/APP_CONTENT_RIGHTS.md",
      "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json",
      "app-store-assets/EXPORT_COMPLIANCE.json",
      "app-store-assets/APP_REVIEW_BRIEF.json",
      "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
      "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
      "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
      "app-store-assets/SIGNING_ASSET_REPORT.json",
      "app-store-assets/APPLE_RELEASE_ASSETS.json",
      "app-store-assets/UPLOAD_COMMAND_PACKET.json",
      "app-store-assets/RELEASE_BLOCKERS.json",
      "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
      "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
      "scripts/install-asc-key.cjs",
      "scripts/check-upload-credentials.cjs"
    ],
    sections
  };
  const markdown = `# Cody Cartridge Final Submission Checklist

Generated by \`npm run submission-checklist:store\`.

Use this immediately before Add for Review and Submit for Review. It is a release-machine checklist; do not treat it as complete until every row is ready and \`npm run verify:store:strict\` passes.

## Candidate

- App: ${checklist.app.name}
- Bundle ID: \`${checklist.app.bundleId}\`
- Version: ${checklist.app.version}
- Build version: ${checklist.app.buildVersion}
- Sections: ${checklist.summary.sectionCount}
- Checks: ${checklist.summary.itemCount}
- Blockers: ${checklist.summary.blockerCount}
- Ready for Add for Review: ${checklist.summary.readyForAddForReview ? "yes" : "no"}

## Checklist

${markdownTable(sections)}

## Source Artifacts

${list(checklist.sourceArtifacts)}
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(checklist, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (blockerCount > 0) {
    console.warn(`Final submission checklist records ${blockerCount} blocker(s).`);
  }
}

main();
