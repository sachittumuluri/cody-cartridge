#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const jsonPath = path.join(projectRoot, "app-store-assets", "UPLOAD_COMMAND_PACKET.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "UPLOAD_COMMAND_PACKET.md");
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
    failures.push(message);
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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function sha256(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(projectRoot, relativePath))).digest("hex");
}

function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function currentPackageTokens(pkg) {
  return [...new Set([pkg.version, pkg.build?.buildVersion ?? pkg.version].filter(Boolean))];
}

function packageMatchesCurrentApp(relativePath, pkg) {
  const fileName = path.basename(relativePath).toLowerCase();
  const normalizedFileName = normalizeToken(fileName);

  return currentPackageTokens(pkg).some((token) => {
    const normalizedToken = normalizeToken(token);

    return fileName.includes(String(token).toLowerCase()) || Boolean(normalizedToken && normalizedFileName.includes(normalizedToken));
  });
}

function packageModifiedTime(relativePath) {
  try {
    return fs.statSync(path.join(projectRoot, relativePath)).mtimeMs;
  } catch {
    return 0;
  }
}

function byNewestPackage(first, second) {
  const timeDelta = packageModifiedTime(second.path) - packageModifiedTime(first.path);

  return timeDelta || first.path.localeCompare(second.path);
}

function selectUploadPackage(uploadPackages) {
  const buckets = [
    {
      reason: "signed-current-version",
      packages: uploadPackages.filter((item) => item.signatureVerified && item.matchesCurrentVersion)
    },
    {
      reason: "current-version-needs-signature",
      packages: uploadPackages.filter((item) => item.matchesCurrentVersion)
    },
    {
      reason: "signed-stale-version",
      packages: uploadPackages.filter((item) => item.signatureVerified)
    },
    {
      reason: "stale-version-needs-rebuild",
      packages: uploadPackages
    }
  ];

  const bucket = buckets.find((candidate) => candidate.packages.length > 0);

  if (!bucket) {
    return {
      package: null,
      reason: "pending",
      requiresRebuild: true
    };
  }

  const selectedPackage = [...bucket.packages].sort(byNewestPackage)[0];

  return {
    package: selectedPackage,
    reason: bucket.reason,
    requiresRebuild: bucket.reason !== "signed-current-version"
  };
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
  ) ?? null;
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

function packageSignatureVerified(relativePath) {
  const result = spawnSync("pkgutil", ["--check-signature", path.join(projectRoot, relativePath)], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    available: !result.error || result.error.code !== "ENOENT",
    ok: result.status === 0,
    status: typeof result.status === "number" ? result.status : null
  };
}

