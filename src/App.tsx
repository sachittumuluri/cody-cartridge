import React, { ChangeEvent, CSSProperties, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ListMusic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2
} from "lucide-react";

type BadgeId = "heart" | "star" | "bolt" | "moon" | "flame" | "gem";
type InterferenceMode = "off" | "low" | "med" | "max";
type MicroGlitchKind = "header" | "map" | "row" | "shelf";
type SaveSlotId = "save-01" | "save-02" | "save-03";
type ShelfView = "library" | "favorites" | "takeout" | "missing" | SaveSlotId;

type Track = CodyFileTrack & {
  duration: number;
  favorite: boolean;
  badge: BadgeId;
  dateAdded: number;
  playCount?: number;
  lastPlayedAt?: number;
};

type TakeoutSong = {
  id: string;
  videoId: string;
  title: string;
  album: string;
  artists: string[];
  sourceFile: string;
  dateAdded: number;
};

type AlbumSource = Pick<Track, "title" | "artist" | "album"> & {
  artworkUrl?: string;
};

type TrackCard = {
  kind: "track";
  id: string;
  track: Track;
};

type MissingCard = {
  kind: "missing";
  id: string;
  song: TakeoutSong;
  artSource: AlbumSource;
};

type ShelfCard = TrackCard | MissingCard;

type StatusChip = {
  label: string;
  query: string;
  tone?: "alert" | "match" | "muted";
};

type SaveSlot = {
  id: SaveSlotId;
  label: string;
  trackIds: string[];
};

type TrackAnalysis = {
  bass: Float32Array;
  fps: number;
  levels: Uint8Array[];
};

type StoredState = {
  activeShelf?: ShelfView;
  currentId?: string;
  interference?: InterferenceMode;
  reducedMotion?: boolean;
  scanlines?: boolean;
  saveSlots?: SaveSlot[];
  takeoutSongs?: TakeoutSong[];
  tracks?: Track[];
  volume?: number;
};

const storageKey = "cody-cartridge-state-v1";
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const defaultSaveSlots: SaveSlot[] = [
  { id: "save-01", label: "SAVE 01", trackIds: [] },
  { id: "save-02", label: "SAVE 02", trackIds: [] },
  { id: "save-03", label: "SAVE 03", trackIds: [] }
];
const audioExtensions = /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff|aif)$/i;

function resolveTrackUrl(value: string | undefined) {
  if (!value || typeof window === "undefined") {
    return undefined;
  }

  try {
    return new URL(value, window.location.href);
  } catch {
    return undefined;
  }
}

function isDurablePlaybackUrl(value: string | undefined) {
  const parsed = resolveTrackUrl(value);

  return parsed?.protocol === "cody-media:" && parsed.hostname === "track";
}

function isLocalPlaybackUrl(value: string | undefined) {
  const parsed = resolveTrackUrl(value);

  if (!parsed) {
    return false;
  }

  if (isDurablePlaybackUrl(value)) {
    return true;
  }

  if (parsed.protocol === "blob:") {
    return true;
  }

  if (parsed.protocol === "data:") {
    return /^data:audio\//i.test(value ?? "");
  }

  return parsed.origin === window.location.origin && parsed.pathname.startsWith("/__cody_music__/");
}

function sanitizeStoredState(state: StoredState): StoredState {
  const tracks = Array.isArray(state.tracks)
    ? state.tracks.filter((track) => isDurablePlaybackUrl(track.url))
    : undefined;
  const trackIds = new Set((tracks ?? []).map((track) => track.id));
  const saveSlots = Array.isArray(state.saveSlots)
    ? state.saveSlots
        .filter((slot) => slot && typeof slot.id === "string" && typeof slot.label === "string")
        .map((slot) => ({
          ...slot,
          trackIds: Array.isArray(slot.trackIds) ? slot.trackIds.filter((trackId) => trackIds.has(trackId)) : []
        }))
    : undefined;

  return {
    ...state,
    currentId: state.currentId && trackIds.has(state.currentId) ? state.currentId : "",
    saveSlots,
    tracks
  };
}

function isStoreDemoMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("store-demo") === "1";
}

// Marketing-only poster mode: paints a representative live scope + VU into the
// paused store-demo so screenshots showcase the reactive hardware. Kept behind
// its own flag so the store smoke (store-demo=1, no poster) is unaffected.
function isStorePosterMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("store-poster") === "1";
}

function getStoreDemoShelf(): ShelfView {
  if (typeof window === "undefined") {
    return "library";
  }

  const requestedShelf = new URLSearchParams(window.location.search).get("store-shelf");

  if (requestedShelf === "takeout" || requestedShelf === "missing" || requestedShelf === "favorites") {
    return requestedShelf;
  }

  return "library";
}

function getStoreDemoReducedMotion() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("store-reduced-motion") === "1";
}

function cloneDefaultSaveSlots() {
  return defaultSaveSlots.map((slot) => ({ ...slot, trackIds: [...slot.trackIds] }));
}

