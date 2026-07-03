#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const electronBuilderBinary = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder"
);
const appRoot = path.join(projectRoot, "dist", "mas-arm64", "Cody Cartridge.app");
const appInfoPlist = path.join(appRoot, "Contents", "Info.plist");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function trimOutput(value) {
  const maxLength = 16000;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... output truncated ...` : value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

function warningLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("WARN "));
}

function isExpectedUnsignedMasWarning(line) {
  const message = line.replace(/^WARN\s+/, "");

  return [
    "Packaged MAS app does not contain Contents/embedded.provisionprofile",
    "No MAS upload .pkg artifact found in dist; Transporter upload expects a signed current-version installer package",
    "Packaged MAS app code signature does not verify"
  ].includes(message);
}

function main() {
  assert(fs.existsSync(electronBuilderBinary), "electron-builder binary is missing. Run npm install first.");

  fs.rmSync(path.dirname(appRoot), { force: true, recursive: true });

  const buildResult = run(electronBuilderBinary, ["--mac", "mas", "--dir"], {
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
    }
  });
  const buildOutput = combinedOutput(buildResult);
  const stoppedAtExpectedSigningBoundary =
    buildResult.status !== 0 &&
    buildOutput.includes("skipped macOS application code signing") &&
    buildOutput.includes("CSC_IDENTITY_AUTO_DISCOVERY=false");

  if (buildOutput.includes("ERR_REQUIRE_ESM")) {
    throw new Error(`electron-builder failed before packaging because a CommonJS dependency resolved to ESM.\n${trimOutput(buildOutput)}`);
  }

  if (buildResult.status !== 0 && !stoppedAtExpectedSigningBoundary) {
    throw new Error(`electron-builder MAS directory build failed before the expected signing boundary.\n${trimOutput(buildOutput)}`);
  }

  assert(fs.existsSync(appInfoPlist), "MAS directory build did not produce dist/mas-arm64/Cody Cartridge.app.");

  const packageCheck = run("node", ["scripts/check-mas-package.cjs"]);
  const packageOutput = combinedOutput(packageCheck);
  const unexpectedWarnings = warningLines(packageOutput).filter((line) => !isExpectedUnsignedMasWarning(line));

  if (packageCheck.status !== 0) {
    throw new Error(`MAS package boundary check failed after directory build.\n${trimOutput(packageOutput)}`);
  }

  if (unexpectedWarnings.length > 0) {
    throw new Error(
      `MAS package boundary check emitted unexpected advisory warnings during local rehearsal.\n${unexpectedWarnings.join("\n")}\n\n${trimOutput(packageOutput)}`
    );
  }

  console.log("MAS directory smoke checks: passed");
  console.log(`- electron-builder: ${buildResult.status === 0 ? "completed" : "stopped at expected signing boundary"}`);
  console.log("- unsigned MAS app bundle: present");
  console.log("- advisory MAS package boundary: passed");
  console.log("- advisory warnings: expected unsigned local signing/package warnings only");

  if (stoppedAtExpectedSigningBoundary) {
    console.log("- signing: intentionally skipped for local dry-run");
  }
}

main();
