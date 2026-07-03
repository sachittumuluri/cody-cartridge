# Cody Cartridge Submission Packet

Generated from the current repo state by `npm run packet:store`.

## App Record

- Name: Cody Cartridge
- Bundle ID: com.sachittumuluri.codycartridge
- SKU: cody-cartridge-mac
- Package version: 0.1.0
- Build version: 0.1.0
- Category: Music
- Copyright: 2026 Sachit Tumuluri

## Product Page Copy

### Field Audit

- Promotional text: 150 / 170 characters
- Description: 937 / 4000 characters
- Keywords: 81 / 100 bytes
- Review notes: 713 / 4000 characters
- TestFlight beta app description: 219 characters
- TestFlight What to Test: 1317 characters
- Future What's New: 225 / 4000 characters

### Subtitle

```text
Local music, signal mapped.
```

### Promotional Text

```text
Play your own music through a hardware-style deck: a live reactive oscilloscope, analog VU meters, a rotary amp knob, album art, and Takeout metadata.
```

### Description

```text
Cody Cartridge is a local-first music player for people who want their personal music library to feel like a found-object archive.

Import audio files you already own, read embedded artwork and tags, optionally match your library against your own YouTube Music Takeout CSV export, and browse everything through a visual shelf built around album covers, cartridge labels, and subtle audio-reactive motion.

Playback happens on a hardware-style deck: a live oscilloscope traces the actual waveform of whatever is playing, twin analog VU needles swing with the left and right channels, and a rotary amp knob shapes the level and low end. The visuals are driven by the real audio signal, not canned animation, so the panel breathes with the music.

The app is designed for local playback and private organization. It does not download music, scrape streaming services, run ads, require an account, or send your listening library to a server.
```

### Keywords

```text
music,player,local,audio,mp3,album,library,visualizer,cassette,oscilloscope,retro
```

## URLs

- Support URL: supportUrl=placeholder
- Privacy Policy URL: privacyPolicyUrl=placeholder
- Marketing URL: marketingUrl=placeholder
- Accessibility URL: accessibilityUrl=placeholder
- Third-Party Notices URL: thirdPartyNoticesUrl=placeholder
- Support contact: supportEmail=placeholder
- Public site archive: app-store-assets/public-site/cody-cartridge-public-site.zip
- Public site archive SHA-256: 8c58269676f6995a55c92d48e4ecd5c948af7c7b050e991068288dc929954de7

## App Review Notes

```text
Cody Cartridge is a local-first desktop music player. It plays files selected by the user through the macOS open panel or drag/drop. It can optionally read a user-provided YouTube Music Takeout CSV to match metadata against local files.

The app does not download music, scrape YouTube Music, access streaming accounts, provide copyrighted media, or transmit the user's library off device. Testers can use the picker flow with local audio files. Store screenshots are captured from `?store-demo=1`, which uses synthetic demo metadata only.

Sandbox file access is intentionally read-only and uses user-selected file/folder access plus security-scoped bookmarks for persistent playback access after picker imports.
```

## App Review Contact

- Name: reviewName=placeholder
- Email: reviewEmail=placeholder
- Phone: reviewPhone=placeholder

## Review Test Instructions

- Launch the app.
- Use File > Import Audio Files or File > Import Music Folder with user-owned local audio files.
- Treat picker imports as the primary sandbox-safe file access path; dropped paths in MAS builds are accepted only after they fall under a stored security-scoped bookmark.
- Optionally use File > Import YouTube Music Takeout with a user-provided CSV export.
- Confirm local playback, embedded artwork/metadata display, and missing-file visibility.
- Open Help > Privacy Summary, Privacy Policy, Support, Accessibility, and Third-Party Notices to confirm in-app policy, support, accessibility, and license disclosures are available.
- Use File > Reset Local Library and confirm local index data clears without deleting the source audio files.

Demo account: None. The app has no account system.

## TestFlight Beta Test Plan

- App Store Connect location: TestFlight > Test Information; TestFlight > Internal Testing > Build > What to Test
- Feedback email: supportEmail=placeholder
- Contact: reviewName=placeholder / reviewEmail=placeholder / reviewPhone=placeholder
- Demo account: None. The app has no account system, server login, subscription, or in-app purchase flow.

