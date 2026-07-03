#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const failures = [];
const passes = [];

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

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

function extractBlock(text, startMarker, endMarkers = []) {
  const startIndex = text.indexOf(startMarker);

  if (startIndex === -1) {
    return "";
  }

  const contentStart = startIndex + startMarker.length;
  const endIndex = endMarkers.reduce((currentEnd, marker) => {
    const markerIndex = text.indexOf(marker, contentStart);
    return markerIndex === -1 ? currentEnd : Math.min(currentEnd, markerIndex);
  }, text.length);

  return text.slice(contentStart, endIndex).trim();
}

function assertFieldLimit(value, limit, label, unit = "characters") {
  const actual = unit === "bytes" ? byteLength(value) : String(value ?? "").length;
  assert(actual > 0 && actual <= limit, `${label} is within ${limit} ${unit}`);
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function includesClaim(value, claim, label) {
  assert(normalizeWhitespace(value).toLowerCase().includes(claim.toLowerCase()), label);
}

function checkKeywords(value) {
  const rawKeywords = String(value ?? "");
  const keywords = rawKeywords.split(",").map((item) => item.trim()).filter(Boolean);
  const normalized = keywords.map((item) => item.toLowerCase());
  const duplicates = normalized.filter((keyword, index) => normalized.indexOf(keyword) !== index);

  assert(rawKeywords.length > 0, "Keywords are present");
  assert(byteLength(rawKeywords) <= 100, "Keywords are within the 100-byte App Store limit");
  assert(keywords.length >= 6, "Keywords include enough search terms for useful discovery");
  assert(duplicates.length === 0, "Keywords do not contain duplicates");
  assert(!rawKeywords.includes(", "), "Keywords are comma-separated without spaces");
  assert(!keywords.some((keyword) => keyword.length > 24), "Each keyword remains short enough to scan");
  assert(keywords.includes("music"), "Keywords include music");
  assert(keywords.includes("player"), "Keywords include player");
  assert(keywords.includes("local"), "Keywords include local");
}

function main() {
  const listing = readText("app-store-assets/APP_STORE_LISTING.md");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");

  const source = {
    category: extractBlock(listing, "Category:", ["\n\nCopyright:"]),
    copyright: extractBlock(listing, "Copyright:", ["\n\n## URLs To Publish Before Submission"]),
    description: extractBlock(listing, "Description:", ["\n\nFeatures:"]),
    keywords: extractBlock(listing, "Keywords:", ["\n\nCategory:"]),
    name: extractBlock(listing, "Name:", ["\n\nSubtitle:"]),
    promotionalText: extractBlock(listing, "Promotional text:", ["\n\nDescription:"]),
    reviewNotes: extractBlock(listing, "## App Review Notes", ["\n\n## Screenshot Plan"]),
    subtitle: extractBlock(listing, "Subtitle:", ["\n\nPromotional text:"])
  };

  assert(isNonEmptyString(source.name), "Listing source includes app name");
  assert(isNonEmptyString(source.subtitle), "Listing source includes subtitle");
  assert(isNonEmptyString(source.promotionalText), "Listing source includes promotional text");
  assert(isNonEmptyString(source.description), "Listing source includes description");
  assert(isNonEmptyString(source.keywords), "Listing source includes keywords");
  assert(isNonEmptyString(source.reviewNotes), "Listing source includes App Review notes");

  assert(fields.productPage?.name === source.name, "Generated app name matches listing source");
  assert(fields.productPage?.subtitle === source.subtitle, "Generated subtitle matches listing source");
  assert(fields.productPage?.promotionalText === source.promotionalText, "Generated promotional text matches listing source");
  assert(fields.productPage?.description === source.description, "Generated description matches listing source");
  assert(fields.productPage?.keywords === source.keywords, "Generated keywords match listing source");
  assert(fields.review?.notes === source.reviewNotes, "Generated App Review notes match listing source");

  assertFieldLimit(fields.productPage?.name, 30, "App name");
  assertFieldLimit(fields.productPage?.subtitle, 30, "Subtitle");
  assertFieldLimit(fields.productPage?.promotionalText, 170, "Promotional text");
  assertFieldLimit(fields.productPage?.description, 4000, "Description");
  assertFieldLimit(fields.review?.notes, 4000, "App Review notes");
  assertFieldLimit(fields.testFlight?.betaAppDescription, 4000, "TestFlight beta app description");
  assertFieldLimit(fields.distribution?.futureWhatsNew, 4000, "Future What's New draft");
  checkKeywords(fields.productPage?.keywords);

  includesClaim(fields.productPage?.description, "does not download music", "Description states the app does not download music");
  includesClaim(fields.productPage?.description, "does not download music, scrape streaming services", "Description rejects scraping and streaming-service downloads");
  includesClaim(fields.review?.notes, "does not download music, scrape YouTube Music", "Review notes reject YouTube Music scraping/downloads");
  includesClaim(fields.review?.notes, "Store screenshots are captured from `?store-demo=1`", "Review notes disclose synthetic store-demo screenshots");
  includesClaim(fields.review?.notes, "Sandbox file access is intentionally read-only", "Review notes explain sandbox file access");
  includesClaim(fields.privacy?.appPrivacyDataCollection, "does not collect data", "Privacy answer states no data collection");
  includesClaim(fields.rightsAndCompliance?.contentRights, "ships without music", "Content-rights answer states the app ships without music");
  includesClaim(fields.rightsAndCompliance?.contentRights, "plays only user-selected files", "Content-rights answer limits playback to user-selected files");
  includesClaim(fields.rightsAndCompliance?.exportCompliance, "no custom or proprietary encryption", "Export-compliance answer states no custom/proprietary encryption");
  includesClaim(fields.rightsAndCompliance?.exportCompliance, "Apple operating system", "Export-compliance answer references Apple operating system encryption guidance");
  assert(fields.exportCompliance?.artifactPath === "app-store-assets/EXPORT_COMPLIANCE.json", "Generated fields include export-compliance artifact path");
  assert(fields.exportCompliance?.evidence?.infoPlistExportKey === false || fields.exportCompliance?.appStoreConnect?.infoPlistKey?.includes("ITSAppUsesNonExemptEncryption=false"), "Generated fields include Info.plist non-exempt-encryption key");
  assert(
    fields.exportCompliance?.appStoreConnect?.sourceUrls?.includes(
      "https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/"
    ),
    "Generated fields include Apple export-compliance documentation source"
  );

  assert(Array.isArray(fields.review?.testInstructions) && fields.review.testInstructions.length >= 6, "Review test instructions are complete enough for App Review");
  assert(
    fields.review.testInstructions.some((item) => item.includes("Import Audio Files")) &&
      fields.review.testInstructions.some((item) => item.includes("Reset Local Library")),
    "Review test instructions cover import and reset flows"
  );

  assert(
    Array.isArray(fields.testFlight?.whatToTest) &&
      fields.testFlight.whatToTest.some((item) => item.includes("Confirm there is no music download")),
    "TestFlight notes include no-download/no-scraping verification"
  );
  assert(
    Array.isArray(fields.submission?.appReviewSubmission?.postSubmitMonitoring) &&
      fields.submission.appReviewSubmission.postSubmitMonitoring.some((item) => item.includes("App Review")) &&
      fields.submission.appReviewSubmission.postSubmitMonitoring.some((item) => item.includes("strict preflight")),
    "App Review submission includes post-submit monitoring guidance"
  );

  const audit = fields.fieldAudit ?? {};
  assert(audit.promotionalTextCharacters === String(fields.productPage?.promotionalText ?? "").length, "Field audit promotional-text count matches generated field");
  assert(audit.descriptionCharacters === String(fields.productPage?.description ?? "").length, "Field audit description count matches generated field");
  assert(audit.keywordsBytes === byteLength(fields.productPage?.keywords), "Field audit keyword byte count matches generated field");
  assert(audit.reviewNotesCharacters === String(fields.review?.notes ?? "").length, "Field audit review-note count matches generated field");

  console.log(`Store copy checks: ${passes.length} passed, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
