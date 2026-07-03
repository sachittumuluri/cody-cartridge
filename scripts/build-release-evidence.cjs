#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const loadedEnvFiles = loadStoreEnv(projectRoot);
const homeDir = os.homedir();
const outputJson = path.join(projectRoot, "app-store-assets", "RELEASE_EVIDENCE.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "RELEASE_EVIDENCE.md");

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

function directoryInfo(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    return {
      path: relativePath,
      exists: false,
      fileCount: 0,
      sizeBytes: 0
    };
  }

  const stack = [absolutePath];
  let fileCount = 0;
  let sizeBytes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    entries.forEach((entry) => {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        return;
      }

      if (entry.isFile()) {
        fileCount += 1;
        sizeBytes += fs.statSync(entryPath).size;
      }
    });
  }

  return {
    path: relativePath,
    exists: true,
    fileCount,
    sizeBytes
  };
}

function listFilesByExtension(relativeRoot, extension) {
  const rootPath = path.join(projectRoot, relativeRoot);

  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const matches = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    entries.forEach((entry) => {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        return;
      }

      if (entry.isFile() && entry.name.endsWith(extension)) {
        matches.push(path.relative(projectRoot, entryPath));
      }
    });
  }

  return matches.sort();
}

function listMasUploadPackages() {
  return listFilesByExtension("dist", ".pkg").filter((filePath) => {
    const baseName = path.basename(filePath).toLowerCase();
    return baseName.includes("cody") || baseName.includes("cartridge");
  });
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

function spawnStatus(command, args) {
  const result = spawnSync(command, args, {
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

function inspectMasSubmission() {
  const pkg = readJson("package.json");
  const bundlePath = "dist/mas-arm64/Cody Cartridge.app";
  const bundle = directoryInfo(bundlePath);
  const uploadPackagePaths = listMasUploadPackages();
  const codeSignature = bundle.exists
    ? spawnStatus("codesign", ["--verify", "--deep", "--strict", "--verbose=2", path.join(projectRoot, bundlePath)])
    : null;
  const packageSignatures = uploadPackagePaths.map((filePath) => {
    const signature = spawnStatus("pkgutil", ["--check-signature", path.join(projectRoot, filePath)]);

    return {
      path: filePath,
      matchesCurrentVersion: packageMatchesCurrentApp(filePath, pkg),
      signatureToolAvailable: signature.available,
      signatureVerified: signature.ok,
      status: signature.status
    };
  });
  const signedUploadPackageCount = packageSignatures.filter((item) => item.signatureVerified).length;
  const currentVersionUploadPackageCount = packageSignatures.filter((item) => item.matchesCurrentVersion).length;
  const signedCurrentVersionUploadPackageCount = packageSignatures.filter(
    (item) => item.signatureVerified && item.matchesCurrentVersion
  ).length;
  const hasEmbeddedProvisioningProfile = fs.existsSync(
    path.join(projectRoot, bundlePath, "Contents", "embedded.provisionprofile")
  );
  const codeSignatureVerified = codeSignature?.ok === true;
  const hasSignedUploadPackage = signedUploadPackageCount > 0;
  const hasCurrentVersionUploadPackage = currentVersionUploadPackageCount > 0;
  const hasSignedCurrentVersionUploadPackage = signedCurrentVersionUploadPackageCount > 0;
  const submissionReady =
    bundle.exists && hasEmbeddedProvisioningProfile && codeSignatureVerified && hasSignedCurrentVersionUploadPackage;

  return {
    mode: !bundle.exists ? "missing" : submissionReady ? "submission-ready" : "local-rehearsal-only",
    submissionReady,
    localRehearsalOnly: bundle.exists && !submissionReady,
    bundlePath,
    hasBundle: bundle.exists,
    bundleFileCount: bundle.fileCount,
    bundleSizeBytes: bundle.sizeBytes,
    hasEmbeddedProvisioningProfile,
    codeSignatureVerified,
    codeSignatureToolAvailable: codeSignature?.available ?? false,
    codeSignatureStatus: codeSignature?.status ?? null,
    uploadPackageCount: uploadPackagePaths.length,
    signedUploadPackageCount,
    currentVersionUploadPackageCount,
    signedCurrentVersionUploadPackageCount,
    hasSignedUploadPackage,
    hasCurrentVersionUploadPackage,
    hasSignedCurrentVersionUploadPackage,
    packageSignatures
  };
}

function sanitizeLine(line) {
  return String(line)
    .replaceAll(projectRoot, "<project>")
    .replaceAll(homeDir, "~")
    .replace(/([A-Z0-9._%+-])[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})/gi, "$1***$2")
    .replace(/(\+?\d)[\d ().-]{5,}(\d{2})/g, "$1***$2")
    .replace(/Apple (?:Distribution|Development|Mac Distribution|Mac App Distribution|Mac Installer Distribution):[^\n]+/gi, "Apple signing identity: <redacted>")
    .trim();
}

function summarizeCommand(id, title, args, strict = false) {
  const result = spawnSync("node", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const lines = output
    .split(/\r?\n/)
    .map(sanitizeLine)
    .filter(Boolean);
  const summaryLine = lines.find((line) => /checks|preflight|audit|version/i.test(line)) ?? lines[0] ?? "";
  const failures = lines.filter((line) => line.startsWith("FAIL ")).map((line) => line.replace(/^FAIL\s+/, ""));
  const warnings = lines.filter((line) => line.startsWith("WARN ")).map((line) => line.replace(/^WARN\s+/, ""));

  return {
    id,
    title,
    command: ["node", ...args].join(" "),
    strict,
    exitCode: result.status ?? (result.error ? 1 : 0),
    summary: summaryLine,
    failureCount: failures.length,
    warningCount: warnings.length,
    failures,
    warnings,
    error: result.error ? sanitizeLine(result.error.message) : null
  };
}

function formatList(items) {
  return items.length > 0 ? items.map((item) => `  - ${item}`).join("\n") : "  - None";
}

function renderMarkdown(evidence) {
  const commandRows = evidence.commands
    .map((item) => {
      const status = item.exitCode === 0 && item.failureCount === 0 ? "pass" : "blocked";
      return `| ${item.title} | ${item.strict ? "strict" : "advisory"} | ${status} | ${item.failureCount} | ${item.warningCount} | \`${item.command}\` |`;
    })
    .join("\n");
  const artifactRows = evidence.artifacts
    .map((item) => `| \`${item.path}\` | ${item.exists ? "present" : "missing"} | ${item.sizeBytes} | ${item.sha256 ? `\`${item.sha256}\`` : "-"} |`)
    .join("\n");
  const blockedCommands = evidence.commands.filter((item) => item.failureCount > 0 || item.exitCode !== 0);

  return `# Cody Cartridge Release Evidence

Generated by \`npm run evidence:store\`.

## Candidate

- App: ${evidence.app.name}
- Bundle ID: \`${evidence.app.bundleId}\`
- Version: ${evidence.app.version}
- Build version: ${evidence.app.buildVersion}
- Generated: ${evidence.generatedAt}
- Release env source: ${evidence.releaseEnv.loadedFiles.length > 0 ? evidence.releaseEnv.loadedFiles.join(", ") : "not loaded"}
- Strict preflight ready: ${evidence.blockers.readyForStrictPreflight ? "yes" : "no"}
- Blockers: ${evidence.blockers.blockerCount}

## MAS Submission Posture

- Bundle: \`${evidence.masSubmission.bundlePath}\`
- Mode: ${evidence.masSubmission.mode}
- Submission ready: ${evidence.masSubmission.submissionReady ? "yes" : "no"}
- Local rehearsal only: ${evidence.masSubmission.localRehearsalOnly ? "yes" : "no"}
- Embedded provisioning profile: ${evidence.masSubmission.hasEmbeddedProvisioningProfile ? "present" : "missing"}
- Code signature verifies: ${evidence.masSubmission.codeSignatureVerified ? "yes" : "no"}
- Signed upload packages: ${evidence.masSubmission.signedUploadPackageCount}/${evidence.masSubmission.uploadPackageCount}
- Current-version upload packages: ${evidence.masSubmission.currentVersionUploadPackageCount}/${evidence.masSubmission.uploadPackageCount}
- Signed current-version upload packages: ${evidence.masSubmission.signedCurrentVersionUploadPackageCount}/${evidence.masSubmission.uploadPackageCount}

## Artifact Hashes

| Path | Status | Size | SHA-256 |
| --- | --- | ---: | --- |
${artifactRows}

## Command Evidence

| Gate | Mode | Status | Failures | Warnings | Command |
| --- | --- | --- | ---: | ---: | --- |
${commandRows}

## Blocking Command Details

${blockedCommands
  .map(
    (item) => `### ${item.title}

- Summary: ${item.summary || "No summary line captured."}
- Exit code: ${item.exitCode}
- Failures:
${formatList(item.failures)}
- Warnings:
${formatList(item.warnings)}`
  )
  .join("\n\n") || "No blocking command details captured."}

## Notes

- This evidence intentionally redacts local paths, email addresses, phone numbers, and signing identity names.
- Regenerate this file immediately before \`npm run manifest:store\` so the release manifest hashes the current evidence packet.
- Keep this file with App Store Connect delivery logs for the submitted build.
`;
}

function main() {
  const pkg = readJson("package.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json", { summary: {}, blockers: [] });
  const app = {
    name: pkg.build?.productName ?? pkg.name,
    bundleId: pkg.build?.appId,
    version: pkg.version,
    buildVersion: pkg.build?.buildVersion ?? pkg.version
  };
  const commands = [
    summarizeCommand("store-version", "Store version", ["scripts/check-store-version.cjs"]),
    summarizeCommand("icons", "Icon audit", ["scripts/check-icons.cjs"]),
    summarizeCommand("electron-security", "Electron security", ["scripts/check-electron-security.cjs"]),
    summarizeCommand("packaging-toolchain", "Packaging toolchain", ["scripts/check-packaging-toolchain.cjs"]),
    summarizeCommand("help-docs", "Help documents", ["scripts/check-help-docs.cjs"]),
    summarizeCommand("copy-map", "App Store Connect copy map", ["scripts/check-app-store-copy-map.cjs"]),
    summarizeCommand("review-brief", "App Review brief", ["scripts/check-app-review-brief.cjs"]),
    summarizeCommand("app-compliance", "App Store compliance packet", ["scripts/check-app-store-compliance.cjs"]),
    summarizeCommand("manual-tasks", "App Store Connect manual task packet", ["scripts/check-app-store-connect-manual-tasks.cjs"]),
    summarizeCommand("content-rights", "Content rights media audit", ["scripts/check-app-content-rights.cjs"]),
    summarizeCommand("app-privacy", "App privacy", ["scripts/check-app-privacy.cjs"]),
    summarizeCommand("export-compliance", "Export compliance", ["scripts/check-export-compliance.cjs"]),
    summarizeCommand("store-copy", "App Store copy", ["scripts/check-store-copy.cjs"]),
    summarizeCommand("artifact-privacy", "Artifact privacy", ["scripts/check-artifact-privacy.cjs"]),
    summarizeCommand("site-advisory", "Generated site", ["scripts/check-store-site.cjs"]),
    summarizeCommand("site-archive-advisory", "Public site archive", ["scripts/check-public-site-archive.cjs"]),
    summarizeCommand("public-release-sync-advisory", "Public release sync", ["scripts/check-public-release-sync.cjs"]),
    summarizeCommand("store-urls-advisory", "Public URLs", ["scripts/check-store-urls.cjs"]),
    summarizeCommand("public-inputs", "Public release inputs", ["scripts/check-public-release-inputs.cjs"]),
    summarizeCommand("publish-packet", "Public site publish packet", ["scripts/check-public-site-publish-packet.cjs"]),
    summarizeCommand("public-host", "Public host runbook", ["scripts/check-public-host-runbook.cjs"]),
    summarizeCommand("published-site-advisory", "Published public site", ["scripts/check-public-site-published.cjs"]),
    summarizeCommand("mas-signing-advisory", "MAS signing", ["scripts/check-mas-signing.cjs"]),
    summarizeCommand("signing-assets", "Signing asset report", ["scripts/check-signing-asset-report.cjs"]),
    summarizeCommand("apple-assets", "Apple release asset requests", ["scripts/check-apple-release-assets.cjs"]),
    summarizeCommand("mas-package-advisory", "MAS package boundary", ["scripts/check-mas-package.cjs"]),
    summarizeCommand("upload-tooling-advisory", "Upload tooling", ["scripts/check-upload-tooling.cjs"]),
    summarizeCommand("upload-credentials-advisory", "Upload credentials", ["scripts/check-upload-credentials.cjs"]),
    summarizeCommand("release-machine-doctor", "Release machine doctor", ["scripts/check-release-machine.cjs"]),
    summarizeCommand("resolution-plan", "Release resolution plan", ["scripts/check-release-resolution-plan.cjs"]),
    summarizeCommand("submission-checklist", "Final submission checklist", ["scripts/check-final-submission-checklist.cjs"]),
    summarizeCommand("machine-report", "Release machine report", ["scripts/check-release-machine-report.cjs"]),
    summarizeCommand("signing-runbook", "Signing and upload runbook", ["scripts/check-signing-upload-runbook.cjs"]),
    summarizeCommand("upload-packet", "Upload command packet", ["scripts/check-upload-command-packet.cjs"]),
    summarizeCommand("upload-evidence", "Upload evidence", ["scripts/check-upload-evidence.cjs"]),
    summarizeCommand("public-release-sync-strict", "Strict public release sync", ["scripts/check-public-release-sync.cjs", "--strict"], true),
    summarizeCommand("store-urls-strict", "Strict public URLs", ["scripts/check-store-urls.cjs", "--strict"], true),
    summarizeCommand("published-site-strict", "Strict published public site", ["scripts/check-public-site-published.cjs", "--strict"], true),
    summarizeCommand("mas-signing-strict", "Strict MAS signing", ["scripts/check-mas-signing.cjs", "--strict"], true),
    summarizeCommand("mas-package-strict", "Strict MAS package boundary", ["scripts/check-mas-package.cjs", "--strict"], true),
    summarizeCommand("upload-tooling-strict", "Strict upload tooling", ["scripts/check-upload-tooling.cjs", "--strict"], true),
    summarizeCommand("upload-credentials-strict", "Strict upload credentials", ["scripts/check-upload-credentials.cjs", "--strict"], true),
    summarizeCommand("release-machine-doctor-strict", "Strict release machine doctor", ["scripts/check-release-machine.cjs", "--strict"], true)
  ];
  const artifacts = [
    "package.json",
    "package-lock.json",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.json",
    "app-store-assets/APP_STORE_CONNECT_COPY_MAP.md",
    "app-store-assets/EXPORT_COMPLIANCE.json",
    "app-store-assets/EXPORT_COMPLIANCE.md",
    "app-store-assets/APP_STORE_COMPLIANCE.json",
    "app-store-assets/APP_STORE_COMPLIANCE.md",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json",
    "app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md",
    "app-store-assets/APP_CONTENT_RIGHTS.json",
    "app-store-assets/APP_CONTENT_RIGHTS.md",
    "app-store-assets/APP_REVIEW_BRIEF.json",
    "app-store-assets/APP_REVIEW_BRIEF.md",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/PUBLIC_RELEASE_INPUTS.md",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.json",
    "app-store-assets/PUBLIC_HOST_RUNBOOK.md",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.json",
    "app-store-assets/RELEASE_RESOLUTION_PLAN.md",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
    "app-store-assets/FINAL_SUBMISSION_CHECKLIST.md",
    "app-store-assets/RELEASE_MACHINE_REPORT.json",
    "app-store-assets/RELEASE_MACHINE_REPORT.md",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.json",
    "app-store-assets/SIGNING_UPLOAD_RUNBOOK.md",
    "app-store-assets/SIGNING_ASSET_REPORT.json",
    "app-store-assets/SIGNING_ASSET_REPORT.md",
    "app-store-assets/APPLE_RELEASE_ASSETS.json",
    "app-store-assets/APPLE_RELEASE_ASSETS.md",
    "app-store-assets/UPLOAD_COMMAND_PACKET.json",
    "app-store-assets/UPLOAD_COMMAND_PACKET.md",
    "app-store-assets/UPLOAD_EVIDENCE.json",
    "app-store-assets/UPLOAD_EVIDENCE.md",
    "app-store-assets/SUBMISSION_PACKET.md",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/RELEASE_BLOCKERS.md",
    "app-store-assets/THIRD_PARTY_NOTICES.md",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/screenshots/01-library-1440x900.png",
    "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    "app-store-assets/screenshots/03-missing-files-1440x900.png",
    "build/icon.icns",
    "build/PrivacyInfo.xcprivacy",
    "build/entitlements.mas.plist",
    "build/entitlements.mas.inherit.plist",
    "scripts/build-release-evidence.cjs",
    "scripts/check-release-evidence.cjs",
    "scripts/build-public-site-publish-packet.cjs",
    "scripts/check-public-site-publish-packet.cjs",
    "scripts/build-public-host-runbook.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/configure-store-env.cjs",
    "scripts/refresh-public-release.cjs",
    "scripts/install-mas-profile.cjs",
    "scripts/install-asc-key.cjs",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/build-upload-command-packet.cjs",
    "scripts/check-upload-command-packet.cjs",
    "scripts/check-upload-credentials.cjs",
    "scripts/build-upload-evidence.cjs",
    "scripts/check-upload-evidence.cjs",
    "scripts/build-release-manifest.cjs",
    "scripts/check-release-manifest.cjs"
  ].map(fileInfo);
  const evidence = {
    generatedAt: new Date().toISOString(),
    app,
    releaseEnv: {
      loadedFiles: loadedEnvFiles
    },
    masSubmission: inspectMasSubmission(),
    blockers: {
      blockerCount: blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0,
      readyForStrictPreflight: Boolean(blockers.summary?.readyForStrictPreflight)
    },
    artifacts,
    commands
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderMarkdown(evidence));

  const blockingCommandCount = commands.filter((item) => item.failureCount > 0 || item.exitCode !== 0).length;
  console.log(`Release evidence: ${commands.length} command summaries, ${artifacts.length} artifact hashes, ${blockingCommandCount} blocking command(s)`);
  console.log("Built app-store-assets/RELEASE_EVIDENCE.json");
  console.log("Built app-store-assets/RELEASE_EVIDENCE.md");
}

main();
