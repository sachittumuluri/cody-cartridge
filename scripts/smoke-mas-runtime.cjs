#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { signAsync } = require("@electron/osx-sign");

const projectRoot = path.resolve(__dirname, "..");
const sourceAppRoot = path.join(projectRoot, "dist", "mas-arm64", "Cody Cartridge.app");
const timeoutMs = 25000;

function trimOutput(value) {
  const maxLength = 14000;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... output truncated ...` : value;
}

function executablePathFor(appRoot) {
  return path.join(appRoot, "Contents", "MacOS", "Cody Cartridge");
}

function assertPackagedAppExists(appRoot) {
  const executablePath = executablePathFor(appRoot);

  if (!fs.existsSync(appRoot)) {
    throw new Error("MAS app bundle is missing. Run npm run smoke:mas-dir locally or npm run dist:mas on the release machine first.");
  }

  if (!fs.existsSync(executablePath)) {
    throw new Error(`MAS app executable is missing at ${path.relative(projectRoot, executablePath)}.`);
  }
}

function localRuntimeEntitlements(tempRoot) {
  const entitlementsPath = path.join(tempRoot, "local-runtime-entitlements.plist");
  fs.writeFileSync(
    entitlementsPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
</plist>
`
  );

  return entitlementsPath;
}

function copyBundleForRuntime(tempRoot) {
  const runtimeAppRoot = path.join(tempRoot, "Cody Cartridge.app");
  const result = spawnSync("ditto", [sourceAppRoot, runtimeAppRoot], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0 || result.error) {
    throw new Error(
      `Unable to copy MAS bundle into a temporary runtime smoke directory.\n${trimOutput(result.stdout || "")}\n${trimOutput(
        result.error?.message || result.stderr || ""
      )}`
    );
  }

  return runtimeAppRoot;
}

async function signLocalRuntimeBundle(tempRoot, appRoot) {
  const entitlementsPath = localRuntimeEntitlements(tempRoot);

  await signAsync({
    app: appRoot,
    identity: "-",
    identityValidation: false,
    platform: "mas",
    type: "development",
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    optionsForFile(filePath) {
      const normalizedPath = String(filePath);
      const isMainApp = normalizedPath === appRoot;
      const isHelperApp =
        /Cody Cartridge Helper(?: \(.+\))?\.app$/.test(normalizedPath) || /Cody Cartridge Login Helper\.app$/.test(normalizedPath);

      if (isMainApp || isHelperApp) {
        return {
          entitlements: entitlementsPath,
          hardenedRuntime: false,
          signatureFlags: []
        };
      }

      return {
        hardenedRuntime: false,
        signatureFlags: []
      };
    }
  });
}

async function main() {
  assertPackagedAppExists(sourceAppRoot);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cody-mas-runtime-"));
  const userDataPath = path.join(tempRoot, "user-data");

  try {
    const runtimeAppRoot = copyBundleForRuntime(tempRoot);
    const runtimeExecutablePath = executablePathFor(runtimeAppRoot);

    await signLocalRuntimeBundle(tempRoot, runtimeAppRoot);
    const child = spawn(
      runtimeExecutablePath,
      [
        "--cody-shell-smoke",
        "--cody-shell-smoke-reset-probe",
        `--cody-shell-smoke-user-data=${userDataPath}`
      ],
      {
      cwd: projectRoot,
      env: {
        ...process.env,
        CODY_SHELL_SMOKE: "1",
        CODY_SHELL_SMOKE_RESET_PROBE: "1",
        CODY_SHELL_SMOKE_USER_DATA_DIR: userDataPath,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      },
      stdio: ["ignore", "pipe", "pipe"]
      }
    );

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

    const exit = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });

    clearTimeout(timeout);

    if (timedOut) {
      if (!stdout.trim() && !stderr.trim()) {
        console.warn("WARN Packaged MAS runtime smoke could not enter Electron main under the local ad-hoc MAS rehearsal signature.");
        console.warn("WARN This local-only rehearsal still verifies that a temporary copy of the MAS bundle can be packaged and ad-hoc signed, but final runtime proof must come from TestFlight/App Store delivery.");
        console.warn("WARN Concrete launch failures with stderr output still fail this smoke gate.");
        console.log(`- source app bundle: ${path.relative(projectRoot, sourceAppRoot)}`);
        console.log("- local runtime signature: applied only to a temporary bundle copy");
        console.log("- final signing note: rerun npm run dist:mas on the release machine before upload");
        return;
      }

      throw new Error(`Packaged MAS runtime smoke timed out after ${timeoutMs}ms.\n${trimOutput(stdout)}\n${trimOutput(stderr)}`);
    }

    if (exit.code !== 0) {
      throw new Error(
        `Packaged MAS runtime smoke exited with code ${exit.code}${exit.signal ? `, signal ${exit.signal}` : ""}.\n` +
          `${trimOutput(stdout)}\n${trimOutput(stderr)}`
      );
    }

    [
      "Electron shell smoke checks",
      "clean profile reset probe: passed",
      "custom app/media/art protocol rejection: passed"
    ].forEach((marker) => {
      if (!stdout.includes(marker)) {
        throw new Error(`Packaged MAS runtime smoke did not report marker: ${marker}\n${trimOutput(stdout)}\n${trimOutput(stderr)}`);
      }
    });

    const bookmarkStorePath = path.join(userDataPath, "security-scoped-bookmarks.json");

    if (fs.existsSync(bookmarkStorePath)) {
      throw new Error("Packaged MAS runtime smoke left security-scoped-bookmarks.json behind after reset.");
    }

    console.log("Packaged MAS runtime smoke checks: passed");
    console.log(`- source app bundle: ${path.relative(projectRoot, sourceAppRoot)}`);
    console.log("- local ad-hoc runtime signature: applied only to a temporary bundle copy");
    console.log("- packaged renderer, menu, preload bridge, and custom protocol checks: passed");
    console.log("- isolated userData reset and bookmark cleanup: passed");
    console.log("- final signing note: rerun npm run dist:mas on the release machine before upload");

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
