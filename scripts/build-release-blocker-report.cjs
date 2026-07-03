#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isReleaseStoreEnvValue, isStoreEnvPlaceholder, loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const loadedEnvFiles = loadStoreEnv(projectRoot);
const outputJson = path.join(projectRoot, "app-store-assets", "RELEASE_BLOCKERS.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "RELEASE_BLOCKERS.md");
const homeDir = os.homedir();

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function readText(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
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
  return /TODO_|TODO:|your name|you@example\.com|https:\/\/example\.com|\+1-555-555-5555/i.test(String(value ?? ""));
}

function valueState(value, validator = () => true) {
  const trimmedValue = String(value ?? "").trim();

  if (!trimmedValue) {
    return "missing";
  }

  if (isStoreEnvPlaceholder(trimmedValue) || isPlaceholder(trimmedValue)) {
    return "placeholder";
  }

  if (!validator(trimmedValue)) {
    return "invalid";
  }

  return "ready";
}

function releaseEnvEvidence(key) {
  return `value is ${valueState(process.env[key], (value) => isReleaseStoreEnvValue(key, value))}`;
}

function publicUrlEvidence(fields) {
  return `supportUrl=${valueState(fields.productPage?.supportUrl, isFullHttpsUrl)} privacyPolicyUrl=${valueState(
    fields.productPage?.privacyPolicyUrl,
    isFullHttpsUrl
  )}`;
}

function contactEvidence(fields) {
  return [
    `supportEmail=${valueState(fields.urls?.supportEmail, isEmail)}`,
    `reviewName=${valueState(fields.review?.contact?.name, (value) => value.length >= 2)}`,
    `reviewEmail=${valueState(fields.review?.contact?.email, isEmail)}`,
    `reviewPhone=${valueState(fields.review?.contact?.phone, isPhone)}`
  ].join(" ");
}

function statusFor(condition) {
  return condition ? "pass" : "blocked";
}

function check(id, label, condition, evidence, action, owner = "release-machine") {
  return {
    action,
    evidence,
    id,
    label,
    owner,
    status: statusFor(condition)
  };
}

function sanitizeLine(line) {
  return String(line)
    .replaceAll(projectRoot, "<project>")
    .replaceAll(homeDir, "~")
    .replace(/([A-Z0-9._%+-])[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})/gi, "$1***$2")
    .replace(/(\+?\d)[\d ().-]{5,}(\d{2})/g, "$1***$2")
    .trim();
}

function runReleaseCheck(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const lines = output
    .split(/\r?\n/)
    .map(sanitizeLine)
    .filter(Boolean);
  const failureLines = lines.filter((line) => line.startsWith("FAIL "));
  const warningLines = lines.filter((line) => line.startsWith("WARN "));

  return {
    command: [command, ...args].join(" "),
    exitCode: result.status ?? (result.error ? 1 : 0),
    failures: failureLines.map((line) => line.replace(/^FAIL\s+/, "")),
    warnings: warningLines.map((line) => line.replace(/^WARN\s+/, "")),
    ready: (result.status ?? 1) === 0 && failureLines.length === 0,
    error: result.error ? sanitizeLine(result.error.message) : null
  };
}

function commandCheck(id, label, result, action) {
  const details = [
    result.ready ? "strict check passed" : "strict check failed",
    `${result.failures.length} failure(s)`,
    `${result.warnings.length} warning(s)`
  ];

  return {
    action,
    command: result.command,
    details: result.failures.length > 0 ? result.failures : result.warnings,
    evidence: details.join(" · "),
    id,
    label,
    owner: "release-machine",
    status: result.ready ? "pass" : "blocked"
  };
}

function category(id, label, checks) {
  const blockerCount = checks.filter((item) => item.status === "blocked").length;

  return {
    blockerCount,
    checks,
    id,
    label,
    status: blockerCount === 0 ? "pass" : "blocked"
  };
}

function blockerDetail(categoryItem, entry, order) {
  return {
    action: entry.action,
    categoryId: categoryItem.id,
    categoryLabel: categoryItem.label,
    checkId: entry.id,
    command: entry.command ?? null,
    details: entry.details ?? [],
    evidence: entry.evidence,
    id: `${categoryItem.id}:${entry.id}`,
    label: entry.label,
    order,
    owner: entry.owner ?? "release-machine",
    requiresExternalInput: ["public-inputs", "generated-site", "signing-package", "submission"].includes(categoryItem.id),
    status: entry.status
  };
}

