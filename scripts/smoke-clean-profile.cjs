#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const distIndexPath = path.join(projectRoot, "dist", "index.html");
const electronBinary = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const timeoutMs = 20000;

function trimOutput(value) {
  const maxLength = 12000;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... output truncated ...` : value;
}

async function main() {
  if (!fs.existsSync(distIndexPath)) {
    throw new Error("dist/index.html is missing. Run npm run build before smoke:clean-profile.");
  }

  if (!fs.existsSync(electronBinary)) {
    throw new Error("Electron binary is missing. Run npm install before smoke:clean-profile.");
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cody-clean-profile-"));
  const userDataPath = path.join(tempRoot, "user-data");

  try {
    const child = spawn(electronBinary, ["."], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CODY_FORCE_DIST: "1",
        CODY_SHELL_SMOKE: "1",
        CODY_SHELL_SMOKE_RESET_PROBE: "1",
        CODY_SHELL_SMOKE_USER_DATA_DIR: userDataPath,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code));
    });

    clearTimeout(timeout);

    if (timedOut) {
      throw new Error(`Clean-profile smoke timed out after ${timeoutMs}ms.\n${trimOutput(stdout)}\n${trimOutput(stderr)}`);
    }

    if (exitCode !== 0) {
      throw new Error(`Clean-profile smoke exited with code ${exitCode}.\n${trimOutput(stdout)}\n${trimOutput(stderr)}`);
    }

    if (!stdout.includes("clean profile reset probe: passed")) {
      throw new Error(`Clean-profile smoke did not report the reset probe pass marker.\n${trimOutput(stdout)}\n${trimOutput(stderr)}`);
    }

    const bookmarkStorePath = path.join(userDataPath, "security-scoped-bookmarks.json");

    if (fs.existsSync(bookmarkStorePath)) {
      throw new Error("Clean-profile smoke left security-scoped-bookmarks.json behind after reset.");
    }

    console.log("Clean-profile smoke checks: passed");
    console.log(`- isolated userData: ${userDataPath}`);
    console.log("- renderer local storage reset: passed");
    console.log("- security-scoped bookmark reset: passed");

    if (stderr.trim()) {
      console.warn(stderr.trim());
    }
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
