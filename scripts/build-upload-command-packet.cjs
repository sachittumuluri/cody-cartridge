#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "UPLOAD_COMMAND_PACKET.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "UPLOAD_COMMAND_PACKET.md");

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function fileInfo(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return {
      path: relativePath,
      exists: false,
      sizeBytes: 0,
      sha256: null
    };
  }

  const bytes = fs.readFileSync(absolutePath);

  return {
    path: relativePath,
    exists: true,
    sizeBytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
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

function packageSignature(relativePath) {
  const result = spawnSync("pkgutil", ["--check-signature", path.join(projectRoot, relativePath)], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    toolAvailable: !result.error || result.error.code !== "ENOENT",
    verified: result.status === 0,
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
    command: "npm run check:upload-credentials -- --strict",
    ready: (result.status ?? 1) === 0 && failures.length === 0,
    exitCode: result.status ?? (result.error ? 1 : 0),
    failureCount: failures.length + (result.error ? 1 : 0),
    warningCount: warnings.length,
    summary: lines.find((line) => /credential checks/i.test(line)) ?? "Credential preflight did not produce a summary."
  };
}

function uploadPackageRecord(relativePath, pkg) {
  const info = fileInfo(relativePath);
  const signature = info.exists ? packageSignature(relativePath) : { toolAvailable: false, verified: false, status: null };

  return {
    ...info,
    matchesCurrentVersion: packageMatchesCurrentApp(relativePath, pkg),
    signatureToolAvailable: signature.toolAvailable,
    signatureVerified: signature.verified,
    signatureStatus: signature.status
  };
}

function toolRecords() {
  const transporterApp = findTransporterApp();
  const altoolPath = commandPath("altool");
  const iTMSTransporterPath = commandPath("iTMSTransporter");

  return [
    {
      id: "transporter-app",
      label: "Transporter.app",
      available: Boolean(transporterApp),
      path: transporterApp,
      command: transporterApp ? `open -a Transporter "<signed-mas-pkg>"` : null
    },
    {
      id: "altool",
      label: "xcrun altool",
      available: Boolean(altoolPath),
      path: altoolPath,
      command: altoolPath
        ? `xcrun altool --upload-app --type osx --file "<signed-mas-pkg>" --apiKey "<ASC_API_KEY_ID>" --apiIssuer "<ASC_API_ISSUER_ID>"`
        : null
    },
    {
      id: "itms-transporter",
      label: "xcrun iTMSTransporter",
      available: Boolean(iTMSTransporterPath),
      path: iTMSTransporterPath,
      command: iTMSTransporterPath ? `xcrun iTMSTransporter -m upload -f "<signed-mas-pkg>" -apiKey "<ASC_API_KEY_ID>" -apiIssuer "<ASC_API_ISSUER_ID>"` : null
    }
  ];
}

function commandList(selectedPackage) {
  const packagePath = selectedPackage?.path ?? "<signed-mas-pkg>";

  return [
    "npm run check:mas-package -- --strict",
    "npm run check:upload-tooling -- --strict",
    "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run",
    "npm run check:upload-credentials -- --strict",
    `open -a Transporter "${packagePath}"`,
    `npm run upload-evidence:store -- --log /path/to/transporter.log --tool transporter --status selected --processed-bundle-id com.sachittumuluri.codycartridge --processed-version 0.1.0 --processed-build 0.1.0`,
    "npm run check:upload-evidence",
    "npm run report:store-blockers && npm run upload-packet:store && npm run evidence:store && npm run manifest:store && npm run handoff:store"
  ];
}

function renderMarkdown(packet) {
  const packageRows =
    packet.uploadPackages.length > 0
      ? packet.uploadPackages
          .map(
            (item) =>
              `| \`${item.path}\` | ${item.exists ? "present" : "missing"} | ${item.matchesCurrentVersion ? "yes" : "no"} | ${item.signatureVerified ? "yes" : "no"} | ${item.sizeBytes} | ${item.sha256 ? `\`${item.sha256}\`` : "-"} |`
          )
          .join("\n")
      : "| None | missing | no | no | 0 | - |";
  const toolRows = packet.tools
    .map((item) => `| ${item.label} | ${item.available ? "available" : "missing"} | ${item.path ? `\`${item.path}\`` : "-"} |`)
    .join("\n");

  return `# Cody Cartridge Upload Command Packet

Generated by \`npm run upload-packet:store\`.

This packet prepares the signed MAS upload step without storing Apple credentials. It records the package artifact to upload, the available local upload tools, and the evidence command to run after Transporter/App Store Connect processing.

## Summary

- App: ${packet.app.name}
- Bundle ID: \`${packet.app.bundleId}\`
- Version: ${packet.app.version}
- Build version: ${packet.app.buildVersion}
- Status: ${packet.summary.status}
- Upload tools available: ${packet.summary.availableToolCount}/${packet.summary.toolCount}
- Signed upload packages: ${packet.summary.signedUploadPackageCount}/${packet.summary.uploadPackageCount}
- Current-version upload packages: ${packet.summary.currentVersionUploadPackageCount}/${packet.summary.uploadPackageCount}
- Signed current-version upload packages: ${packet.summary.signedCurrentVersionUploadPackageCount}/${packet.summary.uploadPackageCount}
- Upload credential preflight: ${packet.summary.uploadCredentialStatus}
- Selected package: ${packet.selectedPackage?.path ? `\`${packet.selectedPackage.path}\`` : "pending"}
- Selection reason: ${packet.selectedPackageSelection.reason}

## Upload Package

| Path | Status | Current Version | Signature Verified | Size | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
${packageRows}

## Upload Tools

| Tool | Status | Path |
| --- | --- | --- |
${toolRows}

## Command Order

${packet.commands.map((command) => `- \`${command}\``).join("\n")}

## Credentials

- Apple ID, app-specific passwords, App Store Connect API keys, private keys, and issuer IDs are not stored here.
- Run \`npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run\` before installing the downloaded API key on the release machine.
- Run \`npm run check:upload-credentials -- --strict\` on the release machine before using the command placeholders.
- Replace credential placeholders at command time only, or use Transporter.app interactively.
- Keep raw delivery logs outside the handoff archive; attach only sanitized summaries with \`npm run upload-evidence:store\`.

## Redaction

- Raw Apple account values are not written to this packet.
- Signing certificates, private keys, provisioning profiles, and upload credentials are excluded.
- Local raw upload logs are excluded.
`;
}

