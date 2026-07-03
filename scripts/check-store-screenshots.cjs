#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const projectRoot = path.resolve(__dirname, "..");
const manifestPath = "app-store-assets/screenshots/STORE_SCREENSHOTS.json";
const appStoreConnectSpec = {
  acceptedFormats: ["jpeg", "jpg", "png"],
  acceptedSizes: [
    { height: 800, width: 1280 },
    { height: 900, width: 1440 },
    { height: 1600, width: 2560 },
    { height: 1800, width: 2880 }
  ],
  aspectRatio: "16:10",
  count: { max: 10, min: 1 },
  platform: "macOS",
  requiredFor: "Mac apps",
  sourceUrl: "https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/"
};
const screenshots = [
  "app-store-assets/screenshots/01-library-1440x900.png",
  "app-store-assets/screenshots/02-takeout-map-1440x900.png",
  "app-store-assets/screenshots/03-missing-files-1440x900.png"
];
const expectedManifestEntries = [
  {
    filePath: "app-store-assets/screenshots/01-library-1440x900.png",
    id: "library",
    query: { "store-demo": "1", "store-shelf": "library", "store-poster": "1" }
  },
  {
    filePath: "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    id: "takeout",
    query: { "store-demo": "1", "store-shelf": "takeout", "store-poster": "1" }
  },
  {
    filePath: "app-store-assets/screenshots/03-missing-files-1440x900.png",
    id: "missing",
    query: { "store-demo": "1", "store-shelf": "missing", "store-poster": "1" }
  }
];
const passes = [];
const failures = [];
const acceptedSizeKeys = new Set(appStoreConnectSpec.acceptedSizes.map((size) => `${size.width}x${size.height}`));

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function parsePng(buffer) {
  const signature = "89504e470d0a1a0a";

  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Invalid PNG signature");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth}; expected 8`);
  }

  if (interlace !== 0) {
    throw new Error("Interlaced PNG screenshots are not supported by this checker");
  }

  const channelsByColorType = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4]
  ]);
  const channels = channelsByColorType.get(colorType);

  if (!channels) {
    throw new Error(`Unsupported PNG color type ${colorType}`);
  }

  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  let previousRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rawRow = inflated.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    const row = Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previousRow[x] ?? 0;
      const upLeft = x >= channels ? previousRow[x - channels] : 0;
      let predictor = 0;

      if (filter === 0) {
        predictor = 0;
      } else if (filter === 1) {
        predictor = left;
      } else if (filter === 2) {
        predictor = up;
      } else if (filter === 3) {
        predictor = Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }

      row[x] = (rawRow[x] + predictor) & 0xff;
    }

    row.copy(pixels, y * stride);
    previousRow = row;
  }

  return { channels, colorType, height, pixels, stride, width };
}

function pixelRgb(png, pixelIndex) {
  const offset = pixelIndex * png.channels;

  if (png.colorType === 0) {
    const value = png.pixels[offset];
    return [value, value, value];
  }

  if (png.colorType === 4) {
    const value = png.pixels[offset];
    return [value, value, value];
  }

  return [png.pixels[offset], png.pixels[offset + 1], png.pixels[offset + 2]];
}

function analyzeScreenshot(buffer) {
  const png = parsePng(buffer);
  const pixelCount = png.width * png.height;
  const sampleStep = Math.max(1, Math.floor(pixelCount / 25000));
  const buckets = new Set();
  let samples = 0;
  let minLuma = 255;
  let maxLuma = 0;
  let sumLuma = 0;
  let sumLumaSquared = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += sampleStep) {
    const [red, green, blue] = pixelRgb(png, pixelIndex);
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const bucket = `${red >> 4}:${green >> 4}:${blue >> 4}`;

    buckets.add(bucket);
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
    sumLuma += luma;
    sumLumaSquared += luma * luma;
    samples += 1;
  }

  const meanLuma = sumLuma / samples;
  const variance = Math.max(0, sumLumaSquared / samples - meanLuma * meanLuma);

  return {
    ...png,
    lumaRange: maxLuma - minLuma,
    sampleCount: samples,
    stdevLuma: Math.sqrt(variance),
    uniqueColorBuckets: buckets.size
  };
}

function isAcceptedMacScreenshotSize(width, height) {
  return acceptedSizeKeys.has(`${width}x${height}`);
}

