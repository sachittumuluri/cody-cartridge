#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const desktopMusicPath = path.resolve(projectRoot, "..", "music");
const passes = [];
const failures = [];

const scannedRoots = [
  "APP_STORE_READINESS.md",
  "app-store-assets",
  "build",
  "dist",
  "electron",
  "package.json",
  "scripts",
  "src"
];

const skippedDirectories = new Set(["node_modules", ".git"]);
const privateEnvFiles = new Set(["app-store-assets/site.env", "app-store-assets/site.env.local"]);
const privateArtifactDirectories = new Set(["app-store-assets/upload-logs/raw/"]);
const ignoredSecretPatterns = ["*.p8", "*.p12", "*.cer", "*.mobileprovision", "*.provisionprofile"];
const skippedFiles = new Set([
  "scripts/check-artifact-privacy.cjs",
  "app-store-assets/public-site/cody-cartridge-public-site.zip",
  ...privateEnvFiles
]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".plist",
  ".txt",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml"
]);
const binaryExtensions = new Set([".asar", ".icns", ".ico", ".jpg", ".jpeg", ".png", ".webp", ".zip"]);
const ignoredLocalTrackNames = new Set([]);

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function rel(filePath) {
  return path.relative(projectRoot, filePath);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTextFile(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();

  if (binaryExtensions.has(extension)) {
    return false;
  }

  return textExtensions.has(extension) || path.basename(relativePath).includes(".env");
}

function walk(entryPath, files = []) {
  if (!fs.existsSync(entryPath)) {
    return files;
  }

  const stats = fs.statSync(entryPath);

  if (stats.isDirectory()) {
    if (skippedDirectories.has(path.basename(entryPath))) {
      return files;
    }

    const relativeDirectory = `${rel(entryPath).replaceAll("\\", "/")}/`;
    if (privateArtifactDirectories.has(relativeDirectory)) {
      return files;
    }

    fs.readdirSync(entryPath)
      .sort()
      .forEach((entry) => walk(path.join(entryPath, entry), files));
    return files;
  }

  const relativePath = rel(entryPath);

  if (stats.isFile() && !skippedFiles.has(relativePath) && isTextFile(relativePath)) {
    files.push(entryPath);
  }

  return files;
}

function collectScanFiles() {
  return scannedRoots.flatMap((root) => walk(path.join(projectRoot, root))).sort();
}

function collectLocalTrackNames() {
  if (!fs.existsSync(desktopMusicPath)) {
    return [];
  }

  return fs
    .readdirSync(desktopMusicPath)
    .filter((fileName) => /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff|aif)$/i.test(fileName))
    .map((fileName) => path.basename(fileName, path.extname(fileName)).replace(/\s+/g, " ").trim())
    .filter((trackName) => trackName.length >= 4 && !ignoredLocalTrackNames.has(trackName.toLowerCase()))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function findLineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function excerpt(text, index, length) {
  const start = Math.max(0, index - 36);
  const end = Math.min(text.length, index + length + 36);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function addRegexFindings(relativePath, text, pattern, label) {
  for (const match of text.matchAll(pattern)) {
    fail(`${relativePath}:${findLineNumber(text, match.index ?? 0)} contains ${label}: ${excerpt(text, match.index ?? 0, match[0].length)}`);
  }
}

function addTrackNameFindings(relativePath, text, trackNames) {
  trackNames.forEach((trackName) => {
    const phrase = escapeRegExp(trackName).replace(/\s+/g, "\\s+");
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${phrase})([^\\p{L}\\p{N}]|$)`, "giu");

    for (const match of text.matchAll(pattern)) {
      const matchIndex = (match.index ?? 0) + match[1].length;
      fail(`${relativePath}:${findLineNumber(text, matchIndex)} contains local music title "${trackName}": ${excerpt(text, matchIndex, trackName.length)}`);
    }
  });
}

function readJson(relativePath, fallback = null) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function checkPrivateEnvExclusions() {
  const gitignore = fs.existsSync(path.join(projectRoot, ".gitignore")) ? fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8") : "";
  const releaseManifest = readJson("app-store-assets/RELEASE_MANIFEST.json", { files: [] });
  const handoffManifest = readJson("app-store-assets/submission-handoff/SUBMISSION_HANDOFF.json", { entries: [], exclusions: [] });
  const manifestPaths = new Set((releaseManifest.files ?? []).map((item) => item.path));
  const handoffPaths = new Set((handoffManifest.entries ?? []).flatMap((item) => [item.name, item.sourcePath].filter(Boolean)));
  const gitignoreLines = gitignore.split(/\r?\n/);

  privateEnvFiles.forEach((relativePath) => {
    if (gitignoreLines.includes(relativePath)) {
      pass(`${relativePath} is ignored by git`);
    } else {
      fail(`${relativePath} is not listed in .gitignore`);
    }

    if (manifestPaths.has(relativePath)) {
      fail(`Release manifest includes private env file ${relativePath}`);
    } else {
      pass(`Release manifest excludes private env file ${relativePath}`);
    }

    if (handoffPaths.has(relativePath) || handoffPaths.has(path.basename(relativePath))) {
      fail(`Submission handoff includes private env file ${relativePath}`);
    } else {
      pass(`Submission handoff excludes private env file ${relativePath}`);
    }
  });

  privateArtifactDirectories.forEach((relativePath) => {
    if (gitignoreLines.includes(relativePath)) {
      pass(`${relativePath} is ignored by git`);
    } else {
      fail(`${relativePath} is not listed in .gitignore`);
    }

    if ([...manifestPaths].some((item) => item === relativePath || item.startsWith(relativePath))) {
      fail(`Release manifest includes private artifact directory ${relativePath}`);
    } else {
      pass(`Release manifest excludes private artifact directory ${relativePath}`);
    }

    if ([...handoffPaths].some((item) => item === relativePath || item.startsWith(relativePath))) {
      fail(`Submission handoff includes private artifact directory ${relativePath}`);
    } else {
      pass(`Submission handoff excludes private artifact directory ${relativePath}`);
    }
  });

  if (handoffManifest.exclusions?.includes("app-store-assets/site.env")) {
    pass("Submission handoff manifest records app-store-assets/site.env exclusion");
  } else {
    fail("Submission handoff manifest does not record app-store-assets/site.env exclusion");
  }

  if (
    handoffManifest.exclusions?.includes("app-store-assets/upload-logs/raw/") &&
    handoffManifest.exclusions?.includes("raw upload delivery logs")
  ) {
    pass("Submission handoff manifest records raw upload log exclusion");
  } else {
    fail("Submission handoff manifest does not record raw upload log exclusion");
  }

  ignoredSecretPatterns.forEach((pattern) => {
    if (gitignoreLines.includes(pattern)) {
      pass(`${pattern} release secret pattern is ignored by git`);
    } else {
      fail(`${pattern} release secret pattern is not listed in .gitignore`);
    }
  });

  [
    "Apple signing certificates/private keys",
    "macOS provisioning profiles",
    "App Store Connect API keys/credentials"
  ].forEach((exclusion) => {
    if (handoffManifest.exclusions?.includes(exclusion)) {
      pass(`Submission handoff manifest records ${exclusion} exclusion`);
    } else {
      fail(`Submission handoff manifest does not record ${exclusion} exclusion`);
    }
  });
}

function stripAllowedVerifierCoverageLiterals(relativePath, text) {
  if (relativePath !== "scripts/verify-store-readiness.cjs") {
    return text;
  }

  return text
    .split(/\r?\n/)
    .filter((line) => !line.includes("artifactPrivacy.includes("))
    .join("\n");
}

function checkFile(filePath, localTrackNames) {
  const relativePath = rel(filePath);
  const text = stripAllowedVerifierCoverageLiterals(relativePath, fs.readFileSync(filePath, "utf8"));

  addRegexFindings(relativePath, text, /\/Users\/(?!you(?:\/|["'`]|$))[^\s"'`)]+/g, "a real user-home path");
  addRegexFindings(relativePath, text, /\bDesktop[\\/](?:music|Takeout)\b/gi, "a developer Desktop music/Takeout path");
  addRegexFindings(relativePath, text, /\by2mate\b/gi, "a downloader-site reference");
  addRegexFindings(relativePath, text, /\/var\/folders\/[^\s"'`)]+/g, "a temporary macOS capture path");
  addTrackNameFindings(relativePath, text, localTrackNames);
}

function main() {
  const files = collectScanFiles();
  const localTrackNames = collectLocalTrackNames();

  checkPrivateEnvExclusions();
  files.forEach((filePath) => checkFile(filePath, localTrackNames));

  if (files.length > 0) {
    pass(`Scanned ${files.length} text artifact/source files`);
  }

  if (localTrackNames.length > 0) {
    pass(`Checked ${localTrackNames.length} local music filename(s) for accidental release leakage`);
  } else {
    pass("No local music filename fixtures were available to scan against");
  }

  if (failures.length === 0) {
    pass("No local filesystem paths, downloader references, or local music filenames leaked into release artifacts");
  }

  console.log(`Artifact privacy checks: ${passes.length} passed, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