function main() {
  const pkg = readJson("package.json");
  const releaseManifest = readJson("app-store-assets/RELEASE_MANIFEST.json", { masSubmission: {} });
  const uploadEvidence = readJson("app-store-assets/UPLOAD_EVIDENCE.json", { upload: {} });
  const signingAssetReport = readJson("app-store-assets/SIGNING_ASSET_REPORT.json", { summary: {} });
  const uploadPackages = findMasUploadPackages().map((packagePath) => uploadPackageRecord(packagePath, pkg));
  const tools = toolRecords();
  const credentialCheck = uploadCredentialCheck();
  const signedUploadPackages = uploadPackages.filter((item) => item.signatureVerified);
  const currentVersionUploadPackages = uploadPackages.filter((item) => item.matchesCurrentVersion);
  const signedCurrentVersionUploadPackages = currentVersionUploadPackages.filter((item) => item.signatureVerified);
  const selectedPackage = selectUploadPackage(uploadPackages);
  const availableToolCount = tools.filter((item) => item.available).length;
  const blockerCount = [
    availableToolCount === 0,
    signedUploadPackages.length === 0,
    uploadPackages.length > 0 && currentVersionUploadPackages.length === 0,
    currentVersionUploadPackages.length > 0 && signedCurrentVersionUploadPackages.length === 0,
    !credentialCheck.ready,
    releaseManifest.masSubmission?.submissionReady !== true
  ].filter(Boolean).length;
  const packet = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName ?? pkg.name,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion: pkg.build?.buildVersion ?? pkg.version
    },
    summary: {
      status: blockerCount === 0 ? "ready" : "blocked",
      blockerCount,
      toolCount: tools.length,
      availableToolCount,
      uploadPackageCount: uploadPackages.length,
      signedUploadPackageCount: signedUploadPackages.length,
      currentVersionUploadPackageCount: currentVersionUploadPackages.length,
      signedCurrentVersionUploadPackageCount: signedCurrentVersionUploadPackages.length,
      masSubmissionReady: releaseManifest.masSubmission?.submissionReady === true,
      uploadCredentialStatus: credentialCheck.ready ? "ready" : "blocked",
      uploadEvidenceStatus: uploadEvidence.upload?.status ?? "pending",
      signingAssetStatus: signingAssetReport.summary?.status ?? "unknown"
    },
    selectedPackage: selectedPackage.package,
    selectedPackageSelection: {
      reason: selectedPackage.reason,
      requiresRebuild: selectedPackage.requiresRebuild,
      policy: "Prefer a signed package whose filename matches the current package.json version/build before any stale signed package."
    },
    uploadPackages,
    tools,
    credentialCheck,
    commands: commandList(selectedPackage.package),
    sourceArtifacts: [
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
    ],
    redaction: {
      storesAppleCredentials: false,
      storesSigningSecrets: false,
      storesRawUploadLogs: false,
      credentialPlaceholdersOnly: true
    }
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(packet, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderMarkdown(packet));

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (packet.summary.status !== "ready") {
    console.warn(`Upload command packet records ${packet.summary.blockerCount} blocker(s).`);
  }
}

main();