function blockerDetails(categories) {
  return categories.flatMap((categoryItem) =>
    categoryItem.checks
      .filter((entry) => entry.status === "blocked")
      .map((entry, index) => blockerDetail(categoryItem, entry, index + 1))
  );
}

function nextCommandForCategory(categoryId) {
  return {
    "public-inputs":
      'npm run configure:store-env -- --dry-run --site-url https://your-public-site.example --support-email "<support-email>" --review-name "<review-contact-name>" --review-email "<review-contact-email>" --review-phone "<review-contact-phone>" && npm run configure:store-env -- --site-url https://your-public-site.example --support-email "<support-email>" --review-name "<review-contact-name>" --review-email "<review-contact-email>" --review-phone "<review-contact-phone>" && npm run public-release:store:node -- --self-test && npm run public-inputs:store && npm run check:store-env && npm run check:release-runtime:node -- --strict',
    "generated-site": "npm run public-release:store -- --self-test && npm run public-release:store -- --dry-run",
    "signing-package": "npm run signing-assets:store && npm run check:mas-signing -- --strict",
    submission: "npm run public-release:store -- --self-test && npm run check:public-release-sync -- --strict"
  }[categoryId] ?? "npm run report:store-blockers";
}

function nextActionQueue(categories) {
  return categories
    .filter((categoryItem) => categoryItem.blockerCount > 0)
    .map((categoryItem, index) => {
      const firstBlockedCheck = categoryItem.checks.find((entry) => entry.status === "blocked");

      return {
        blockerCount: categoryItem.blockerCount,
        categoryId: categoryItem.id,
        categoryLabel: categoryItem.label,
        firstBlockedCheckId: firstBlockedCheck?.id ?? null,
        firstBlockedCheckLabel: firstBlockedCheck?.label ?? null,
        nextAction: firstBlockedCheck?.action ?? "No blocked checks in this category.",
        order: index + 1,
        recommendedCommand: nextCommandForCategory(categoryItem.id)
      };
    });
}

function buildPublicInputChecks(fields) {
  const env = process.env;
  const hasEnvSource =
    loadedEnvFiles.length > 0 ||
    ["CODY_SITE_URL", "CODY_SUPPORT_EMAIL", "CODY_REVIEW_CONTACT_NAME", "CODY_REVIEW_CONTACT_EMAIL", "CODY_REVIEW_CONTACT_PHONE"].some(
      (key) => env[key]
    );

  return [
    check(
      "store-env-source",
      "Release env source exists",
      hasEnvSource,
      loadedEnvFiles.length > 0 ? `loaded ${loadedEnvFiles.join(", ")}` : "no ignored site.env file or shell env was detected",
      "Run npm run init:store-env, fill ignored app-store-assets/site.env with real values, keep it chmod 600, or export the CODY_* values in the release shell."
    ),
    check(
      "public-site-url",
      "CODY_SITE_URL is a real HTTPS URL",
      isReleaseStoreEnvValue("CODY_SITE_URL", env.CODY_SITE_URL),
      releaseEnvEvidence("CODY_SITE_URL"),
      "Set CODY_SITE_URL to the final public site origin, then rebuild the site, archive, packet, and manifest."
    ),
    check(
      "support-email",
      "CODY_SUPPORT_EMAIL is real",
      isReleaseStoreEnvValue("CODY_SUPPORT_EMAIL", env.CODY_SUPPORT_EMAIL),
      releaseEnvEvidence("CODY_SUPPORT_EMAIL"),
      "Set CODY_SUPPORT_EMAIL to the public support contact that will appear on support/privacy pages."
    ),
    check(
      "review-contact-name",
      "App Review contact name is real",
      isReleaseStoreEnvValue("CODY_REVIEW_CONTACT_NAME", env.CODY_REVIEW_CONTACT_NAME),
      releaseEnvEvidence("CODY_REVIEW_CONTACT_NAME"),
      "Set CODY_REVIEW_CONTACT_NAME for App Store Connect App Review contact information."
    ),
    check(
      "review-contact-email",
      "App Review contact email is real",
      isReleaseStoreEnvValue("CODY_REVIEW_CONTACT_EMAIL", env.CODY_REVIEW_CONTACT_EMAIL),
      releaseEnvEvidence("CODY_REVIEW_CONTACT_EMAIL"),
      "Set CODY_REVIEW_CONTACT_EMAIL for App Store Connect App Review contact information."
    ),
    check(
      "review-contact-phone",
      "App Review contact phone is real",
      isReleaseStoreEnvValue("CODY_REVIEW_CONTACT_PHONE", env.CODY_REVIEW_CONTACT_PHONE),
      releaseEnvEvidence("CODY_REVIEW_CONTACT_PHONE"),
      "Set CODY_REVIEW_CONTACT_PHONE for App Store Connect App Review contact information."
    ),
    check(
      "generated-fields-public-urls",
      "Generated App Store fields have HTTPS support/privacy URLs",
      isFullHttpsUrl(fields.productPage?.supportUrl) &&
        !isPlaceholder(fields.productPage?.supportUrl) &&
        isFullHttpsUrl(fields.productPage?.privacyPolicyUrl) &&
        !isPlaceholder(fields.productPage?.privacyPolicyUrl),
      publicUrlEvidence(fields),
      "Run npm run packet:store after real CODY_SITE_URL is available."
    )
  ];
}

