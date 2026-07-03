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
