# Cody Cartridge App Store Readiness

This app is being shaped as a local-first Mac music player. It should import and play user-selected local audio files, read embedded metadata/artwork, and optionally match those files against user-provided YouTube Music Takeout CSV metadata. It must not scrape, download, or redistribute music.

## Current Direction

- Desktop target: Mac App Store-compatible Electron build.
- Media source: files the user already owns and selects locally.
- Metadata source: embedded audio tags plus user-provided Takeout CSV rows.
- Storage posture: local-only app state in browser storage and security-scoped file bookmarks in Electron user data.

## MAS Packaging Baseline

- `npm run dist:mas` builds the MAS target.
- `npm run dist:mas-dev` builds the MAS development target.
- `npm run check:mas-signing` checks the local keychain and installed provisioning profiles for MAS signing readiness.
- `npm run signing-assets:store` generates and checks a redacted signing asset report with identity/profile readiness counts and no certificate names, profile UUIDs, local profile paths, or Apple account values.
- `npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run` validates a downloaded MAS provisioning profile before installation; keep the profile source file outside the project and handoff archive, and omit `--dry-run` only on the release machine after it confirms the bundle id, macOS distribution posture, expiration, expected sandbox/file-access entitlements, and safe non-symlinked install destination.
- `npm run check:mas-package` checks the generated MAS `.app` boundary in advisory mode: required bundled resources, `app.asar` contents, packaged `Info.plist`, Electron fuse state, and code-signature state when a bundle is present.
- `npm run check:store-version` validates package version, explicit `build.buildVersion`, package-lock version alignment, and generated App Store fields.
- `npm run version:store -- <x.y.z>` updates `package.json`, `package-lock.json`, and `build.buildVersion` together for the next App Store upload.
- `npm run notices:store` generates third-party dependency notice JSON and Markdown from the current `package-lock.json`.
- `npm run packet:store` generates App Store Connect copy/paste fields, review notes, privacy answers, compliance notes, and screenshot inventory.
- `npm run packet:store` also generates TestFlight beta description, feedback contact, What to Test notes, tester-group guidance, and a clean-account Mac acceptance checklist.
- `npm run packet:store` also generates upload handoff, build selection, App Review draft submission, and post-submission monitoring notes.
- `npm run app-compliance:store` generates and checks a standalone App Store compliance packet for age rating, App Privacy, pricing/availability, content rights, export compliance, login/IAP/medical status, EU DSA manual/account tasks, the App Store Connect manual task packet, and the content-rights/media audit.
- `npm run manual-tasks:store` generates and checks `APP_STORE_CONNECT_MANUAL_TASKS.json` and `.md`, a redacted account-side checklist for App Store Connect app record, product page, privacy/compliance, TestFlight, App Review, and build-selection work.
- `npm run content-rights:store` generates and checks `APP_CONTENT_RIGHTS.json` and `.md`, proving the release candidate ships without bundled media, has no downloader dependencies, keeps Takeout metadata-only, and uses local user-selected playback.
- `npm run copy-map:store` generates and checks a screen-by-screen App Store Connect copy map from the packet JSON, including required/optional status, field limits, placeholders, and copy blocks.
- `npm run review-brief:store` generates and checks a standalone App Review brief from the packet JSON, including review notes, demo-account status, sandbox file-access instructions, Help document checks, no-download/no-scraping disclosure, and contact placeholders.
- `npm run check:public-release-sync` verifies that generated App Store fields, public-site archive metadata, and generated support/privacy site HTML match the current `CODY_*` release env values. Use `npm run check:public-release-sync -- --strict` on the release machine after real public values are set.
- `npm run report:store-blockers` and `npm run submission-checklist:store` surface that strict public-release sync result as an explicit release blocker / Add for Review gate.
- `npm run manifest:store` generates release-manifest JSON and Markdown with package metadata, public URL values, release-file hashes, screenshot hashes, generated-site hashes, MAS bundle presence, and explicit MAS submission posture for embedded provisioning, code signature verification, signed upload package inventory, and local-rehearsal-only state.
- `npm run report:store-blockers` generates redacted release-blocker JSON and Markdown summarizing public-site/contact, signing, MAS package, and final submission blockers.
- `npm run signing-runbook:store` generates and checks a release-machine signing/upload runbook from current package metadata, blocker state, and the redacted signing asset report, including a signing remediation checklist for bundle ID, application identity, installer identity, provisioning profile posture, entitlement confirmation, and signing-secret exclusion.
- `npm run resolution-plan:store` generates and checks an ordered release-machine blocker resolution plan from the current blocker report and signing/upload runbook.
- `npm run submission-checklist:store` generates and checks the final App Store Connect Add for Review / Submit for Review checklist from packet, copy-map, review brief, blocker, runbook, and resolution-plan artifacts.
- `npm run dashboard:store` generates and checks a redacted release-operator dashboard HTML/JSON status artifact from the blocker report, public inputs, final checklist, and release evidence, including the current MAS submission posture.
- `npm run operator:store` generates and checks a redacted release-machine operator queue from the dashboard, blocker report, runbook, resolution plan, final checklist, and MAS submission posture.
- `npm run machine-report:store` generates and checks a redacted release-machine gate report with public env, public sync, runtime, package toolchain, URL, signing, MAS package, upload-tooling, upload-credential, and blocker-report outcomes.
- `npm run upload-evidence:store` generates sanitized upload-evidence JSON and Markdown from Transporter/altool/Xcode delivery logs without storing raw logs, Apple account values, API keys, signing material, or local paths. Run it with `-- --log /path/to/transporter.log --tool transporter --status selected --processed-bundle-id com.sachittumuluri.codycartridge --processed-version 0.1.0 --processed-build 0.1.0` after App Store Connect processing selects the build; the artifact records explicit selected-build proof for the macOS app version's Build field.
- `npm run check:upload-evidence` validates the sanitized upload evidence; advisory mode allows pending pre-upload evidence, while release operators should attach delivery logs and processed-build proof before final archive freeze.
- `npm run upload-packet:store` writes and checks `app-store-assets/UPLOAD_COMMAND_PACKET.json` and `.md` with the selected MAS `.pkg` path, SHA-256, signature state, current package version/build match, available upload tools, upload credential preflight status, and post-upload evidence command. It prefers a signed current-version package and keeps stale signed `.pkg` artifacts blocked until the current package is signed. It stores credential placeholders only; Apple account values, API keys, signing secrets, provisioning profiles, and raw delivery logs stay outside the repo and handoff archive.
- `npm run evidence:store` generates redacted release-evidence JSON and Markdown with current command summaries, blocker state, sanitized upload evidence, and artifact hashes to keep beside private App Store delivery logs.
- `npm run handoff:store` builds and verifies a deterministic App Store handoff ZIP containing generated packet fields, screenshots, policy/support docs, release evidence, release machine report, release blocker report, release manifest, and the public-site archive.
- `npm run check:release-machine` runs the aggregate release-machine doctor in advisory mode across public env, public release sync, runtime, version, package toolchain, public URLs, MAS signing, MAS package, upload tooling, upload credentials, and the current blocker report.
- `npm run init:store-env` creates the ignored `app-store-assets/site.env` release-machine file from `app-store-assets/site.env.example` without overwriting an existing file unless `-- --force` is passed.
- `npm run configure:store-env -- --site-url https://... --support-email ... --review-name ... --review-email ... --review-phone ...` validates release contact values and writes the ignored `app-store-assets/site.env.local` overlay with `0600` permissions without printing raw contacts; the writer quotes and escapes values so contact names/phones with spaces or shell-sensitive characters stay one-line and parseable.
- `npm run public-release:store -- --self-test` validates public-release redaction and command ordering with synthetic values only.
- `npm run public-release:store -- --dry-run` prints the public-release refresh plan and current `CODY_*` readiness without regenerating artifacts.
- `npm run public-release:store` validates real public/contact inputs, regenerates the public site, archive, App Store fields, compliance packet, copy map, App Review brief, release evidence, manifest, and handoff archive, then runs the advisory store verifier.
- `npm run public-release:store:published` does the same refresh and also runs strict published URL and full public-site page checks before signing work.
- `npm run public-release:store:node` and `npm run public-release:store:published:node` run those refresh paths through the Node version selected by `.nvmrc`; pass flags after `--`, for example `npm run public-release:store:node -- --self-test`.
- `npm run public-inputs:store` generates and checks a redacted public release-input packet listing every `CODY_*` URL/contact value required before strict preflight.
- `npm run site:archive` creates a deterministic ZIP of the generated public support/privacy/accessibility/notices site plus a JSON manifest with entry hashes and App Store URL values.
- `npm run smoke:electron-shell` builds the production app, launches the real Electron main process against the custom `cody-app://` renderer protocol, and verifies native menu wiring, preload bridge methods, production protocol loading, renderer readiness, local audio import IPC, byte-range media streaming, and custom app/media/art protocol rejection behavior.
- `npm run smoke:clean-profile` builds the production app, launches the Electron shell with an isolated temporary user-data directory, seeds renderer local storage plus a fake security-scoped bookmark file, then verifies the reset plumbing clears both.
- `npm run smoke:store` builds the production app, launches the generated store-demo surfaces in Electron, checks for runtime/console errors, verifies desktop layout stability, verifies the shelf rail stays mechanically centered, samples captured pixels to catch blank render regressions, and proves poisoned localStorage cannot load a remote playback URL.
- `npm run smoke:mas-dir` builds an unsigned MAS directory bundle, accepts only the expected local signing-boundary stop, and runs the advisory MAS package-boundary check against the produced `.app`.
- `npm run smoke:mas-runtime` is a local-only rehearsal after `npm run smoke:mas-dir`: it copies the unsigned MAS bundle to a temporary directory, applies an ad-hoc runtime signature only to that copy, and attempts a packaged launch with an isolated profile. Concrete launch errors fail the gate; a silent local ad-hoc MAS launch hang is recorded as advisory because final runtime proof must come from TestFlight/App Store delivery.
- `npm run export-compliance:store` builds and checks `app-store-assets/EXPORT_COMPLIANCE.json` plus `.md`, using Apple App Store Connect export-compliance guidance, current MAS entitlements, `ITSAppUsesNonExemptEncryption=false`, direct dependencies, runtime URL use, and privacy-manifest evidence.
- `npm run verify:store` snapshots any existing `dist/mas-*` MAS bundle directories and `.pkg` upload artifacts, runs a production build, restores those MAS artifacts, then runs the local App Store readiness gate. It warns when App Store screenshots are older than renderer UI sources or the screenshot capture script.
- `npm run release:store:local` runs the non-credentialed local dry-run: source/runtime checks, public-release wrapper self-test, icon audit, Electron security, notices/site generation, public-site archive generation, Help document verification, Electron shell runtime smoke, clean-profile/reset smoke, production UI smoke with poisoned localStorage URL sanitization, accessibility smoke, screenshot generation and quality audit, unsigned MAS directory smoke, packaged MAS runtime smoke, export-compliance prep, packet generation, compliance packet generation, copy-map generation, App Review brief generation, advisory public release sync, App privacy/export-compliance/compliance/copy/artifact privacy validation, advisory public URL, MAS signing, redacted signing asset report, package-boundary, upload-tooling, and upload-credential reports, upload command packet generation, sanitized upload evidence generation, redacted blocker report, public release-input packet generation, public-site publish packet generation, signing/upload runbook generation, release resolution plan generation, final submission checklist generation, release machine report generation, checked release evidence, release dashboard generation, release manifest validation, deterministic handoff archive generation, aggregate release-machine doctor, and the normal store verifier. Screenshot refresh, MAS directory/runtime smoke, and export-compliance prep run before packet generation so the packet is fresh against current screenshot, package, and compliance evidence.
- `npm run check:store-env` fails early when real public site, support email, or App Review contact values are missing from ignored `app-store-assets/site.env` or shell env; loaded env files must be regular files with private permissions.
- `npm run check:app-privacy` validates the privacy manifest, generated App Store privacy answers, privacy/support/listing claims, MAS entitlements, packaged privacy resource configuration, local playback URL guards, and absence of telemetry/ad SDK dependencies or runtime hooks.
- `npm run check:export-compliance` validates the generated export-compliance prep artifact, Apple source links, no-network-entitlement state, direct custom-crypto dependency absence, and App Store Connect field alignment after packet generation.
- `npm run check:app-compliance` validates `app-store-assets/APP_STORE_COMPLIANCE.json` and `.md`, including age-rating rationale, App Privacy answers, manual pricing/availability items, content-rights wording, export-compliance linkage, EU DSA manual status, and no-login/no-IAP/no-medical answers.
- `npm run check:store-copy` validates App Store listing source against generated App Store Connect fields, field limits, keyword formatting, review-note claims, privacy wording, and local-only/no-download/no-scraping language.
- `npm run check:artifact-privacy` scans source and generated release artifacts for real local home paths, Desktop music/Takeout paths, downloader-site references, temporary macOS capture paths, and local music filenames before App Store handoff.
- `npm run check:release-runtime` validates the source-controlled release runtime contract: `package.json` and `package-lock.json` require Node `>=20 <25`, `.nvmrc` selects Node 22, and `.node-version` matches it. In local mode it warns if the current shell is outside that range; use `npm run check:release-runtime -- --strict` on the signed release machine to fail early before package/signing work.
- `npm run release:node -- <command>` runs any release command through the Node version selected by `.nvmrc` via `nvm exec`, without changing the machine's global `nvm` default. Use it when the shell still defaults to Node 18, for example `npm run release:node -- npm run check:release-runtime -- --strict` or `npm run release:node -- npm run release:store:preflight`.
- `npm run release:store:local:node`, `npm run release:store:preflight:node`, `npm run check:release-machine:node -- --strict`, and `npm run verify:store:strict:node` are copy-paste-safe wrappers for the main local and release-machine gates when the current shell is not already on the `.nvmrc` release runtime.
- `npm run check:packaging-toolchain` validates the Electron Builder toolchain before MAS packaging, including the pinned CommonJS-compatible `@noble/hashes` override, the `app-builder-lib` blockmap require path, and the local `electron-builder` CLI load path.
- `npm run check:electron-security` validates Electron shell hardening: sandboxed renderers, context isolation, disabled Node integration, trusted-renderer IPC guards, MAS-aware renderer path filtering, bookmark-gated custom media/art protocols, denied permission prompts, denied popups, guarded navigation, CSP, and hardened MAS runtime flags.
- `npm run check:site` validates generated static support/privacy/accessibility/notices pages, navigation links, document structure, and publish placeholders. Use `npm run check:site -- --strict` on the release machine after real public URL/contact values are set.
- `npm run check:site-archive` validates `app-store-assets/public-site/cody-cartridge-public-site.zip` against the generated public site and `PUBLIC_SITE_ARCHIVE.json`; use `npm run check:site-archive -- --strict` before uploading the archive to a static host.
- `npm run publish-packet:store` writes and checks `app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json` and `.md` with the static files to publish, expected public URLs, static-host config files, archive hashes, placeholder state, and current release blocker queue. `npm run check:publish-packet -- --strict` should pass after the public origin/support values are configured and the archive is ready.
- `npm run check:store-urls` validates published App Store support/privacy URLs in advisory mode. Use `npm run check:store-urls -- --strict` on the release machine after the generated site is public; it fails if required URLs are missing, unreachable, or do not contain the expected Cody Cartridge content.
- `npm run check:published-site` validates every page listed in `PUBLIC_SITE_PUBLISH_PACKET.json` in advisory mode. Use `npm run check:published-site -- --strict` after publishing; it fails if any public page is missing, non-HTTPS, non-HTML, missing expected text, or no longer matches the generated source.
- `npm run check:help-docs` validates the Help menu document surface: bundled privacy/support/accessibility/notices markdown, Electron Help menu mappings, generated public site counterparts, document-window CSP/navigation guards, and privacy-summary wording.
- `npm run smoke:a11y` builds the production app, launches a Reduced Motion store-demo surface, verifies focusable control labels, range labels, keyboard search, shelf navigation, and reduced-motion shell state.
- `npm run verify:store:strict` runs the release-machine gate after a MAS package exists through the Node version selected by `.nvmrc`. It fails on placeholder public URLs/contact details, missing signing assets, missing MAS bundle/package, unverifiable code signature, missing upload tooling, or missing upload credential posture.
- `npm run check:screenshots` validates generated App Store screenshot PNG dimensions, pixel variance, contrast, file size, duplicate hashes, and the screenshot provenance manifest.
- `npm run release:store:preflight` runs the full release sequence for the submission machine: env check, strict release-runtime check, source-version check, public-release wrapper self-test, icon audit, Electron security check, third-party notices, site, strict site validation, public-site archive generation and strict archive validation, Help document check, Electron shell smoke, clean-profile/reset smoke, production store smoke with poisoned localStorage URL sanitization, accessibility smoke, screenshots plus quality audit, export-compliance prep, packet, compliance packet generation, copy-map generation, App Review brief generation, strict public release sync, App privacy validation, export-compliance validation, compliance packet validation, App Store copy validation, artifact privacy validation, strict public URL reachability check, redacted signing asset report, strict signing preflight, MAS packaging, strict package-boundary inspection, strict upload-tooling inspection, strict upload-credential inspection, upload command packet generation, sanitized upload evidence generation, release blocker report, public release-input packet generation, public-site publish packet generation, signing/upload runbook generation, release resolution plan generation, final submission checklist generation, release machine report generation, checked release evidence, release manifest validation, handoff archive generation, aggregate release-machine doctor, then strict store verification.
- Packaging requires Node `>=20 <25`; `.nvmrc` and `.node-version` select Node 22 for the release machine, while verification can still run under compatible newer bundled runtimes. If the shell default is not Node 22, use `npm run release:node -- <command>` for final release commands instead of changing the global `nvm` default.
- Bundle id is currently `com.sachittumuluri.codycartridge`; confirm this exact id in Apple Developer and App Store Connect before signing.
- Package version and build version are currently `0.1.0`; `build.buildVersion` is explicit so `CFBundleVersion` does not drift from release-machine environment variables.
- Minimum macOS version is explicitly set to `12.0` for Mac, MAS, and MAS-dev targets so the packaged `LSMinimumSystemVersion` is source-controlled.
- App code is explicitly packaged into `app.asar`.
- Electron package fuses are source-controlled: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, Node inspector CLI arguments, file-protocol extra privileges, and the browser-process-specific V8 snapshot are disabled; cookie encryption, embedded ASAR integrity validation, and only-load-from-ASAR are enabled.
- The packaged renderer loads through the custom `cody-app://` protocol instead of `file://`, and `grantFileProtocolExtraPrivileges` is disabled.
- The renderer CSP allows only the app, artwork, and media protocols needed by the local player; it no longer grants `file:` resource access.
- The packaged app file allowlist is restricted to `dist/**/*`, `electron/**/*`, and `package.json`; local music files, Takeout exports, screenshots, support-site files, and release drafts are not bundled into the app archive.
- App icon assets are generated from `build/generate-icon.py` into `build/icon.png` and `build/icon.icns`.
- `npm run check:icons` validates `build/icon.png`, every generated `build/icon.iconset/*.png` point/scale size, and `build/icon.icns`.
- Mac App Store screenshot drafts are generated by `npm run screenshots:store` into `app-store-assets/screenshots/`, alongside `app-store-assets/screenshots/STORE_SCREENSHOTS.json` with each screenshot's store-demo query, viewport, byte size, SHA-256 hash, accepted Mac screenshot size, and the Apple screenshot-specification source URL.
- Store listing copy and review notes live in `app-store-assets/APP_STORE_LISTING.md`.
- Privacy policy draft lives in `app-store-assets/PRIVACY_POLICY.md`.
- Support page draft lives in `app-store-assets/SUPPORT.md`.
- Accessibility page draft lives in `app-store-assets/ACCESSIBILITY.md`.
- Third-party notice drafts live in `app-store-assets/THIRD_PARTY_NOTICES.json` and `app-store-assets/THIRD_PARTY_NOTICES.md`.
- Export Compliance Prep lives in `app-store-assets/EXPORT_COMPLIANCE.json` and `app-store-assets/EXPORT_COMPLIANCE.md`.
- Static privacy/support/accessibility/notices site files are generated by `npm run site:store` into `app-store-assets/site/`.
- Public support and App Review contact values can be set by running `npm run configure:store-env -- --site-url https://... --support-email ... --review-name ... --review-email ... --review-phone ...`, by running `npm run init:store-env` and editing ignored `app-store-assets/site.env`, by adding an ignored `app-store-assets/site.env.local` overlay, or by passing `CODY_SUPPORT_EMAIL`, `CODY_SITE_URL`, `CODY_REVIEW_CONTACT_NAME`, `CODY_REVIEW_CONTACT_EMAIL`, and `CODY_REVIEW_CONTACT_PHONE` in the shell. `CODY_SITE_URL` must be the final HTTPS origin only, with no path, query string, or fragment. Precedence is shell env, then `site.env.local`, then `site.env`.
- Submission packet files are generated by `npm run packet:store` into `app-store-assets/SUBMISSION_PACKET.md` and `app-store-assets/APP_STORE_CONNECT_FIELDS.json`.
- Release manifest files are generated and checked by `npm run manifest:store` into `app-store-assets/RELEASE_MANIFEST.json` and `app-store-assets/RELEASE_MANIFEST.md`; `npm run check:manifest` verifies manifest metadata, file hashes, release commands, and MAS posture.
- Release machine report files are generated and checked by `npm run machine-report:store` into `app-store-assets/RELEASE_MACHINE_REPORT.json` and `app-store-assets/RELEASE_MACHINE_REPORT.md`; `npm run check:machine-report` verifies gate structure, blocker counts, next action, and redaction.
- Release evidence files are generated and checked by `npm run evidence:store` into `app-store-assets/RELEASE_EVIDENCE.json` and `app-store-assets/RELEASE_EVIDENCE.md`; `npm run check:evidence` verifies command summaries, artifact hashes, redaction, and MAS posture.
- The submission packet includes field-limit counts for promotional text, description, keywords, and App Review notes.
- Native macOS menu actions are wired for importing audio files, importing folders, importing YouTube Music Takeout CSVs, and playback controls.
- File > Reset Local Library clears local renderer state and stored security-scoped bookmarks without deleting user audio files.
- MAS signing uses `build/entitlements.mas.plist`.
- Child helper signing uses `build/entitlements.mas.inherit.plist`.
- Entitlements are intentionally narrow: sandbox, user-selected read-only files, app-scoped bookmarks, and Electron runtime permissions. In MAS builds, renderer-provided import paths and custom `cody-media` / `cody-art` playback/artwork paths must resolve under stored security-scoped bookmarks.
- `build/PrivacyInfo.xcprivacy` is bundled as a resource and currently declares no tracking, no collected data, and required-reason API use for local file metadata, app-local defaults, and system timing.
- Generated privacy policy, support, accessibility, and third-party notice documents are bundled as read-only resources and exposed through the Help menu in the packaged app.
- Packaged `Info.plist` is trimmed so unused camera, microphone, Bluetooth, and arbitrary network-load declarations are removed.
- Packaged `Info.plist` sets `ITSAppUsesNonExemptEncryption=false`, matching the generated export-compliance prep artifact for the current no-custom/non-exempt-encryption build.
- Local packaging currently reaches the signing phase. A real MAS build still needs Apple signing identities and a macOS/Mac App Store provisioning profile. Use `npm run check:mas-signing -- --strict` after those are installed.