function buildGeneratedSiteChecks(archiveManifest) {
  const siteFiles = [
    "index.html",
    "privacy.html",
    "support.html",
    "accessibility.html",
    "third-party-notices.html",
    "robots.txt",
    "sitemap.xml",
    "README.txt",
    "_headers",
    "vercel.json"
  ];
  const existingSiteFiles = siteFiles.filter((fileName) => exists(path.join("app-store-assets", "site", fileName)));
  const generatedSiteText = siteFiles.map((fileName) => readText(path.join("app-store-assets", "site", fileName))).join("\n");
  const siteHasRawPlaceholders =
    generatedSiteText.includes("TODO_PUBLIC_SITE_URL") ||
    generatedSiteText.includes("TODO_SUPPORT_EMAIL") ||
    generatedSiteText.includes("you@example.com") ||
    generatedSiteText.includes("https://example.com");
  const sitePublishValuesReady =
    isReleaseStoreEnvValue("CODY_SITE_URL", process.env.CODY_SITE_URL) &&
    isReleaseStoreEnvValue("CODY_SUPPORT_EMAIL", process.env.CODY_SUPPORT_EMAIL);
  const archivePlaceholders = archiveManifest.placeholders ?? {};
  const archivePlaceholderFiles = archivePlaceholders.files ?? [];

  return [
    check(
      "site-files-present",
      "Generated public site files exist",
      existingSiteFiles.length === siteFiles.length,
      `${existingSiteFiles.length}/${siteFiles.length} generated files present`,
      "Run npm run site:store."
    ),
    check(
      "site-no-placeholders",
      "Generated public site has no raw placeholder tokens",
      existingSiteFiles.length === siteFiles.length && !siteHasRawPlaceholders,
      siteHasRawPlaceholders ? "raw placeholder token remains in generated public site" : "no raw placeholder tokens detected",
      "Set real CODY_* values, then run npm run site:store."
    ),
    check(
      "site-publish-values-ready",
      "Generated public site has publish-ready contact and origin",
      existingSiteFiles.length === siteFiles.length && sitePublishValuesReady,
      `siteUrl=${valueState(process.env.CODY_SITE_URL, isFullHttpsUrl)} supportEmail=${valueState(process.env.CODY_SUPPORT_EMAIL, isEmail)}`,
      "Set real CODY_SITE_URL and CODY_SUPPORT_EMAIL, then run npm run site:store."
    ),
    check(
      "archive-present",
      "Public site archive exists",
      exists("app-store-assets/public-site/cody-cartridge-public-site.zip") && exists("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json"),
      exists("app-store-assets/public-site/cody-cartridge-public-site.zip") ? "archive exists" : "archive is missing",
      "Run npm run site:archive after rebuilding the public site."
    ),
    check(
      "archive-no-placeholders",
      "Public site archive has no publish placeholders",
      exists("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json") &&
        !archivePlaceholders.supportEmail &&
        !archivePlaceholders.siteUrl &&
        archivePlaceholderFiles.length === 0,
      archivePlaceholderFiles.length > 0
        ? `placeholder files: ${archivePlaceholderFiles.join(", ")}`
        : "archive placeholder manifest inspected",
      "Run npm run site:archive after generating the site with real public values."
    )
  ];
}

