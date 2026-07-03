#!/usr/bin/env node

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
loadStoreEnv(projectRoot);

const outputJson = path.join(projectRoot, "app-store-assets", "RELEASE_MANIFEST.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "RELEASE_MANIFEST.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function fileInfo(relativePath, kind) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return {
      kind,
      path: relativePath,
      exists: false,
      sizeBytes: 0,
      sha256: null
    };
  }

  const bytes = fs.readFileSync(absolutePath);
  const stat = fs.statSync(absolutePath);

  return {
    kind,
    path: relativePath,
    exists: true,
    sizeBytes: stat.size,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

function directoryInfo(relativePath, kind) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    return {
      kind,
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
    kind,
    path: relativePath,
    exists: true,
    fileCount,
    sizeBytes
  };
}

function listBuiltAssets() {
  const assetsDir = path.join(projectRoot, "dist", "assets");

  if (!fs.existsSync(assetsDir)) {
    return [];
  }

  return fs
    .readdirSync(assetsDir)
    .filter((fileName) => fileName.endsWith(".js") || fileName.endsWith(".css"))
    .sort()
    .map((fileName) => fileInfo(path.join("dist", "assets", fileName), "built asset"));
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

function listMasUploadPackagePaths() {
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
    status: typeof result.status === "number" ? result.status : null,
    ok: result.status === 0,
    stderr: String(result.stderr ?? "").trim(),
    stdout: String(result.stdout ?? "").trim()
  };
}

