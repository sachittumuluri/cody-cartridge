#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  isReleaseStoreEnvValue,
  isStoreEnvPlaceholder,
  loadStoreEnv,
  releaseEnvKeys
} = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const loadedEnvFiles = loadStoreEnv(projectRoot);
const passes = [];
const warnings = [];
const failures = [];
const generatedSiteFiles = [
  "app-store-assets/site/index.html",
  "app-store-assets/site/privacy.html",
  "app-store-assets/site/support.html",
  "app-store-assets/site/accessibility.html",
  "app-store-assets/site/third-party-notices.html",
  "app-store-assets/site/robots.txt",
  "app-store-assets/site/sitemap.xml",
  "app-store-assets/site/_headers",
  "app-store-assets/site/vercel.json"
];
const placeholderPattern =
  /TODO_|TODO:|=placeholder|you@example\.com|https:\/\/example\.com|\+1-555-555-5555|Your Name/i;

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  if (strict) {
    fail(message);
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

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function normalizedSiteUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function expectedPublicValues() {
  const siteUrl = normalizedSiteUrl(process.env.CODY_SITE_URL);

  return {
    siteUrl,
    supportEmail: String(process.env.CODY_SUPPORT_EMAIL ?? "").trim(),
    reviewContactName: String(process.env.CODY_REVIEW_CONTACT_NAME ?? "").trim(),
    reviewContactEmail: String(process.env.CODY_REVIEW_CONTACT_EMAIL ?? "").trim(),
    reviewContactPhone: String(process.env.CODY_REVIEW_CONTACT_PHONE ?? "").trim(),
    urls: {
      supportUrl: `${siteUrl}/support.html`,
      privacyPolicyUrl: `${siteUrl}/privacy.html`,
      marketingUrl: `${siteUrl}/index.html`,
      accessibilityUrl: `${siteUrl}/accessibility.html`,
      thirdPartyNoticesUrl: `${siteUrl}/third-party-notices.html`
    }
  };
}

function checkEnvReadiness() {
  if (loadedEnvFiles.length === 0 && releaseEnvKeys.some((key) => !process.env[key])) {
    warn("No release env file was loaded; run npm run init:store-env and fill app-store-assets/site.env.");
  } else {
    pass("Release env file or shell values were loaded");
  }

  const invalidKeys = releaseEnvKeys.filter((key) => !isReleaseStoreEnvValue(key, process.env[key]));

  releaseEnvKeys.forEach((key) => {
    if (invalidKeys.includes(key)) {
      warn(`${key} is missing, placeholder, or invalid.`);
    } else {
      pass(`${key} is release-ready`);
    }
  });

  if (invalidKeys.length > 0) {
    warn("Public release sync skipped until all CODY_* release values are configured.");
    return false;
  }

  return true;
}

function checkGeneratedFiles(values) {
  assert(exists("app-store-assets/APP_STORE_CONNECT_FIELDS.json"), "App Store fields JSON exists");
  assert(exists("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json"), "Public site archive manifest exists");
  generatedSiteFiles.forEach((filePath) => {
    assert(exists(filePath), `${filePath} exists`);
  });

  if (!exists("app-store-assets/APP_STORE_CONNECT_FIELDS.json") || !exists("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json")) {
    return;
  }

  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const archive = readJson("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json");

  assert(fields.productPage?.supportUrl === values.urls.supportUrl, "Product page support URL matches configured site URL");
  assert(fields.productPage?.privacyPolicyUrl === values.urls.privacyPolicyUrl, "Product page privacy URL matches configured site URL");
  assert(fields.productPage?.marketingUrl === values.urls.marketingUrl, "Product page marketing URL matches configured site URL");
  assert(fields.urls?.supportEmail === values.supportEmail, "App Store support email matches configured support email");
  assert(fields.urls?.supportUrl === values.urls.supportUrl, "App Store support URL field matches configured site URL");
  assert(fields.urls?.privacyPolicyUrl === values.urls.privacyPolicyUrl, "App Store privacy URL field matches configured site URL");
  assert(
    fields.urls?.thirdPartyNoticesUrl === values.urls.thirdPartyNoticesUrl,
    "App Store third-party notices URL matches configured site URL"
  );
  assert(fields.accessibility?.accessibilityUrl === values.urls.accessibilityUrl, "Accessibility URL matches configured site URL");
  assert(fields.testFlight?.feedbackEmail === values.supportEmail, "TestFlight feedback email matches configured support email");
  assert(fields.testFlight?.contactInformation?.name === values.reviewContactName, "TestFlight contact name matches configured review contact");
  assert(fields.testFlight?.contactInformation?.email === values.reviewContactEmail, "TestFlight contact email matches configured review contact");
  assert(fields.testFlight?.contactInformation?.phone === values.reviewContactPhone, "TestFlight contact phone matches configured review contact");
  assert(fields.review?.contact?.name === values.reviewContactName, "App Review contact name matches configured review contact");
  assert(fields.review?.contact?.email === values.reviewContactEmail, "App Review contact email matches configured review contact");
  assert(fields.review?.contact?.phone === values.reviewContactPhone, "App Review contact phone matches configured review contact");

  assert(archive.siteUrl === values.siteUrl, "Public site archive site URL matches configured site URL");
  assert(archive.supportEmail === values.supportEmail, "Public site archive support email matches configured support email");
  assert(archive.appStoreUrls?.supportUrl === values.urls.supportUrl, "Public archive support URL matches configured site URL");
  assert(archive.appStoreUrls?.privacyPolicyUrl === values.urls.privacyPolicyUrl, "Public archive privacy URL matches configured site URL");
  assert(
    archive.appStoreUrls?.accessibilityUrl === values.urls.accessibilityUrl,
    "Public archive accessibility URL matches configured site URL"
  );
  assert(
    archive.appStoreUrls?.thirdPartyNoticesUrl === values.urls.thirdPartyNoticesUrl,
    "Public archive third-party notices URL matches configured site URL"
  );
  assert(archive.placeholders?.supportEmail === false, "Public site archive has no support-email placeholder flag");
  assert(archive.placeholders?.siteUrl === false, "Public site archive has no site-URL placeholder flag");
  assert((archive.placeholders?.files ?? []).length === 0, "Public site archive records no placeholder files");

  const combinedSite = generatedSiteFiles
    .filter(exists)
    .map(readText)
    .join("\n");
  assert(combinedSite.includes(values.supportEmail), "Generated site pages include configured support email");
  assert(!placeholderPattern.test(combinedSite), "Generated site pages contain no public release placeholders");

  const fieldsText = JSON.stringify(fields);
  const archiveText = JSON.stringify(archive);

  assert(!placeholderPattern.test(fieldsText), "App Store fields JSON contains no public release placeholders");
  assert(!placeholderPattern.test(archiveText), "Public site archive manifest contains no public release placeholders");
  releaseEnvKeys.forEach((key) => {
    assert(!isStoreEnvPlaceholder(process.env[key]), `${key} is not detected as a placeholder`);
  });
}

function main() {
  const ready = checkEnvReadiness();

  if (ready) {
    checkGeneratedFiles(expectedPublicValues());
  }

  console.log(`Public release sync checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
