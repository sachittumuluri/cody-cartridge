#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const homeDir = os.homedir();

const passes = [];
const warnings = [];
const failures = [];

const keyIdKeys = ["ASC_KEY_ID", "APP_STORE_CONNECT_KEY_ID"];
const issuerIdKeys = ["ASC_ISSUER_ID", "APP_STORE_CONNECT_ISSUER_ID"];
const privateKeyPathKeys = ["ASC_PRIVATE_KEY_PATH", "APP_STORE_CONNECT_PRIVATE_KEY_PATH"];

function pass(message) {
  passes.push(message);
}

function warn(message, strictFailure = false) {
  if (strict && strictFailure) {
    failures.push(message);
  } else {
    warnings.push(message);
  }
}

function credentialValue(keys) {
  for (const key of keys) {
    const value = String(process.env[key] ?? "").trim();

    if (value) {
      return { key, value };
    }
  }

  return { key: null, value: "" };
}

function expandHome(value) {
  if (value === "~") {
    return homeDir;
  }

  if (value.startsWith("~/")) {
    return path.join(homeDir, value.slice(2));
  }

  return value;
}

function isInsideProject(absolutePath) {
  const relative = path.relative(projectRoot, absolutePath);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function checkKeyId() {
  const keyId = credentialValue(keyIdKeys);

  if (!keyId.value) {
    warn(`App Store Connect API key id env is missing; set ${keyIdKeys.join(" or ")}`, true);
    return keyId;
  }

  pass(`App Store Connect API key id env is set via ${keyId.key}`);

  if (/^[A-Z0-9]{10}$/.test(keyId.value)) {
    pass("App Store Connect API key id format looks valid");
  } else {
    warn("App Store Connect API key id must be a 10-character uppercase alphanumeric value", true);
  }

  return keyId;
}

function checkIssuerId() {
  const issuerId = credentialValue(issuerIdKeys);

  if (!issuerId.value) {
    warn(`App Store Connect issuer id env is missing; set ${issuerIdKeys.join(" or ")}`, true);
    return issuerId;
  }

  pass(`App Store Connect issuer id env is set via ${issuerId.key}`);

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(issuerId.value)) {
    pass("App Store Connect issuer id format looks valid");
  } else {
    warn("App Store Connect issuer id must be a UUID", true);
  }

  return issuerId;
}

function privateKeyCandidate(keyId) {
  const configured = credentialValue(privateKeyPathKeys);

  if (configured.value) {
    return {
      source: configured.key,
      value: configured.value,
      absolutePath: path.resolve(projectRoot, expandHome(configured.value)),
      configured: true
    };
  }

  if (keyId.value) {
    const defaultPath = path.join(homeDir, ".appstoreconnect", "private_keys", `AuthKey_${keyId.value}.p8`);

    return {
      source: "~/.appstoreconnect/private_keys/AuthKey_<key-id>.p8",
      value: defaultPath,
      absolutePath: defaultPath,
      configured: false
    };
  }

  return null;
}

function checkPrivateKey(keyId) {
  const candidate = privateKeyCandidate(keyId);

  if (!candidate) {
    warn(`App Store Connect private key path is missing; set ${privateKeyPathKeys.join(" or ")}`, true);
    return;
  }

  if (candidate.configured) {
    pass(`App Store Connect private key path env is set via ${candidate.source}`);
  } else {
    pass("App Store Connect private key default path can be derived from the key id");
  }

  if (!path.isAbsolute(expandHome(candidate.value))) {
    warn("App Store Connect private key path should be absolute or home-relative", true);
  } else {
    pass("App Store Connect private key path is absolute or home-relative");
  }

  if (isInsideProject(candidate.absolutePath)) {
    warn("App Store Connect private key file must live outside the project and handoff archive", true);
  } else {
    pass("App Store Connect private key file is outside the project");
  }

  if (!candidate.absolutePath.endsWith(".p8")) {
    warn("App Store Connect private key file should use the .p8 extension", true);
  } else {
    pass("App Store Connect private key path uses the .p8 extension");
  }

  let stat;

  try {
    stat = fs.lstatSync(candidate.absolutePath);
  } catch {
    warn(
      candidate.configured
        ? "App Store Connect private key file does not exist at the configured path"
        : "App Store Connect private key file was not found in the default key directory",
      true
    );
    return;
  }

  if (stat.isSymbolicLink()) {
    warn("App Store Connect private key file must not be a symlink", true);
    return;
  }

  if (!stat.isFile()) {
    warn("App Store Connect private key path must point to a regular file", true);
    return;
  }

  pass("App Store Connect private key path points to a regular file");

  if ((stat.mode & 0o077) === 0) {
    pass("App Store Connect private key file permissions are private");
  } else {
    warn("App Store Connect private key file should be readable only by the current user; run chmod 600 on it", true);
  }

  let contents = "";

  try {
    contents = fs.readFileSync(candidate.absolutePath, "utf8");
  } catch {
    warn("App Store Connect private key file is not readable by this process", true);
    return;
  }

  if (/-----BEGIN PRIVATE KEY-----/.test(contents) && /-----END PRIVATE KEY-----/.test(contents)) {
    pass("App Store Connect private key file has a PEM private-key envelope");
  } else {
    warn("App Store Connect private key file does not look like a PEM private key", true);
  }

  if (Buffer.byteLength(contents, "utf8") > 200) {
    pass("App Store Connect private key file is non-empty");
  } else {
    warn("App Store Connect private key file is too small to be a usable private key", true);
  }
}

function main() {
  const keyId = checkKeyId();
  checkIssuerId();
  checkPrivateKey(keyId);

  console.log(
    `App Store upload credential checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`
  );
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));
  failures.forEach((message) => console.error(`FAIL ${message}`));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