function checkScreenshot(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    fail(`${relativePath} is missing`);
    return null;
  }

  const buffer = fs.readFileSync(absolutePath);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const stats = fs.statSync(absolutePath);

  let analysis;

  try {
    analysis = analyzeScreenshot(buffer);
  } catch (error) {
    fail(`${relativePath} is not a readable 8-bit non-interlaced PNG: ${error.message}`);
    return { relativePath, sha256 };
  }

  if (analysis.width === 1440 && analysis.height === 900) {
    pass(`${relativePath} is 1440x900`);
  } else {
    fail(`${relativePath} is ${analysis.width}x${analysis.height}; expected 1440x900`);
  }

  if (isAcceptedMacScreenshotSize(analysis.width, analysis.height)) {
    pass(`${relativePath} matches an accepted Mac App Store screenshot size`);
  } else {
    fail(`${relativePath} is ${analysis.width}x${analysis.height}; expected one of ${[...acceptedSizeKeys].join(", ")}`);
  }

  if (stats.size >= 150000) {
    pass(`${relativePath} has plausible file size`);
  } else {
    fail(`${relativePath} is suspiciously small (${stats.size} bytes)`);
  }

  if (analysis.uniqueColorBuckets >= 80) {
    pass(`${relativePath} has varied color buckets (${analysis.uniqueColorBuckets})`);
  } else {
    fail(`${relativePath} has too little color variation (${analysis.uniqueColorBuckets} buckets)`);
  }

  if (analysis.lumaRange >= 75) {
    pass(`${relativePath} has sufficient luminance range (${analysis.lumaRange.toFixed(1)})`);
  } else {
    fail(`${relativePath} looks visually flat (${analysis.lumaRange.toFixed(1)} luminance range)`);
  }

  if (analysis.stdevLuma >= 12) {
    pass(`${relativePath} has sufficient luminance contrast (${analysis.stdevLuma.toFixed(1)} stdev)`);
  } else {
    fail(`${relativePath} has weak luminance contrast (${analysis.stdevLuma.toFixed(1)} stdev)`);
  }

  return {
    relativePath,
    sha256,
    ...analysis
  };
}

function readScreenshotManifest() {
  const absolutePath = path.join(projectRoot, manifestPath);

  if (!fs.existsSync(absolutePath)) {
    fail(`${manifestPath} is missing`);
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`${manifestPath} is not valid JSON: ${error.message}`);
    return null;
  }
}

