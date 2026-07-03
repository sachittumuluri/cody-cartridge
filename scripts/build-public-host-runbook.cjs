#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  isReleaseStoreEnvValue,
  isStoreEnvPlaceholder,
  loadStoreEnv,
  releaseEnvKeys
} = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
const loadedFiles = loadStoreEnv(projectRoot);
const outputJson = path.join(projectRoot, "app-store-assets", "PUBLIC_HOST_RUNBOOK.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "PUBLIC_HOST_RUNBOOK.md");

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function valueState(key) {
  const rawValue = String(process.env[key] ?? "").trim();

  if (!rawValue) {
    return "missing";
  }

  if (isStoreEnvPlaceholder(rawValue)) {
    return "placeholder";
  }

  return isReleaseStoreEnvValue(key, rawValue) ? "ready" : "invalid";
}

function providerRecipes() {
  return [
    {
      id: "vercel",
      label: "Vercel static project",
      bestFor: "Fastest HTTPS host for this generated static directory.",
      prerequisites: ["Vercel account", "Vercel CLI session on the release machine"],
      deployCommands: [
        "npx vercel deploy app-store-assets/site --prod --yes",
        "npm run configure:store-env -- --site-url <public-site-origin> --support-email <support-email> --review-name <review-contact-name> --review-email <review-contact-email> --review-phone <review-contact-phone>",
        "npm run public-release:store:published:node"
      ],
      notes: [
        "Use the production deployment URL as CODY_SITE_URL.",
        "The generated app-store-assets/site/vercel.json file carries the expected static headers."
      ]
    },
    {
      id: "netlify",
      label: "Netlify static site",
      bestFor: "Simple drag-and-drop or CLI hosting of the generated site directory.",
      prerequisites: ["Netlify account", "Netlify CLI session on the release machine"],
      deployCommands: [
        "npx netlify deploy --dir app-store-assets/site --prod",
        "npm run configure:store-env -- --site-url <public-site-origin> --support-email <support-email> --review-name <review-contact-name> --review-email <review-contact-email> --review-phone <review-contact-phone>",
        "npm run public-release:store:published:node"
      ],
      notes: [
        "Use the production site origin, not a deploy-preview URL, as CODY_SITE_URL.",
        "The generated app-store-assets/site/_headers file carries static host header guidance."
      ]
    },
    {
      id: "cloudflare-pages",
      label: "Cloudflare Pages",
      bestFor: "Static hosting behind a durable custom domain.",
      prerequisites: ["Cloudflare account", "Wrangler CLI session on the release machine"],
      deployCommands: [
        "npx wrangler pages deploy app-store-assets/site --project-name cody-cartridge",
        "npm run configure:store-env -- --site-url <public-site-origin> --support-email <support-email> --review-name <review-contact-name> --review-email <review-contact-email> --review-phone <review-contact-phone>",
        "npm run public-release:store:published:node"
      ],
      notes: [
        "Use the final Pages production origin or mapped custom domain as CODY_SITE_URL.",
        "Confirm the generated support.html and privacy.html are reachable over HTTPS before App Store submission."
      ]
    },
    {
      id: "generic-static-host",
      label: "Any static HTTPS host",
      bestFor: "Manual upload to an existing site, object store, or static file host.",
      prerequisites: ["HTTPS-capable static host", "Ability to publish files at the site root"],
      deployCommands: [
        "Upload app-store-assets/site/ to the HTTPS site root, or unzip app-store-assets/public-site/cody-cartridge-public-site.zip at the site root.",
        "npm run configure:store-env -- --site-url <public-site-origin> --support-email <support-email> --review-name <review-contact-name> --review-email <review-contact-email> --review-phone <review-contact-phone>",
        "npm run public-release:store:published:node"
      ],
      notes: [
        "The final URL must serve /support.html and /privacy.html without authentication.",
        "Do not upload app-store-assets/site.env, app-store-assets/site.env.local, signing files, local music, or Takeout exports."
      ]
    }
  ];
}

function fileRows(packet) {
  return [
    ...(packet.pages ?? []),
    ...(packet.companionFiles ?? []),
    ...(packet.hostingConfigFiles ?? [])
  ].map((item) => ({
    fileName: item.fileName,
    sourcePath: item.sourcePath,
    publishPath: item.publishPath,
    contentType: item.expectedContentType,
    cacheControl: item.cacheControl,
    sourceMatchesArchive: item.sourceMatchesArchive === true,
    publishStatus: item.publishStatus
  }));
}

function commandPlan() {
  return [
    "npm run public-release:store -- --self-test",
    "npm run site:store && npm run site:archive",
    "npm run publish-packet:store",
    "Publish app-store-assets/site/ or app-store-assets/public-site/cody-cartridge-public-site.zip to an HTTPS static host.",
    "npm run configure:store-env -- --site-url <public-site-origin> --support-email <support-email> --review-name <review-contact-name> --review-email <review-contact-email> --review-phone <review-contact-phone>",
    "npm run public-release:store:published:node",
    "npm run check:store-urls -- --strict",
    "npm run check:published-site -- --strict",
    "npm run report:store-blockers && npm run public-inputs:store && npm run publish-packet:store && npm run public-host:store"
  ];
}

function renderMarkdown(runbook) {
  const inputRows = runbook.requiredValues
    .map((item) => `| \`${item.key}\` | ${item.status} | ${item.releaseUse} |`)
    .join("\n");
  const fileRowsMarkdown = runbook.hostedFiles
    .map(
      (item) =>
        `| \`${item.sourcePath}\` | \`${item.publishPath}\` | \`${item.contentType}\` | ${item.sourceMatchesArchive ? "yes" : "no"} | ${item.publishStatus} |`
    )
    .join("\n");
  const providerSections = runbook.providerRecipes
    .map(
      (provider) => `### ${provider.label}

- Best for: ${provider.bestFor}
- Prerequisites: ${provider.prerequisites.join("; ")}

Commands:
${provider.deployCommands.map((command) => `- \`${command}\``).join("\n")}

Notes:
${provider.notes.map((note) => `- ${note}`).join("\n")}`
    )
    .join("\n\n");

  return `# Cody Cartridge Public Host Runbook

Generated by \`npm run public-host:store\`.

This runbook turns the generated public support/privacy site into a concrete hosting checklist. It intentionally stores no raw private App Review contact values, Apple signing secrets, upload credentials, local music paths, or Takeout exports.

## Status

- App: ${runbook.app.name}
- Bundle ID: \`${runbook.app.bundleId}\`
- Version: ${runbook.app.version}
- Build version: ${runbook.app.buildVersion}
- Generated: ${runbook.generatedAt}
- Release env source: ${runbook.releaseEnv.loadedFiles.length > 0 ? runbook.releaseEnv.loadedFiles.join(", ") : "not loaded"}
- Source directory: \`${runbook.site.sourceDirectory}\`
- Public-site archive: \`${runbook.site.archivePath}\`
- Archive present: ${runbook.site.archiveExists ? "yes" : "no"}
- Source files match archive: ${runbook.summary.sourceFilesMatchArchive ? "yes" : "no"}
- Public values ready: ${runbook.summary.publicValuesReady ? "yes" : "no"}
- Ready for live verification: ${runbook.summary.readyForLiveVerification ? "yes" : "no"}

## Required Release Values

| Value | Status | Use |
| --- | --- | --- |
${inputRows}

## Hosted Files

| Source | Publish path | Content type | Matches archive | Status |
| --- | --- | --- | --- | --- |
${fileRowsMarkdown}

## Provider Recipes

${providerSections}

## Command Order

${runbook.commands.map((command) => `- \`${command}\``).join("\n")}

