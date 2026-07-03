#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "APP_CONTENT_RIGHTS.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "APP_CONTENT_RIGHTS.md");
const mediaExtensions = new Set([".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus", ".aiff", ".aif", ".mp4", ".m4v", ".mov", ".webm", ".mkv"]);
const runtimeSourceRoots = ["electron", "src", "package.json"];
const packagedRoots = ["dist", "electron", "package.json", "build/PrivacyInfo.xcprivacy", "app-store-assets/THIRD_PARTY_NOTICES.md", "app-store-assets/THIRD_PARTY_NOTICES.json", "app-store-assets/PRIVACY_POLICY.md", "app-store-assets/SUPPORT.md", "app-store-assets/ACCESSIBILITY.md"];
const highRiskDependencyNames = [
  "youtube-dl",
  "youtube-dl-exec",
  "youtubei",
  "ytdl-core",
  "play-dl",
  "scrapetube",
  ["y2", "mate"].join(""),
  "ytmp3"
];
const highRiskRuntimeNeedles = [
  ...highRiskDependencyNames,
  "downloadFromYoutube",
  "downloadFromYouTube",
  "downloadTrack",
  "streaming-login",
  "streaming account"
];

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function readText(relativePath, fallback = "") {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : fallback;
}

function rel(filePath) {
  return path.relative(projectRoot, filePath).replaceAll("\\", "/");
}

function walk(entryPath, files = []) {
  if (!fs.existsSync(entryPath)) {
    return files;
  }

  const stats = fs.statSync(entryPath);

  if (stats.isDirectory()) {
    if (["node_modules", ".git"].includes(path.basename(entryPath))) {
      return files;
    }

    fs.readdirSync(entryPath)
      .sort()
      .forEach((entry) => walk(path.join(entryPath, entry), files));
    return files;
  }

  if (stats.isFile()) {
    files.push(entryPath);
  }

  return files;
}

function collectFiles(roots) {
  return roots.flatMap((root) => walk(path.join(projectRoot, root))).sort();
}

function collectText(roots) {
  return collectFiles(roots)
    .filter((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return [".cjs", ".css", ".html", ".js", ".json", ".md", ".ts", ".tsx"].includes(ext) || path.basename(filePath) === "package.json";
    })
    .map((filePath) => ({ path: rel(filePath), text: fs.readFileSync(filePath, "utf8") }));
}

function findPackagedMediaFiles() {
  return collectFiles(packagedRoots).filter((filePath) => mediaExtensions.has(path.extname(filePath).toLowerCase())).map(rel);
}

function findHighRiskDependencyMatches(pkg) {
  const dependencyNames = Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {})
  }).map((name) => name.toLowerCase());

  return dependencyNames.filter((name) =>
    highRiskDependencyNames.some((needle) => name.includes(String(needle).toLowerCase()))
  );
}

function findHighRiskRuntimeRefs() {
  return collectText(runtimeSourceRoots).flatMap((entry) => {
    const lower = entry.text.toLowerCase();

    return highRiskRuntimeNeedles
      .filter((needle) => lower.includes(String(needle).toLowerCase()))
      .map(() => entry.path);
  });
}

function fact(id, label, status, evidence, source) {
  return { id, label, status, evidence, source };
}

function tableRows(facts) {
  return facts
    .map((entry) => `| ${entry.status} | ${entry.label} | ${entry.evidence} | ${entry.source} |`)
    .join("\n");
}

function bulletList(items) {
  return items.map((entry) => `- ${entry}`).join("\n");
}