## Local Verification Gates

- `npm run build`: TypeScript and Vite production build.
- `npm run init:store-env`, then edit the generated file with real public values. `app-store-assets/site.env` is ignored.
- `npm run configure:store-env -- --dry-run --site-url https://... --support-email ... --review-name ... --review-email ... --review-phone ...`: validates the final public/contact values without writing them.
- `npm run configure:store-env -- --site-url https://... --support-email ... --review-name ... --review-email ... --review-phone ...`: writes the ignored `app-store-assets/site.env.local` overlay after validation; the script keeps file permissions at `0600`, quotes and escapes the saved values, and does not print raw contacts.
- `npm run public-release:store -- --self-test`: proves public-release refresh redaction and command order with synthetic values before real contacts are used.
- `npm run public-release:store -- --dry-run`: prints the public-release refresh plan and release-env readiness without changing artifacts.
- `npm run public-release:store`: after real `CODY_*` values are configured, regenerates and strictly validates the public site/archive/App Store field set before signing work.
- `npm run public-release:store:published`: run after publishing the generated public site; includes strict URL reachability and packet-wide published-site checks before signing work.
- `npm run public-release:store:node` and `npm run public-release:store:published:node`: Node-safe variants for release machines whose shell default Node does not match `.nvmrc`.
- `npm run check:store-env`: release-machine gate; validates `CODY_SITE_URL` as an HTTPS origin with no path/query/fragment plus `CODY_SUPPORT_EMAIL`, `CODY_REVIEW_CONTACT_NAME`, `CODY_REVIEW_CONTACT_EMAIL`, and `CODY_REVIEW_CONTACT_PHONE` before generating final site/packet artifacts, preserves shell-provided values over env-file values, lets `site.env.local` override `site.env`, and requires loaded `site.env` files to be regular private files such as `0600`.
- `npm run check:store-version:source`: validates source package/build version metadata before long-running release work.
- `npm run check:store-version`: validates source package/build version metadata plus generated App Store Connect fields after `npm run packet:store`.
- `npm run version:store -- 0.1.1`: example helper for a future upload; updates package version, package-lock version, and `build.buildVersion` together.
- `npm run check:app-privacy`: validates `build/PrivacyInfo.xcprivacy`, App Store privacy fields, privacy/support/listing language, MAS sandbox/file entitlements, packaged privacy resource configuration, local playback URL guards for audio analysis/playback, known telemetry/ad SDK dependencies, and runtime source hooks such as beacons or external URL opens.
- `npm run export-compliance:store`: builds App Store Connect export-compliance prep from package metadata, MAS entitlements, direct dependencies, local runtime URL posture, and Apple source links.
- `npm run check:export-compliance`: validates the export-compliance prep artifact and confirms `APP_STORE_CONNECT_FIELDS.json` and `SUBMISSION_PACKET.md` carry the same draft answer after packet generation.
- `npm run app-compliance:store`: builds `app-store-assets/APP_STORE_COMPLIANCE.json` and `.md` from the generated App Store fields plus export-compliance prep. It separates code-proven answers from manual App Store Connect/account tasks such as pricing, availability, release option, tax category, and EU DSA status, then refreshes the manual task packet and content-rights/media audit.
- `npm run check:app-compliance`: validates the standalone compliance packet and confirms manual compliance/admin tasks remain explicitly marked instead of being treated as completed by code.
- `npm run manual-tasks:store`: builds `app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json` and `.md` as the redacted account-side checklist for manual App Store Connect entry.
- `npm run check:manual-tasks`: validates that manual tasks match current App Store fields, compliance state, screenshot inventory, and redaction rules.
- `npm run content-rights:store`: builds `app-store-assets/APP_CONTENT_RIGHTS.json` and `.md` as content-rights proof for local-only playback and no bundled/downloaded media.
- `npm run check:content-rights`: validates the content-rights/media audit against package config, runtime source, MAS entitlements, screenshots, and App Store copy.
- `npm run check:store-copy`: validates `app-store-assets/APP_STORE_LISTING.md` against `app-store-assets/APP_STORE_CONNECT_FIELDS.json`, including name/subtitle/promotional text/description/review-note limits, keyword formatting, TestFlight notes, local-only claims, privacy answers, and no-download/no-scraping language.
- `npm run check:artifact-privacy`: scans generated App Store/release artifacts and source text for local path leakage, downloader-site references, temporary capture paths, and filenames from the local music import directory.
- `npm run check:icons`: validates the generated macOS icon source, iconset dimensions, and `.icns` output before packaging.
- `npm run check:electron-security`: validates Electron shell security invariants and package fuse configuration before packaging or release preflight.
- `npm run check:packaging-toolchain`: validates that `electron-builder` and its `app-builder-lib` blockmap dependency load before release packaging begins. This currently relies on the `@noble/hashes` 1.8.0 override because `app-builder-lib@26.15.5` uses a CommonJS require path.
- `npm run notices:store`: refreshes generated third-party dependency notices from `package-lock.json`; run it after dependency changes and before publishing the support site.
- `npm run init:store-env`: creates ignored `app-store-assets/site.env` from `app-store-assets/site.env.example` for release-machine public URL/contact values with `0600` permissions. It leaves an existing file untouched unless you pass `-- --force`; use ignored `app-store-assets/site.env.local` for a private local override.
- `npm run configure:store-env`: validates and writes the ignored `app-store-assets/site.env.local` overlay from CLI flags or `CODY_*` shell values. It quotes and escapes saved values, and fails before writing if any required public URL, support email, App Review contact name, App Review contact email, App Review contact phone is missing, placeholder, invalid, or spans multiple lines.
- `npm run public-release:store`: public-release refresh wrapper after real `CODY_*` values are available; it runs the strict site, archive, copy-map, App Review brief, public-release sync, privacy/copy/artifact checks, then refreshes blocker, evidence, dashboard, manifest, and handoff artifacts.
- `npm run public-release:store:node`: same public-release refresh wrapper through `.nvmrc` Node; use `npm run public-release:store:published:node` after the generated site is live.
- `npm run site:store`: refreshes notices, then generates and locally validates static support, privacy, marketing, accessibility, and third-party notices pages from `app-store-assets/` using `app-store-assets/site.env` or shell-provided `CODY_SUPPORT_EMAIL` and `CODY_SITE_URL`.
- `npm run check:site`: validates the generated static site in advisory mode. Placeholder public URL/contact values are warnings.
- `npm run check:site -- --strict`: release-machine gate; fails if generated site pages contain placeholder public URL/contact values, broken internal links, missing document landmarks, script tags, or invalid publish env values.
- `npm run site:archive`: builds a deterministic public-site ZIP and archive manifest from `app-store-assets/site/`, then validates it in advisory mode.
- `npm run check:site-archive -- --strict`: release-machine gate; fails if the archive is stale, unsafe, missing files, hash-mismatched, or still contains placeholder public URL/contact values.
- `npm run check:store-urls`: advisory public URL check; warns if generated App Store Connect support/privacy URLs are placeholders, and checks reachable public pages when real URLs are configured.
- `npm run check:store-urls -- --strict`: release-machine gate after publishing the support site; fails if the Support URL or Privacy Policy URL is missing, placeholder, non-HTTPS, unreachable, non-HTML, or missing the expected Cody Cartridge page text.
- `npm run check:published-site -- --strict`: release-machine gate after publishing the support site; fetches every page in `PUBLIC_SITE_PUBLISH_PACKET.json`, requires HTTPS/text-html/expected page text, and compares the live body with the generated source.
- `npm run check:help-docs`: validates that bundled Help documents and generated public Help pages remain present, substantive, mapped from the native Help menu, and consistent with App Review privacy/support/accessibility claims.
- `npm run smoke:mas-dir`: local-only MAS package rehearsal; builds `dist/mas-arm64/Cody Cartridge.app` without Apple signing assets, expects the builder to stop at signing, then confirms the unsigned bundle's resources, `app.asar`, `Info.plist`, and Electron fuses with `npm run check:mas-package`.
- `npm run smoke:mas-runtime`: local-only packaged app launch rehearsal; applies an ad-hoc runtime signature to a temporary copy of the unsigned local MAS rehearsal bundle and attempts to run that copied `.app` with shell-smoke mode and an isolated user-data directory. Concrete stderr launch failures fail; a silent local ad-hoc MAS launch hang is advisory.
- `npm run check:mas-signing`: advisory local preflight for Apple Distribution / Mac App Distribution / Mac Installer Distribution identities and installed macOS provisioning profiles matching `com.sachittumuluri.codycartridge`.
- `npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run`: release-machine helper for downloaded MAS provisioning profiles. It rejects symlinked source files, wrong file extensions, profile source files inside the project or handoff archive, expired profiles, non-macOS profiles, development profiles with `get-task-allow=true`, bundle-id mismatches, profiles missing the expected MAS entitlements, symlinked profile install directories, and symlinked destination files. Run it once with `--dry-run`, then rerun without `--dry-run` to copy the validated profile into the standard user provisioning profile directory with private permissions.
- `npm run check:mas-signing -- --strict`: release-machine gate; fails if the required MAS signing identity, installer identity, matching unexpired macOS distribution-style provisioning profile, or regular non-symlinked provisioning profile storage is missing.
- `npm run signing-assets:store`: writes `app-store-assets/SIGNING_ASSET_REPORT.json` and `.md` as a redacted identity/profile inventory. It records counts, entitlement posture, and current blockers without storing identity names, certificate hashes, profile names, profile UUIDs, local profile paths, or Apple account values.
- `npm run check:signing-assets`: validates the signing asset report against package metadata, entitlement posture, redaction rules, and required MAS signing commands.
- `npm run check:mas-package`: advisory local package-boundary check. It warns if `dist/mas-arm64/Cody Cartridge.app` is missing, and when present validates bundled resources, `app.asar`, packaged `Info.plist`, Electron fuses, embedded provisioning profile, signed current-version installer package, expected installer payload files, and code-signature state.
- `npm run check:mas-package -- --strict`: release-machine gate after `npm run dist:mas`; fails if the MAS bundle is missing, required packaged resources are absent, source/bundled policy docs differ, app-local assets leak into `app.asar`, Electron fuses are wrong, the embedded provisioning profile is missing/mismatched/expired/wrong-platform, the signed current-version installer package is missing/unsigned/stale/missing expected payload files, the app signature does not verify, or signed entitlements do not match the sandbox/file-access posture.
- `npm run check:upload-tooling`: advisory local upload-tooling check for Transporter, `altool`, or `iTMSTransporter`; warns if no Cody/Cartridge MAS `.pkg` is present, if the package does not match the current package version/build, or if package signatures cannot be verified yet.
- `npm run check:upload-tooling -- --strict`: release-machine gate after `npm run dist:mas` and `npm run check:mas-package -- --strict`; fails if no App Store Connect upload tool is available, no Cody/Cartridge MAS `.pkg` upload artifact is present, no package matches the current package version/build, or no signed current-version MAS upload package verifies before Transporter/altool handoff.
- `npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run`: release-machine helper for downloaded App Store Connect API keys. It rejects malformed key IDs, malformed issuer IDs, symlinked source files, non-`.p8` files, missing PEM private-key envelopes, tiny files, key files inside the project or handoff archive, symlinked install directories, and symlinked destination files. Run it once with `--dry-run`, then rerun without `--dry-run` only after validation passes to install into `~/.appstoreconnect/private_keys` with private permissions.
- `npm run check:upload-credentials`: advisory local App Store Connect API credential posture check; it validates env/key-file shape without printing key IDs, issuer IDs, private-key paths, or key contents.
- `npm run check:upload-credentials -- --strict`: release-machine gate after upload tooling; fails if `ASC_KEY_ID`, `ASC_ISSUER_ID`, and an `ASC_PRIVATE_KEY_PATH` or default App Store Connect key file are missing, malformed, symlinked, world/group-readable, or inside the project/handoff archive.
- `npm run upload-packet:store`: release-machine handoff packet after strict upload-tooling and upload-credential checks pass; records the exact package hash, signature state, current package version/build match, available upload tool, credential preflight status, and sanitized evidence command before Apple credentials are used. It selects a signed current-version package before any stale signed artifact. After upload processing, `npm run check:upload-evidence -- --strict` should pass only when delivery logs, processed build values, and selected-build proof all match the package metadata.
- `npm run check:upload-packet`: validates the generated upload command packet, redaction posture, upload-tool inventory, package hash records, and credential-placeholder-only command text.
- `npm run check:release-machine`: advisory aggregate release-machine doctor; summarizes public env, release runtime, source version, package toolchain, public URL, signing, MAS package, upload tooling, upload credential, and blocker-report readiness without storing private values.
- `npm run check:release-machine -- --strict`: release-machine gate after refreshed blocker/handoff artifacts; fails if any aggregate release-machine prerequisite still blocks final strict verification.
- `npm run check:release-machine:node -- --strict`: runs the aggregate release-machine gate through `.nvmrc` Node when the shell default is still outside the release runtime range.
- `npm run machine-report:store`: writes `app-store-assets/RELEASE_MACHINE_REPORT.json` and `.md` as the persistent redacted release-machine gate snapshot. It runs in advisory mode so local iterations can capture remaining public URL/contact and signing blockers without failing the artifact build.
- `npm run check:machine-report`: validates the release machine report against package metadata, blocker-report counts, expected gate IDs, strict-equivalent command, next action, and redaction rules.
- `npm run signing-runbook:store`: builds `app-store-assets/SIGNING_UPLOAD_RUNBOOK.json` and `.md` with required signing identities, the redacted signing asset snapshot, provisioning profile posture, expected MAS outputs, upload tools, and strict release-machine commands.
- `npm run check:signing-runbook`: validates the signing/upload runbook against package metadata and release-machine command order.
- `npm run packet:store`: builds the App Store Connect submission packet from current listing, privacy, support, screenshot, export-compliance, and package metadata.
- `npm run app-compliance:store`: builds the standalone App Store compliance/admin packet, the redacted App Store Connect manual-task packet, and the content-rights/media audit from current App Store fields and export-compliance prep.
- `npm run manual-tasks:store`: builds `app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.json` and `.md` for app record, product-page, privacy/compliance, TestFlight, App Review, and processed-build selection work.
- `npm run content-rights:store`: builds `app-store-assets/APP_CONTENT_RIGHTS.json` and `.md` for no-bundled-media, no-downloader, Takeout-metadata-only, and local-user-media rights evidence.
- `npm run copy-map:store`: builds `app-store-assets/APP_STORE_CONNECT_COPY_MAP.json` and `.md` so release operators have a screen-by-screen App Store Connect field checklist with copy blocks and placeholder/limit status.
- `npm run check:copy-map`: validates the copy map; pass `-- --strict` on the release machine to fail remaining required-field placeholders.
- `npm run review-brief:store`: builds `app-store-assets/APP_REVIEW_BRIEF.json` and `.md` so release operators have a standalone App Review copy/checklist artifact.
- `npm run check:review-brief`: validates the App Review brief; pass `-- --strict` on the release machine to fail remaining contact/public URL placeholders.
- `npm run public-release:store -- --self-test`: validates the public-release wrapper redaction and command-order invariants with synthetic values before real public/contact values are used.
- `npm run check:public-release-sync`: advisory sync check for generated App Store fields, generated public-site archive metadata, and generated site HTML against current release env values.
- `npm run check:public-release-sync -- --strict`: release-machine gate after `npm run packet:store`, `npm run review-brief:store`, and `npm run copy-map:store`; fails if generated public URLs/contact values are stale, placeholder, or inconsistent with `app-store-assets/site.env`.
- `npm run manifest:store`: builds the release manifest from current package metadata, generated store artifacts, screenshots, site pages, public-site archive, built app assets, hashes, URL values, MAS package presence, and signed-submission posture. If the local MAS directory rehearsal exists but lacks an embedded provisioning profile, verified code signature, or signed upload `.pkg`, the manifest labels it `local-rehearsal-only` and keeps final signed-artifact blockers.
- `npm run report:store-blockers`: writes `app-store-assets/RELEASE_BLOCKERS.json` and `.md` with redacted evidence, structured blocker details, and an ordered next-action queue for each remaining release-machine blocker. Use it before handing work to the machine with public URL/contact values and Apple signing assets.
- `npm run public-inputs:store`: writes `app-store-assets/PUBLIC_RELEASE_INPUTS.json` and `.md` with a redacted checklist of required public URL/support/App Review contact values, current value state, and validation commands.
- `npm run check:public-inputs`: validates the public release-input packet against the current ignored env file or shell environment without writing raw contact values into release artifacts.
- `npm run publish-packet:store`: writes and validates `app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.json` and `.md` so the release operator has the archive path, page hashes, expected support/privacy URLs, and publish order in one redacted artifact.
- `npm run check:publish-packet`: validates the public-site publish packet against the generated site archive, current release env values, package metadata, source hashes, and blocker queue.
- `npm run resolution-plan:store`: writes `app-store-assets/RELEASE_RESOLUTION_PLAN.json` and `.md` with ordered public-input, public-site, signing/package, upload, evidence, and final-proof steps.
- `npm run check:resolution-plan`: validates the release resolution plan against package metadata, blocker state, signing/upload runbook commands, required release phases, and command order.
- `npm run submission-checklist:store`: writes `app-store-assets/FINAL_SUBMISSION_CHECKLIST.json` and `.md` with screen-by-screen App Store Connect checks for product page, screenshots, privacy/compliance, TestFlight, build upload, App Review, and Submit for Review.
- `npm run check:submission-checklist`: validates the final submission checklist against generated App Store fields, copy-map blocker count, App Review brief blocker count, release blocker count, required sections, and Add for Review readiness.
- `npm run dashboard:store`: writes `app-store-assets/RELEASE_DASHBOARD.json` and `.html` as a redacted release-operator status view with blocker categories, next release-machine command, public-input readiness, final-checklist readiness, evidence counts, and MAS submission posture.
- `npm run check:dashboard`: validates the release dashboard against blocker, public-input, final-checklist, release machine report, release evidence, and MAS submission source artifacts.
- `npm run operator:store`: writes `app-store-assets/RELEASE_OPERATOR_QUEUE.json` and `.md` as a compact redacted first-action queue for the release machine, including separate public-input validate/apply commands, MAS posture/readiness from the dashboard, the final `npm run release:store:preflight` trigger, and the Node-safe `npm run release:store:preflight:node` trigger for when blocker count reaches zero.
- `npm run check:operator`: validates the release operator queue against the dashboard, blocker report, public-input packet, runbook, resolution plan, final submission checklist, and MAS posture.
- `npm run evidence:store`: writes and checks `app-store-assets/RELEASE_EVIDENCE.json` and `.md` with redacted command summaries, strict/advisory gate outcomes, blocker count, artifact hashes, release machine report hashes, and direct MAS bundle/signature/upload posture. Run it after `npm run machine-report:store`, then run `npm run check:evidence` explicitly before `npm run manifest:store` in release-machine sequences.
- `npm run handoff:store`: writes `app-store-assets/submission-handoff/cody-cartridge-app-store-handoff.zip` plus `SUBMISSION_HANDOFF.json`, then validates the archive entries, hashes, local/private exclusions, redacted signing asset report, signing/API-key secret exclusions, and generated-source consistency.
- `npm run smoke:electron-shell`: builds the production app, launches `electron/main.cjs` in forced-dist smoke mode through `cody-app://`, imports a generated local WAV through the preload IPC path, verifies byte-range playback streaming through the returned `cody-media://` URL, and checks native menus, preload APIs, store-demo renderer content, and custom protocol denial behavior.
- `npm run smoke:clean-profile`: builds the production app, launches the Electron shell against a temporary user-data profile, verifies the app boots without relying on the developer's existing app state, and confirms File > Reset Local Library plumbing clears renderer local storage and stored security-scoped bookmarks.
- `npm run smoke:store`: builds the production app and launches library, Takeout, and missing-file store-demo surfaces in Electron to verify core UI, catalog rows, desktop layout stability, shelf rail alignment, nonblank rendering, absence of runtime/console errors, and poisoned localStorage URL sanitization.
- `npm run smoke:a11y`: builds the production app and verifies Reduced Motion state, focusable labels, search shortcut focus, range labels, keyboard shelf navigation, and labeled song/catalog rows in a store-demo surface.
- `npm run smoke:mas-runtime`: launches, when local ad-hoc MAS constraints allow it, a temporary copy of the generated local MAS `.app` bundle instead of the development Electron binary, using a local-only ad-hoc runtime signature and smoke mode to verify packaged renderer boot, native menus, preload APIs, reset cleanup, and protocol denial behavior without mutating the `dist/mas-arm64` rehearsal bundle.
- `npm run screenshots:store`: regenerates 1440 x 900 Mac screenshot drafts from synthetic demo data, writes `app-store-assets/screenshots/STORE_SCREENSHOTS.json`, records Apple's Mac screenshot specification, then runs the screenshot quality audit.
- `npm run check:screenshots`: validates screenshot PNGs for 1440 x 900 size and Apple's accepted Mac sizes (`1280 x 800`, `1440 x 900`, `2560 x 1600`, or `2880 x 1800`), one-to-ten screenshot count, 16:10 manifest metadata, plausible file size, nonblank pixel variation, luminance contrast, accidental duplicates, and manifest provenance/hash consistency.
- `npm run verify:store`: preserves existing MAS bundle/upload artifacts across the renderer rebuild, then checks package metadata, package file allowlist, Electron fuse settings, explicit macOS minimum-version settings, ASAR packaging, relative built assets, privacy manifest, entitlements, screenshot dimensions and screenshot freshness against renderer sources, App Store field limits, generated packet/compliance/manifest freshness, App privacy-check wiring, App Store compliance/copy-check wiring, public-site archive wiring, public URL-check wiring, production smoke poisoned-state coverage, submission docs, static site files, and native menu wiring.
- `npm run release:store:local`: local iteration gate that runs every App Store readiness check that does not require public URL/contact values, Apple signing identities, provisioning profiles, or a signed MAS package. It includes the public-release wrapper self-test, clean-profile/reset smoke, production poisoned-state smoke, unsigned MAS directory smoke, packaged MAS runtime smoke, App privacy validation, App Store compliance validation, App Store copy validation, App Store Connect copy-map validation, App Review brief validation, artifact privacy validation, the public URL checker in advisory mode, the redacted blocker report, the public release-input packet, the signing/upload runbook, the release resolution plan, the final submission checklist, the release dashboard, the deterministic handoff archive, and the advisory release-machine doctor, and refreshes screenshots before regenerating the packet to keep App Store screenshot inventory current.
- `npm run verify:store:strict`: runs after `npm run dist:mas` and `npm run check:mas-package -- --strict`; it routes through the `.nvmrc` release runtime, inspects the generated `dist/mas-arm64/Cody Cartridge.app`, requires strict signing/provisioning readiness, verifies the app/package boundary, and fails on placeholder App Store URLs/contact details.
- `npm run verify:store:strict:node`: compatibility wrapper for the final strict verifier; `verify:store:strict` already routes through the `.nvmrc` release runtime.
- `npm run release:store:preflight`: release-machine umbrella command. Run this only after real `app-store-assets/site.env` values or shell env values are available and Apple signing assets are installed.
- `npm run release:store:preflight:node`: Node-safe wrapper for the release-machine umbrella command; prefer this on machines whose default shell still starts outside the `.nvmrc` release runtime.

