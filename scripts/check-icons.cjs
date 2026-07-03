#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

const expectedPngs = new Map([
  ["build/icon.png", 1024],
  ["build/icon.iconset/icon_16x16.png", 16],
  ["build/icon.iconset/icon_16x16@2x.png", 32],
  ["build/icon.iconset/icon_32x32.png", 32],
  ["build/icon.iconset/icon_32x32@2x.png", 64],
  ["build/icon.iconset/icon_128x128.png", 128],
  ["build/icon.iconset/icon_128x128@2x.png", 256],
  ["build/icon.iconset/icon_256x256.png", 256],
  ["build/icon.iconset/icon_256x256@2x.png", 512],
  ["build/icon.iconset/icon_512x512.png", 512],
  ["build/icon.iconset/icon_512x512@2x.png", 1024]
]);

function absolute(relativePath) {
  return path.join(projectRoot, relativePath);
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function getPngSize(relativePath) {
  const output = run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", relativePath]);
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);

  return { height, width };
}

function main() {
  const failures = [];

  expectedPngs.forEach((expectedSize, relativePath) => {
    if (!fs.existsSync(absolute(relativePath))) {
      failures.push(`${relativePath} is missing`);
      return;
    }

    const { height, width } = getPngSize(relativePath);

    if (width !== expectedSize || height !== expectedSize) {
      failures.push(`${relativePath} is ${width}x${height}; expected ${expectedSize}x${expectedSize}`);
    }
  });

  if (!fs.existsSync(absolute("build/icon.icns"))) {
    failures.push("build/icon.icns is missing");
  } else {
    const fileOutput = run("file", ["build/icon.icns"]);

    if (!fileOutput.includes("Mac OS X icon")) {
      failures.push("build/icon.icns is not recognized as a macOS icon file");
    }
  }

  if (failures.length > 0) {
    failures.forEach((failure) => console.error(`FAIL ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(`Icon audit passed: ${expectedPngs.size} PNG files and build/icon.icns`);
}

main();
