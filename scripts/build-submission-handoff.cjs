#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "app-store-assets", "submission-handoff");
const archivePath = path.join(outputDir, "cody-cartridge-app-store-handoff.zip");
const manifestPath = path.join(outputDir, "SUBMISSION_HANDOFF.json");
const fixedDosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
const fixedDosTime = 0;

const sourceEntries = [
  ["APP_STORE_READINESS.md", "APP_STORE_READINESS.md", "readiness guide"],
  ["app-store-assets/SUBMISSION_PACKET.md", "SUBMISSION_PACKET.md", "submission packet"],
  ["app-store-assets/APP_STORE_CONNECT_FIELDS.json", "APP_STORE_CONNECT_FIELDS.json", "App Store fields"],
  ["app-store-assets/APP_STORE_CONNECT_COPY_MAP.json", "APP_STORE_CONNECT_COPY_MAP.json", "App Store copy map"],
  ["app-store-assets/APP_STORE_CONNECT_COPY_MAP.md", "APP_STORE_CONNECT_COPY_MAP.md", "App Store copy map"],
  ["app-store-assets/EXPORT_COMPLIANCE.json", "EXPORT_COMPLIANCE.json", "export compliance prep"],
  ["app-store-assets/EXPORT_COMPLIANCE.md", "EXPORT_COMPLIANCE.md", "export compliance prep"],
  ["app-store-assets/APP_STORE_COMPLIANCE.json", "APP_STORE_COMPLIANCE.json", "App Store compliance packet"],
  ["app-store-assets/APP_STORE_COMPLIANCE.md", "APP_STORE_COMPLIANCE.md", "App Store compliance packet"],
  ["app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json", "APP_STORE_CONNECT_MANUAL_TASKS.json", "App Store Connect manual task packet"],
  ["app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md", "APP_STORE_CONNECT_MANUAL_TASKS.md", "App Store Connect manual task packet"],
  ["app-store-assets/APP_CONTENT_RIGHTS.json", "APP_CONTENT_RIGHTS.json", "content rights media audit"],
  ["app-store-assets/APP_CONTENT_RIGHTS.md", "APP_CONTENT_RIGHTS.md", "content rights media audit"],
  ["app-store-assets/APP_REVIEW_BRIEF.json", "APP_REVIEW_BRIEF.json", "App Review brief"],
  ["app-store-assets/APP_REVIEW_BRIEF.md", "APP_REVIEW_BRIEF.md", "App Review brief"],
  ["app-store-assets/PUBLIC_RELEASE_INPUTS.json", "PUBLIC_RELEASE_INPUTS.json", "public release inputs"],
  ["app-store-assets/PUBLIC_RELEASE_INPUTS.md", "PUBLIC_RELEASE_INPUTS.md", "public release inputs"],
  ["app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json", "PUBLIC_SITE_PUBLISH_PACKET.json", "public site publish packet"],
  ["app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md", "PUBLIC_SITE_PUBLISH_PACKET.md", "public site publish packet"],
  ["app-store-assets/PUBLIC_HOST_RUNBOOK.json", "PUBLIC_HOST_RUNBOOK.json", "public host runbook"],
  ["app-store-assets/PUBLIC_HOST_RUNBOOK.md", "PUBLIC_HOST_RUNBOOK.md", "public host runbook"],
  ["app-store-assets/RELEASE_RESOLUTION_PLAN.json", "RELEASE_RESOLUTION_PLAN.json", "release resolution plan"],
  ["app-store-assets/RELEASE_RESOLUTION_PLAN.md", "RELEASE_RESOLUTION_PLAN.md", "release resolution plan"],
  ["app-store-assets/FINAL_SUBMISSION_CHECKLIST.json", "FINAL_SUBMISSION_CHECKLIST.json", "final submission checklist"],
  ["app-store-assets/FINAL_SUBMISSION_CHECKLIST.md", "FINAL_SUBMISSION_CHECKLIST.md", "final submission checklist"],
  ["app-store-assets/RELEASE_MACHINE_REPORT.json", "RELEASE_MACHINE_REPORT.json", "release machine report"],
  ["app-store-assets/RELEASE_MACHINE_REPORT.md", "RELEASE_MACHINE_REPORT.md", "release machine report"],
  ["app-store-assets/RELEASE_DASHBOARD.json", "RELEASE_DASHBOARD.json", "release dashboard"],
  ["app-store-assets/RELEASE_DASHBOARD.html", "RELEASE_DASHBOARD.html", "release dashboard"],
  ["app-store-assets/RELEASE_OPERATOR_QUEUE.json", "RELEASE_OPERATOR_QUEUE.json", "release operator queue"],
  ["app-store-assets/RELEASE_OPERATOR_QUEUE.md", "RELEASE_OPERATOR_QUEUE.md", "release operator queue"],
  ["app-store-assets/SIGNING_UPLOAD_RUNBOOK.json", "SIGNING_UPLOAD_RUNBOOK.json", "signing upload runbook"],
  ["app-store-assets/SIGNING_UPLOAD_RUNBOOK.md", "SIGNING_UPLOAD_RUNBOOK.md", "signing upload runbook"],
  ["app-store-assets/SIGNING_ASSET_REPORT.json", "SIGNING_ASSET_REPORT.json", "signing asset report"],
  ["app-store-assets/SIGNING_ASSET_REPORT.md", "SIGNING_ASSET_REPORT.md", "signing asset report"],
  ["app-store-assets/APPLE_RELEASE_ASSETS.json", "APPLE_RELEASE_ASSETS.json", "Apple release asset requests"],
  ["app-store-assets/APPLE_RELEASE_ASSETS.md", "APPLE_RELEASE_ASSETS.md", "Apple release asset requests"],
  ["app-store-assets/UPLOAD_COMMAND_PACKET.json", "UPLOAD_COMMAND_PACKET.json", "upload command packet"],
  ["app-store-assets/UPLOAD_COMMAND_PACKET.md", "UPLOAD_COMMAND_PACKET.md", "upload command packet"],
  ["app-store-assets/UPLOAD_EVIDENCE.json", "UPLOAD_EVIDENCE.json", "upload evidence"],
  ["app-store-assets/UPLOAD_EVIDENCE.md", "UPLOAD_EVIDENCE.md", "upload evidence"],
  ["app-store-assets/APP_STORE_LISTING.md", "APP_STORE_LISTING.md", "listing draft"],
  ["app-store-assets/PRIVACY_POLICY.md", "PRIVACY_POLICY.md", "privacy policy draft"],
  ["app-store-assets/SUPPORT.md", "SUPPORT.md", "support draft"],
  ["app-store-assets/ACCESSIBILITY.md", "ACCESSIBILITY.md", "accessibility draft"],
  ["app-store-assets/THIRD_PARTY_NOTICES.json", "THIRD_PARTY_NOTICES.json", "third-party notices"],
  ["app-store-assets/THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md", "third-party notices"],
  ["app-store-assets/RELEASE_BLOCKERS.json", "RELEASE_BLOCKERS.json", "release blocker report"],
  ["app-store-assets/RELEASE_BLOCKERS.md", "RELEASE_BLOCKERS.md", "release blocker report"],
  ["app-store-assets/RELEASE_EVIDENCE.json", "RELEASE_EVIDENCE.json", "release evidence"],
  ["app-store-assets/RELEASE_EVIDENCE.md", "RELEASE_EVIDENCE.md", "release evidence"],
  ["app-store-assets/RELEASE_MANIFEST.json", "RELEASE_MANIFEST.json", "release manifest"],
  ["app-store-assets/RELEASE_MANIFEST.md", "RELEASE_MANIFEST.md", "release manifest"],
  ["app-store-assets/site.env.example", "site.env.example", "release env template"],
  ["app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json", "public-site/PUBLIC_SITE_ARCHIVE.json", "public site archive manifest"],
  ["app-store-assets/public-site/cody-cartridge-public-site.zip", "public-site/cody-cartridge-public-site.zip", "public site archive"],
  ["app-store-assets/screenshots/STORE_SCREENSHOTS.json", "screenshots/STORE_SCREENSHOTS.json", "store screenshots"],
  ["app-store-assets/screenshots/01-library-1440x900.png", "screenshots/01-library-1440x900.png", "store screenshots"],
  ["app-store-assets/screenshots/02-takeout-map-1440x900.png", "screenshots/02-takeout-map-1440x900.png", "store screenshots"],
  ["app-store-assets/screenshots/03-missing-files-1440x900.png", "screenshots/03-missing-files-1440x900.png", "store screenshots"]
];

