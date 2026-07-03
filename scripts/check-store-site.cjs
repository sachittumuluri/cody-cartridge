#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { isHttpsOrigin, isReleaseStoreEnvValue, loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
loadStoreEnv(projectRoot);

const siteDir = path.join(projectRoot, "app-store-assets", "site");
const strict = process.argv.includes("--strict");
const pages = [
  "index.html",
  "privacy.html",
  "support.html",
  "accessibility.html",
  "third-party-notices.html"
];
const requiredFiles = [...pages, "robots.txt", "sitemap.xml", "README.txt", "_headers", "vercel.json"];
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
    fail(message);
  } else {
    warnings.push(message);
  }
}

function readSiteFile(fileName) {
  return fs.readFileSync(path.join(siteDir, fileName), "utf8");
}

function existsSiteFile(fileName) {
  return fs.existsSync(path.join(siteDir, fileName));
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
}

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com/i.test(String(value ?? ""));
}

function unique(values) {
  return [...new Set(values)];
}

function extractHrefs(html) {
  return [...html.matchAll(/\shref="([^"]+)"/g)].map((match) => match[1]);
}

function publicFileUrl(fileName) {
  const rawSiteUrl = String(process.env.CODY_SITE_URL ?? "");

  if (!isReleaseStoreEnvValue("CODY_SITE_URL", rawSiteUrl) || isPlaceholder(rawSiteUrl)) {
    return `TODO_PUBLIC_SITE_URL/${fileName}`;
  }

  return `${rawSiteUrl.replace(/\/+$/, "")}/${fileName}`;
}

function checkPage(fileName) {
  if (!existsSiteFile(fileName)) {
    fail(`${fileName} is missing`);
    return;
  }

  const html = readSiteFile(fileName);
  const label = `app-store-assets/site/${fileName}`;

  if (html.startsWith("<!doctype html>")) {
    pass(`${label} declares doctype`);
  } else {
    fail(`${label} is missing doctype`);
  }

  if (html.includes('<html lang="en">')) {
    pass(`${label} declares English language`);
  } else {
    fail(`${label} is missing html lang`);
  }

  if (/<meta name="viewport" content="width=device-width, initial-scale=1"/.test(html)) {
    pass(`${label} includes responsive viewport`);
  } else {
    fail(`${label} is missing responsive viewport`);
  }

  if (/<meta name="description" content="[^"]{12,}"/.test(html)) {
    pass(`${label} includes meta description`);
  } else {
    fail(`${label} is missing useful meta description`);
  }

  if (/<title>[^<]+ - Cody Cartridge<\/title>/.test(html)) {
    pass(`${label} includes Cody Cartridge title`);
  } else {
    fail(`${label} is missing Cody Cartridge title`);
  }

  if (html.includes('<nav aria-label="Site">')) {
    pass(`${label} has labeled navigation`);
  } else {
    fail(`${label} is missing labeled navigation`);
  }

  const activeNavLinks = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*href="([^"]+)"/g)].map((match) => match[1]);

  if (activeNavLinks.length === 1 && activeNavLinks[0] === fileName) {
    pass(`${label} has exactly one active nav item`);
  } else {
    fail(`${label} should have exactly one active nav item pointing to ${fileName}`);
  }

  if (html.includes("<main>") && html.includes("</main>")) {
    pass(`${label} has main content landmark`);
  } else {
    fail(`${label} is missing main content landmark`);
  }

  if (!/<script[\s>]/i.test(html)) {
    pass(`${label} is static HTML without script tags`);
  } else {
    fail(`${label} includes script tags`);
  }

  if (html.includes("Cody Cartridge")) {
    pass(`${label} includes app name`);
  } else {
    fail(`${label} does not include app name`);
  }

  const hrefs = unique(extractHrefs(html));
  const brokenInternalLinks = hrefs.filter((href) => {
    if (/^(?:https?:|mailto:|#)/.test(href)) {
      return false;
    }

    return !existsSiteFile(href);
  });

  if (brokenInternalLinks.length === 0) {
    pass(`${label} internal links resolve`);
  } else {
    fail(`${label} has broken internal links: ${brokenInternalLinks.join(", ")}`);
  }

  if (isPlaceholder(html)) {
    warn(`${label} still contains placeholder publish/contact values`);
  } else {
    pass(`${label} has no placeholder publish/contact values`);
  }
}

function checkReadme() {
  if (!existsSiteFile("README.txt")) {
    fail("app-store-assets/site/README.txt is missing");
    return;
  }

  const readme = readSiteFile("README.txt");

  if (readme.includes("Use privacy.html as the App Store Privacy Policy URL.")) {
    pass("Site README identifies Privacy Policy URL file");
  } else {
    fail("Site README is missing Privacy Policy URL guidance");
  }

  if (readme.includes("Use support.html as the App Store Support URL.")) {
    pass("Site README identifies Support URL file");
  } else {
    fail("Site README is missing Support URL guidance");
  }

  if (readme.includes("robots.txt") && readme.includes("sitemap.xml")) {
    pass("Site README identifies crawler companion files");
  } else {
    fail("Site README is missing robots/sitemap publishing guidance");
  }

  if (readme.includes("_headers") && readme.includes("vercel.json")) {
    pass("Site README identifies static host config files");
  } else {
    fail("Site README is missing static host config publishing guidance");
  }
}