function buildSigningChecks() {
  const signing = runReleaseCheck("node", ["scripts/check-mas-signing.cjs", "--strict"]);
  const masPackage = runReleaseCheck("node", ["scripts/check-mas-package.cjs", "--strict"]);

  return [
    commandCheck(
	      "mas-signing-strict",
	      "MAS signing assets are installed",
	      signing,
	      "Install Apple Distribution/Mac App Distribution plus Mac Installer Distribution identities and a matching macOS/Mac App Store provisioning profile, then run npm run check:mas-signing -- --strict."
	    ),
    commandCheck(
		      "mas-package-strict",
		      "Signed MAS package boundary passes",
		      masPackage,
		      "Run npm run dist:mas on the signed release machine, then npm run check:mas-package -- --strict to verify the app bundle, signed current-version installer package, signature, embedded provisioning profile, and MAS entitlements."
		    )
  ];
}

function buildSubmissionChecks(fields) {
  const exportCompliance = runReleaseCheck("node", ["scripts/check-export-compliance.cjs"]);
  const publicReleaseSync = runReleaseCheck("node", ["scripts/check-public-release-sync.cjs", "--strict"]);
  const publishedSite = runReleaseCheck("node", ["scripts/check-public-site-published.cjs", "--strict"]);
  const uploadTooling = runReleaseCheck("node", ["scripts/check-upload-tooling.cjs", "--strict"]);
  const uploadCredentials = runReleaseCheck("node", ["scripts/check-upload-credentials.cjs", "--strict"]);

  return [
    commandCheck(
      "export-compliance",
      "Export compliance prep is current",
      exportCompliance,
      "Run npm run export-compliance:store, npm run packet:store, then npm run check:export-compliance."
    ),
    commandCheck(
      "public-release-sync-strict",
      "Generated public release values are synced",
      publicReleaseSync,
      "Set real CODY_* values, then run npm run site:store, npm run site:archive, npm run packet:store, npm run review-brief:store, npm run copy-map:store, and npm run check:public-release-sync -- --strict."
    ),
    commandCheck(
	      "upload-tooling-strict",
	      "App Store upload tooling and MAS package are available",
	      uploadTooling,
	      "Install Transporter from the Mac App Store or full Xcode command-line upload tools, run npm run dist:mas, verify the signed current-version package with npm run check:mas-package -- --strict, then run npm run check:upload-tooling -- --strict."
	    ),
    commandCheck(
      "upload-credentials-strict",
      "App Store Connect upload credentials are configured",
      uploadCredentials,
      "Run npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run, install the key outside the project if validation passes, export ASC_KEY_ID and ASC_ISSUER_ID, then run npm run check:upload-credentials -- --strict."
    ),
    check(
      "support-url-reachable-gate",
      "Public URL reachability gate is ready to run",
      isFullHttpsUrl(fields.productPage?.supportUrl) &&
        !isPlaceholder(fields.productPage?.supportUrl) &&
        isFullHttpsUrl(fields.productPage?.privacyPolicyUrl) &&
        !isPlaceholder(fields.productPage?.privacyPolicyUrl),
      publicUrlEvidence(fields),
      "After publishing the public site, run npm run check:store-urls -- --strict."
    ),
    commandCheck(
      "published-site-strict",
      "Published public-site pages match the generated source",
      publishedSite,
      "After publishing the public site, run npm run check:published-site -- --strict."
    ),
    check(
      "app-store-connect-copy-ready",
      "Generated App Store Connect copy has no placeholder contact data",
      !isPlaceholder(fields.urls?.supportEmail) &&
        !isPlaceholder(fields.review?.contact?.name) &&
        !isPlaceholder(fields.review?.contact?.email) &&
        !isPlaceholder(fields.review?.contact?.phone),
      contactEvidence(fields),
      "Run npm run packet:store after real public support and App Review contact values are set."
    )
  ];
}

