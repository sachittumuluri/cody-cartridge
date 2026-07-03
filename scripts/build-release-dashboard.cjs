#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "RELEASE_DASHBOARD.json");
const outputHtml = path.join(projectRoot, "app-store-assets", "RELEASE_DASHBOARD.html");

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusLabel(blockerCount) {
  return blockerCount > 0 ? "blocked" : "ready";
}

function firstBlockedCategory(blockers) {
  return (blockers.categories ?? []).find((category) => (category.blockerCount ?? 0) > 0) ?? null;
}

function nextActionFromBlockers(blockers) {
  const nextQueuedAction = blockers.nextActionQueue?.[0];

  if (nextQueuedAction) {
    return {
      categoryId: nextQueuedAction.categoryId,
      checkId: nextQueuedAction.firstBlockedCheckId,
      command: nextQueuedAction.recommendedCommand,
      detail: nextQueuedAction.nextAction,
      label: nextQueuedAction.categoryLabel,
      source: "app-store-assets/RELEASE_BLOCKERS.json nextActionQueue"
    };
  }

  return {
    categoryId: null,
    checkId: null,
    label: "Run strict preflight",
    command: "npm run release:store:preflight",
    detail: "Run the release-machine umbrella command after public values and signing assets are available.",
    source: "fallback"
  };
}

function summarizeCategories(blockers) {
  return (blockers.categories ?? []).map((category) => ({
    id: category.id,
    label: category.label,
    status: category.status,
    blockerCount: category.blockerCount ?? 0,
    blockedChecks: (category.checks ?? [])
      .filter((check) => check.status === "blocked")
      .map((check) => ({
        id: check.id,
        label: check.label,
        action: check.action,
        evidence: check.evidence
      }))
  }));
}

