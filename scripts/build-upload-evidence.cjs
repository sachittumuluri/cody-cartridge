#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "UPLOAD_EVIDENCE.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "UPLOAD_EVIDENCE.md");
const homeDir = os.homedir();

function usage() {
  return `Usage:
  npm run upload-evidence:store
  npm run upload-evidence:store -- --log /path/to/transporter.log --tool transporter --status uploaded
  npm run upload-evidence:store -- --log /path/to/transporter.log --tool transporter --status selected --processed-bundle-id com.sachittumuluri.codycartridge --processed-version 0.1.0 --processed-build 0.1.0

Records sanitized App Store upload/build-processing evidence without storing raw delivery logs, Apple account values, API keys, or local paths.`;
}

function readJson(relativePath, fallback = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath) ? JSON.parse(fs.readFileSync(absolutePath, "utf8")) : fallback;
}

function parseArgs(argv) {
  const options = {
    logs: [],
    processedBuild: {
      bundleId: "",
      version: "",
      buildVersion: ""
    },
    status: "pending",
    tool: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    if (arg === "--log") {
      const value = argv[index + 1];
      index += 1;

      if (!value) {
        throw new Error("--log requires a path.");
      }

      options.logs.push(value);
      continue;
    }

    if (arg === "--tool") {
      options.tool = readValue(argv, index, "--tool");
      index += 1;
      continue;
    }

    if (arg === "--status") {
      options.status = readValue(argv, index, "--status");
      index += 1;
      continue;
    }

    if (arg === "--processed-bundle-id") {
      options.processedBuild.bundleId = readValue(argv, index, "--processed-bundle-id");
      index += 1;
      continue;
    }

    if (arg === "--processed-version") {
      options.processedBuild.version = readValue(argv, index, "--processed-version");
      index += 1;
      continue;
    }

    if (arg === "--processed-build") {
      options.processedBuild.buildVersion = readValue(argv, index, "--processed-build");
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function readValue(argv, index, name) {
  const value = argv[index + 1];

  if (!value) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function classifyTool(value, logName) {
  const normalized = String(value || logName || "").toLowerCase();

  if (normalized.includes("transporter")) {
    return "transporter";
  }

  if (normalized.includes("altool")) {
    return "altool";
  }

  if (normalized.includes("xcode")) {
    return "xcode";
  }

  return value ? "other" : "unspecified";
}

function sanitizeLine(line) {
  return String(line)
    .replaceAll(projectRoot, "<project>")
    .replaceAll(homeDir, "~")
    .replace(/([A-Z0-9._%+-])[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})/gi, "$1***$2")
    .replace(/(\+?\d)[\d ().-]{5,}(\d{2})/g, "$1***$2")
    .replace(/\b(?:api[_-]?key|issuer[_-]?id|key[_-]?id|token|password|secret|authorization)\s*[:=]\s*["']?[^"',\s]+/gi, "$1=<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>")
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi, "<redacted private key>")
    .replace(/Apple (?:Distribution|Development|Mac Distribution|Mac App Distribution|Mac Installer Distribution):[^\n]+/gi, "Apple signing identity: <redacted>")
    .replace(/\/[^ "'\n]*(?:\.p8|\.p12|\.cer|\.mobileprovision|\.provisionprofile)\b/gi, "<redacted-secret-file>")
    .trim();
}

function interestingLine(line) {
  return /upload|delivery|delivered|processing|processed|warning|error|fail|success|bundle|version|build|com\.sachittumuluri\.codycartridge/i.test(
    line
  );
}

function summarizeLog(filePath, tool) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error("Upload log file does not exist.");
  }

  const stat = fs.lstatSync(absolutePath);

  if (stat.isSymbolicLink()) {
    throw new Error("Upload log file must not be a symlink.");
  }

  if (!stat.isFile()) {
    throw new Error("Upload log path must be a regular file.");
  }

  const bytes = fs.readFileSync(absolutePath);
  const text = bytes.toString("utf8");
  const lines = text
    .split(/\r?\n/)
    .map(sanitizeLine)
    .filter(Boolean);
  const sanitizedInterestingLines = lines.filter(interestingLine).slice(-80);

  return {
    label: path.basename(absolutePath),
    tool: classifyTool(tool, path.basename(absolutePath)),
    rawSha256: sha256(bytes),
    sizeBytes: stat.size,
    lineCount: lines.length,
    sanitizedLineCount: sanitizedInterestingLines.length,
    sanitizedInterestingLines
  };
}

function statusFor(options) {
  const allowed = new Set(["pending", "uploaded", "processing", "processed", "selected", "blocked"]);

  if (!allowed.has(options.status)) {
    throw new Error("--status must be one of pending, uploaded, processing, processed, selected, blocked.");
  }

  return options.status;
}

function renderMarkdown(evidence) {
  const logRows =
    evidence.logs.length > 0
      ? evidence.logs
          .map(
            (item) =>
              `| ${item.label} | ${item.tool} | ${item.lineCount} | ${item.sanitizedLineCount} | \`${item.rawSha256}\` |`
          )
          .join("\n")
      : "| None | pending | 0 | 0 | - |";
  const snippets =
    evidence.logs.length > 0
      ? evidence.logs
          .map((item) => `### ${item.label}\n\n${item.sanitizedInterestingLines.map((line) => `- ${line}`).join("\n") || "- No upload/build-processing lines captured after sanitization."}`)
          .join("\n\n")
      : "No upload logs have been attached yet.";

  return `# Cody Cartridge Upload Evidence

Generated by \`npm run upload-evidence:store\`.

## Candidate

- App: ${evidence.app.name}
- Bundle ID: \`${evidence.app.bundleId}\`
- Version: ${evidence.app.version}
- Build version: ${evidence.app.buildVersion}
- Upload status: ${evidence.upload.status}
- Processed bundle ID: ${evidence.processedBuild.bundleId || "pending"}
- Processed version: ${evidence.processedBuild.version || "pending"}
- Processed build: ${evidence.processedBuild.buildVersion || "pending"}
- Processed build matches package: ${evidence.processedBuild.matchesPackage ? "yes" : "pending/no"}

## Build Selection Proof

- App Store Connect location: ${evidence.buildSelection.appStoreConnectLocation}
- Required selected status: ${evidence.buildSelection.requiredStatus}
- Status records selected build: ${evidence.buildSelection.selectedInAppStoreConnect ? "yes" : "pending/no"}
- Processed build values present: ${evidence.buildSelection.hasProcessedBuildValues ? "yes" : "pending/no"}
- Delivery log summary present: ${evidence.buildSelection.hasDeliveryLogs ? "yes" : "pending/no"}
- Proof complete: ${evidence.buildSelection.proofComplete ? "yes" : "pending/no"}

Required proof:
${evidence.buildSelection.requiredProof.map((item) => `- ${item}`).join("\n")}

Post-selection commands:
${evidence.buildSelection.postSelectionCommands.map((command) => `- \`${command}\``).join("\n")}

## Sanitized Delivery Logs

| Log | Tool | Lines | Sanitized Lines | Raw SHA-256 |
| --- | --- | ---: | ---: | --- |
${logRows}

## Sanitized Upload/Processing Excerpts

${snippets}

## Redaction

- Raw delivery logs are not stored in this artifact.
- Local paths, emails, phone numbers, bearer tokens, API-key style values, private keys, signing identities, and signing/profile file paths are redacted from excerpts.
- Keep raw Transporter/altool/Xcode logs outside the handoff archive unless they have been reviewed for Apple account and credential material.
`;
}

function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const pkg = readJson("package.json");
  const buildVersion = pkg.build?.buildVersion ?? pkg.version;
  let logs;

  try {
    logs = options.logs.map((filePath) => summarizeLog(filePath, options.tool));
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  let status;

  try {
    status = statusFor(options);
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const processedBuild = {
    bundleId: options.processedBuild.bundleId,
    version: options.processedBuild.version,
    buildVersion: options.processedBuild.buildVersion,
    matchesPackage:
      options.processedBuild.bundleId === pkg.build?.appId &&
      options.processedBuild.version === pkg.version &&
      options.processedBuild.buildVersion === buildVersion
  };
  const hasProcessedBuildValues = Boolean(
    processedBuild.bundleId &&
      processedBuild.version &&
      processedBuild.buildVersion
  );
  const selectedInAppStoreConnect = status === "selected" && processedBuild.matchesPackage;
  const buildSelection = {
    appStoreConnectLocation: "App Store Connect > macOS app version > Build",
    requiredStatus: "selected",
    status,
    selectedInAppStoreConnect,
    hasProcessedBuildValues,
    hasDeliveryLogs: logs.length > 0,
    processedBuildMatchesPackage: processedBuild.matchesPackage,
    proofComplete: selectedInAppStoreConnect && logs.length > 0,
    requiredProof: [
      "Transporter/altool/Xcode delivery log summary is attached through --log.",
      "Upload status is recorded as --status selected after App Store Connect processing finishes.",
      "Processed bundle id, marketing version, and build version match package.json.",
      "The selected macOS app-version Build field in App Store Connect points at that processed build."
    ],
    postSelectionCommands: [
      "npm run check:upload-evidence -- --strict",
      "npm run evidence:store",
      "npm run manifest:store",
      "npm run handoff:store"
    ]
  };
  const evidence = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName ?? pkg.name,
      bundleId: pkg.build?.appId,
      version: pkg.version,
      buildVersion
    },
    upload: {
      status,
      logCount: logs.length,
      hasDeliveryLogs: logs.length > 0,
      hasProcessedBuildProof: processedBuild.matchesPackage
    },
    processedBuild,
    buildSelection,
    logs,
    redaction: {
      storesRawLogs: false,
      redactsLocalPaths: true,
      redactsEmailAddresses: true,
      redactsPhoneNumbers: true,
      redactsApiCredentials: true,
      redactsSigningMaterial: true
    },
    commands: [
      "npm run upload-evidence:store",
      "npm run check:upload-evidence",
      "npm run check:upload-evidence -- --strict",
      "npm run evidence:store",
      "npm run manifest:store",
      "npm run handoff:store"
    ]
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderMarkdown(evidence));
  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (logs.length === 0) {
    console.warn("Upload evidence has no delivery logs yet.");
  }
}

main();