function demoArtworkDataUrl(index: number, title: string) {
  const palette = [
    ["#090a0f", "#8b111b", "#9cc7d8"],
    ["#111317", "#334a56", "#d0d0c8"],
    ["#06070c", "#6e1823", "#f0eee8"],
    ["#0d1014", "#53666e", "#8b111b"]
  ][index % 4];
  const [background, accent, line] = palette;
  const code = String(index + 1).padStart(2, "0");
  const safeTitle = title.replace(/[&<>"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="${background}"/><path d="M64 64h512v512H64z" fill="none" stroke="${line}" stroke-width="6"/><path d="M112 112h416v416H112z" fill="none" stroke="${line}" stroke-opacity=".22" stroke-width="2"/><g stroke="${line}" stroke-opacity=".12">${Array.from({ length: 14 })
    .map((_, lineIndex) => `<path d="M${112 + lineIndex * 32} 96v448M96 ${112 + lineIndex * 32}h448"/>`)
    .join("")}</g><rect x="212" y="212" width="216" height="216" fill="${accent}" fill-opacity=".72"/><rect x="248" y="248" width="144" height="144" fill="none" stroke="${line}" stroke-opacity=".42" stroke-width="3"/><text x="96" y="514" fill="${line}" font-family="Courier New, monospace" font-size="34" font-weight="900">${safeTitle.toUpperCase()}</text><text x="96" y="556" fill="${line}" fill-opacity=".54" font-family="Courier New, monospace" font-size="20" font-weight="900">LOCAL COVER ${code}</text></svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createDemoTrack(index: number, title: string, artist: string, album: string): Track {
  const id = `store-demo-${String(index + 1).padStart(2, "0")}`;
  const matched = index % 4 !== 2;
  const hasCover = index % 5 !== 3;

  return {
    id,
    title,
    artist,
    album,
    artworkUrl: hasCover ? demoArtworkDataUrl(index, title) : "",
    badge: index % 3 === 0 ? "bolt" : index % 3 === 1 ? "moon" : "heart",
    bitrate: [192000, 256000, 320000, 144000][index % 4],
    codec: "MPEG 1 Layer 3",
    dateAdded: 1771339200000 + index * 120000,
    duration: [184, 231, 156, 276, 203, 247, 198, 222, 169, 258, 214, 188][index % 12],
    favorite: index === 0 || index === 4 || index === 9,
    fileName: `${title}.mp3`,
    filePath: `/Users/you/Music/Cody Cartridge/${title}.mp3`,
    metadataSource: matched ? "YouTube Music Takeout" : "Embedded tags",
    sampleRate: 44100,
    size: [5200000, 7600000, 4100000, 6900000, 5900000, 8300000][index % 6],
    takeoutMatchConfidence: matched ? 118 - (index % 4) * 7 : 0,
    takeoutSourceFile: matched ? "Music Library Songs.csv" : "",
    url: "",
    youtubeMusicUrl: matched ? `https://music.youtube.com/watch?v=demo${index + 1}` : "",
    youtubeVideoId: matched ? `demo${index + 1}` : "",
    year: 2026
  };
}

function createStoreDemoState(): StoredState {
  const demoTracks = [
    createDemoTrack(0, "Signal Drift", "Cody Cartridge", "Deck A"),
    createDemoTrack(1, "Afterimage Rail", "Cody Cartridge", "Trace Cuts"),
    createDemoTrack(2, "No Cover Found", "Local Archive", "Tag Gap"),
    createDemoTrack(3, "Bass Bloom", "Night Index", "Signal Map"),
    createDemoTrack(4, "Scanner Hold", "Local Archive", "Deck A"),
    createDemoTrack(5, "Redline Memory", "Cody Cartridge", "Trace Cuts"),
    createDemoTrack(6, "Tape Ghost", "Night Index", "Signal Map"),
    createDemoTrack(7, "Found Object", "Local Archive", "Tag Gap"),
    createDemoTrack(8, "Grid Sleep", "Cody Cartridge", "Deck A"),
    createDemoTrack(9, "Catalog Pulse", "Night Index", "Signal Map"),
    createDemoTrack(10, "Lowpass Window", "Local Archive", "Trace Cuts"),
    createDemoTrack(11, "Shelf Relock", "Cody Cartridge", "Deck A")
  ];
  const takeoutSongs = demoTracks.slice(0, 10).map((track, index) => ({
    id: `store-demo-takeout-${String(index + 1).padStart(2, "0")}`,
    videoId: track.youtubeVideoId || `missing${index + 1}`,
    title: track.title,
    album: track.album,
    artists: [track.artist],
    sourceFile: "Music Library Songs.csv",
    dateAdded: track.dateAdded
  }));

  takeoutSongs.push({
    id: "store-demo-takeout-missing",
    videoId: "missing-local-file",
    title: "Unmatched Tape",
    album: "Pending Import",
    artists: ["Takeout Row"],
    sourceFile: "Music Library Songs.csv",
    dateAdded: 1771339200000 + 13 * 120000
  });

  return {
    activeShelf: getStoreDemoShelf(),
    currentId: demoTracks[0].id,
    interference: "low",
    reducedMotion: getStoreDemoReducedMotion(),
    scanlines: true,
    saveSlots: cloneDefaultSaveSlots(),
    takeoutSongs,
    tracks: demoTracks,
    volume: 0.72
  };
}

function loadStoredState(): StoredState {
  if (typeof window === "undefined") {
    return {};
  }

  if (isStoreDemoMode()) {
    return createStoreDemoState();
  }

  try {
    const rawState = window.localStorage.getItem(storageKey);
    return rawState ? sanitizeStoredState(JSON.parse(rawState) as StoredState) : {};
  } catch {
    return {};
  }
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }

  return window.matchMedia(reducedMotionQuery).matches;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainder}`;
}

function formatBitrate(value: number | undefined) {
  return value ? `${Math.round(value / 1000)}k` : "rate --";
}

function formatSampleRate(value: number | undefined) {
  return value ? `${(value / 1000).toFixed(1)}kHz` : "freq --";
}

function formatFileSize(value: number | undefined) {
  if (!value || value <= 0) {
    return "size --";
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)}KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

function formatCodec(value: string | undefined) {
  if (!value) {
    return "audio";
  }

  return value
    .replace(/MPEG 1 Layer 3/i, "MPEG-1 Layer III")
    .replace(/MPEG 2 Layer 3/i, "MPEG-2 Layer III")
    .replace(/\s+/g, " ")
    .trim();
}

function formatGain(volume: number, bassLevel: number) {
  const db = 20 * Math.log10(Math.max(0.01, volume)) + bassLevel * 2.4;
  return `${db.toFixed(1)}db`;
}

function formatMatchConfidence(track: Track | undefined) {
  if (!track?.metadataSource?.includes("Takeout")) {
    return 0;
  }

  return Math.min(99, Math.max(72, Math.round(((track.takeoutMatchConfidence ?? 92) / 132) * 100)));
}

function formatSourceLabel(track: Track | undefined) {
  if (!track) {
    return "empty";
  }

  if (track.youtubeVideoId) {
    return "YT match";
  }

  if (track.metadataSource?.includes("Takeout")) {
    return "Takeout ambiguous";
  }

  return "local file";
}

function hashText(value: string) {
  return value.split("").reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 9973;
  }, 17);
}

function scrambleLabel(value: string, seedValue: string | number) {
  const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/[]#";
  const seed = typeof seedValue === "number" ? seedValue : hashText(seedValue);

  return value
    .toUpperCase()
    .split("")
    .map((character, index) => {
      if (character === " ") {
        return " ";
      }

      return glyphs[(seed + index * 7 + character.charCodeAt(0)) % glyphs.length] ?? character;
    })
    .join("");
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

async function buildTrackAnalysis(track: Track): Promise<TrackAnalysis> {
  if (!isLocalPlaybackUrl(track.url)) {
    throw new Error("Track analysis only accepts local playback URLs");
  }

  const AudioContextConstructor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    throw new Error("AudioContext unavailable");
  }

  const response = await fetch(track.url);
  const arrayBuffer = await response.arrayBuffer();
  const decodeContext = new AudioContextConstructor();
  const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0));

  decodeContext.close().catch(() => undefined);

  const fps = 30;
  const sampleRate = audioBuffer.sampleRate;
  const frameSize = Math.max(512, Math.floor(sampleRate / fps));
  const frameCount = Math.max(1, Math.ceil(audioBuffer.length / frameSize));
  const channelData = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
  const bassRaw = new Float32Array(frameCount);
  const levelRaw = Array.from({ length: frameCount }, () => new Float32Array(24));
  const levelValues: number[] = [];
  const lowPassAlpha = 1 - Math.exp((-2 * Math.PI * 124) / sampleRate);
  let lowSample = 0;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const start = frameIndex * frameSize;
    const end = Math.min(audioBuffer.length, start + frameSize);
    const bins = levelRaw[frameIndex];
    const binCounts = new Uint16Array(24);
    let bassSum = 0;
    let sampleCount = 0;

    for (let cursor = start; cursor < end; cursor += 1) {
      let mixedSample = 0;

      for (let channelIndex = 0; channelIndex < channelData.length; channelIndex += 1) {
        mixedSample += channelData[channelIndex][cursor] ?? 0;
      }

      mixedSample /= Math.max(1, channelData.length);
      lowSample += lowPassAlpha * (mixedSample - lowSample);
      bassSum += lowSample * lowSample;

      const binIndex = Math.min(23, Math.floor(((cursor - start) / Math.max(1, end - start)) * 24));
      bins[binIndex] += Math.abs(mixedSample);
      binCounts[binIndex] += 1;
      sampleCount += 1;
    }

    bassRaw[frameIndex] = Math.sqrt(bassSum / Math.max(1, sampleCount));

    for (let index = 0; index < bins.length; index += 1) {
      bins[index] = bins[index] / Math.max(1, binCounts[index]);
      levelValues.push(bins[index]);
    }
  }

  const bassValues = Array.from(bassRaw);
  const bassFloor = percentile(bassValues, 0.18);
  const bassPeak = Math.max(percentile(bassValues, 0.96), bassFloor + 0.001);
  const levelPeak = Math.max(percentile(levelValues, 0.98), 0.001);
  const bass = new Float32Array(frameCount);
  const levels = levelRaw.map((bins) => {
    const row = new Uint8Array(24);

    for (let index = 0; index < bins.length; index += 1) {
      const normalizedLevel = Math.min(1, Math.max(0, bins[index] / levelPeak));
      row[index] = Math.round(10 + Math.pow(normalizedLevel, 0.72) * 82);
    }

    return row;
  });

  for (let index = 0; index < bassRaw.length; index += 1) {
    const normalizedBass = Math.min(1, Math.max(0, (bassRaw[index] - bassFloor) / (bassPeak - bassFloor)));
    bass[index] = Math.pow(normalizedBass, 0.54);
  }

  return {
    bass,
    fps,
    levels
  };
}

function getAnalysisFrame(analysis: TrackAnalysis | undefined, time: number) {
  if (!analysis) {
    return undefined;
  }

  const index = Math.min(analysis.bass.length - 1, Math.max(0, Math.floor(time * analysis.fps)));
  const levels = Array.from(analysis.levels[index] ?? []);

  return {
    bass: analysis.bass[index] ?? 0,
    levels: levels.length ? levels : undefined
  };
}

function albumGraphicStyle(track: AlbumSource | undefined, index = 0): CSSProperties {
  const seed = hashText(track ? `${track.title}-${track.artist}-${track.album}` : "empty-cart");
  const hue = (seed * 7) % 360;
  const secondHue = (hue + 72 + index * 9) % 360;
  const thirdHue = (hue + 168 + index * 5) % 360;
  const lanePattern = [0, -24, 16, -12, 24, -18, 10, -8];
  const tiltPattern = [-2, 3, -1, 2, -3, 1, 2, -2];
  const depthPattern = [0.96, 1.05, 0.91, 1.01, 0.88, 1.04, 0.94, 0.99];
  const pathY = lanePattern[index % lanePattern.length] + Math.round(Math.sin(seed) * 3);
  const pathX = Math.round((index % 2 === 0 ? 1 : -1) * (4 + (seed % 5)));
  const tilt = tiltPattern[index % tiltPattern.length] + Math.round(Math.cos(seed));
  const curveX = Math.round(Math.sin(index * 1.55 + 0.4) * 30);
  const curveY = Math.round(Math.cos(index * 1.18) * 20);
  const depth = depthPattern[index % depthPattern.length] + (((seed + index) % 5) - 2) / 100;
  const lowDepth = Math.max(0.82, depth - 0.08);
  const highDepth = depth + 0.08;
  const hoverDepth = depth + 0.04;
  const cardZ = Math.round((depth - 0.96) * 180);

  return {
    "--art-hue": `${hue}deg`,
    "--art-hue-2": `${secondHue}deg`,
    "--art-hue-3": `${thirdHue}deg`,
    "--curve-x": `${curveX}px`,
    "--curve-y": `${curveY}px`,
    "--curve-x-bend": `${Math.round(-curveX * 0.24)}px`,
    "--curve-x-exit": `${Math.round(curveX * 0.42)}px`,
    "--curve-x-hover": `${Math.round(curveX * 0.12)}px`,
    "--curve-x-mid": `${Math.round(curveX * 0.2)}px`,
    "--curve-y-bend": `${Math.round(curveY * 0.22)}px`,
    "--curve-y-rise": `${Math.round(-curveY * 0.42)}px`,
    "--card-depth": depth.toFixed(2),
    "--card-depth-high": highDepth.toFixed(2),
    "--card-depth-hover": hoverDepth.toFixed(2),
    "--card-depth-low": lowDepth.toFixed(2),
    "--card-z": `${cardZ}px`,
    "--card-z-high": `${cardZ + 22}px`,
    "--card-z-low": `${cardZ - 18}px`,
    "--path-x": `${pathX}px`,
    "--path-y": `${pathY}px`,
    "--tilt": `${tilt}deg`,
    "--tilt-hover": `${Math.round(tilt * -0.28)}deg`,
    "--tilt-mid": `${Math.round(tilt * -0.55)}deg`,
    "--card-delay": `${index * 55}ms`
  } as CSSProperties;
}

function parseFileName(file: File): Pick<Track, "title" | "artist" | "album"> {
  const clean = file.name.replace(/\.[^.]+$/, "");
  const parts = clean.split(/\s+-\s+/);

  if (parts.length >= 2) {
    return {
      artist: parts[0].trim() || "Unknown Artist",
      title: parts.slice(1).join(" - ").trim() || clean,
      album: "Local Cart"
    };
  }

  return {
    artist: "Unknown Artist",
    title: clean,
    album: "Local Cart"
  };
}

function createTracksFromFiles(files: FileList | File[]) {
  return Array.from(files)
    .filter((file) => file.type.startsWith("audio/") || audioExtensions.test(file.name))
    .map((file) => {
      const parsed = parseFileName(file);

      return {
        id: `${file.name}-${file.size}-${file.lastModified}`,
        title: parsed.title,
        artist: parsed.artist,
        album: parsed.album,
        fileName: file.name,
        size: file.size,
        url: URL.createObjectURL(file),
        duration: 0,
        favorite: false,
        badge: "heart" as BadgeId,
        dateAdded: Date.now()
      };
    });
}

function enhanceHostTracks(hostTracks: CodyFileTrack[]) {
  return hostTracks.map((track) => ({
    ...track,
    duration: track.duration ?? 0,
    favorite: false,
    badge: "heart" as BadgeId,
    dateAdded: Date.now()
  }));
}

async function loadPreviewDefaultLibrary() {
  try {
    const response = await fetch("/__cody_music__/library");

    if (!response.ok) {
      return [];
    }

    return (await response.json()) as CodyFileTrack[];
  } catch {
    return [];
  }
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === "\"") {
      if (quoted && nextCharacter === "\"") {
        field += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      row.push(field);
      if (row.some((cell) => cell.trim())) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) {
    rows.push(row);
  }

  return rows;
}

function cleanHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function parseTakeoutCsvText(text: string, sourceFile: string) {
  const rows = parseCsv(text);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(cleanHeader);
  const videoIdIndex = headers.indexOf("video id");
  const titleIndex = headers.indexOf("song title");
  const albumIndex = headers.indexOf("album title");
  const artistIndexes = headers
    .map((header, index) => (header.startsWith("artist name") ? index : -1))
    .filter((index) => index >= 0);

  if (titleIndex < 0) {
    return [];
  }

  return rows.slice(1).flatMap((row, index) => {
    const title = (row[titleIndex] ?? "").trim();

    if (!title) {
      return [];
    }

    const videoId = videoIdIndex >= 0 ? (row[videoIdIndex] ?? "").trim() : "";
    const album = albumIndex >= 0 ? (row[albumIndex] ?? "").trim() : "";
    const artists = artistIndexes
      .map((artistIndex) => (row[artistIndex] ?? "").trim())
      .filter(Boolean);
    const artistSignature = artists.join("|") || "unknown";
    const fallbackId = hashText(`${title}-${album}-${artistSignature}-${index}`);

    return [
      {
        id: `yt-${videoId || fallbackId}-${index}`,
        videoId,
        title,
        album: album || "Unknown Album",
        artists: artists.length ? artists : ["Unknown Artist"],
        sourceFile,
        dateAdded: Date.now()
      }
    ];
  });
}

function takeoutSongKey(song: TakeoutSong) {
  if (song.videoId) {
    return `video:${song.videoId}`;
  }

  return `song:${normalizeSongText(song.title)}:${normalizeSongText(song.album)}:${song.artists.map(normalizeSongText).join("|")}`;
}

function mergeTakeoutSongs(existing: TakeoutSong[], incoming: TakeoutSong[]) {
  const known = new Set(existing.map(takeoutSongKey));
  const imported = incoming.filter((song) => {
    const key = takeoutSongKey(song);

    if (known.has(key)) {
      return false;
    }

    known.add(key);
    return true;
  });

  return [...existing, ...imported];
}

function mergeTrackCollections(existing: Track[], incoming: Track[]) {
  const incomingById = new Map(incoming.map((track) => [track.id, track]));
  const known = new Set<string>();
  const refreshedExisting = existing.map((track) => {
    const incomingTrack = incomingById.get(track.id);
    known.add(track.id);

    if (!incomingTrack) {
      return track;
    }

    return {
      ...incomingTrack,
      badge: track.badge,
      dateAdded: track.dateAdded,
      duration: incomingTrack.duration || track.duration,
      favorite: track.favorite
    };
  });
  const imported = incoming.filter((track) => {
    if (known.has(track.id)) {
      return false;
    }

    known.add(track.id);
    return true;
  });

  return [...refreshedExisting, ...imported];
}

function normalizeSongText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(feat|ft|featuring|with)\b/g, " ")
    .replace(/\b[x×]\b/g, " ")
    .replace(/&|\+/g, " ")
    .replace(/\[[^\]]*(remix|slowed|sped|nightcore|edit|version|clean|explicit)[^\]]*\]/g, " ")
    .replace(/\([^)]*(remix|slowed|sped|nightcore|edit|version|clean|explicit)[^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function artistCandidates(value: string) {
  const normalized = normalizeSongText(value);
  const splitArtists = value
    .split(/\s*(?:,|&|\+|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b|×)\s*/i)
    .map(normalizeSongText)
    .filter(Boolean);

  return [...new Set([normalized, ...splitArtists].filter(Boolean))];
}

function buildTrackMatchIndex(tracks: Track[]) {
  const byTitleArtist = new Map<string, Track>();
  const byTitleAlbum = new Map<string, Track>();
  const titleBuckets = new Map<string, Track[]>();

  tracks.forEach((track) => {
    const title = normalizeSongText(track.title);
    const album = normalizeSongText(track.album);

    if (!title) {
      return;
    }

    artistCandidates(track.artist).forEach((artist) => {
      byTitleArtist.set(`${title}::${artist}`, track);
    });

    if (album) {
      byTitleAlbum.set(`${title}::${album}`, track);
    }

    titleBuckets.set(title, [...(titleBuckets.get(title) ?? []), track]);
  });

  return {
    byTitleAlbum,
    byTitleArtist,
    titleBuckets
  };
}

function matchTakeoutSong(song: TakeoutSong, index: ReturnType<typeof buildTrackMatchIndex>) {
  const title = normalizeSongText(song.title);
  const album = normalizeSongText(song.album);

  if (!title) {
    return undefined;
  }

  for (const artist of song.artists.map(normalizeSongText).filter(Boolean)) {
    const match = index.byTitleArtist.get(`${title}::${artist}`);

    if (match) {
      return match;
    }
  }

  if (album) {
    const albumMatch = index.byTitleAlbum.get(`${title}::${album}`);

    if (albumMatch) {
      return albumMatch;
    }
  }

  const titleMatches = index.titleBuckets.get(title) ?? [];
  return title.length > 6 && titleMatches.length === 1 ? titleMatches[0] : undefined;
}

function createTakeoutMatchMap(songs: TakeoutSong[], tracks: Track[]) {
  const index = buildTrackMatchIndex(tracks);
  return new Map(songs.map((song) => [song.id, matchTakeoutSong(song, index)]));
}

function countMatchedTakeoutRows(songs: TakeoutSong[], tracks: Track[]) {
  const matches = createTakeoutMatchMap(songs, tracks);
  return songs.filter((song) => matches.get(song.id)).length;
}

function takeoutSearchText(song: TakeoutSong) {
  return `${song.title} ${song.album} ${song.artists.join(" ")} ${song.videoId}`.toLowerCase();
}

function trackSearchText(track: Track) {
  return `${track.title} ${track.artist} ${track.album} ${track.fileName} ${track.filePath ?? ""} ${
    track.youtubeVideoId ?? ""
  } ${track.metadataSource ?? ""}`.toLowerCase();
}

function isTakeoutMatched(track: Track | undefined) {
  return Boolean(track?.metadataSource?.includes("Takeout"));
}

function hasTagGap(track: Track | undefined) {
  return Boolean(track) && (!isTakeoutMatched(track) || !track?.artworkUrl);
}

function getStatusChips(track: Track | undefined, missingSong?: TakeoutSong): StatusChip[] {
  if (!track) {
    return [
      { label: "MISSING FILE", query: "missing:file", tone: "alert" },
      { label: "YT ROW", query: missingSong?.videoId ? `yt:${missingSong.videoId}` : "tag:takeout", tone: "muted" }
    ];
  }

  const chips: StatusChip[] = [];

  if (track.youtubeVideoId) {
    chips.push({ label: "YT MATCH", query: "status:matched", tone: "match" });
  } else if (isTakeoutMatched(track)) {
    chips.push({ label: "YT AMBIG", query: "status:ambiguous", tone: "muted" });
  } else {
    chips.push({ label: "LOCAL ONLY", query: "status:local", tone: "muted" });
  }

  if (track.metadataSource?.toLowerCase().includes("ambiguous") || track.album.toLowerCase().includes("takeout matches")) {
    chips.push({ label: "DUPLICATE?", query: "status:duplicate", tone: "alert" });
  }

  if (!track.artworkUrl) {
    chips.push({ label: "NO COVER", query: "missing:cover", tone: "alert" });
  }

  if (!isTakeoutMatched(track)) {
    chips.push({ label: "TAG GAP", query: "tag:gap", tone: "alert" });
  }

  if (formatMatchConfidence(track) > 0 && formatMatchConfidence(track) < 80) {
    chips.push({ label: "LOW CONF", query: "match:<80", tone: "alert" });
  }

  return chips;
}

function stripQueryQuotes(value: string) {
  return value.replace(/^["']|["']$/g, "").trim().toLowerCase();
}

function cardMatchesCatalogQuery(card: ShelfCard, rawQuery: string) {
  const tokens = rawQuery.match(/"[^"]+"|'[^']+'|\S+/g)?.map(stripQueryQuotes).filter(Boolean) ?? [];

  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => {
    const [rawKey, ...rest] = token.split(":");
    const hasKey = rest.length > 0;
    const key = hasKey ? rawKey : "";
    const value = hasKey ? rest.join(":") : token;
    const track = card.kind === "track" ? card.track : undefined;
    const song = card.kind === "missing" ? card.song : undefined;
    const searchable = card.kind === "track" ? trackSearchText(card.track) : takeoutSearchText(card.song);

    if (!hasKey) {
      return searchable.includes(value);
    }

    if (key === "artist") {
      return (track?.artist ?? song?.artists.join(" ") ?? "").toLowerCase().includes(value);
    }

    if (key === "album") {
      return (track?.album ?? song?.album ?? "").toLowerCase().includes(value);
    }

    if (key === "title" || key === "track") {
      return (track?.title ?? song?.title ?? "").toLowerCase().includes(value);
    }

    if (key === "yt") {
      return (track?.youtubeVideoId ?? song?.videoId ?? "").toLowerCase().includes(value);
    }

    if (key === "type") {
      return `${track?.fileName ?? ""} ${track?.codec ?? ""}`.toLowerCase().includes(value);
    }

    if (key === "missing") {
      if (value === "cover") {
        return track ? !track.artworkUrl : true;
      }

      if (value === "file") {
        return card.kind === "missing";
      }

      return false;
    }

    if (key === "status") {
      if (!track) {
        return value === "missing";
      }

      if (value === "matched") {
        return Boolean(track.youtubeVideoId);
      }

      if (value === "ambiguous") {
        return isTakeoutMatched(track) && !track.youtubeVideoId;
      }

      if (value === "duplicate") {
        return Boolean(
          track.metadataSource?.toLowerCase().includes("ambiguous") ||
            track.album.toLowerCase().includes("takeout matches")
        );
      }

      if (value === "local") {
        return !isTakeoutMatched(track);
      }
    }

    if (key === "tag") {
      if (value === "gap") {
        return hasTagGap(track);
      }

      if (value === "takeout") {
        return isTakeoutMatched(track);
      }
    }

    if (key === "match") {
      const comparison = value.match(/^([<>]=?|=)?(\d+)$/);

      if (!comparison || !track) {
        return false;
      }

      const operator = comparison[1] ?? "=";
      const target = Number(comparison[2]);
      const confidence = formatMatchConfidence(track);

      if (operator === "<") {
        return confidence < target;
      }

      if (operator === "<=") {
        return confidence <= target;
      }

      if (operator === ">") {
        return confidence > target;
      }

      if (operator === ">=") {
        return confidence >= target;
      }

      return confidence === target;
    }

    return searchable.includes(value);
  });
}

// Rotary AMP knob: replaces the range slider but keeps role=slider + aria for
// accessibility. Vertical drag / wheel / arrow keys adjust volume; the arc and
// dB label read out the amp gain.
function VolumeKnob({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null);

  const clamp = (next: number) => Math.min(1, Math.max(0, next));
  const angle = -135 + value * 270;
  const label = formatGain(value, 0);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startY: event.clientY, startValue: value };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) {
      return;
    }

    const delta = (dragRef.current.startY - event.clientY) / 160;
    onChange(clamp(dragRef.current.startValue + delta));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    onChange(clamp(value - Math.sign(event.deltaY) * 0.04));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      onChange(clamp(value + 0.05));
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      onChange(clamp(value - 0.05));
    }
  }

  return (
    <div
      className="amp-knob"
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${Math.round(value * 100)} percent, ${label}`}
      style={{ "--knob-angle": `${angle}deg`, "--knob-fill": value.toFixed(3) } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      <svg viewBox="0 0 48 48" className="amp-knob-face" aria-hidden="true">
        <circle className="amp-knob-arc-track" cx="24" cy="24" r="20" pathLength={100} />
        <circle
          className="amp-knob-arc-fill"
          cx="24"
          cy="24"
          r="20"
          pathLength={100}
          style={{ strokeDashoffset: 100 - value * 75 }}
        />
        <g className="amp-knob-body">
          <circle cx="24" cy="24" r="14" />
          <line className="amp-knob-pointer" x1="24" y1="24" x2="24" y2="12" />
        </g>
      </svg>
      <span className="amp-knob-db">{label}</span>
    </div>
  );
}

