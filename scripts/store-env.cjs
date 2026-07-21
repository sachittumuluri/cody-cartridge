const fs = require("node:fs");
const path = require("node:path");

const storeEnvFiles = ["app-store-assets/site.env", "app-store-assets/site.env.local"];
const releaseEnvKeys = [
  "CODY_SITE_URL",
  "CODY_SUPPORT_EMAIL",
  "CODY_REVIEW_CONTACT_NAME",
  "CODY_REVIEW_CONTACT_EMAIL",
  "CODY_REVIEW_CONTACT_PHONE"
];

function unescapeDoubleQuotedEnvValue(value) {
  let output = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];

    if (character === "\\" && nextCharacter && ['"', "\\", "$", "`"].includes(nextCharacter)) {
      output += nextCharacter;
      index += 1;
      continue;
    }

    output += character;
  }

  return output;
}

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const equalsIndex = trimmed.indexOf("=");

  if (equalsIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();

  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    return null;
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    value = unescapeDoubleQuotedEnvValue(value.slice(1, -1));
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadStoreEnv(projectRoot) {
  const loadedFiles = [];
  const shellProvidedKeys = new Set(Object.keys(process.env));

  for (const relativePath of storeEnvFiles) {
    const absolutePath = path.join(projectRoot, relativePath);

    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const contents = fs.readFileSync(absolutePath, "utf8");

    for (const line of contents.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);

      if (!parsed) {
        continue;
      }

      if (!shellProvidedKeys.has(parsed.key)) {
        process.env[parsed.key] = parsed.value;
      }
    }

    loadedFiles.push(relativePath);
  }

  return loadedFiles;
}

function normalizedHttpsOrigin(value) {
  // Accepts an HTTPS base URL: a bare origin, or an origin plus a stable
  // path (GitHub Pages project sites always live under a path). Query,
  // hash, and credentials are still rejected.
  const trimmedValue = String(value ?? "").trim();

  if (!trimmedValue || /[\r\n]/.test(trimmedValue)) {
    return null;
  }

  try {
    const parsed = new URL(trimmedValue);

    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }

    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return null;
  }
}

function isHttpsOrigin(value) {
  return Boolean(normalizedHttpsOrigin(value));
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
}

function isPhone(value) {
  return /^\+?[0-9][0-9 ().-]{6,}[0-9]$/.test(String(value ?? ""));
}

function isStoreEnvPlaceholder(value) {
  return /TODO_|TODO:|^(?:TODO|your name|you@example\.com|https:\/\/example\.com|\+1-555-555-5555)$/i.test(
    String(value ?? "").trim()
  );
}

function isReleaseStoreEnvValue(key, value) {
  const trimmedValue = String(value ?? "").trim();

  if (!trimmedValue || /[\r\n]/.test(trimmedValue) || isStoreEnvPlaceholder(trimmedValue)) {
    return false;
  }

  if (key === "CODY_SITE_URL") {
    return isHttpsOrigin(trimmedValue);
  }

  if (key === "CODY_SUPPORT_EMAIL" || key === "CODY_REVIEW_CONTACT_EMAIL") {
    return isEmail(trimmedValue);
  }

  if (key === "CODY_REVIEW_CONTACT_NAME") {
    return trimmedValue.length >= 2;
  }

  if (key === "CODY_REVIEW_CONTACT_PHONE") {
    return isPhone(trimmedValue);
  }

  return true;
}

function getReleaseStoreEnvValue(key, fallbackValue) {
  const value = process.env[key];

  return isReleaseStoreEnvValue(key, value) ? String(value).trim() : fallbackValue;
}

module.exports = {
  getReleaseStoreEnvValue,
  isHttpsOrigin,
  isReleaseStoreEnvValue,
  isStoreEnvPlaceholder,
  loadStoreEnv,
  normalizedHttpsOrigin,
  parseEnvLine,
  unescapeDoubleQuotedEnvValue,
  releaseEnvKeys,
  storeEnvFiles
};