function checkPublishValues() {
  const supportEmail = process.env.CODY_SUPPORT_EMAIL ?? "";
  const siteUrl = process.env.CODY_SITE_URL ?? "";

  if (isEmail(supportEmail) && !isPlaceholder(supportEmail)) {
    pass("Support email is publish-ready");
  } else {
    warn("Support email is missing, placeholder, or invalid for public site publishing");
  }

  if (isHttpsOrigin(siteUrl) && !isPlaceholder(siteUrl)) {
    pass("Public site URL origin is publish-ready");
  } else {
    warn("Public site URL origin is missing, placeholder, or invalid for public site publishing");
  }
}

function checkRobots() {
  if (!existsSiteFile("robots.txt")) {
    fail("app-store-assets/site/robots.txt is missing");
    return;
  }

  const robots = readSiteFile("robots.txt");

  if (robots.includes("User-agent: *")) {
    pass("robots.txt declares default user agent");
  } else {
    fail("robots.txt is missing default user agent");
  }

  if (robots.includes("Allow: /")) {
    pass("robots.txt allows public support site crawling");
  } else {
    fail("robots.txt is missing crawl allow rule");
  }

  if (robots.includes(`Sitemap: ${publicFileUrl("sitemap.xml")}`)) {
    pass("robots.txt points at sitemap.xml");
  } else {
    fail("robots.txt sitemap URL does not match current public origin state");
  }

  if (isPlaceholder(robots)) {
    warn("robots.txt still contains placeholder public site URL");
  } else {
    pass("robots.txt has publish-ready sitemap URL");
  }
}

function checkSitemap() {
  if (!existsSiteFile("sitemap.xml")) {
    fail("app-store-assets/site/sitemap.xml is missing");
    return;
  }

  const sitemap = readSiteFile("sitemap.xml");

  if (sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    pass("sitemap.xml declares XML header");
  } else {
    fail("sitemap.xml is missing XML header");
  }

  if (sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')) {
    pass("sitemap.xml declares sitemap namespace");
  } else {
    fail("sitemap.xml is missing sitemap namespace");
  }

  pages.forEach((fileName) => {
    if (sitemap.includes(`<loc>${publicFileUrl(fileName)}</loc>`)) {
      pass(`sitemap.xml includes ${fileName}`);
    } else {
      fail(`sitemap.xml is missing ${fileName}`);
    }
  });

  if (!/<script[\s>]/i.test(sitemap)) {
    pass("sitemap.xml is static XML without script tags");
  } else {
    fail("sitemap.xml includes script tags");
  }

  if (isPlaceholder(sitemap)) {
    warn("sitemap.xml still contains placeholder public site URL");
  } else {
    pass("sitemap.xml has publish-ready URLs");
  }
}

function checkStaticHostConfig() {
  if (!existsSiteFile("_headers")) {
    fail("app-store-assets/site/_headers is missing");
  } else {
    const headers = readSiteFile("_headers");

    if (headers.includes("/*.html") && headers.includes("Content-Type: text/html; charset=utf-8")) {
      pass("_headers declares HTML content type");
    } else {
      fail("_headers is missing HTML content type rule");
    }

    if (headers.includes("/robots.txt") && headers.includes("Content-Type: text/plain; charset=utf-8")) {
      pass("_headers declares robots.txt content type");
    } else {
      fail("_headers is missing robots.txt content type rule");
    }

    if (headers.includes("/sitemap.xml") && headers.includes("Content-Type: application/xml; charset=utf-8")) {
      pass("_headers declares sitemap.xml content type");
    } else {
      fail("_headers is missing sitemap.xml content type rule");
    }

    if (headers.includes("Cache-Control: public, max-age=300") && headers.includes("Cache-Control: public, max-age=3600")) {
      pass("_headers declares public cache policies");
    } else {
      fail("_headers is missing expected cache policies");
    }
  }

  if (!existsSiteFile("vercel.json")) {
    fail("app-store-assets/site/vercel.json is missing");
    return;
  }

  let vercel;

  try {
    vercel = JSON.parse(readSiteFile("vercel.json"));
    pass("vercel.json parses as JSON");
  } catch {
    fail("vercel.json is invalid JSON");
    return;
  }

  const rules = Array.isArray(vercel.headers) ? vercel.headers : [];
  const ruleText = JSON.stringify(rules);

  if (rules.length >= 3) {
    pass("vercel.json declares static header rules");
  } else {
    fail("vercel.json is missing static header rules");
  }

  if (
    ruleText.includes("/(.*\\\\.html)") &&
    ruleText.includes("text/html; charset=utf-8") &&
    ruleText.includes("/robots.txt") &&
    ruleText.includes("text/plain; charset=utf-8") &&
    ruleText.includes("/sitemap.xml") &&
    ruleText.includes("application/xml; charset=utf-8")
  ) {
    pass("vercel.json mirrors required content types");
  } else {
    fail("vercel.json content-type rules do not cover every public-site file class");
  }

  if (ruleText.includes("public, max-age=300") && ruleText.includes("public, max-age=3600")) {
    pass("vercel.json mirrors cache policies");
  } else {
    fail("vercel.json is missing expected cache policies");
  }
}

function main() {
  if (!fs.existsSync(siteDir)) {
    fail("app-store-assets/site is missing; run npm run site:store");
  } else {
    requiredFiles.forEach((fileName) => {
      if (existsSiteFile(fileName)) {
        pass(`app-store-assets/site/${fileName} exists`);
      } else {
        fail(`app-store-assets/site/${fileName} is missing`);
      }
    });
    pages.forEach(checkPage);
    checkReadme();
    checkRobots();
    checkSitemap();
    checkStaticHostConfig();
    checkPublishValues();
  }

  console.log(`Store site checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
