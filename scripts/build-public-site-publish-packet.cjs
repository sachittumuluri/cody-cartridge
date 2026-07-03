#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  isReleaseStoreEnvValue,
  isStoreEnvPlaceholder,
  loadStoreEnv
} = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const loadedFiles = loadStoreEnv(projectRoot);
const outputJson = path.join(projectRoot, "app-store-assets", "PUBLIC_SITE_PUBLISH_PACKET.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "PUBLIC_SITE_PUBLISH_PACKET.md");
const archivePath = "app-store-assets/public-site/cody-cartridge-public-site.zip";
const archiveManifestPath = "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json";
const requiredPages = [
  { id: "home", fileName: "index.html", label: "Marketing landing page", appStoreUse: "Marketing URL" },
  { id: "support", fileName: "support.html", label: "Support page", appStoreUse: "Support URL" },
  { id: "privacy", fileName: "privacy.html", label: "Privacy policy", appStoreUse: "Privacy Policy URL" },
  { id: "accessibility", fileName: "accessibility.html", label: "Accessibility statement", appStoreUse: "Accessibility URL" },
  {
    id: "third-party-notices",
    fileName: "third-party-notices.html",
    label: "Third-party notices",
    appStoreUse: "Support/legal reference"
  }
];
const requiredCompanionFiles = [
  { id: "robots", fileName: "robots.txt", label: "Robots policy", appStoreUse: "Public site crawler metadata" },
  { id: "sitemap", fileName: "sitemap.xml", label: "Sitemap", appStoreUse: "Public site crawler metadata" }
];
const requiredHostingConfigFiles = [
  {
    id: "headers",
    fileName: "_headers",
    label: "Static host headers",
    appStoreUse: "Static host content-type and cache policy"
  },
  {
    id: "vercel",
    fileName: "vercel.json",
    label: "Vercel deployment headers",
    appStoreUse: "Static host content-type and cache policy"
  }
];

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

function normalizeOrigin(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function publicOriginState() {
  const rawValue = process.env.CODY_SITE_URL ?? "";

  if (!rawValue) {
    return {
      status: "blocked",
      valueState: "missing",
      origin: null
    };
  }

  if (isStoreEnvPlaceholder(rawValue)) {
    return {
      status: "blocked",
      valueState: "placeholder",
      origin: null
    };
  }

  if (!isReleaseStoreEnvValue("CODY_SITE_URL", rawValue)) {
    return {
      status: "blocked",
      valueState: "invalid",
      origin: null
    };
  }

  return {
    status: "ready",
    valueState: "ready",
    origin: normalizeOrigin(rawValue)
  };
}

function supportEmailState() {
  const rawValue = process.env.CODY_SUPPORT_EMAIL ?? "";

  if (!rawValue) {
    return "missing";
  }

  if (isStoreEnvPlaceholder(rawValue)) {
    return "placeholder";
  }

  return isReleaseStoreEnvValue("CODY_SUPPORT_EMAIL", rawValue) ? "ready" : "invalid";
}

function expectedUrl(originState, fileName) {
  if (originState.status !== "ready") {
    return {
      status: "blocked",
      url: "pending-public-site-url"
    };
  }

  return {
    status: "ready",
    url: `${originState.origin}/${fileName}`
  };
}

function expectedContentType(fileName) {
  if (fileName.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (fileName === "robots.txt") {
    return "text/plain; charset=utf-8";
  }

  if (fileName === "sitemap.xml") {
    return "application/xml; charset=utf-8";
  }

  if (fileName === "vercel.json") {
    return "application/json; charset=utf-8";
  }

  if (fileName === "_headers") {
    return "text/plain; charset=utf-8";
  }

  return "application/octet-stream";
}

function cacheControlPolicy(fileName) {
  if (fileName.endsWith(".html")) {
    return "public, max-age=300";
  }

  return "public, max-age=3600";
}

function pageRecord(page, archiveManifest, originState) {
  const sourcePath = `app-store-assets/site/${page.fileName}`;
  const source = fileInfo(sourcePath);
  const archiveEntry = (archiveManifest.entries ?? []).find((entry) => entry.name === page.fileName) ?? null;
  const url = expectedUrl(originState, page.fileName);
  const sourceMatchesArchive =
    source.exists &&
    archiveEntry?.sha256 === source.sha256 &&
    archiveEntry?.sizeBytes === source.sizeBytes &&
    archiveEntry?.sourcePath === source.path;

  return {
    ...page,
    sourcePath,
    archivePath: archiveEntry ? archiveManifest.archivePath : null,
    publishPath: `/${page.fileName}`,
    expectedUrl: url.url,
    expectedContentType: expectedContentType(page.fileName),
    cacheControl: cacheControlPolicy(page.fileName),
    urlStatus: url.status,
    sourceExists: source.exists,
    sourceSizeBytes: source.sizeBytes,
    sourceSha256: source.sha256,
    archiveEntryExists: Boolean(archiveEntry),
    archiveSha256: archiveEntry?.sha256 ?? null,
    archiveSizeBytes: archiveEntry?.sizeBytes ?? 0,
    sourceMatchesArchive,
    publishStatus: source.exists && sourceMatchesArchive && url.status === "ready" ? "ready" : "blocked"
  };
}

function companionFileRecord(file, archiveManifest, originState) {
  return pageRecord(file, archiveManifest, originState);
}

function hostingConfigFileRecord(file, archiveManifest) {
  const record = pageRecord(file, archiveManifest, { status: "ready", origin: "host-consumed-static-config" });

  return {
    ...record,
    expectedUrl: "host-consumed-static-config",
    urlStatus: "not-applicable",
    publishStatus: record.sourceExists && record.sourceMatchesArchive ? "ready" : "blocked"
  };
}

function hostingRecord(item) {
  return {
    fileName: item.fileName,
    label: item.label,
    appStoreUse: item.appStoreUse,
    sourcePath: item.sourcePath,
    publishPath: item.publishPath,
    expectedUrl: item.expectedUrl,
    expectedContentType: item.expectedContentType,
    cacheControl: item.cacheControl,
    sourceSha256: item.sourceSha256,
    archiveSha256: item.archiveSha256,
    publishStatus: item.publishStatus
  };
}

function hostingRequirements(pages, companionFiles, hostingConfigFiles, originState) {
  const requiredFiles = [...pages, ...companionFiles, ...hostingConfigFiles].map(hostingRecord);
  const readyFiles = requiredFiles.filter((file) => file.publishStatus === "ready");

  return {
    httpsRequired: true,
    publicOrigin: originState.origin ?? "pending-public-site-url",
    publicOriginStatus: originState.status,
    uploadSources: [archivePath, "app-store-assets/site/"],
    requiredFileCount: requiredFiles.length,
    readyFileCount: readyFiles.length,
    blockedFileCount: requiredFiles.length - readyFiles.length,
    requiredFiles,
    postPublishChecks: ["npm run check:store-urls -- --strict", "npm run check:published-site -- --strict"],
    privateFilesExcluded: ["app-store-assets/site.env", "app-store-assets/site.env.local"]
  };
}

function firstNextAction(blockers) {
  const item = blockers.nextActionQueue?.[0];

  if (!item) {
    return null;
  }

  return {
    categoryId: item.categoryId,
    categoryLabel: item.categoryLabel,
    firstBlockedCheckId: item.firstBlockedCheckId,
    nextAction: item.nextAction,
    recommendedCommand: item.recommendedCommand
  };
}

function relatedBlockers(blockers) {
  return (blockers.categories ?? [])
    .filter((category) => ["public-inputs", "generated-site", "submission"].includes(category.id))
    .flatMap((category) =>
      (category.checks ?? [])
        .filter((check) => check.status === "blocked")
        .map((check) => ({
          categoryId: category.id,
          id: check.id,
          label: check.label,
          action: check.action,
          evidence: check.evidence
        }))
    );
}

function commandList() {
  return [
    "npm run configure:store-env -- --dry-run --site-url https://your-public-site.example --support-email \"<support-email>\" --review-name \"<review-contact-name>\" --review-email \"<review-contact-email>\" --review-phone \"<review-contact-phone>\"",
    "npm run public-release:store -- --self-test",
    "npm run public-release:store:node -- --self-test",
    "npm run public-release:store -- --dry-run",
    "npm run public-release:store:node -- --dry-run",
    "npm run site:store && npm run site:archive",
    "Upload app-store-assets/public-site/cody-cartridge-public-site.zip or the app-store-assets/site/ directory to the HTTPS public host.",
    "npm run public-release:store -- --published",
    "npm run public-release:store:published:node",
    "npm run public-host:store",
    "npm run check:store-urls -- --strict",
    "npm run check:published-site -- --strict",
    "npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store"
  ];
}

function renderMarkdown(packet) {
  const pageRows = packet.pages
    .map(
      (page) =>
        `| ${page.label} | \`${page.fileName}\` | ${page.publishStatus} | ${page.urlStatus} | ${page.sourceMatchesArchive ? "yes" : "no"} | ${page.expectedUrl} |`
    )
    .join("\n");
  const companionRows = packet.companionFiles
    .map(
      (file) =>
        `| ${file.label} | \`${file.fileName}\` | ${file.publishStatus} | ${file.urlStatus} | ${file.sourceMatchesArchive ? "yes" : "no"} | ${file.expectedUrl} |`
    )
    .join("\n");
  const hostingConfigRows = packet.hostingConfigFiles
    .map(
      (file) =>
        `| ${file.label} | \`${file.fileName}\` | ${file.publishStatus} | ${file.urlStatus} | ${file.sourceMatchesArchive ? "yes" : "no"} | \`${file.expectedContentType}\` |`
    )
    .join("\n");
  const hostingRows = packet.hosting.requiredFiles
    .map(
      (file) =>
        `| \`${file.fileName}\` | \`${file.publishPath}\` | \`${file.expectedContentType}\` | \`${file.cacheControl}\` | ${file.publishStatus} |`
    )
    .join("\n");
  const blockerRows =
    packet.relatedBlockers.length > 0
      ? packet.relatedBlockers.map((item) => `- ${item.categoryId}/${item.label}: ${item.action}`).join("\n")
      : "- None";

  return `# Cody Cartridge Public Site Publish Packet

Generated by \`npm run publish-packet:store\`.

This packet is the release-machine handoff for publishing the static support/privacy site. It describes what to upload, which URLs App Store Connect expects, and which checks prove the published pages are reachable. It intentionally stores no raw private App Review contact values, signing secrets, or ignored env-file contents.

## Summary

- App: ${packet.app.name}
- Bundle ID: \`${packet.app.bundleId}\`
- Version: ${packet.app.version}
- Build version: ${packet.app.buildVersion}
- Generated: ${packet.generatedAt}
- Release env source: ${packet.releaseEnv.loadedFiles.length > 0 ? packet.releaseEnv.loadedFiles.join(", ") : "not loaded"}
- Publish status: ${packet.summary.publishStatus}
- Pages ready: ${packet.summary.readyPageCount}/${packet.summary.requiredPageCount}
- Public origin: ${packet.summary.publicOriginStatus} (${packet.summary.publicOriginValueState})
- Support email: ${packet.summary.supportEmailStatus}
- Archive: \`${packet.archive.path}\`
- Archive status: ${packet.archive.status}
- Placeholder publish values: ${packet.summary.placeholderPublishValues ? "yes" : "no"}
- Companion files ready: ${packet.summary.readyCompanionFileCount}/${packet.summary.requiredCompanionFileCount}
- Static host config files ready: ${packet.summary.readyHostingConfigFileCount}/${packet.summary.requiredHostingConfigFileCount}

## Pages To Publish

| Page | File | Publish status | URL status | Matches archive | Expected URL |
| --- | --- | --- | --- | --- | --- |
${pageRows}

## Companion Files To Publish

| File | Name | Publish status | URL status | Matches archive | Expected URL |
| --- | --- | --- | --- | --- | --- |
${companionRows}

## Static Host Config Files

These files are included in the public-site archive for static hosts that consume deployment metadata. They are not App Store URLs and are not required to be publicly fetchable after deployment.

| File | Name | Publish status | URL status | Matches archive | Expected content type |
| --- | --- | --- | --- | --- | --- |
${hostingConfigRows}

## Hosting Requirements

- Public origin must be HTTPS: ${packet.hosting.httpsRequired ? "yes" : "no"}
- Public origin status: ${packet.hosting.publicOriginStatus}
- Upload source: \`${packet.hosting.uploadSources.join("` or `")}\`
- Required hosted files: ${packet.hosting.readyFileCount}/${packet.hosting.requiredFileCount} ready
- Private env files excluded: \`${packet.hosting.privateFilesExcluded.join("`, `")}\`

| File | Publish path | Expected content type | Cache-Control | Publish status |
| --- | --- | --- | --- | --- |
${hostingRows}

Post-publish verification:
${packet.hosting.postPublishChecks.map((command) => `- \`${command}\``).join("\n")}

## Publish Order

${packet.commands.map((command) => `- \`${command}\``).join("\n")}

## Current Blocker Queue

${packet.blockerQueueAction ? `- ${packet.blockerQueueAction.categoryLabel}: ${packet.blockerQueueAction.nextAction}\n- Command: \`${packet.blockerQueueAction.recommendedCommand}\`` : "- No blocker queue action recorded."}

## Related Public-Site Blockers

${blockerRows}

## Redaction And Exclusions

- Raw App Review contact values are not written to this packet.
- \`app-store-assets/site.env\` and \`app-store-assets/site.env.local\` are not included in handoff archives.
- Apple signing certificates, private keys, provisioning profiles, upload credentials, local music files, and Takeout exports are not part of this packet.
`;
}

function main() {
  const pkg = readJson("package.json");
  const publicInputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json", { summary: {}, fields: [] });
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json", { categories: [], nextActionQueue: [], summary: {} });
  const appStoreFields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json", {});
  const archiveManifest = readJson(archiveManifestPath, { entries: [], placeholders: {} });
  const originState = publicOriginState();
  const pages = requiredPages.map((page) => pageRecord(page, archiveManifest, originState));
  const companionFiles = requiredCompanionFiles.map((file) => companionFileRecord(file, archiveManifest, originState));
  const hostingConfigFiles = requiredHostingConfigFiles.map((file) => hostingConfigFileRecord(file, archiveManifest));
  const archive = fileInfo(archivePath);
  const missingPages = pages.filter((page) => !page.sourceExists || !page.archiveEntryExists || !page.sourceMatchesArchive);
  const blockedPages = pages.filter((page) => page.publishStatus !== "ready");
  const missingCompanionFiles = companionFiles.filter((file) => !file.sourceExists || !file.archiveEntryExists || !file.sourceMatchesArchive);
  const blockedCompanionFiles = companionFiles.filter((file) => file.publishStatus !== "ready");
  const missingHostingConfigFiles = hostingConfigFiles.filter((file) => !file.sourceExists || !file.archiveEntryExists || !file.sourceMatchesArchive);
  const blockedHostingConfigFiles = hostingConfigFiles.filter((file) => file.publishStatus !== "ready");
  const placeholderPublishValues = Boolean(
    archiveManifest.placeholders?.supportEmail ||
      archiveManifest.placeholders?.siteUrl ||
      (archiveManifest.placeholders?.files ?? []).length > 0
  );
  const archiveStatus = archive.exists && !placeholderPublishValues ? "ready" : archive.exists ? "blocked" : "missing";
  const packet = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName ?? pkg.name,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion: pkg.build?.buildVersion ?? pkg.version
    },
    releaseEnv: {
      loadedFiles,
      privateFilesExcludedFromHandoff: ["app-store-assets/site.env", "app-store-assets/site.env.local"],
      publicInputReadyCount: publicInputs.summary?.readyCount ?? 0,
      publicInputRequiredCount: publicInputs.summary?.requiredCount ?? 0
    },
    appStoreUrls: {
      supportUrl: appStoreFields.productPage?.supportUrl ?? appStoreFields.urls?.supportUrl ?? "pending-public-site-url",
      privacyPolicyUrl:
        appStoreFields.productPage?.privacyPolicyUrl ?? appStoreFields.urls?.privacyPolicyUrl ?? "pending-public-site-url",
      marketingUrl: appStoreFields.productPage?.marketingUrl ?? "pending-public-site-url",
      accessibilityUrl: appStoreFields.accessibility?.accessibilityUrl ?? "pending-public-site-url",
      thirdPartyNoticesUrl: appStoreFields.urls?.thirdPartyNoticesUrl ?? "pending-public-site-url"
    },
    summary: {
      publishStatus:
        archiveStatus === "ready" &&
        blockedPages.length === 0 &&
        blockedCompanionFiles.length === 0 &&
        blockedHostingConfigFiles.length === 0
          ? "ready"
          : "blocked",
      requiredPageCount: pages.length,
      readyPageCount: pages.length - blockedPages.length,
      blockedPageCount: blockedPages.length,
      missingOrMismatchedPageCount: missingPages.length,
      requiredCompanionFileCount: companionFiles.length,
      readyCompanionFileCount: companionFiles.length - blockedCompanionFiles.length,
      blockedCompanionFileCount: blockedCompanionFiles.length,
      missingOrMismatchedCompanionFileCount: missingCompanionFiles.length,
      requiredHostingConfigFileCount: hostingConfigFiles.length,
      readyHostingConfigFileCount: hostingConfigFiles.length - blockedHostingConfigFiles.length,
      blockedHostingConfigFileCount: blockedHostingConfigFiles.length,
      missingOrMismatchedHostingConfigFileCount: missingHostingConfigFiles.length,
      publicOriginStatus: originState.status,
      publicOriginValueState: originState.valueState,
      supportEmailStatus: supportEmailState(),
      placeholderPublishValues,
      blockerCount: blockers.summary?.blockerCount ?? 0
    },
    archive: {
      path: archive.path,
      status: archiveStatus,
      exists: archive.exists,
      sizeBytes: archive.sizeBytes,
      sha256: archive.sha256,
      manifestPath: archiveManifestPath,
      manifestSha256: fileInfo(archiveManifestPath).sha256,
      placeholderState: {
        supportEmail: Boolean(archiveManifest.placeholders?.supportEmail),
        siteUrl: Boolean(archiveManifest.placeholders?.siteUrl),
        files: archiveManifest.placeholders?.files ?? []
      }
    },
    pages,
    companionFiles,
    hostingConfigFiles,
    hosting: hostingRequirements(pages, companionFiles, hostingConfigFiles, originState),
    blockerQueueAction: firstNextAction(blockers),
    relatedBlockers: relatedBlockers(blockers),
    commands: commandList(),
    sourceArtifacts: [
      "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
      "app-store-assets/RELEASE_BLOCKERS.json",
      "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
      archiveManifestPath,
      archivePath,
      "scripts/build-public-site-publish-packet.cjs",
      "scripts/check-public-site-publish-packet.cjs",
      "scripts/build-public-host-runbook.cjs",
      "scripts/check-public-host-runbook.cjs",
      "scripts/check-public-site-published.cjs",
      "scripts/check-store-urls.cjs",
      "scripts/refresh-public-release.cjs"
    ],
    redaction: {
      storesRawPrivateContactValues: false,
      storesSigningSecrets: false,
      privateEnvFileIncluded: false
    }
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(packet, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderMarkdown(packet));

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (packet.summary.publishStatus !== "ready") {
    console.warn(
      `Public site publish packet records ${packet.summary.blockedPageCount} blocked page(s), ${packet.summary.blockedCompanionFileCount} blocked companion file(s), and ${packet.summary.blockedHostingConfigFileCount} blocked static host config file(s).`
    );
  }
}

main();
