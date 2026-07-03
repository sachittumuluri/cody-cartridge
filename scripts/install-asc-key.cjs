#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const defaultKeyDir = path.join(os.homedir(), ".appstoreconnect", "private_keys");

function usage() {
  return `Usage:
  npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run
  npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8

Validates an App Store Connect API .p8 key and installs it in the default private key directory used by Apple command-line upload tools.`;
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    file: "",
    issuerId: "",
    keyId: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--file" || arg === "--private-key") {
      const value = argv[index + 1];
      index += 1;

      if (!value) {
        throw new Error(`${arg} requires a path.`);
      }

      options.file = value;
      continue;
    }

    if (arg === "--key-id") {
      const value = argv[index + 1];
      index += 1;

      if (!value) {
        throw new Error("--key-id requires a value.");
      }

      options.keyId = value;
      continue;
    }

    if (arg === "--issuer-id") {
      const value = argv[index + 1];
      index += 1;

      if (!value) {
        throw new Error("--issuer-id requires a value.");
      }

      options.issuerId = value;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function isInsideProject(absolutePath) {
  const relative = path.relative(projectRoot, absolutePath);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateOptions(options) {
  const failures = [];

  if (!/^[A-Z0-9]{10}$/.test(options.keyId)) {
    failures.push("App Store Connect API key id must be a 10-character uppercase alphanumeric value.");
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.issuerId)) {
    failures.push("App Store Connect issuer id must be a UUID.");
  }

  if (!options.file) {
    failures.push("--file is required.");
  }

  return failures;
}

function validateSourceFile(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error("App Store Connect private key file does not exist.");
  }

  const stat = fs.lstatSync(absolutePath);

  if (stat.isSymbolicLink()) {
    throw new Error("App Store Connect private key file must not be a symlink.");
  }

  if (!stat.isFile()) {
    throw new Error("App Store Connect private key path must point to a regular file.");
  }

  if (!absolutePath.endsWith(".p8")) {
    throw new Error("App Store Connect private key file must end with .p8.");
  }

  if (isInsideProject(absolutePath)) {
    throw new Error("App Store Connect private key file must live outside the project and handoff archive.");
  }

  const contents = fs.readFileSync(absolutePath, "utf8");

  if (!/-----BEGIN PRIVATE KEY-----/.test(contents) || !/-----END PRIVATE KEY-----/.test(contents)) {
    throw new Error("App Store Connect private key file does not look like a PEM private key.");
  }

  if (Buffer.byteLength(contents, "utf8") <= 200) {
    throw new Error("App Store Connect private key file is too small to be usable.");
  }

  return absolutePath;
}

function validateInstallDirectory({ create = false } = {}) {
  if (!fs.existsSync(defaultKeyDir)) {
    if (!create) {
      return;
    }

    fs.mkdirSync(defaultKeyDir, { recursive: true, mode: 0o700 });
  } else {
    const linkStat = fs.lstatSync(defaultKeyDir);

    if (linkStat.isSymbolicLink()) {
      throw new Error("App Store Connect private key directory must not be a symlink.");
    }

    if (!linkStat.isDirectory()) {
      throw new Error("App Store Connect private key directory path must be a directory.");
    }
  }

  const realInstallDir = fs.realpathSync(defaultKeyDir);

  if (isInsideProject(realInstallDir)) {
    throw new Error("App Store Connect private key directory must resolve outside the project and handoff archive.");
  }

  if (create) {
    fs.chmodSync(defaultKeyDir, 0o700);
  }
}

function validateDestinationFile(destinationPath) {
  if (!fs.existsSync(destinationPath)) {
    return;
  }

  const stat = fs.lstatSync(destinationPath);

  if (stat.isSymbolicLink()) {
    throw new Error("Installed App Store Connect private key destination must not be a symlink.");
  }

  if (!stat.isFile()) {
    throw new Error("Installed App Store Connect private key destination must be a regular file.");
  }
}

function installKey(sourcePath, keyId) {
  validateInstallDirectory({ create: true });

  const destinationPath = path.join(defaultKeyDir, `AuthKey_${keyId}.p8`);
  validateDestinationFile(destinationPath);

  fs.copyFileSync(sourcePath, destinationPath);
  fs.chmodSync(destinationPath, 0o600);
}

function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return;
  }

  const optionFailures = validateOptions(options);

  if (optionFailures.length > 0) {
    optionFailures.forEach(fail);
    return;
  }

  let sourcePath;

  try {
    sourcePath = validateSourceFile(options.file);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  pass("App Store Connect API key id format looks valid");
  pass("App Store Connect issuer id format looks valid");
  pass("App Store Connect private key file is a regular .p8 file outside the project");
  pass("App Store Connect private key file has a PEM private-key envelope");

  if (options.dryRun) {
    try {
      validateInstallDirectory();
      validateDestinationFile(path.join(defaultKeyDir, `AuthKey_${options.keyId}.p8`));
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return;
    }

    pass("App Store Connect private key install destination is safe");
    console.log("App Store Connect key install dry-run: no files were written.");
    console.log("INFO Destination would be ~/.appstoreconnect/private_keys/AuthKey_<key-id>.p8");
    return;
  }

  installKey(sourcePath, options.keyId);
  pass("Installed App Store Connect private key with private file permissions");
  console.log("INFO Destination: ~/.appstoreconnect/private_keys/AuthKey_<key-id>.p8");
  console.log("INFO Export ASC_KEY_ID and ASC_ISSUER_ID in the release shell, then run npm run check:upload-credentials -- --strict.");
}

main();
