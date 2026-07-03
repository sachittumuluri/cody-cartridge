#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

const passes = [];
const warnings = [];
const failures = [];
const notes = [];

function pass(message) {
  passes.push(message);
}

function note(message) {
  notes.push(message);
}

function warn(message, strictFailure = false) {
  if (strict && strictFailure) {
    failures.push(message);
  } else {
    warnings.push(message);
  }
}

function commandPath(command) {
  const result = spawnSync("xcrun", ["--find", command], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0 || result.error) {
    return null;
  }

  return result.stdout.trim() || null;
}

function findTransporterApp() {
  return ["/Applications/Transporter.app", path.join(process.env.HOME || "", "Applications", "Transporter.app")].find((appPath) =>
    fs.existsSync(appPath)
  );
}

function findMasUploadPackages() {
  const distRoot = path.join(projectRoot, "dist");

  if (!fs.existsSync(distRoot)) {
    return [];
  }

  const packages = [];
  const stack = [distRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    entries.forEach((entry) => {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        return;
      }

      if (entry.isFile() && entry.name.endsWith(".pkg") && /cody|cartridge/i.test(entry.name)) {
        packages.push(path.relative(projectRoot, entryPath));
      }
    });
  }

  return packages.sort();
}

function sha256(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(projectRoot, relativePath))).digest("hex");
}

function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function currentPackageTokens() {
  return [...new Set([pkg.version, pkg.build?.buildVersion ?? pkg.version].filter(Boolean))];
}

function packageMatchesCurrentApp(relativePath) {
  const fileName = path.basename(relativePath).toLowerCase();
  const normalizedFileName = normalizeToken(fileName);

  return currentPackageTokens().some((token) => {
    const normalizedToken = normalizeToken(token);

    return fileName.includes(String(token).toLowerCase()) || Boolean(normalizedToken && normalizedFileName.includes(normalizedToken));
  });
}

function packageSignatureVerified(relativePath) {
  const result = spawnSync("pkgutil", ["--check-signature", path.join(projectRoot, relativePath)], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    available: !result.error || result.error.code !== "ENOENT",
    status: typeof result.status === "number" ? result.status : null,
    ok: result.status === 0
  };
}

function main() {
  if (process.platform === "darwin") {
    pass("Release upload tooling check is running on macOS");
  } else {
    warn("App Store upload tooling check is not running on macOS", true);
  }

  const transporterApp = findTransporterApp();
  const altoolPath = commandPath("altool");
  const iTMSTransporterPath = commandPath("iTMSTransporter");
  const uploadPackages = findMasUploadPackages();

  if (transporterApp) {
    pass(`Transporter app is installed at ${transporterApp}`);
  } else {
    warn("Transporter app is not installed in /Applications");
  }

  if (altoolPath) {
    pass(`xcrun can find altool at ${altoolPath}`);
  } else {
    warn("xcrun cannot find altool");
  }

  if (iTMSTransporterPath) {
    pass(`xcrun can find iTMSTransporter at ${iTMSTransporterPath}`);
  } else {
    warn("xcrun cannot find iTMSTransporter");
  }

  if (transporterApp || altoolPath || iTMSTransporterPath) {
    pass("At least one App Store Connect upload tool is available");
  } else {
    warn("No Transporter app, altool, or iTMSTransporter upload path is available", true);
  }

  let signedUploadPackageCount = 0;
  let currentVersionUploadPackageCount = 0;
  let signedCurrentVersionUploadPackageCount = 0;

  if (uploadPackages.length > 0) {
    pass(`Found ${uploadPackages.length} MAS .pkg artifact(s) in dist`);
    uploadPackages.forEach((packagePath) => {
      const absolutePath = path.join(projectRoot, packagePath);
      const sizeBytes = fs.statSync(absolutePath).size;
      const signature = packageSignatureVerified(packagePath);
      const matchesCurrentVersion = packageMatchesCurrentApp(packagePath);

      if (sizeBytes > 0) {
        pass(`MAS upload package is non-empty: ${packagePath}`);
      } else {
        warn(`MAS upload package is empty: ${packagePath}`, true);
      }

      if (!signature.available) {
        warn("pkgutil is not available to inspect MAS upload package signatures", true);
      } else if (signature.ok) {
        signedUploadPackageCount += 1;
        pass(`MAS upload package signature verifies: ${packagePath}`);
      } else {
        warn(`MAS upload package signature does not verify: ${packagePath}`);
      }

      if (matchesCurrentVersion) {
        currentVersionUploadPackageCount += 1;
        pass(`MAS upload package matches current package version/build: ${packagePath}`);

        if (signature.ok) {
          signedCurrentVersionUploadPackageCount += 1;
          pass(`Signed MAS upload package matches current package version/build: ${packagePath}`);
        }
      } else {
        warn(`MAS upload package does not match current package version/build ${pkg.version}/${pkg.build?.buildVersion ?? pkg.version}: ${packagePath}`);
      }

      note(`MAS upload package: ${packagePath} sha256=${sha256(packagePath)}`);
    });

    if (signedUploadPackageCount > 0) {
      pass(`Found ${signedUploadPackageCount} signed MAS upload package artifact(s)`);
    } else {
      warn("No signed MAS .pkg upload artifact found in dist; run npm run dist:mas on the release machine before upload", true);
    }

    if (currentVersionUploadPackageCount === 0) {
      warn("No MAS .pkg upload artifact matches the current package version/build; remove stale packages and rerun npm run dist:mas", true);
    } else {
      pass(`Found ${currentVersionUploadPackageCount} current-version MAS upload package artifact(s)`);
    }

    if (signedCurrentVersionUploadPackageCount === 0) {
      warn("No signed current-version MAS .pkg upload artifact found in dist; rerun npm run dist:mas and verify the generated package", true);
    } else {
      pass(`Found ${signedCurrentVersionUploadPackageCount} signed current-version MAS upload package artifact(s)`);
    }
  } else {
    warn("No MAS .pkg upload artifact found in dist; run npm run dist:mas on the release machine before upload", true);
  }

  console.log(`App Store upload tooling checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));
  failures.forEach((message) => console.error(`FAIL ${message}`));
  notes.forEach((message) => console.log(`INFO ${message}`));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
