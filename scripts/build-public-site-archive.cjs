#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getReleaseStoreEnvValue, loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
loadStoreEnv(projectRoot);

const siteDir = path.join(projectRoot, "app-store-assets", "site");
const outputDir = path.join(projectRoot, "app-store-assets", "public-site");
const archivePath = path.join(outputDir, "cody-cartridge-public-site.zip");
const manifestPath = path.join(outputDir, "PUBLIC_SITE_ARCHIVE.json");
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

const supportEmail = getReleaseStoreEnvValue("CODY_SUPPORT_EMAIL", "TODO_SUPPORT_EMAIL");
const siteUrl = getReleaseStoreEnvValue("CODY_SITE_URL", "TODO_PUBLIC_SITE_URL").replace(/\/$/, "");
const fixedDosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
const fixedDosTime = 0;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com/i.test(String(value ?? ""));
}

function displayValue(label, value) {
  return isPlaceholder(value) ? `${label}=placeholder` : String(value ?? "");
}

function displaySiteUrl(label, suffix) {
  return isPlaceholder(siteUrl) ? `${label}=placeholder` : `${siteUrl}/${suffix}`;
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

  for (const entry of inputEntries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");

    entries.push({
      ...entry,
      crc: crc32(entry.data),
      localOffset,
      nameBuffer
    });

    localOffset += 30 + nameBuffer.length + entry.data.length;
  }

  for (const entry of entries) {
    const header = localHeader(entry);
    fileParts.push(header, entry.data);
  }

  let centralSize = 0;

  for (const entry of entries) {
    const header = centralDirectoryHeader(entry);
    centralParts.push(header);
    centralSize += header.length;
  }

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

function readSiteEntries() {
  return requiredFiles.map((fileName) => {
    const sourcePath = path.join(siteDir, fileName);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing generated site file: app-store-assets/site/${fileName}`);
    }

    const data = fs.readFileSync(sourcePath);

    return {
      name: fileName,
      data,
      sha256: sha256(data),
      sizeBytes: data.length,
      sourcePath: `app-store-assets/site/${fileName}`
    };
  });
}

function main() {
  const entries = readSiteEntries();
  const archive = buildZip(entries.map(({ name, data }) => ({ name, data })));

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(archivePath, archive);

  const manifest = {
    generatedAt: new Date().toISOString(),
    archivePath: "app-store-assets/public-site/cody-cartridge-public-site.zip",
    archiveSha256: sha256(archive),
    archiveSizeBytes: archive.length,
    supportEmail: displayValue("supportEmail", supportEmail),
    siteUrl: displayValue("siteUrl", siteUrl),
    appStoreUrls: {
      supportUrl: displaySiteUrl("supportUrl", "support.html"),
      privacyPolicyUrl: displaySiteUrl("privacyPolicyUrl", "privacy.html"),
      accessibilityUrl: displaySiteUrl("accessibilityUrl", "accessibility.html"),
      thirdPartyNoticesUrl: displaySiteUrl("thirdPartyNoticesUrl", "third-party-notices.html")
    },
    entries: entries.map(({ data, ...entry }) => entry),
    placeholders: {
      supportEmail: isPlaceholder(supportEmail),
      siteUrl: isPlaceholder(siteUrl),
      files: entries
        .filter((entry) => isPlaceholder(entry.data.toString("utf8")))
        .map((entry) => entry.name)
    }
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Built ${path.relative(projectRoot, archivePath)}`);
  console.log(`Built ${path.relative(projectRoot, manifestPath)}`);

  if (manifest.placeholders.supportEmail) {
    console.warn("Public site archive contains placeholder support email.");
  }

  if (manifest.placeholders.siteUrl) {
    console.warn("Public site archive contains placeholder site URL.");
  }
}

main();