function renderHtml(dashboard) {
  const categoryCards = dashboard.categories
    .map(
      (category) => `<section class="card">
        <div class="card-top">
          <span class="kicker">${escapeHtml(category.id)}</span>
          <span class="pill ${category.blockerCount > 0 ? "blocked" : "ready"}">${escapeHtml(category.status)}</span>
        </div>
        <h2>${escapeHtml(category.label)}</h2>
        <p>${category.blockerCount} blocker${category.blockerCount === 1 ? "" : "s"}</p>
        <ul>
          ${
            category.blockedChecks.length > 0
              ? category.blockedChecks.map((check) => `<li>${escapeHtml(check.label)}<br><span>${escapeHtml(check.action)}</span></li>`).join("")
              : "<li>No blockers recorded.</li>"
          }
        </ul>
      </section>`
    )
    .join("\n");
  const artifactRows = dashboard.artifacts
    .map((artifact) => `<tr><td>${escapeHtml(artifact.name)}</td><td>${escapeHtml(artifact.status)}</td><td>${escapeHtml(artifact.detail)}</td></tr>`)
    .join("\n");
  const mas = dashboard.masSubmission ?? {};

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cody Cartridge Release Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #0b0c0d; color: #e8edf0; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #0b0c0d 0%, #101314 100%); }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; }
    header { border: 1px solid #41515a; padding: 18px 20px; background: #111415; box-shadow: inset 0 0 0 1px #101112; }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 24px; }
    h2 { font-size: 15px; margin-top: 10px; }
    p { color: #9facb3; line-height: 1.55; }
    code { color: #f4f0e8; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
    .stat, .card, .next, table { border: 1px solid #2d3a40; background: rgba(17, 20, 21, 0.9); }
    .stat { padding: 14px; }
    .stat strong { display: block; font-size: 24px; color: #f4f0e8; }
    .stat span, .kicker { color: #8fb5c7; font-size: 11px; text-transform: uppercase; }
    .next { margin-top: 18px; padding: 16px; border-color: #7b1d29; box-shadow: inset 4px 0 0 #9f1021; }
    .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
    .card { padding: 14px; min-height: 190px; }
    .card-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .pill { border: 1px solid #5b6870; padding: 3px 7px; font-size: 10px; text-transform: uppercase; }
    .pill.blocked { border-color: #9f1021; color: #ffb3bc; }
    .pill.ready { border-color: #547260; color: #b9e1c2; }
    ul { margin: 12px 0 0; padding-left: 18px; color: #d4dbde; }
    li { margin: 8px 0; }
    li span { color: #8e9aa0; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { text-align: left; border-bottom: 1px solid #263238; padding: 10px; vertical-align: top; }
    th { color: #8fb5c7; font-size: 11px; text-transform: uppercase; }
    @media (max-width: 860px) { main { padding: 16px; } .grid, .cards { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="kicker">Cody Cartridge // Release Operator Dashboard</div>
      <h1>${escapeHtml(dashboard.app.name)} ${escapeHtml(dashboard.app.version)} (${escapeHtml(dashboard.app.buildVersion)})</h1>
      <p>Generated ${escapeHtml(dashboard.generatedAt)}. This dashboard is redacted and safe for the handoff archive.</p>
    </header>
    <section class="grid" aria-label="Release status">
      <div class="stat"><span>Release blockers</span><strong>${dashboard.summary.releaseBlockers}</strong></div>
      <div class="stat"><span>Public inputs ready</span><strong>${dashboard.summary.publicInputsReady}/${dashboard.summary.publicInputsRequired}</strong></div>
      <div class="stat"><span>Final checklist blockers</span><strong>${dashboard.summary.finalChecklistBlockers}</strong></div>
      <div class="stat"><span>MAS posture</span><strong>${escapeHtml(mas.mode ?? "unknown")}</strong></div>
    </section>
    <section class="next">
      <div class="kicker">MAS submission posture</div>
      <h2>${mas.submissionReady ? "Signed package ready" : "Not ready for upload"}</h2>
      <p>Bundle: <code>${escapeHtml(mas.bundlePath ?? "missing")}</code>. Embedded profile: ${mas.hasEmbeddedProvisioningProfile ? "present" : "missing"}. Code signature: ${mas.codeSignatureVerified ? "verified" : "not verified"}. Signed upload packages: ${escapeHtml(`${mas.signedUploadPackageCount ?? 0}/${mas.uploadPackageCount ?? 0}`)}. Signed current-version packages: ${escapeHtml(`${mas.signedCurrentVersionUploadPackageCount ?? 0}/${mas.uploadPackageCount ?? 0}`)}.</p>
    </section>
    <section class="next">
      <div class="kicker">Next release-machine move</div>
      <h2>${escapeHtml(dashboard.nextAction.label)}</h2>
      <p>${escapeHtml(dashboard.nextAction.detail)}</p>
      <code>${escapeHtml(dashboard.nextAction.command)}</code>
    </section>
    <section class="cards" aria-label="Blocker categories">
      ${categoryCards}
    </section>
    <table>
      <thead><tr><th>Artifact</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>${artifactRows}</tbody>
    </table>
  </main>
</body>
</html>
`;
}

function main() {
  const pkg = readJson("package.json");
  const blockers = readJson("app-store-assets/RELEASE_BLOCKERS.json", { summary: {}, categories: [] });
  const publicInputs = readJson("app-store-assets/PUBLIC_RELEASE_INPUTS.json", { summary: {} });
  const publishPacket = readJson("app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json", { summary: {} });
  const uploadPacket = readJson("app-store-assets/UPLOAD_COMMAND_PACKET.json", { summary: {} });
  const finalChecklist = readJson("app-store-assets/FINAL_SUBMISSION_CHECKLIST.json", { summary: {} });
  const machineReport = readJson("app-store-assets/RELEASE_MACHINE_REPORT.json", { summary: {} });
  const evidence = readJson("app-store-assets/RELEASE_EVIDENCE.json", { commands: [], artifacts: [] });
  const dashboard = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName ?? pkg.name,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion: pkg.build?.buildVersion ?? pkg.version
    },
    summary: {
      status: statusLabel(blockers.summary?.blockerCount ?? 0),
      releaseBlockers: blockers.summary?.blockerCount ?? 0,
      readyForStrictPreflight: Boolean(blockers.summary?.readyForStrictPreflight),
      publicInputsReady: publicInputs.summary?.readyCount ?? 0,
      publicInputsRequired: publicInputs.summary?.requiredCount ?? 0,
      publicInputsBlocked: publicInputs.summary?.blockerCount ?? 0,
      publishPacketStatus: publishPacket.summary?.publishStatus ?? "missing",
      publishPacketReadyPages: publishPacket.summary?.readyPageCount ?? 0,
      publishPacketRequiredPages: publishPacket.summary?.requiredPageCount ?? 0,
      uploadPacketStatus: uploadPacket.summary?.status ?? "missing",
      uploadPacketSignedPackages: uploadPacket.summary?.signedUploadPackageCount ?? 0,
      uploadPacketAvailableTools: uploadPacket.summary?.availableToolCount ?? 0,
      finalChecklistBlockers: finalChecklist.summary?.blockerCount ?? 0,
      machineReportBlockedGates: machineReport.summary?.blockedGateCount ?? 0,
      machineReportWarningGates: machineReport.summary?.warningGateCount ?? 0,
      evidenceCommands: evidence.commands?.length ?? 0,
      evidenceArtifacts: evidence.artifacts?.length ?? 0,
      masSubmissionReady: evidence.masSubmission?.submissionReady === true
    },
    masSubmission: {
      mode: evidence.masSubmission?.mode ?? "unknown",
      submissionReady: evidence.masSubmission?.submissionReady === true,
      localRehearsalOnly: evidence.masSubmission?.localRehearsalOnly === true,
      bundlePath: evidence.masSubmission?.bundlePath ?? "dist/mas-arm64/Cody Cartridge.app",
      hasBundle: evidence.masSubmission?.hasBundle === true,
      hasEmbeddedProvisioningProfile: evidence.masSubmission?.hasEmbeddedProvisioningProfile === true,
      codeSignatureVerified: evidence.masSubmission?.codeSignatureVerified === true,
      uploadPackageCount: Number(evidence.masSubmission?.uploadPackageCount ?? 0),
      signedUploadPackageCount: Number(evidence.masSubmission?.signedUploadPackageCount ?? 0),
      currentVersionUploadPackageCount: Number(evidence.masSubmission?.currentVersionUploadPackageCount ?? 0),
      signedCurrentVersionUploadPackageCount: Number(evidence.masSubmission?.signedCurrentVersionUploadPackageCount ?? 0),
      hasSignedUploadPackage: evidence.masSubmission?.hasSignedUploadPackage === true,
      hasCurrentVersionUploadPackage: evidence.masSubmission?.hasCurrentVersionUploadPackage === true,
      hasSignedCurrentVersionUploadPackage: evidence.masSubmission?.hasSignedCurrentVersionUploadPackage === true
    },
    nextAction: nextActionFromBlockers(blockers),
    categories: summarizeCategories(blockers),
    artifacts: [
      {
        name: "PUBLIC_RELEASE_INPUTS.md",
        status: publicInputs.summary?.readyForPublicInputs ? "ready" : "blocked",
        detail: `${publicInputs.summary?.readyCount ?? 0}/${publicInputs.summary?.requiredCount ?? 0} public inputs ready`
      },
      {
        name: "PUBLIC_SITE_PUBLISH_PACKET.md",
        status: publishPacket.summary?.publishStatus ?? "missing",
        detail: `${publishPacket.summary?.readyPageCount ?? 0}/${publishPacket.summary?.requiredPageCount ?? 0} public pages ready`
      },
      {
        name: "FINAL_SUBMISSION_CHECKLIST.md",
        status: finalChecklist.summary?.readyForAddForReview ? "ready" : "blocked",
        detail: `${finalChecklist.summary?.blockerCount ?? 0} final checklist blocker(s)`
      },
      {
        name: "UPLOAD_COMMAND_PACKET.md",
        status: uploadPacket.summary?.status ?? "missing",
        detail: `${uploadPacket.summary?.signedUploadPackageCount ?? 0} signed package(s), ${uploadPacket.summary?.availableToolCount ?? 0}/${uploadPacket.summary?.toolCount ?? 0} upload tools`
      },
      {
        name: "RELEASE_MACHINE_REPORT.md",
        status: (machineReport.summary?.blockedGateCount ?? 0) > 0 ? "blocked" : "present",
        detail: `${machineReport.summary?.blockedGateCount ?? 0} blocked gate(s), ${machineReport.summary?.warningGateCount ?? 0} warning gate(s)`
      },
      {
        name: "RELEASE_EVIDENCE.md",
        status: (evidence.commands?.length ?? 0) > 0 ? "present" : "missing",
        detail: `${evidence.commands?.length ?? 0} command summaries, ${evidence.artifacts?.length ?? 0} artifact hashes`
      },
      {
        name: "MAS submission posture",
        status: evidence.masSubmission?.submissionReady ? "ready" : "blocked",
        detail: `${evidence.masSubmission?.mode ?? "unknown"} · signed current-version packages ${evidence.masSubmission?.signedCurrentVersionUploadPackageCount ?? 0}/${evidence.masSubmission?.uploadPackageCount ?? 0}`
      }
    ],
    sourceArtifacts: [
      "app-store-assets/RELEASE_BLOCKERS.json",
      "app-store-assets/PUBLIC_RELEASE_INPUTS.json",
      "app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json",
      "app-store-assets/UPLOAD_COMMAND_PACKET.json",
      "app-store-assets/FINAL_SUBMISSION_CHECKLIST.json",
      "app-store-assets/RELEASE_MACHINE_REPORT.json",
      "app-store-assets/RELEASE_EVIDENCE.json"
    ]
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(dashboard, null, 2)}\n`);
  fs.writeFileSync(outputHtml, renderHtml(dashboard));

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputHtml)}`);

  if (dashboard.summary.releaseBlockers > 0) {
    console.warn(`Release dashboard records ${dashboard.summary.releaseBlockers} blocker(s).`);
  }
}

main();
