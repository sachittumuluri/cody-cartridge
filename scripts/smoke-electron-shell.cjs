#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const distIndexPath = path.join(projectRoot, "dist", "index.html");
const electronBinary = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const timeoutMs = 45000;

function createSmokeWavBuffer() {
  const sampleRate = 44100;
  // Long enough for the in-app playback probe to sample mid-play; 110Hz
  // sits inside the deck's 170Hz bass lowpass so the probe level registers.
  const durationSeconds = 3;
  const frequency = 110;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((index / sampleRate) * frequency * Math.PI * 2) * 0.22 * 32767);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }

  return buffer;
}

function writeSmokeAudioFixture() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "cody-shell-smoke-"));
  const fixturePath = path.join(fixtureDir, "Smoke Import Probe.wav");
  fs.writeFileSync(fixturePath, createSmokeWavBuffer());
  return { fixtureDir, fixturePath };
}

function trimOutput(value) {
  const maxLength = 12000;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... output truncated ...` : value;
}

async function main() {
  if (!fs.existsSync(distIndexPath)) {
    throw new Error("dist/index.html is missing. Run npm run build before smoke:electron-shell.");
  }

  if (!fs.existsSync(electronBinary)) {
    throw new Error("Electron binary is missing. Run npm install before smoke:electron-shell.");
  }

  const { fixtureDir, fixturePath } = writeSmokeAudioFixture();
  try {
    const child = spawn(electronBinary, ["."], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CODY_FORCE_DIST: "1",
        CODY_SHELL_SMOKE: "1",
        CODY_SHELL_SMOKE_AUDIO_PATH: fixturePath,
        // Keep smoke state (localStorage, play counts, bookmarks) out of
        // the developer's real app profile.
        CODY_SHELL_SMOKE_USER_DATA_DIR: path.join(fixtureDir, "user-data"),
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
      throw new Error(`Electron shell smoke timed out after ${timeoutMs}ms.\n${trimOutput(stdout)}\n${trimOutput(stderr)}`);
    }

    if (exitCode !== 0) {
      throw new Error(`Electron shell smoke exited with code ${exitCode}.\n${trimOutput(stdout)}\n${trimOutput(stderr)}`);
    }

    if (!stdout.includes("Electron shell smoke checks")) {
      throw new Error(`Electron shell smoke did not report its pass marker.\n${trimOutput(stdout)}\n${trimOutput(stderr)}`);
    }

    console.log(stdout.trim());

    if (stderr.trim()) {
      console.warn(stderr.trim());
    }
  } finally {
    fs.rmSync(fixtureDir, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
