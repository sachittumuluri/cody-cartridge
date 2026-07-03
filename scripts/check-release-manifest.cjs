#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const jsonPath = path.join(projectRoot, "app-store-assets", "RELEASE_MANIFEST.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "RELEASE_MANIFEST.md");
const passes = [];
const warnings = [];
const failures = [];

function pass(message) {
  passes.push(message);
}

function warn(message) {
  warnings.push(message);
}

function fail(message) {
  failures.push(message);
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

function sha256(absolutePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
}

function manifestFile(manifest, filePath) {
  return (manifest.files ?? []).find((item) => item.path === filePath);
}

function releaseCommand(manifest, command) {
  return (manifest.releaseCommands ?? []).includes(command);
}

function commandsInOrder(commands, ...expected) {
  if (!Array.isArray(commands)) {
    return false;
  }

  let cursor = -1;

  for (const command of expected) {
    const next = commands.indexOf(command, cursor + 1);

    if (next < 0) {
      return false;
    }

    cursor = next;
  }

  return true;
}

function validateFileInventoryItem(item) {
  if (!item?.path) {
    fail("Release manifest inventory item has a path");
    return;
  }

  const absolutePath = path.join(projectRoot, item.path);

  if (item.exists === true) {
    assert(fs.existsSync(absolutePath), `Release manifest inventory exists on disk: ${item.path}`);

    if (fs.existsSync(absolutePath)) {
      const stat = fs.statSync(absolutePath);
      assert(stat.isFile(), `Release manifest inventory item is a file: ${item.path}`);
      assert(item.sizeBytes === stat.size, `Release manifest inventory size matches disk: ${item.path}`);
      assert(item.sha256 === sha256(absolutePath), `Release manifest inventory hash matches disk: ${item.path}`);
    }

    return;
  }

  assert(!fs.existsSync(absolutePath), `Release manifest missing inventory status matches disk: ${item.path}`);
}

function main() {
  assert(exists("app-store-assets/RELEASE_MANIFEST.json"), "Release manifest JSON exists");
  assert(exists("app-store-assets/RELEASE_MANIFEST.md"), "Release manifest markdown exists");

  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath)) {
    return;
  }

  const manifest = readJson("app-store-assets/RELEASE_MANIFEST.json");
  const markdown = readText("app-store-assets/RELEASE_MANIFEST.md");
  const pkg = readJson("package.json");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const evidence = readJson("app-store-assets/RELEASE_EVIDENCE.json");
  const requiredFiles = [
    "package.json",
    "package-lock.json",
    ".nvmrc",
    ".node-version",
    "build/icon.icns",
    "build/PrivacyInfo.xcprivacy",
    "build/entitlements.mas.plist",
    "build/entitlements.mas.inherit.plist",
    "index.html",
    "vite.config.ts",
    "src/main.tsx",
    "src/App.tsx",
    "src/styles.css",
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
    "app-store-assets/RELEASE_DASHBOARD.json",
    "app-store-assets/RELEASE_DASHBOARD.html",
    "app-store-assets/RELEASE_OPERATOR_QUEUE.json",
    "app-store-assets/RELEASE_OPERATOR_QUEUE.md",
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
    "app-store-assets/RELEASE_EVIDENCE.json",
    "app-store-assets/RELEASE_EVIDENCE.md",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/RELEASE_BLOCKERS.md",
    "app-store-assets/THIRD_PARTY_NOTICES.json",
    "app-store-assets/THIRD_PARTY_NOTICES.md",
    "app-store-assets/PRIVACY_POLICY.md",
    "app-store-assets/SUPPORT.md",
    "app-store-assets/ACCESSIBILITY.md",
    "app-store-assets/site/index.html",
    "app-store-assets/site/privacy.html",
    "app-store-assets/site/support.html",
    "app-store-assets/site/accessibility.html",
    "app-store-assets/site/third-party-notices.html",
    "app-store-assets/site/robots.txt",
    "app-store-assets/site/sitemap.xml",
    "app-store-assets/site/_headers",
    "app-store-assets/site/vercel.json",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/site.env.example",
    "app-store-assets/screenshots/STORE_SCREENSHOTS.json",
    "app-store-assets/screenshots/01-library-1440x900.png",
    "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    "app-store-assets/screenshots/03-missing-files-1440x900.png",
    "scripts/build-release-manifest.cjs",
    "scripts/check-release-manifest.cjs",
    "scripts/configure-store-env.cjs",
    "scripts/build-release-evidence.cjs",
    "scripts/check-release-evidence.cjs",
    "scripts/build-public-site-publish-packet.cjs",
    "scripts/check-public-site-publish-packet.cjs",
    "scripts/build-public-host-runbook.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/build-release-machine-report.cjs",
    "scripts/check-release-machine-report.cjs",
    "scripts/check-store-version.cjs",
    "scripts/refresh-public-release.cjs",
    "scripts/build-apple-release-assets.cjs",
    "scripts/check-apple-release-assets.cjs",
    "scripts/install-mas-profile.cjs",
    "scripts/build-upload-command-packet.cjs",
    "scripts/check-upload-command-packet.cjs",
    "scripts/build-upload-evidence.cjs",
    "scripts/check-upload-evidence.cjs",
    "scripts/check-release-runtime.cjs",
    "scripts/run-release-node.cjs",
    "scripts/check-release-machine.cjs",
    "scripts/smoke-mas-runtime.cjs",
    "scripts/install-asc-key.cjs",
    "scripts/check-upload-credentials.cjs",
    "scripts/verify-store-readiness.cjs",
    "scripts/verify-store-readiness-with-build.cjs"
  ];
  const requiredCommands = [
    "npm run release:store:local",
    "npm run release:store:local:node",
    "npm run init:store-env",
    "npm run check:store-env",
    "npm run check:release-runtime -- --strict",
    "npm run check:release-runtime:node -- --strict",
    "npm run check:store-version:source",
    "npm run public-release:store -- --self-test",
    "npm run public-release:store:node -- --self-test",
    "npm run public-release:store -- --published",
    "npm run public-release:store:published:node",
    "npm run site:store",
    "npm run check:site -- --strict",
    "npm run archive:site",
    "npm run check:site-archive -- --strict",
    "npm run export-compliance:store",
    "npm run packet:store",
    "npm run review-brief:store",
    "npm run copy-map:store",
    "npm run check:review-brief -- --strict",
    "npm run check:copy-map -- --strict",
    "npm run check:public-release-sync -- --strict",
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
  ];

  assert(manifest.app?.bundleId === pkg.build?.appId, "Release manifest bundle id matches package config");
  assert(manifest.app?.version === pkg.version, "Release manifest version matches package config");
  assert(manifest.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Release manifest build version matches package config");
  assert(manifest.app?.name === pkg.build?.productName, "Release manifest app name matches package config");
  assert(manifest.packaging?.asar === true, "Release manifest records ASAR packaging");
  assert(manifest.packaging?.rendererProtocol === "cody-app://", "Release manifest records renderer protocol");
  assert(manifest.packaging?.macMinimumSystemVersion === "12.0", "Release manifest records macOS minimum version");
  assert(manifest.packaging?.masMinimumSystemVersion === "12.0", "Release manifest records MAS minimum version");
  assert(manifest.packaging?.infoPlistUsesNonExemptEncryption === false, "Release manifest records no non-exempt encryption");
  assert(manifest.urls?.supportUrl === fields.productPage?.supportUrl, "Release manifest support URL matches App Store fields");
  assert(manifest.urls?.privacyPolicyUrl === fields.productPage?.privacyPolicyUrl, "Release manifest privacy URL matches App Store fields");
  assert(manifest.urls?.supportEmail === fields.urls?.supportEmail, "Release manifest support email matches App Store fields");
  assert(
    ["supportUrl", "privacyPolicyUrl", "marketingUrl", "accessibilityUrl", "supportEmail"].every((field) =>
      ["missing", "placeholder", "invalid", "ready"].includes(manifest.urlState?.[field])
    ),
    "Release manifest records public URL/contact readiness states"
  );
  assert(Array.isArray(manifest.files) && manifest.files.length >= requiredFiles.length, "Release manifest records file inventory");

  requiredFiles.forEach((filePath) => {
    assert(Boolean(manifestFile(manifest, filePath)), `Release manifest hashes ${filePath}`);
  });
  (manifest.files ?? []).forEach(validateFileInventoryItem);

  assert(manifest.packagedApp?.path === "dist/mas-arm64/Cody Cartridge.app", "Release manifest records packaged app path");
  assert(manifest.masSubmission?.bundlePath === manifest.packagedApp?.path, "Release manifest MAS bundle path matches packaged app");
  assert(manifest.masSubmission?.mode === manifest.packagedApp?.mode, "Release manifest MAS mode matches packaged app");
  assert(manifest.masSubmission?.submissionReady === manifest.packagedApp?.submissionReady, "Release manifest MAS readiness matches packaged app");
  assert(
    manifest.masSubmission?.localRehearsalOnly === manifest.packagedApp?.localRehearsalOnly,
    "Release manifest local rehearsal flag matches packaged app"
  );
  assert(
    manifest.masSubmission?.hasEmbeddedProvisioningProfile === manifest.packagedApp?.provisioning?.hasEmbeddedProvisioningProfile,
    "Release manifest provisioning posture matches packaged app"
  );
  assert(
    manifest.masSubmission?.codeSignatureVerified === manifest.packagedApp?.signing?.codeSignatureVerified,
    "Release manifest code-signature posture matches packaged app"
  );
  assert(
    manifest.masSubmission?.currentVersionUploadPackageCount === manifest.packagedApp?.upload?.currentVersionUploadPackageCount &&
      manifest.masSubmission?.signedCurrentVersionUploadPackageCount === manifest.packagedApp?.upload?.signedCurrentVersionUploadPackageCount,
    "Release manifest current-version upload package posture matches packaged app"
  );
  assert(typeof manifest.masSubmission?.currentVersionUploadPackageCount === "number", "Release manifest records current-version MAS upload package count");
  assert(
    typeof manifest.masSubmission?.signedCurrentVersionUploadPackageCount === "number",
    "Release manifest records signed current-version MAS upload package count"
  );
  assert(
    manifest.masSubmission?.submissionReady !== true || manifest.masSubmission?.hasSignedCurrentVersionUploadPackage === true,
    "Release manifest requires a signed current-version upload package for MAS submission readiness"
  );
  assert(manifest.masSubmission?.mode === evidence.masSubmission?.mode, "Release manifest MAS mode matches release evidence");
  assert(
    manifest.masSubmission?.submissionReady === evidence.masSubmission?.submissionReady,
    "Release manifest MAS readiness matches release evidence"
  );
  assert(
    manifest.masSubmission?.hasEmbeddedProvisioningProfile === evidence.masSubmission?.hasEmbeddedProvisioningProfile,
    "Release manifest provisioning posture matches release evidence"
  );
  assert(
    manifest.masSubmission?.codeSignatureVerified === evidence.masSubmission?.codeSignatureVerified,
    "Release manifest code-signature posture matches release evidence"
  );
  assert(
    manifest.masSubmission?.uploadPackageCount === evidence.masSubmission?.uploadPackageCount &&
      manifest.masSubmission?.signedUploadPackageCount === evidence.masSubmission?.signedUploadPackageCount &&
      manifest.masSubmission?.currentVersionUploadPackageCount === evidence.masSubmission?.currentVersionUploadPackageCount &&
      manifest.masSubmission?.signedCurrentVersionUploadPackageCount === evidence.masSubmission?.signedCurrentVersionUploadPackageCount,
    "Release manifest MAS upload package posture matches release evidence"
  );
  assert(Array.isArray(manifest.uploadPackages), "Release manifest records MAS upload package inventory");
  assert(
    (manifest.uploadPackages ?? []).every((item) => typeof item.matchesCurrentVersion === "boolean"),
    "Release manifest records per-package current-version match state"
  );

  requiredCommands.forEach((command) => {
    assert(releaseCommand(manifest, command), `Release manifest records command: ${command}`);
  });
  assert(
    manifest.releaseCommands?.indexOf("npm run evidence:store") < manifest.releaseCommands?.indexOf("npm run manifest:store"),
    "Release manifest command order records evidence before manifest"
  );
  assert(
    manifest.releaseCommands?.indexOf("npm run check:evidence") < manifest.releaseCommands?.indexOf("npm run manifest:store"),
    "Release manifest command order checks evidence before manifest"
  );
  assert(
    manifest.releaseCommands?.indexOf("npm run machine-report:store") < manifest.releaseCommands?.indexOf("npm run evidence:store"),
    "Release manifest command order records machine report before evidence"
  );
  assert(
    manifest.releaseCommands?.indexOf("npm run signing-assets:store") <
      manifest.releaseCommands?.indexOf("npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run") &&
      manifest.releaseCommands?.indexOf("npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run") <
        manifest.releaseCommands?.indexOf("npm run check:mas-signing -- --strict"),
    "Release manifest command order validates MAS profile before strict signing"
  );
  assert(
    manifest.releaseCommands?.indexOf("npm run check:manifest") < manifest.releaseCommands?.indexOf("npm run handoff:store"),
    "Release manifest command order checks manifest before handoff"
  );
  assert(
    manifest.releaseCommands?.indexOf("npm run check:upload-tooling -- --strict") <
      manifest.releaseCommands?.indexOf("npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") &&
      manifest.releaseCommands?.indexOf("npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") <
      manifest.releaseCommands?.indexOf("npm run check:upload-credentials -- --strict") &&
      manifest.releaseCommands?.indexOf("npm run check:upload-credentials -- --strict") <
      manifest.releaseCommands?.indexOf("npm run upload-packet:store") &&
      manifest.releaseCommands?.indexOf("npm run upload-packet:store") <
      manifest.releaseCommands?.indexOf("npm run apple-assets:store") &&
      manifest.releaseCommands?.indexOf("npm run apple-assets:store") <
      manifest.releaseCommands?.indexOf("npm run upload-evidence:store") &&
      manifest.releaseCommands?.indexOf("npm run upload-evidence:store") <
        manifest.releaseCommands?.indexOf("npm run report:store-blockers"),
    "Release manifest command order captures ASC key validation, upload packet, and evidence after upload tooling"
  );
  assert(
    commandsInOrder(
      manifest.releaseCommands,
      "npm run public-inputs:store",
      "npm run publish-packet:store",
      "npm run public-host:store",
      "npm run signing-assets:store",
      "npm run upload-packet:store",
      "npm run copy-map:store",
      "npm run apple-assets:store",
      "npm run signing-runbook:store"
    ),
    "Release manifest command order refreshes public host runbook after publish packet"
  );
  assert(
    manifest.releaseCommands?.indexOf("npm run check:store-urls -- --strict") <
      manifest.releaseCommands?.indexOf("npm run check:published-site -- --strict") &&
      manifest.releaseCommands?.indexOf("npm run check:published-site -- --strict") <
        manifest.releaseCommands?.indexOf("npm run signing-assets:store"),
    "Release manifest command order checks full published site before signing assets"
  );
  assert(
    manifest.releaseCommands?.indexOf("npm run check:mas-package -- --strict") <
      manifest.releaseCommands?.indexOf("npm run check:upload-tooling -- --strict"),
    "Release manifest command order checks upload tooling after strict MAS package verification"
  );
  assert(
    manifest.releaseCommands?.indexOf("npm run check:upload-tooling -- --strict") <
      manifest.releaseCommands?.indexOf("npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") &&
      manifest.releaseCommands?.indexOf("npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run") <
      manifest.releaseCommands?.indexOf("npm run check:upload-credentials -- --strict"),
    "Release manifest command order checks upload credentials after ASC key validation"
  );

  assert(markdown.includes("# Cody Cartridge Release Manifest"), "Release manifest markdown includes title");
  assert(markdown.includes("## Public URLs"), "Release manifest markdown includes public URLs section");
  assert(markdown.includes("## Packaging Source Config"), "Release manifest markdown includes packaging source config");
  assert(markdown.includes("## Packaged MAS App"), "Release manifest markdown includes MAS app section");
  assert(markdown.includes("## MAS Upload Packages"), "Release manifest markdown includes upload package section");
  assert(markdown.includes("## Remaining Blockers"), "Release manifest markdown includes blocker section");

  if ((manifest.blockers ?? []).length > 0) {
    warn(`Release manifest records ${manifest.blockers.length} blocker(s)`);
  } else {
    pass("Release manifest records no blockers");
  }
}

main();

console.log(`Release manifest checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
