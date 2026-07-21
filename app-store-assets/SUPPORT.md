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

## Troubleshooting

### A track will not play

Confirm the file still exists at the path shown in the inspector's SOURCE
row. If the file moved, re-import it (File > Import Audio Files) — the deck
never edits or relocates your audio.

### The scope or meters look frozen

macOS Reduce Motion switches the deck into its static instrument mode by
design. Toggle it in System Settings > Accessibility > Display if you want
the full animation set.

### A CUT export did not appear

The Lathe writes only to the location you pick in the save dialog. Check
the folder you chose (Downloads by default); exports are stereo 16-bit WAV
files named after the track and edition.