## App Privacy Draft

Use this as the starting point for App Store Connect. Apple still requires the final answers to match the exact shipped binary and any third-party code in that build.

- Data collection answer: No, this app does not collect data from the app.
- Tracking: No tracking.
- Data sent off device: none by the app itself.
- Local data processed on device: selected audio files, embedded audio tags, album artwork, imported Takeout CSV rows, playback state, volume, and local UI preferences.
- Privacy policy position: describe Cody Cartridge as a local-first music player. It imports user-selected files, reads metadata locally, stores playback/library state locally, and does not operate a server account, analytics service, ad SDK, or music download service.

## Accessibility And Age Rating Draft

Use this as the starting point for App Store Connect's App Accessibility and Age Ratings sections. Apple generates the final age rating from the questionnaire, and accessibility labels should only be marked supported after testing the signed MAS build.

- Reduced Motion: supported. The app reads `prefers-reduced-motion`, stops the frame-driven visualizer loop, avoids smooth scrolling, and collapses CSS animation/transition durations.
- VoiceOver: candidate support. Core player controls use native buttons/range inputs, visible labels, `aria-label`s, and live status text. Verify all common tasks with VoiceOver before marking Supported.
- Keyboard access: candidate support. Playback, seeking, shelf navigation, catalog filtering, and import flows should be tested in the signed MAS build on a clean macOS user account.
- Larger Text: do not claim yet. The current interface is intentionally dense and fixed-format; test with macOS display/text scaling before marking Larger Text support.
- Captions and audio descriptions: not applicable. The app does not ship video, spoken instructional media, or generated narration.
- Age rating: `4+` candidate. The app ships no mature, violent, sexual, drug, alcohol, tobacco, horror, gambling, medical, social, unrestricted web, or in-app purchase functionality. Final answers must be based on the shipped binary and Apple questionnaire.
- Optional Accessibility URL: publish `app-store-assets/site/accessibility.html` alongside support/privacy pages if you want App Store Connect to link users to a public accessibility explanation.