### Beta App Description

```text
Cody Cartridge is a local-first macOS music player for testing user-selected audio imports, embedded artwork and metadata display, YouTube Music Takeout CSV matching, visual shelf browsing, and sandboxed local playback.
```

### Recommended Tester Groups

- Internal: Store Smoke — small App Store Connect user group for signed-build install, import, playback, sandbox persistence, and reduced-motion checks.
- External: Private Beta — optional later group for non-team testers after TestFlight App Review approval; use only user-owned local audio test files.

### What To Test

- Install the macOS build through TestFlight and launch Cody Cartridge.
- Import user-owned audio with File > Import Audio Files and File > Import Music Folder.
- Confirm dropped local files import only when they are under an already selected bookmarked file or folder; use the picker for first-time sandbox access.
- Play, pause, seek, change tracks, and adjust volume from the hardware-style transport controls.
- Confirm embedded album art, title, artist, album, duration, bitrate, sample rate, and local source path appear where available.
- Import a user-provided YouTube Music Takeout CSV and confirm matched tracks, unmatched rows, and metadata confidence are visible.
- Quit and relaunch to confirm sandboxed read-only file access and app-scoped bookmarks preserve playable imported files.
- Enable macOS Reduce Motion and confirm visualizers/scroll effects calm down while playback and navigation remain usable.
- Open Help > Privacy Summary, Privacy Policy, Support, Accessibility, and Third-Party Notices from the macOS menu bar.
- Use File > Reset Local Library and confirm imported library state, Takeout rows, saved slots, playback state, and file-access bookmarks are cleared without deleting source audio files.
- Confirm there is no music download, scraping, streaming-account login, analytics, ads, or server upload flow.

### Mac Acceptance Checklist

- Clean macOS user account can install and launch the TestFlight build.
- Fresh library state shows an empty archive without errors or network/account prompts.
- User-selected local MP3/M4A/FLAC/WAV-family files import and play.
- Embedded artwork is used when present; missing artwork is represented without crashing.
- Takeout CSV import only affects local metadata matching and never downloads media.
- Quit/relaunch preserves imported file access for picker-selected files and folders.
- Keyboard playback shortcuts, catalog search, and shelf navigation work.
- Help menu Privacy Summary, Privacy Policy, Support, Accessibility, and Third-Party Notices open in the packaged app.
- File > Reset Local Library clears the local index and stored file-access bookmarks without deleting user audio files.
- Reduced Motion preference is respected.
- Privacy Summary and support/privacy URLs are accurate before external testers are invited.

### Build Handling

- Upload the signed MAS build to App Store Connect and wait for Apple processing before selecting it in TestFlight.
- Resolve any export-compliance or privacy-manifest warnings against the exact uploaded build.
- Add one build at a time to the internal test group and paste the What to Test text into the build notes.
- Use TestFlight before App Store submission to catch sandbox, entitlement, signing, and clean-account playback issues.
- Track the 90-day TestFlight availability window and expire superseded builds when testing is complete.

### Feedback Handling

- Monitor TestFlight Feedback screenshots, crashes, sessions, and written comments in App Store Connect.
- Use the feedback email as the fallback contact channel for testers.
- Convert blocking TestFlight findings into release-preflight fixes before submitting the App Store version.

## Privacy Answers

- Data collection: No, this app does not collect data from the app.
- Tracking: No tracking.
- Tracking domains: None.
- Data sent off device by developer app: None.
- Local data processed: Selected audio files, embedded tags/artwork, imported YouTube Music Takeout CSV rows, playback state, UI preferences, and security-scoped bookmarks.
- Privacy manifest: PrivacyInfo.xcprivacy declares no tracking, no collected data, and required-reason API use for local file metadata, app-local defaults, and system timing.

## Accessibility Nutrition Labels

