#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { releaseEnvKeys } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const jsonPath = path.join(projectRoot, "app-store-assets", "PUBLIC_HOST_RUNBOOK.json");
const markdownPath = path.join(projectRoot, "app-store-assets", "PUBLIC_HOST_RUNBOOK.md");
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

function sha256(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(projectRoot, relativePath))).digest("hex");
}

function scriptIncludes(pkg, scriptName, expected) {
  return String(pkg.scripts?.[scriptName] ?? "").includes(expected);
}

function main() {
  assert(exists("app-store-assets/PUBLIC_HOST_RUNBOOK.json"), "Public host runbook JSON exists");
  assert(exists("app-store-assets/PUBLIC_HOST_RUNBOOK.md"), "Public host runbook markdown exists");

  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath)) {
    return;
  }

  const runbook = readJson("app-store-assets/PUBLIC_HOST_RUNBOOK.json");
  const markdown = readText("app-store-assets/PUBLIC_HOST_RUNBOOK.md");
  const pkg = readJson("package.json");
  const publishPacket = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json");
  const raw = `${JSON.stringify(runbook)}\n${markdown}`;
  const hostedFiles = [
    ...(publishPacket.pages ?? []),
    ...(publishPacket.companionFiles ?? []),
    ...(publishPacket.hostingConfigFiles ?? [])
  ];

  assert(runbook.app?.bundleId === pkg.build?.appId, "Public host runbook bundle id matches package config");
  assert(runbook.app?.version === pkg.version, "Public host runbook version matches package config");
  assert(runbook.app?.buildVersion === (pkg.build?.buildVersion ?? pkg.version), "Public host runbook build version matches package config");
  assert(runbook.site?.sourceDirectory === "app-store-assets/site/", "Public host runbook records generated site directory");
  assert(runbook.site?.archivePath === "app-store-assets/public-site/cody-cartridge-public-site.zip", "Public host runbook records public-site archive");
  assert(runbook.site?.archiveExists === exists("app-store-assets/public-site/cody-cartridge-public-site.zip"), "Public host runbook archive existence matches disk");
  if (exists("app-store-assets/public-site/cody-cartridge-public-site.zip")) {
    assert(/^[a-f0-9]{64}$/.test(sha256("app-store-assets/public-site/cody-cartridge-public-site.zip")), "Public site archive has a hashable payload");
  }
  assert(
    runbook.summary?.hostedFileCount === hostedFiles.length && runbook.hostedFiles?.length === hostedFiles.length,
    "Public host runbook mirrors every publish-packet hosted file"
  );
  hostedFiles.forEach((item) => {
    assert(
      runbook.hostedFiles?.some(
        (file) =>
          file.fileName === item.fileName &&
          file.sourcePath === item.sourcePath &&
          file.publishPath === item.publishPath &&
          file.contentType === item.expectedContentType
      ),
      `Public host runbook records hosted file ${item.fileName}`
    );
  });
  releaseEnvKeys.forEach((key) => {
    assert(runbook.requiredValues?.some((item) => item.key === key), `Public host runbook records release value ${key}`);
  });
  assert(
    runbook.requiredValues?.every((item) => ["missing", "placeholder", "invalid", "ready"].includes(item.status)),
    "Public host runbook records valid release value states"
  );
  assert(runbook.providerRecipes?.length >= 4, "Public host runbook records multiple static hosting recipes");
  ["vercel", "netlify", "cloudflare-pages", "generic-static-host"].forEach((id) => {
    assert(runbook.providerRecipes?.some((item) => item.id === id), `Public host runbook includes ${id} recipe`);
  });
  assert(
    runbook.providerRecipes?.every(
      (item) => item.deployCommands?.some((command) => command.includes("configure:store-env")) && item.deployCommands?.some((command) => command.includes("public-release:store"))
    ),
    "Public host runbook recipes include env configuration and public release verification"
  );
  assert(runbook.commands?.includes("npm run public-release:store -- --self-test"), "Public host runbook includes public-release self-test command");
  assert(runbook.commands?.includes("npm run site:store && npm run site:archive"), "Public host runbook includes site rebuild/archive command");
  assert(runbook.commands?.includes("npm run check:store-urls -- --strict"), "Public host runbook includes strict store URL check");
  assert(runbook.commands?.includes("npm run check:published-site -- --strict"), "Public host runbook includes strict published-site check");
  assert(
    runbook.commands?.includes("npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store"),
    "Public host runbook includes blocker and runbook refresh command"
  );
  [
    "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
    "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
    "app-store-assets/public-site/PUBLIC_SITE_ARCHIVE.json",
    "app-store-assets/public-site/cody-cartridge-public-site.zip",
    "scripts/build-public-host-runbook.cjs",
    "scripts/check-public-host-runbook.cjs",
    "scripts/refresh-public-release.cjs",
    "scripts/configure-store-env.cjs",
    "scripts/check-store-urls.cjs",
    "scripts/check-public-site-published.cjs"
  ].forEach((artifact) => {
    assert(runbook.sourceArtifacts?.includes(artifact), `Public host runbook records source artifact ${artifact}`);
  });
  assert(runbook.redaction?.storesRawPrivateContactValues === false, "Public host runbook records private-contact redaction posture");
  assert(runbook.redaction?.storesSigningSecrets === false, "Public host runbook records signing-secret redaction posture");
  assert(runbook.redaction?.storesUploadCredentials === false, "Public host runbook records upload-credential redaction posture");
  assert(runbook.redaction?.storesLocalMediaPaths === false, "Public host runbook records local-media redaction posture");
  assert(!raw.includes("you@example.com"), "Public host runbook excludes placeholder email values");
  assert(!raw.includes("+1-555-555-5555"), "Public host runbook excludes placeholder phone values");
  assert(!raw.includes("Your Name"), "Public host runbook excludes placeholder names");
  assert(!/<script\b/i.test(markdown), "Public host runbook markdown contains no script tags");
  assert(markdown.includes("# Cody Cartridge Public Host Runbook"), "Public host runbook markdown includes title");
  assert(markdown.includes("Provider Recipes"), "Public host runbook markdown includes provider recipes");
  assert(markdown.includes("Post-Publish Proof"), "Public host runbook markdown includes post-publish proof section");
  assert(scriptIncludes(pkg, "public-host:store", "scripts/build-public-host-runbook.cjs"), "package.json has public host runbook build script");
  assert(scriptIncludes(pkg, "public-host:store", "scripts/check-public-host-runbook.cjs"), "package.json public host runbook script runs checker");
  assert(pkg.scripts?.["check:public-host"] === "node scripts/check-public-host-runbook.cjs", "package.json has public host runbook standalone checker");
  assert(scriptIncludes(pkg, "release:store:local", "npm run public-host:store"), "Local release dry-run builds public host runbook");
  assert(scriptIncludes(pkg, "release:store:preflight", "npm run public-host:store"), "Release preflight builds public host runbook");

  if (runbook.summary?.readyForLiveVerification === true) {
    pass("Public host runbook is ready for live verification");
  } else {
    warn("Public host runbook is advisory until public release values are configured and the site is published");
  }
}

main();

console.log(`Public host runbook checks${strict ? " (strict)" : ""}: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failures`);
passes.forEach((message) => console.log(`PASS ${message}`));
warnings.forEach((message) => console.warn(`WARN ${message}`));

if (failures.length > 0) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
}