const crcTable = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  crcTable[index] = value >>> 0;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function localHeader(entry) {
  return Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0x0800),
    u16(0),
    u16(fixedDosTime),
    u16(fixedDosDate),
    u32(entry.crc),
    u32(entry.data.length),
    u32(entry.data.length),
    u16(entry.nameBuffer.length),
    u16(0),
    entry.nameBuffer
  ]);
}

function centralDirectoryHeader(entry) {
  return Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0x0800),
    u16(0),
    u16(fixedDosTime),
    u16(fixedDosDate),
    u32(entry.crc),
    u32(entry.data.length),
    u32(entry.data.length),
    u16(entry.nameBuffer.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0x81a40000),
    u32(entry.localOffset),
    entry.nameBuffer
  ]);
}

function buildZip(inputEntries) {
  const fileParts = [];
  const centralParts = [];
  const entries = [];
  let localOffset = 0;

  inputEntries.forEach((entry) => {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    entries.push({
      ...entry,
      crc: crc32(entry.data),
      localOffset,
      nameBuffer
    });
    localOffset += 30 + nameBuffer.length + entry.data.length;
  });

  entries.forEach((entry) => {
    fileParts.push(localHeader(entry), entry.data);
  });

  let centralSize = 0;

  entries.forEach((entry) => {
    const header = centralDirectoryHeader(entry);
    centralParts.push(header);
    centralSize += header.length;
  });

  const endOfCentralDirectory = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(localOffset),
    u16(0)
  ]);

  return Buffer.concat([...fileParts, ...centralParts, endOfCentralDirectory]);
}