function inspectMasSubmission(packagedApp, uploadPackages) {
  const appPath = packagedApp.path;
  const absoluteAppPath = path.join(projectRoot, appPath);
  const embeddedProfilePath = path.join(appPath, "Contents", "embedded.provisionprofile");
  const hasEmbeddedProvisioningProfile = exists(embeddedProfilePath);
  const codeSignature = packagedApp.exists
    ? spawnStatus("codesign", ["--verify", "--deep", "--strict", "--verbose=2", absoluteAppPath])
    : null;
  const packageSignatures = uploadPackages.map((uploadPackage) => {
    const signature = spawnStatus("pkgutil", ["--check-signature", path.join(projectRoot, uploadPackage.path)]);

    return {
      path: uploadPackage.path,
      matchesCurrentVersion: uploadPackage.matchesCurrentVersion === true,
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
  const hasSignedUploadPackage = signedUploadPackageCount > 0;
  const hasCurrentVersionUploadPackage = currentVersionUploadPackageCount > 0;
  const hasSignedCurrentVersionUploadPackage = signedCurrentVersionUploadPackageCount > 0;
  const codeSignatureVerified = codeSignature?.ok === true;
  const submissionReady =
    packagedApp.exists && hasEmbeddedProvisioningProfile && codeSignatureVerified && hasSignedCurrentVersionUploadPackage;
  const mode = !packagedApp.exists ? "missing" : submissionReady ? "submission-ready" : "local-rehearsal-only";

  return {
    mode,
    submissionReady,
    localRehearsalOnly: packagedApp.exists && !submissionReady,
    bundlePath: appPath,
    hasBundle: packagedApp.exists,
    hasEmbeddedProvisioningProfile,
    embeddedProvisioningProfilePath: embeddedProfilePath,
    codeSignatureVerified,
    codeSignatureToolAvailable: codeSignature?.available ?? false,
    codeSignatureStatus: codeSignature?.status ?? null,
    uploadPackageCount: uploadPackages.length,
    signedUploadPackageCount,
    currentVersionUploadPackageCount,
    signedCurrentVersionUploadPackageCount,
    hasSignedUploadPackage,
    hasCurrentVersionUploadPackage,
    hasSignedCurrentVersionUploadPackage,
    packageSignatures
  };
}

function isFullUrl(value) {
  return /^https?:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(String(value ?? ""));
}

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com/i.test(String(value ?? ""));
}

function valueState(value, validator = () => true) {
  const trimmedValue = String(value ?? "").trim();

  if (!trimmedValue) {
    return "missing";
  }

  if (isPlaceholder(trimmedValue)) {
    return "placeholder";
  }

  if (!validator(trimmedValue)) {
    return "invalid";
  }

  return "ready";
}

function displayValue(label, value, validator = () => true) {
  return valueState(value, validator) === "ready" ? String(value).trim() : `${label}=${valueState(value, validator)}`;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
}

function table(rows) {
  return [
    "| Path | Kind | Status | Size | SHA-256 |",
    "| --- | --- | --- | ---: | --- |",
    ...rows.map((item) => {
      const status = item.exists ? "present" : "missing";
      const size = item.sizeBytes ? String(item.sizeBytes) : "0";
      const hash = item.sha256 ? `\`${item.sha256}\`` : "-";
      return `| \`${item.path}\` | ${item.kind} | ${status} | ${size} | ${hash} |`;
    })
  ].join("\n");
}

function main() {
  const pkg = readJson("package.json");
  const fields = exists("app-store-assets/APP_STORE_CONNECT_FIELDS.json")
    ? readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json")
    : {};
  const uploadPackages = listMasUploadPackagePaths().map((filePath) => ({
    ...fileInfo(filePath, "MAS upload package"),
    matchesCurrentVersion: packageMatchesCurrentApp(filePath, pkg)
  }));

  const files = [
    fileInfo("package.json", "package metadata"),
    fileInfo("package-lock.json", "dependency lockfile"),
    fileInfo(".nvmrc", "release runtime"),
    fileInfo(".node-version", "release runtime"),
    fileInfo("build/icon.icns", "app icon"),
    fileInfo("build/icon.png", "app icon source"),
    fileInfo("build/PrivacyInfo.xcprivacy", "privacy manifest"),
    fileInfo("build/entitlements.mas.plist", "MAS entitlements"),
    fileInfo("build/entitlements.mas.inherit.plist", "MAS child entitlements"),
    fileInfo("index.html", "renderer source"),
    fileInfo("vite.config.ts", "renderer source"),
    fileInfo("src/main.tsx", "renderer source"),
    fileInfo("src/App.tsx", "renderer source"),
    fileInfo("src/styles.css", "renderer source"),
    fileInfo("dist/index.html", "production build"),
    ...listBuiltAssets(),
    ...uploadPackages,
    fileInfo("app-store-assets/APP_STORE_LISTING.md", "listing draft"),
    fileInfo("app-store-assets/APP_STORE_CONNECT_FIELDS.json", "App Store fields"),
    fileInfo("app-store-assets/APP_STORE_CONNECT_COPY_MAP.json", "App Store copy map"),
    fileInfo("app-store-assets/APP_STORE_CONNECT_COPY_MAP.md", "App Store copy map"),
    fileInfo("app-store-assets/EXPORT_COMPLIANCE.json", "export compliance prep"),
    fileInfo("app-store-assets/EXPORT_COMPLIANCE.md", "export compliance prep"),
    fileInfo("app-store-assets/APP_STORE_COMPLIANCE.json", "App Store compliance packet"),
    fileInfo("app-store-assets/APP_STORE_COMPLIANCE.md", "App Store compliance packet"),
    fileInfo("app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json", "App Store Connect manual task packet"),
    fileInfo("app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md", "App Store Connect manual task packet"),
    fileInfo("app-store-assets/APP_CONTENT_RIGHTS.json", "content rights media audit"),
    fileInfo("app-store-assets/APP_CONTENT_RIGHTS.md", "content rights media audit"),
    fileInfo("app-store-assets/APP_REVIEW_BRIEF.json", "App Review brief"),
    fileInfo("app-store-assets/APP_REVIEW_BRIEF.md", "App Review brief"),
    fileInfo("app-store-assets/PUBLIC_RELEASE_INPUTS.json", "public release inputs"),
    fileInfo("app-store-assets/PUBLIC_RELEASE_INPUTS.md", "public release inputs"),
    fileInfo("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json", "public site publish packet"),
    fileInfo("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md", "public site publish packet"),
    fileInfo("app-store-assets/PUBLIC_HOST_RUNBOOK.json", "public host runbook"),
    fileInfo("app-store-assets/PUBLIC_HOST_RUNBOOK.md", "public host runbook"),
    fileInfo("app-store-assets/RELEASE_RESOLUTION_PLAN.json", "release resolution plan"),
    fileInfo("app-store-assets/RELEASE_RESOLUTION_PLAN.md", "release resolution plan"),
    fileInfo("app-store-assets/FINAL_SUBMISSION_CHECKLIST.json", "final submission checklist"),
    fileInfo("app-store-assets/FINAL_SUBMISSION_CHECKLIST.md", "final submission checklist"),
    fileInfo("app-store-assets/RELEASE_MACHINE_REPORT.json", "release machine report"),
    fileInfo("app-store-assets/RELEASE_MACHINE_REPORT.md", "release machine report"),
    fileInfo("app-store-assets/RELEASE_DASHBOARD.json", "release dashboard"),
    fileInfo("app-store-assets/RELEASE_DASHBOARD.html", "release dashboard"),
    fileInfo("app-store-assets/RELEASE_OPERATOR_QUEUE.json", "release operator queue"),
    fileInfo("app-store-assets/RELEASE_OPERATOR_QUEUE.md", "release operator queue"),
    fileInfo("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json", "signing upload runbook"),
    fileInfo("app-store-assets/SIGNING_UPLOAD_RUNBOOK.md", "signing upload runbook"),
    fileInfo("app-store-assets/SIGNING_ASSET_REPORT.json", "signing asset report"),
    fileInfo("app-store-assets/SIGNING_ASSET_REPORT.md", "signing asset report"),
    fileInfo("app-store-assets/APPLE_RELEASE_ASSETS.json", "Apple release asset requests"),
    fileInfo("app-store-assets/APPLE_RELEASE_ASSETS.md", "Apple release asset requests"),
    fileInfo("app-store-assets/UPLOAD_COMMAND_PACKET.json", "upload command packet"),
    fileInfo("app-store-assets/UPLOAD_COMMAND_PACKET.md", "upload command packet"),
    fileInfo("app-store-assets/UPLOAD_EVIDENCE.json", "upload evidence"),
    fileInfo("app-store-assets/UPLOAD_EVIDENCE.md", "upload evidence"),
    fileInfo("app-store-assets/SUBMISSION_PACKET.md", "submission packet"),
    fileInfo("app-store-assets/RELEASE_EVIDENCE.json", "release evidence"),
    fileInfo("app-store-assets/RELEASE_EVIDENCE.md", "release evidence"),
    fileInfo("app-store-assets/RELEASE_BLOCKERS.json", "release blocker report"),
    fileInfo("app-store-assets/RELEASE_BLOCKERS.md", "release blocker report"),
    fileInfo("app-store-assets/THIRD_PARTY_NOTICES.json", "third-party notices"),
    fileInfo("app-store-assets/THIRD_PARTY_NOTICES.md", "third-party notices"),
    fileInfo("app-store-assets/PRIVACY_POLICY.md", "privacy policy draft"),
    fileInfo("app-store-assets/SUPPORT.md", "support draft"),
    fileInfo("app-store-assets/ACCESSIBILITY.md", "accessibility draft"),
    fileInfo("app-store-assets/site/index.html", "public site"),
    fileInfo("app-store-assets/site/privacy.html", "public site"),
    fileInfo("app-store-assets/site/support.html", "public site"),
    fileInfo("app-store-assets/site/accessibility.html", "public site"),
    fileInfo("app-store-assets/site/third-party-notices.html", "public site"),
    fileInfo("app-store-assets/site/robots.txt", "public site"),
    fileInfo("app-store-assets/site/sitemap.xml", "public site"),
    fileInfo("app-store-assets/site/_headers", "public site static host config"),
    fileInfo("app-store-assets/site/vercel.json", "public site static host config"),
    fileInfo("app-store-assets/public-site/cody-cartridge-public-site.zip", "public site archive"),
    fileInfo("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json", "public site archive manifest"),
    fileInfo("app-store-assets/site.env.example", "release env template"),
    fileInfo("scripts/init-store-env.cjs", "release tooling"),
    fileInfo("scripts/configure-store-env.cjs", "release tooling"),
    fileInfo("scripts/store-env.cjs", "release tooling"),
    fileInfo("scripts/refresh-public-release.cjs", "release tooling"),
    fileInfo("scripts/check-store-env.cjs", "release tooling"),
    fileInfo("scripts/build-release-manifest.cjs", "release tooling"),
    fileInfo("scripts/build-release-evidence.cjs", "release tooling"),
    fileInfo("scripts/check-release-evidence.cjs", "release tooling"),
    fileInfo("scripts/check-release-manifest.cjs", "release tooling"),
    fileInfo("scripts/build-public-release-inputs.cjs", "release tooling"),
    fileInfo("scripts/build-public-site-publish-packet.cjs", "release tooling"),
    fileInfo("scripts/check-public-site-publish-packet.cjs", "release tooling"),
    fileInfo("scripts/build-public-host-runbook.cjs", "release tooling"),
    fileInfo("scripts/check-public-host-runbook.cjs", "release tooling"),
    fileInfo("scripts/check-public-site-published.cjs", "release tooling"),
    fileInfo("scripts/check-public-release-sync.cjs", "release tooling"),
    fileInfo("scripts/build-app-store-copy-map.cjs", "release tooling"),
    fileInfo("scripts/build-export-compliance.cjs", "release tooling"),
    fileInfo("scripts/build-app-review-brief.cjs", "release tooling"),
    fileInfo("scripts/build-release-resolution-plan.cjs", "release tooling"),
    fileInfo("scripts/build-final-submission-checklist.cjs", "release tooling"),
    fileInfo("scripts/build-release-dashboard.cjs", "release tooling"),
    fileInfo("scripts/build-release-machine-report.cjs", "release tooling"),
    fileInfo("scripts/build-release-operator-queue.cjs", "release tooling"),
    fileInfo("scripts/build-signing-upload-runbook.cjs", "release tooling"),
    fileInfo("scripts/build-signing-asset-report.cjs", "release tooling"),
    fileInfo("scripts/build-apple-release-assets.cjs", "release tooling"),
    fileInfo("scripts/check-apple-release-assets.cjs", "release tooling"),
    fileInfo("scripts/install-mas-profile.cjs", "release tooling"),
    fileInfo("scripts/install-asc-key.cjs", "release tooling"),
    fileInfo("scripts/build-upload-command-packet.cjs", "release tooling"),
    fileInfo("scripts/check-upload-command-packet.cjs", "release tooling"),
    fileInfo("scripts/build-upload-evidence.cjs", "release tooling"),
    fileInfo("scripts/check-upload-evidence.cjs", "release tooling"),
    fileInfo("scripts/build-submission-handoff.cjs", "release tooling"),
    fileInfo("scripts/check-help-docs.cjs", "release tooling"),
    fileInfo("scripts/check-public-release-inputs.cjs", "release tooling"),
    fileInfo("scripts/check-app-store-copy-map.cjs", "release tooling"),
    fileInfo("scripts/check-export-compliance.cjs", "release tooling"),
    fileInfo("scripts/check-app-review-brief.cjs", "release tooling"),
    fileInfo("scripts/check-release-resolution-plan.cjs", "release tooling"),
    fileInfo("scripts/check-final-submission-checklist.cjs", "release tooling"),
    fileInfo("scripts/check-release-dashboard.cjs", "release tooling"),
    fileInfo("scripts/check-release-machine-report.cjs", "release tooling"),
    fileInfo("scripts/check-release-operator-queue.cjs", "release tooling"),
    fileInfo("scripts/check-signing-upload-runbook.cjs", "release tooling"),
    fileInfo("scripts/check-signing-asset-report.cjs", "release tooling"),
    fileInfo("scripts/check-app-privacy.cjs", "release tooling"),
    fileInfo("scripts/check-artifact-privacy.cjs", "release tooling"),
    fileInfo("scripts/check-submission-handoff.cjs", "release tooling"),
    fileInfo("scripts/check-store-version.cjs", "release tooling"),
    fileInfo("scripts/bump-store-version.cjs", "release tooling"),
    fileInfo("scripts/check-electron-security.cjs", "release tooling"),
    fileInfo("scripts/build-public-site-archive.cjs", "release tooling"),
    fileInfo("scripts/build-release-blocker-report.cjs", "release tooling"),
    fileInfo("scripts/check-public-site-archive.cjs", "release tooling"),
    fileInfo("scripts/check-store-copy.cjs", "release tooling"),
    fileInfo("scripts/check-store-urls.cjs", "release tooling"),
    fileInfo("scripts/check-store-site.cjs", "release tooling"),
    fileInfo("scripts/check-store-screenshots.cjs", "release tooling"),
    fileInfo("scripts/capture-store-screenshots.cjs", "release tooling"),
    fileInfo("scripts/check-release-runtime.cjs", "release tooling"),
    fileInfo("scripts/run-release-node.cjs", "release tooling"),
    fileInfo("scripts/check-release-machine.cjs", "release tooling"),
    fileInfo("scripts/check-packaging-toolchain.cjs", "release tooling"),
    fileInfo("scripts/check-mas-package.cjs", "release tooling"),
    fileInfo("scripts/check-upload-tooling.cjs", "release tooling"),
    fileInfo("scripts/check-upload-credentials.cjs", "release tooling"),
    fileInfo("scripts/verify-store-readiness-with-build.cjs", "release tooling"),
    fileInfo("scripts/verify-store-readiness.cjs", "release tooling"),
    fileInfo("scripts/smoke-store-build.cjs", "release tooling"),
    fileInfo("scripts/smoke-accessibility.cjs", "release tooling"),
    fileInfo("scripts/smoke-electron-shell.cjs", "release tooling"),
    fileInfo("scripts/smoke-clean-profile.cjs", "release tooling"),
    fileInfo("scripts/smoke-mas-dir-build.cjs", "release tooling"),
    fileInfo("scripts/smoke-mas-runtime.cjs", "release tooling"),
    fileInfo("app-store-assets/screenshots/STORE_SCREENSHOTS.json", "store screenshot manifest"),
    fileInfo("app-store-assets/screenshots/01-library-1440x900.png", "store screenshot"),
    fileInfo("app-store-assets/screenshots/02-takeout-map-1440x900.png", "store screenshot"),
    fileInfo("app-store-assets/screenshots/03-missing-files-1440x900.png", "store screenshot")
  ];

  const packagedAppInfo = directoryInfo("dist/mas-arm64/Cody Cartridge.app", "MAS app bundle");
  const masSubmission = inspectMasSubmission(packagedAppInfo, uploadPackages);
  const packagedApp = {
    ...packagedAppInfo,
    mode: masSubmission.mode,
    submissionReady: masSubmission.submissionReady,
    localRehearsalOnly: masSubmission.localRehearsalOnly,
    signing: {
      codeSignatureVerified: masSubmission.codeSignatureVerified,
      codeSignatureToolAvailable: masSubmission.codeSignatureToolAvailable,
      codeSignatureStatus: masSubmission.codeSignatureStatus
    },
    provisioning: {
      hasEmbeddedProvisioningProfile: masSubmission.hasEmbeddedProvisioningProfile,
      embeddedProvisioningProfilePath: masSubmission.embeddedProvisioningProfilePath
    },
    upload: {
      uploadPackageCount: masSubmission.uploadPackageCount,
      signedUploadPackageCount: masSubmission.signedUploadPackageCount,
      currentVersionUploadPackageCount: masSubmission.currentVersionUploadPackageCount,
      signedCurrentVersionUploadPackageCount: masSubmission.signedCurrentVersionUploadPackageCount,
      hasSignedUploadPackage: masSubmission.hasSignedUploadPackage,
      hasCurrentVersionUploadPackage: masSubmission.hasCurrentVersionUploadPackage,
      hasSignedCurrentVersionUploadPackage: masSubmission.hasSignedCurrentVersionUploadPackage
    }
  };
  const publicSiteArchive = files.find((item) => item.path === "app-store-assets/public-site/cody-cartridge-public-site.zip");
  const urls = {
    supportUrl: fields.productPage?.supportUrl ?? null,
    privacyPolicyUrl: fields.productPage?.privacyPolicyUrl ?? null,
    marketingUrl: fields.productPage?.marketingUrl ?? null,
    accessibilityUrl: fields.accessibility?.accessibilityUrl ?? null,
    supportEmail: fields.urls?.supportEmail ?? null
  };
  const urlDisplay = {
    supportUrl: displayValue("supportUrl", urls.supportUrl, isFullUrl),
    privacyPolicyUrl: displayValue("privacyPolicyUrl", urls.privacyPolicyUrl, isFullUrl),
    marketingUrl: displayValue("marketingUrl", urls.marketingUrl, isFullUrl),
    accessibilityUrl: displayValue("accessibilityUrl", urls.accessibilityUrl, isFullUrl),
    supportEmail: displayValue("supportEmail", urls.supportEmail, isEmail)
  };
  const urlState = {
    supportUrl: valueState(urls.supportUrl, isFullUrl),
    privacyPolicyUrl: valueState(urls.privacyPolicyUrl, isFullUrl),
    marketingUrl: valueState(urls.marketingUrl, isFullUrl),
    accessibilityUrl: valueState(urls.accessibilityUrl, isFullUrl),
    supportEmail: valueState(urls.supportEmail, isEmail)
  };

  const blockers = [
    !isFullUrl(urls.supportUrl) ? "Support URL is not a complete public http(s) URL." : "",
    !isFullUrl(urls.privacyPolicyUrl) ? "Privacy Policy URL is not a complete public http(s) URL." : "",
    isPlaceholder(urls.supportEmail) ? "Support email is still a placeholder." : "",
    isPlaceholder(fields.review?.contact?.name) ||
    isPlaceholder(fields.review?.contact?.email) ||
    isPlaceholder(fields.review?.contact?.phone)
      ? "App Review contact is still placeholder data."
      : "",
    !publicSiteArchive?.exists ? "Public site publish archive has not been generated." : "",
    !packagedApp.exists ? "Signed MAS app bundle has not been generated in dist/mas-arm64." : "",
    packagedApp.exists && !masSubmission.hasEmbeddedProvisioningProfile
      ? "Signed MAS app bundle does not contain embedded provisioning profile."
      : "",
    packagedApp.exists && !masSubmission.codeSignatureVerified ? "Signed MAS app bundle code signature does not verify." : "",
    uploadPackages.length === 0 ? "Signed MAS upload .pkg has not been generated in dist/." : "",
    uploadPackages.length > 0 && !masSubmission.hasCurrentVersionUploadPackage
      ? "No MAS upload .pkg matches the current package version/build."
      : "",
    uploadPackages.length > 0 && !masSubmission.hasSignedUploadPackage
      ? "Signed MAS upload .pkg signature does not verify."
      : "",
    uploadPackages.length > 0 &&
    masSubmission.hasCurrentVersionUploadPackage &&
    !masSubmission.hasSignedCurrentVersionUploadPackage
      ? "Current-version MAS upload .pkg signature does not verify."
      : "",
    packagedApp.exists && masSubmission.localRehearsalOnly
      ? "MAS app bundle is local-rehearsal-only, not submission-ready."
      : ""
  ].filter(Boolean);

  const manifest = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion: pkg.build?.buildVersion ?? pkg.version,
      category: pkg.build?.mas?.category,
      productName: pkg.build?.productName
    },
    packaging: {
      asar: pkg.build?.asar === true,
      electronFuses: pkg.build?.electronFuses ?? {},
      fileAllowlist: pkg.build?.files ?? [],
      macMinimumSystemVersion: pkg.build?.mac?.minimumSystemVersion ?? null,
      rendererProtocol: "cody-app://",
      masMinimumSystemVersion: pkg.build?.mas?.minimumSystemVersion ?? null,
      masDevMinimumSystemVersion: pkg.build?.masDev?.minimumSystemVersion ?? null,
      infoPlistUsesNonExemptEncryption: pkg.build?.mac?.extendInfo?.ITSAppUsesNonExemptEncryption ?? null
    },
    environment: {
      node: process.version,
      nodeEngine: pkg.engines?.node ?? null,
      releaseNode: exists(".nvmrc") ? fs.readFileSync(path.join(projectRoot, ".nvmrc"), "utf8").trim() : null,
      platform: process.platform,
      arch: process.arch
    },
    urls,
    urlDisplay,
    urlState,
    files,
    packagedApp,
    masSubmission,
    uploadPackages,
    releaseCommands: [
      "npm run release:store:local",
      "npm run release:store:local:node",
      "npm run init:store-env",
      "npm run check:store-env",
      "npm run check:release-runtime -- --strict",
      "npm run check:release-runtime:node -- --strict",
      "npm run check:store-version:source",
      "npm run check:icons",
      "npm run check:electron-security",
      "npm run check:packaging-toolchain",
      "npm run notices:store",
      "npm run public-release:store -- --self-test",
      "npm run public-release:store:node -- --self-test",
      "npm run public-release:store -- --published",
      "npm run public-release:store:published:node",
      "npm run site:store",
      "npm run check:site -- --strict",
      "npm run archive:site",
      "npm run check:site-archive -- --strict",
      "npm run check:help-docs",
      "npm run smoke:electron-shell",
      "npm run smoke:clean-profile",
      "npm run smoke:store",
      "npm run smoke:a11y",
      "npm run screenshots:store",
      "npm run check:screenshots",
      "npm run export-compliance:store",
      "npm run packet:store",
      "npm run review-brief:store",
      "npm run copy-map:store",
      "npm run check:review-brief -- --strict",
      "npm run check:copy-map -- --strict",
      "npm run check:public-release-sync -- --strict",
      "npm run check:store-version",
      "npm run check:app-privacy",
      "npm run check:export-compliance",
      "npm run check:store-copy",
      "npm run check:artifact-privacy",
      "npm run check:store-urls -- --strict",
      "npm run check:published-site -- --strict",
      "npm run signing-assets:store",
      "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run",
      "npm run check:mas-signing -- --strict",
      "npm run dist:mas",
      "npm run check:mas-package -- --strict",
      "npm run check:upload-tooling -- --strict",
      "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run",
      "npm run check:upload-credentials -- --strict",
      "npm run upload-packet:store",
      "npm run apple-assets:store",
      "npm run upload-evidence:store",
      "npm run report:store-blockers",
      "npm run public-inputs:store",
      "npm run publish-packet:store",
      "npm run public-host:store",
      "npm run signing-assets:store",
      "npm run upload-packet:store",
      "npm run copy-map:store",
      "npm run apple-assets:store",
      "npm run signing-runbook:store",
      "npm run resolution-plan:store",
      "npm run submission-checklist:store",
      "npm run machine-report:store",
      "npm run evidence:store",
      "npm run check:evidence",
      "npm run dashboard:store",
      "npm run operator:store",
      "npm run manifest:store",
      "npm run check:manifest",
      "npm run handoff:store",
      "npm run check:release-machine -- --strict",
      "npm run check:release-machine:node -- --strict",
      "npm run verify:store:strict",
      "npm run verify:store:strict:node",
      "npm run release:store:preflight",
      "npm run release:store:preflight:node"
    ],
    blockers
  };

  const markdown = `# Cody Cartridge Release Manifest

Generated by \`npm run manifest:store\`.

## Candidate

- App: ${manifest.app.name}
- Bundle ID: ${manifest.app.bundleId}
- Version: ${manifest.app.version}
- Build version: ${manifest.app.buildVersion}
- Category: ${manifest.app.category}
- Generated: ${manifest.generatedAt}
- Node: ${manifest.environment.node} (${manifest.environment.platform}/${manifest.environment.arch})

## Public URLs

- Support URL: ${urlDisplay.supportUrl}
- Privacy Policy URL: ${urlDisplay.privacyPolicyUrl}
- Marketing URL: ${urlDisplay.marketingUrl}
- Accessibility URL: ${urlDisplay.accessibilityUrl}
- Support email: ${urlDisplay.supportEmail}
- Public site archive: \`${publicSiteArchive?.path ?? "missing"}\` (${publicSiteArchive?.exists ? publicSiteArchive.sha256 : "missing"})

## Packaging Source Config

- ASAR packaging: ${manifest.packaging.asar ? "enabled" : "disabled"}
- Packaged renderer protocol: \`${manifest.packaging.rendererProtocol}\`
- Mac minimum system version: ${manifest.packaging.macMinimumSystemVersion ?? "missing"}
- MAS minimum system version: ${manifest.packaging.masMinimumSystemVersion ?? "missing"}
- MAS development minimum system version: ${manifest.packaging.masDevMinimumSystemVersion ?? "missing"}
- Info.plist non-exempt encryption: ${manifest.packaging.infoPlistUsesNonExemptEncryption === false ? "false" : manifest.packaging.infoPlistUsesNonExemptEncryption ?? "missing"}
- Package file allowlist: ${manifest.packaging.fileAllowlist.map((pattern) => `\`${pattern}\``).join(", ")}
- Electron fuses: ${Object.entries(manifest.packaging.electronFuses)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")}

## Files

${table(files)}

## Packaged MAS App

- Path: \`${packagedApp.path}\`
- Status: ${packagedApp.exists ? "present" : "missing"}
- Submission posture: ${packagedApp.mode}
- Submission ready: ${packagedApp.submissionReady ? "yes" : "no"}
- Local rehearsal only: ${packagedApp.localRehearsalOnly ? "yes" : "no"}
- File count: ${packagedApp.fileCount}
- Size: ${packagedApp.sizeBytes} bytes
- Embedded provisioning profile: ${masSubmission.hasEmbeddedProvisioningProfile ? `present at \`${masSubmission.embeddedProvisioningProfilePath}\`` : "missing"}
- Code signature verifies: ${masSubmission.codeSignatureVerified ? "yes" : "no"}
- Signed upload packages: ${masSubmission.signedUploadPackageCount}/${masSubmission.uploadPackageCount}
- Current-version upload packages: ${masSubmission.currentVersionUploadPackageCount}/${masSubmission.uploadPackageCount}
- Signed current-version upload packages: ${masSubmission.signedCurrentVersionUploadPackageCount}/${masSubmission.uploadPackageCount}

## MAS Upload Packages

${uploadPackages.length > 0 ? uploadPackages.map((item) => `- \`${item.path}\` (${item.sizeBytes} bytes, current version: ${item.matchesCurrentVersion ? "yes" : "no"}, ${item.sha256 ?? "unhashed"})`).join("\n") : "- None found in `dist/`."}

## Release Commands

${manifest.releaseCommands.map((command) => `- \`${command}\``).join("\n")}

## Remaining Blockers

${blockers.length > 0 ? blockers.map((item) => `- ${item}`).join("\n") : "- None recorded by this manifest."}
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  blockers.forEach((blocker) => console.warn(blocker));
}

main();