## Pricing, Availability, And Release Draft

Use this as the starting point for App Store Connect's Pricing and Availability and version release sections. Final answers still need to be set in App Store Connect before review.

- Price: Free candidate for first release.
- Availability: All countries and regions candidate unless you choose a narrower launch region in App Store Connect.
- Tax category: general app/software candidate; confirm in App Store Connect before submission.
- Pre-order: no pre-order planned.
- Release option: manual release after approval is recommended for the first submission so the signed MAS build can be smoke-tested before launch.
- First-version What's New: not available for the first version in App Store Connect. Keep a future What's New draft in the submission packet for later updates.

## TestFlight Beta Test Draft

Use this as the starting point for App Store Connect's TestFlight test information and internal testing workflow before App Store submission.

- Beta app description: describe Cody Cartridge as a local-first macOS music player for testing user-selected audio imports, embedded artwork/metadata, optional YouTube Music Takeout CSV matching, visual shelf browsing, and sandboxed local playback.
- Feedback email: use the same real `CODY_SUPPORT_EMAIL` value that will appear on the support/privacy site.
- Contact information: use `CODY_REVIEW_CONTACT_NAME`, `CODY_REVIEW_CONTACT_EMAIL`, and `CODY_REVIEW_CONTACT_PHONE` from the ignored release env file or shell env.
- Demo account: none. The app has no login, account system, subscription, or in-app purchase flow.
- Recommended internal group: `Internal: Store Smoke`, used for signed-build install, clean-account launch, import/playback, sandbox persistence, Takeout CSV matching, reduced-motion, and privacy-support URL checks.
- Optional external group: create only after internal testing is stable and the build has passed TestFlight App Review. External testers should use their own local audio files.
- What to test: paste the generated `What To Test` list from `app-store-assets/SUBMISSION_PACKET.md` when adding the build to a TestFlight group.
- Help menu disclosure check: confirm Help > Privacy Summary, Privacy Policy, Support, Accessibility, and Third-Party Notices all open in the signed packaged app.
- Local data reset check: import test files through the picker, use File > Reset Local Library, then confirm the library index is empty and the app no longer relies on previously stored file-access bookmarks.
- Build handling: upload the signed MAS build, wait for App Store Connect processing, resolve export/privacy warnings, add one processed build at a time to the group, and track TestFlight's 90-day build availability window.
- Feedback handling: monitor TestFlight Feedback screenshots, crashes, sessions, and comments in App Store Connect; use support email as fallback; convert blocking feedback into release-preflight fixes.

