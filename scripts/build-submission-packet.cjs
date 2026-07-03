#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { getReleaseStoreEnvValue, loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
loadStoreEnv(projectRoot);

const outputMarkdown = path.join(projectRoot, "app-store-assets", "SUBMISSION_PACKET.md");
const outputJson = path.join(projectRoot, "app-store-assets", "APP_STORE_CONNECT_FIELDS.json");
const siteUrl = getReleaseStoreEnvValue("CODY_SITE_URL", "TODO_PUBLIC_SITE_URL").replace(/\/$/, "");
const supportEmail = getReleaseStoreEnvValue("CODY_SUPPORT_EMAIL", "TODO_SUPPORT_EMAIL");
const reviewContactName = getReleaseStoreEnvValue("CODY_REVIEW_CONTACT_NAME", "TODO_REVIEW_CONTACT_NAME");
const reviewContactEmail = getReleaseStoreEnvValue("CODY_REVIEW_CONTACT_EMAIL", supportEmail);
const reviewContactPhone = getReleaseStoreEnvValue("CODY_REVIEW_CONTACT_PHONE", "TODO_REVIEW_CONTACT_PHONE");
const thirdPartyNoticesUrl =
  siteUrl === "TODO_PUBLIC_SITE_URL"
    ? "Optional or TODO_PUBLIC_SITE_URL/third-party-notices.html"
    : `${siteUrl}/third-party-notices.html`;

function isPlaceholder(value) {
  return /TODO_|TODO:|you@example\.com|https:\/\/example\.com|\+1-555-555-5555/i.test(String(value ?? ""));
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

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function extractBlock(text, startMarker, endMarkers = []) {
  const startIndex = text.indexOf(startMarker);

  if (startIndex === -1) {
    return "";
  }

  const contentStart = startIndex + startMarker.length;
  const endIndex = endMarkers.reduce((currentEnd, marker) => {
    const markerIndex = text.indexOf(marker, contentStart);
    return markerIndex === -1 ? currentEnd : Math.min(currentEnd, markerIndex);
  }, text.length);

  return text.slice(contentStart, endIndex).trim();
}

function getScreenshotSize(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    return { exists: false, height: 0, width: 0 };
  }

  const output = run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", absolutePath]);
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);

  return { exists: true, height, width };
}

