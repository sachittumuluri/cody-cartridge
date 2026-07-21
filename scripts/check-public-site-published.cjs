#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
loadStoreEnv(projectRoot);

const strict = process.argv.includes("--strict");
const timeoutMs = Number(process.env.CODY_PUBLISHED_SITE_TIMEOUT_MS ?? process.env.CODY_URL_CHECK_TIMEOUT_MS ?? 8000);
const bodyLimitBytes = Number(process.env.CODY_PUBLISHED_SITE_BODY_LIMIT_BYTES ?? 2_000_000);
const packetPath = "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json";
const passes = [];
const warnings = [];
const failures = [];

const pageNeedles = {
  home: ["local-first music player", "Import Your Files"],
  support: ["Import Audio Files", "Troubleshooting"],
  privacy: ["does not collect personal data", "Local Data The App Uses"],
  accessibility: ["Reduced Motion", "Keyboard"],
  "third-party-notices": ["Third-Party Notices", "Direct Runtime Dependencies"]
};

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

function readJson(relativePath, fallback = null) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath));
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function isHttpsUrl(value) {
  return /^https:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(String(value ?? ""));
}

function isPlaceholderUrl(value) {
  return /TODO_|TODO:|pending-public-site-url|https:\/\/example\.com/i.test(String(value ?? ""));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizedHtml(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function titleFromHtml(value) {
  return String(value ?? "").match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
}

function requestUrl(url, redirectsRemaining = 3) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const request = client.get(
      parsedUrl,
      {
        headers: {
          "Accept": "text/html,application/xhtml+xml,text/plain,application/xml,text/xml,*/*",
          "Accept-Encoding": "identity",
          "User-Agent": "CodyCartridgePublishedSiteCheck/1.0"
        },
        timeout: timeoutMs
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location && redirectsRemaining > 0) {
          response.resume();
          const nextUrl = new URL(location, parsedUrl).toString();
          requestUrl(nextUrl, redirectsRemaining - 1).then(resolve, reject);
          return;
        }

        const chunks = [];
        let totalBytes = 0;

        response.on("data", (chunk) => {
          const buffer = Buffer.from(chunk);
          totalBytes += buffer.length;

          if (totalBytes > bodyLimitBytes) {
            response.destroy(new Error(`Response exceeded ${bodyLimitBytes} byte limit`));
            return;
          }

          chunks.push(buffer);
        });

        response.on("end", () => {
          const bodyBuffer = Buffer.concat(chunks);

          resolve({
            body: bodyBuffer.toString("utf8"),
            bodyBuffer,
            contentType: String(response.headers["content-type"] ?? ""),
            finalUrl: parsedUrl.toString(),
            statusCode
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    });

    request.on("error", reject);
  });
}

function expectedNeedles(page, sourceHtml) {
  return ["Cody Cartridge", titleFromHtml(sourceHtml), ...(pageNeedles[page.id] ?? [page.label])]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function expectedMimeType(record, fallback) {
  return String(record.expectedContentType ?? fallback ?? "")
    .split(";")[0]
    .trim();
}

function checkPublishedContentType(record, response, fallbackMime) {
  const expectedMime = expectedMimeType(record, fallbackMime);

  if (!expectedMime) {
    warn(`${record.fileName} has no expected content type recorded`);
    return;
  }

  if (response.contentType.includes(expectedMime)) {
    pass(`${record.fileName} served ${expectedMime}`);
  } else {
    warn(`${record.fileName} responded without ${expectedMime} content type (${response.contentType || "missing"})`);
  }
}

function comparePublishedBody(page, response, sourceBuffer) {
  const exactHash = sha256(response.bodyBuffer);
  const sourceHash = sha256(sourceBuffer);

  if (exactHash === sourceHash) {
    pass(`${page.fileName} published body exactly matches generated source`);
    return;
  }

  const normalizedPublishedHash = sha256(Buffer.from(normalizedHtml(response.body), "utf8"));
  const normalizedSourceHash = sha256(Buffer.from(normalizedHtml(sourceBuffer.toString("utf8")), "utf8"));

  if (normalizedPublishedHash === normalizedSourceHash) {
    pass(`${page.fileName} published body matches generated source after newline/edge whitespace normalization`);
    return;
  }

  warn(`${page.fileName} published body hash does not match generated source`);
}

async function checkPage(page) {
  const sourcePath = page.sourcePath ?? `app-store-assets/site/${page.fileName}`;

  if (!exists(sourcePath)) {
    warn(`${page.fileName} source file is missing at ${sourcePath}`);
    return;
  }

  const expectedUrl = page.expectedUrl;

  if (!isHttpsUrl(expectedUrl) || isPlaceholderUrl(expectedUrl)) {
    warn(`${page.fileName} expected URL is missing, placeholder, or not HTTPS`);
    return;
  }

  const sourceBuffer = readFile(sourcePath);
  const sourceHtml = sourceBuffer.toString("utf8");

  try {
    const response = await requestUrl(expectedUrl);

    if (!response.finalUrl.startsWith("https://")) {
      warn(`${page.fileName} resolved to non-HTTPS final URL: ${response.finalUrl}`);
      return;
    }

    if (response.statusCode < 200 || response.statusCode >= 400) {
      warn(`${page.fileName} returned HTTP ${response.statusCode}: ${expectedUrl}`);
      return;
    }

    pass(`${page.fileName} returned HTTP ${response.statusCode}`);
    checkPublishedContentType(page, response, "text/html");

    const missingNeedles = expectedNeedles(page, sourceHtml).filter((needle) => !response.body.includes(needle));

    if (missingNeedles.length > 0) {
      warn(`${page.fileName} is missing expected page text: ${missingNeedles.join(", ")}`);
    } else {
      pass(`${page.fileName} contains expected Cody Cartridge page text`);
    }

    comparePublishedBody(page, response, sourceBuffer);
  } catch (error) {
    warn(`${page.fileName} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function companionNeedles(file) {
  if (file.fileName === "robots.txt") {
    return ["User-agent: *", "Allow: /", "Sitemap:"];
  }

  if (file.fileName === "sitemap.xml") {
    return ['<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', "/index.html", "/support.html", "/privacy.html"];
  }

  return [file.fileName];
}

async function checkCompanionFile(file) {
  const sourcePath = file.sourcePath ?? `app-store-assets/site/${file.fileName}`;

  if (!exists(sourcePath)) {
    warn(`${file.fileName} source file is missing at ${sourcePath}`);
    return;
  }

  const expectedUrl = file.expectedUrl;

  if (!isHttpsUrl(expectedUrl) || isPlaceholderUrl(expectedUrl)) {
    warn(`${file.fileName} expected URL is missing, placeholder, or not HTTPS`);
    return;
  }

  const sourceBuffer = readFile(sourcePath);

  try {
    const response = await requestUrl(expectedUrl);

    if (!response.finalUrl.startsWith("https://")) {
      warn(`${file.fileName} resolved to non-HTTPS final URL: ${response.finalUrl}`);
      return;
    }

    if (response.statusCode < 200 || response.statusCode >= 400) {
      warn(`${file.fileName} returned HTTP ${response.statusCode}: ${expectedUrl}`);
      return;
    }

    pass(`${file.fileName} returned HTTP ${response.statusCode}`);
    checkPublishedContentType(file, response, file.fileName === "sitemap.xml" ? "application/xml" : "text/plain");

    const missingNeedles = companionNeedles(file).filter((needle) => !response.body.includes(needle));

    if (missingNeedles.length > 0) {
      warn(`${file.fileName} is missing expected text: ${missingNeedles.join(", ")}`);
    } else {
      pass(`${file.fileName} contains expected public-site metadata`);
    }

    comparePublishedBody(file, response, sourceBuffer);
  } catch (error) {
    warn(`${file.fileName} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const packet = readJson(packetPath);

  assert(Boolean(packet), "Public site publish packet exists");

  if (!packet) {
    return;
  }

  const pages = packet.pages ?? [];

  assert(pages.length > 0, "Public site publish packet lists pages");

  if (packet.summary?.publishStatus !== "ready") {
    warn(`Public site publish packet is ${packet.summary?.publishStatus ?? "missing status"} before live verification`);
  } else {
    pass("Public site publish packet is ready for live verification");
  }

  for (const page of pages) {
    await checkPage(page);
  }

  for (const file of packet.companionFiles ?? []) {
    await checkCompanionFile(file);
  }
}

main()
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    console.log(`Published public site checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
    passes.forEach((message) => console.log(`PASS ${message}`));
    warnings.forEach((message) => console.warn(`WARN ${message}`));
    failures.forEach((message) => console.error(`FAIL ${message}`));

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  });