function uploadCredentialCheck() {
  const result = spawnSync("node", ["scripts/check-upload-credentials.cjs", "--strict"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const lines = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const failures = lines.filter((line) => line.startsWith("FAIL "));
  const warnings = lines.filter((line) => line.startsWith("WARN "));

  return {
    ready: (result.status ?? 1) === 0 && failures.length === 0,
    exitCode: result.status ?? (result.error ? 1 : 0),
    failureCount: failures.length + (result.error ? 1 : 0),
    warningCount: warnings.length
  };
}

function rawIncludesSecretMaterial(value) {
  const sanitized = String(value ?? "").replaceAll("/path/to/AuthKey_<key-id>.p8", "<asc-key-file-placeholder>");

  return /-----BEGIN [^-]+PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+/-]+=*|api[_-]?key\s*[:=]\s*[^"',\s]+|issuer[_-]?id\s*[:=]\s*[^"',\s]+|password\s*[:=]\s*[^"',\s]+|secret\s*[:=]\s*[^"',\s]+|\.p8\b|\.p12\b|\.mobileprovision\b|\.provisionprofile\b/i.test(
    sanitized
  );
}

function main() {
  assert(fs.existsSync(jsonPath), "Upload command packet JSON exists");
  assert(fs.existsSync(markdownPath), "Upload command packet markdown exists");

  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath)) {
    return;
  }

  const packet = readJson("app-store-assets/UPLOAD_COMMAND_PACKET.json");
  const markdown = readText("app-store-assets/UPLOAD_COMMAND_PACKET.md");
  const pkg = readJson("package.json");
  const releaseManifest = readJson("app-store-assets/RELEASE_MANIFEST.json");
  const raw = `${JSON.stringify(packet)}\n${markdown}`;
  const diskPackages = findMasUploadPackages();
  const diskPackageRecords = diskPackages.map((packagePath) => ({
    path: packagePath,
    signatureVerified: packageSignatureVerified(packagePath).ok,
    matchesCurrentVersion: packageMatchesCurrentApp(packagePath, pkg)
  }));
  const signedDiskPackages = diskPackageRecords.filter((item) => item.signatureVerified);
  const currentVersionDiskPackages = diskPackageRecords.filter((item) => item.matchesCurrentVersion);
  const signedCurrentVersionDiskPackages = diskPackageRecords.filter((item) => item.signatureVerified && item.matchesCurrentVersion);
  const selectedDiskPackage = selectUploadPackage(diskPackageRecords);
  const availableToolCount = [findTransporterApp(), commandPath("altool"), commandPath("iTMSTransporter")].filter(Boolean).length;
  const credentialCheck = uploadCredentialCheck();

  assert(packet.app?.bundleId === pkg.build?.appId, "Upload command packet bundle id matches package config");
  assert(packet.app?.version === pkg.version, "Upload command packet version matches package config");
  assert(packet.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Upload command packet build version matches package config");
  assert(packet.summary?.uploadPackageCount === diskPackages.length, "Upload command packet upload package count matches disk");
  assert(packet.summary?.signedUploadPackageCount === signedDiskPackages.length, "Upload command packet signed package count matches disk");
  assert(packet.summary?.currentVersionUploadPackageCount === currentVersionDiskPackages.length, "Upload command packet current-version package count matches disk");
  assert(
    packet.summary?.signedCurrentVersionUploadPackageCount === signedCurrentVersionDiskPackages.length,
    "Upload command packet signed current-version package count matches disk"
  );
  assert(packet.summary?.availableToolCount === availableToolCount, "Upload command packet available tool count matches current machine");
  assert(packet.summary?.toolCount === 3, "Upload command packet records all supported upload tool paths");
  assert(packet.summary?.masSubmissionReady === (releaseManifest.masSubmission?.submissionReady === true), "Upload command packet MAS readiness matches release manifest");
  assert(
    packet.summary?.uploadCredentialStatus === (credentialCheck.ready ? "ready" : "blocked"),
    "Upload command packet credential status matches strict credential preflight"
  );
  assert(packet.credentialCheck?.command === "npm run check:upload-credentials -- --strict", "Upload command packet records credential preflight command");
  assert(packet.credentialCheck?.ready === credentialCheck.ready, "Upload command packet credential preflight readiness matches current machine");
  assert(packet.credentialCheck?.failureCount === credentialCheck.failureCount, "Upload command packet credential failure count matches current machine");
  assert(packet.credentialCheck?.warningCount === credentialCheck.warningCount, "Upload command packet credential warning count matches current machine");

  diskPackages.forEach((packagePath) => {
    const item = (packet.uploadPackages ?? []).find((candidate) => candidate.path === packagePath);
    const signature = packageSignatureVerified(packagePath);
    assert(Boolean(item), `Upload command packet includes ${packagePath}`);
    assert(item?.exists === exists(packagePath), `${packagePath} existence state matches disk`);
    assert(item?.sha256 === sha256(packagePath), `${packagePath} hash matches disk`);
    assert(item?.sizeBytes === fs.statSync(path.join(projectRoot, packagePath)).size, `${packagePath} size matches disk`);
    assert(item?.matchesCurrentVersion === packageMatchesCurrentApp(packagePath, pkg), `${packagePath} current-version match state matches package config`);
    assert(item?.signatureVerified === signature.ok, `${packagePath} signature state matches pkgutil`);
  });

  if (selectedDiskPackage.package) {
    assert(packet.selectedPackage?.path === selectedDiskPackage.package.path, "Upload command packet selected package follows signed current-version priority");
  } else {
    assert(packet.selectedPackage === null || typeof packet.selectedPackage === "undefined", "Upload command packet leaves selected package pending when no package exists");
  }

  assert(packet.selectedPackageSelection?.reason === selectedDiskPackage.reason, "Upload command packet selection reason matches current disk state");
  assert(packet.selectedPackageSelection?.requiresRebuild === selectedDiskPackage.requiresRebuild, "Upload command packet selection rebuild flag matches current disk state");
  assert(
    typeof packet.selectedPackageSelection?.policy === "string" && packet.selectedPackageSelection.policy.includes("current package.json version/build"),
    "Upload command packet documents current-version selection policy"
  );

  if (signedDiskPackages.length > 0 && signedCurrentVersionDiskPackages.length === 0) {
    assert(packet.summary?.status === "blocked", "Upload command packet blocks stale signed packages until a signed current-version package exists");
  }

  assert((packet.tools ?? []).some((tool) => tool.id === "transporter-app"), "Upload command packet records Transporter app path");
  assert((packet.tools ?? []).some((tool) => tool.id === "altool"), "Upload command packet records altool path");
  assert((packet.tools ?? []).some((tool) => tool.id === "itms-transporter"), "Upload command packet records iTMSTransporter path");
  assert((packet.commands ?? []).includes("npm run check:mas-package -- --strict"), "Upload command packet includes strict MAS package check command");
  assert((packet.commands ?? []).includes("npm run check:upload-tooling -- --strict"), "Upload command packet includes strict upload tooling check command");
  assert(
    (packet.commands ?? []).includes(
      "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run"
    ),
    "Upload command packet includes App Store Connect key install dry-run command"
  );
  assert((packet.commands ?? []).includes("npm run check:upload-credentials -- --strict"), "Upload command packet includes strict upload credential check command");
  assert(
    (packet.commands ?? []).indexOf("npm run check:mas-package -- --strict") <
      (packet.commands ?? []).indexOf("npm run check:upload-tooling -- --strict"),
    "Upload command packet checks upload tooling after strict MAS package verification"
  );
  assert(
    (packet.commands ?? []).indexOf("npm run check:upload-tooling -- --strict") <
      (packet.commands ?? []).indexOf(
        "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run"
      ) &&
      (packet.commands ?? []).indexOf(
        "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run"
      ) <
        (packet.commands ?? []).indexOf("npm run check:upload-credentials -- --strict") &&
      (packet.commands ?? []).indexOf("npm run check:upload-credentials -- --strict") <
        (packet.commands ?? []).findIndex((command) => command.startsWith("open -a Transporter")),
    "Upload command packet validates App Store Connect key before checking credentials and opening Transporter"
  );
  assert((packet.commands ?? []).some((command) => command.startsWith("open -a Transporter")), "Upload command packet includes Transporter open command");
  assert((packet.commands ?? []).some((command) => command.startsWith("npm run upload-evidence:store -- --log")), "Upload command packet includes upload evidence command");
  assert((packet.commands ?? []).some((command) => command.includes("npm run upload-packet:store")), "Upload command packet includes regeneration command");

  [
    "package.json",
    "app-store-assets/RELEASE_MANIFEST.json",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/UPLOAD_EVIDENCE.json",
    "scripts/build-upload-command-packet.cjs",
    "scripts/check-upload-command-packet.cjs",
    "scripts/check-mas-package.cjs",
    "scripts/check-upload-tooling.cjs",
    "scripts/install-asc-key.cjs",
    "scripts/check-upload-credentials.cjs",
    "scripts/build-upload-evidence.cjs",
    "scripts/check-upload-evidence.cjs"
  ].forEach((artifact) => {
    assert(packet.sourceArtifacts?.includes(artifact), `Upload command packet records ${artifact} source`);
  });

  assert(packet.redaction?.storesAppleCredentials === false, "Upload command packet records Apple credential redaction posture");
  assert(packet.redaction?.storesSigningSecrets === false, "Upload command packet records signing secret redaction posture");
  assert(packet.redaction?.storesRawUploadLogs === false, "Upload command packet records raw upload log exclusion");
  assert(packet.redaction?.credentialPlaceholdersOnly === true, "Upload command packet uses credential placeholders only");
  assert(!rawIncludesSecretMaterial(raw), "Upload command packet excludes secret material");
  assert(!/<script\b/i.test(markdown), "Upload command packet markdown contains no script tags");
  assert(markdown.includes("# Cody Cartridge Upload Command Packet"), "Upload command packet markdown includes title");
  assert(markdown.includes("## Upload Package"), "Upload command packet markdown includes package section");
  assert(markdown.includes("## Upload Tools"), "Upload command packet markdown includes tools section");
  assert(markdown.includes("## Command Order"), "Upload command packet markdown includes command order");

  const pkgJson = readJson("package.json");
  assert(pkgJson.scripts?.["upload-packet:store"]?.includes("scripts/build-upload-command-packet.cjs"), "package.json has upload packet build script");
  assert(pkgJson.scripts?.["upload-packet:store"]?.includes("scripts/check-upload-command-packet.cjs"), "package.json upload packet script runs checker");
  assert(pkgJson.scripts?.["check:upload-packet"] === "node scripts/check-upload-command-packet.cjs", "package.json has upload packet standalone checker");
  assert(pkgJson.scripts?.["install:asc-key"] === "node scripts/install-asc-key.cjs", "package.json has App Store Connect key install helper script");
  assert(pkgJson.scripts?.["check:upload-credentials"] === "node scripts/check-upload-credentials.cjs", "package.json has upload credential checker script");

  if (packet.summary?.status === "ready") {
    pass("Upload command packet is ready");
  } else {
    warn(`Upload command packet is blocked with ${packet.summary?.blockerCount ?? "unknown"} blocker(s)`);
  }
}

main();

console.log(`Upload command packet checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