function renderMarkdown(report) {
  const checkRows = report.categories.flatMap((item) =>
    item.checks.map((entry) => {
      const details = entry.details?.length ? ` ${entry.details.join("; ")}` : "";
      return `| ${item.label} | ${entry.status} | ${entry.label} | ${entry.evidence}${details} | ${entry.action} |`;
    })
  );
  const actionRows =
    report.nextActionQueue.length > 0
      ? report.nextActionQueue
          .map(
            (entry) =>
              `| ${entry.order} | ${entry.categoryLabel} | ${entry.blockerCount} | \`${entry.recommendedCommand}\` | ${entry.nextAction} |`
          )
          .join("\n")
      : "| - | None | 0 | - | No blockers detected by this report. |";
  const detailRows =
    report.blockerDetails.length > 0
      ? report.blockerDetails
          .map(
            (entry) =>
              `| ${entry.categoryLabel} | ${entry.checkId} | ${entry.owner} | ${entry.evidence} | ${entry.action} |`
          )
          .join("\n")
      : "| None | - | - | - | No blockers detected by this report. |";

  return `# Cody Cartridge Release Blockers

Generated by \`npm run report:store-blockers\`.

This report intentionally redacts contact values and signing identity details. Use it as the release-machine handoff before \`npm run release:store:preflight\`.

## Summary

- Generated: ${report.generatedAt}
- App: ${report.app.name}
- Bundle ID: \`${report.app.bundleId}\`
- Version: ${report.app.version}
- Build version: ${report.app.buildVersion}
- Blockers: ${report.summary.blockerCount}
- Ready for strict preflight: ${report.summary.readyForStrictPreflight ? "yes" : "no"}

## Blockers

${report.blockers.length > 0 ? report.blockers.map((item) => `- ${item}`).join("\n") : "- None detected by this report."}

## Next Action Queue

| # | Area | Blockers | Recommended command | First next action |
| --- | --- | --- | --- | --- |
${actionRows}

## Structured Blocker Details

| Area | Check ID | Owner | Evidence | Next action |
| --- | --- | --- | --- | --- |
${detailRows}

## Checks

| Area | Status | Check | Evidence | Next action |
| --- | --- | --- | --- | --- |
${checkRows.join("\n")}

## Release Commands

- \`npm run release:store:local\`
- \`npm run init:store-env\`
- \`npm run check:store-env\`
- \`npm run site:store && npm run site:archive\`
- \`npm run check:site -- --strict && npm run check:site-archive -- --strict\`
- \`npm run export-compliance:store && npm run packet:store && npm run review-brief:store && npm run copy-map:store && npm run check:store-version && npm run check:export-compliance && npm run check:store-copy\`
- \`npm run check:public-release-sync -- --strict\`
- \`npm run check:store-urls -- --strict\`
- \`npm run check:published-site -- --strict\`
- \`npm run check:mas-signing -- --strict\`
- \`npm run dist:mas && npm run check:mas-package -- --strict\`
- \`npm run check:upload-tooling -- --strict\`
- \`npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run\`
- \`npm run check:upload-credentials -- --strict\`
- \`npm run public-inputs:store\`
- \`npm run signing-runbook:store\`
- \`npm run resolution-plan:store\`
- \`npm run submission-checklist:store\`
- \`npm run evidence:store\`
- \`npm run dashboard:store\`
- \`npm run operator:store\`
- \`npm run manifest:store && npm run handoff:store && npm run verify:store:strict\`
`;
}

function main() {
  const pkg = readJson("package.json");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const archiveManifest = readJson("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json");
  const categories = [
    category("public-inputs", "Public Site And Contact Inputs", buildPublicInputChecks(fields)),
    category("generated-site", "Generated Public Site", buildGeneratedSiteChecks(archiveManifest)),
    category("signing-package", "Signing And MAS Package", buildSigningChecks()),
    category("submission", "Submission Gates", buildSubmissionChecks(fields))
  ];
  const details = blockerDetails(categories);
  const actionQueue = nextActionQueue(categories);
  const blockers = categories.flatMap((item) =>
    item.checks
      .filter((entry) => entry.status === "blocked")
      .map((entry) => `${item.label}: ${entry.label}. ${entry.action}`)
  );
  const report = {
    app: {
      buildVersion: pkg.build?.buildVersion ?? pkg.version,
      bundleId: pkg.build?.appId ?? null,
      name: pkg.build?.productName ?? pkg.name,
      version: pkg.version
    },
    blockers,
    blockerDetails: details,
    categories,
    generatedAt: new Date().toISOString(),
    nextActionQueue: actionQueue,
    redaction: "Contact values and signing identities are intentionally summarized or redacted.",
    summary: {
      blockedCategoryCount: categories.filter((item) => item.blockerCount > 0).length,
      blockerCount: blockers.length,
      blockerDetailCount: details.length,
      nextActionCount: actionQueue.length,
      readyForStrictPreflight: blockers.length === 0
    }
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderMarkdown(report));

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);
  console.log(`Release blocker report: ${blockers.length} blocker(s)`);

  blockers.forEach((blocker) => console.warn(`BLOCKER ${blocker}`));
}

main();
