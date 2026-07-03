# Cody Cartridge App Store Listing Draft

## Product Page

Name: Cody Cartridge

Subtitle: Local music, signal mapped.

Promotional text:
Turn your own music files into a visual archive: album art, metadata, signal maps, bass-reactive panels, and a hardware-inspired player.

Description:
Cody Cartridge is a local-first music player for people who want their personal music library to feel like a found-object archive.

Import audio files you already own, read embedded artwork and tags, optionally match your library against your own YouTube Music Takeout CSV export, and browse everything through a visual shelf built around album covers, signal maps, and subtle audio-reactive motion.

The app is designed for local playback and private organization. It does not download music, scrape streaming services, run ads, require an account, or send your listening library to a server.

Features:
- Local audio playback for user-selected files
- Embedded metadata and album artwork display
- Optional YouTube Music Takeout CSV matching
- Missing-file and missing-cover visibility
- Signal Map view for browsing tracks spatially
- Bass-reactive visual panels and physical transport controls
- Local-only state for library, volume, shelf, and playback preferences

Keywords:
music,player,local,audio,mp3,album,library,archive,cassette,visualizer

Category:
Music

Copyright:
2026 Sachit Tumuluri

## URLs To Publish Before Submission

Support URL:
Pending release value: build with `CODY_SUPPORT_EMAIL=... CODY_SITE_URL=... npm run site:store`, publish `app-store-assets/site/`, and use `/support.html`.

Privacy Policy URL:
Pending release value: build with `CODY_SUPPORT_EMAIL=... CODY_SITE_URL=... npm run site:store`, publish `app-store-assets/site/`, and use `/privacy.html`.

Marketing URL:
Optional. Use the same support site if no separate landing page exists.

Static site source:
Run `npm run site:store` to generate `app-store-assets/site/index.html`, `privacy.html`, `support.html`, `accessibility.html`, and `third-party-notices.html`.

## App Review Notes

Cody Cartridge is a local-first desktop music player. It plays files selected by the user through the macOS open panel or drag/drop. It can optionally read a user-provided YouTube Music Takeout CSV to match metadata against local files.

The app does not download music, scrape YouTube Music, access streaming accounts, provide copyrighted media, or transmit the user's library off device. Testers can use the picker flow with local audio files. Store screenshots are captured from `?store-demo=1`, which uses synthetic demo metadata only.

Sandbox file access is intentionally read-only and uses user-selected file/folder access plus security-scoped bookmarks for persistent playback access after picker imports.

## Screenshot Plan

Use `npm run screenshots:store` to generate PNG screenshots in `app-store-assets/screenshots/`.

Current target size:
- 1440 x 900 px, 16:10, accepted for Mac App Store screenshots.

Recommended set:
- Library shelf and now-playing deck
- YouTube Music Takeout metadata map
- Missing local file / metadata gap view

## Native macOS Behavior

Menu bar actions are wired for:
- File > Import Audio Files
- File > Import Music Folder
- File > Import YouTube Music Takeout
- File > Reset Local Library
- Playback > Play/Pause
- Playback > Previous Track
- Playback > Next Track
- Help > Privacy Summary
- Help > Privacy Policy
- Help > Support
- Help > Accessibility
- Help > Third-Party Notices
