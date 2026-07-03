#!/usr/bin/env node

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
loadStoreEnv(projectRoot);

const strict = process.argv.includes("--strict");
const timeoutMs = Number(process.env.CODY_URL_CHECK_TIMEOUT_MS ?? 8000);
const failures = [];
const warnings = [];
const passes = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function isFullUrl(value) {
  return /^https:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(String(value ?? ""));
}

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com/i.test(String(value ?? ""));
}

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

function requestUrl(url, redirectsRemaining = 3) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const request = client.get(
      parsedUrl,
      {
        headers: {
          "User-Agent": "CodyCartridgeStoreUrlCheck/1.0"
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

        response.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
        });

        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
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

function expectedUrls() {
  const fields = fs.existsSync(path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_FIELDS.json"))
    ? readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json")
    : {};
  const siteUrl = (process.env.CODY_SITE_URL || "").replace(/\/$/, "");

  return [
    {
      label: "Support URL",
      required: true,
      url: fields.productPage?.supportUrl || (siteUrl ? `${siteUrl}/support.html` : ""),
      mustInclude: ["Cody Cartridge", "Import Audio Files"]
    },
    {
      label: "Privacy Policy URL",
      required: true,
      url: fields.productPage?.privacyPolicyUrl || (siteUrl ? `${siteUrl}/privacy.html` : ""),
      mustInclude: ["Cody Cartridge", "does not collect personal data"]
    },
    {
      label: "Accessibility URL",
      required: false,
      url: fields.accessibility?.accessibilityUrl || (siteUrl ? `${siteUrl}/accessibility.html` : ""),
      mustInclude: ["Cody Cartridge", "Reduced Motion"]
    },
    {
      label: "Third-Party Notices URL",
      required: false,
      url: fields.urls?.thirdPartyNoticesUrl || (siteUrl ? `${siteUrl}/third-party-notices.html` : ""),
      mustInclude: ["Cody Cartridge", "Third-Party Notices"]
    }
  ];
}

async function checkUrl(item) {
  if (!item.url || !isFullUrl(item.url) || isPlaceholder(item.url)) {
    const message = `${item.label} is missing, placeholder, or not a complete https URL.`;

    if (item.required) {
      warn(message);
    } else {
      pass(`${item.label} is optional and not published yet`);
    }

    return;
  }

  try {
    const response = await requestUrl(item.url);

    if (response.statusCode < 200 || response.statusCode >= 400) {
      warn(`${item.label} returned HTTP ${response.statusCode}: ${item.url}`);
      return;
    }

    const missing = item.mustInclude.filter((needle) => !response.body.includes(needle));

    if (missing.length > 0) {
      warn(`${item.label} did not include expected content: ${missing.join(", ")}`);
      return;
    }

    if (!response.contentType.includes("text/html")) {
      warn(`${item.label} responded without text/html content type (${response.contentType || "missing"}).`);
    }

    pass(`${item.label} is reachable and contains expected Cody Cartridge content`);
  } catch (error) {
    warn(`${item.label} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  for (const item of expectedUrls()) {
    await checkUrl(item);
  }

  console.log(`Store public URL checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));
  failures.forEach((message) => console.error(`FAIL ${message}`));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  console.error(`FAIL ${failures[failures.length - 1]}`);
  process.exitCode = 1;
});
