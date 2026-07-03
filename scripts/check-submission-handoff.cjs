#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const archivePath = path.join(projectRoot, "app-store-assets", "submission-handoff", "cody-cartridge-app-store-handoff.zip");
const manifestPath = path.join(projectRoot, "app-store-assets", "submission-handoff", "SUBMISSION_HANDOFF.json");
const requiredEntries = [
  "README.txt",
  "APP_STORE_READINESS.md",
  "SUBMISSION_PACKET.md",
  "APP_STORE_CONNECT_FIELDS.json",
  "APP_STORE_CONNECT_COPY_MAP.json",
  "APP_STORE_CONNECT_COPY_MAP.md",
  "EXPORT_COMPLIANCE.json",
  "EXPORT_COMPLIANCE.md",
  "APP_STORE_COMPLIANCE.json",
  "APP_STORE_COMPLIANCE.md",
  "APP_STORE_CONNECT_MANUAL_TASKS.json",
  "APP_STORE_CONNECT_MANUAL_TASKS.md",
  "APP_CONTENT_RIGHTS.json",
  "APP_CONTENT_RIGHTS.md",
  "APP_REVIEW_BRIEF.json",
  "APP_REVIEW_BRIEF.md",
  "PUBLIC_RELEASE_INPUTS.json",
  "PUBLIC_RELEASE_INPUTS.md",
  "PUBLIC_SITE_PUBLISH_PACKET.json",
  "PUBLIC_SITE_PUBLISH_PACKET.md",
  "PUBLIC_HOST_RUNBOOK.json",
  "PUBLIC_HOST_RUNBOOK.md",
  "RELEASE_RESOLUTION_PLAN.json",
  "RELEASE_RESOLUTION_PLAN.md",
  "FINAL_SUBMISSION_CHECKLIST.json",
  "FINAL_SUBMISSION_CHECKLIST.md",
  "RELEASE_MACHINE_REPORT.json",
  "RELEASE_MACHINE_REPORT.md",
  "RELEASE_DASHBOARD.json",
  "RELEASE_DASHBOARD.html",
  "RELEASE_OPERATOR_QUEUE.json",
  "RELEASE_OPERATOR_QUEUE.md",
  "SIGNING_UPLOAD_RUNBOOK.json",
  "SIGNING_UPLOAD_RUNBOOK.md",
  "SIGNING_ASSET_REPORT.json",
  "SIGNING_ASSET_REPORT.md",
  "APPLE_RELEASE_ASSETS.json",
  "APPLE_RELEASE_ASSETS.md",
  "UPLOAD_COMMAND_PACKET.json",
  "UPLOAD_COMMAND_PACKET.md",
  "UPLOAD_EVIDENCE.json",
  "UPLOAD_EVIDENCE.md",
  "APP_STORE_LISTING.md",
  "PRIVACY_POLICY.md",
  "SUPPORT.md",
  "ACCESSIBILITY.md",
  "THIRD_PARTY_NOTICES.json",
  "THIRD_PARTY_NOTICES.md",
  "RELEASE_BLOCKERS.json",
  "RELEASE_BLOCKERS.md",
  "RELEASE_EVIDENCE.json",
  "RELEASE_EVIDENCE.md",
  "RELEASE_MANIFEST.json",
  "RELEASE_MANIFEST.md",
  "site.env.example",
  "public-site/PUBLIC_SITE_ARCHIVE.json",
  "public-site/cody-cartridge-public-site.zip",
  "screenshots/STORE_SCREENSHOTS.json",
  "screenshots/01-library-1440x900.png",
  "screenshots/02-takeout-map-1440x900.png",
  "screenshots/03-missing-files-1440x900.png"
];
const forbiddenEntryPatterns = [
  /^dist\//,
  /^node_modules\//,
  /^app-store-assets\/site\.env$/,
  /^app-store-assets\/upload-logs\/raw\//,
  /(?:^|\/)upload-logs\/raw\//,
  /(?:^|\/)site\.env$/,
  /(?:^|\/)[^/]+\.(?:p8|p12|cer|mobileprovision|provisionprofile)$/i,
  /(?:^|\/)music\//i,
  /(?:^|\/)Takeout\//i
];
const requiredExclusions = [
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
];
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

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const crcTable = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557);

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("ZIP end-of-central-directory record not found");
}