// Twin analog VU needles (L/R) with peak-hold. Purely presentational — the
// audio loop writes --vu-l/--vu-r/--vu-peak-* onto containerRef each frame.
function VuMeter({ containerRef }: { containerRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div ref={containerRef} className="vu-meter" aria-hidden="true">
      {(["L", "R"] as const).map((channel) => (
        <div key={channel} className={`vu-gauge vu-gauge-${channel.toLowerCase()}`}>
          <span className="vu-arc" />
          <span className="vu-peak" />
          <span className="vu-needle" />
          <span className="vu-label">{channel}</span>
        </div>
      ))}
    </div>
  );
}

function App() {
  const storeDemoMode = isStoreDemoMode();
  const storePosterMode = isStorePosterMode();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analysisCacheRef = useRef<Map<string, Promise<TrackAnalysis> | TrackAnalysis>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ampGainRef = useRef<GainNode | null>(null);
  const toneShelfRef = useRef<BiquadFilterNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const analyserLRef = useRef<AnalyserNode | null>(null);
  const analyserRRef = useRef<AnalyserNode | null>(null);
  const vuMeterRef = useRef<HTMLDivElement | null>(null);
  const vuStateRef = useRef({ l: 0, r: 0, peakL: 0, peakR: 0, peakHoldL: 0, peakHoldR: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const bassAnalyserRef = useRef<AnalyserNode | null>(null);
  const bassBinsRef = useRef<Uint8Array | null>(null);
  const bassEnvelopeRef = useRef({ floor: 0.035, hold: 0, last: 0, peak: 0.26 });
  const bassFilterRef = useRef<BiquadFilterNode | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInspectorRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const takeoutInputRef = useRef<HTMLInputElement | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const defaultLibraryLoadedRef = useRef(false);
  const microGlitchResetRef = useRef<number | null>(null);
  const microGlitchTimerRef = useRef<number | null>(null);
  const previousTrackIdRef = useRef("");
  const relockTimerRef = useRef<number | null>(null);
  const shelfWheelAtRef = useRef(0);
  const shelfWheelDeltaRef = useRef(0);
  const shelfWheelTsRef = useRef(0);
  const seekPulseTimerRef = useRef<number | null>(null);
  const systemMessageTimerRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const visualizerRef = useRef<HTMLDivElement | null>(null);
  const signalColumnsRef = useRef<HTMLDivElement | null>(null);
  const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bassLevelRef = useRef(0);
  const beatRef = useRef({ pulse: 0, gate: 0, threshold: 0.12 });
  const lastTickAtRef = useRef(0);
  const shuttleRateRef = useRef(0);
  const countedPlayForRef = useRef("");
  const [initialState] = useState<StoredState>(() => loadStoredState());
  const [tracks, setTracks] = useState<Track[]>(() => initialState.tracks ?? []);
  const [takeoutSongs, setTakeoutSongs] = useState<TakeoutSong[]>(() => initialState.takeoutSongs ?? []);
  const [currentId, setCurrentId] = useState(() => initialState.currentId ?? "");
  const [interference, setInterference] = useState<InterferenceMode>(() => initialState.interference ?? "low");
  const [isPlaying, setIsPlaying] = useState(false);
  const [query, setQuery] = useState("");
  const [volume, setVolume] = useState(() => initialState.volume ?? 0.72);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [importStatus, setImportStatus] = useState("Loading desktop music");
  const [isDragActive, setIsDragActive] = useState(false);
  const [activeShelf, setActiveShelf] = useState<ShelfView>(() => initialState.activeShelf ?? "library");
  const [saveSlots, setSaveSlots] = useState<SaveSlot[]>(() =>
    initialState.saveSlots?.length ? initialState.saveSlots : cloneDefaultSaveSlots()
  );
  const [scanlines] = useState(() => initialState.scanlines ?? true);
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => prefersReducedMotion());
  const reducedMotion = initialState.reducedMotion === true || systemReducedMotion;
  const [bootMode, setBootMode] = useState<"boot" | "reindex" | null>(() => (storeDemoMode ? null : "boot"));
  const [isRelocking, setIsRelocking] = useState(false);
  const [microGlitch, setMicroGlitch] = useState<MicroGlitchKind | null>(null);
  const [seekPulse, setSeekPulse] = useState("");
  const [transientSystemMessage, setTransientSystemMessage] = useState("");
  const [cartridgeSwap, setCartridgeSwap] = useState<"ejecting" | "inserting" | null>(null);
  const [consoleScale, setConsoleScale] = useState(1);
  const [attract, setAttract] = useState(false);
  const [shuttle, setShuttle] = useState<{ dir: 1 | -1; rate: number } | null>(null);
  const cartridgeSwapTimerRef = useRef<number | null>(null);

  const currentTrack = tracks.find((track) => track.id === currentId);
  const currentPlayCount = currentTrack?.playCount ?? 0;
  const currentWearTier = currentPlayCount >= 25 ? 3 : currentPlayCount >= 10 ? 2 : currentPlayCount >= 3 ? 1 : 0;
  const takeoutMatchMap = useMemo(() => createTakeoutMatchMap(takeoutSongs, tracks), [takeoutSongs, tracks]);
  const takeoutMatchedCount = useMemo(
    () => takeoutSongs.filter((song) => takeoutMatchMap.get(song.id)).length,
    [takeoutMatchMap, takeoutSongs]
  );
  const takeoutMissingCount = Math.max(0, takeoutSongs.length - takeoutMatchedCount);
  const activeSaveSlot = saveSlots.find((slot) => slot.id === activeShelf);

  const shelfTracks = useMemo(() => {
    if (activeShelf === "library") {
      return tracks;
    }

    if (activeShelf === "favorites") {
      return tracks.filter((track) => track.favorite);
    }

    if (activeShelf === "takeout") {
      const matchedTracks = takeoutSongs
        .map((song) => takeoutMatchMap.get(song.id))
        .filter((track): track is Track => Boolean(track));
      const seen = new Set<string>();

      return matchedTracks.filter((track) => {
        if (seen.has(track.id)) {
          return false;
        }

        seen.add(track.id);
        return true;
      });
    }

    if (activeShelf === "missing") {
      return [];
    }

    const slot = saveSlots.find((item) => item.id === activeShelf);
    const slotTrackIds = new Set(slot?.trackIds ?? []);
    return tracks.filter((track) => slotTrackIds.has(track.id));
  }, [activeShelf, saveSlots, takeoutMatchMap, takeoutSongs, tracks]);

  const shelfCards = useMemo<ShelfCard[]>(() => {
    if (activeShelf === "takeout" || activeShelf === "missing") {
      return takeoutSongs.flatMap((song): ShelfCard[] => {
        const matchedTrack = takeoutMatchMap.get(song.id);

        if (matchedTrack) {
          return activeShelf === "missing" ? [] : [{ kind: "track", id: `matched-${song.id}`, track: matchedTrack }];
        }

        return [
          {
            kind: "missing",
            id: `missing-${song.id}`,
            song,
            artSource: {
              title: song.title,
              artist: song.artists.join(", "),
              album: song.album
            }
          }
        ];
      });
    }

    return shelfTracks.map((track) => ({ kind: "track", id: track.id, track }));
  }, [activeShelf, shelfTracks, takeoutMatchMap, takeoutSongs]);

  const filteredCards = useMemo(() => {
    return shelfCards.filter((card) => cardMatchesCatalogQuery(card, query));
  }, [query, shelfCards]);

  const playbackQueue = query
    ? filteredCards.flatMap((card) => (card.kind === "track" ? [card.track] : []))
    : shelfTracks;
  const hasPlayableQueue = playbackQueue.length > 0;
  const playbackDuration = duration || currentTrack?.duration || 0;
  const playbackProgress = playbackDuration > 0 ? Math.min(100, Math.max(0, (currentTime / playbackDuration) * 100)) : 0;
  const matchConfidence = formatMatchConfidence(currentTrack);
  const ytMatchCount = tracks.filter((track) => track.youtubeVideoId).length;
  const takeoutMetadataCount = tracks.filter((track) => track.metadataSource?.includes("Takeout")).length;
  const tagIssueCount = tracks.filter((track) => !track.metadataSource?.includes("Takeout")).length;
  const coverMissingCount = tracks.filter((track) => !track.artworkUrl).length;
  const currentSourceLabel = formatSourceLabel(currentTrack);
  const currentQualityLine = currentTrack
    ? `${formatTime(currentTrack.duration || playbackDuration)} · ${formatBitrate(currentTrack.bitrate)} · ${formatSampleRate(
        currentTrack.sampleRate
      )}`
    : "no signal";
  const fileSourcePath = currentTrack?.filePath ?? currentTrack?.fileName ?? "no local file";
  const currentTagSummary = currentTrack
    ? `${currentTrack.artworkUrl ? "cover locked" : "cover missing"} · ${
        isTakeoutMatched(currentTrack) ? "takeout tags" : "partial tags"
      }`
    : "waiting for file";
  const currentTagErrors = currentTrack
    ? [
        currentTrack.artworkUrl ? "" : "cover missing",
        isTakeoutMatched(currentTrack) ? "" : "metadata gap",
        currentTrack.metadataSource?.toLowerCase().includes("ambiguous") ||
        currentTrack.album.toLowerCase().includes("takeout matches")
          ? "duplicate metadata"
          : ""
      ]
        .filter(Boolean)
        .join(" · ") || "none"
    : "no file";
  const focusedCardIndex = Math.max(
    0,
    filteredCards.findIndex((card) => card.kind === "track" && card.track.id === currentTrack?.id)
  );
  const shelfFlowProgress =
    filteredCards.length <= 1
      ? 50
      : Math.min(96, Math.max(4, (focusedCardIndex / (filteredCards.length - 1)) * 100));
  const catalogIndexRailStyle = useMemo(
    () => {
      const shelfPosition = `${shelfFlowProgress.toFixed(2)}%`;

      return {
        "--catalog-index-position": shelfPosition
      } as CSSProperties;
    },
    [shelfFlowProgress]
  );
  const bassMeterStyle = {
    "--playback-progress": `${playbackProgress}%`,
    "--playback-ratio": (playbackProgress / 100).toFixed(4),
    "--interference-level":
      interference === "off" ? "0" : interference === "low" ? "1" : interference === "med" ? "2" : "3",
    "--signal-confidence": (matchConfidence / 100).toFixed(2)
  } as CSSProperties;
  const activeShelfLabel =
    activeShelf === "library"
      ? "Local"
      : activeShelf === "favorites"
        ? "Crowned"
        : activeShelf === "takeout"
          ? "YT Map"
          : activeShelf === "missing"
            ? "Missing"
            : activeSaveSlot?.label ?? "Save slot";
  const currentTrackIndex = tracks.findIndex((track) => track.id === currentTrack?.id);
  const currentTrackNumber = currentTrackIndex >= 0 ? currentTrackIndex + 1 : 0;
  const systemStatus = `CODY NOIR // LOCAL INDEX · ${tracks.length.toString().padStart(2, "0")} FILES · ${ytMatchCount
    .toString()
    .padStart(2, "0")} MATCHED · ${tagIssueCount.toString().padStart(2, "0")} TAG GAPS · ${activeShelfLabel.toUpperCase()}`;
  const diagnosticsTitle = `${importStatus} · ${takeoutMetadataCount} Takeout metadata rows · ${coverMissingCount} cover gaps · ${takeoutMissingCount} missing local rows`;
  const derivedSystemMessage = currentTrack
    ? isPlaying
      ? "SIGNAL LOCKED"
      : hasTagGap(currentTrack)
        ? "TRACE FOUND / TAG GAP"
        : "TRACE FOUND"
    : "AWAITING FILE";
  const systemMessage = transientSystemMessage || derivedSystemMessage;
  const bootLines =
    bootMode === "reindex"
      ? [
          "SHELF REINDEXED",
          `${tracks.length.toString().padStart(2, "0")} FILES FOUND`,
          `${ytMatchCount.toString().padStart(2, "0")} YT MATCHES`,
          `${tagIssueCount.toString().padStart(2, "0")} TAG GAPS`,
          "READY"
        ]
      : [
          "CODY NOIR",
          "LOCAL INDEX INITIALIZING",
          "SOURCE USER-SELECTED AUDIO",
          `${tracks.length.toString().padStart(2, "0")} FILES FOUND`,
          `${ytMatchCount.toString().padStart(2, "0")} MATCHED · ${tagIssueCount
            .toString()
            .padStart(2, "0")} TAG GAPS`,
          "READY"
        ];
  useEffect(() => {
    // When the Web Audio graph is live, volume + warmth run through the amp
    // stage so meters/scope/VU react to the knob; otherwise fall back to the
    // element's own gain before the graph is built.
    if (ampGainRef.current) {
      ampGainRef.current.gain.value = volume;

      if (toneShelfRef.current) {
        toneShelfRef.current.gain.value = (volume - 0.5) * 8;
      }

      if (audioRef.current) {
        audioRef.current.volume = 1;
      }
    } else if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  function flashSystemMessage(message: string, durationMs = 900) {
    setTransientSystemMessage(message);

    if (systemMessageTimerRef.current !== null) {
      window.clearTimeout(systemMessageTimerRef.current);
    }

    systemMessageTimerRef.current = window.setTimeout(() => {
      setTransientSystemMessage("");
      systemMessageTimerRef.current = null;
    }, reducedMotion ? 120 : durationMs);
  }

  function triggerRelock(message = "TRACE FOUND") {
    flashSystemMessage(message, 850);

    if (interference === "off" || reducedMotion) {
      return;
    }

    setIsRelocking(true);

    if (relockTimerRef.current !== null) {
      window.clearTimeout(relockTimerRef.current);
    }

    relockTimerRef.current = window.setTimeout(() => {
      setIsRelocking(false);
      relockTimerRef.current = null;
    }, interference === "max" ? 260 : interference === "med" ? 220 : 160);
  }

  function triggerReindex() {
    flashSystemMessage("SHELF REINDEXED", 1100);
    setBootMode("reindex");
  }

  function selectShelfOffset(offset: number) {
    const playableCards = filteredCards.filter((card): card is TrackCard => card.kind === "track");

    if (playableCards.length === 0) {
      return;
    }

    const currentIndex = playableCards.findIndex((card) => card.track.id === currentTrack?.id);
    const nextIndex =
      currentIndex < 0
        ? offset > 0
          ? 0
          : playableCards.length - 1
        : (currentIndex + offset + playableCards.length) % playableCards.length;

    setCurrentId(playableCards[nextIndex].track.id);
  }

  function pulseSeekLabel(nextTime: number, previousTime: number) {
    const delta = Math.round(nextTime - previousTime);
    const sign = delta >= 0 ? "+" : "-";
    setSeekPulse(`SIGNAL OFFSET ${sign}${Math.abs(delta).toString().padStart(3, "0")}`);
    flashSystemMessage("SCRUBBING...", 520);

    if (seekPulseTimerRef.current !== null) {
      window.clearTimeout(seekPulseTimerRef.current);
    }

    seekPulseTimerRef.current = window.setTimeout(() => {
      setSeekPulse("");
      seekPulseTimerRef.current = null;
    }, reducedMotion ? 120 : 620);
  }

  function resetLocalLibraryState() {
    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    stopVisualizerFrame();
    analysisCacheRef.current.clear();
    window.localStorage.removeItem(storageKey);
    setTracks([]);
    setTakeoutSongs([]);
    setCurrentId("");
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setQuery("");
    setActiveShelf("library");
    setSaveSlots(cloneDefaultSaveSlots());
    setImportStatus("Local library reset");
    setBootMode("reindex");
    flashSystemMessage("LOCAL DATA CLEARED", 1200);
  }

  useEffect(() => {
    if (defaultLibraryLoadedRef.current) {
      return;
    }

    defaultLibraryLoadedRef.current = true;

    if (storeDemoMode) {
      setImportStatus("Store screenshot demo catalog");
      return;
    }

    setActiveShelf("library");

    async function loadDefaultLibrary() {
      setImportStatus("Loading desktop music");
      const previewTracks = await loadPreviewDefaultLibrary();
      const selectedTracks =
        previewTracks.length > 0
          ? previewTracks
          : window.musicHost?.loadDefaultLibrary
            ? await window.musicHost.loadDefaultLibrary()
            : [];

      if (!selectedTracks || selectedTracks.length === 0) {
        setImportStatus("No local audio files found");
        return;
      }

      replaceTracks(enhanceHostTracks(selectedTracks));
    }

    loadDefaultLibrary();
  }, [storeDemoMode]);

  useEffect(() => {
    if (!bootMode) {
      return;
    }

    const duration = reducedMotion ? 300 : bootMode === "reindex" ? 1150 : 2000;
    const timeout = window.setTimeout(() => setBootMode(null), duration);
    return () => window.clearTimeout(timeout);
  }, [bootMode, reducedMotion]);

  // Boot self-test: during the cinematic power-on, sweep a synthetic trace
  // across the scope and swing the VU needles, so the hardware "warms up".
  useEffect(() => {
    if (bootMode !== "boot" || reducedMotion) {
      return undefined;
    }

    let rafId: number | null = null;
    let start = 0;
    const wave = new Uint8Array(2048);

    const render = (ts: number) => {
      if (!start) {
        start = ts;
      }

      const elapsed = ts - start;
      const progress = Math.min(1, elapsed / 1400);
      // A sweep that fills in left-to-right, then settles into a full trace.
      const reach = Math.min(1, progress * 1.35);
      const energy = progress < 0.7 ? progress / 0.7 : 1 - (progress - 0.7) / 0.3 * 0.4;

      for (let index = 0; index < wave.length; index += 1) {
        const t = index / wave.length;
        const inReach = t <= reach ? 1 : 0;
        const value =
          (Math.sin(t * Math.PI * 9 + elapsed * 0.02) * 0.5 +
            Math.sin(t * Math.PI * 30 + elapsed * 0.03) * 0.3) *
          energy *
          inReach;
        wave[index] = Math.max(0, Math.min(255, Math.round(128 + value * 96)));
      }

      drawScopeTrace(wave, 0.4 + energy * 0.3, elapsed % 300 < 40 ? 1 : 0.3);
      const vu = vuStateRef.current;
      // Needles sweep up to full then settle.
      const swing = progress < 0.5 ? progress * 2 : 1 - (progress - 0.5) * 1.2;
      vu.l = Math.max(0, swing);
      vu.r = Math.max(0, swing * 0.9);
      vu.peakHoldL = Math.max(vu.peakHoldL, vu.l);
      vu.peakHoldR = Math.max(vu.peakHoldR, vu.r);
      writeVuNeedles();

      if (progress < 1) {
        rafId = window.requestAnimationFrame(render);
      }
    };

    rafId = window.requestAnimationFrame(render);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootMode, reducedMotion]);

  useEffect(() => {
    if ((activeShelf === "takeout" || activeShelf === "missing") && takeoutSongs.length === 0) {
      setActiveShelf("library");
    }
  }, [activeShelf, takeoutSongs.length]);

  useEffect(() => {
    if (microGlitchTimerRef.current !== null) {
      window.clearTimeout(microGlitchTimerRef.current);
      microGlitchTimerRef.current = null;
    }

    if (microGlitchResetRef.current !== null) {
      window.clearTimeout(microGlitchResetRef.current);
      microGlitchResetRef.current = null;
    }

    setMicroGlitch(null);

    if (!isPlaying || interference === "off" || reducedMotion) {
      return;
    }

    let isCancelled = false;

    const scheduleMicroGlitch = () => {
      const minDelay = interference === "low" ? 35000 : interference === "med" ? 28000 : 25000;
      const maxDelay = interference === "low" ? 45000 : interference === "med" ? 38000 : 32000;
      const delay = minDelay + Math.round(Math.random() * (maxDelay - minDelay));
      const candidates: MicroGlitchKind[] =
        interference === "low"
          ? ["header", "map"]
          : interference === "med"
            ? ["header", "map", "row", "shelf"]
            : ["header", "map", "row", "shelf"];

      microGlitchTimerRef.current = window.setTimeout(() => {
        if (isCancelled) {
          return;
        }

        setMicroGlitch(candidates[Math.floor(Math.random() * candidates.length)] ?? "header");
        microGlitchResetRef.current = window.setTimeout(
          () => {
            setMicroGlitch(null);
            if (!isCancelled) {
              scheduleMicroGlitch();
            }
          },
          interference === "max" ? 240 : interference === "med" ? 210 : 170
        );
      }, delay);
    };

    scheduleMicroGlitch();

    return () => {
      isCancelled = true;
      if (microGlitchTimerRef.current !== null) {
        window.clearTimeout(microGlitchTimerRef.current);
        microGlitchTimerRef.current = null;
      }
      if (microGlitchResetRef.current !== null) {
        window.clearTimeout(microGlitchResetRef.current);
        microGlitchResetRef.current = null;
      }
    };
  }, [interference, isPlaying, reducedMotion]);

  useEffect(() => {
    if (!currentId) {
      return;
    }

    if (!previousTrackIdRef.current) {
      previousTrackIdRef.current = currentId;
      return;
    }

    if (previousTrackIdRef.current !== currentId) {
      previousTrackIdRef.current = currentId;
      triggerRelock(hasTagGap(currentTrack) ? "TRACE FOUND / TAG GAP" : "TRACE FOUND");

      // Physical cartridge swap: eject the old, click in the new.
      if (!reducedMotion) {
        if (cartridgeSwapTimerRef.current !== null) {
          window.clearTimeout(cartridgeSwapTimerRef.current);
        }

        setCartridgeSwap("ejecting");
        cartridgeSwapTimerRef.current = window.setTimeout(() => {
          setCartridgeSwap("inserting");
          cartridgeSwapTimerRef.current = window.setTimeout(() => {
            setCartridgeSwap(null);
            cartridgeSwapTimerRef.current = null;
          }, 340);
        }, 160);
      }
    }
  }, [currentId, currentTrack?.id, currentTrack?.metadataSource, currentTrack?.artworkUrl, reducedMotion]);

  useEffect(() => {
    if (!audioRef.current || !currentTrack?.url || !isLocalPlaybackUrl(currentTrack.url)) {
      if (currentTrack?.url && !isLocalPlaybackUrl(currentTrack.url)) {
        setIsPlaying(false);
      }

      return;
    }

    const currentUrl = resolveTrackUrl(currentTrack.url)?.href;

    if (currentUrl && audioRef.current.currentSrc !== currentUrl && audioRef.current.getAttribute("src") !== currentTrack.url) {
      audioRef.current.src = currentTrack.url;
      audioRef.current.load();
      setCurrentTime(0);
    }

    if (isPlaying) {
      startAudioPlayback();
    }
  }, [currentTrack?.id, currentTrack?.url, isPlaying]);

  useEffect(() => {
    writeBassVars(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isPlaying && !reducedMotion) {
      startVisualizerFrame();
      return;
    }

    stopVisualizerFrame();
  }, [isPlaying, reducedMotion]);

  // Store-poster: build a representative phosphor trace + deflected VU so
  // marketing screenshots show the reactive hardware even with no audio.
  useEffect(() => {
    if (!isStorePosterMode()) {
      return undefined;
    }

    let frame = 0;
    let rafId: number | null = null;
    const wave = new Uint8Array(2048);

    const render = () => {
      for (let index = 0; index < wave.length; index += 1) {
        const t = index / wave.length;
        const value =
          Math.sin(t * Math.PI * 11 + frame * 0.22) * 0.5 +
          Math.sin(t * Math.PI * 33 + frame * 0.4) * 0.26 +
          Math.sin(t * Math.PI * 3) * 0.2;
        wave[index] = Math.max(0, Math.min(255, Math.round(128 + value * 96)));
      }

      drawScopeTrace(wave, 0.55, frame % 12 === 0 ? 1 : 0.35);
      writeBassVars(0.5, 0.35);
      const vu = vuStateRef.current;
      vu.l = 0.64;
      vu.r = 0.56;
      vu.peakHoldL = 0.82;
      vu.peakHoldR = 0.72;
      writeVuNeedles();
      writeMeterLevels(
        Array.from({ length: 24 }, (_, index) => 20 + Math.round(58 * Math.abs(Math.sin(index * 0.5 + 1.2))))
      );

      frame += 1;
      if (frame < 34) {
        rafId = window.requestAnimationFrame(render);
      }
    };

    const startTimer = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(render);
    }, 80);

    return () => {
      window.clearTimeout(startTimer);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      stopVisualizerFrame();
      audioContextRef.current?.close();
      if (relockTimerRef.current !== null) {
        window.clearTimeout(relockTimerRef.current);
      }
      if (microGlitchTimerRef.current !== null) {
        window.clearTimeout(microGlitchTimerRef.current);
      }
      if (microGlitchResetRef.current !== null) {
        window.clearTimeout(microGlitchResetRef.current);
      }
      if (seekPulseTimerRef.current !== null) {
        window.clearTimeout(seekPulseTimerRef.current);
      }
      if (systemMessageTimerRef.current !== null) {
        window.clearTimeout(systemMessageTimerRef.current);
      }
      if (cartridgeSwapTimerRef.current !== null) {
        window.clearTimeout(cartridgeSwapTimerRef.current);
      }
    };
  }, []);

  // Scale-to-fit: the console is a fixed 1440x900 stage that scales (contain)
  // to the viewport and centers, so it never clips or reflows. Exactly 1.0 at
  // a 1440x900 viewport (keeps the store smoke/screenshots pixel-stable).
  useEffect(() => {
    const DESIGN_W = 1440;
    const DESIGN_H = 900;

    const measure = () => {
      const viewport = viewportRef.current;
      const width = viewport?.clientWidth ?? window.innerWidth;
      const height = viewport?.clientHeight ?? window.innerHeight;
      const next = Math.min(width / DESIGN_W, height / DESIGN_H);
      setConsoleScale(Number.isFinite(next) && next > 0 ? next : 1);
    };

    measure();
    window.addEventListener("resize", measure);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && viewportRef.current) {
      observer = new ResizeObserver(measure);
      observer.observe(viewportRef.current);
    }

    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  // Attract mode: after a stretch of no input while music plays, fade the
  // chrome and let the scope + cartridge take the screen. Any input exits.
  useEffect(() => {
    if (storeDemoMode || reducedMotion || !isPlaying) {
      setAttract(false);
      return undefined;
    }

    let idleTimer = window.setTimeout(() => setAttract(true), 12000);

    const wake = () => {
      setAttract(false);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setAttract(true), 12000);
    };

    const events: Array<keyof WindowEventMap> = ["pointermove", "pointerdown", "keydown", "wheel"];
    events.forEach((event) => window.addEventListener(event, wake, { passive: true }));

    return () => {
      window.clearTimeout(idleTimer);
      events.forEach((event) => window.removeEventListener(event, wake));
    };
  }, [isPlaying, reducedMotion, storeDemoMode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }

    const mediaQuery = window.matchMedia(reducedMotionQuery);
    const onPreferenceChange = (event: MediaQueryListEvent) => {
      setSystemReducedMotion(event.matches);
    };

    setSystemReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", onPreferenceChange);

    return () => {
      mediaQuery.removeEventListener("change", onPreferenceChange);
    };
  }, []);

  useEffect(() => {
    if (storeDemoMode) {
      return;
    }

    const durableTracks = tracks.filter((track) => isDurablePlaybackUrl(track.url));
    const durableCurrentId = durableTracks.some((track) => track.id === currentId) ? currentId : "";

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        currentId: durableCurrentId,
        activeShelf,
        interference,
        reducedMotion: initialState.reducedMotion === true,
        scanlines,
        saveSlots,
        takeoutSongs,
        tracks: durableTracks,
        volume
      } satisfies StoredState)
    );
  }, [
    activeShelf,
    currentId,
    interference,
    initialState.reducedMotion,
    saveSlots,
    scanlines,
    storeDemoMode,
    takeoutSongs,
    tracks,
    volume
  ]);

  useEffect(() => {
    if (activeShelf === "library" || shelfTracks.length === 0) {
      return;
    }

    if (!shelfTracks.some((track) => track.id === currentId)) {
      setCurrentId(shelfTracks[0].id);
    }
  }, [activeShelf, currentId, shelfTracks]);

  useEffect(() => {
    if (!currentId) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const selectedCard = document.querySelector(`[data-track-id="${CSS.escape(currentId)}"]`) as HTMLElement | null;
        const trackList = selectedCard?.closest(".track-list") as HTMLElement | null;

        if (!selectedCard || !trackList) {
          return;
        }

        trackList.scrollTo({
          behavior: reducedMotion ? "auto" : "smooth",
          left: selectedCard.offsetLeft - (trackList.clientWidth - selectedCard.clientWidth) / 2
        });

        // Keep the active catalog row in view too as selection moves.
        const activeRow = document.querySelector(".metadata-row.active") as HTMLElement | null;
        activeRow?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
      });
    });
  }, [activeShelf, currentId, filteredCards.length, query, reducedMotion]);

  useEffect(() => {
    let isCancelled = false;

    requestTrackAnalysis(currentTrack)
      .then(() => {
        if (!isCancelled && isPlaying && animationFrameRef.current === null) {
          startVisualizerFrame();
        }
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.url, isPlaying]);

  function mergeTracks(nextTracks: Track[]) {
    if (nextTracks.length === 0) {
      setImportStatus("No local songs found");
      return;
    }

    const knownBeforeImport = new Set(tracks.map((track) => track.id));
    const importedCount = nextTracks.filter((track) => !knownBeforeImport.has(track.id)).length;
    const nextCatalog = mergeTrackCollections(tracks, nextTracks);
    const nextMatchedCount = takeoutSongs.length ? countMatchedTakeoutRows(takeoutSongs, nextCatalog) : 0;

    setTracks((existing) => {
      const incomingById = new Map(nextTracks.map((track) => [track.id, track]));
      const known = new Set<string>();
      const refreshedExisting = existing.map((track) => {
        const incomingTrack = incomingById.get(track.id);
        known.add(track.id);

        if (!incomingTrack) {
          return track;
        }

        return {
          ...incomingTrack,
          badge: track.badge,
          dateAdded: track.dateAdded,
          duration: incomingTrack.duration || track.duration,
          favorite: track.favorite
        };
      });
      const imported = nextTracks.filter((track) => !known.has(track.id));

      if (imported.length === 0) {
        return refreshedExisting;
      }

      return [...refreshedExisting, ...imported];
    });

    setCurrentId((existingId) => existingId || nextTracks[0].id);
    setActiveShelf((existingShelf) => (tracks.length === 0 ? "library" : existingShelf));
    setImportStatus(
      importedCount > 0
        ? `Imported ${importedCount} local ${importedCount === 1 ? "song" : "songs"}${
            takeoutSongs.length ? ` - ${nextMatchedCount}/${takeoutSongs.length} YT matched` : ""
          }`
        : "No new local songs found"
    );

    triggerReindex();
  }

  function replaceTracks(nextTracks: Track[]) {
    if (nextTracks.length === 0) {
      setImportStatus("No local songs found");
      return;
    }

    setTracks((existing) => {
      const existingById = new Map(existing.map((track) => [track.id, track]));

      return nextTracks.map((track) => {
        const existingTrack = existingById.get(track.id);

        if (!existingTrack) {
          return track;
        }

        return {
          ...track,
          badge: existingTrack.badge,
          dateAdded: existingTrack.dateAdded,
          duration: track.duration || existingTrack.duration,
          favorite: existingTrack.favorite
        };
      });
    });

    setCurrentId((existingId) =>
      nextTracks.some((track) => track.id === existingId) ? existingId : nextTracks[0].id
    );
    setActiveShelf("library");
    const takeoutMatchedCount = nextTracks.filter((track) => track.metadataSource?.includes("Takeout")).length;
    setImportStatus(
      `Loaded ${nextTracks.length} local ${nextTracks.length === 1 ? "song" : "songs"}${
        takeoutMatchedCount ? ` - ${takeoutMatchedCount} YT metadata matches` : ""
      }`
    );
    if (bootMode === "boot") {
      flashSystemMessage("READY", 720);
    } else {
      triggerReindex();
    }
  }

  function mergeTakeoutLibrary(nextSongs: TakeoutSong[]) {
    if (nextSongs.length === 0) {
      setImportStatus("No YouTube Music rows found");
      return;
    }

    const knownBeforeImport = new Set(takeoutSongs.map(takeoutSongKey));
    const importedCount = nextSongs.filter((song) => !knownBeforeImport.has(takeoutSongKey(song))).length;
    const nextLibrary = mergeTakeoutSongs(takeoutSongs, nextSongs);
    const matchedCount = countMatchedTakeoutRows(nextLibrary, tracks);
    const missingCount = Math.max(0, nextLibrary.length - matchedCount);

    setTakeoutSongs(nextLibrary);
    setActiveShelf(missingCount > 0 ? "missing" : "takeout");
    setImportStatus(
      importedCount > 0
        ? `Imported ${importedCount} YT ${importedCount === 1 ? "row" : "rows"} - ${matchedCount}/${nextLibrary.length} matched`
        : `YT library already loaded - ${matchedCount}/${nextLibrary.length} matched`
    );
    triggerReindex();
  }

  async function importTakeoutSources(sources: CodyTakeoutCsv[]) {
    const importedSongs = sources.flatMap((source) => parseTakeoutCsvText(source.text, source.fileName));
    mergeTakeoutLibrary(importedSongs);
  }

  async function importTakeoutCsv() {
    if (window.musicHost?.pickTakeoutCsv) {
      setImportStatus("Reading YouTube Music CSV...");
      const selectedCsvs = await window.musicHost.pickTakeoutCsv();
      await importTakeoutSources(selectedCsvs);
      return;
    }

    takeoutInputRef.current?.click();
  }

  async function importAudioFiles() {
    if (window.musicHost) {
      setImportStatus("Reading local tags...");
      const selectedTracks = await window.musicHost.pickAudioFiles();
      mergeTracks(enhanceHostTracks(selectedTracks));
      return;
    }

    inputRef.current?.click();
  }

  async function importAudioFolder() {
    if (window.musicHost?.pickAudioFolder) {
      setImportStatus("Scanning folder...");
      const selectedTracks = await window.musicHost.pickAudioFolder();
      mergeTracks(enhanceHostTracks(selectedTracks));
      return;
    }

    inputRef.current?.click();
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      mergeTracks(createTracksFromFiles(event.target.files));
      event.target.value = "";
    }
  }

  async function onTakeoutInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    if (files.length > 0) {
      setImportStatus("Reading YouTube Music CSV...");
      const sources = await Promise.all(files.map(async (file) => ({ fileName: file.name, text: await file.text() })));
      await importTakeoutSources(sources);
      event.target.value = "";
    }
  }

  async function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragActive(false);
    const files = Array.from(event.dataTransfer.files);

    if (window.musicHost?.getPathForFile && window.musicHost.importAudioPaths) {
      const filePaths = files.map((file) => window.musicHost?.getPathForFile(file) ?? "").filter(Boolean);

      if (filePaths.length > 0) {
        let handledDrop = false;

        if (window.musicHost.readTakeoutCsvPaths) {
          setImportStatus("Reading dropped Takeout CSV...");
          const takeoutSources = await window.musicHost.readTakeoutCsvPaths(filePaths);

          if (takeoutSources.length > 0) {
            await importTakeoutSources(takeoutSources);
            handledDrop = true;
          }
        }

        if (!handledDrop) {
          setImportStatus("Reading dropped covers...");
        }

        const importedTracks = await window.musicHost.importAudioPaths(filePaths);

        if (importedTracks.length > 0) {
          mergeTracks(enhanceHostTracks(importedTracks));
          handledDrop = true;
        }

        if (handledDrop) {
          return;
        }

        setImportStatus("No local songs found");
        return;
      }
    }

    const takeoutFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
    const audioFiles = files.filter((file) => !file.name.toLowerCase().endsWith(".csv"));

    if (takeoutFiles.length > 0) {
      setImportStatus("Reading dropped Takeout CSV...");
      const takeoutSources = await Promise.all(
        takeoutFiles.map(async (file) => ({ fileName: file.name, text: await file.text() }))
      );
      await importTakeoutSources(takeoutSources);
    }

    if (audioFiles.length > 0) {
      mergeTracks(createTracksFromFiles(audioFiles));
      return;
    }

    if (takeoutFiles.length === 0) {
      setImportStatus("No local songs found");
    }
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget === event.target) {
      setIsDragActive(false);
    }
  }

  function getCachedTrackAnalysis(track: Track | undefined) {
    const cached = track ? analysisCacheRef.current.get(track.id) : undefined;
    return cached && "fps" in cached ? cached : undefined;
  }

  function requestTrackAnalysis(track: Track | undefined) {
    if (!track?.url || !isLocalPlaybackUrl(track.url)) {
      return Promise.resolve(undefined);
    }

    const cached = analysisCacheRef.current.get(track.id);

    if (cached) {
      return "fps" in cached ? Promise.resolve(cached) : cached;
    }

    const analysisPromise = buildTrackAnalysis(track)
      .then((analysis) => {
        analysisCacheRef.current.set(track.id, analysis);
        return analysis;
      })
      .catch((error) => {
        analysisCacheRef.current.delete(track.id);
        throw error;
      });

    analysisCacheRef.current.set(track.id, analysisPromise);
    return analysisPromise;
  }

  function writeBassVars(bass: number, beat: number) {
    const shell = shellRef.current;

    if (!shell) {
      return;
    }

    shell.style.setProperty("--bass-level", bass.toFixed(3));
    shell.style.setProperty("--bass-scale", (1 + bass * 0.16).toFixed(3));
    shell.style.setProperty("--bass-hit", (1 + bass * 1.2 + beat * 0.5).toFixed(3));
    shell.style.setProperty("--bass-glow", `${Math.round(34 + bass * 216)}px`);
    shell.style.setProperty("--bass-opacity", (0.14 + bass * 0.92).toFixed(3));
    shell.style.setProperty("--bass-soft-opacity", (0.08 + bass * 0.5).toFixed(3));
    shell.style.setProperty("--bass-offset", `${Math.round(bass * -20)}px`);
    shell.style.setProperty("--bass-node-scale", (0.9 + bass * 0.34 + beat * 0.12).toFixed(3));
    shell.style.setProperty("--beat-pulse", beat.toFixed(3));
  }

  function writeMeterLevels(levels: number[] | undefined) {
    const spans = visualizerRef.current?.children;

    if (!spans) {
      return;
    }

    for (let index = 0; index < spans.length; index += 1) {
      (spans[index] as HTMLElement).style.setProperty("--meter-height", `${levels?.[index] ?? 16}px`);
    }
  }

  function writeSignalColumns(bass: number) {
    const spans = signalColumnsRef.current?.children;

    if (!spans) {
      return;
    }

    for (let index = 0; index < spans.length; index += 1) {
      const height = Math.max(16, Math.min(96, 28 + bass * 58 + ((index * 17) % 31)));
      (spans[index] as HTMLElement).style.setProperty("--signal-height", `${height}%`);
    }
  }

  function resolveScopeContext() {
    const canvas = scopeCanvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return null;
    }

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * pixelRatio);
    const height = Math.round(canvas.clientHeight * pixelRatio);

    if (!width || !height) {
      return null;
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    return { context, width, height, pixelRatio };
  }

  // Sample the raw time-domain buffer down to ~POINTS control points, then
  // draw a phosphor CRT trace: a translucent black wash for persistence
  // ghosting, a wide soft glow pass, and a thin bright core whose brightness
  // rides the beat. `shuttle` renders a horizontally smeared "tape whir".
  function drawScopeTrace(wave: Uint8Array | null, bass: number, beat: number, shuttle = 0) {
    const resolved = resolveScopeContext();

    if (!resolved) {
      return;
    }

    const { context, width, height, pixelRatio } = resolved;
    const middle = height / 2;

    // Persistence: fade the previous frame toward black instead of clearing.
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "rgba(3, 3, 4, 0.18)";
    context.fillRect(0, 0, width, height);

    if (!wave) {
      drawScopeBaseline(context, width, height, pixelRatio);
      return;
    }

    const points = 140;
    const waveHeight = height * (0.4 + bass * 0.12);
    const stride = wave.length / points;
    const path: Array<[number, number]> = [];

    for (let index = 0; index <= points; index += 1) {
      const sample = ((wave[Math.floor(index * stride)] ?? 128) - 128) / 128;
      const smear = shuttle > 0 ? (((index * 53) % 17) / 17 - 0.5) * shuttle * waveHeight * 0.5 : 0;
      const x = (index / points) * width;
      const y = middle + sample * waveHeight + smear;
      path.push([x, y]);
    }

    const tracePath = () => {
      context.beginPath();
      context.moveTo(path[0][0], path[0][1]);

      for (let index = 1; index < path.length - 1; index += 1) {
        const [x0, y0] = path[index];
        const [x1, y1] = path[index + 1];
        context.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      }

      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
    };

    context.globalCompositeOperation = "lighter";

    // Pass 1 — soft glow.
    context.lineWidth = (2.6 + bass * 3.4) * pixelRatio;
    context.strokeStyle = `rgba(120, 178, 204, ${(0.1 + bass * 0.16).toFixed(3)})`;
    context.shadowColor = "rgba(120, 178, 204, 0.9)";
    context.shadowBlur = (6 + bass * 20 + shuttle * 14) * pixelRatio;
    tracePath();

    // Pass 2 — bright core, brightens on the beat.
    context.lineWidth = Math.max(1, 1.15 * pixelRatio);
    context.strokeStyle = `rgba(224, 244, 255, ${(0.68 + beat * 0.32).toFixed(3)})`;
    context.shadowColor = "rgba(180, 220, 240, 0.95)";
    context.shadowBlur = (2 + beat * 6) * pixelRatio;
    tracePath();

    context.globalCompositeOperation = "source-over";
    context.shadowBlur = 0;
  }

  function drawScopeBaseline(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    pixelRatio: number
  ) {
    const middle = height / 2;

    context.globalCompositeOperation = "lighter";
    context.lineWidth = 1.15 * pixelRatio;
    context.strokeStyle = "rgba(120, 178, 204, 0.32)";
    context.shadowColor = "rgba(120, 178, 204, 0.6)";
    context.shadowBlur = 5 * pixelRatio;
    context.beginPath();
    context.moveTo(0, middle);
    context.lineTo(width, middle);
    context.stroke();
    context.globalCompositeOperation = "source-over";
    context.shadowBlur = 0;
  }

  function writeVuNeedles() {
    const container = vuMeterRef.current;

    if (!container) {
      return;
    }

    const vu = vuStateRef.current;
    container.style.setProperty("--vu-l", vu.l.toFixed(3));
    container.style.setProperty("--vu-r", vu.r.toFixed(3));
    container.style.setProperty("--vu-peak-l", vu.peakHoldL.toFixed(3));
    container.style.setProperty("--vu-peak-r", vu.peakHoldR.toFixed(3));
  }

  function readChannelLevel(analyser: AnalyserNode | null, buffer: Uint8Array | undefined) {
    if (!analyser || !buffer) {
      return 0;
    }

    analyser.getByteTimeDomainData(buffer);
    let sum = 0;

    for (let index = 0; index < buffer.length; index += 1) {
      const sample = (buffer[index] - 128) / 128;
      sum += sample * sample;
    }

    // RMS, softened and lifted so typical program material swings the needle.
    return Math.min(1, Math.sqrt(sum / buffer.length) * 2.4);
  }

  function stopVisualizerFrame() {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      window.clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    bassBinsRef.current = null;
    bassEnvelopeRef.current = { floor: 0.035, hold: 0, last: 0, peak: 0.26 };
    beatRef.current = { pulse: 0, gate: 0, threshold: 0.12 };
    bassLevelRef.current = 0;
    lastTickAtRef.current = 0;
    vuStateRef.current = { l: 0, r: 0, peakL: 0, peakR: 0, peakHoldL: 0, peakHoldR: 0 };
    writeBassVars(0, 0);
    writeMeterLevels(undefined);
    writeSignalColumns(0);
    writeVuNeedles();
    drawScopeTrace(null, 0, 0);
  }

  function getAudioElement() {
    const audio = audioRef.current ?? document.querySelector("audio");

    if (audio && !audioRef.current) {
      audioRef.current = audio;
    }

    return audio;
  }

  function startVisualizerFrame() {
    if (animationFrameRef.current !== null || reducedMotion) {
      return;
    }

    let freqData: Uint8Array | undefined;
    let waveData: Uint8Array | undefined;
    let bassData: Uint8Array | undefined;
    let vuBufferL: Uint8Array | undefined;
    let vuBufferR: Uint8Array | undefined;
    let bandEdges: number[] | undefined;
    let lastFluxComputeAt = 0;
    let heldFluxBass = 0;

    const buildBandEdges = (binCount: number, sampleRate: number) => {
      const minHz = 36;
      const maxHz = Math.min(15600, sampleRate / 2);
      const binHz = sampleRate / 2 / binCount;
      const edges: number[] = [];

      for (let index = 0; index <= 24; index += 1) {
        const hz = minHz * Math.pow(maxHz / minHz, index / 24);
        edges.push(Math.min(binCount - 1, Math.max(1, Math.round(hz / binHz))));
      }

      return edges;
    };

    const tick = (timestamp: number) => {
      const analyser = analyserRef.current;
      const dtFrames = lastTickAtRef.current
        ? Math.min(4, Math.max(0.25, (timestamp - lastTickAtRef.current) / 33.33))
        : 1;
      lastTickAtRef.current = timestamp;

      let analyserSignal = 0;
      let nextLevels: number[] | undefined;

      if (analyser) {
        if (!freqData || freqData.length !== analyser.frequencyBinCount) {
          freqData = new Uint8Array(analyser.frequencyBinCount);
          bandEdges = undefined;
        }

        analyser.getByteFrequencyData(freqData);

        if (!bandEdges) {
          bandEdges = buildBandEdges(freqData.length, audioContextRef.current?.sampleRate ?? 44100);
        }

        const edges = bandEdges;
        nextLevels = Array.from({ length: 24 }, (_, index) => {
          const start = edges[index];
          const end = Math.max(start + 1, edges[index + 1]);
          let sum = 0;

          for (let cursor = start; cursor < end; cursor += 1) {
            sum += freqData?.[cursor] ?? 0;
          }

          const average = sum / (end - start);
          analyserSignal += average;
          return Math.round(10 + Math.pow(average / 255, 0.8) * 78);
        });
      }

      const liveSignal = analyserSignal >= 8;
      let shapedBass = 0;
      let onsetStrength = 0;

      if (liveSignal && bassAnalyserRef.current) {
        if (!bassData || bassData.length !== bassAnalyserRef.current.frequencyBinCount) {
          bassData = new Uint8Array(bassAnalyserRef.current.frequencyBinCount);
        }

        bassAnalyserRef.current.getByteFrequencyData(bassData);

        const binHz = ((audioContextRef.current?.sampleRate ?? 44100) / 2) / bassData.length;
        const lowStart = Math.max(1, Math.floor(28 / binHz));
        const lowEnd = Math.min(bassData.length - 1, Math.ceil(138 / binHz));
        let bassEnergy = 0;
        let bassFlux = 0;
        let bassPeak = 0;
        let bassWeight = 0;
        let previousBassBins = bassBinsRef.current;

        if (!previousBassBins || previousBassBins.length !== bassData.length) {
          previousBassBins = new Uint8Array(bassData.length);
          previousBassBins.set(bassData);
          bassBinsRef.current = previousBassBins;
        }

        // Flux compares against a snapshot at the original 30fps cadence so its
        // tuning stays frame-rate independent under requestAnimationFrame.
        const computeFlux = timestamp - lastFluxComputeAt >= 28;

        for (let cursor = lowStart; cursor <= lowEnd; cursor += 1) {
          const hz = cursor * binHz;
          const value = bassData[cursor] ?? 0;
          const previousValue = previousBassBins[cursor] ?? value;
          const weight = hz <= 62 ? 1.78 : hz <= 96 ? 1.34 : 0.74;

          bassEnergy += value * weight;

          if (computeFlux) {
            bassFlux += Math.max(0, value - previousValue) * weight;
          }

          bassPeak = Math.max(bassPeak, value);
          bassWeight += weight;
        }

        if (computeFlux) {
          previousBassBins.set(bassData);
          heldFluxBass = bassWeight > 0 ? Math.min(1, (bassFlux / bassWeight / 255) * 11.4) : 0;
          lastFluxComputeAt = timestamp;
        }

        const averageBass = bassWeight > 0 ? bassEnergy / bassWeight / 255 : 0;
        const fluxBass = heldFluxBass;
        const peakBass = bassPeak / 255;
        const rawBass = Math.min(
          1,
          Math.max(0, Math.pow(averageBass, 0.72) * 1.08 + Math.pow(peakBass, 1.25) * 0.3 - 0.055)
        );
        const envelope = bassEnvelopeRef.current;

        envelope.floor = Math.min(0.48, envelope.floor + (rawBass - envelope.floor) * (1 - Math.pow(0.996, dtFrames)));
        envelope.peak = Math.max(rawBass, envelope.peak * Math.pow(0.974, dtFrames));

        if (envelope.peak - envelope.floor < 0.11) {
          envelope.peak = envelope.floor + 0.11;
        }

        const normalizedBass = Math.min(1, Math.max(0, (rawBass - envelope.floor) / (envelope.peak - envelope.floor)));
        const bassKick = Math.max(0, rawBass - envelope.last) * 5.7;

        envelope.last = envelope.last + (rawBass - envelope.last) * (1 - Math.pow(0.58, dtFrames));
        shapedBass = Math.min(1, Math.pow(normalizedBass, 1.15) * 0.5 + fluxBass * 0.72 + bassKick * 0.6);
        envelope.hold = Math.max(envelope.hold * Math.pow(0.78, dtFrames), shapedBass);
        shapedBass = Math.max(shapedBass, envelope.hold * 0.7);
        onsetStrength = fluxBass * 0.8 + Math.min(1, bassKick) * 0.5;
      }

      let wave: Uint8Array | null = null;

      if (liveSignal && analyser) {
        if (!waveData || waveData.length !== analyser.fftSize) {
          waveData = new Uint8Array(analyser.fftSize);
        }

        analyser.getByteTimeDomainData(waveData);
        wave = waveData;
      }

      if (!liveSignal) {
        const fallbackFrame = getAnalysisFrame(
          getCachedTrackAnalysis(currentTrack),
          audioRef.current?.currentTime ?? currentTime
        );

        if (fallbackFrame) {
          shapedBass = Math.max(shapedBass, Math.min(1, Math.pow(fallbackFrame.bass, 0.72) * 1.08));

          if (fallbackFrame.levels) {
            nextLevels = fallbackFrame.levels;
          }
        }
      }

      const beat = beatRef.current;
      beat.pulse = Math.max(0, beat.pulse - 0.09 * dtFrames);
      beat.gate = Math.max(0, beat.gate - dtFrames);
      beat.threshold = Math.max(0.08, beat.threshold * Math.pow(0.995, dtFrames));

      if (onsetStrength > beat.threshold && beat.gate <= 0) {
        beat.pulse = 1;
        beat.gate = 8;
        beat.threshold = Math.min(0.6, onsetStrength * 0.55 + beat.threshold * 0.45);
      }

      const level = bassLevelRef.current;
      const mix = shapedBass > level ? 1 - Math.pow(0.04, dtFrames) : 1 - Math.pow(0.74, dtFrames);
      bassLevelRef.current = level + (shapedBass - level) * mix;

      // Stereo VU: fast attack, slow release, with a peak-hold that hangs then falls.
      const vu = vuStateRef.current;

      if (liveSignal && analyserLRef.current && analyserRRef.current) {
        if (!vuBufferL || vuBufferL.length !== analyserLRef.current.fftSize) {
          vuBufferL = new Uint8Array(analyserLRef.current.fftSize);
        }
        if (!vuBufferR || vuBufferR.length !== analyserRRef.current.fftSize) {
          vuBufferR = new Uint8Array(analyserRRef.current.fftSize);
        }

        const rawL = readChannelLevel(analyserLRef.current, vuBufferL);
        const rawR = readChannelLevel(analyserRRef.current, vuBufferR);
        const attack = 1 - Math.pow(0.25, dtFrames);
        const release = 1 - Math.pow(0.86, dtFrames);

        vu.l += (rawL - vu.l) * (rawL > vu.l ? attack : release);
        vu.r += (rawR - vu.r) * (rawR > vu.r ? attack : release);
        vu.peakHoldL = rawL > vu.peakHoldL ? rawL : Math.max(vu.l, vu.peakHoldL - 0.012 * dtFrames);
        vu.peakHoldR = rawR > vu.peakHoldR ? rawR : Math.max(vu.r, vu.peakHoldR - 0.012 * dtFrames);
      } else {
        const release = 1 - Math.pow(0.86, dtFrames);
        vu.l += (0 - vu.l) * release;
        vu.r += (0 - vu.r) * release;
        vu.peakHoldL = Math.max(vu.l, vu.peakHoldL - 0.012 * dtFrames);
        vu.peakHoldR = Math.max(vu.r, vu.peakHoldR - 0.012 * dtFrames);
      }

      writeBassVars(bassLevelRef.current, beat.pulse);
      writeMeterLevels(nextLevels);
      writeSignalColumns(bassLevelRef.current);
      writeVuNeedles();
      drawScopeTrace(wave, bassLevelRef.current, beat.pulse, shuttleRateRef.current > 0 ? 1 : 0);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
  }

  async function ensureAudioGraph() {
    const audio = getAudioElement();

    if (!audio) {
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    if (!audioContextRef.current) {
      const context = new AudioContextConstructor();
      audioContextRef.current = context;

      analyserRef.current = context.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.5;

      // Amp stage: a low-shelf "warmth" filter into a gain node. The volume
      // knob drives this gain (not the element), so everything downstream —
      // meters, scope, VU — reacts to it, and turning up adds real low-end.
      toneShelfRef.current = context.createBiquadFilter();
      toneShelfRef.current.type = "lowshelf";
      toneShelfRef.current.frequency.value = 120;
      toneShelfRef.current.gain.value = (volume - 0.5) * 8;
      ampGainRef.current = context.createGain();
      ampGainRef.current.gain.value = volume;

      bassFilterRef.current = context.createBiquadFilter();
      bassFilterRef.current.type = "lowpass";
      bassFilterRef.current.frequency.value = 170;
      bassFilterRef.current.Q.value = 0.72;
      bassAnalyserRef.current = context.createAnalyser();
      bassAnalyserRef.current.fftSize = 1024;
      bassAnalyserRef.current.smoothingTimeConstant = 0.04;

      // Stereo tap for the VU needles.
      splitterRef.current = context.createChannelSplitter(2);
      analyserLRef.current = context.createAnalyser();
      analyserLRef.current.fftSize = 1024;
      analyserRRef.current = context.createAnalyser();
      analyserRRef.current.fftSize = 1024;
    }

    const context = audioContextRef.current;
    const ampGain = ampGainRef.current;
    const toneShelf = toneShelfRef.current;

    if (!sourceRef.current && analyserRef.current && ampGain && toneShelf) {
      sourceRef.current = context.createMediaElementSource(audio);

      // source → toneShelf → ampGain → analyser → destination
      sourceRef.current.connect(toneShelf);
      toneShelf.connect(ampGain);
      ampGain.connect(analyserRef.current);
      analyserRef.current.connect(context.destination);

      if (bassFilterRef.current && bassAnalyserRef.current) {
        ampGain.connect(bassFilterRef.current);
        bassFilterRef.current.connect(bassAnalyserRef.current);
      }

      if (splitterRef.current && analyserLRef.current && analyserRRef.current) {
        ampGain.connect(splitterRef.current);
        splitterRef.current.connect(analyserLRef.current, 0);
        splitterRef.current.connect(analyserRRef.current, 1);
      }

      // The element now feeds the graph at unity; the knob controls ampGain.
      audio.volume = 1;
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => undefined);
    }
  }

  async function startAudioPlayback() {
    const audio = getAudioElement();

    if (!audio) {
      setIsPlaying(false);
      return;
    }

    await ensureAudioGraph().catch(() => undefined);

    try {
      await audio.play();
      setIsPlaying(true);
      startVisualizerFrame();
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : "Playback error";
      setIsPlaying(false);
      setImportStatus(`${errorName} - click Play`);
      return;
    }
  }

  function playTrack(trackId = currentTrack?.id) {
    if (!trackId) {
      return;
    }

    const track = tracks.find((item) => item.id === trackId);

    if (!track?.url || !isLocalPlaybackUrl(track.url)) {
      setIsPlaying(false);
      return;
    }

    requestTrackAnalysis(track).catch(() => undefined);

    const audio = getAudioElement();

    if (audio) {
      const trackUrl = resolveTrackUrl(track.url)?.href;

      if (trackUrl && audio.currentSrc !== trackUrl && audio.getAttribute("src") !== track.url) {
        audio.src = track.url;
        audio.load();
        setCurrentTime(0);
      }
    }

    if (countedPlayForRef.current !== trackId) {
      countedPlayForRef.current = "";
    }

    setCurrentId(trackId);
    setIsPlaying(true);
    startAudioPlayback();
  }

  // A play only "counts" once the listener passes 30s (or half a short track),
  // so skipping through the shelf never ages a cartridge.
  function registerPlayProgress(time: number) {
    const track = currentTrack;

    if (!track || countedPlayForRef.current === track.id) {
      return;
    }

    const threshold = Math.min(30, (track.duration || 0) * 0.5 || 30);

    if (time >= threshold && threshold > 0) {
      countedPlayForRef.current = track.id;
      setTracks((existing) =>
        existing.map((item) =>
          item.id === track.id
            ? { ...item, playCount: (item.playCount ?? 0) + 1, lastPlayedAt: Date.now() }
            : item
        )
      );
    }
  }

  function togglePlayback() {
    const audio = getAudioElement();
    const fallbackTrackId = currentTrack?.id || currentId || playbackQueue[0]?.id || tracks[0]?.id;
    const fallbackTrack = fallbackTrackId ? tracks.find((track) => track.id === fallbackTrackId) : undefined;

    if (audio && !audio.paused) {
      audio.pause();
      stopVisualizerFrame();
      setIsPlaying(false);
    } else if (fallbackTrack?.url || currentTrack?.url) {
      playTrack(fallbackTrack?.id ?? currentTrack?.id);
    } else {
      setIsPlaying(true);
      startAudioPlayback();
    }
  }

  function nextTrack() {
    if (playbackQueue.length === 0) {
      return;
    }

    const queueIndex = playbackQueue.findIndex((track) => track.id === currentTrack?.id);
    const nextIndex = queueIndex < 0 ? 0 : (queueIndex + 1) % playbackQueue.length;
    playTrack(playbackQueue[nextIndex].id);
  }

  function previousTrack() {
    if (playbackQueue.length === 0) {
      return;
    }

    const queueIndex = playbackQueue.findIndex((track) => track.id === currentTrack?.id);
    const previousIndex = queueIndex <= 0 ? playbackQueue.length - 1 : queueIndex - 1;
    playTrack(playbackQueue[previousIndex].id);
  }

  function seekBy(seconds: number) {
    const audio = audioRef.current;
    const maxDuration = audio?.duration || currentTrack?.duration || playbackDuration || 0;

    if (!audio || !Number.isFinite(maxDuration) || maxDuration <= 0) {
      return;
    }

    const nextTime = Math.min(maxDuration, Math.max(0, audio.currentTime + seconds));
    pulseSeekLabel(nextTime, audio.currentTime);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  useEffect(() => {
    if (!window.musicHost?.onMenuCommand) {
      return;
    }

    return window.musicHost.onMenuCommand((command) => {
      if (command === "import-audio-files") {
        importAudioFiles();
        return;
      }

      if (command === "import-audio-folder") {
        importAudioFolder();
        return;
      }

      if (command === "import-takeout-csv") {
        importTakeoutCsv();
        return;
      }

      if (command === "reset-local-library") {
        resetLocalLibraryState();
        return;
      }

      if (command === "toggle-playback") {
        togglePlayback();
        return;
      }

      if (command === "previous-track") {
        previousTrack();
        return;
      }

      if (command === "next-track") {
        nextTrack();
      }
    });
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.getAttribute("contenteditable") === "true";

      if (isTyping) {
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        togglePlayback();
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }

      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        fileInspectorRef.current?.focus();
        fileInspectorRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        nextTrack();
      }

      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        previousTrack();
      }

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;

        if (target?.closest(".track-list")) {
          selectShelfOffset(direction);
          return;
        }

        if (event.repeat) {
          // Tape-shuttle: held key ramps the seek rate up like a spinning reel.
          shuttleRateRef.current = Math.min(30, (shuttleRateRef.current || 4) + 1.6);
          setShuttle({ dir: direction, rate: Math.round(shuttleRateRef.current) });
          seekBy(direction * shuttleRateRef.current);
        } else {
          seekBy(direction * 5);
        }
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        shuttleRateRef.current = 0;
        setShuttle(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      album: currentTrack.album,
      artwork: currentTrack.artworkUrl
        ? [
            {
              sizes: "512x512",
              src: currentTrack.artworkUrl,
              type: "image/jpeg"
            }
          ]
        : undefined,
      artist: currentTrack.artist,
      title: currentTrack.title
    });
    navigator.mediaSession.setActionHandler("play", () => playTrack());
    navigator.mediaSession.setActionHandler("pause", () => togglePlayback());
    navigator.mediaSession.setActionHandler("previoustrack", () => previousTrack());
    navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack());
  });

  function onLoadedMetadata() {
    const nextDuration = audioRef.current?.duration ?? 0;
    setDuration(nextDuration);

    setTracks((existing) =>
      existing.map((track) => (track.id === currentTrack?.id ? { ...track, duration: nextDuration } : track))
    );
  }

  function onAudioPlay() {
    setIsPlaying(true);
    ensureAudioGraph()
      .then(startVisualizerFrame)
      .catch(() => undefined);
  }

  function onAudioPause() {
    stopVisualizerFrame();
    setIsPlaying(false);
  }

  const appClasses = [
    "app-shell",
    scanlines ? "scanlines-on" : "",
    reducedMotion ? "reduced-motion" : "",
    `interference-${interference}`,
    isDragActive ? "is-dragging" : "",
    bootMode ? "is-booting" : "",
    microGlitch ? "is-microglitching" : "",
    microGlitch ? `micro-${microGlitch}` : "",
    isRelocking ? "is-relocking" : "",
    seekPulse ? "is-seeking" : "",
    attract ? "is-attract" : "",
    shuttle ? "is-shuttling" : "",
    isPlaying ? "is-playing" : "is-idle"
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="console-viewport" ref={viewportRef}>
      <div className="console-stage" style={{ "--console-scale": consoleScale } as CSSProperties}>
    <main
      ref={shellRef}
      className={appClasses}
      style={bassMeterStyle}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        className="hidden-input"
        type="file"
        accept="audio/*,.aif,.aiff"
        multiple
        onChange={onFileInput}
      />
      <input
        ref={takeoutInputRef}
        className="hidden-input"
        type="file"
        accept=".csv,text/csv"
        multiple
        onChange={onTakeoutInput}
      />

      <audio
        ref={audioRef}
        onPlay={onAudioPlay}
        onPause={onAudioPause}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={() => {
          const time = audioRef.current?.currentTime ?? 0;
          setCurrentTime(time);
          registerPlayProgress(time);
        }}
        onEnded={nextTrack}
      />

      <section className="console-screen" aria-label="Cody Cartridge player">
        <header className="screen-header">
          <div className="screen-title">
            <span className="eyebrow">Cody Noir</span>
            <h1 className="sr-only">{currentTrack?.title ?? "No cartridge inserted"}</h1>
            <p>{currentTrack ? "Cover signal" : "No track loaded"}</p>
            <div className="system-header-line" title={diagnosticsTitle}>
              <span className="import-status">{systemStatus}</span>
              <span className={`system-message ${isPlaying ? "live" : hasTagGap(currentTrack) ? "warn" : ""}`}>
                {systemMessage}
              </span>
            </div>
          </div>
          <div className="interference-control" aria-label="Interference intensity">
            <span>Interference</span>
            <div>
              {(["off", "low", "med", "max"] as InterferenceMode[]).map((mode) => (
                <button
                  className={interference === mode ? "active" : ""}
                  key={mode}
                  type="button"
                  onClick={() => {
                    setInterference(mode);
                    flashSystemMessage(`INTERFERENCE ${mode.toUpperCase()}`, 780);
                  }}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </header>

        {bootMode ? (
          <div
            className={`boot-overlay boot-${bootMode}`}
            aria-live="polite"
            role="button"
            tabIndex={0}
            title="Click to skip boot sequence"
            onClick={() => setBootMode(null)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
                event.preventDefault();
                setBootMode(null);
              }
            }}
          >
            <span className="boot-scanline" aria-hidden="true" />
            <div className="boot-terminal">
              {bootLines.map((line, index) => (
                <span key={`${bootMode}-${line}`} style={{ "--boot-delay": `${index * 92}ms` } as CSSProperties}>
                  {line}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="deck">
          <section className="deck-hero" aria-label="Now playing">
            <div
              className={`cartridge-art ${isPlaying || storePosterMode ? "powered" : ""} ${currentTrack ? "has-track" : "is-empty"} ${
                cartridgeSwap ? `is-${cartridgeSwap}` : ""
              }`}
              data-wear={currentWearTier > 0 ? currentWearTier : undefined}
              aria-label={currentTrack ? `Signal map for ${currentTrack.title} by ${currentTrack.artist}` : "Empty signal map"}
            >
              <div className="signal-map signal-scope-only" aria-hidden="true">
                <span className="signal-vignette" />
                <canvas ref={scopeCanvasRef} className="signal-scope" />
                <span className="signal-frame signal-frame-bezel" />
                {shuttle ? (
                  <span className="shuttle-indicator">
                    {shuttle.dir > 0 ? "▶▶ CUE" : "◀◀ REW"} ×{shuttle.rate}
                  </span>
                ) : null}
              </div>

              <div className="hero-overlay" aria-live="polite">
                <div className="hero-np">
                  <span className="module-label">NOW PLAYING</span>
                  <strong className="hero-title">
                    {currentTrackNumber ? currentTrackNumber.toString().padStart(2, "0") : "--"} //{" "}
                    {currentTrack?.title ?? "NO FILE"}
                  </strong>
                  <span className="hero-artist">{currentTrack?.artist ?? "No active artist"}</span>
                </div>
                <div className="hero-meta">
                  <span>{currentTrack?.album ?? activeShelfLabel}</span>
                  <span>{currentQualityLine}</span>
                  <span className="hero-trace">{isPlaying || storePosterMode ? "TRACE LIVE" : "TRACE HOLD"}</span>
                </div>
              </div>
            </div>

            <div className="stage-path" aria-label="Track progress">
              <span>{formatTime(currentTime)}</span>
              {seekPulse ? <span className="seek-pulse">{seekPulse}</span> : null}
              <input
                type="range"
                min="0"
                max={duration || currentTrack?.duration || 1}
                value={Math.min(currentTime, duration || currentTrack?.duration || 1)}
                disabled={!currentTrack}
                onChange={(event) => {
                  const nextTime = Number(event.target.value);
                  pulseSeekLabel(nextTime, audioRef.current?.currentTime ?? currentTime);
                  setCurrentTime(nextTime);
                  if (audioRef.current) {
                    audioRef.current.currentTime = nextTime;
                  }
                }}
                aria-label="Seek"
              />
              <span>{formatTime(duration || currentTrack?.duration || 0)}</span>
            </div>

            <div
              className="file-inspector deck-inspector"
              ref={fileInspectorRef}
              tabIndex={-1}
              aria-label="Selected local file inspection"
            >
              {isTakeoutMatched(currentTrack) ? <span className="match-stamp">MATCHED</span> : null}
              <span>
                <span className="artifact-label">SOURCE</span> <strong>{fileSourcePath}</strong>
              </span>
              <span>
                <span className="artifact-label">MATCH</span> yt {matchConfidence ? `${matchConfidence}%` : "--"} ·{" "}
                {currentSourceLabel} · {currentTagSummary}
              </span>
              <span>
                <span className="artifact-label">ENCODE</span> {formatCodec(currentTrack?.codec)} ·{" "}
                {formatBitrate(currentTrack?.bitrate)} · {formatSampleRate(currentTrack?.sampleRate)} ·{" "}
                {formatFileSize(currentTrack?.size)}
              </span>
              <span>
                <span className="artifact-label">ERRORS</span> {currentTagErrors}
              </span>
            </div>
          </section>

          <section className="deck-catalog" aria-label="Local tracks">
            <div className="bay-header">
              <div>
                <span className="eyebrow">Shelf</span>
                <h2>{activeShelfLabel}</h2>
              </div>
              <div className="mini-stat">
                <ListMusic size={16} />
                <span>{filteredCards.length}</span>
              </div>
            </div>

            <div className="metadata-panel" aria-label="Track metadata">
              <div className="catalog-toolbar">
                <label className="catalog-search">
                  <span>FIND</span>
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="FIND / filter local files... artist:che missing:cover match:<80"
                    title="Try artist:che, missing:cover, match:<80, type:flac, or tag:gap"
                    aria-label="Filter catalog"
                  />
                </label>
                <div className="catalog-filter-chips" aria-label="Fast filters">
                  {[
                    ["ALL", ""],
                    ["YT MATCH", "status:matched"],
                    ["LOCAL", "status:local"],
                    ["NO COVER", "missing:cover"],
                    ["TAG GAP", "tag:gap"]
                  ].map(([label, nextQuery]) => (
                    <button
                      className={query === nextQuery ? "active" : ""}
                      key={label}
                      type="button"
                      onClick={() => setQuery(nextQuery)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="metadata-header" aria-hidden="true">
                <span>Catalog</span>
                <span>{filteredCards.length.toString().padStart(2, "0")} files</span>
              </div>
              <div className="metadata-columns" aria-hidden="true">
                <span>#</span>
                <span />
                <span>Track</span>
                <span>Artist</span>
                <span>Album</span>
                <span>Time</span>
                <span>Quality</span>
                <span>Status</span>
              </div>
              <div className="metadata-list">
                {filteredCards.map((card, index) => {
                  const track = card.kind === "track" ? card.track : undefined;
                  const missingSong = card.kind === "missing" ? card.song : undefined;
                  const title = track?.title ?? missingSong?.title ?? "Untitled";
                  const artist = track?.artist ?? missingSong?.artists.join(", ") ?? "Unknown Artist";
                  const album = track?.album ?? missingSong?.album ?? "Unknown Album";
                  const codec = formatCodec(track?.codec);
                  const sourceDetail = track?.youtubeVideoId
                    ? "YT match"
                    : track?.metadataSource?.includes("Takeout")
                      ? "YT ambiguous"
                      : "local file";
                  const qualityLine = track
                    ? `${formatBitrate(track.bitrate)} · ${formatSampleRate(track.sampleRate)}`
                    : "no file";
                  const statusChips = getStatusChips(track, missingSong);
                  const fullDetail = track
                    ? `${codec} · ${formatBitrate(track.bitrate)} · ${formatSampleRate(track.sampleRate)} · ${formatFileSize(
                        track.size
                      )} · ${track.youtubeVideoId || track.metadataSource || "local file"} · ${track.fileName}`
                    : missingSong?.videoId
                      ? `yt ${missingSong.videoId}`
                      : "takeout row";
                  const isActiveRow = track?.id === currentTrack?.id;
                  const rowArtSource = card.kind === "track" ? card.track : card.artSource;
                  const rowHasCover = Boolean(track?.artworkUrl);

                  return (
                    <div
                      className={`metadata-row ${isActiveRow ? "active" : ""} ${
                        card.kind === "missing" ? "missing" : ""
                      }`}
                      key={`metadata-${card.id}`}
                      role={track ? "button" : undefined}
                      tabIndex={track ? 0 : undefined}
                      title={fullDetail}
                      onClick={() => track && setCurrentId(track.id)}
                      onDoubleClick={() => track && playTrack(track.id)}
                      onKeyDown={(event) => {
                        // Arrow keys move the catalog selection; Enter/Space plays.
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          selectShelfOffset(1);
                          return;
                        }

                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          selectShelfOffset(-1);
                          return;
                        }

                        if (!track || (event.key !== "Enter" && event.key !== " ")) {
                          return;
                        }

                        event.preventDefault();
                        playTrack(track.id);
                      }}
                    >
                      <span className="metadata-index">
                        {String(index + 1).padStart(2, "0")}
                        <span className="metadata-play-marker">{isActiveRow && isPlaying ? "▶" : isActiveRow ? "//" : ""}</span>
                      </span>
                      <span
                        className={`metadata-cover ${rowHasCover ? "has-cover" : "generated-cover"} ${
                          card.kind === "missing" ? "is-missing" : ""
                        }`}
                        style={albumGraphicStyle(rowArtSource, index)}
                        aria-hidden="true"
                      >
                        {rowHasCover ? (
                          <img className="metadata-cover-img" src={track?.artworkUrl} alt="" draggable={false} />
                        ) : (
                          <span className="metadata-cover-bands" />
                        )}
                      </span>
                      <span className="metadata-title">
                        <strong data-scramble={scrambleLabel(title, `${card.id}-${index}`)}>{title}</strong>
                      </span>
                      <span className="metadata-artist">{artist}</span>
                      <span className="metadata-album">{album}</span>
                      <span className="metadata-time">{track ? formatTime(track.duration) : "--:--"}</span>
                      <span className="metadata-quality" title={fullDetail}>
                        <span>{qualityLine}</span>
                        <small>
                          {track
                            ? `${formatFileSize(track.size)} · ${sourceDetail}`
                            : missingSong?.videoId
                              ? `yt ${missingSong.videoId}`
                              : "takeout row"}
                        </small>
                      </span>
                      <span className="metadata-status-chips">
                        {statusChips.map((chip) => (
                          <button
                            className={`status-chip ${chip.tone ?? ""}`}
                            data-corrupt={
                              chip.label === "NO COVER"
                                ? "NO C0VER"
                                : chip.label === "TAG GAP"
                                  ? "TAG G/P"
                                  : chip.label === "LOW CONF"
                                    ? "LOW C0NF"
                                    : chip.label
                            }
                            key={`${card.id}-${chip.label}`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setQuery(chip.query);
                            }}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="deck-controls" aria-label="Transport and meters">
            <div className="transport">
              <div className="transport-pad">
                <span>BACK</span>
                <button
                  className="icon-button"
                  type="button"
                  title="Previous"
                  disabled={!hasPlayableQueue}
                  onClick={previousTrack}
                >
                  <SkipBack size={24} />
                </button>
              </div>
              <div className="transport-pad transport-pad-main">
                <span>{isPlaying ? "HOLD" : "PLAY"}</span>
                <button
                  className="play-button"
                  type="button"
                  title={isPlaying ? "Pause" : "Play"}
                  disabled={!currentTrack?.url}
                  onClick={togglePlayback}
                >
                  {isPlaying ? <Pause size={31} fill="currentColor" /> : <Play size={31} fill="currentColor" />}
                </button>
              </div>
              <div className="transport-pad">
                <span>NEXT</span>
                <button
                  className="icon-button"
                  type="button"
                  title="Next"
                  disabled={!hasPlayableQueue}
                  onClick={nextTrack}
                >
                  <SkipForward size={24} />
                </button>
              </div>
              <div className="volume-control">
                <span>AMP</span>
                <div className="volume-rail">
                  <Volume2 size={18} />
                  <VolumeKnob value={volume} onChange={setVolume} />
                </div>
              </div>
            </div>

            <div className="meter-bank">
              <div ref={visualizerRef} className="visualizer visualizer-crt-wave" aria-label="Audio visualizer">
                {Array.from({ length: 24 }).map((_, index) => (
                  <span
                    key={index}
                    style={
                      {
                        "--meter-height": "16px",
                        animationDelay: `${index * 58}ms`
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
              <VuMeter containerRef={vuMeterRef} />
            </div>

            <div className="key-hints" aria-hidden="true">
              <span>SPACE PLAY</span>
              <span>LEFT/RIGHT SEEK</span>
              <span>J/K TRACK</span>
              <span>F FIND</span>
              <span>I INSPECT</span>
            </div>
          </section>
        </div>
      </section>

    </main>
      </div>
    </div>
  );
}

export default App;