## Upload And App Review Submission Draft

Use this as the release-machine handoff after signing assets, public URLs, and strict verification are ready.

- Upload method: Transporter is the simplest handoff for the signed MAS package. Xcode Organizer, altool, and App Store Connect API plus Transporter command-line remain valid paths if the release machine is configured for them.
- Release evidence and manifest: regenerate `app-store-assets/UPLOAD_COMMAND_PACKET.md`, `app-store-assets/UPLOAD_EVIDENCE.md`, `app-store-assets/RELEASE_EVIDENCE.md`, and `app-store-assets/RELEASE_MANIFEST.md` immediately before and after upload so the submitted build has package-hash confirmation, sanitized delivery-log evidence, command evidence, and a local file-hash inventory.
- Build processing: wait for App Store Connect processing before selecting a build for TestFlight or App Review. Confirm the processed build maps to bundle id `com.sachittumuluri.codycartridge`, package version `0.1.0`, and build version `0.1.0`.
- Delivery logs: save raw Transporter/altool delivery logs outside the handoff archive, then run `npm run upload-evidence:store` with the log path to create sanitized `UPLOAD_EVIDENCE.md`. Resolve all upload warnings, including export-compliance, privacy-manifest, entitlement, or processing messages, against the exact uploaded binary.
- Build selection: App Store Connect allows one uploaded build to be associated with the app version at submission time. Select the processed build on the macOS app version and save before submission.
- Compliance: if the build shows Missing Compliance, answer export-compliance questions or provide required documentation before submitting for review.
- Draft submission: verify product copy, screenshots, age rating, app privacy, pricing, availability, tax category, manual release option, EU DSA status, support/privacy URLs, and App Review contact details before clicking Add for Review.
- Final submission: after Add for Review, inspect Draft Submissions, then click Submit for Review. Monitor App Review messages and statuses after submission starts.
- Resubmission rule: if App Review requires a binary change, update source, increment the build/package version as needed, regenerate packet artifacts, upload a new build, and re-run the strict gate.