function normalizeLines(value) {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function bullets(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function codeBlock(value) {
  return ["```text", value.trim(), "```"].join("\n");
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function main() {
  const pkg = readJson("package.json");
  const listing = readText("app-store-assets/APP_STORE_LISTING.md");
  const accessibility = readText("app-store-assets/ACCESSIBILITY.md");
  const privacy = readText("app-store-assets/PRIVACY_POLICY.md");
  const support = readText("app-store-assets/SUPPORT.md");
  const privacyManifest = readText("build/PrivacyInfo.xcprivacy");
  const exportCompliancePath = "app-store-assets/EXPORT_COMPLIANCE.json";
  const exportCompliance = fs.existsSync(path.join(projectRoot, exportCompliancePath))
    ? readJson(exportCompliancePath)
    : {
        artifactPath: exportCompliancePath,
        missing: true,
        summary: {
          appStoreConnectDraftAnswer:
            "Run npm run export-compliance:store before using this packet so export-compliance guidance reflects the current binary."
        },
        appStoreConnect: {
          sourceUrls: []
        },
        binaryFacts: []
      };

  const screenshotFiles = [
    "app-store-assets/screenshots/01-library-1440x900.png",
    "app-store-assets/screenshots/02-takeout-map-1440x900.png",
    "app-store-assets/screenshots/03-missing-files-1440x900.png"
  ];
  const screenshotManifestPath = "app-store-assets/screenshots/STORE_SCREENSHOTS.json";
  const screenshotManifest = fs.existsSync(path.join(projectRoot, screenshotManifestPath))
    ? readJson(screenshotManifestPath)
    : null;
  const manifestScreenshotsByPath = new Map((screenshotManifest?.screenshots ?? []).map((entry) => [entry.filePath, entry]));

  const screenshots = screenshotFiles.map((filePath) => {
    const manifestEntry = manifestScreenshotsByPath.get(filePath);

    return {
      filePath,
      ...getScreenshotSize(filePath),
      appStoreConnectAccepted: manifestEntry?.appStoreConnectAccepted === true,
      format: manifestEntry?.format ?? path.extname(filePath).replace(/^\./, "")
    };
  });
  const publicSiteArchiveManifestPath = path.join(projectRoot, "app-store-assets", "public-site", "PUBLIC_SITE_ARCHIVE.json");
  const publicSiteArchive = fs.existsSync(publicSiteArchiveManifestPath)
    ? JSON.parse(fs.readFileSync(publicSiteArchiveManifestPath, "utf8"))
    : null;

  const productCopy = {
    category: extractBlock(listing, "Category:", ["\n\nCopyright:"]),
    copyright: extractBlock(listing, "Copyright:", ["\n\n## URLs To Publish Before Submission"]),
    description: extractBlock(listing, "Description:", ["\n\nFeatures:"]),
    keywords: extractBlock(listing, "Keywords:", ["\n\nCategory:"]),
    name: extractBlock(listing, "Name:", ["\n\nSubtitle:"]),
    promotionalText: extractBlock(listing, "Promotional text:", ["\n\nDescription:"]),
    reviewNotes: extractBlock(listing, "## App Review Notes", ["\n\n## Screenshot Plan"]),
    subtitle: extractBlock(listing, "Subtitle:", ["\n\nPromotional text:"])
  };

  const app = {
    appId: pkg.build?.appId,
    buildVersion: pkg.build?.buildVersion ?? pkg.version,
    bundleId: pkg.build?.appId,
    category: pkg.build?.mac?.category ?? "public.app-category.music",
    copyright: pkg.build?.copyright ?? productCopy.copyright,
    name: productCopy.name || pkg.build?.productName,
    packageVersion: pkg.version,
    productName: pkg.build?.productName,
    sku: "cody-cartridge-mac",
    subtitle: productCopy.subtitle
  };

  const appStoreFields = {
    app,
    productPage: {
      category: productCopy.category || "Music",
      copyright: productCopy.copyright || "2026 Sachit Tumuluri",
      description: productCopy.description,
      keywords: productCopy.keywords,
      name: app.name,
      promotionalText: productCopy.promotionalText,
      subtitle: app.subtitle,
      supportUrl: siteUrl === "TODO_PUBLIC_SITE_URL" ? "TODO_PUBLIC_SITE_URL/support.html" : `${siteUrl}/support.html`,
      privacyPolicyUrl: siteUrl === "TODO_PUBLIC_SITE_URL" ? "TODO_PUBLIC_SITE_URL/privacy.html" : `${siteUrl}/privacy.html`,
      marketingUrl: siteUrl === "TODO_PUBLIC_SITE_URL" ? "Optional or TODO_PUBLIC_SITE_URL/index.html" : `${siteUrl}/index.html`
    },
    review: {
      notes: productCopy.reviewNotes,
      contact: {
        name: reviewContactName,
        email: reviewContactEmail,
        phone: reviewContactPhone
      },
      demoAccount: "None. The app has no account system.",
      testInstructions: [
        "Launch the app.",
        "Use File > Import Audio Files or File > Import Music Folder with user-owned local audio files.",
        "Treat picker imports as the primary sandbox-safe file access path; dropped paths in MAS builds are accepted only after they fall under a stored security-scoped bookmark.",
        "Optionally use File > Import YouTube Music Takeout with a user-provided CSV export.",
        "Confirm local playback, embedded artwork/metadata display, and missing-file visibility.",
        "Open Help > Privacy Summary, Privacy Policy, Support, Accessibility, and Third-Party Notices to confirm in-app policy, support, accessibility, and license disclosures are available.",
        "Use File > Reset Local Library and confirm local index data clears without deleting the source audio files."
      ]
    },
    testFlight: {
      appStoreConnectLocation: "TestFlight > Test Information; TestFlight > Internal Testing > Build > What to Test",
      betaAppDescription:
        "Cody Cartridge is a local-first macOS music player for testing user-selected audio imports, embedded artwork and metadata display, YouTube Music Takeout CSV matching, visual shelf browsing, and sandboxed local playback.",
      feedbackEmail: supportEmail,
      contactInformation: {
        name: reviewContactName,
        email: reviewContactEmail,
        phone: reviewContactPhone
      },
      demoAccount: "None. The app has no account system, server login, subscription, or in-app purchase flow.",
      recommendedGroups: [
        "Internal: Store Smoke — small App Store Connect user group for signed-build install, import, playback, sandbox persistence, and reduced-motion checks.",
        "External: Private Beta — optional later group for non-team testers after TestFlight App Review approval; use only user-owned local audio test files."
      ],
      whatToTest: [
        "Install the macOS build through TestFlight and launch Cody Cartridge.",
        "Import user-owned audio with File > Import Audio Files and File > Import Music Folder.",
        "Confirm dropped local files import only when they are under an already selected bookmarked file or folder; use the picker for first-time sandbox access.",
        "Play, pause, seek, change tracks, and adjust volume from the hardware-style transport controls.",
        "Confirm embedded album art, title, artist, album, duration, bitrate, sample rate, and local source path appear where available.",
        "Import a user-provided YouTube Music Takeout CSV and confirm matched tracks, unmatched rows, and metadata confidence are visible.",
        "Quit and relaunch to confirm sandboxed read-only file access and app-scoped bookmarks preserve playable imported files.",
        "Enable macOS Reduce Motion and confirm visualizers/scroll effects calm down while playback and navigation remain usable.",
        "Open Help > Privacy Summary, Privacy Policy, Support, Accessibility, and Third-Party Notices from the macOS menu bar.",
        "Use File > Reset Local Library and confirm imported library state, Takeout rows, saved slots, playback state, and file-access bookmarks are cleared without deleting source audio files.",
        "Confirm there is no music download, scraping, streaming-account login, analytics, ads, or server upload flow."
      ],
      macAcceptanceChecklist: [
        "Clean macOS user account can install and launch the TestFlight build.",
        "Fresh library state shows an empty archive without errors or network/account prompts.",
        "User-selected local MP3/M4A/FLAC/WAV-family files import and play.",
        "Embedded artwork is used when present; missing artwork is represented without crashing.",
        "Takeout CSV import only affects local metadata matching and never downloads media.",
        "Quit/relaunch preserves imported file access for picker-selected files and folders.",
        "Keyboard playback shortcuts, catalog search, and shelf navigation work.",
        "Help menu Privacy Summary, Privacy Policy, Support, Accessibility, and Third-Party Notices open in the packaged app.",
        "File > Reset Local Library clears the local index and stored file-access bookmarks without deleting user audio files.",
        "Reduced Motion preference is respected.",
        "Privacy Summary and support/privacy URLs are accurate before external testers are invited."
      ],
      buildHandling: [
        "Upload the signed MAS build to App Store Connect and wait for Apple processing before selecting it in TestFlight.",
        "Resolve any export-compliance or privacy-manifest warnings against the exact uploaded build.",
        "Add one build at a time to the internal test group and paste the What to Test text into the build notes.",
        "Use TestFlight before App Store submission to catch sandbox, entitlement, signing, and clean-account playback issues.",
        "Track the 90-day TestFlight availability window and expire superseded builds when testing is complete."
      ],
      feedbackHandling: [
        "Monitor TestFlight Feedback screenshots, crashes, sessions, and written comments in App Store Connect.",
        "Use the feedback email as the fallback contact channel for testers.",
        "Convert blocking TestFlight findings into release-preflight fixes before submitting the App Store version."
      ]
    },
    privacy: {
      appPrivacyDataCollection: "No, this app does not collect data from the app.",
      tracking: "No tracking.",
      trackingDomains: "None.",
      dataSentOffDeviceByDeveloperApp: "None.",
      localDataProcessed:
        "Selected audio files, embedded tags/artwork, imported YouTube Music Takeout CSV rows, playback state, UI preferences, and security-scoped bookmarks.",
      privacyManifestSummary:
        "PrivacyInfo.xcprivacy declares no tracking, no collected data, and required-reason API use for local file metadata, app-local defaults, and system timing."
    },
    accessibility: {
      appStoreConnectLocation: "App Accessibility > Accessibility Nutrition Labels",
      accessibilityUrl:
        siteUrl === "TODO_PUBLIC_SITE_URL" ? "Optional or TODO_PUBLIC_SITE_URL/accessibility.html" : `${siteUrl}/accessibility.html`,
      reducedMotion:
        "Supported. The app reads the macOS/browser prefers-reduced-motion setting, disables the requestAnimationFrame visualizer loop, avoids smooth scrolling, and collapses CSS animation/transition durations.",
      voiceOverCandidate:
        "Candidate support. Core controls use native buttons, range inputs, visible labels, aria-labels, and live status text; verify full VoiceOver task coverage on the signed MAS build before marking Supported.",
      keyboardCandidate:
        "Candidate support. Playback, seeking, catalog search, shelf navigation, and import flows are reachable with native controls and app shortcuts; verify on a clean macOS user account before submission.",
      largerTextCandidate:
        "Not claimed yet. The interface uses fixed dense archive styling and should be tested with macOS display/text scaling before marking Larger Text support.",
      captionsAndAudioDescriptions:
        "Not applicable. Cody Cartridge does not ship video content, spoken instructional media, or generated narration."
    },
    ageRating: {
      appStoreConnectLocation: "General > App Information > Age Ratings",
      expectedRating: "4+ candidate; App Store Connect generates the final rating from Apple's questionnaire.",
      questionnaireNotes: [
        "No user-generated content or social features.",
        "No unrestricted web access.",
        "No gambling, contests, loot boxes, or in-app purchases currently configured.",
        "No medical, wellness, treatment, or regulated-device functionality.",
        "No mature, violent, sexual, drug, alcohol, tobacco, or horror content shipped by the app.",
        "User-selected local songs and album artwork are outside the app bundle; answer final content questions based on shipped app content and Apple review guidance."
      ]
    },
    distribution: {
      pricingAndAvailabilityLocation: "Monetization > Pricing and Availability",
      price: "Free candidate for first release.",
      availability: "All countries and regions candidate unless you choose a narrower launch region in App Store Connect.",
      taxCategory: "General app/software candidate; confirm in App Store Connect before submission.",
      preOrder: "No pre-order planned.",
      releaseOption: "Manual release after approval is recommended for the first submission so the signed MAS build can be smoke-tested before launch.",
      firstVersionWhatsNew:
        "Not available for the first version in App Store Connect. Use product description, promotional text, and review notes for first-release context.",
      futureWhatsNew:
        "Initial Mac App Store preparation for Cody Cartridge: local audio imports, embedded artwork and metadata, YouTube Music Takeout CSV matching, visual shelf browsing, reduced-motion support, and sandboxed read-only file access."
    },
    submission: {
	      upload: {
	        appStoreConnectLocation: "App Store Connect > Apps > Cody Cartridge > TestFlight or app version build upload/processing",
	        artifactExpectation:
	          "Use the signed Mac App Store installer package (.pkg) produced by npm run dist:mas after npm run release:store:preflight passes on the release machine. Inspect dist/ for the generated MAS app bundle and upload package before upload.",
        supportedUploadMethods: [
          "Transporter app: deliver the signed MAS package to App Store Connect and review delivery logs, warnings, and errors.",
          "Xcode Organizer: upload a valid archive if you later move packaging into an Xcode archive flow.",
          "altool: validate and upload with xcrun altool --validate-app / --upload-app using the platform value required by the installed Xcode toolchain.",
          "App Store Connect API plus Transporter command line: optional automation path for a later CI/release machine."
        ],
        processingChecks: [
          "Wait for App Store Connect processing to finish before selecting the build for TestFlight or App Review.",
          `Confirm the uploaded build resolves to bundle id ${pkg.build?.appId}, version ${pkg.version}, and build ${pkg.build?.buildVersion ?? pkg.version}.`,
          "Resolve Missing Compliance, export-compliance, privacy-manifest, entitlement, or processing warnings against the exact uploaded binary.",
          "Save raw delivery logs outside the handoff archive, then run npm run upload-evidence:store with the log path and processed-build values to create sanitized UPLOAD_EVIDENCE.md."
        ]
      },
      buildSelection: {
        appStoreConnectLocation: "App version > Build",
        notes: [
          "Only one uploaded build can be associated with this app version at submission time.",
          "After upload processing finishes, add the correct processed build to the macOS app version and save the version page.",
          "If the selected build has Missing Compliance status, answer the export compliance questions or provide required documentation before review."
        ]
      },
      appReviewSubmission: {
        appStoreConnectLocation: "App version > Add for Review; App Review > Draft Submissions > Submit for Review",
	        preSubmitChecklist: [
	          "Public Support URL, Privacy Policy URL, support email, and App Review contact fields are real and reachable.",
          "The release machine has passed npm run check:release-runtime -- --strict with the Node 22 runtime selected.",
          "The generated public support/privacy site has passed npm run check:site -- --strict.",
          "The public site archive has passed npm run check:site-archive -- --strict and is ready to upload to the static host.",
          "The redacted release blocker report has been regenerated with npm run report:store-blockers and shows no blockers.",
          "The bundled Help document gate has passed with npm run check:help-docs.",
          "The Electron shell security gate has passed with npm run check:electron-security.",
          "The packaging toolchain gate has passed with npm run check:packaging-toolchain, confirming electron-builder and app-builder-lib load cleanly.",
          "The local MAS directory smoke gate has passed with npm run smoke:mas-dir during npm run release:store:local, confirming the unsigned app bundle layout reaches the expected signing boundary.",
          "The local-only packaged MAS runtime smoke gate has run during npm run release:store:local against a temporary ad-hoc signed copy of the MAS rehearsal bundle; concrete launch errors fail the gate, while silent local ad-hoc MAS launch hangs are recorded as advisory and final runtime proof is deferred to TestFlight/App Store delivery.",
          "The Electron shell runtime gate has passed with npm run smoke:electron-shell, including local audio import IPC and cody-media byte-range streaming.",
          "The App privacy gate has passed with npm run check:app-privacy, including local playback URL guards for audio analysis and playback.",
          "The App Store Connect copy map has been rebuilt with npm run copy-map:store and checked for limits, placeholders, and screen-by-screen coverage.",
          "The standalone App Review brief has been rebuilt with npm run review-brief:store and checked for review notes, test instructions, sandbox disclosures, contact placeholders, and no-download wording.",
          "The artifact privacy gate has passed with npm run check:artifact-privacy, confirming generated release artifacts do not include local paths, downloader references, temporary capture paths, or local music filenames.",
          "The App Store handoff archive has been rebuilt with npm run handoff:store and verified against its manifest.",
          "The isolated clean-profile reset gate has passed with npm run smoke:clean-profile.",
          "Product page copy, screenshot quality audit, age rating, privacy answers, pricing, availability, tax category, release option, and EU DSA status are complete.",
          "The production store-demo smoke gate has passed with npm run smoke:store, including poisoned localStorage URL sanitization, shelf rail alignment, and desktop layout stability.",
	          "The production accessibility and Reduced Motion smoke gate has passed with npm run smoke:a11y.",
	          "The App Store upload tooling gate has passed with npm run check:upload-tooling -- --strict.",
          "The App Store Connect upload credential gate has passed with npm run check:upload-credentials -- --strict.",
	          "TestFlight internal smoke checklist has passed on a clean macOS user account.",
          "The selected build is the same signed MAS build that passed npm run verify:store:strict."
        ],
        steps: [
          "Open the macOS app version in App Store Connect and verify the Build section points to the intended processed build.",
          "Click Add for Review and create or choose the draft submission.",
          "Open Draft Submissions, review every included item, then click Submit for Review.",
          "After submission starts, monitor App Review messages and status changes in the App Review section."
        ],
        postSubmitMonitoring: [
          "Monitor App Review status, resolution center messages, build-processing warnings, and metadata notices in App Store Connect until the review is complete.",
          "Save App Review messages, delivery logs, release evidence, and the final RELEASE_MANIFEST.md with the submitted build notes.",
          "If Apple requests metadata, privacy, sandbox, entitlement, or binary changes, update the source artifact first, regenerate npm run packet:store, and rerun the strict preflight before resubmitting.",
          "Keep manual release selected for the first launch; after approval, smoke-test the approved build record and public support/privacy URLs before releasing."
        ]
      },
      postSubmission: [
        "If App Review reports metadata, sandbox, privacy, or binary issues, update the source artifact and regenerate npm run packet:store before resubmitting.",
        "If a new binary is required, increment the package/app build version before uploading another build.",
        "Keep manual release selected for the first launch until the approved build has been smoke-tested in App Store Connect."
      ]
    },
    rightsAndCompliance: {
      contentRights:
        "The app ships without music, does not download or scrape music, and plays only user-selected files the user is responsible for owning or having rights to use.",
      exportCompliance:
        exportCompliance.summary.appStoreConnectDraftAnswer,
      digitalServicesAct: {
        location: "Business / Compliance information > European Union Digital Services Act",
        status: "Must be answered in App Store Connect before EU distribution. Confirm whether the developer account is a trader or non-trader under the EU DSA.",
        traderContactDisplay:
          "If marked as a trader, Apple requires verified address, phone number, and email contact details for display to EU customers on the App Store product page.",
        labelsAndMarkingsUrl:
          "Optional labels and markings URL. Cody Cartridge does not currently require a product-safety label URL, but confirm this against the final account and distribution choices.",
        launchImpact:
          "If DSA status is incomplete, EU distribution may be blocked or require removal of EU availability until the account-level compliance entry is complete."
      },
      regulatedMedicalDevice: "No.",
      loginRequired: "No.",
      inAppPurchases: "None currently configured."
    },
    exportCompliance: {
      artifactPath: exportCompliance.artifactPath ?? exportCompliancePath,
      markdownPath: exportCompliance.markdownPath ?? "app-store-assets/EXPORT_COMPLIANCE.md",
      missing: exportCompliance.missing === true,
      summary: exportCompliance.summary,
      appStoreConnect: exportCompliance.appStoreConnect,
      binaryFacts: exportCompliance.binaryFacts,
      releaseActions: exportCompliance.releaseActions ?? []
    },
    urls: {
      supportEmail,
      supportUrl: siteUrl === "TODO_PUBLIC_SITE_URL" ? "TODO_PUBLIC_SITE_URL/support.html" : `${siteUrl}/support.html`,
      privacyPolicyUrl: siteUrl === "TODO_PUBLIC_SITE_URL" ? "TODO_PUBLIC_SITE_URL/privacy.html" : `${siteUrl}/privacy.html`,
      thirdPartyNoticesUrl,
      publicSiteArchivePath: publicSiteArchive?.archivePath ?? "app-store-assets/public-site/cody-cartridge-public-site.zip",
      publicSiteArchiveSha256: publicSiteArchive?.archiveSha256 ?? "missing"
    },
    screenshotManifest: screenshotManifest
      ? {
	          filePath: screenshotManifestPath,
          appStoreConnectSpec: screenshotManifest.appStoreConnectSpec,
          generatedAt: screenshotManifest.generatedAt,
          screenshotCount: screenshotManifest.screenshotCount,
          source: screenshotManifest.source,
          viewport: screenshotManifest.viewport
        }
      : {
          filePath: screenshotManifestPath,
          missing: true
        },
    screenshots
  };

  appStoreFields.fieldAudit = {
    descriptionCharacters: appStoreFields.productPage.description.length,
    descriptionLimit: 4000,
    keywordsBytes: byteLength(appStoreFields.productPage.keywords),
    keywordsLimitBytes: 100,
    promotionalTextCharacters: appStoreFields.productPage.promotionalText.length,
    promotionalTextLimit: 170,
    reviewNotesCharacters: appStoreFields.review.notes.length,
    reviewNotesLimit: 4000,
    testFlightBetaDescriptionCharacters: appStoreFields.testFlight.betaAppDescription.length,
    testFlightWhatToTestCharacters: appStoreFields.testFlight.whatToTest.join("\n").length,
    futureWhatsNewCharacters: appStoreFields.distribution.futureWhatsNew.length,
    futureWhatsNewLimit: 4000,
    supportUrlComplete: appStoreFields.productPage.supportUrl.startsWith("http"),
    privacyPolicyUrlComplete: appStoreFields.productPage.privacyPolicyUrl.startsWith("http")
  };
  const display = {
    supportUrl: displayValue("supportUrl", appStoreFields.productPage.supportUrl, isFullUrl),
    privacyPolicyUrl: displayValue("privacyPolicyUrl", appStoreFields.productPage.privacyPolicyUrl, isFullUrl),
    marketingUrl: displayValue("marketingUrl", appStoreFields.productPage.marketingUrl, isFullUrl),
    accessibilityUrl: displayValue("accessibilityUrl", appStoreFields.accessibility.accessibilityUrl, isFullUrl),
    thirdPartyNoticesUrl: displayValue("thirdPartyNoticesUrl", appStoreFields.urls.thirdPartyNoticesUrl, isFullUrl),
    supportEmail: displayValue("supportEmail", supportEmail, isEmail),
    reviewName: displayValue("reviewName", appStoreFields.review.contact.name, (value) => value.length >= 2),
    reviewEmail: displayValue("reviewEmail", appStoreFields.review.contact.email, isEmail),
    reviewPhone: displayValue("reviewPhone", appStoreFields.review.contact.phone, isPhone)
  };

  const markdown = `# Cody Cartridge Submission Packet

Generated from the current repo state by \`npm run packet:store\`.

## App Record

- Name: ${appStoreFields.productPage.name}
- Bundle ID: ${app.bundleId}
- SKU: ${app.sku}
- Package version: ${app.packageVersion}
- Build version: ${app.buildVersion}
- Category: ${appStoreFields.productPage.category}
- Copyright: ${appStoreFields.productPage.copyright}

## Product Page Copy

### Field Audit

- Promotional text: ${appStoreFields.fieldAudit.promotionalTextCharacters} / ${appStoreFields.fieldAudit.promotionalTextLimit} characters
- Description: ${appStoreFields.fieldAudit.descriptionCharacters} / ${appStoreFields.fieldAudit.descriptionLimit} characters
- Keywords: ${appStoreFields.fieldAudit.keywordsBytes} / ${appStoreFields.fieldAudit.keywordsLimitBytes} bytes
- Review notes: ${appStoreFields.fieldAudit.reviewNotesCharacters} / ${appStoreFields.fieldAudit.reviewNotesLimit} characters
- TestFlight beta app description: ${appStoreFields.fieldAudit.testFlightBetaDescriptionCharacters} characters
- TestFlight What to Test: ${appStoreFields.fieldAudit.testFlightWhatToTestCharacters} characters
- Future What's New: ${appStoreFields.fieldAudit.futureWhatsNewCharacters} / ${appStoreFields.fieldAudit.futureWhatsNewLimit} characters

### Subtitle

${codeBlock(appStoreFields.productPage.subtitle)}

### Promotional Text

${codeBlock(appStoreFields.productPage.promotionalText)}

### Description

${codeBlock(appStoreFields.productPage.description)}

### Keywords

${codeBlock(appStoreFields.productPage.keywords)}

## URLs

- Support URL: ${display.supportUrl}
- Privacy Policy URL: ${display.privacyPolicyUrl}
- Marketing URL: ${display.marketingUrl}
- Accessibility URL: ${display.accessibilityUrl}
- Third-Party Notices URL: ${display.thirdPartyNoticesUrl}
- Support contact: ${display.supportEmail}
- Public site archive: ${appStoreFields.urls.publicSiteArchivePath}
- Public site archive SHA-256: ${appStoreFields.urls.publicSiteArchiveSha256}

## App Review Notes

${codeBlock(appStoreFields.review.notes)}

## App Review Contact

- Name: ${display.reviewName}
- Email: ${display.reviewEmail}
- Phone: ${display.reviewPhone}

## Review Test Instructions

${bullets(appStoreFields.review.testInstructions)}

Demo account: ${appStoreFields.review.demoAccount}

## TestFlight Beta Test Plan

- App Store Connect location: ${appStoreFields.testFlight.appStoreConnectLocation}
- Feedback email: ${display.supportEmail}
- Contact: ${display.reviewName} / ${display.reviewEmail} / ${display.reviewPhone}
- Demo account: ${appStoreFields.testFlight.demoAccount}

### Beta App Description

${codeBlock(appStoreFields.testFlight.betaAppDescription)}

### Recommended Tester Groups

${bullets(appStoreFields.testFlight.recommendedGroups)}

### What To Test

${bullets(appStoreFields.testFlight.whatToTest)}

### Mac Acceptance Checklist

${bullets(appStoreFields.testFlight.macAcceptanceChecklist)}

### Build Handling

${bullets(appStoreFields.testFlight.buildHandling)}

### Feedback Handling

${bullets(appStoreFields.testFlight.feedbackHandling)}

## Privacy Answers

- Data collection: ${appStoreFields.privacy.appPrivacyDataCollection}
- Tracking: ${appStoreFields.privacy.tracking}
- Tracking domains: ${appStoreFields.privacy.trackingDomains}
- Data sent off device by developer app: ${appStoreFields.privacy.dataSentOffDeviceByDeveloperApp}
- Local data processed: ${appStoreFields.privacy.localDataProcessed}
- Privacy manifest: ${appStoreFields.privacy.privacyManifestSummary}

## Accessibility Nutrition Labels

- App Store Connect location: ${appStoreFields.accessibility.appStoreConnectLocation}
- Accessibility URL: ${display.accessibilityUrl}
- Reduced Motion: ${appStoreFields.accessibility.reducedMotion}
- VoiceOver: ${appStoreFields.accessibility.voiceOverCandidate}
- Keyboard access: ${appStoreFields.accessibility.keyboardCandidate}
- Larger Text: ${appStoreFields.accessibility.largerTextCandidate}
- Captions and audio descriptions: ${appStoreFields.accessibility.captionsAndAudioDescriptions}

## Age Rating Candidate

- App Store Connect location: ${appStoreFields.ageRating.appStoreConnectLocation}
- Expected rating: ${appStoreFields.ageRating.expectedRating}

${bullets(appStoreFields.ageRating.questionnaireNotes)}

## Pricing, Availability, And Release

- App Store Connect location: ${appStoreFields.distribution.pricingAndAvailabilityLocation}
- Price: ${appStoreFields.distribution.price}
- Availability: ${appStoreFields.distribution.availability}
- Tax category: ${appStoreFields.distribution.taxCategory}
- Pre-order: ${appStoreFields.distribution.preOrder}
- Release option: ${appStoreFields.distribution.releaseOption}
- First-version What's New: ${appStoreFields.distribution.firstVersionWhatsNew}

### Future What's New Draft

${codeBlock(appStoreFields.distribution.futureWhatsNew)}

## Rights And Compliance

- Content rights: ${appStoreFields.rightsAndCompliance.contentRights}
- Export compliance: ${appStoreFields.rightsAndCompliance.exportCompliance}
- Regulated medical device: ${appStoreFields.rightsAndCompliance.regulatedMedicalDevice}
- Login required: ${appStoreFields.rightsAndCompliance.loginRequired}
- In-app purchases: ${appStoreFields.rightsAndCompliance.inAppPurchases}

## Export Compliance

- Artifact: \`${appStoreFields.exportCompliance.artifactPath}\`${appStoreFields.exportCompliance.missing ? " (missing; run `npm run export-compliance:store`)" : ""}
- App Store Connect location: ${appStoreFields.exportCompliance.appStoreConnect?.location ?? "missing"}
- Draft questionnaire position: ${appStoreFields.exportCompliance.appStoreConnect?.draftQuestionnairePosition ?? "missing"}
- Documentation expectation: ${appStoreFields.exportCompliance.appStoreConnect?.documentationExpectation ?? "missing"}
- Final binary requirement: ${appStoreFields.exportCompliance.summary?.finalBinaryRequirement ?? "missing"}
- Apple source URLs: ${(appStoreFields.exportCompliance.appStoreConnect?.sourceUrls ?? []).join(", ") || "missing"}

Binary facts:

${bullets((appStoreFields.exportCompliance.binaryFacts ?? []).map((item) => `${item.status}: ${item.label} - ${item.evidence}`))}

Release actions:

${bullets(appStoreFields.exportCompliance.releaseActions ?? [])}

## EU Digital Services Act

- App Store Connect location: ${appStoreFields.rightsAndCompliance.digitalServicesAct.location}
- DSA status: ${appStoreFields.rightsAndCompliance.digitalServicesAct.status}
- Trader contact display: ${appStoreFields.rightsAndCompliance.digitalServicesAct.traderContactDisplay}
- Labels and markings URL: ${appStoreFields.rightsAndCompliance.digitalServicesAct.labelsAndMarkingsUrl}
- Launch impact: ${appStoreFields.rightsAndCompliance.digitalServicesAct.launchImpact}

## Screenshot Inventory

- Manifest: \`${screenshotManifestPath}\`${screenshotManifest ? ` (${screenshotManifest.screenshotCount} screenshots, ${screenshotManifest.source}, ${screenshotManifest.viewport?.width} x ${screenshotManifest.viewport?.height})` : " (missing)"}
- App Store Connect spec: ${screenshotManifest?.appStoreConnectSpec ? `${screenshotManifest.appStoreConnectSpec.platform} ${screenshotManifest.appStoreConnectSpec.requiredFor}, ${screenshotManifest.appStoreConnectSpec.count.min}-${screenshotManifest.appStoreConnectSpec.count.max} screenshots, ${screenshotManifest.appStoreConnectSpec.aspectRatio}, accepted sizes ${screenshotManifest.appStoreConnectSpec.acceptedSizes.map((size) => `${size.width} x ${size.height}`).join(", ")} (${screenshotManifest.appStoreConnectSpec.sourceUrl})` : "missing"}
${screenshots
	  .map((screenshot) => {
    const status = screenshot.exists
      ? `${screenshot.width} x ${screenshot.height} · ${screenshot.format} · ${screenshot.appStoreConnectAccepted ? "accepted Mac screenshot" : "not marked accepted"}`
      : "missing";
    return `- ${screenshot.filePath}: ${status}`;
  })
  .join("\n")}

## Binary And Sandbox Notes

- MAS entitlements: \`${pkg.build?.mas?.entitlements}\`
- Child entitlements: \`${pkg.build?.mas?.entitlementsInherit}\`
- Privacy manifest: \`build/PrivacyInfo.xcprivacy\`
- Export compliance Info.plist key: \`ITSAppUsesNonExemptEncryption=false\`
- Network client entitlement: not enabled
- File access: sandboxed, user-selected read-only access with app-scoped bookmarks
- Packaged renderer protocol: \`cody-app://\`; \`file://\` renderer loading is not used in production builds
- Minimum macOS version: ${pkg.build?.mas?.minimumSystemVersion ?? pkg.build?.mac?.minimumSystemVersion ?? "not set"}
- App source archive: ${pkg.build?.asar === true ? "app.asar enabled" : "app.asar not explicitly enabled"}
- Package file allowlist: ${(pkg.build?.files ?? []).map((pattern) => `\`${pattern}\``).join(", ")}
- Electron fuses: ${Object.entries(pkg.build?.electronFuses ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")}
- Privacy manifest source length: ${privacyManifest.length} bytes

## Upload And App Review Submission

### Upload Handoff

- App Store Connect location: ${appStoreFields.submission.upload.appStoreConnectLocation}
- Artifact expectation: ${appStoreFields.submission.upload.artifactExpectation}

${bullets(appStoreFields.submission.upload.supportedUploadMethods)}

### Upload Processing Checks

${bullets(appStoreFields.submission.upload.processingChecks)}

### Build Selection

- App Store Connect location: ${appStoreFields.submission.buildSelection.appStoreConnectLocation}

${bullets(appStoreFields.submission.buildSelection.notes)}

### App Review Submission

- App Store Connect location: ${appStoreFields.submission.appReviewSubmission.appStoreConnectLocation}

Pre-submit checklist:

${bullets(appStoreFields.submission.appReviewSubmission.preSubmitChecklist)}

Submission steps:

${bullets(appStoreFields.submission.appReviewSubmission.steps)}

Post-submit monitoring:

${bullets(appStoreFields.submission.appReviewSubmission.postSubmitMonitoring)}

### Post-Submission Handling

${bullets(appStoreFields.submission.postSubmission)}

## Required Commands Before Upload

${codeBlock(`# Local dry run, safe before public URLs/signing assets are ready
npm run release:store:local

# Release-machine sequence, after public URLs and Apple signing assets are ready
npm run build
npm run init:store-env
# edit app-store-assets/site.env with real public URL, support email, and App Review contact values
npm run configure:store-env -- --dry-run --site-url https://your-public-site.example --support-email "<support-email>" --review-name "<review-contact-name>" --review-email "<review-contact-email>" --review-phone "<review-contact-phone>"
npm run public-release:store -- --self-test
npm run public-release:store -- --dry-run
npm run check:store-env
npm run check:release-runtime -- --strict
npm run check:store-version:source
npm run check:icons
npm run check:electron-security
npm run notices:store
npm run site:store
npm run check:site -- --strict
npm run archive:site
npm run check:site-archive -- --strict
npm run check:help-docs
npm run check:packaging-toolchain
npm run smoke:electron-shell
npm run smoke:clean-profile
npm run smoke:store
npm run smoke:a11y
npm run screenshots:store
npm run check:screenshots
npm run export-compliance:store
npm run packet:store
npm run app-compliance:store
npm run review-brief:store
npm run copy-map:store
npm run check:review-brief -- --strict
npm run check:copy-map -- --strict
npm run check:public-release-sync -- --strict
npm run check:store-version
npm run check:app-privacy
npm run check:export-compliance
npm run check:app-compliance
npm run check:store-copy
npm run check:artifact-privacy
npm run public-release:store -- --published
npm run check:store-urls -- --strict
npm run check:published-site -- --strict
npm run check:mas-signing -- --strict
npm run dist:mas
npm run check:mas-package -- --strict
npm run check:upload-tooling -- --strict
npm run check:upload-credentials -- --strict
npm run upload-packet:store
npm run report:store-blockers
npm run public-inputs:store
npm run publish-packet:store
npm run public-host:store
npm run signing-runbook:store
npm run resolution-plan:store
npm run submission-checklist:store
npm run machine-report:store
npm run evidence:store
npm run check:evidence
npm run dashboard:store
npm run operator:store
npm run manifest:store
npm run check:manifest
npm run handoff:store
npm run check:release-machine -- --strict
npm run verify:store:strict
npm run release:store:preflight`)}

## Remaining Manual Items

${bullets([
  "Replace public-site, support-email, and App Review contact placeholder states with real values before copying fields into App Store Connect.",
  "Run npm run init:store-env on the release machine to create ignored app-store-assets/site.env, then edit it with real public URL, support email, and App Review contact values.",
  "Run npm run configure:store-env with the real public URL, support email, and App Review contact values to validate and write ignored app-store-assets/site.env.local without printing raw contacts.",
  "Run npm run public-release:store -- --self-test before the public release refresh to prove release-value redaction and command-order invariants without using raw contacts.",
  "Run npm run public-release:store after real CODY_* values are set to regenerate the public site, archive, App Store fields, copy map, review brief, evidence, manifest, and handoff artifacts before signing.",
  "Run npm run public-release:store:published after the public site is uploaded to include strict Support/Privacy URL reachability checks.",
  "Run npm run check:release-runtime -- --strict on the release machine before packaging; .nvmrc and .node-version select Node 22, and package.json requires Node >=20 <25.",
  "Run npm run check:store-version after any package.json version change and after npm run packet:store to confirm package, lockfile, buildVersion, and generated App Store fields align.",
  "Run npm run app-compliance:store after npm run packet:store to refresh the standalone age rating, pricing, content-rights, export-compliance, and EU DSA packet.",
  "Run npm run review-brief:store after npm run packet:store to refresh the standalone App Review brief.",
  "Run npm run copy-map:store after npm run review-brief:store to refresh the screen-by-screen App Store Connect copy map with current App Review blocker state.",
  "Run npm run check:public-release-sync -- --strict after regenerating the site, archive, packet, copy map, and App Review brief to confirm public App Store fields match app-store-assets/site.env.",
  "Run npm run check:app-privacy after regenerating the packet to confirm privacy manifest categories, App Store privacy answers, policy docs, entitlements, local playback URL guards, and telemetry/ad SDK absence stay aligned.",
  "Run npm run export-compliance:store before npm run packet:store, then run npm run check:export-compliance after packet generation to confirm export-compliance answers, Apple source links, no-network entitlement state, and no-custom-crypto evidence stay aligned.",
  "Run npm run check:app-compliance after export-compliance validation to confirm compliance/admin answers are sourced from the generated packet and manual App Store Connect items are clearly marked.",
  "Run npm run check:store-copy after regenerating the packet to confirm App Store copy limits, keywords, review notes, privacy claims, and local-only/no-download wording.",
  "Run npm run check:artifact-privacy after npm run check:store-copy to confirm source and generated release artifacts do not leak local filesystem paths, downloader-site references, temporary capture paths, or local music filenames.",
  "Run npm run check:packaging-toolchain before MAS packaging to confirm electron-builder and app-builder-lib can load with the pinned CommonJS-compatible @noble/hashes dependency.",
  "Run npm run smoke:mas-dir during local release rehearsal to confirm the unsigned MAS app bundle layout and package-boundary checks before Apple signing assets are available.",
  "Run npm run smoke:mas-runtime only during local release rehearsal after npm run smoke:mas-dir; it applies a local ad-hoc runtime signature to a temporary copy of the unsigned rehearsal bundle and is not part of the signed upload preflight.",
  "Run npm run report:store-blockers after public URL/contact or signing changes and review app-store-assets/RELEASE_BLOCKERS.md before strict preflight.",
  "Run npm run public-inputs:store after npm run report:store-blockers to refresh app-store-assets/PUBLIC_RELEASE_INPUTS.md without leaking raw contact values.",
  "Run npm run publish-packet:store after npm run public-inputs:store to refresh app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md with the current archive, expected URLs, and public-site publish order.",
  "Run npm run public-host:store after npm run publish-packet:store to refresh app-store-assets/PUBLIC_HOST_RUNBOOK.md with the static hosting recipes and post-publish proof commands.",
  "Run npm run signing-runbook:store, npm run resolution-plan:store, npm run submission-checklist:store, and npm run machine-report:store after blocker/public-input updates so release-machine checklists and gate snapshots describe the same candidate.",
  "Run npm run evidence:store and npm run check:evidence immediately before npm run manifest:store so app-store-assets/RELEASE_EVIDENCE.md captures current command summaries and artifact hashes for the submitted build.",
  "Run npm run dashboard:store after npm run evidence:store to refresh app-store-assets/RELEASE_DASHBOARD.html for the release operator.",
  "Run npm run operator:store after npm run dashboard:store to refresh app-store-assets/RELEASE_OPERATOR_QUEUE.md for the release-machine first action and phase stop conditions.",
  "Run npm run check:manifest after npm run manifest:store, then run npm run handoff:store to build and verify the deterministic App Store handoff archive.",
  "Run npm run check:release-machine -- --strict after the handoff archive is refreshed to get one aggregate release-machine readiness verdict before npm run verify:store:strict.",
  "Upload app-store-assets/public-site/cody-cartridge-public-site.zip contents to the static host, or publish the generated app-store-assets/site directory directly, after npm run check:site-archive -- --strict, npm run publish-packet:store, and npm run public-host:store pass.",
  "Publish the generated support/privacy pages and run npm run check:store-urls -- --strict to confirm the public App Store URLs are reachable and contain the expected Cody Cartridge content.",
  "Run npm run check:published-site -- --strict after publishing to confirm every PUBLIC_SITE_PUBLISH_PACKET page is live and matches the generated source.",
  "Confirm bundle id com.sachittumuluri.codycartridge exists in Apple Developer and App Store Connect.",
	  "Install Apple Distribution/Mac App Distribution and Mac Installer Distribution signing assets plus a matching macOS/Mac App Store provisioning profile.",
	  "Run npm run check:mas-package -- --strict after MAS packaging to confirm bundle resources, app.asar contents, Electron fuses, Info.plist trimming, embedded provisioning profile, signed current-version installer package, and signed entitlements before upload.",
	  "Run npm run check:upload-tooling -- --strict after MAS packaging to confirm Transporter, altool, or iTMSTransporter is available and a signed Cody/Cartridge MAS .pkg upload artifact exists before upload.",
  "Run npm run check:upload-credentials -- --strict after upload-tooling passes to confirm App Store Connect API credential posture without writing secrets into artifacts.",
  "Run npm run upload-packet:store after upload-tooling and upload-credential checks pass; use app-store-assets/UPLOAD_COMMAND_PACKET.md to confirm the package hash and upload path before entering Apple credentials.",
  "Upload the signed MAS build, answer export-compliance questions using the final binary, then reconcile any ITMS privacy-manifest warnings.",
  "Wait for App Store Connect build processing, select the processed build on the macOS app version, then add the app version to a draft submission.",
  "Confirm EU Digital Services Act trader/non-trader status and any required trader contact details in App Store Connect before enabling EU availability.",
  "Set pricing, tax category, availability, and manual release option in App Store Connect before submitting for review.",
  "Create a TestFlight internal test group, add the processed signed build, paste the What to Test notes, and complete the Mac acceptance checklist before App Store submission.",
  "Publish third-party-notices.html with the support site if you want a public dependency-license notice page for review transparency.",
  "Regenerate app-store-assets/UPLOAD_COMMAND_PACKET.md, app-store-assets/UPLOAD_EVIDENCE.md, app-store-assets/RELEASE_BLOCKERS.md, app-store-assets/RELEASE_EVIDENCE.md, and app-store-assets/RELEASE_MANIFEST.md on the release machine after MAS packaging; keep raw delivery logs outside the handoff archive.",
  "Run the app from the signed MAS build on a clean macOS user account before submitting for review."
])}

## Source Policies

### Privacy Policy Draft

${privacy.trim()}

### Support Draft

${support.trim()}

### Accessibility Draft

${accessibility.trim()}
`;

  fs.writeFileSync(outputMarkdown, markdown);
  fs.writeFileSync(outputJson, `${JSON.stringify(appStoreFields, null, 2)}\n`);

  console.log(`Built ${path.relative(projectRoot, outputMarkdown)}`);
  console.log(`Built ${path.relative(projectRoot, outputJson)}`);

  if (siteUrl === "TODO_PUBLIC_SITE_URL") {
    console.warn("Set CODY_SITE_URL before using the generated URLs in App Store Connect.");
  }

  if (supportEmail === "TODO_SUPPORT_EMAIL") {
    console.warn("Set CODY_SUPPORT_EMAIL before publishing support/privacy pages.");
  }
}

main();
