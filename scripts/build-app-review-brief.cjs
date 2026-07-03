#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputJson = path.join(projectRoot, "app-store-assets", "APP_REVIEW_BRIEF.json");
const outputMarkdown = path.join(projectRoot, "app-store-assets", "APP_REVIEW_BRIEF.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function isFullUrl(value) {
  return /^https?:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(String(value ?? ""));
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
}

function isPhone(value) {
  return /^\+?[0-9][0-9 ().-]{6,}[0-9]$/.test(String(value ?? ""));
}

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com/i.test(String(value ?? ""));
}

function valueState(value, validator = () => true) {
  const trimmedValue = String(value ?? "").trim();

  if (!trimmedValue) {
    return "missing";
  }

  if (isPlaceholder(trimmedValue)) {
    return "placeholder";
  }

  if (!validator(trimmedValue)) {
    return "invalid";
  }

  return "ready";
}

function displayValue(label, value, validator = () => true) {
  return valueState(value, validator) === "ready" ? String(value).trim() : `${label}=${valueState(value, validator)}`;
}

function statusFor(condition) {
  return condition ? "ready" : "blocker";
}

function validationItem(id, label, ready, action) {
  return {
    id,
    label,
    status: statusFor(ready),
    action: ready ? "" : action
  };
}

function list(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function codeBlock(value) {
  return ["```text", String(value ?? "").trim(), "```"].join("\n");
}

function copyBlock(title, value) {
  return `### ${title}\n\n${codeBlock(value)}`;
}

function main() {
  const fields = readJson("app-store-assets/APP_STORE_CONNECT_FIELDS.json");
  const notes = String(fields.review?.notes ?? "");
  const testInstructions = Array.isArray(fields.review?.testInstructions) ? fields.review.testInstructions : [];
  const supportUrl = fields.productPage?.supportUrl ?? "";
  const privacyPolicyUrl = fields.productPage?.privacyPolicyUrl ?? "";
  const reviewContact = fields.review?.contact ?? {};
  const appName = fields.app?.name ?? "Cody Cartridge";
  const displayContact = {
    name: displayValue("reviewName", reviewContact.name, (value) => value.length >= 2),
    email: displayValue("reviewEmail", reviewContact.email, isEmail),
    phone: displayValue("reviewPhone", reviewContact.phone, isPhone)
  };
  const contactState = {
    name: valueState(reviewContact.name, (value) => value.length >= 2),
    email: valueState(reviewContact.email, isEmail),
    phone: valueState(reviewContact.phone, isPhone)
  };
  const displayLinks = {
    supportUrl: displayValue("supportUrl", supportUrl, isFullUrl),
    privacyPolicyUrl: displayValue("privacyPolicyUrl", privacyPolicyUrl, isFullUrl),
    accessibilityUrl: displayValue("accessibilityUrl", fields.accessibility?.accessibilityUrl ?? "", isFullUrl),
    thirdPartyNoticesUrl: displayValue("thirdPartyNoticesUrl", fields.urls?.thirdPartyNoticesUrl ?? "", isFullUrl)
  };
  const linkState = {
    supportUrl: valueState(supportUrl, isFullUrl),
    privacyPolicyUrl: valueState(privacyPolicyUrl, isFullUrl),
    accessibilityUrl: valueState(fields.accessibility?.accessibilityUrl ?? "", isFullUrl),
    thirdPartyNoticesUrl: valueState(fields.urls?.thirdPartyNoticesUrl ?? "", isFullUrl)
  };

  const validations = [
    validationItem("review-notes-present", "Review notes are present", notes.trim().length > 0, "Regenerate npm run packet:store from listing copy."),
    validationItem("review-notes-limit", "Review notes are under 4000 characters", byteLength(notes) <= 4000, "Shorten App Review notes before submission."),
    validationItem("demo-account", "Demo account declares no account system", /no account system/i.test(fields.review?.demoAccount ?? ""), "Update review.demoAccount in the packet generator."),
    validationItem(
      "contact-name",
      "App Review contact name is real",
      contactState.name === "ready",
      "Set CODY_REVIEW_CONTACT_NAME before regenerating packet and brief."
    ),
    validationItem(
      "contact-email",
      "App Review contact email is real",
      contactState.email === "ready",
      "Set CODY_REVIEW_CONTACT_EMAIL or CODY_SUPPORT_EMAIL before regenerating packet and brief."
    ),
    validationItem(
      "contact-phone",
      "App Review contact phone is real",
      contactState.phone === "ready",
      "Set CODY_REVIEW_CONTACT_PHONE before regenerating packet and brief."
    ),
    validationItem("support-url", "Support URL is public HTTPS", linkState.supportUrl === "ready", "Set CODY_SITE_URL and regenerate site, packet, and brief."),
    validationItem(
      "privacy-url",
      "Privacy Policy URL is public HTTPS",
      linkState.privacyPolicyUrl === "ready",
      "Set CODY_SITE_URL and regenerate site, packet, and brief."
    ),
    validationItem(
      "sandbox-instructions",
      "Sandbox file-access instructions are included",
      testInstructions.some((item) => /security-scoped bookmark|picker imports/i.test(item)),
      "Add sandbox-safe import instructions to review.testInstructions."
    ),
    validationItem(
      "no-download-claim",
      "No-download/no-scraping claim is included",
      `${notes}\n${testInstructions.join("\n")}`.toLowerCase().includes("does not download") ||
        `${notes}\n${testInstructions.join("\n")}`.toLowerCase().includes("no music download"),
      "Add explicit no-download/no-scraping language to App Review notes."
    ),
    validationItem(
      "help-docs",
      "Help document inspection is included",
      testInstructions.some((item) => item.includes("Privacy Policy") && item.includes("Support") && item.includes("Third-Party Notices")),
      "Include Help menu Privacy Policy, Support, Accessibility, and Third-Party Notices in review test instructions."
    )
  ];
  const statusCounts = validations.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const reviewBrief = {
    generatedAt: new Date().toISOString(),
    app: fields.app,
    summary: {
      validationCount: validations.length,
      readyCount: statusCounts.ready ?? 0,
      blockerCount: statusCounts.blocker ?? 0
    },
    appReview: {
      notes,
      notesBytes: byteLength(notes),
      contact: displayContact,
      contactState,
      demoAccount: fields.review?.demoAccount,
      testInstructions
    },
    publicLinks: displayLinks,
    publicLinkState: linkState,
    reviewerChecklist: [
      "Launch the signed MAS build and confirm the app opens without account, network, or purchase prompts.",
      "Import user-owned local audio through File > Import Audio Files or File > Import Music Folder.",
      "Confirm playback, seek, volume, album art, metadata, Takeout CSV matching, and missing-file states.",
      "Quit and relaunch to confirm sandboxed read-only access is preserved through app-scoped bookmarks.",
      "Open Help > Privacy Summary, Privacy Policy, Support, Accessibility, and Third-Party Notices.",
      "Run File > Reset Local Library and confirm the app clears its local index without deleting user audio files."
    ],
    reviewerDisclosure: {
      localOnly:
        "Cody Cartridge ships without music, has no account system, and plays only user-selected local audio files.",
      noDownload:
        "The app does not download, scrape, stream from YouTube Music, or access a user's YouTube account.",
      privacy:
        fields.privacy?.appPrivacyDataCollection ?? "No data collection is declared in App Store Connect fields.",
      sandbox:
        "Picker-selected files and folders are the primary sandbox-safe access path; dropped paths in MAS builds require an existing stored security-scoped bookmark."
    },
    validations
  };

  const markdown = `# ${appName} App Review Brief

Generated by \`npm run review-brief:store\`.

Use this as the standalone App Review copy/checklist immediately before adding the build for review. The JSON companion file is \`app-store-assets/APP_REVIEW_BRIEF.json\`.

## Summary

- Bundle ID: \`${fields.app?.bundleId ?? "missing"}\`
- Version: ${fields.app?.packageVersion ?? "missing"}
- Build version: ${fields.app?.buildVersion ?? fields.app?.packageVersion ?? "missing"}
- Validation blockers: ${reviewBrief.summary.blockerCount}
- App Review notes bytes: ${reviewBrief.appReview.notesBytes}/4000

## App Review Contact

- Name: ${displayContact.name}
- Email: ${displayContact.email}
- Phone: ${displayContact.phone}

## Demo Account

${fields.review?.demoAccount ?? ""}

## Reviewer Disclosure

- ${reviewBrief.reviewerDisclosure.localOnly}
- ${reviewBrief.reviewerDisclosure.noDownload}
- Privacy: ${reviewBrief.reviewerDisclosure.privacy}
- Sandbox: ${reviewBrief.reviewerDisclosure.sandbox}

## App Review Notes Copy Block

${copyBlock("Review Notes", notes)}

## Test Instructions

${list(testInstructions)}

## Reviewer Checklist

${list(reviewBrief.reviewerChecklist)}

## Public Links

- Support: ${displayLinks.supportUrl}
- Privacy Policy: ${displayLinks.privacyPolicyUrl}
- Accessibility: ${reviewBrief.publicLinks.accessibilityUrl}
- Third-Party Notices: ${reviewBrief.publicLinks.thirdPartyNoticesUrl}

## Validation

| Check | Status | Action |
| --- | --- | --- |
${validations.map((item) => `| ${item.label} | ${item.status} | ${item.action || "-"} |`).join("\n")}
`;

  fs.writeFileSync(outputJson, `${JSON.stringify(reviewBrief, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown);

  console.log(`Built ${path.relative(projectRoot, outputJson)}`);
  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);

  if (reviewBrief.summary.blockerCount > 0) {
    console.warn(`App Review brief records ${reviewBrief.summary.blockerCount} blocker field(s).`);
  }
}

main();