## Export Compliance Prep

Use `app-store-assets/EXPORT_COMPLIANCE.md` as the release-operator prep note before answering App Store Connect's export-compliance questions. Final answers still need to be made in App Store Connect against the exact signed MAS binary.

- Current draft: Cody Cartridge intentionally implements no custom or proprietary encryption and ships no network service.
- Documentation expectation: if App Store Connect treats platform security as encryption, classify it as encryption limited to that within the Apple operating system; Apple documents that no App Store Connect documentation is required for that case.
- Evidence checked: direct dependencies, MAS network entitlement absence, `ITSAppUsesNonExemptEncryption=false`, local `cody-media` and `cody-art` playback/artwork protocols, no external URL opening, no telemetry transport hooks, privacy manifest no-collection posture, and read-only sandboxed file entitlements.
- Run order: `npm run export-compliance:store` before `npm run packet:store`, then `npm run check:export-compliance` after packet generation.
- Upload handling: if the processed App Store Connect build shows Missing Compliance, answer the encryption/export questions from the signed build and save that final answer state with the private delivery logs, sanitized `UPLOAD_EVIDENCE.md`, and `RELEASE_EVIDENCE.md`.

## EU DSA Compliance Draft

Use this as the starting point for App Store Connect's EU Digital Services Act compliance workflow. The final trader/non-trader answer is account/legal status, not a code property.

