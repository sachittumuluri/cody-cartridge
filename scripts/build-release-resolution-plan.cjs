#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "RELEASE_RESOLUTION_PLAN.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "RELEASE_RESOLUTION_PLAN.md");

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function codeBlock(commands) {
  return ["```bash", commands.join("\n"), "```"].join("\n");
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function checksForCategory(blockers, categoryId) {
  return (blockers.categories ?? [])
    .filter((category) => category.id === categoryId)
    .flatMap((category) => category.checks ?? []);
}

function blockedChecksForCategory(blockers, categoryId) {
  return checksForCategory(blockers, categoryId).filter((check) => check.status === "blocked");
}

function phase(id, title, purpose, blockerCategoryIds, commands, evidence, exitCriteria) {
  return {
    id,
    title,
    purpose,
    blockerCategoryIds,
    commands,
    evidence,
    exitCriteria
  };
}

function main() {
  const pkg = readJson("package.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json", { summary: {}, categories: [], blockers: [] });
  const runbook = readJson("app-store-assets/SIGNING_UPLOAD_RUNBOOK.json", { releaseMachineCommands: [] });
  const blockerCount = blockers.summary?.blockerCount ?? blockers.blockers?.length ?? 0;
  const phases = [
    phase(
      "prepare-public-inputs",
      "Prepare public URL and contact inputs",
      "Create the ignored release-machine env file and fill only public App Store values.",
      ["public-inputs"],
      [
        "npm run configure:store-env -- --dry-run --site-url https://your-public-site.example --support-email \"<support-email>\" --review-name \"<review-contact-name>\" --review-email \"<review-contact-email>\" --review-phone \"<review-contact-phone>\"",
        "npm run configure:store-env -- --site-url https://your-public-site.example --support-email \"<support-email>\" --review-name \"<review-contact-name>\" --review-email \"<review-contact-email>\" --review-phone \"<review-contact-phone>\"",
        "npm run init:store-env",
        "npm run public-release:store -- --self-test",
        "npm run public-release:store:node -- --self-test",
        "npm run public-release:store -- --dry-run",
        "npm run public-release:store:node -- --dry-run",
        "npm run public-inputs:store",
        "npm run publish-packet:store",
        "npm run public-host:store",
        "npm run check:store-env",
        "npm run check:release-runtime -- --strict",
        "npm run check:release-runtime:node -- --strict"
      ],
      [
        "PUBLIC_RELEASE_INPUTS.md records every required CODY_* value without raw contact values.",
        "PUBLIC_SITE_PUBLISH_PACKET.md lists the static files, archive, and expected public URLs to publish.",
        "app-store-assets/site.env exists on the release machine and remains excluded from handoff archives.",
        "CODY_SITE_URL is a final HTTPS origin.",
        "CODY_SUPPORT_EMAIL and App Review contact values are real non-placeholder values.",
        "Node 22 is selected through .nvmrc or .node-version on the release machine."
      ],
      [
        "npm run check:store-env exits with 0.",
        "npm run check:release-runtime -- --strict exits with 0.",
        "npm run check:release-runtime:node -- --strict exits with 0 when the release shell is not already on .nvmrc Node.",
        "npm run check:public-inputs exits with 0 and records zero blocked fields.",
        "Release blocker report has no public-inputs blockers."
      ]
    ),
    phase(
      "publish-public-site",
      "Regenerate and publish the public support site",
      "Rebuild the generated support/privacy/accessibility/notices pages with real values and publish the archive or site directory.",
      ["public-inputs", "generated-site", "submission"],
      [
        "npm run public-release:store -- --self-test",
        "npm run public-release:store:node -- --self-test",
        "npm run public-release:store -- --published",
        "npm run public-release:store:published:node",
        "npm run site:store",
        "npm run check:site -- --strict",
        "npm run archive:site",
        "npm run check:site-archive -- --strict",
        "npm run publish-packet:store",
        "npm run public-host:store",
        "npm run export-compliance:store",
        "npm run packet:store",
        "npm run app-compliance:store",
        "npm run review-brief:store",
        "npm run copy-map:store",
        "npm run check:review-brief -- --strict",
        "npm run check:copy-map -- --strict",
        "npm run check:public-release-sync -- --strict",
        "npm run check:export-compliance",
        "npm run check:app-compliance",
        "npm run check:store-copy",
        "npm run check:artifact-privacy",
        "npm run check:store-urls -- --strict",
        "npm run check:published-site -- --strict"
      ],
      [
        "Generated site files contain no raw public-site placeholder tokens or placeholder contact values.",
        "PUBLIC_SITE_ARCHIVE.json reports no placeholder files.",
        "PUBLIC_SITE_PUBLISH_PACKET.md reports each public page matches the deterministic archive.",
        "APP_STORE_CONNECT_FIELDS.json, PUBLIC_SITE_ARCHIVE.json, and generated site HTML match the real CODY_* release env values.",
        "The public-release refresh wrapper completes and refreshes release evidence, manifest, and handoff artifacts.",
        "App Store support/privacy URLs are public HTTPS URLs and pass content checks.",
        "Every page listed in PUBLIC_SITE_PUBLISH_PACKET.json is reachable, served as HTML, and matches the generated source."
      ],
      [
        "Strict site, site archive, public release sync, export compliance, compliance packet, copy map, review brief, store copy, artifact privacy, URL, and published-site checks exit with 0.",
        "Release blocker report has no generated-site blockers and no public URL submission blockers."
      ]
    ),
    phase(
      "sign-and-package",
      "Sign and package the MAS build",
      "Use Apple distribution signing assets to build the sandboxed Mac App Store app and installer package.",
      ["signing-package"],
      [
        "npm run signing-assets:store",
        "npm run apple-assets:store",
        "npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run",
        "npm run check:mas-signing -- --strict",
        "npm run dist:mas",
        "npm run check:mas-package -- --strict"
      ],
      [
        "SIGNING_ASSET_REPORT.md records redacted identity/profile readiness counts without certificate names, profile UUIDs, or local paths.",
        "APPLE_RELEASE_ASSETS.md records the Apple Developer/App Store Connect assets that must be created or downloaded before signing and upload.",
        "Apple Distribution, Mac App Distribution, or 3rd Party Mac Developer Application identity is installed.",
        "Mac Installer Distribution or 3rd Party Mac Developer Installer identity is installed.",
        "The downloaded MAS provisioning profile is validated before installation.",
        "A matching macOS/Mac App Store distribution provisioning profile is embedded in the app bundle.",
        "dist/mas-arm64/Cody Cartridge.app and a signed current-version dist/**/*.pkg upload artifact exist.",
        "The signed MAS app bundle, signed current-version installer package, signature, provisioning profile, and entitlements pass strict package-boundary inspection."
      ],
      [
        "Strict signing and package-boundary checks exit with 0.",
        "Release blocker report has no signing-package blockers."
      ]
    ),
    phase(
      "upload-and-select-build",
      "Upload and select the processed build",
      "Deliver the signed MAS package to App Store Connect, wait for processing, then select the processed build on the macOS app version.",
      ["submission"],
      [
        "npm run check:upload-tooling -- --strict",
        "npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run",
        "npm run check:upload-credentials -- --strict",
        "npm run upload-packet:store",
        "npm run apple-assets:store",
        "open -a Transporter",
        `npm run upload-evidence:store -- --log /path/to/transporter.log --tool transporter --status selected --processed-bundle-id ${pkg.build?.appId} --processed-version ${pkg.version} --processed-build ${pkg.build?.buildVersion ?? pkg.version}`,
        "npm run report:store-blockers"
      ],
      [
        "Transporter, altool, or iTMSTransporter is available on the release machine.",
        "The downloaded App Store Connect API .p8 key validates before installation and is installed outside the project only after dry-run passes.",
        "App Store Connect API key identifiers and private-key file posture pass the strict credential preflight without writing secrets into artifacts.",
        "UPLOAD_COMMAND_PACKET.md records the selected signed package hash and available upload path without Apple credentials.",
        "APPLE_RELEASE_ASSETS.md confirms the signed package and API key request state before upload evidence is captured.",
        "Transporter/altool delivery logs are summarized in UPLOAD_EVIDENCE.md without raw credentials or local paths.",
        "App Store Connect processed build bundle id, version, and build version match package.json."
      ],
      [
        "Upload tooling check exits with 0.",
        "App Store Connect API key install dry-run exits with 0.",
        "Upload credential check exits with 0.",
        "npm run check:upload-evidence exits with 0 after logs and processed build values are attached.",
        "The processed build is selectable in App Store Connect.",
        "No upload processing warnings remain unresolved."
      ]
    ),
    phase(
      "freeze-evidence-and-handoff",
      "Freeze evidence and final handoff",
      "Regenerate every release artifact after public inputs, signing, packaging, and upload state are current.",
      ["public-inputs", "generated-site", "signing-package", "submission"],
      [
        "npm run report:store-blockers",
        "npm run public-inputs:store",
        "npm run publish-packet:store",
        "npm run public-host:store",
        "npm run signing-assets:store",
        "npm run upload-packet:store",
        "npm run copy-map:store",
        "npm run apple-assets:store",
        "npm run signing-runbook:store",
        "npm run resolution-plan:store",
        "npm run submission-checklist:store",
        "npm run machine-report:store",
        "npm run evidence:store",
        "npm run check:evidence",
        "npm run dashboard:store",
        "npm run operator:store",
        "npm run manifest:store",
        "npm run check:manifest",
        "npm run handoff:store",
        "npm run check:release-machine -- --strict",
        "npm run verify:store:strict"
      ],
      [
        "RELEASE_BLOCKERS.json summary shows zero blockers.",
        "RELEASE_OPERATOR_QUEUE.md, RELEASE_DASHBOARD.html, RELEASE_MACHINE_REPORT.md, UPLOAD_EVIDENCE.md, RELEASE_EVIDENCE.md, RELEASE_MANIFEST.md, RELEASE_RESOLUTION_PLAN.md, PUBLIC_RELEASE_INPUTS.md, PUBLIC_SITE_PUBLISH_PACKET.md, PUBLIC_HOST_RUNBOOK.md, FINAL_SUBMISSION_CHECKLIST.md, SIGNING_ASSET_REPORT.md, and SIGNING_UPLOAD_RUNBOOK.md describe the same candidate.",
        "The handoff ZIP excludes site.env, dist, node_modules, local music, and Takeout exports."
      ],
      [
        "npm run check:release-machine -- --strict exits with 0.",
        "npm run verify:store:strict exits with 0.",
        "The handoff archive records zero blockers and no placeholder public contact values."
      ]
    )
  ];
  const blockedChecks = Object.fromEntries(
    ["public-inputs", "generated-site", "signing-package", "submission"].map((categoryId) => [
      categoryId,
      blockedChecksForCategory(blockers, categoryId).map((check) => ({
        id: check.id,
        label: check.label,
        evidence: check.evidence,
        action: check.action
      }))
    ])
  );
  const releaseMachineCommands = (runbook.releaseMachineCommands ?? []).map((item) => item.command);
  const nodeWrappedShortcuts =
    runbook.nodeWrappedShortcuts ?? [
      {
        id: "local-dry-run",
        command: "npm run release:store:local:node",
        purpose: "Run the full local non-credentialed release gate through the Node version selected by .nvmrc."
      },
      {
        id: "public-release-refresh",
        command: "npm run public-release:store:node",
        purpose: "Run the public URL/contact artifact refresh through the Node version selected by .nvmrc."
      },
      {
        id: "published-public-release-refresh",
        command: "npm run public-release:store:published:node",
        purpose: "Run the public URL/contact artifact refresh plus live published-site checks through the Node version selected by .nvmrc."
      },
      {
        id: "strict-preflight",
        command: "npm run release:store:preflight:node",
        purpose: "Run the full release-machine preflight through the Node version selected by .nvmrc."
      },
      {
        id: "strict-release-machine-doctor",
        command: "npm run check:release-machine:node -- --strict",
        purpose: "Run the aggregate release-machine doctor through the Node version selected by .nvmrc."
      },
      {
        id: "strict-verifier",
        command: "npm run verify:store:strict:node",
        purpose: "Run the final strict verifier through the Node version selected by .nvmrc."
      }
    ];
  const plan = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName ?? pkg.name,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion: pkg.build?.buildVersion ?? pkg.version
    },
    blockerSnapshot: {
      blockerCount,
      readyForStrictPreflight: Boolean(blockers.summary?.readyForStrictPreflight),
      blockedChecks
    },
    releaseMachineCommands,
    nodeWrappedShortcuts,
    phases,
    finalProof: [
      "app-store-assets/RELEASE_BLOCKERS.json summary.blockerCount is 0.",
      "npm run check:release-machine -- --strict exits with 0 on the release machine.",
      "npm run check:release-machine:node -- --strict exits with 0 when the release shell is not already on .nvmrc Node.",
      "npm run verify:store:strict exits with 0 on the release machine.",
      "npm run verify:store:strict:node exits with 0 when the release shell is not already on .nvmrc Node.",
      "npm run check:public-release-sync -- --strict exits with 0 on the release machine.",
      "npm run check:upload-evidence exits with 0 after App Store Connect upload logs are attached.",
      "Transporter/altool delivery logs are saved with RELEASE_EVIDENCE.md.",
      "App Store Connect selected build matches bundle id, version, and build version from this plan."
    ]
  };

  const phaseMarkdown = phases
    .map(
      (item, index) => `### ${index + 1}. ${item.title}

${item.purpose}

**Commands**

${codeBlock(item.commands)}

**Evidence To Keep**

${list(item.evidence)}

**Exit Criteria**

${list(item.exitCriteria)}`
    )
    .join("\n\n");
  const blockedMarkdown = Object.entries(blockedChecks)
    .map(([categoryId, checks]) => {
      const rows =
        checks.length > 0
          ? checks.map((check) => `| ${check.label} | ${check.evidence} | ${check.action} |`).join("\n")
          : "| None | No blockers in this category. | No action needed. |";
      return `### ${categoryId}

| Blocker | Current Evidence | Required Action |
| --- | --- | --- |
${rows}`;
    })
    .join("\n\n");
  const markdown = `# Cody Cartridge Release Resolution Plan

Generated by \`npm run resolution-plan:store\`.

This is the ordered release-machine plan for clearing the current App Store blockers. It intentionally avoids storing private contact values, signing identity names, local paths, or App Store credentials.

## Candidate

- App: ${plan.app.name}
- Bundle ID: \`${plan.app.bundleId}\`
- Version: ${plan.app.version}
- Build version: ${plan.app.buildVersion}
- Current blockers: ${plan.blockerSnapshot.blockerCount}
- Ready for strict preflight: ${plan.blockerSnapshot.readyForStrictPreflight ? "yes" : "no"}

## Phases

${phaseMarkdown}

## Current Blockers By Category

${blockedMarkdown}

## Node-Safe Shortcuts

Use these wrappers when the current shell is not already running the \`.nvmrc\` Node release runtime.

${codeBlock(nodeWrappedShortcuts.map((item) => item.command))}

${list(nodeWrappedShortcuts.map((item) => `${item.command}: ${item.purpose}`))}

## Final Proof

${list(plan.finalProof)}
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (blockerCount > 0) {
    console.warn(`Release resolution plan records ${blockerCount} remaining blocker(s).`);
  }
}

main();
