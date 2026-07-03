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
loadStoreEnv(projectRoot);

const strict = process.argv.includes("--strict");
const jsonPath = path.join(projectRoot, "app-store-assets", "PUBLIC_SITE_PUBLISH_PACKET.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "PUBLIC_SITE_PUBLISH_PACKET.md");
const requiredFiles = ["index.html", "support.html", "privacy.html", "accessibility.html", "third-party-notices.html"];
const requiredCompanionFiles = ["robots.txt", "sitemap.xml"];
const requiredHostingConfigFiles = ["_headers", "vercel.json"];
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

function sha256File(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  return crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
}

function publicOriginState() {
  const value = process.env.CODY_SITE_URL ?? "";

  if (!value) {
    return { status: "blocked", valueState: "missing", origin: null };
  }

  if (isStoreEnvPlaceholder(value)) {
    return { status: "blocked", valueState: "placeholder", origin: null };
  }

  if (!isReleaseStoreEnvValue("CODY_SITE_URL", value)) {
    return { status: "blocked", valueState: "invalid", origin: null };
  }

  return { status: "ready", valueState: "ready", origin: String(value).replace(/\/+$/, "") };
}

function supportEmailState() {
  const value = process.env.CODY_SUPPORT_EMAIL ?? "";

  if (!value) {
    return "missing";
  }

  if (isStoreEnvPlaceholder(value)) {
    return "placeholder";
  }

  return isReleaseStoreEnvValue("CODY_SUPPORT_EMAIL", value) ? "ready" : "invalid";
}

function scriptIncludes(pkg, scriptName, expected) {
  return String(pkg.scripts?.[scriptName] ?? "").includes(expected);
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

function expectedCacheControl(fileName) {
  return fileName.endsWith(".html") ? "public, max-age=300" : "public, max-age=3600";
}

function main() {
  assert(exists("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json"), "Public site publish packet JSON exists");
  assert(exists("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md"), "Public site publish packet markdown exists");

  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath)) {
    return;
  }

  const packet = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json");
  const markdown = readText("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md");
  const pkg = readJson("package.json");
  const publicInputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json");
  const archiveManifest = readJson("app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json");
  const raw = `${JSON.stringify(packet)}\n${markdown}`;
  const origin = publicOriginState();
  const pages = packet.pages ?? [];
  const companionFiles = packet.companionFiles ?? [];
  const hostingConfigFiles = packet.hostingConfigFiles ?? [];
  const readyPages = pages.filter((page) => page.publishStatus === "ready");
  const blockedPages = pages.filter((page) => page.publishStatus !== "ready");
  const readyCompanionFiles = companionFiles.filter((file) => file.publishStatus === "ready");
  const blockedCompanionFiles = companionFiles.filter((file) => file.publishStatus !== "ready");
  const readyHostingConfigFiles = hostingConfigFiles.filter((file) => file.publishStatus === "ready");
  const blockedHostingConfigFiles = hostingConfigFiles.filter((file) => file.publishStatus !== "ready");

  assert(packet.app?.bundleId === pkg.build?.appId, "Public site publish packet bundle id matches package config");
  assert(packet.app?.version === pkg.version, "Public site publish packet version matches package config");
  assert(
    packet.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version),
    "Public site publish packet build version matches package config"
  );
  assert(packet.releaseEnv?.publicInputReadyCount === publicInputs.summary?.readyCount, "Publish packet public-input ready count matches source");
  assert(
    packet.releaseEnv?.publicInputRequiredCount === publicInputs.summary?.requiredCount,
    "Publish packet public-input required count matches source"
  );
  assert(packet.summary?.requiredPageCount === requiredFiles.length, "Publish packet records every required public page");
  assert(packet.summary?.readyPageCount === readyPages.length, "Publish packet ready page count is accurate");
  assert(packet.summary?.blockedPageCount === blockedPages.length, "Publish packet blocked page count is accurate");
  assert(
    packet.summary?.requiredCompanionFileCount === requiredCompanionFiles.length,
    "Publish packet records every required public companion file"
  );
  assert(packet.summary?.readyCompanionFileCount === readyCompanionFiles.length, "Publish packet ready companion-file count is accurate");
  assert(
    packet.summary?.blockedCompanionFileCount === blockedCompanionFiles.length,
    "Publish packet blocked companion-file count is accurate"
  );
  assert(
    packet.summary?.requiredHostingConfigFileCount === requiredHostingConfigFiles.length,
    "Publish packet records every static host config file"
  );
  assert(packet.summary?.readyHostingConfigFileCount === readyHostingConfigFiles.length, "Publish packet ready static-host config count is accurate");
  assert(
    packet.summary?.blockedHostingConfigFileCount === blockedHostingConfigFiles.length,
    "Publish packet blocked static-host config count is accurate"
  );
  assert(packet.summary?.publicOriginStatus === origin.status, "Publish packet public-origin status matches current env");
  assert(packet.summary?.publicOriginValueState === origin.valueState, "Publish packet public-origin state matches current env");
  assert(packet.summary?.supportEmailStatus === supportEmailState(), "Publish packet support-email state matches current env");
  assert(packet.summary?.blockerCount === blockers.summary?.blockerCount, "Publish packet blocker count matches release blocker report");
  assert(
    packet.summary?.placeholderPublishValues ===
      Boolean(
        archiveManifest.placeholders?.supportEmail ||
          archiveManifest.placeholders?.siteUrl ||
          (archiveManifest.placeholders?.files ?? []).length > 0
      ),
    "Publish packet placeholder state matches public site archive manifest"
  );

  requiredFiles.forEach((fileName) => {
    const page = pages.find((item) => item.fileName === fileName);
    const sourcePath = `app-store-assets/site/${fileName}`;
    const archiveEntry = (archiveManifest.entries ?? []).find((entry) => entry.name === fileName);
    assert(Boolean(page), `Publish packet includes ${fileName}`);
    assert(page?.sourcePath === sourcePath, `${fileName} source path is recorded`);
    assert(page?.publishPath === `/${fileName}`, `${fileName} publish path is rooted`);
    assert(page?.expectedContentType === expectedContentType(fileName), `${fileName} expected content type is recorded`);
    assert(page?.cacheControl === expectedCacheControl(fileName), `${fileName} cache policy is recorded`);
    assert(page?.sourceExists === exists(sourcePath), `${fileName} source existence matches disk`);

    if (exists(sourcePath)) {
      assert(page?.sourceSha256 === sha256File(sourcePath), `${fileName} source hash matches disk`);
    }

    assert(page?.archiveEntryExists === Boolean(archiveEntry), `${fileName} archive-entry state matches archive manifest`);

    if (archiveEntry) {
      assert(page?.archiveSha256 === archiveEntry.sha256, `${fileName} archive hash matches archive manifest`);
      assert(page?.archiveSizeBytes === archiveEntry.sizeBytes, `${fileName} archive size matches archive manifest`);
      assert(
        page?.sourceMatchesArchive ===
          (page?.sourceExists === true &&
            page?.sourceSha256 === archiveEntry.sha256 &&
            page?.sourceSizeBytes === archiveEntry.sizeBytes &&
            page?.sourcePath === archiveEntry.sourcePath),
        `${fileName} source/archive match state is accurate`
      );
    }

    if (origin.status === "ready") {
      assert(page?.urlStatus === "ready", `${fileName} URL is ready when public origin is configured`);
      assert(page?.expectedUrl === `${origin.origin}/${fileName}`, `${fileName} expected URL is derived from public origin`);
    } else {
      assert(page?.urlStatus === "blocked", `${fileName} URL is blocked without public origin`);
      assert(page?.expectedUrl === "pending-public-site-url", `${fileName} expected URL does not expose placeholder origin`);
    }
  });

  requiredCompanionFiles.forEach((fileName) => {
    const file = companionFiles.find((item) => item.fileName === fileName);
    const sourcePath = `app-store-assets/site/${fileName}`;
    const archiveEntry = (archiveManifest.entries ?? []).find((entry) => entry.name === fileName);
    assert(Boolean(file), `Publish packet includes ${fileName}`);
    assert(file?.sourcePath === sourcePath, `${fileName} source path is recorded`);
    assert(file?.publishPath === `/${fileName}`, `${fileName} publish path is rooted`);
    assert(file?.expectedContentType === expectedContentType(fileName), `${fileName} expected content type is recorded`);
    assert(file?.cacheControl === expectedCacheControl(fileName), `${fileName} cache policy is recorded`);
    assert(file?.sourceExists === exists(sourcePath), `${fileName} source existence matches disk`);

    if (exists(sourcePath)) {
      assert(file?.sourceSha256 === sha256File(sourcePath), `${fileName} source hash matches disk`);
    }

    assert(file?.archiveEntryExists === Boolean(archiveEntry), `${fileName} archive-entry state matches archive manifest`);

    if (archiveEntry) {
      assert(file?.archiveSha256 === archiveEntry.sha256, `${fileName} archive hash matches archive manifest`);
      assert(file?.archiveSizeBytes === archiveEntry.sizeBytes, `${fileName} archive size matches archive manifest`);
      assert(
        file?.sourceMatchesArchive ===
          (file?.sourceExists === true &&
            file?.sourceSha256 === archiveEntry.sha256 &&
            file?.sourceSizeBytes === archiveEntry.sizeBytes &&
            file?.sourcePath === archiveEntry.sourcePath),
        `${fileName} source/archive match state is accurate`
      );
    }

    if (origin.status === "ready") {
      assert(file?.urlStatus === "ready", `${fileName} URL is ready when public origin is configured`);
      assert(file?.expectedUrl === `${origin.origin}/${fileName}`, `${fileName} expected URL is derived from public origin`);
    } else {
      assert(file?.urlStatus === "blocked", `${fileName} URL is blocked without public origin`);
      assert(file?.expectedUrl === "pending-public-site-url", `${fileName} expected URL does not expose placeholder origin`);
    }
  });

  requiredHostingConfigFiles.forEach((fileName) => {
    const file = hostingConfigFiles.find((item) => item.fileName === fileName);
    const sourcePath = `app-store-assets/site/${fileName}`;
    const archiveEntry = (archiveManifest.entries ?? []).find((entry) => entry.name === fileName);
    assert(Boolean(file), `Publish packet includes ${fileName}`);
    assert(file?.sourcePath === sourcePath, `${fileName} source path is recorded`);
    assert(file?.publishPath === `/${fileName}`, `${fileName} publish path is rooted`);
    assert(file?.expectedContentType === expectedContentType(fileName), `${fileName} expected content type is recorded`);
    assert(file?.sourceExists === exists(sourcePath), `${fileName} source existence matches disk`);

    if (exists(sourcePath)) {
      assert(file?.sourceSha256 === sha256File(sourcePath), `${fileName} source hash matches disk`);
    }

    assert(file?.archiveEntryExists === Boolean(archiveEntry), `${fileName} archive-entry state matches archive manifest`);

    if (archiveEntry) {
      assert(file?.archiveSha256 === archiveEntry.sha256, `${fileName} archive hash matches archive manifest`);
      assert(file?.archiveSizeBytes === archiveEntry.sizeBytes, `${fileName} archive size matches archive manifest`);
      assert(
        file?.sourceMatchesArchive ===
          (file?.sourceExists === true &&
            file?.sourceSha256 === archiveEntry.sha256 &&
            file?.sourceSizeBytes === archiveEntry.sizeBytes &&
            file?.sourcePath === archiveEntry.sourcePath),
        `${fileName} source/archive match state is accurate`
      );
    }

    assert(file?.urlStatus === "not-applicable", `${fileName} is not treated as an App Store public URL`);
    assert(file?.expectedUrl === "host-consumed-static-config", `${fileName} expected URL records host-consumed config status`);
  });

  assert(packet.archive?.path === "app-store-assets/public-site/cody-cartridge-public-site.zip", "Publish packet records archive path");
  assert(packet.archive?.manifestPath === "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json", "Publish packet records archive manifest path");
  if (exists(packet.archive?.path)) {
    assert(packet.archive?.sha256 === sha256File(packet.archive.path), "Publish packet archive hash matches disk");
  }
  assert(
    packet.blockerQueueAction?.categoryId === blockers.nextActionQueue?.[0]?.categoryId ||
      (!packet.blockerQueueAction && (blockers.nextActionQueue ?? []).length === 0),
    "Publish packet first blocker queue action matches blocker report"
  );

  const hostedFiles = [...pages, ...companionFiles, ...hostingConfigFiles];
  const hosting = packet.hosting ?? {};
  const hostingFiles = hosting.requiredFiles ?? [];

  assert(hosting.httpsRequired === true, "Publish packet hosting requires HTTPS");
  assert(hosting.publicOriginStatus === origin.status, "Publish packet hosting public-origin status matches current env");
  assert(hosting.publicOrigin === (origin.origin ?? "pending-public-site-url"), "Publish packet hosting public origin is redacted or ready");
  assert(hosting.requiredFileCount === hostedFiles.length, "Publish packet hosting file count covers pages and companion files");
  assert(
    hosting.readyFileCount === hostedFiles.filter((item) => item.publishStatus === "ready").length,
    "Publish packet hosting ready file count is accurate"
  );
  assert(
    hosting.blockedFileCount === hostedFiles.filter((item) => item.publishStatus !== "ready").length,
    "Publish packet hosting blocked file count is accurate"
  );
  assert(hosting.uploadSources?.includes("app-store-assets/public-site/cody-cartridge-public-site.zip"), "Publish packet hosting names site archive upload source");
  assert(hosting.uploadSources?.includes("app-store-assets/site/"), "Publish packet hosting names generated site directory upload source");
  assert(hosting.postPublishChecks?.includes("npm run check:store-urls -- --strict"), "Publish packet hosting includes strict store URL check");
  assert(hosting.postPublishChecks?.includes("npm run check:published-site -- --strict"), "Publish packet hosting includes strict published-site check");
  assert(hosting.privateFilesExcluded?.includes("app-store-assets/site.env"), "Publish packet hosting excludes private site env file");
  assert(hosting.privateFilesExcluded?.includes("app-store-assets/site.env.local"), "Publish packet hosting excludes local private site env file");
  hostedFiles.forEach((item) => {
    const hostingFile = hostingFiles.find((file) => file.fileName === item.fileName);
    assert(Boolean(hostingFile), `Publish packet hosting includes ${item.fileName}`);
    assert(hostingFile?.sourcePath === item.sourcePath, `${item.fileName} hosting source path matches item`);
    assert(hostingFile?.publishPath === item.publishPath, `${item.fileName} hosting publish path matches item`);
    assert(hostingFile?.expectedUrl === item.expectedUrl, `${item.fileName} hosting expected URL matches item`);
    assert(hostingFile?.expectedContentType === item.expectedContentType, `${item.fileName} hosting content type matches item`);
    assert(hostingFile?.cacheControl === item.cacheControl, `${item.fileName} hosting cache policy matches item`);
    assert(hostingFile?.sourceSha256 === item.sourceSha256, `${item.fileName} hosting source hash matches item`);
    assert(hostingFile?.archiveSha256 === item.archiveSha256, `${item.fileName} hosting archive hash matches item`);
    assert(hostingFile?.publishStatus === item.publishStatus, `${item.fileName} hosting publish status matches item`);
  });
  [
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/RELEASE_BLOCKERS.json",
    "app-store-assets/APP_STORE_CONNECT_FIELDS.json",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "scripts/build-public-site-publish-packet.cjs",
    "scripts/check-public-site-publish-packet.cjs",
    "scripts/build-public-host-runbook.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/check-public-site-published.cjs",
    "scripts/check-store-urls.cjs",
    "scripts/refresh-public-release.cjs"
  ].forEach((artifact) => {
    assert(packet.sourceArtifacts?.includes(artifact), `Publish packet records ${artifact} source`);
  });
  [
    "npm run public-release:store -- --self-test",
    "npm run public-release:store:node -- --self-test",
    "npm run public-release:store -- --dry-run",
    "npm run public-release:store:node -- --dry-run",
    "npm run site:store && npm run site:archive",
    "npm run public-release:store -- --published",
    "npm run public-release:store:published:node",
    "npm run public-host:store",
    "npm run check:store-urls -- --strict",
    "npm run check:published-site -- --strict",
    "npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store"
  ].forEach((command) => {
    assert((packet.commands ?? []).includes(command), `Publish packet includes ${command}`);
  });
  assert(
    packet.appStoreUrls?.supportUrl === readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json").productPage?.supportUrl,
    "Publish packet records App Store support URL from product page fields"
  );
  assert(
    packet.appStoreUrls?.privacyPolicyUrl === readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json").productPage?.privacyPolicyUrl,
    "Publish packet records App Store privacy URL from product page fields"
  );
  assert(
    (packet.commands ?? []).some((command) => command.startsWith("npm run configure:store-env -- --dry-run")),
    "Publish packet includes store-env dry-run command"
  );
  assert(packet.redaction?.storesRawPrivateContactValues === false, "Publish packet records private-contact redaction posture");
  assert(packet.redaction?.storesSigningSecrets === false, "Publish packet records signing-secret redaction posture");
  assert(packet.redaction?.privateEnvFileIncluded === false, "Publish packet excludes private env files");
  assert(!raw.includes("you@example.com"), "Publish packet excludes placeholder email values");
  assert(!raw.includes("+1-555-555-5555"), "Publish packet excludes placeholder phone values");
  assert(!raw.includes("Your Name"), "Publish packet excludes placeholder names");
  assert(!/<script\b/i.test(markdown), "Publish packet markdown contains no script tags");
  assert(markdown.includes("# Cody Cartridge Public Site Publish Packet"), "Publish packet markdown includes title");
  assert(markdown.includes("## Pages To Publish"), "Publish packet markdown includes page list");
  assert(markdown.includes("## Companion Files To Publish"), "Publish packet markdown includes companion file list");
  assert(markdown.includes("## Static Host Config Files"), "Publish packet markdown includes static host config file list");
  assert(markdown.includes("## Hosting Requirements"), "Publish packet markdown includes hosting requirements");
  assert(markdown.includes("Expected content type"), "Publish packet markdown includes content-type guidance");
  assert(markdown.includes("## Publish Order"), "Publish packet markdown includes publish order");
  assert(markdown.includes("## Current Blocker Queue"), "Publish packet markdown includes blocker queue");
  assert(scriptIncludes(pkg, "publish-packet:store", "scripts/build-public-site-publish-packet.cjs"), "package.json has publish packet build script");
  assert(scriptIncludes(pkg, "publish-packet:store", "scripts/check-public-site-publish-packet.cjs"), "package.json publish packet script runs checker");
  assert(pkg.scripts?.["check:publish-packet"] === "node scripts/check-public-site-publish-packet.cjs", "package.json has publish packet standalone checker");
  assert(scriptIncludes(pkg, "public-host:store", "scripts/build-public-host-runbook.cjs"), "package.json has public host runbook build script");
  assert(scriptIncludes(pkg, "public-host:store", "scripts/check-public-host-runbook.cjs"), "package.json public host runbook checker runs after generation");
  assert(pkg.scripts?.["check:public-host"] === "node scripts/check-public-host-runbook.cjs", "package.json has public host runbook standalone checker");
  assert(pkg.scripts?.["check:published-site"] === "node scripts/check-public-site-published.cjs", "package.json has published-site standalone checker");
  assert(scriptIncludes(pkg, "release:store:local", "npm run publish-packet:store"), "Local release dry-run builds public site publish packet");
  assert(scriptIncludes(pkg, "release:store:preflight", "npm run publish-packet:store"), "Release preflight builds public site publish packet");

  if (packet.summary?.publishStatus === "ready") {
    pass("Public site publish packet is ready");
  } else {
    warn(
      `Public site publish packet is blocked with ${blockedPages.length} page(s) and ${blockedCompanionFiles.length} companion file(s) blocked`
    );
  }
}

main();

console.log(`Public site publish packet checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