function readJson(relativePath, fallback) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com/i.test(String(value ?? ""));
}

function readSourceEntries() {
  return sourceEntries.map(([sourcePath, name, kind]) => {
    const absolutePath = path.join(projectRoot, sourcePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Missing handoff source: ${sourcePath}`);
    }

    const data = fs.readFileSync(absolutePath);

    return {
      data,
      kind,
      name,
      sha256: sha256(data),
      sizeBytes: data.length,
      sourcePath
    };
  });
}

function buildReadme(fields, blockers, releaseManifest) {
  const supportUrl = fields.productPage?.supportUrl ?? "missing";
  const privacyUrl = fields.productPage?.privacyPolicyUrl ?? "missing";
  const blockerCount = blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0;
  const masSubmission = releaseManifest.masSubmission ?? {};
  const masMode = masSubmission.mode ?? releaseManifest.packagedApp?.mode ?? "unknown";
  const masReady = masSubmission.submissionReady === true ? "yes" : "no";
  const masBundle = masSubmission.bundlePath ?? releaseManifest.packagedApp?.path ?? "missing";
  const masProfile = masSubmission.hasEmbeddedProvisioningProfile === true ? "present" : "missing";
  const masSignature = masSubmission.codeSignatureVerified === true ? "verified" : "not verified";
  const masSignedPackages = `${masSubmission.signedUploadPackageCount ?? 0}/${masSubmission.uploadPackageCount ?? 0}`;
  const masSignedCurrentPackages = `${masSubmission.signedCurrentVersionUploadPackageCount ?? 0}/${masSubmission.uploadPackageCount ?? 0}`;
  const masReadinessNote =
    masSubmission.submissionReady === true
      ? "ready for strict release-machine verification"
      : "not submission-ready until the release machine produces a signed MAS app with embedded provisioning profile and a signed current-version upload .pkg";

  return Buffer.from(
    [
      "Cody Cartridge App Store Handoff",
      "",
      "This archive contains generated App Store Connect copy, review notes, screenshots, policy/support drafts, release evidence, and the public-site archive.",
      "It also includes RELEASE_MACHINE_REPORT.md as the redacted gate snapshot to inspect before using Apple signing or upload credentials.",
      "",
      `Support URL: ${supportUrl}`,
      `Privacy Policy URL: ${privacyUrl}`,
      `Current blocker count: ${blockerCount}`,
      "",
      "MAS submission posture:",
      `- Bundle: ${masBundle}`,
      `- Mode: ${masMode}`,
      `- Submission ready: ${masReady}`,
      `- Embedded provisioning profile: ${masProfile}`,
      `- Code signature: ${masSignature}`,
      `- Signed upload packages: ${masSignedPackages}`,
      `- Signed current-version upload packages: ${masSignedCurrentPackages}`,
      `- Readiness note: ${masReadinessNote}`,
      "",
      "Release-machine order:",
      "1. Review PUBLIC_RELEASE_INPUTS.md, then fill app-store-assets/site.env or export the CODY_* public URL/contact values.",
      "2. Run npm run site:store && npm run site:archive && npm run publish-packet:store && npm run public-host:store; the public-site archive includes _headers and vercel.json static-host metadata.",
      "3. Run npm run export-compliance:store && npm run packet:store && npm run review-brief:store && npm run copy-map:store && npm run check:store-version && npm run check:export-compliance && npm run check:store-copy && npm run check:artifact-privacy.",
      "4. Run npm run check:store-urls -- --strict and npm run check:published-site -- --strict after publishing the public site.",
      "5. Open RELEASE_OPERATOR_QUEUE.md, RELEASE_DASHBOARD.html, and RELEASE_MACHINE_REPORT.md, review RELEASE_RESOLUTION_PLAN.md, SIGNING_ASSET_REPORT.md, UPLOAD_COMMAND_PACKET.md, SIGNING_UPLOAD_RUNBOOK.md, and FINAL_SUBMISSION_CHECKLIST.md, install Apple signing/provisioning assets, then run npm run release:store:preflight.",
      "",
      "The handoff archive intentionally excludes app-store-assets/site.env, raw upload delivery logs, dist/, node_modules/, local music files, YouTube Music Takeout exports, Apple signing certificates/private keys, provisioning profiles, and App Store Connect API credentials.",
      ""
    ].join("\n"),
    "utf8"
  );
}

function main() {
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json", {});
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json", { summary: {}, blockers: [] });
  const releaseManifest = readJson("app-store-assets/RELEASE_MANIFEST.json", {});
  const masSubmission = releaseManifest.masSubmission ?? {};
  const entries = [
    {
      data: buildReadme(fields, blockers, releaseManifest),
      kind: "handoff instructions",
      name: "README.txt",
      sourcePath: "generated",
      get sha256() {
        return sha256(this.data);
      },
      get sizeBytes() {
        return this.data.length;
      }
    },
    ...readSourceEntries()
  ];
  const archive = buildZip(entries.map(({ name, data }) => ({ name, data })));
  const blockerCount = blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0;
  const manifest = {
    generatedAt: new Date().toISOString(),
    archivePath: "app-store-assets/submission-handoff/cody-cartridge-app-store-handoff.zip",
    archiveSha256: sha256(archive),
    archiveSizeBytes: archive.length,
    app: {
      bundleId: fields.app?.bundleId ?? null,
      packageVersion: fields.app?.packageVersion ?? null,
      buildVersion: fields.app?.buildVersion ?? null,
      name: fields.productPage?.name ?? "Cody Cartridge"
    },
    blockers: {
      blockerCount,
      readyForStrictPreflight: blockerCount === 0 && Boolean(blockers.summary?.readyForStrictPreflight)
    },
    masSubmission: {
      mode: masSubmission.mode ?? releaseManifest.packagedApp?.mode ?? "unknown",
      submissionReady: masSubmission.submissionReady === true,
      localRehearsalOnly: masSubmission.localRehearsalOnly === true,
      bundlePath: masSubmission.bundlePath ?? releaseManifest.packagedApp?.path ?? null,
      hasEmbeddedProvisioningProfile: masSubmission.hasEmbeddedProvisioningProfile === true,
      codeSignatureVerified: masSubmission.codeSignatureVerified === true,
      uploadPackageCount: Number(masSubmission.uploadPackageCount ?? 0),
      signedUploadPackageCount: Number(masSubmission.signedUploadPackageCount ?? 0),
      currentVersionUploadPackageCount: Number(masSubmission.currentVersionUploadPackageCount ?? 0),
      signedCurrentVersionUploadPackageCount: Number(masSubmission.signedCurrentVersionUploadPackageCount ?? 0),
      hasSignedUploadPackage: masSubmission.hasSignedUploadPackage === true,
      hasCurrentVersionUploadPackage: masSubmission.hasCurrentVersionUploadPackage === true,
      hasSignedCurrentVersionUploadPackage: masSubmission.hasSignedCurrentVersionUploadPackage === true
    },
    placeholders: {
      supportUrl: isPlaceholder(fields.productPage?.supportUrl),
      privacyPolicyUrl: isPlaceholder(fields.productPage?.privacyPolicyUrl),
      supportEmail: isPlaceholder(fields.urls?.supportEmail),
      appReviewContact:
        isPlaceholder(fields.review?.contact?.name) ||
        isPlaceholder(fields.review?.contact?.email) ||
        isPlaceholder(fields.review?.contact?.phone)
    },
    exclusions: [
      "app-store-assets/site.env",
      "app-store-assets/upload-logs/raw/",
      "raw upload delivery logs",
      "dist/",
      "node_modules/",
      "local music import directory",
      "YouTube Music Takeout export directory",
      "Apple signing certificates/private keys",
      "macOS provisioning profiles",
      "App Store Connect API keys/credentials"
    ],
    entries: entries.map(({ data, ...entry }) => entry)
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(archivePath, archive);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Built ${path.relative(projectRoot, archivePath)}`);
  console.log(`Built ${path.relative(projectRoot, manifestPath)}`);

  if (blockerCount > 0) {
    console.warn(`Handoff archive records ${blockerCount} remaining blocker(s).`);
  }
}

main();
