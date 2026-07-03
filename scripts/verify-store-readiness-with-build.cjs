#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");

function toRelative(filePath) {
  return path.relative(projectRoot, filePath);
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function isInside(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function walkFiles(rootPath, visitor) {
  if (!exists(rootPath)) {
    return;
  }

  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    entries.forEach((entry) => {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        return;
      }

      if (entry.isFile()) {
        visitor(entryPath);
      }
    });
  }
}

function collectPreservedArtifacts() {
  if (!exists(distRoot)) {
    return [];
  }

  const artifactPaths = [];

  fs.readdirSync(distRoot, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(distRoot, entry.name);

    if (entry.isDirectory() && /^mas(?:-|$)/i.test(entry.name)) {
      artifactPaths.push(entryPath);
    }

    if (entry.isFile() && entry.name.endsWith(".pkg")) {
      artifactPaths.push(entryPath);
    }
  });

  walkFiles(distRoot, (filePath) => {
    if (filePath.endsWith(".pkg")) {
      artifactPaths.push(filePath);
    }
  });

  const sorted = [...new Set(artifactPaths)].sort((left, right) => left.length - right.length);
  const rootsOnly = [];

  sorted.forEach((artifactPath) => {
    if (!rootsOnly.some((rootPath) => artifactPath === rootPath || isInside(artifactPath, rootPath))) {
      rootsOnly.push(artifactPath);
    }
  });

  return rootsOnly.map(toRelative);
}

function copyArtifact(sourceRoot, destinationRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  const destination = path.join(destinationRoot, relativePath);

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    force: true,
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true
  });
}

function snapshotArtifacts(tempRoot, relativePaths) {
  relativePaths.forEach((relativePath) => {
    copyArtifact(projectRoot, tempRoot, relativePath);
  });
}

function restoreArtifacts(tempRoot, relativePaths) {
  relativePaths.forEach((relativePath) => {
    const snapshotPath = path.join(tempRoot, relativePath);
    const restorePath = path.join(projectRoot, relativePath);

    if (!exists(snapshotPath)) {
      return;
    }

    fs.rmSync(restorePath, { force: true, recursive: true });
    copyArtifact(tempRoot, projectRoot, relativePath);
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  return result.status ?? (result.error ? 1 : 0);
}

function main() {
  const verifierArgs = process.argv.slice(2);
  const artifacts = collectPreservedArtifacts();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cody-store-verify-"));
  let buildStatus = 0;

  try {
    if (artifacts.length > 0) {
      snapshotArtifacts(tempRoot, artifacts);
      console.log(`Preserving ${artifacts.length} MAS artifact(s) across renderer build.`);
    }

    buildStatus = run("npm", ["run", "build"]);
  } finally {
    restoreArtifacts(tempRoot, artifacts);
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }

  if (buildStatus !== 0) {
    process.exitCode = buildStatus;
    return;
  }

  process.exitCode = run(process.execPath, ["scripts/verify-store-readiness.cjs", ...verifierArgs]);
}

main();