- App Store Connect location: App Accessibility > Accessibility Nutrition Labels
- Accessibility URL: accessibilityUrl=placeholder
- Reduced Motion: Supported. The app reads the macOS/browser prefers-reduced-motion setting, disables the requestAnimationFrame visualizer loop, avoids smooth scrolling, and collapses CSS animation/transition durations.
- VoiceOver: Candidate support. Core controls use native buttons, range inputs, visible labels, aria-labels, and live status text; verify full VoiceOver task coverage on the signed MAS build before marking Supported.
- Keyboard access: Candidate support. Playback, seeking, catalog search, shelf navigation, and import flows are reachable with native controls and app shortcuts; verify on a clean macOS user account before submission.
- Larger Text: Not claimed yet. The interface uses fixed dense archive styling and should be tested with macOS display/text scaling before marking Larger Text support.
- Captions and audio descriptions: Not applicable. Cody Cartridge does not ship video content, spoken instructional media, or generated narration.

## Age Rating Candidate

- App Store Connect location: General > App Information > Age Ratings
- Expected rating: 4+ candidate; App Store Connect generates the final rating from Apple's questionnaire.

- No user-generated content or social features.
- No unrestricted web access.
- No gambling, contests, loot boxes, or in-app purchases currently configured.
- No medical, wellness, treatment, or regulated-device functionality.
- No mature, violent, sexual, drug, alcohol, tobacco, or horror content shipped by the app.
- User-selected local songs and album artwork are outside the app bundle; answer final content questions based on shipped app content and Apple review guidance.

## Pricing, Availability, And Release

- App Store Connect location: Monetization > Pricing and Availability
- Price: Free candidate for first release.
- Availability: All countries and regions candidate unless you choose a narrower launch region in App Store Connect.
- Tax category: General app/software candidate; confirm in App Store Connect before submission.
- Pre-order: No pre-order planned.
- Release option: Manual release after approval is recommended for the first submission so the signed MAS build can be smoke-tested before launch.
- First-version What's New: Not available for the first version in App Store Connect. Use product description, promotional text, and review notes for first-release context.

### Future What's New Draft

```text
Initial Mac App Store preparation for Cody Cartridge: local audio imports, embedded artwork and metadata, YouTube Music Takeout CSV matching, visual shelf browsing, reduced-motion support, and sandboxed read-only file access.
```

## Rights And Compliance

- Content rights: The app ships without music, does not download or scrape music, and plays only user-selected files the user is responsible for owning or having rights to use.
- Export compliance: Current draft: Cody Cartridge intentionally implements no custom or proprietary encryption and ships no network service. If App Store Connect treats platform security as encryption, classify it as encryption limited to that within the Apple operating system; Apple documents that no App Store Connect documentation is required for that case.
- Regulated medical device: No.
- Login required: No.
- In-app purchases: None currently configured.

## Export Compliance

- Artifact: `app-store-assets/EXPORT_COMPLIANCE.json`
- App Store Connect location: App Store Connect > App Information > App Encryption Documentation; also resolve any Missing Compliance prompt on the processed build.
- Draft questionnaire position: No app-provided custom/proprietary encryption is intentionally implemented. No custom encryption documentation is expected for the current local-first player build.
- Documentation expectation: No documentation expected when encryption is limited to that within the Apple operating system, based on Apple App Store Connect export-compliance documentation. Final determination belongs in App Store Connect for the uploaded binary.
- Final binary requirement: Answer App Store Connect export-compliance questions against the exact signed MAS binary uploaded to App Store Connect. If the binary gains custom cryptography, network features, account login, DRM, or encrypted media transfer before release, regenerate this artifact and re-answer the questionnaire.
- Apple source URLs: https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/, https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/

Binary facts:

- pass: No direct custom cryptography dependencies - Direct dependencies do not include known custom cryptography libraries.
- pass: No MAS network client entitlement - build/entitlements.mas.plist does not include com.apple.security.network.client.
- pass: Playback/artwork use app-local protocols - Runtime source uses cody-media:// for local audio and cody-art:// for embedded artwork.
- pass: No external URL launch path - Runtime source does not call shell.openExternal/openExternal.
- pass: No telemetry transport hooks - Runtime source does not use beacon/XMLHttpRequest telemetry APIs.
- pass: Remote URL literals are metadata-only - Only YouTube Music watch URLs appear as metadata references; the app does not open or fetch them.
- pass: Privacy manifest declares no tracking or collected data - build/PrivacyInfo.xcprivacy is present and declares no tracking/collected data categories.
- pass: Info.plist declares no non-exempt encryption - package.json build.mac.extendInfo sets ITSAppUsesNonExemptEncryption=false.
- pass: MAS sandbox file access is user-selected and read-only - MAS entitlements use read-only user-selected files, app-scope bookmarks, and inherited child sandboxing.