function parseZip(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;

  if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
    throw new Error("ZIP central directory extends past archive length");
  }

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`ZIP central directory entry ${index} has an invalid signature`);
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`ZIP local header for ${name} has an invalid signature`);
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    const data = buffer.subarray(dataStart, dataEnd);

    entries.push({
      compressedSize,
      crc,
      data,
      flags,
      method,
      name,
      uncompressedSize
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function sourceDataForManifestEntry(entry) {
  if (entry.sourcePath === "generated" && entry.name === "README.txt") {
    const zipEntry = entry.zipEntry;
    return zipEntry?.data ?? null;
  }

  const sourcePath = path.join(projectRoot, entry.sourcePath ?? "");

  if (!entry.sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return null;
  }

  return fs.readFileSync(sourcePath);
}

function checkArchive() {
  if (!fs.existsSync(archivePath)) {
    fail("Submission handoff archive is missing; run npm run handoff:store");
    return [];
  }

  const archive = fs.readFileSync(archivePath);

  if (archive.length > 10000) {
    pass("Submission handoff archive has plausible size");
  } else {
    fail("Submission handoff archive is suspiciously small");
  }

  let entries = [];

  try {
    entries = parseZip(archive);
    pass("Submission handoff archive central directory parses");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return [];
  }

  const names = entries.map((entry) => entry.name).sort();

  if (JSON.stringify(names) === JSON.stringify([...requiredEntries].sort())) {
    pass("Submission handoff archive contains exactly the required files");
  } else {
    fail(`Submission handoff archive file list mismatch: ${names.join(", ")}`);
  }

  entries.forEach((entry) => {
    if (entry.name.startsWith("/") || entry.name.includes("..") || entry.name.includes("\\")) {
      fail(`Submission handoff entry has unsafe path: ${entry.name}`);
    } else {
      pass(`Submission handoff entry path is safe: ${entry.name}`);
    }

    if (forbiddenEntryPatterns.some((pattern) => pattern.test(entry.name))) {
      fail(`Submission handoff archive includes forbidden local/private path: ${entry.name}`);
    }

    if (entry.method === 0) {
      pass(`${entry.name} uses deterministic stored ZIP method`);
    } else {
      fail(`${entry.name} uses unsupported compression method ${entry.method}`);
    }

    if (entry.flags === 0x0800) {
      pass(`${entry.name} is marked UTF-8`);
    } else {
      fail(`${entry.name} has unexpected ZIP flags ${entry.flags}`);
    }

    if (entry.compressedSize === entry.uncompressedSize && entry.uncompressedSize === entry.data.length) {
      pass(`${entry.name} ZIP size metadata matches file data`);
    } else {
      fail(`${entry.name} ZIP size metadata is inconsistent`);
    }

    if (crc32(entry.data) === entry.crc) {
      pass(`${entry.name} CRC matches file data`);
    } else {
      fail(`${entry.name} CRC does not match file data`);
    }
  });

  return entries;
}

function checkManifest(entries) {
  if (!fs.existsSync(manifestPath)) {
    fail("Submission handoff manifest is missing");
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const releaseManifestPath = path.join(projectRoot, "app-store-assets", "RELEASE_MANIFEST.json");
  const releaseManifest = fs.existsSync(releaseManifestPath)
    ? JSON.parse(fs.readFileSync(releaseManifestPath, "utf8"))
    : {};
  const releaseMasSubmission = releaseManifest.masSubmission ?? {};
  const archive = fs.existsSync(archivePath) ? fs.readFileSync(archivePath) : null;

  if (manifest.archivePath === "app-store-assets/submission-handoff/cody-cartridge-app-store-handoff.zip") {
    pass("Submission handoff manifest records archive path");
  } else {
    fail("Submission handoff manifest has unexpected archive path");
  }

  if (archive && manifest.archiveSha256 === sha256(archive)) {
    pass("Submission handoff manifest hash matches archive");
  } else {
    fail("Submission handoff manifest hash does not match archive");
  }

  if (archive && manifest.archiveSizeBytes === archive.length) {
    pass("Submission handoff manifest size matches archive");
  } else {
    fail("Submission handoff manifest size does not match archive");
  }

  const zipEntries = new Map(entries.map((entry) => [entry.name, entry]));
  const manifestEntries = new Map((manifest.entries ?? []).map((entry) => [entry.name, entry]));
  const readmeEntry = zipEntries.get("README.txt");

  requiredEntries.forEach((entryName) => {
    const manifestEntry = manifestEntries.get(entryName);
    const zipEntry = zipEntries.get(entryName);

    if (!manifestEntry || !zipEntry) {
      fail(`Submission handoff manifest/archive is missing ${entryName}`);
      return;
    }

    const sourceData = sourceDataForManifestEntry({ ...manifestEntry, zipEntry });

    if (!sourceData) {
      fail(`Submission handoff cannot read source for ${entryName}`);
      return;
    }

    if (manifestEntry.sha256 === sha256(zipEntry.data) && manifestEntry.sha256 === sha256(sourceData)) {
      pass(`${entryName} manifest, archive, and source hashes match`);
    } else {
      fail(`${entryName} hash mismatch between manifest, archive, and source`);
    }

    if (manifestEntry.sizeBytes === zipEntry.data.length && manifestEntry.sizeBytes === sourceData.length) {
      pass(`${entryName} size matches manifest, archive, and source`);
    } else {
      fail(`${entryName} size mismatch between manifest, archive, and source`);
    }
  });

  if (requiredExclusions.every((item) => manifest.exclusions?.includes(item))) {
    pass("Submission handoff manifest records local/private exclusions");
  } else {
    fail("Submission handoff manifest does not record local/private exclusions");
  }

  if (manifest.masSubmission?.bundlePath === "dist/mas-arm64/Cody Cartridge.app") {
    pass("Submission handoff manifest records MAS bundle path");
  } else {
    fail("Submission handoff manifest does not record MAS bundle path");
  }

  if (manifest.masSubmission?.mode === releaseMasSubmission.mode) {
    pass("Submission handoff MAS posture matches release manifest mode");
  } else {
    fail("Submission handoff MAS posture does not match release manifest mode");
  }

  if (manifest.masSubmission?.submissionReady === (releaseMasSubmission.submissionReady === true)) {
    pass("Submission handoff MAS submission readiness matches release manifest");
  } else {
    fail("Submission handoff MAS submission readiness does not match release manifest");
  }

  if (manifest.masSubmission?.localRehearsalOnly === (releaseMasSubmission.localRehearsalOnly === true)) {
    pass("Submission handoff MAS local rehearsal flag matches release manifest");
  } else {
    fail("Submission handoff MAS local rehearsal flag does not match release manifest");
  }

  if (manifest.masSubmission?.hasEmbeddedProvisioningProfile === (releaseMasSubmission.hasEmbeddedProvisioningProfile === true)) {
    pass("Submission handoff MAS provisioning posture matches release manifest");
  } else {
    fail("Submission handoff MAS provisioning posture does not match release manifest");
  }

  if (manifest.masSubmission?.codeSignatureVerified === (releaseMasSubmission.codeSignatureVerified === true)) {
    pass("Submission handoff MAS code-signature posture matches release manifest");
  } else {
    fail("Submission handoff MAS code-signature posture does not match release manifest");
  }

  if (
    manifest.masSubmission?.uploadPackageCount === Number(releaseMasSubmission.uploadPackageCount ?? 0) &&
    manifest.masSubmission?.signedUploadPackageCount === Number(releaseMasSubmission.signedUploadPackageCount ?? 0) &&
    manifest.masSubmission?.currentVersionUploadPackageCount === Number(releaseMasSubmission.currentVersionUploadPackageCount ?? 0) &&
    manifest.masSubmission?.signedCurrentVersionUploadPackageCount ===
      Number(releaseMasSubmission.signedCurrentVersionUploadPackageCount ?? 0)
  ) {
    pass("Submission handoff MAS upload package posture matches release manifest");
  } else {
    fail("Submission handoff MAS upload package posture does not match release manifest");
  }

  const readmeText = readmeEntry?.data?.toString("utf8") ?? "";
  if (
    readmeText.includes("MAS submission posture:") &&
    readmeText.includes(`Mode: ${manifest.masSubmission?.mode}`) &&
    readmeText.includes(`Submission ready: ${manifest.masSubmission?.submissionReady ? "yes" : "no"}`)
  ) {
    pass("Submission handoff README summarizes MAS submission posture");
  } else {
    fail("Submission handoff README does not summarize MAS submission posture");
  }

  if (readmeText.includes("RELEASE_MACHINE_REPORT.md") && readmeText.includes("redacted gate snapshot")) {
    pass("Submission handoff README points to release machine report");
  } else {
    fail("Submission handoff README does not point to release machine report");
  }

  if (manifest.masSubmission?.submissionReady !== true) {
    if (
      ["missing", "local-rehearsal-only"].includes(manifest.masSubmission?.mode) &&
      readmeText.includes(`Mode: ${manifest.masSubmission?.mode}`) &&
      readmeText.includes("Embedded provisioning profile: missing") &&
      readmeText.includes("Readiness note: not submission-ready until the release machine produces a signed MAS app")
    ) {
      pass("Submission handoff README calls out non-ready MAS submission state");
    } else {
      fail("Submission handoff README does not call out non-ready MAS submission state");
    }
  }

  if (manifest.blockers?.blockerCount > 0 || manifest.placeholders?.supportUrl || manifest.placeholders?.supportEmail) {
    warn("Submission handoff archive records remaining release blockers or placeholder public contact values");
  } else {
    pass("Submission handoff archive records no release blockers or placeholder public contact values");
  }
}

function main() {
  const entries = checkArchive();
  checkManifest(entries);

  console.log(`Submission handoff checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
