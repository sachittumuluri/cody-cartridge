#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const passes = [];
const failures = [];

const documents = [
  {
    file: "PRIVACY_POLICY.md",
    menuLabel: "Privacy Policy",
    siteFile: "privacy.html",
    title: "Cody Cartridge Privacy Policy Draft",
    phrases: [
      "does not collect personal data",
      "does not provide, download, scrape, or redistribute music",
      "File > Reset Local Library"
    ]
  },
  {
    file: "SUPPORT.md",
    menuLabel: "Support",
    siteFile: "support.html",
    title: "Cody Cartridge Support Draft",
    phrases: ["Use File > Import Audio Files", "How do I import YouTube Music metadata?", "File > Reset Local Library"]
  },
  {
    file: "ACCESSIBILITY.md",
    menuLabel: "Accessibility",
    siteFile: "accessibility.html",
    title: "Cody Cartridge Accessibility",
    phrases: ["Reduced Motion", "Keyboard And Screen Reader Support", "VoiceOver"]
  },
  {
    file: "THIRD_PARTY_NOTICES.md",
    menuLabel: "Third-Party Notices",
    siteFile: "third-party-notices.html",
    title: "Cody Cartridge Third-Party Notices",
    phrases: ["Direct Runtime Dependencies", "react ", "music-metadata"]
  }
];

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
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

function assertIncludes(text, needle, message) {
  assert(text.includes(needle), message);
}

function checkMarkdownDocument(document) {
  const relativePath = path.join("app-store-assets", document.file);

  assert(exists(relativePath), `${document.file} exists`);

  if (!exists(relativePath)) {
    return;
  }

  const markdown = readText(relativePath);
  assert(markdown.startsWith(`# ${document.title}`), `${document.file} starts with expected H1`);
  assert(markdown.length >= 180, `${document.file} has substantive content`);
  assert(!markdown.includes("This document is unavailable"), `${document.file} is not the fallback missing-document body`);

  document.phrases.forEach((phrase) => {
    assertIncludes(markdown, phrase, `${document.file} includes "${phrase}"`);
  });
}

function checkSiteDocument(document) {
  const relativePath = path.join("app-store-assets", "site", document.siteFile);

  assert(exists(relativePath), `${document.siteFile} generated public page exists`);

  if (!exists(relativePath)) {
    return;
  }

  const html = readText(relativePath);
  assertIncludes(html, "<!doctype html>", `${document.siteFile} declares doctype`);
  assertIncludes(html, `<h1>${document.title}</h1>`, `${document.siteFile} renders expected H1`);
  assertIncludes(html, 'nav aria-label="Site"', `${document.siteFile} keeps store page navigation`);
  assert(!/<script[\s>]/i.test(html), `${document.siteFile} remains static without scripts`);
}

function checkElectronMappings(mainSource) {
  documents.forEach((document) => {
    assertIncludes(mainSource, `label: "${document.menuLabel}"`, `Help menu includes ${document.menuLabel}`);
    assertIncludes(mainSource, `resourceFileName: "${document.file}"`, `Help menu maps ${document.menuLabel} to ${document.file}`);
    assertIncludes(mainSource, `title: "${document.menuLabel}"`, `Help menu document title is ${document.menuLabel}`);
  });

  assertIncludes(mainSource, "readBundledMarkdown", "Electron shell reads bundled markdown documents");
  assertIncludes(mainSource, "renderDocumentWindowHtml", "Electron shell renders local document windows");
  assertIncludes(mainSource, "default-src 'none'; style-src 'unsafe-inline'", "Help document windows use document CSP");
  assertIncludes(mainSource, "configureSessionSecurity(documentWindow.webContents.session)", "Help document windows install session guard");
  assertIncludes(mainSource, "configureWebContentsSecurity(documentWindow.webContents, isDocumentWindowNavigationAllowed)", "Help document windows guard navigation");
  assertIncludes(mainSource, "showPrivacySummary", "Help menu exposes privacy summary dialog");
  assertIncludes(mainSource, "does not download music", "Privacy summary repeats no-download claim");
  assertIncludes(mainSource, "scrape streaming services", "Privacy summary repeats no-scraping claim");
}

function checkPackageResources(packageJson) {
  const resources = JSON.stringify(packageJson.build?.extraResources ?? []);

  documents.forEach((document) => {
    assertIncludes(resources, `app-store-assets/${document.file}`, `${document.file} is configured as packaged extraResource source`);
    assertIncludes(resources, `"to":"${document.file}"`, `${document.file} is configured as packaged extraResource target`);
  });
}

function main() {
  const packageJson = JSON.parse(readText("package.json"));
  const mainSource = readText("electron/main.cjs");

  documents.forEach(checkMarkdownDocument);
  documents.forEach(checkSiteDocument);
  checkElectronMappings(mainSource);
  checkPackageResources(packageJson);

  console.log(`Help document checks: ${passes.length} passed, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