- DSA status: must be answered in App Store Connect before EU distribution.
- Trader contact display: if the developer account is marked as a trader, Apple requires verified address, phone, and email details for display to EU customers on the App Store product page.
- Labels and markings URL: optional. Cody Cartridge does not currently need a product-safety label URL, but confirm against the final account and distribution choices.
- Launch impact: if DSA status is incomplete, EU availability may be blocked or should be excluded until compliance information is complete.

## Remaining Before Submission

- Confirm the bundle id `com.sachittumuluri.codycartridge` in Apple Developer and App Store Connect, or replace it everywhere before signing.
- Before each new upload, run `npm run version:store -- <next x.y.z>` if the App Store build/version must change, then regenerate packet and manifest artifacts.
- Review the generated icon at small sizes and replace with a final production icon if needed.
- Run `npm run check:icons` after any icon edit and before MAS packaging.
- Run `npm run check:packaging-toolchain` before MAS packaging; it should pass before any signing identity issue is investigated.
- Run `npm run check:release-runtime -- --strict` on the release machine before MAS packaging; it should pass before any signing identity or package-boundary issue is investigated.
- Run `npm run smoke:mas-dir` during local release rehearsal; it should pass before moving MAS package work to the signed release machine.
- Run `npm run smoke:mas-runtime` after `npm run smoke:mas-dir` locally only; the signed release-machine path should run `npm run check:mas-package -- --strict`, `npm run check:upload-tooling -- --strict`, `npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run`, and `npm run check:upload-credentials -- --strict` without re-signing the upload candidate.
- Run `npm run notices:store` after dependency changes and before final packet/site generation.
- Review and optionally replace the generated Mac App Store screenshot drafts with hand-composed final marketing screenshots.
- Add Apple Developer signing identities and download a macOS/Mac App Store provisioning profile matching `com.sachittumuluri.codycartridge`; keep the profile source file outside the project and handoff archive, validate it with `npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run`, install it with the same command without `--dry-run`, then run `npm run check:mas-signing -- --strict`.
- After `npm run dist:mas`, run `npm run check:mas-package -- --strict`, `npm run check:upload-tooling -- --strict`, `npm run install:asc-key -- --key-id <asc-key-id> --issuer-id <asc-issuer-id> --file /path/to/AuthKey_<key-id>.p8 --dry-run`, and `npm run check:upload-credentials -- --strict` to confirm the signed package boundary, signed current-version upload package, App Store Connect API key, and credential posture before upload.
- Test the MAS build on a clean macOS user account.
- Confirm drag/drop behavior under App Sandbox. In MAS builds, renderer-provided dropped paths are accepted only when they already fall under a stored security-scoped bookmark; picker imports remain the primary sandbox-safe flow.
- Run `npm run init:store-env`, set `CODY_SUPPORT_EMAIL`, `CODY_SITE_URL`, `CODY_REVIEW_CONTACT_NAME`, `CODY_REVIEW_CONTACT_EMAIL`, and `CODY_REVIEW_CONTACT_PHONE` in ignored `app-store-assets/site.env` or shell env, run `npm run site:store && npm run site:archive`, then publish `app-store-assets/public-site/cody-cartridge-public-site.zip` or the generated `app-store-assets/site/` directory, including `robots.txt`, `sitemap.xml`, `_headers`, and `vercel.json`.
- Publish `app-store-assets/site/support.html` as the App Store support URL with contact information.
- Optionally publish `app-store-assets/site/accessibility.html` as the App Store Accessibility URL after verifying the signed MAS build.
- Publish `app-store-assets/site/third-party-notices.html` with the same support site if you want public dependency-license transparency or an SBOM-style reference page.
- Run `npm run check:store-urls -- --strict` and `npm run check:published-site -- --strict` after publishing to confirm App Store Connect's Support URL, Privacy Policy URL, and the rest of the public-site packet resolve to the expected public pages.
- Set pricing, tax category, availability, and manual release option in App Store Connect.
- Create the TestFlight internal group, add the processed signed build, paste the generated What to Test notes, and complete the clean-account Mac acceptance checklist before App Store submission.
- Review TestFlight Feedback and crash/session data after internal testing; fix blocking issues before submitting the App Store version.
- Run `npm run upload-packet:store`, upload the signed MAS package through Transporter, Xcode, altool, or an App Store Connect API/Transporter automation path, save raw delivery logs outside the handoff archive, then run `npm run upload-evidence:store` with the log path and processed-build values.
- Wait for App Store Connect build processing, resolve upload/compliance warnings, select the processed build on the macOS app version, and save the version page.
- Add the macOS app version for review, inspect the draft submission, then submit for review only after all generated packet fields have been copied into App Store Connect.
- Confirm EU Digital Services Act trader/non-trader status and any required trader contact details in App Store Connect before enabling EU availability.
- Run `npm run packet:store` after real support/privacy URLs are set, then copy fields from `app-store-assets/SUBMISSION_PACKET.md` into App Store Connect.
- Run `npm run review-brief:store` after `npm run packet:store`; use `app-store-assets/APP_REVIEW_BRIEF.md` as the standalone App Review notes and reviewer checklist.
- Run `npm run copy-map:store` after `npm run review-brief:store`; use `app-store-assets/APP_STORE_CONNECT_COPY_MAP.md` as the screen-by-screen App Store Connect entry checklist.
- Run `npm run manual-tasks:store` after compliance or App Store field changes; use `app-store-assets/APP_STORE_CONNECT_MANUAL_TASKS.md` as the redacted account-side App Store Connect task list.
- Run `npm run content-rights:store` after import/playback, Takeout, packaging, screenshot-demo, or rights-copy changes; use `app-store-assets/APP_CONTENT_RIGHTS.md` as App Review/content-rights support evidence.
- Run `npm run public-inputs:store` after `npm run report:store-blockers`; use `app-store-assets/PUBLIC_RELEASE_INPUTS.md` to fill the ignored release env file without leaking raw contact values into handoff artifacts.
- Run `npm run publish-packet:store` after `npm run public-inputs:store` and after rebuilding the public-site archive; use `app-store-assets/PUBLIC_SITE_PUBLISH_PACKET.md` as the static-site upload checklist for Support/Privacy URL publication.
- Run `npm run check:published-site -- --strict` after the static host is live to prove each publish-packet page matches the generated source before MAS signing.
- Run `npm run signing-assets:store` before strict MAS signing; use `app-store-assets/SIGNING_ASSET_REPORT.md` to confirm the release machine has the required distribution identities and macOS distribution profile without leaking signing details.
- Run `npm run install:mas-profile -- --file /path/to/profile.provisionprofile --dry-run` after downloading the MAS profile outside the project and handoff archive and before strict MAS signing; if it passes, rerun without `--dry-run` so the profile is installed with `0600` permissions.
- Run `npm run upload-packet:store && npm run copy-map:store && npm run apple-assets:store` after public inputs, blocker report, and upload package state are current so the final copy map and Apple asset request packet are not stale.
- Run `npm run signing-runbook:store` after `npm run apple-assets:store`; use `app-store-assets/SIGNING_UPLOAD_RUNBOOK.md` as the release-machine signing and upload checklist.
- Run `npm run resolution-plan:store` after `npm run signing-runbook:store`; use `app-store-assets/RELEASE_RESOLUTION_PLAN.md` as the ordered release-machine blocker resolution checklist.
- Run `npm run submission-checklist:store` after `npm run resolution-plan:store`; use `app-store-assets/FINAL_SUBMISSION_CHECKLIST.md` before Add for Review and Submit for Review.
- Run `npm run machine-report:store` after `npm run submission-checklist:store`; use `app-store-assets/RELEASE_MACHINE_REPORT.md` as the persistent redacted release-machine gate snapshot.
- Run `npm run dashboard:store` after `npm run evidence:store`; open `app-store-assets/RELEASE_DASHBOARD.html` for the redacted release-operator status view, MAS posture, machine-report counts, and next command.
- Run `npm run operator:store` after `npm run dashboard:store`; use `app-store-assets/RELEASE_OPERATOR_QUEUE.md` as the shortest release-machine first-action, public-input validate/apply, MAS readiness, stop-condition, and strict-preflight trigger checklist.
- Run `npm run report:store-blockers` after any public URL/contact or signing change, and review `app-store-assets/RELEASE_BLOCKERS.md` before starting the strict preflight.
- Run `npm run evidence:store` and `npm run check:evidence` after `npm run machine-report:store` and before `npm run manifest:store` so the release manifest hashes checked current evidence files and the current release-machine report.
- Run `npm run check:app-privacy` after `npm run packet:store` and before copying App Store privacy answers; it must continue to prove that audio analysis/playback only uses local playback URLs.
- Run `npm run check:export-compliance` after `npm run packet:store` and before copying compliance fields; it must continue to prove the export-compliance artifact and App Store Connect fields agree.
- Run `npm run check:store-copy` after `npm run packet:store` and before copying App Store Connect fields.
- Run `npm run check:artifact-privacy` after `npm run check:store-copy` and before public URL/signing checks so generated release artifacts do not expose local filesystem details or local music filenames.
- Run `npm run manifest:store` and `npm run check:manifest` after packet/site/screenshot generation and after MAS packaging on the release machine, then keep `app-store-assets/RELEASE_MANIFEST.md` with release notes.
- Run `npm run handoff:store` after `npm run check:manifest`; the resulting ZIP is the single-file handoff for generated App Store copy, screenshots, public-site archive, policy/support docs, blockers, evidence, and manifest.
- Run `npm run check:release-machine -- --strict` after `npm run handoff:store`; it should report zero release blockers before final strict verification.
- Confirm the field audit in `app-store-assets/SUBMISSION_PACKET.md` remains within App Store limits before copying product-page metadata.
- Run `npm run release:store:local:node` during local iteration when the shell is not already on the `.nvmrc` release runtime; otherwise `npm run release:store:local` is equivalent.
- Run `npm run release:store:preflight:node` on the release machine when the shell default is uncertain, and resolve every strict failure before uploading the build.
- After the first App Store Connect upload, reconcile any ITMS privacy-manifest warnings with the exact API categories Apple reports.