function checkManifest(analyses) {
  const manifest = readScreenshotManifest();

  if (!manifest) {
    return;
  }

  const analysisByPath = new Map(analyses.map((analysis) => [analysis.relativePath, analysis]));
  const entries = Array.isArray(manifest.screenshots) ? manifest.screenshots : [];
  const ids = new Set(entries.map((entry) => entry.id));
  const paths = new Set(entries.map((entry) => entry.filePath));
  const manifestSpec = manifest.appStoreConnectSpec ?? {};

  if (manifest.source === "store-demo") {
    pass("Screenshot manifest records store-demo source");
  } else {
    fail("Screenshot manifest does not record store-demo source");
  }

  if (manifest.renderer === "dist/index.html") {
    pass("Screenshot manifest records production renderer source");
  } else {
    fail("Screenshot manifest renderer is not dist/index.html");
  }

  if (manifest.viewport?.width === 1440 && manifest.viewport?.height === 900) {
    pass("Screenshot manifest records 1440x900 viewport");
  } else {
    fail(`Screenshot manifest viewport is ${JSON.stringify(manifest.viewport)}; expected 1440x900`);
  }

  if (manifestSpec.platform === appStoreConnectSpec.platform && manifestSpec.requiredFor === appStoreConnectSpec.requiredFor) {
    pass("Screenshot manifest records Mac App Store platform requirement");
  } else {
    fail("Screenshot manifest does not record Mac App Store platform requirement");
  }

  if (manifestSpec.sourceUrl === appStoreConnectSpec.sourceUrl) {
    pass("Screenshot manifest records Apple screenshot specification source URL");
  } else {
    fail("Screenshot manifest does not record Apple screenshot specification source URL");
  }

  if (manifestSpec.aspectRatio === appStoreConnectSpec.aspectRatio) {
    pass("Screenshot manifest records 16:10 aspect ratio");
  } else {
    fail(`Screenshot manifest aspect ratio is ${manifestSpec.aspectRatio ?? "missing"}; expected 16:10`);
  }

  if (manifestSpec.count?.min === 1 && manifestSpec.count?.max === 10) {
    pass("Screenshot manifest records App Store screenshot count range");
  } else {
    fail(`Screenshot manifest count range is ${JSON.stringify(manifestSpec.count)}; expected 1-10`);
  }

  const manifestAcceptedSizeKeys = new Set((manifestSpec.acceptedSizes ?? []).map((size) => `${size.width}x${size.height}`));
  if ([...acceptedSizeKeys].every((size) => manifestAcceptedSizeKeys.has(size)) && manifestAcceptedSizeKeys.size === acceptedSizeKeys.size) {
    pass("Screenshot manifest records every accepted Mac screenshot size");
  } else {
    fail(`Screenshot manifest accepted sizes are ${[...manifestAcceptedSizeKeys].join(", ")}; expected ${[...acceptedSizeKeys].join(", ")}`);
  }

  if ((manifestSpec.acceptedFormats ?? []).includes("png")) {
    pass("Screenshot manifest records PNG as an accepted App Store format");
  } else {
    fail("Screenshot manifest does not record PNG as an accepted App Store format");
  }

  if (manifest.screenshotCount === expectedManifestEntries.length && entries.length === expectedManifestEntries.length) {
    pass("Screenshot manifest records all expected screenshots");
  } else {
    fail(`Screenshot manifest records ${entries.length}/${manifest.screenshotCount ?? "unknown"} screenshots; expected ${expectedManifestEntries.length}`);
  }

  if (manifest.screenshotCount >= appStoreConnectSpec.count.min && manifest.screenshotCount <= appStoreConnectSpec.count.max) {
    pass("Screenshot manifest count is within App Store Connect range");
  } else {
    fail(`Screenshot manifest count is ${manifest.screenshotCount}; expected ${appStoreConnectSpec.count.min}-${appStoreConnectSpec.count.max}`);
  }

  if (ids.size === entries.length) {
    pass("Screenshot manifest ids are unique");
  } else {
    fail("Screenshot manifest contains duplicate ids");
  }

  if (paths.size === entries.length) {
    pass("Screenshot manifest file paths are unique");
  } else {
    fail("Screenshot manifest contains duplicate file paths");
  }

  expectedManifestEntries.forEach((expected) => {
    const entry = entries.find((candidate) => candidate.filePath === expected.filePath);
    const analysis = analysisByPath.get(expected.filePath);

    if (!entry) {
      fail(`Screenshot manifest is missing ${expected.filePath}`);
      return;
    }

    if (entry.id === expected.id) {
      pass(`Screenshot manifest maps ${expected.filePath} to ${expected.id}`);
    } else {
      fail(`Screenshot manifest maps ${expected.filePath} to ${entry.id}; expected ${expected.id}`);
    }

    if (JSON.stringify(entry.query) === JSON.stringify(expected.query)) {
      pass(`Screenshot manifest records query for ${expected.id}`);
    } else {
      fail(`Screenshot manifest query for ${expected.id} is ${JSON.stringify(entry.query)}; expected ${JSON.stringify(expected.query)}`);
    }

    if (entry.sourceUrl === `dist/index.html?${new URLSearchParams(expected.query).toString()}`) {
      pass(`Screenshot manifest records source URL for ${expected.id}`);
    } else {
      fail(`Screenshot manifest source URL for ${expected.id} is ${entry.sourceUrl}`);
    }

    if (entry.width === 1440 && entry.height === 900) {
      pass(`Screenshot manifest records dimensions for ${expected.id}`);
    } else {
      fail(`Screenshot manifest dimensions for ${expected.id} are ${entry.width}x${entry.height}; expected 1440x900`);
    }

    if (entry.format === "png") {
      pass(`Screenshot manifest records PNG format for ${expected.id}`);
    } else {
      fail(`Screenshot manifest format for ${expected.id} is ${entry.format ?? "missing"}; expected png`);
    }

    if (entry.appStoreConnectAccepted === true && isAcceptedMacScreenshotSize(entry.width, entry.height)) {
      pass(`Screenshot manifest marks ${expected.id} as App Store Connect accepted`);
    } else {
      fail(`Screenshot manifest does not mark ${expected.id} as App Store Connect accepted`);
    }

    if (!analysis) {
      return;
    }

    const actualBytes = fs.statSync(path.join(projectRoot, expected.filePath)).size;

    if (entry.bytes === actualBytes) {
      pass(`Screenshot manifest byte size matches ${expected.id}`);
    } else {
      fail(`Screenshot manifest byte size for ${expected.id} is ${entry.bytes}; actual ${actualBytes}`);
    }

    if (entry.sha256 === analysis.sha256) {
      pass(`Screenshot manifest hash matches ${expected.id}`);
    } else {
      fail(`Screenshot manifest hash for ${expected.id} is ${entry.sha256}; actual ${analysis.sha256}`);
    }
  });
}

function main() {
  const analyses = screenshots.map(checkScreenshot).filter(Boolean);
  const seenHashes = new Map();

  analyses.forEach((analysis) => {
    if (seenHashes.has(analysis.sha256)) {
      fail(`${analysis.relativePath} duplicates ${seenHashes.get(analysis.sha256)}`);
      return;
    }

    seenHashes.set(analysis.sha256, analysis.relativePath);
  });

  if (seenHashes.size === analyses.length) {
    pass("All store screenshots are distinct files");
  }

  checkManifest(analyses);

  console.log(`Store screenshot checks: ${passes.length} passed, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
