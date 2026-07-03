#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const templateRelative = "app-store-assets/site.env.example";
const targetRelative = "app-store-assets/site.env";
const templatePath = path.join(projectRoot, templateRelative);
const targetPath = path.join(projectRoot, targetRelative);
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function main() {
  if (!fs.existsSync(templatePath)) {
    fail(`${templateRelative} is missing.`);
    return;
  }

  const template = fs.readFileSync(templatePath, "utf8");

  if (!template.includes("CODY_SITE_URL") || !template.includes("CODY_SUPPORT_EMAIL")) {
    fail(`${templateRelative} is missing required App Store environment keys.`);
    return;
  }

  const targetExists = fs.existsSync(targetPath);

  if (dryRun) {
    console.log("Store env initializer dry-run: ready");
    pass(`${templateRelative} exists`);
    pass(targetExists ? `${targetRelative} already exists and would be left unchanged` : `${targetRelative} can be created`);
    return;
  }

  if (targetExists && !force) {
    console.log(`Store env already exists at ${targetRelative}; leaving it unchanged.`);
    console.log("Edit that ignored file with the real public URL, support email, and App Review contact values, then run npm run check:store-env.");
    console.log("Optional: create app-store-assets/site.env.local for a private overlay; shell env values still take precedence.");
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, template, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(targetPath, 0o600);

  console.log(`Created ${targetRelative} from ${templateRelative}.`);
  console.log("Replace every placeholder value before running npm run release:store:preflight.");
  console.log("Optional: create app-store-assets/site.env.local for a private overlay; shell env values still take precedence.");
}

main();