Release actions:

- Run npm run export-compliance:store before regenerating the submission packet.
- Run npm run check:export-compliance after npm run packet:store so generated App Store Connect fields stay aligned.
- During App Store Connect processing, resolve any Missing Compliance prompt against the final signed MAS upload.
- Save the App Store Connect export-compliance answer state with RELEASE_EVIDENCE.md and delivery logs.

## EU Digital Services Act

- App Store Connect location: Business / Compliance information > European Union Digital Services Act
- DSA status: Must be answered in App Store Connect before EU distribution. Confirm whether the developer account is a trader or non-trader under the EU DSA.
- Trader contact display: If marked as a trader, Apple requires verified address, phone number, and email contact details for display to EU customers on the App Store product page.
- Labels and markings URL: Optional labels and markings URL. Cody Cartridge does not currently require a product-safety label URL, but confirm this against the final account and distribution choices.
- Launch impact: If DSA status is incomplete, EU distribution may be blocked or require removal of EU availability until the account-level compliance entry is complete.

## Screenshot Inventory

- Manifest: `app-store-assets/screenshots/STORE_SCREENSHOTS.json` (3 screenshots, store-demo, 1440 x 900)
- App Store Connect spec: macOS Mac apps, 1-10 screenshots, 16:10, accepted sizes 1280 x 800, 1440 x 900, 2560 x 1600, 2880 x 1800 (https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- app-store-assets/screenshots/01-library-1440x900.png: 1440 x 900 · png · accepted Mac screenshot
- app-store-assets/screenshots/02-takeout-map-1440x900.png: 1440 x 900 · png · accepted Mac screenshot
- app-store-assets/screenshots/03-missing-files-1440x900.png: 1440 x 900 · png · accepted Mac screenshot

## Binary And Sandbox Notes

- MAS entitlements: `build/entitlements.mas.plist`
- Child entitlements: `build/entitlements.mas.inherit.plist`
- Privacy manifest: `build/PrivacyInfo.xcprivacy`
- Export compliance Info.plist key: `ITSAppUsesNonExemptEncryption=false`
- Network client entitlement: not enabled
- File access: sandboxed, user-selected read-only access with app-scoped bookmarks
- Packaged renderer protocol: `cody-app://`; `file://` renderer loading is not used in production builds
- Minimum macOS version: 12.0
- App source archive: app.asar enabled
- Package file allowlist: `dist/**/*`, `electron/**/*`, `package.json`
- Electron fuses: runAsNode=false, enableCookieEncryption=true, enableNodeOptionsEnvironmentVariable=false, enableNodeCliInspectArguments=false, enableEmbeddedAsarIntegrityValidation=true, onlyLoadAppFromAsar=true, loadBrowserProcessSpecificV8Snapshot=false, grantFileProtocolExtraPrivileges=false
- Privacy manifest source length: 1061 bytes

## Upload And App Review Submission

### Upload Handoff

- App Store Connect location: App Store Connect > Apps > Cody Cartridge > TestFlight or app version build upload/processing
- Artifact expectation: Use the signed Mac App Store installer package (.pkg) produced by npm run dist:mas after npm run release:store:preflight passes on the release machine. Inspect dist/ for the generated MAS app bundle and upload package before upload.

- Transporter app: deliver the signed MAS package to App Store Connect and review delivery logs, warnings, and errors.
- Xcode Organizer: upload a valid archive if you later move packaging into an Xcode archive flow.
- altool: validate and upload with xcrun altool --validate-app / --upload-app using the platform value required by the installed Xcode toolchain.
- App Store Connect API plus Transporter command line: optional automation path for a later CI/release machine.

### Upload Processing Checks

- Wait for App Store Connect processing to finish before selecting the build for TestFlight or App Review.
- Confirm the uploaded build resolves to bundle id com.sachittumuluri.codycartridge, version 0.1.0, and build 0.1.0.
- Resolve Missing Compliance, export-compliance, privacy-manifest, entitlement, or processing warnings against the exact uploaded binary.
- Save raw delivery logs outside the handoff archive, then run npm run upload-evidence:store with the log path and processed-build values to create sanitized UPLOAD_EVIDENCE.md.

### Build Selection

- App Store Connect location: App version > Build

- Only one uploaded build can be associated with this app version at submission time.
- After upload processing finishes, add the correct processed build to the macOS app version and save the version page.
- If the selected build has Missing Compliance status, answer the export compliance questions or provide required documentation before review.

### App Review Submission

- App Store Connect location: App version > Add for Review; App Review > Draft Submissions > Submit for Review

Pre-submit checklist:

- Public Support URL, Privacy Policy URL, support email, and App Review contact fields are real and reachable.
- The release machine has passed npm run check:release-runtime -- --strict with the Node 22 runtime selected.
- The generated public support/privacy site has passed npm run check:site -- --strict.
- The public site archive has passed npm run check:site-archive -- --strict and is ready to upload to the static host.
- The redacted release blocker report has been regenerated with npm run report:store-blockers and shows no blockers.
- The bundled Help document gate has passed with npm run check:help-docs.
- The Electron shell security gate has passed with npm run check:electron-security.
- The packaging toolchain gate has passed with npm run check:packaging-toolchain, confirming electron-builder and app-builder-lib load cleanly.
- The local MAS directory smoke gate has passed with npm run smoke:mas-dir during npm run release:store:local, confirming the unsigned app bundle layout reaches the expected signing boundary.
- The local-only packaged MAS runtime smoke gate has run during npm run release:store:local against a temporary ad-hoc signed copy of the MAS rehearsal bundle; concrete launch errors fail the gate, while silent local ad-hoc MAS launch hangs are recorded as advisory and final runtime proof is deferred to TestFlight/App Store delivery.
- The Electron shell runtime gate has passed with npm run smoke:electron-shell, including local audio import IPC and cody-media byte-range streaming.
- The App privacy gate has passed with npm run check:app-privacy, including local playback URL guards for audio analysis and playback.
- The App Store Connect copy map has been rebuilt with npm run copy-map:store and checked for limits, placeholders, and screen-by-screen coverage.
- The standalone App Review brief has been rebuilt with npm run review-brief:store and checked for review notes, test instructions, sandbox disclosures, contact placeholders, and no-download wording.
- The artifact privacy gate has passed with npm run check:artifact-privacy, confirming generated release artifacts do not include local paths, downloader references, temporary capture paths, or local music filenames.
- The App Store handoff archive has been rebuilt with npm run handoff:store and verified against its manifest.
- The isolated clean-profile reset gate has passed with npm run smoke:clean-profile.
- Product page copy, screenshot quality audit, age rating, privacy answers, pricing, availability, tax category, release option, and EU DSA status are complete.
- The production store-demo smoke gate has passed with npm run smoke:store, including poisoned localStorage URL sanitization, shelf rail alignment, and desktop layout stability.
- The production accessibility and Reduced Motion smoke gate has passed with npm run smoke:a11y.
- The App Store upload tooling gate has passed with npm run check:upload-tooling -- --strict.
- The App Store Connect upload credential gate has passed with npm run check:upload-credentials -- --strict.
- TestFlight internal smoke checklist has passed on a clean macOS user account.
- The selected build is the same signed MAS build that passed npm run verify:store:strict.

Submission steps:

- Open the macOS app version in App Store Connect and verify the Build section points to the intended processed build.
- Click Add for Review and create or choose the draft submission.
- Open Draft Submissions, review every included item, then click Submit for Review.
- After submission starts, monitor App Review messages and status changes in the App Review section.

Post-submit monitoring:

- Monitor App Review status, resolution center messages, build-processing warnings, and metadata notices in App Store Connect until the review is complete.
- Save App Review messages, delivery logs, release evidence, and the final RELEASE_MANIFEST.md with the submitted build notes.
- If Apple requests metadata, privacy, sandbox, entitlement, or binary changes, update the source artifact first, regenerate npm run packet:store, and rerun the strict preflight before resubmitting.
- Keep manual release selected for the first launch; after approval, smoke-test the approved build record and public support/privacy URLs before releasing.

### Post-Submission Handling

- If App Review reports metadata, sandbox, privacy, or binary issues, update the source artifact and regenerate npm run packet:store before resubmitting.
- If a new binary is required, increment the package/app build version before uploading another build.
- Keep manual release selected for the first launch until the approved build has been smoke-tested in App Store Connect.

## Required Commands Before Upload

```text
# Local dry run, safe before public URLs/signing assets are ready
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
npm run release:store:preflight
```

## Remaining Manual Items

- Replace public-site, support-email, and App Review contact placeholder states with real values before copying fields into App Store Connect.
- Run npm run init:store-env on the release machine to create ignored app-store-assets/site.env, then edit it with real public URL, support email, and App Review contact values.
- Run npm run configure:store-env with the real public URL, support email, and App Review contact values to validate and write ignored app-store-assets/site.env.local without printing raw contacts.
- Run npm run public-release:store -- --self-test before the public release refresh to prove release-value redaction and command-order invariants without using raw contacts.
- Run npm run public-release:store after real CODY_* values are set to regenerate the public site, archive, App Store fields, copy map, review brief, evidence, manifest, and handoff artifacts before signing.
- Run npm run public-release:store:published after the public site is uploaded to include strict Support/Privacy URL reachability checks.
- Run npm run check:release-runtime -- --strict on the release machine before packaging; .nvmrc and .node-version select Node 22, and package.json requires Node >=20 <25.
- Run npm run check:store-version after any package.json version change and after npm run packet:store to confirm package, lockfile, buildVersion, and generated App Store fields align.
- Run npm run app-compliance:store after npm run packet:store to refresh the standalone age rating, pricing, content-rights, export-compliance, and EU DSA packet.
- Run npm run review-brief:store after npm run packet:store to refresh the standalone App Review brief.
- Run npm run copy-map:store after npm run review-brief:store to refresh the screen-by-screen App Store Connect copy map with current App Review blocker state.
- Run npm run check:public-release-sync -- --strict after regenerating the site, archive, packet, copy map, and App Review brief to confirm public App Store fields match app-store-assets/site.env.
- Run npm run check:app-privacy after regenerating the packet to confirm privacy manifest categories, App Store privacy answers, policy docs, entitlements, local playback URL guards, and telemetry/ad SDK absence stay aligned.
- Run npm run export-compliance:store before npm run packet:store, then run npm run check:export-compliance after packet generation to confirm export-compliance answers, Apple source links, no-network entitlement state, and no-custom-crypto evidence stay aligned.
- Run npm run check:app-compliance after export-compliance validation to confirm compliance/admin answers are sourced from the generated packet and manual App Store Connect items are clearly marked.
- Run npm run check:store-copy after regenerating the packet to confirm App Store copy limits, keywords, review notes, privacy claims, and local-only/no-download wording.
- Run npm run check:artifact-privacy after npm run check:store-copy to confirm source and generated release artifacts do not leak local filesystem paths, downloader-site references, temporary capture paths, or local music filenames.
- Run npm run check:packaging-toolchain before MAS packaging to confirm electron-builder and app-builder-lib can load with the pinned CommonJS-compatible @noble/hashes dependency.
- Run npm run smoke:mas-dir during local release rehearsal to confirm the unsigned MAS app bundle layout and package-boundary checks before Apple signing assets are available.
- Run npm run smoke:mas-runtime only during local release rehearsal after npm run smoke:mas-dir; it applies a local ad-hoc runtime signature to a temporary copy of the unsigned rehearsal bundle and is not part of the signed upload preflight.
- Run npm run report:store-blockers after public URL/contact or signing changes and review app-store-assets/RELEASE_BLOCKERS.md before strict preflight.
- Run npm run public-inputs:store after npm run report:store-blockers to refresh app-store-assets/PUBLIC_RELEASE_INPUTS.md without leaking raw contact values.
- Run npm run publish-packet:store after npm run public-inputs:store to refresh app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md with the current archive, expected URLs, and public-site publish order.
- Run npm run public-host:store after npm run publish-packet:store to refresh app-store-assets/PUBLIC_HOST_RUNBOOK.md with the static hosting recipes and post-publish proof commands.
- Run npm run signing-runbook:store, npm run resolution-plan:store, npm run submission-checklist:store, and npm run machine-report:store after blocker/public-input updates so release-machine checklists and gate snapshots describe the same candidate.
- Run npm run evidence:store and npm run check:evidence immediately before npm run manifest:store so app-store-assets/RELEASE_EVIDENCE.md captures current command summaries and artifact hashes for the submitted build.
- Run npm run dashboard:store after npm run evidence:store to refresh app-store-assets/RELEASE_DASHBOARD.html for the release operator.
- Run npm run operator:store after npm run dashboard:store to refresh app-store-assets/RELEASE_OPERATOR_QUEUE.md for the release-machine first action and phase stop conditions.
- Run npm run check:manifest after npm run manifest:store, then run npm run handoff:store to build and verify the deterministic App Store handoff archive.
- Run npm run check:release-machine -- --strict after the handoff archive is refreshed to get one aggregate release-machine readiness verdict before npm run verify:store:strict.
- Upload app-store-assets/public-site/cody-cartridge-public-site.zip contents to the static host, or publish the generated app-store-assets/site directory directly, after npm run check:site-archive -- --strict, npm run publish-packet:store, and npm run public-host:store pass.
- Publish the generated support/privacy pages and run npm run check:store-urls -- --strict to confirm the public App Store URLs are reachable and contain the expected Cody Cartridge content.
- Run npm run check:published-site -- --strict after publishing to confirm every PUBLIC_SITE_PUBLISH_PACKET page is live and matches the generated source.
- Confirm bundle id com.sachittumuluri.codycartridge exists in Apple Developer and App Store Connect.
- Install Apple Distribution/Mac App Distribution and Mac Installer Distribution signing assets plus a matching macOS/Mac App Store provisioning profile.
- Run npm run check:mas-package -- --strict after MAS packaging to confirm bundle resources, app.asar contents, Electron fuses, Info.plist trimming, embedded provisioning profile, signed current-version installer package, and signed entitlements before upload.
- Run npm run check:upload-tooling -- --strict after MAS packaging to confirm Transporter, altool, or iTMSTransporter is available and a signed Cody/Cartridge MAS .pkg upload artifact exists before upload.
- Run npm run check:upload-credentials -- --strict after upload-tooling passes to confirm App Store Connect API credential posture without writing secrets into artifacts.
- Run npm run upload-packet:store after upload-tooling and upload-credential checks pass; use app-store-assets/UPLOAD_COMMAND_PACKET.md to confirm the package hash and upload path before entering Apple credentials.
- Upload the signed MAS build, answer export-compliance questions using the final binary, then reconcile any ITMS privacy-manifest warnings.
- Wait for App Store Connect build processing, select the processed build on the macOS app version, then add the app version to a draft submission.
- Confirm EU Digital Services Act trader/non-trader status and any required trader contact details in App Store Connect before enabling EU availability.
- Set pricing, tax category, availability, and manual release option in App Store Connect before submitting for review.
- Create a TestFlight internal test group, add the processed signed build, paste the What to Test notes, and complete the Mac acceptance checklist before App Store submission.
- Publish third-party-notices.html with the support site if you want a public dependency-license notice page for review transparency.
- Regenerate app-store-assets/UPLOAD_COMMAND_PACKET.md, app-store-assets/UPLOAD_EVIDENCE.md, app-store-assets/RELEASE_BLOCKERS.md, app-store-assets/RELEASE_EVIDENCE.md, and app-store-assets/RELEASE_MANIFEST.md on the release machine after MAS packaging; keep raw delivery logs outside the handoff archive.
- Run the app from the signed MAS build on a clean macOS user account before submitting for review.

## Source Policies

### Privacy Policy Draft

# Cody Cartridge Privacy Policy Draft

Last updated: June 19, 2026

Cody Cartridge is a local-first music player for macOS. It is designed to play and organize audio files that you select on your Mac.

## Data Collection

Cody Cartridge does not collect personal data from the app and does not transmit your music library, listening history, imported metadata, or local file paths to a server controlled by the developer.

## Local Data The App Uses

The app can process the following data locally on your Mac:

- Audio files you select or drag into the app
- Embedded audio tags such as title, artist, album, duration, bitrate, and sample rate
- Embedded album artwork
- YouTube Music Takeout CSV files that you explicitly import
- Local playback and interface preferences such as current track, shelf view, volume, and saved slots
- Security-scoped bookmarks that allow the app to keep read-only access to files or folders you selected through the macOS picker

This local data is used to provide playback, metadata display, library matching, and the visual music archive interface.

## Tracking And Advertising

Cody Cartridge does not track you across apps or websites. It does not include advertising SDKs, analytics SDKs, data broker integrations, or third-party tracking domains.

## Network Use

Cody Cartridge does not require an account or server connection for its core library and playback features. The app is intended to work with local files and user-provided exports.

## Music And Copyright

Cody Cartridge does not provide, download, scrape, or redistribute music. You are responsible for importing audio files that you have the right to use.

## Data Deletion

You can remove local library state and stored file-access bookmarks from inside the app with File > Reset Local Library. This clears Cody Cartridge's local index, imported Takeout rows, saved slots, playback state, and security-scoped bookmarks. Your audio files remain untouched on disk.

## Contact

Pending release value: set `CODY_SUPPORT_EMAIL` and publish the support page before App Store submission.

### Support Draft

# Cody Cartridge Support Draft

Cody Cartridge is a local-first macOS music player for user-selected audio files.

## Contact

Pending release value: set `CODY_SUPPORT_EMAIL` before App Store submission.

## Common Questions

### Does Cody Cartridge download music?

No. Cody Cartridge does not download, scrape, or redistribute music. Import audio files that you already own and have the right to use.

### Where is my library stored?

The app stores playback and library state locally on your Mac. Audio files stay in their original location. In sandboxed Mac App Store builds, Cody Cartridge uses macOS security-scoped bookmarks to retain read-only access to files and folders you selected through the picker.

### Does it require a YouTube Music account?

No. YouTube Music Takeout CSV import is optional and only uses CSV files you provide. The app does not sign in to YouTube Music or access streaming accounts.

### How do I import music?

Use File > Import Audio Files or File > Import Music Folder. You can also drag local audio files into the app.

### How do I import YouTube Music metadata?

Export your YouTube Music library from Google Takeout, then use File > Import YouTube Music Takeout and choose the Takeout CSV or folder.

### What audio formats are supported?

Cody Cartridge currently scans common local audio formats including MP3, M4A, AAC, FLAC, WAV, OGG, OPUS, AIFF, and AIF.

### How do I reset the app's local library?

Use File > Reset Local Library. This clears Cody Cartridge's local index, imported YouTube Music Takeout rows, saved slots, playback state, and stored file-access bookmarks. It does not delete or modify your audio files.

### Accessibility Draft

# Cody Cartridge Accessibility

Cody Cartridge is a local-first desktop music player with a dense archive interface. This page documents the accessibility support that should be verified before submitting the app to App Store Review.

## Reduced Motion

- Cody Cartridge respects the macOS/browser Reduced Motion preference.
- When Reduced Motion is active, the app stops the frame-driven visualizer loop, avoids smooth scrolling, shortens CSS animations, and prevents repeated motion effects from looping.
- Audio playback and library navigation remain available when motion is reduced.

## Keyboard And Screen Reader Support

- The player uses native buttons and range inputs for core playback, seeking, volume, and catalog search controls.
- Core controls include visible labels, `aria-label` text, and live status text for the current player state.
- Verify common tasks with VoiceOver on the signed Mac App Store build before marking VoiceOver support in App Store Connect.

## Not Claimed Yet

- Larger Text support is not claimed yet. The current interface is intentionally compact and should be tested with macOS display and text scaling first.
- Captions and audio descriptions are not applicable because Cody Cartridge does not ship video content, spoken instructional media, or generated narration.

## Contact

Pending release value: set `CODY_SUPPORT_EMAIL` before App Store submission.
