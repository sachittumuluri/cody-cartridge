#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const releaseNodeVersionPath = path.join(projectRoot, ".nvmrc");
const releaseNodeVersion = fs.existsSync(releaseNodeVersionPath) ? fs.readFileSync(releaseNodeVersionPath, "utf8").trim() : "22";
const commandArgs = process.argv.slice(2);

function usage() {
  return `Usage:
  npm run release:node -- npm run check:release-runtime -- --strict
  npm run release:node -- npm run release:store:preflight

Runs a command through the Node version selected by .nvmrc without changing your global nvm default.`;
}

function nodeMajor(version) {
  return Number(String(version).replace(/^v/, "").split(".")[0]);
}

function isReleaseRuntime(version) {
  const major = nodeMajor(version);

  return major >= 20 && major < 25;
}

function runDirect(args) {
  return spawnSync(args[0], args.slice(1), {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit"
  });
}

function runWithNvm(args) {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  const nvmScript = path.join(nvmDir, "nvm.sh");

  if (!fs.existsSync(nvmScript)) {
    console.error(`FAIL nvm is not available at ${nvmScript}. Install Node ${releaseNodeVersion} or run nvm from a configured shell.`);
    return { status: 1 };
  }

  return spawnSync(
    "zsh",
    [
      "-lc",
      'source "$NVM_DIR/nvm.sh" && nvm exec "$RELEASE_NODE_VERSION" "$@"',
      "run-release-node",
      ...args
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NVM_DIR: nvmDir,
        RELEASE_NODE_VERSION: releaseNodeVersion
      },
      stdio: "inherit"
    }
  );
}

function main() {
  if (commandArgs.length === 0 || commandArgs.includes("--help") || commandArgs.includes("-h")) {
    console.log(usage());
    process.exitCode = commandArgs.length === 0 ? 1 : 0;
    return;
  }

  const result = isReleaseRuntime(process.version) ? runDirect(commandArgs) : runWithNvm(commandArgs);

  if (typeof result.status === "number") {
    process.exitCode = result.status;
    return;
  }

  if (result.error) {
    console.error(`FAIL Unable to run release-node command: ${result.error.message}`);
    process.exitCode = 1;
  }
}

main();