## Post-Publish Proof

- \`npm run check:store-urls -- --strict\` proves App Store Support and Privacy Policy URLs are reachable.
- \`npm run check:published-site -- --strict\` proves every published page matches the generated source.
- \`npm run public-release:store:published:node\` regenerates and verifies the full public-release artifact chain after the site is live.

## Exclusions

${runbook.exclusions.map((item) => `- ${item}`).join("\n")}
`;
}

function main() {
  const pkg = readJson("package.json");
  const publicInputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json", { fields: [] });
  const publishPacket = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json", { summary: {}, archive: {} });
  const hostedFiles = fileRows(publishPacket);
  const requiredValues = releaseEnvKeys.map((key) => {
    const source = (publicInputs.fields ?? []).find((item) => item.key === key) ?? {};

    return {
      key,
      label: source.label ?? key,
      status: valueState(key),
      releaseUse: source.appStoreUse ?? "App Store public release"
    };
  });
  const publicValuesReady = requiredValues.every((item) => item.status === "ready");
  const sourceFilesMatchArchive = hostedFiles.length > 0 && hostedFiles.every((item) => item.sourceMatchesArchive);
  const archiveExists = exists("app-store-assets/public-site/cody-cartridge-public-site.zip");
  const runbook = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName ?? pkg.name,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion: pkg.build?.buildVersion ?? pkg.version
    },
    releaseEnv: {
      loadedFiles,
      privateFilesExcludedFromHandoff: ["app-store-assets/site.env", "app-store-assets/site.env.local"]
    },
    summary: {
      sourceFilesMatchArchive,
      publicValuesReady,
      readyForLiveVerification: sourceFilesMatchArchive && archiveExists && publicValuesReady,
      providerRecipeCount: providerRecipes().length,
      hostedFileCount: hostedFiles.length
    },
    site: {
      sourceDirectory: "app-store-assets/site/",
      archivePath: "app-store-assets/public-site/cody-cartridge-public-site.zip",
      archiveExists,
      publishPacketPath: "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json"
    },
    requiredValues,
    hostedFiles,
    providerRecipes: providerRecipes(),
    commands: commandPlan(),
    sourceArtifacts: [
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
    ],
    exclusions: [
      "app-store-assets/site.env",
      "app-store-assets/site.env.local",
      "Apple signing certificates/private keys",
      "App Store Connect API keys/credentials",
      "local music import directory",
      "YouTube Music Takeout export directory"
    ],
    redaction: {
      storesRawPrivateContactValues: false,
      storesSigningSecrets: false,
      storesUploadCredentials: false,
      storesLocalMediaPaths: false
    }
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(runbook, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderMarkdown(runbook));

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (!runbook.summary.readyForLiveVerification) {
    console.warn("Public host runbook is advisory until public release values are configured and the site is published.");
  }
}

main();
