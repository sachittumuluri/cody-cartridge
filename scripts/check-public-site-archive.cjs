#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isHttpsOrigin, loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
loadStoreEnv(projectRoot);

const strict = process.argv.includes("--strict");
const archivePath = path.join(projectRoot, "app-store-assets", "public-site", "cody-cartridge-public-site.zip");
const manifestPath = path.join(projectRoot, "app-store-assets", "public-site", "PUBLIC_SITE_ARCHIVE.json");
const siteDir = path.join(projectRoot, "app-store-assets", "site");
const requiredFiles = [
  "index.html",
  "privacy.html",
  "support.html",
  "accessibility.html",
  "third-party-notices.html",
  "robots.txt",
  "sitemap.xml",
  "README.txt",
  "_headers",
  "vercel.json"
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
    fail(message);
  } else {
    warnings.push(message);
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
}

function isPlaceholder(value) {
  return /TODO_|TODO:|=placeholder|you@example\.com|https:\/\/example\.com/i.test(String(value ?? ""));
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

function checkArchive() {
  if (!fs.existsSync(archivePath)) {
    fail("Public site archive is missing; run npm run site:archive, then npm run check:site-archive");
    return [];
  }

  const archive = fs.readFileSync(archivePath);

  if (archive.length > 1000) {
    pass("Public site archive has plausible size");
  } else {
    fail("Public site archive is suspiciously small");
  }

  const entries = parseZip(archive);
  const names = entries.map((entry) => entry.name).sort();
  const expectedNames = [...requiredFiles].sort();

  if (JSON.stringify(names) === JSON.stringify(expectedNames)) {
    pass("Public site archive contains exactly the required files");
  } else {
    fail(`Public site archive file list mismatch: ${names.join(", ")}`);
  }

  entries.forEach((entry) => {
    if (entry.name.startsWith("/") || entry.name.includes("..") || entry.name.includes("\\")) {
      fail(`Public site archive entry has unsafe path: ${entry.name}`);
    } else {
      pass(`Public site archive entry path is safe: ${entry.name}`);
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
    fail("Public site archive manifest is missing");
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const archive = fs.existsSync(archivePath) ? fs.readFileSync(archivePath) : null;

  if (manifest.archivePath === "app-store-assets/public-site/cody-cartridge-public-site.zip") {
    pass("Public site archive manifest records archive path");
  } else {
    fail("Public site archive manifest has unexpected archive path");
  }

  if (archive && manifest.archiveSha256 === sha256(archive)) {
    pass("Public site archive manifest hash matches archive");
  } else {
    fail("Public site archive manifest hash does not match archive");
  }

  if (archive && manifest.archiveSizeBytes === archive.length) {
    pass("Public site archive manifest size matches archive");
  } else {
    fail("Public site archive manifest size does not match archive");
  }

  const manifestEntries = new Map((manifest.entries ?? []).map((entry) => [entry.name, entry]));
  const zipEntries = new Map(entries.map((entry) => [entry.name, entry]));

  requiredFiles.forEach((fileName) => {
    const sitePath = path.join(siteDir, fileName);
    const manifestEntry = manifestEntries.get(fileName);
    const zipEntry = zipEntries.get(fileName);

    if (!manifestEntry) {
      fail(`Public site archive manifest is missing ${fileName}`);
      return;
    }

    if (!zipEntry || !fs.existsSync(sitePath)) {
      fail(`Cannot compare ${fileName} across archive and generated site`);
      return;
    }

    const siteData = fs.readFileSync(sitePath);

    if (sha256(siteData) === manifestEntry.sha256 && manifestEntry.sha256 === sha256(zipEntry.data)) {
      pass(`${fileName} manifest, archive, and generated site hashes match`);
    } else {
      fail(`${fileName} hash mismatch between manifest, archive, and generated site`);
    }

    if (manifestEntry.sizeBytes === siteData.length && zipEntry.data.length === siteData.length) {
      pass(`${fileName} size matches generated site file`);
    } else {
      fail(`${fileName} size mismatch between manifest, archive, and generated site`);
    }

    if (fileName.endsWith(".html") && /<script[\s>]/i.test(siteData.toString("utf8"))) {
      fail(`${fileName} includes script tags`);
    }
  });

  if (isEmail(manifest.supportEmail) && !isPlaceholder(manifest.supportEmail)) {
    pass("Public site archive support email is publish-ready");
  } else {
    warn("Public site archive support email is missing, placeholder, or invalid");
  }

  if (isHttpsOrigin(manifest.siteUrl) && !isPlaceholder(manifest.siteUrl)) {
    pass("Public site archive site URL origin is publish-ready");
  } else {
    warn("Public site archive site URL origin is missing, placeholder, or invalid");
  }

  const placeholderFiles = manifest.placeholders?.files ?? [];

  if (placeholderFiles.length === 0 && !manifest.placeholders?.supportEmail && !manifest.placeholders?.siteUrl) {
    pass("Public site archive has no placeholder publish values");
  } else {
    warn(`Public site archive still has placeholder publish values${placeholderFiles.length ? ` in ${placeholderFiles.join(", ")}` : ""}`);
  }
}

function main() {
  let entries = [];

  try {
    entries = checkArchive();
    checkManifest(entries);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  console.log(`Public site archive checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));
  warnings.forEach((message) => console.warn(`WARN ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