## Apple References

- App privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Manage app privacy in App Store Connect: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- Privacy manifest files: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Overview of Accessibility Nutrition Labels: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/
- Manage Accessibility Nutrition Labels: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/manage-accessibility-nutrition-labels/
- Set an app age rating: https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/
- Age rating values and definitions: https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/
- Create an App Store Connect provisioning profile: https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/
- Provisioning profile updates: https://developer.apple.com/help/account/provisioning-profiles/provisioning-profile-updates/
- Screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- Overview of export compliance: https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/
- Export compliance documentation for encryption: https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/
- Platform version information: https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/
- Pricing and availability reference: https://developer.apple.com/help/app-store-connect/reference/pricing-and-availability/app-pricing-and-availability/
- Set a price: https://developer.apple.com/help/app-store-connect/manage-app-pricing/set-a-price/
- Manage availability: https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-for-your-app-on-the-app-store/
- Select an App Store version release option: https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/
- TestFlight overview: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- Provide test information: https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/
- Upload builds: https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
- Choose a build to submit: https://developer.apple.com/help/app-store-connect/manage-builds/choose-a-build-to-submit/
- Overview of submitting for review: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/overview-of-submitting-for-review/
- Submit an app: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/
- Add internal testers: https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/
- App build statuses: https://developer.apple.com/help/app-store-connect/reference/app-uploads/app-build-statuses/
- View tester feedback: https://developer.apple.com/help/app-store-connect/test-a-beta-version/view-tester-feedback/
- Manage European Union Digital Services Act trader requirements: https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/
- Required, localizable, and editable properties: https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties/
- App information: https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/

> Note: `com.apple.security.files.user-selected.read-write` replaced the
> former read-only entitlement — The Lathe CUT export writes a WAV to a
> user-chosen save-dialog path (the only write surface in the app).