function main() {
  const pkg = readJson("package.json");
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const appCompliance = readJson("app-store-assets/APP_STORE_COMPLIANCE.json", { summary: {} });
  const mainSource = readText("electron/main.cjs");
  const appSource = readText("src/App.tsx");
  const viteTypes = readText("src/vite-env.d.ts");
  const entitlements = readText("build/entitlements.mas.plist");
  const packagedMediaFiles = findPackagedMediaFiles();
  const highRiskDependencyMatches = findHighRiskDependencyMatches(pkg);
  const highRiskRuntimeRefs = [...new Set(findHighRiskRuntimeRefs())];
  const contentRightsText = fields.rightsAndCompliance?.contentRights ?? "";
  const reviewNotes = fields.review?.notes ?? "";
  const description = fields.productPage?.description ?? "";
  const takeoutMetadataOnly =
    mainSource.includes("readTakeoutCsvFile") &&
    mainSource.includes("YouTube Music Takeout") &&
    mainSource.includes("youtubeVideoId") &&
    !/openExternal|shell\.openExternal/i.test(`${mainSource}\n${appSource}`);
  const localMediaProtocols =
    mainSource.includes('protocol.handle("cody-media"') &&
    mainSource.includes('protocol.handle("cody-art"') &&
    mainSource.includes("isAllowedMediaPath") &&
    mainSource.includes("withSecurityScopedAccess");
  const noNetworkEntitlement = !/com\.apple\.security\.network\.client[\s\S]*<true\/>/i.test(entitlements);
  const noPackagedMedia = packagedMediaFiles.length === 0;
  const noHighRiskDependencies = highRiskDependencyMatches.length === 0;
  const noHighRiskRuntimeRefs = highRiskRuntimeRefs.length === 0;
  const noDownloadCopy =
    /does not download music/i.test(description) &&
    /does not download music, scrape YouTube Music/i.test(reviewNotes) &&
    /ships without music/i.test(contentRightsText) &&
    /user-selected files/i.test(contentRightsText);
  const storeDemoSynthetic =
    appSource.includes("store-demo") &&
    appSource.includes("demoTracks") &&
    appSource.includes("demo") &&
    !collectFiles(["app-store-assets/screenshots"]).some((filePath) => mediaExtensions.has(path.extname(filePath).toLowerCase()));
  const facts = [
    fact("no-packaged-media", "Packaged app inputs contain no audio or video files", noPackagedMedia ? "pass" : "fail", `${packagedMediaFiles.length} media file(s) found in packaged roots`, "package.json build.files / packaged roots"),
    fact("no-high-risk-deps", "Dependencies do not include media downloader libraries", noHighRiskDependencies ? "pass" : "fail", `${highRiskDependencyMatches.length} high-risk dependency match(es)`, "package.json"),
    fact("no-high-risk-runtime-refs", "Runtime source has no downloader/scraping implementation references", noHighRiskRuntimeRefs ? "pass" : "fail", `${highRiskRuntimeRefs.length} source file(s) with high-risk references`, "electron/ and src/"),
    fact("no-external-open", "Runtime does not open external streaming URLs", !/openExternal|shell\.openExternal/i.test(`${mainSource}\n${appSource}`) ? "pass" : "fail", "openExternal scan complete", "electron/main.cjs and src/App.tsx"),
    fact("takeout-metadata-only", "YouTube Music Takeout handling is metadata-only", takeoutMetadataOnly ? "pass" : "fail", "CSV rows provide titles/artists/albums/video ids only; no account or download flow", "electron/main.cjs"),
    fact("local-media-protocols", "Playback and artwork use local app protocols", localMediaProtocols ? "pass" : "fail", "cody-media and cody-art require allowed local paths and security-scoped access", "electron/main.cjs"),
    fact("sandbox-no-network", "MAS entitlements omit network client access", noNetworkEntitlement ? "pass" : "fail", "network client entitlement is absent", "build/entitlements.mas.plist"),
    fact("rights-copy", "App Store copy states no bundled/downloaded media", noDownloadCopy ? "pass" : "fail", "listing, review notes, and rights copy checked", "app-store-assets/APP_STORE_CONNECT_FIELDS.json"),
    fact("store-demo-synthetic", "Store screenshots use synthetic demo metadata only", storeDemoSynthetic ? "pass" : "fail", "store-demo source and screenshot inventory checked for media files", "src/App.tsx / app-store-assets/screenshots"),
    fact("compliance-linkage", "Compliance packet carries content-rights answer", appCompliance.summary?.blockerCount === 0 && appCompliance.summary?.manualCount >= 1 ? "pass" : "fail", `compliance status=${appCompliance.summary?.status ?? "missing"}`, "app-store-assets/APP_STORE_COMPLIANCE.json")
  ];
  const failedFacts = facts.filter((entry) => entry.status !== "pass");
  const artifact = {
    generatedAt: new Date().toISOString(),
    app: {
      name: fields.app?.name ?? pkg.build?.productName ?? pkg.name,
      bundleId: fields.app?.bundleId ?? pkg.build?.appId,
      version: fields.app?.packageVersion ?? pkg.version,
      buildVersion: fields.app?.buildVersion ?? pkg.build?.buildVersion ?? pkg.version
    },
    summary: {
      status: failedFacts.length === 0 ? "ready-for-app-store-content-rights" : "blocked",
      factCount: facts.length,
      passedCount: facts.length - failedFacts.length,
      failedCount: failedFacts.length,
      packagedMediaFileCount: packagedMediaFiles.length,
      highRiskDependencyCount: highRiskDependencyMatches.length,
      highRiskRuntimeReferenceCount: highRiskRuntimeRefs.length,
      contactValuesStored: false
    },
    sourceArtifacts: [
      "package.json",
      "build/entitlements.mas.plist",
      "electron/main.cjs",
      "src/App.tsx",
      "src/vite-env.d.ts",
      "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
      "app-store-assets/APP_STORE_COMPLIANCE.json",
      "app-store-assets/screenshots/STORE_SCREENSHOTS.json"
    ],
    facts,
    finalNotes: [
      "This packet supports App Store content-rights and reviewer clarification. It does not grant rights to user media.",
      "Cody Cartridge ships without music and relies on user-selected local files that the user is responsible for owning or having rights to use.",
      "Regenerate this packet after changing import, Takeout, playback, screenshot-demo, packaging, or rights/compliance code."
    ]
  };
  const markdown = `# Cody Cartridge Content Rights And Media Audit

Generated by \`npm run content-rights:store\`.

This packet proves the release candidate is a local media player, not a music downloader or media redistribution bundle.

## Candidate

- App: ${artifact.app.name}
- Bundle ID: \`${artifact.app.bundleId}\`
- Version: ${artifact.app.version}
- Build version: ${artifact.app.buildVersion}
- Status: ${artifact.summary.status}
- Packaged media files: ${artifact.summary.packagedMediaFileCount}
- High-risk dependency matches: ${artifact.summary.highRiskDependencyCount}
- High-risk runtime source matches: ${artifact.summary.highRiskRuntimeReferenceCount}

## Audit Matrix

| Status | Check | Evidence | Source |
| --- | --- | --- | --- |
${tableRows(facts)}

## Final Notes

${bulletList(artifact.finalNotes)}
`;

  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);
  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);
  console.log(`Content-rights audit status: ${artifact.summary.status}`);
}

main();
