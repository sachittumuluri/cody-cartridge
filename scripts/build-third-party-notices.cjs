#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "THIRD_PARTY_NOTICES.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "THIRD_PARTY_NOTICES.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);

  if (index === -1) {
    return lockPath;
  }

  const remaining = lockPath.slice(index + marker.length);
  const parts = remaining.split("/");

  if (parts[0]?.startsWith("@")) {
    return `${parts[0]}/${parts[1]}`;
  }

  return parts[0];
}

function normalizeLicense(value) {
  if (!value) {
    return "UNKNOWN";
  }

  if (Array.isArray(value)) {
    return value.map(normalizeLicense).join(" OR ");
  }

  if (typeof value === "object") {
    return value.type || JSON.stringify(value);
  }

  return String(value).replace(/\s+/g, " ").trim() || "UNKNOWN";
}

function readInstalledPackageJson(lockPath) {
  const packagePath = path.join(projectRoot, lockPath, "package.json");

  if (!fs.existsSync(packagePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return {};
  }
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function main() {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const root = lock.packages?.[""] ?? {};
  const directRuntime = new Set(Object.keys(root.dependencies ?? {}));
  const directDevelopment = new Set(Object.keys(root.devDependencies ?? {}));

  const packages = Object.entries(lock.packages ?? {})
    .filter(([lockPath]) => lockPath.startsWith("node_modules/"))
    .map(([lockPath, entry]) => {
      const name = packageNameFromLockPath(lockPath);
      const installed = readInstalledPackageJson(lockPath);
      const relationship = directRuntime.has(name)
        ? "direct runtime"
        : directDevelopment.has(name)
          ? "direct development/build"
          : entry.dev
            ? "transitive development/build"
            : "transitive runtime";

      return {
        name,
        version: entry.version || installed.version || "UNKNOWN",
        license: normalizeLicense(entry.license || installed.license || installed.licenses),
        relationship,
        lockPath,
        homepage: installed.homepage || null,
        repository:
          typeof installed.repository === "string"
            ? installed.repository
            : installed.repository?.url || null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.lockPath.localeCompare(b.lockPath));

  const licenseCounts = packages.reduce((counts, item) => {
    counts[item.license] = (counts[item.license] ?? 0) + 1;
    return counts;
  }, {});

  const relationshipCounts = packages.reduce((counts, item) => {
    counts[item.relationship] = (counts[item.relationship] ?? 0) + 1;
    return counts;
  }, {});

  const notices = {
    generatedAt: new Date().toISOString(),
    app: {
      name: pkg.build?.productName,
      bundleId: pkg.build?.appId,
      version: pkg.version
    },
    summary: {
      totalPackages: packages.length,
      licenseCounts,
      relationshipCounts,
      unknownLicenseCount: packages.filter((item) => item.license === "UNKNOWN").length
    },
    directRuntime: packages.filter((item) => item.relationship === "direct runtime"),
    directDevelopment: packages.filter((item) => item.relationship === "direct development/build"),
    packages
  };

  const directRuntimeLines = notices.directRuntime.map(
    (item) => `${item.name} ${item.version} - ${item.license}`
  );
  const directDevelopmentLines = notices.directDevelopment.map(
    (item) => `${item.name} ${item.version} - ${item.license}`
  );
  const licenseSummaryLines = Object.entries(licenseCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([license, count]) => `${license}: ${count}`);
  const packageLines = packages.map(
    (item) => `${item.name} ${item.version} - ${item.license} - ${item.relationship}`
  );

  const markdown = `# Cody Cartridge Third-Party Notices

Last generated: ${notices.generatedAt}

Cody Cartridge uses open-source packages for its local macOS player, build tooling, and release pipeline. This inventory is generated from \`package-lock.json\` and should be regenerated before App Store upload.

## App

- Name: ${notices.app.name}
- Bundle ID: ${notices.app.bundleId}
- Version: ${notices.app.version}

## Summary

- Total packages in lockfile: ${notices.summary.totalPackages}
- Packages with unknown license metadata: ${notices.summary.unknownLicenseCount}

## License Counts

${bulletList(licenseSummaryLines)}

## Direct Runtime Dependencies

${bulletList(directRuntimeLines)}

## Direct Development And Build Dependencies

${bulletList(directDevelopmentLines)}

## Full Package Inventory

${bulletList(packageLines)}
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(notices, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (notices.summary.unknownLicenseCount > 0) {
    console.warn(`${notices.summary.unknownLicenseCount} packages have unknown license metadata.`);
  }
}

main();
