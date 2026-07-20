import React, { ChangeEvent, CSSProperties, DragEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Volume2
} from "lucide-react";
import { SmokeRing } from "@paper-design/shaders-react";
import {
  SPINE_BANDS,
  SPINE_VERSION,
  SerializedSpine,
  SpinePalette,
  TrackSpine,
  buildTrackSpine,
  computeSpineStats,
  deserializeSpine,
  drawSpineStrip,
  heroTextureDataUrl,
  keyHue,
  serializeSpine,
  spineCoverDataUrl,
  spineIdentity,
  spineToDataUrl,
  syntheticSpine
} from "./spine";

type BadgeId = "heart" | "star" | "bolt" | "moon" | "flame" | "gem";
type InterferenceMode = "off" | "low" | "med" | "max";
type RepeatMode = "off" | "all" | "one";
// The dials read the machine's memory, not audiophile trivia: per-song
// character, archive health, the session odometer, operating temperature —
// with classic VU kept as the fiction's anchor mode.
type MeterMode = "track" | "archive" | "session" | "heat" | "vu";
type ShelfSize = "collapsed" | "shelf" | "expanded";

const shelfSizeOrder: ShelfSize[] = ["collapsed", "shelf", "expanded"];

const meterModeOrder: MeterMode[] = ["track", "archive", "session", "heat", "vu"];
const meterModeTitles: Record<MeterMode, string> = {
  track: "TRACK",
  archive: "ARCHIVE",
  session: "SESSION",
  heat: "HEAT",
  vu: "VU"
};
const meterModeChannels: Record<MeterMode, [string, string]> = {
  track: ["BRT", "DYN"],
  archive: ["TRC", "MTC"],
  session: ["HRS", "PLY"],
  heat: ["TMP", "MAX"],
  vu: ["L", "R"]
};
type MicroGlitchKind = "header" | "map" | "row" | "shelf";
type ShelfView = "library" | "favorites" | "takeout" | "missing";

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

type TrackAnalysis = {
  bass: Float32Array;
  fps: number;
  levels: Uint8Array[];
};

// The Lathe: a per-cartridge cut stored in physical units (dB / ratio /
// rate), never knob positions — the bench can be redesigned without
// invalidating archived cuts.
type ToneSettings = {
  sub: number; // dB, -12..12 (lowshelf 60Hz)
  bass: number; // dB, -12..12 (lowshelf 150Hz)
  mid: number; // dB, -10..10 (peaking 1kHz Q 0.9)
  treble: number; // dB, -12..12 (highshelf 5.5kHz)
  width: number; // side gain, 0 mono .. 1 stock .. 1.6 wide
  drive: number; // wet mix 0..1
  speed: number; // playbackRate 0.8..1.25, 1 = stock
};

const flatTone: ToneSettings = { sub: 0, bass: 0, mid: 0, treble: 0, width: 1, drive: 0, speed: 1 };

function isFlatCut(tone: ToneSettings | undefined): boolean {
  if (!tone) {
    return true;
  }

  return (
    Math.abs(tone.sub) < 0.25 &&
    Math.abs(tone.bass) < 0.25 &&
    Math.abs(tone.mid) < 0.25 &&
    Math.abs(tone.treble) < 0.25 &&
    Math.abs(tone.width - 1) < 0.01 &&
    tone.drive < 0.005 &&
    Math.abs(tone.speed - 1) < 0.005
  );
}

function sanitizeTone(raw: Partial<ToneSettings> | undefined): ToneSettings {
  const bounded = (value: unknown, low: number, high: number, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;

  return {
    sub: bounded(raw?.sub, -12, 12, 0),
    bass: bounded(raw?.bass, -12, 12, 0),
    mid: bounded(raw?.mid, -10, 10, 0),
    treble: bounded(raw?.treble, -12, 12, 0),
    width: bounded(raw?.width, 0, 1.6, 1),
    drive: bounded(raw?.drive, 0, 1, 0),
    speed: bounded(raw?.speed, 0.8, 1.25, 1)
  };
}

function formatCutSummary(tone: ToneSettings): string {
  if (isFlatCut(tone)) {
    return "STOCK";
  }

  const parts: string[] = [];
  const db = (value: number, label: string) => {
    if (Math.abs(value) >= 0.25) {
      parts.push(`${value > 0 ? "+" : ""}${Math.round(value)}dB ${label}`);
    }
  };

  db(tone.sub, "SUB");
  db(tone.bass, "BASS");
  db(tone.mid, "MID");
  db(tone.treble, "TRB");

  if (Math.abs(tone.width - 1) >= 0.01) {
    parts.push(tone.width < 1 ? (tone.width < 0.05 ? "MONO" : "NARROW") : "WIDE");
  }

  if (tone.drive >= 0.005) {
    parts.push(`DRV ${Math.round(tone.drive * 100)}%`);
  }

  if (Math.abs(tone.speed - 1) >= 0.005) {
    parts.push(`${tone.speed.toFixed(2)}×`);
  }

  return parts.join(" · ");
}

type StoredState = {
  activeShelf?: ShelfView;
  currentId?: string;
  denseRows?: boolean;
  heroDock?: boolean;
  interference?: InterferenceMode;
  latheOpen?: boolean;
  meter?: MeterMode;
  reducedMotion?: boolean;
  repeat?: RepeatMode;
  shelfSize?: ShelfSize;
  takeoutSongs?: TakeoutSong[];
  toneByTrack?: Record<string, ToneSettings>;
  tracks?: Track[];
  volume?: number;
};

const storageKey = "cody-cartridge-state-v1";
const spineStorageKey = "cody-cartridge-spines-v1";
const spineStoreLimit = 500;
const defaultVolume = 0.72;
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
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

  // Same-origin bundled-library media only. The prefix may sit under a
  // subpath when the web build is hosted off-root (e.g. GitHub Pages).
  return parsed.origin === window.location.origin && parsed.pathname.includes("/__cody_music__/");
}

function sanitizeStoredState(state: StoredState): StoredState {
  const tracks = Array.isArray(state.tracks)
    ? state.tracks.filter((track) => isDurablePlaybackUrl(track.url))
    : undefined;
  const trackIds = new Set((tracks ?? []).map((track) => track.id));

  // Archived cuts only survive for tracks that still exist, clamped to
  // legal ranges; flat cuts are dropped so the map never accumulates noise.
  const toneByTrack =
    state.toneByTrack && typeof state.toneByTrack === "object"
      ? Object.fromEntries(
          Object.entries(state.toneByTrack)
            .filter(([trackId]) => trackIds.has(trackId))
            .map(([trackId, tone]) => [trackId, sanitizeTone(tone)])
            .filter(([, tone]) => !isFlatCut(tone as ToneSettings))
        )
      : undefined;

  return {
    ...state,
    currentId: state.currentId && trackIds.has(state.currentId) ? state.currentId : "",
    toneByTrack,
    tracks
  };
}

// The Lathe curve instrument: magnitude response of the four bench biquads,
// computed off-graph so it works before first play and in the paused
// store-demo. 128-point log sweep over the same 36Hz→15.6kHz basis as the
// live spectrum bands.
const toneCurvePoints = 128;
let toneProbeContext: OfflineAudioContext | null = null;
let toneProbeFilters: BiquadFilterNode[] | null = null;
let toneProbeFrequencies: Float32Array | null = null;

function computeToneCurve(tone: ToneSettings): Float32Array | null {
  try {
    if (!toneProbeContext) {
      toneProbeContext = new OfflineAudioContext(1, toneCurvePoints, 44100);
      toneProbeFrequencies = new Float32Array(toneCurvePoints);

      for (let index = 0; index < toneCurvePoints; index += 1) {
        toneProbeFrequencies[index] = 36 * Math.pow(15600 / 36, index / (toneCurvePoints - 1));
      }

      const spec: Array<{ type: BiquadFilterType; frequency: number; q?: number }> = [
        { type: "lowshelf", frequency: 60 },
        { type: "lowshelf", frequency: 150 },
        { type: "peaking", frequency: 1000, q: 0.9 },
        { type: "highshelf", frequency: 5500 }
      ];
      toneProbeFilters = spec.map((entry) => {
        const filter = toneProbeContext!.createBiquadFilter();
        filter.type = entry.type;
        filter.frequency.value = entry.frequency;

        if (entry.q) {
          filter.Q.value = entry.q;
        }

        return filter;
      });
    }

    if (!toneProbeFilters || !toneProbeFrequencies) {
      return null;
    }

    const gains = [tone.sub, tone.bass, tone.mid, tone.treble];
    const magnitude = new Float32Array(toneCurvePoints);
    const phase = new Float32Array(toneCurvePoints);
    const totalDb = new Float32Array(toneCurvePoints);

    toneProbeFilters.forEach((filter, filterIndex) => {
      filter.gain.value = gains[filterIndex];
      filter.getFrequencyResponse(toneProbeFrequencies!, magnitude, phase);

      for (let index = 0; index < toneCurvePoints; index += 1) {
        totalDb[index] += 20 * Math.log10(Math.max(1e-6, magnitude[index]));
      }
    });

    return totalDb;
  } catch {
    return null;
  }
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
    // A seeded Lathe cut so the CUT stamp, inspector line, and (with
    // store-lathe=1) the open bench read alive in screenshots.
    latheOpen: new URLSearchParams(window.location.search).get("store-lathe") === "1",
    reducedMotion: getStoreDemoReducedMotion(),
    takeoutSongs,
    toneByTrack: {
      [demoTracks[0].id]: { sub: 4, bass: 0, mid: -2, treble: 3, width: 1.3, drive: 0.35, speed: 1.05 }
    },
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

type StoredSpineFile = {
  version: number;
  spines: Record<string, SerializedSpine>;
};

function loadStoredSpines(): Map<string, TrackSpine> {
  const spines = new Map<string, TrackSpine>();

  if (typeof window === "undefined" || isStoreDemoMode()) {
    return spines;
  }

  try {
    const raw = window.localStorage.getItem(spineStorageKey);

    if (!raw) {
      return spines;
    }

    const parsed = JSON.parse(raw) as StoredSpineFile;

    if (parsed?.version !== SPINE_VERSION || !parsed.spines || typeof parsed.spines !== "object") {
      return spines;
    }

    for (const [trackId, serialized] of Object.entries(parsed.spines)) {
      const spine = deserializeSpine(serialized);

      if (spine) {
        spines.set(trackId, spine);
      }
    }
  } catch {
    // Corrupt archive: start clean, the tracing queue rebuilds it.
  }

  return spines;
}

function persistSpines(spines: Map<string, TrackSpine>) {
  try {
    const entries = [...spines.entries()].slice(-spineStoreLimit);
    const file: StoredSpineFile = {
      version: SPINE_VERSION,
      spines: Object.fromEntries(entries.map(([trackId, spine]) => [trackId, serializeSpine(spine)]))
    };

    window.localStorage.setItem(spineStorageKey, JSON.stringify(file));
  } catch {
    // Quota or serialization failure: spines are a rebuildable cache.
  }
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

function albumHue(track: AlbumSource | undefined) {
  const seed = hashText(track ? `${track.title}-${track.artist}-${track.album}` : "empty-cart");
  return (seed * 7) % 360;
}

// Spine render palettes stay on the deck's red/steel-blue/cream hardware
// colors so the spine reads as another instrument, not a new visual language.
const seekSpinePalette: SpinePalette = {
  // Played history burns bright red; the road ahead sits well dimmed so
  // position reads at a glance.
  played: "rgba(202, 48, 48, 0.94)",
  unplayed: "rgba(156, 199, 216, 0.15)",
  core: "rgba(139, 17, 27, 0.5)",
  tick: "rgba(239, 239, 231, 0.42)"
};

const rowSpinePalette: SpinePalette = {
  played: "rgba(156, 199, 216, 0.5)",
  unplayed: "rgba(156, 199, 216, 0.5)",
  core: "rgba(139, 17, 27, 0.72)",
  tick: "rgba(239, 239, 231, 0.42)"
};

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
    // Relative so it resolves under a subpath host (GitHub Pages) as well as
    // the dev server root; the packaged shell 404s here and falls through to
    // the host bridge.
    const response = await fetch("__cody_music__/library");

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

function isBundledDemo(track: Track | undefined) {
  return track?.metadataSource === "Bundled demo pressing";
}

function hasTagGap(track: Track | undefined) {
  // Bundled demo pressings are complete by construction — a missing Takeout
  // match is not a gap for them.
  return Boolean(track) && !isBundledDemo(track) && (!isTakeoutMatched(track) || !track?.artworkUrl);
}

function getStatusChips(track: Track | undefined, missingSong?: TakeoutSong): StatusChip[] {
  if (!track) {
    return [
      { label: "MISSING FILE", query: "missing:file", tone: "alert" },
      // Fallback filters to the ghost shelf itself: tag:takeout resolves via
      // isTakeoutMatched(track), which is always false for missing rows.
      { label: "YT ROW", query: missingSong?.videoId ? `yt:${missingSong.videoId}` : "missing:file", tone: "muted" }
    ];
  }

  const chips: StatusChip[] = [];

  if (track.youtubeVideoId) {
    chips.push({ label: "YT MATCH", query: "status:matched", tone: "match" });
  } else if (isTakeoutMatched(track)) {
    chips.push({ label: "YT AMBIG", query: "status:ambiguous", tone: "muted" });
  } else if (isBundledDemo(track)) {
    chips.push({ label: "DEMO", query: "artist:cody", tone: "muted" });
  } else {
    chips.push({ label: "LOCAL ONLY", query: "status:local", tone: "muted" });
  }

  if (track.metadataSource?.toLowerCase().includes("ambiguous") || track.album.toLowerCase().includes("takeout matches")) {
    chips.push({ label: "DUPLICATE?", query: "status:duplicate", tone: "alert" });
  }

  if (!track.artworkUrl) {
    chips.push({ label: "NO COVER", query: "missing:cover", tone: "alert" });
  }

  if (!isTakeoutMatched(track) && !isBundledDemo(track)) {
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

function cardMatchesCatalogQuery(card: ShelfCard, rawQuery: string, context?: { cutIds: Set<string> }) {
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

      if (value === "favorite") {
        return track.favorite;
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

    if (key === "fav" || key === "favorite") {
      const wantsFavorite = value === "yes" || value === "true" || value === "1";
      return track ? track.favorite === wantsFavorite : !wantsFavorite;
    }

    if (key === "tag") {
      if (value === "gap") {
        return hasTagGap(track);
      }

      if (value === "takeout") {
        return isTakeoutMatched(track);
      }
    }

    if (key === "cut") {
      const wantsCut = value === "yes" || value === "true" || value === "1";
      return track ? (context?.cutIds.has(track.id) ?? false) === wantsCut : !wantsCut;
    }

    if (key === "match") {
      const comparison = value.match(/^([<>]=?|=)?(\d+)$/);

      if (!comparison || !track) {
        return false;
      }

      const operator = comparison[1] ?? "=";
      const target = Number(comparison[2]);
      const confidence = formatMatchConfidence(track);

      // "below N" means a WEAK match, not the absence of one — without this,
      // match:<80 floods with every local/demo track at confidence 0 and the
      // LOW CONF chip's own query buries the rows it points at.
      if ((operator === "<" || operator === "<=") && confidence <= 0) {
        return false;
      }

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

// The missing object made literal: a wireframe cartridge slab rotating over
// its own reflection, faces carrying the deck's spec text. Shown wherever the
// shelf comes up empty (no library, or a FIND with no matches).
function CartridgeCube({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`cartridge-cube-stage ${compact ? "compact" : ""}`} aria-hidden="true">
      {["", "reflection"].map((variant) => (
        <div key={variant || "main"} className={`cartridge-cube-wrap ${variant}`}>
          <div className="cartridge-cube">
            <span className="cube-face cube-front">
              CODY NOIR
              <em>NO CARTRIDGE</em>
            </span>
            <span className="cube-face cube-back">LOCAL-ONLY ARCHIVE</span>
            <span className="cube-face cube-left">TRACE ENGINE v5</span>
            <span className="cube-face cube-right">SOURCE: USER-SELECTED AUDIO</span>
            <span className="cube-face cube-top" />
            <span className="cube-face cube-bottom" />
          </div>
        </div>
      ))}
    </div>
  );
}

// C11 teletype: system messages print character-by-character like a dot-matrix
// head instead of swapping instantly. Disabled for reduced motion and store
// captures, where the full text lands immediately.
function useTeletype(text: string, enabled: boolean) {
  const [printed, setPrinted] = useState(text);

  useEffect(() => {
    if (!enabled) {
      setPrinted(text);
      return undefined;
    }

    setPrinted("");
    let index = 0;
    // 3 chars per 36ms: same print feel, ~half the React re-renders.
    const interval = window.setInterval(() => {
      index += 3;
      setPrinted(text.slice(0, index));

      if (index >= text.length) {
        window.clearInterval(interval);
      }
    }, 36);

    return () => window.clearInterval(interval);
  }, [text, enabled]);

  return printed;
}

// Rotary AMP knob: replaces the range slider but keeps role=slider + aria for
// accessibility. Vertical drag / wheel / arrow keys adjust volume; the arc and
// dB label read out the amp gain.
type KnobProps = {
  ariaLabel: string;
  label?: string;
  value: number; // normalized 0..1
  onChange: (next: number) => void;
  format: (value: number) => string;
  defaultValue: number; // normalized; double-click reset + detent mark
  bipolar?: boolean; // arc grows from the detent (center) instead of the floor
  size?: "amp" | "bench";
  disabled?: boolean;
  title?: string;
};

function Knob({
  ariaLabel,
  label,
  value,
  onChange,
  format,
  defaultValue,
  bipolar = false,
  size = "amp",
  disabled = false,
  title
}: KnobProps) {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null);
  const capShadeId = useId();

  const clamp = (next: number) => Math.min(1, Math.max(0, next));
  const angle = -135 + value * 270;
  const printed = format(value);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }

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
    if (disabled) {
      return;
    }

    onChange(clamp(value - Math.sign(event.deltaY) * 0.04));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      // The knob owns its arrows — without this the global handler also
      // seeks the track ±5s on the same press.
      event.stopPropagation();
      onChange(clamp(value + 0.05));
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      onChange(clamp(value - 0.05));
    }
  }

  // Arc geometry: pathLength 100 over 360°; CSS rotates the circle 135° so
  // the path starts at the knob's -135° stop. Unipolar fills from the stop;
  // bipolar fills from the detent (12 o'clock = 37.5 path units in).
  const sweep = (value - 0.5) * 75;
  const arcStyle = bipolar
    ? {
        strokeDasharray: `${Math.abs(sweep)} ${100 - Math.abs(sweep)}`,
        strokeDashoffset: sweep >= 0 ? -37.5 : Math.abs(sweep) - 37.5
      }
    : { strokeDashoffset: 100 - value * 75 };

  return (
    <div
      className={`amp-knob ${size === "bench" ? "bench-knob" : ""} ${disabled ? "is-disabled" : ""}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={printed}
      title={title ?? "Double-click to reset"}
      style={{ "--knob-angle": `${angle}deg`, "--knob-fill": value.toFixed(3) } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        if (!disabled) {
          onChange(defaultValue);
        }
      }}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      {label ? (
        <span className="bench-knob-label" aria-hidden="true">
          {label}
        </span>
      ) : null}
      <svg viewBox="0 0 48 48" className="amp-knob-face" aria-hidden="true">
        <defs>
          <radialGradient id={capShadeId} cx="38%" cy="30%" r="85%">
            <stop offset="0%" stopColor="#33333b" />
            <stop offset="55%" stopColor="#1c1c22" />
            <stop offset="100%" stopColor="#0b0b0f" />
          </radialGradient>
        </defs>
        {/* Panel tick ring across the 270° sweep. */}
        <g className="amp-knob-ticks">
          {Array.from({ length: 13 }).map((_, tick) => (
            <line
              key={tick}
              x1="24"
              y1="1.6"
              x2="24"
              y2={tick % 3 === 0 ? "4.6" : "3.6"}
              transform={`rotate(${-135 + tick * 22.5} 24 24)`}
            />
          ))}
        </g>
        <circle className="amp-knob-arc-track" cx="24" cy="24" r="20" pathLength={100} />
        <circle className="amp-knob-arc-fill" cx="24" cy="24" r="20" pathLength={100} style={arcStyle} />
        {/* Reset-position detent mark. */}
        <line
          className="amp-knob-detent"
          x1="24"
          y1="1.2"
          x2="24"
          y2="5"
          transform={`rotate(${-135 + defaultValue * 270} 24 24)`}
        />
        {/* Knurled rim spins with the setting; the lit cap stays put. */}
        <g className="amp-knob-rotor">
          <circle className="amp-knob-knurl" cx="24" cy="24" r="15.6" pathLength={100} />
        </g>
        <circle className="amp-knob-cap" cx="24" cy="24" r="13.2" fill={`url(#${capShadeId})`} />
        <circle className="amp-knob-cap-ring" cx="24" cy="24" r="9.6" />
        <g className="amp-knob-rotor">
          <line className="amp-knob-pointer" x1="24" y1="21.4" x2="24" y2="11.4" />
        </g>
      </svg>
      <span className="amp-knob-db">{printed}</span>
    </div>
  );
}

function VolumeKnob({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <Knob
      ariaLabel="Volume"
      value={value}
      onChange={onChange}
      format={(next) => formatGain(next, 0)}
      defaultValue={defaultVolume}
      title="Double-click to reset to stock gain"
    />
  );
}

// Item 13: the signature meter — twin illuminated glass faces. The audio loop
// writes --vu-l/--vu-r/--vu-peak-*/--vu-lamp-* onto containerRef each frame;
// clicking the face cycles what the needles read (VU / WIDTH / LOUD / SPEC).
function VuMeter({
  containerRef,
  mode,
  onCycle
}: {
  containerRef: React.RefObject<HTMLButtonElement>;
  mode: MeterMode;
  onCycle: () => void;
}) {
  const channels = meterModeChannels[mode];

  return (
    <button
      type="button"
      ref={containerRef}
      className={`vu-meter meter-face-${mode}`}
      aria-label={`Meter face: ${meterModeTitles[mode]}. Click to cycle meter modes`}
      title={`Meter face: ${meterModeTitles[mode]} — click to cycle`}
      onClick={onCycle}
    >
      {channels.map((channelLabel, channelIndex) => (
        <span key={`${mode}-${channelLabel}`} className={`vu-gauge vu-gauge-${channelIndex === 0 ? "l" : "r"}`}>
          <span className="vu-arc" />
          <span className="vu-peak" />
          <span className="vu-needle" />
          <span className="vu-lamp" />
          <span className="vu-glass" />
          <span className="vu-label">{channelLabel}</span>
        </span>
      ))}
      <span className="vu-mode-tag">{meterModeTitles[mode]}</span>
    </button>
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
  // The Lathe: bench nodes + the latest bypass-resolved settings, applied
  // immediately when the graph is (re)built.
  const toneNodesRef = useRef<{
    subShelf: BiquadFilterNode;
    bassShelf: BiquadFilterNode;
    midPeak: BiquadFilterNode;
    trebleShelf: BiquadFilterNode;
    msSideLevel: GainNode;
    dryGain: GainNode;
    wetGain: GainNode;
  } | null>(null);
  const toneApplyRef = useRef<ToneSettings>(flatTone);
  const benchBypassRef = useRef(false);
  const benchTickRef = useRef<{ curveDb: Float32Array | null }>({ curveDb: null });
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const analyserLRef = useRef<AnalyserNode | null>(null);
  const analyserRRef = useRef<AnalyserNode | null>(null);
  const vuMeterRef = useRef<HTMLButtonElement | null>(null);
  const vuStateRef = useRef({ l: 0, r: 0, peakL: 0, peakR: 0, peakHoldL: 0, peakHoldR: 0, lampL: 0, lampR: 0 });
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
  const signalColumnsRef = useRef<HTMLDivElement | null>(null);
  const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bassLevelRef = useRef(0);
  const beatRef = useRef({ pulse: 0, gate: 0, threshold: 0.12 });
  const lastTickAtRef = useRef(0);
  const shuttleRateRef = useRef(0);
  const countedPlayForRef = useRef("");
  // Spectral Spines: decoded spine cache + derived image caches, plus the
  // background tracing queue's bookkeeping. Spines persist separately from the
  // main state key so reset/sanitize stay simple.
  const [initialSpines] = useState(() => loadStoredSpines());
  const spinesRef = useRef<Map<string, TrackSpine>>(initialSpines);
  const spineImagesRef = useRef<Map<string, string>>(new Map());
  const pressingsRef = useRef<Map<string, string>>(new Map());
  const spineFailedRef = useRef<Set<string>>(new Set());
  const spineQueueRunningRef = useRef(false);
  const spineQueueStoppedRef = useRef(false);
  const spinePersistTimerRef = useRef<number | null>(null);
  const seekSpineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Plotter reveal: 0 means "fully revealed"; otherwise the wall-clock start
  // of the sweep. Deriving progress from elapsed time (not accumulated rAF
  // frames) keeps the spine correct even when a hidden window starves rAF.
  const seekRevealStartRef = useRef(0);
  const seekRevealRafRef = useRef<number | null>(null);
  // Skip-unchanged gate: the seek spine only repaints when its pixels move.
  const seekPaintKeyRef = useRef("");
  const paintSeekSpineRef = useRef<() => void>(() => undefined);
  const tracksQueueRef = useRef<Track[]>([]);
  const currentIdQueueRef = useRef("");
  const signalLockRef = useRef<{ startedAt: number; duration: number } | null>(null);
  const scratchWaveRef = useRef<Uint8Array | null>(null);
  const spoolStartRef = useRef(0);
  const idleTwitchTimerRef = useRef<number | null>(null);
  const idleTwitchRafRef = useRef<number | null>(null);
  const findSweepTimerRef = useRef<number | null>(null);
  const findSweepSkipRef = useRef(true);
  const degaussTimerRef = useRef<number | null>(null);
  const [initialState] = useState<StoredState>(() => loadStoredState());
  const [tracks, setTracks] = useState<Track[]>(() => initialState.tracks ?? []);
  const [takeoutSongs, setTakeoutSongs] = useState<TakeoutSong[]>(() => initialState.takeoutSongs ?? []);
  const [currentId, setCurrentId] = useState(() => initialState.currentId ?? "");
  const [interference, setInterference] = useState<InterferenceMode>(() => initialState.interference ?? "low");
  const [isPlaying, setIsPlaying] = useState(false);
  const [query, setQuery] = useState("");
  const [volume, setVolume] = useState(() => initialState.volume ?? defaultVolume);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [importStatus, setImportStatus] = useState("Loading desktop music");
  const [isDragActive, setIsDragActive] = useState(false);
  const [activeShelf, setActiveShelf] = useState<ShelfView>(() => initialState.activeShelf ?? "library");
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
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() =>
    initialState.repeat === "all" || initialState.repeat === "one" ? initialState.repeat : "off"
  );
  const latticeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintGrooveLatticeRef = useRef<() => void>(() => undefined);
  // Groove Lattice: live onsets measured against the archived beat grid.
  const grooveHitsRef = useRef<Array<{ time: number; err: number }>>([]);
  const lastBeatPulseRef = useRef(0);
  // Filament loom: recent displayed waves feed the lagged strands.
  const waveHistoryRef = useRef<{ frames: Uint8Array[]; cursor: number }>({ frames: [], cursor: 0 });
  const heroTexturesRef = useRef<Map<string, string>>(new Map());
  const [heroDocked, setHeroDocked] = useState(() => initialState.heroDock === true);
  const [toneByTrack, setToneByTrack] = useState<Record<string, ToneSettings>>(
    () => initialState.toneByTrack ?? {}
  );
  const [benchOpen, setBenchOpen] = useState(() => initialState.latheOpen === true);
  const [benchBypass, setBenchBypass] = useState(false);
  const [denseRows, setDenseRows] = useState(() => initialState.denseRows === true);
  const [meterMode, setMeterMode] = useState<MeterMode>(() =>
    meterModeOrder.includes(initialState.meter as MeterMode) ? (initialState.meter as MeterMode) : "track"
  );
  const [shelfSize, setShelfSize] = useState<ShelfSize>(() =>
    shelfSizeOrder.includes(initialState.shelfSize as ShelfSize) ? (initialState.shelfSize as ShelfSize) : "shelf"
  );
  const [playNextId, setPlayNextId] = useState("");
  const [lockFlashId, setLockFlashId] = useState("");
  const [rowMenuId, setRowMenuId] = useState("");
  const lockFlashTimerRef = useRef<number | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const shelfDragRef = useRef<{ startY: number; pointerId: number; moved: boolean } | null>(null);
  const meterModeRef = useRef<MeterMode>("track");
  const interferenceRef = useRef<InterferenceMode>("low");
  // Scope-scene state shared with the long-lived tick closure.
  const currentSpineTickRef = useRef<{
    profile: Float32Array | null;
    onsets: Uint16Array | null;
    hue: number;
    duration: number;
    bpm: number;
    /** Beat-grid phase offset in seconds (grid beats land at phase + k·period). */
    gridPhase: number;
  }>({ profile: null, onsets: null, hue: 202, duration: 0, bpm: 0, gridPhase: 0 });
  const heatRef = useRef({ level: 0, peak: 0 });
  const sessionRef = useRef({ seconds: 0, plays: 0 });
  const needleSourceRef = useRef({ l: 0, r: 0 });
  const attractTickRef = useRef(false);
  const drawScopeStructureRef = useRef<() => void>(() => undefined);
  const wasPlayingRef = useRef(false);
  const constellationRef = useRef<Array<{
    x: number;
    y: number;
    bpm: number;
    hue: number;
    active: boolean;
  }> | null>(null);
  const meterDecayRafRef = useRef<number | null>(null);
  const tapeWindRef = useRef<{ startedAt: number } | null>(null);
  const skipWindRef = useRef(false);
  const seekLoopRef = useRef(0);
  const scopeDropoutRef = useRef({ until: 0, nextAt: 0 });
  const [spineRevision, setSpineRevision] = useState(0);
  const [tracing, setTracing] = useState<{ done: number; total: number; label: string; trackId: string } | null>(
    null
  );
  const [isFindSweeping, setIsFindSweeping] = useState(false);
  const [isDegaussing, setIsDegaussing] = useState(false);
  const [showKeyLegend, setShowKeyLegend] = useState(false);

  const currentTrack = tracks.find((track) => track.id === currentId);
  // The Lathe: this cartridge's archived cut (stored entries are always
  // non-flat, so the map's key set IS the cut list).
  const currentTone = toneByTrack[currentId] ?? flatTone;
  const cutIds = useMemo(() => new Set(Object.keys(toneByTrack)), [toneByTrack]);

  function updateTone(partial: Partial<ToneSettings>) {
    if (!currentId) {
      return;
    }

    setToneByTrack((existing) => {
      const next = sanitizeTone({ ...(existing[currentId] ?? flatTone), ...partial });

      if (isFlatCut(next)) {
        if (!(currentId in existing)) {
          return existing;
        }

        const { [currentId]: _dropped, ...rest } = existing;
        return rest;
      }

      return { ...existing, [currentId]: next };
    });
  }
  const currentPlayCount = currentTrack?.playCount ?? 0;
  const currentWearTier = currentPlayCount >= 25 ? 3 : currentPlayCount >= 10 ? 2 : currentPlayCount >= 3 ? 1 : 0;
  // Reading the spine cache during render is safe: spineRevision bumps a
  // re-render whenever the tracing queue lands a new spine.
  const currentSpine = getTrackSpine(currentTrack);
  const currentSpineStats = useMemo(
    () => (currentSpine ? computeSpineStats(currentSpine) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentSpine, spineRevision]
  );
  const isTracingCurrentTrack = Boolean(
    !currentSpine && currentTrack && tracing && isLocalPlaybackUrl(currentTrack.url)
  );
  // Covered tracks get their art as a dim blurred wash; artless tracks get a
  // sharp procedural "archive plate" texture instead — missing covers read as
  // an aesthetic, not an error. Texture regenerates once the spine lands.
  const heroBackdropUrl = currentTrack?.artworkUrl || "";
  const heroTextureUrl = currentTrack && !currentTrack.artworkUrl ? getHeroTexture(currentTrack) : undefined;
  // C4 phosphor burn-in: the most-worn cartridge's title ghosts into the tube
  // during attract mode.
  const burnGhostTitle = useMemo(() => {
    let mostPlayed: Track | undefined;

    for (const track of tracks) {
      if ((track.playCount ?? 0) >= 3 && (track.playCount ?? 0) > (mostPlayed?.playCount ?? 0)) {
        mostPlayed = track;
      }
    }

    return mostPlayed?.title ?? "";
  }, [tracks]);
  const takeoutMatchMap = useMemo(() => createTakeoutMatchMap(takeoutSongs, tracks), [takeoutSongs, tracks]);
  const takeoutMatchedCount = useMemo(
    () => takeoutSongs.filter((song) => takeoutMatchMap.get(song.id)).length,
    [takeoutMatchMap, takeoutSongs]
  );
  const takeoutMissingCount = Math.max(0, takeoutSongs.length - takeoutMatchedCount);

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

    return [];
  }, [activeShelf, takeoutMatchMap, takeoutSongs, tracks]);

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
    return shelfCards.filter((card) => cardMatchesCatalogQuery(card, query, { cutIds }));
  }, [cutIds, query, shelfCards]);

  const playbackQueue = query
    ? filteredCards.flatMap((card) => (card.kind === "track" ? [card.track] : []))
    : shelfTracks;
  const hasPlayableQueue = playbackQueue.length > 0;
  const playbackDuration = duration || currentTrack?.duration || 0;
  const playbackProgress = playbackDuration > 0 ? Math.min(100, Math.max(0, (currentTime / playbackDuration) * 100)) : 0;
  const matchConfidence = formatMatchConfidence(currentTrack);
  const ytMatchCount = tracks.filter((track) => track.youtubeVideoId).length;
  const takeoutMetadataCount = tracks.filter((track) => track.metadataSource?.includes("Takeout")).length;
  const tagIssueCount = tracks.filter((track) => !track.metadataSource?.includes("Takeout") && !isBundledDemo(track)).length;
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
        isTakeoutMatched(currentTrack) ? "takeout tags" : isBundledDemo(currentTrack) ? "bundled tags" : "partial tags"
      }`
    : "waiting for file";
  const currentTagErrors = currentTrack
    ? [
        currentTrack.artworkUrl ? "" : "cover missing",
        isTakeoutMatched(currentTrack) || isBundledDemo(currentTrack) ? "" : "metadata gap",
        currentTrack.metadataSource?.toLowerCase().includes("ambiguous") ||
        currentTrack.album.toLowerCase().includes("takeout matches")
          ? "duplicate metadata"
          : ""
      ]
        .filter(Boolean)
        .join(" · ") || "none"
    : "no file";
  const bassMeterStyle = {
    "--playback-progress": `${playbackProgress}%`,
    "--playback-ratio": (playbackProgress / 100).toFixed(4),
    "--signal-confidence": (matchConfidence / 100).toFixed(2)
  } as CSSProperties;
  const activeShelfLabel =
    activeShelf === "library"
      ? "Local"
      : activeShelf === "favorites"
        ? "Crowned"
        : activeShelf === "takeout"
          ? "YT Map"
          : "Missing";
  // B1: only shelves with content earn a tab; Local is always present.
  const shelfTabs = useMemo(() => {
    const tabs: Array<{ id: ShelfView; label: string }> = [{ id: "library", label: "LOCAL" }];

    if (tracks.some((track) => track.favorite)) {
      tabs.push({ id: "favorites", label: "CROWNED" });
    }

    if (takeoutSongs.length > 0) {
      tabs.push({ id: "takeout", label: "YT MAP" });
    }

    if (takeoutMissingCount > 0) {
      tabs.push({ id: "missing", label: "MISSING" });
    }

    return tabs;
  }, [takeoutMissingCount, takeoutSongs.length, tracks]);
  // Filtering runs entirely through the FIND query language; the clickable
  // status chips on each row set the same query contextually.
  const currentTrackIndex = tracks.findIndex((track) => track.id === currentTrack?.id);
  const currentTrackNumber = currentTrackIndex >= 0 ? currentTrackIndex + 1 : 0;
  const diagnosticsTitle = `${importStatus} · ${takeoutMetadataCount} Takeout metadata rows · ${coverMissingCount} cover gaps · ${takeoutMissingCount} missing local rows`;
  const derivedSystemMessage = currentTrack
    ? isPlaying
      ? "SIGNAL LOCKED"
      : hasTagGap(currentTrack)
        ? "TRACE FOUND / TAG GAP"
        : "TRACE FOUND"
    : "AWAITING FILE";
  const tracingMessage = tracing
    ? `TRACING ${String(Math.min(tracing.done + 1, tracing.total)).padStart(2, "0")}/${String(tracing.total).padStart(
        2,
        "0"
      )} · ${tracing.label.toUpperCase()}`
    : "";
  const systemMessage = transientSystemMessage || (!isPlaying && tracingMessage ? tracingMessage : derivedSystemMessage);
  const printedSystemMessage = useTeletype(systemMessage, !reducedMotion && !storeDemoMode);
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
    // The tick loop reads these through refs so the long-lived rAF closure
    // never goes stale.
    meterModeRef.current = meterMode;
    interferenceRef.current = interference;
  }, [interference, meterMode]);

  // Feed the scope scenes: the current track's spectral profile (Delta Scope
  // reference), onset list (rain), and key hue (phosphor tint).
  useEffect(() => {
    const target = currentSpineTickRef.current;

    if (!currentSpine) {
      target.profile = null;
      target.onsets = null;
      target.hue = 202;
      target.duration = 0;
      target.bpm = 0;
      target.gridPhase = 0;
      grooveHitsRef.current = [];
      return;
    }

    const profile = new Float32Array(SPINE_BANDS);

    for (let band = 0; band < SPINE_BANDS; band += 1) {
      profile[band] = (currentSpine.bandShape[band] - 128) / 127;
    }

    target.profile = profile;
    target.onsets = currentSpine.onsets;
    target.hue = keyHue(currentSpine.key);
    target.duration = currentSpine.duration;
    target.bpm = currentSpine.bpm;

    // Beat-grid phase: circular histogram of the archived onsets modulo the
    // beat period — the densest bin anchors where grid beats land.
    if (currentSpine.bpm > 0 && currentSpine.onsets.length > 4) {
      const period = 60 / currentSpine.bpm;
      const bins = new Float32Array(24);

      for (let index = 0; index < Math.min(120, currentSpine.onsets.length); index += 1) {
        const onsetTime = currentSpine.onsets[index] / 30;
        bins[Math.floor(((onsetTime % period) / period) * 24) % 24] += 1;
      }

      let bestBin = 0;

      for (let bin = 1; bin < 24; bin += 1) {
        if (bins[bin] > bins[bestBin]) {
          bestBin = bin;
        }
      }

      target.gridPhase = ((bestBin + 0.5) / 24) * period;
    } else {
      target.gridPhase = 0;
    }

    grooveHitsRef.current = [];

    // Store surfaces never run the live detector: seed a plausible hit set
    // so screenshots show the lattice working.
    if ((storeDemoMode || storePosterMode) && target.bpm > 0) {
      const demoPeriod = 60 / target.bpm;
      const demoErrs = [0.012, -0.018, 0.045, 0.005, 0.11, -0.03];
      // The paused painter anchors at now=0 and looks back ~4 beats, so
      // seeds sit on INTEGER beats behind the strike line (the old -6.5
      // half-beat offset drew every demo hit mid-gap, contradicting its own
      // near-zero err values).
      grooveHitsRef.current = demoErrs.map((err, index) => ({
        time: target.gridPhase + (index - 6) * demoPeriod + err,
        err
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSpine, currentTrack?.id, spineRevision]);

  // Constellation data for attract mode: the library plotted BPM × brightness.
  useEffect(() => {
    attractTickRef.current = attract;

    if (!attract) {
      constellationRef.current = null;
      return;
    }

    const stars: NonNullable<typeof constellationRef.current> = [];

    for (const track of tracks) {
      const spine = spinesRef.current.get(track.id);

      if (!spine || spine.bpm <= 0) {
        continue;
      }

      stars.push({
        x: Math.min(1, Math.max(0, (spine.bpm - 55) / 135)),
        y: 1 - Math.min(1, Math.max(0.02, spine.bright / 255)),
        bpm: spine.bpm,
        hue: keyHue(spine.key),
        active: track.id === currentTrack?.id
      });
    }

    constellationRef.current = stars;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attract, spineRevision, tracks, currentTrack?.id]);

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

  useEffect(() => {
    // The Lathe: one owner applies the bypass-resolved cut. The url dep
    // re-asserts SPEED after the cartridge-swap load() resets playbackRate.
    benchBypassRef.current = benchBypass;
    const effective = benchBypass ? flatTone : toneByTrack[currentId] ?? flatTone;
    applyToneSettings(effective);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, toneByTrack, benchBypass, currentTrack?.url]);

  useEffect(() => {
    // Verification hook: lets the shell smoke drive real cuts and read the
    // effective tone state without coordinate-based UI automation.
    (window as Window & { __codyBench?: object }).__codyBench = {
      set: (partial: Partial<ToneSettings>) => updateTone(partial),
      bypass: (on: boolean) => setBenchBypass(on),
      flat: () => updateTone({ ...flatTone }),
      state: () => ({ ...toneApplyRef.current, bypassed: benchBypassRef.current })
    };
  });

  useEffect(() => {
    // Cache the cut's response curve for the bench painter and repaint so
    // paused knob drags read instantly (the tick loop only runs while
    // playing).
    if (!benchOpen) {
      return;
    }

    benchTickRef.current.curveDb = computeToneCurve(toneByTrack[currentId] ?? flatTone);
    paintGrooveLatticeRef.current();
  }, [toneByTrack, currentId, benchBypass, benchOpen]);

  function applyToneSettings(effective: ToneSettings, immediate = false) {
    toneApplyRef.current = effective;
    const context = audioContextRef.current;
    const nodes = toneNodesRef.current;

    if (context && nodes) {
      const at = context.currentTime;
      const ramp = (param: AudioParam, target: number) => {
        if (immediate) {
          param.value = target;
        } else {
          // 20ms ramps keep every knob move clickless (no zipper noise).
          param.setTargetAtTime(target, at, 0.02);
        }
      };

      ramp(nodes.subShelf.gain, effective.sub);
      ramp(nodes.bassShelf.gain, effective.bass);
      ramp(nodes.midPeak.gain, effective.mid);
      ramp(nodes.trebleShelf.gain, effective.treble);
      ramp(nodes.msSideLevel.gain, effective.width);
      ramp(nodes.wetGain.gain, effective.drive);
      ramp(nodes.dryGain.gain, 1 - effective.drive);
    }

    const audio = audioRef.current;

    if (audio) {
      // defaultPlaybackRate survives the load() reset on cartridge swap.
      audio.defaultPlaybackRate = effective.speed;
      audio.playbackRate = effective.speed;
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
    }

    (window as Window & { __codyToneState?: object }).__codyToneState = {
      ...effective,
      bypassed: benchBypassRef.current
    };
  }

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

  // C13 degauss: a brief CRT ripple that "wipes" the tube between contexts
  // (shelf switches and library resets).
  function triggerDegauss() {
    if (reducedMotion || storeDemoMode) {
      return;
    }

    setIsDegaussing(true);

    if (degaussTimerRef.current !== null) {
      window.clearTimeout(degaussTimerRef.current);
    }

    degaussTimerRef.current = window.setTimeout(() => {
      setIsDegaussing(false);
      degaussTimerRef.current = null;
    }, 480);
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
    window.localStorage.removeItem(spineStorageKey);
    spinesRef.current.clear();
    spineImagesRef.current.clear();
    pressingsRef.current.clear();
    heroTexturesRef.current.clear();
    spineFailedRef.current.clear();
    setTracing(null);
    setSpineRevision((revision) => revision + 1);
    setRepeatMode("off");
    setToneByTrack({});
    setBenchBypass(false);
    setBenchOpen(false);
    applyToneSettings(flatTone, true);
    setHeroDocked(false);
    setDenseRows(false);
    setMeterMode("track");
    setShelfSize("shelf");
    setPlayNextId("");
    setLockFlashId("");
    setRowMenuId("");
    setTracks([]);
    setTakeoutSongs([]);
    setCurrentId("");
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setQuery("");
    setActiveShelf("library");
    setImportStatus("Local library reset");
    setBootMode("reindex");
    triggerDegauss();
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
    const timeout = window.setTimeout(() => {
      setBootMode(null);

      // The self-test sweep keeps writing needle swing until the overlay
      // drops; without an explicit reset the needles and peak pips hold the
      // sweep's residue on an idle deck.
      const vu = vuStateRef.current;
      vu.l = 0;
      vu.r = 0;
      vu.peakL = 0;
      vu.peakR = 0;
      vu.peakHoldL = 0;
      vu.peakHoldR = 0;
      vu.lampL = 0;
      vu.lampR = 0;
      writeVuNeedles();
    }, duration);
    return () => window.clearTimeout(timeout);
  }, [bootMode, reducedMotion]);

  // Boot self-test: during the cinematic power-on, sweep a synthetic trace
  // across the scope and swing the VU needles, so the hardware "warms up".
  // Re-index boots instead re-read the current cartridge: the sweep's
  // amplitude follows the track's archived spine.
  useEffect(() => {
    if (!bootMode || reducedMotion) {
      return undefined;
    }

    const spine = bootMode === "reindex" ? getTrackSpine(currentTrack) : undefined;
    const sweepDuration = bootMode === "reindex" ? 1000 : 1400;
    let rafId: number | null = null;
    let start = 0;
    const wave = new Uint8Array(2048);

    const render = (ts: number) => {
      if (!start) {
        start = ts;
      }

      const elapsed = ts - start;
      const progress = Math.min(1, elapsed / sweepDuration);
      // A sweep that fills in left-to-right, then settles into a full trace.
      const reach = Math.min(1, progress * 1.35);
      const energy = progress < 0.7 ? progress / 0.7 : 1 - (progress - 0.7) / 0.3 * 0.4;

      for (let index = 0; index < wave.length; index += 1) {
        const t = index / wave.length;
        const inReach = t <= reach ? 1 : 0;
        const spineLevel = spine
          ? 0.3 + (spine.energy[Math.min(spine.cols - 1, Math.floor(t * spine.cols))] / 255) * 0.95
          : 1;
        const value =
          (Math.sin(t * Math.PI * 9 + elapsed * 0.02) * 0.5 +
            Math.sin(t * Math.PI * 30 + elapsed * 0.03) * 0.3) *
          energy *
          inReach *
          spineLevel;
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
    if (activeShelf === "favorites" && !tracks.some((track) => track.favorite)) {
      setActiveShelf("library");
    }
  }, [activeShelf, tracks]);

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

      // The lane belongs to the new cartridge immediately.
      paintGrooveLatticeRef.current();

      // The clock belongs to the new cartridge: elapsed restarts at 0:00 and
      // the total comes from the track record until real metadata loads —
      // never the previous track's leftover duration state.
      setCurrentTime(0);
      setDuration(0);

      // C1 signal-lock: while playing, the scope loses the trace to static,
      // slides sync bars into place, then locks onto the new cartridge.
      // A skip that just triggered the tape-wind smear replaces the lock —
      // the grammar is "tape winds past", not "signal re-locks".
      if (skipWindRef.current) {
        skipWindRef.current = false;
      } else if (!reducedMotion && isPlaying) {
        signalLockRef.current = { startedAt: performance.now(), duration: 620 };
      }

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
  }, [currentId, currentTrack?.id, currentTrack?.metadataSource, currentTrack?.artworkUrl, isPlaying, reducedMotion]);

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

    stopVisualizerFrame("freeze");
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      paintGrooveLatticeRef.current();

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

  // Item 6: a collapsed shelf keeps the current cartridge in view.
  useEffect(() => {
    if (shelfSize !== "collapsed") {
      return;
    }

    window.requestAnimationFrame(() => {
      const activeRow = document.querySelector(".metadata-row.active") as HTMLElement | null;
      activeRow?.scrollIntoView({ block: "nearest" });
    });
  }, [shelfSize, currentId]);

  // Row overflow menu closes on outside pointer or Escape.
  useEffect(() => {
    if (!rowMenuId) {
      return undefined;
    }

    const closeOnOutside = (event: Event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.closest(".row-menu-pop, .row-menu-btn")) {
        setRowMenuId("");
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRowMenuId("");
      }
    };

    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [rowMenuId]);

  // Non-VU dial modes read the machine's memory. While paused this effect
  // drives the needles directly; while playing the tick eases toward the
  // same source so there's exactly one writer at a time.
  useEffect(() => {
    if (meterMode === "vu") {
      return undefined;
    }

    const updateNeedles = () => {
      let left = 0;
      let right = 0;

      if (meterMode === "track") {
        left = currentSpine ? currentSpine.bright / 255 : 0;
        right = currentSpineStats ? Math.min(1, currentSpineStats.dynamicRangeDb / 14) : 0;
      } else if (meterMode === "archive") {
        const localTracks = tracks.filter((track) => isLocalPlaybackUrl(track.url));
        left = localTracks.length ? Math.min(1, spinesRef.current.size / localTracks.length) : 0;
        right = tracks.length
          ? tracks.filter((track) => Boolean(track.youtubeVideoId)).length / tracks.length
          : 0;
      } else if (meterMode === "session") {
        left = (sessionRef.current.seconds % 3600) / 3600;
        right = Math.min(1, sessionRef.current.plays / 20);
      } else {
        left = Math.min(1, heatRef.current.level);
        right = Math.min(1, heatRef.current.peak);
      }

      needleSourceRef.current = { l: left, r: right };

      if (!isPlaying) {
        const vu = vuStateRef.current;
        vu.l = left;
        vu.r = right;
        writeVuNeedles();
      }
    };

    updateNeedles();
    const interval = window.setInterval(
      updateNeedles,
      meterMode === "session" || meterMode === "heat" ? 1500 : 5000
    );

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meterMode, isPlaying, currentSpine, currentSpineStats, tracks, spineRevision]);

  // The deck cools while paused, whatever the dials are showing.
  useEffect(() => {
    if (isPlaying) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      heatRef.current.level *= 0.982;

      if (heatRef.current.level < 0.002) {
        heatRef.current.level = 0;
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [isPlaying]);

  // C8 find radar sweep: every FIND change sweeps a scanline down the shelf
  // and lets the surviving rows resolve in its wake.
  useEffect(() => {
    if (findSweepSkipRef.current) {
      findSweepSkipRef.current = false;
      return undefined;
    }

    if (reducedMotion || storeDemoMode) {
      return undefined;
    }

    setIsFindSweeping(false);
    const restartFrame = window.requestAnimationFrame(() => setIsFindSweeping(true));

    if (findSweepTimerRef.current !== null) {
      window.clearTimeout(findSweepTimerRef.current);
    }

    findSweepTimerRef.current = window.setTimeout(() => {
      setIsFindSweeping(false);
      findSweepTimerRef.current = null;
    }, 560);

    return () => {
      window.cancelAnimationFrame(restartFrame);
    };
  }, [query, reducedMotion, storeDemoMode]);

  // Pause = study the tape. The frozen live trace holds for a beat (the
  // freeze decay), then the structure map lands; seeks or trace arrivals
  // while paused redraw it immediately.
  useEffect(() => {
    if (isPlaying) {
      wasPlayingRef.current = true;
      return undefined;
    }

    if (bootMode) {
      return undefined;
    }

    const delay = wasPlayingRef.current && !reducedMotion ? 650 : 40;
    wasPlayingRef.current = false;
    const timer = window.setTimeout(() => drawScopeStructureRef.current(), delay);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, bootMode, currentTime, currentSpine, spineRevision, currentTrack?.id, reducedMotion]);

  // C7 idle twitch: while paused the machine stays subtly alive — a needle
  // twitch and a single heartbeat blip on the scope every 9-15 seconds.
  useEffect(() => {
    if (isPlaying || reducedMotion || storeDemoMode || bootMode || attract) {
      return undefined;
    }

    let cancelled = false;
    const blip = new Uint8Array(512);

    const schedule = () => {
      idleTwitchTimerRef.current = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        const startedAt = performance.now();

        const animate = (timestamp: number) => {
          if (cancelled) {
            return;
          }

          const elapsed = timestamp - startedAt;
          const kickProgress = Math.min(1, elapsed / 340);
          const kick = Math.sin(kickProgress * Math.PI);
          const vu = vuStateRef.current;
          vu.l = kick * 0.07;
          vu.r = kick * 0.05;
          writeVuNeedles();

          if (kickProgress < 1) {
            for (let index = 0; index < blip.length; index += 1) {
              const t = index / blip.length;
              const pulse = Math.exp(-(((t - 0.5) * 14) ** 2)) * kick;
              blip[index] = 128 + Math.round(pulse * 52 * Math.sin(t * Math.PI * 42));
            }

            drawScopeTrace(blip, kick * 0.12, 0);
            idleTwitchRafRef.current = window.requestAnimationFrame(animate);
            return;
          }

          // Hand the tube back to the structure map after the blip.
          drawScopeStructureRef.current();
          idleTwitchRafRef.current = null;
          schedule();
        };

        idleTwitchRafRef.current = window.requestAnimationFrame(animate);
      }, 9000 + Math.random() * 6000);
    };

    schedule();

    return () => {
      cancelled = true;

      if (idleTwitchTimerRef.current !== null) {
        window.clearTimeout(idleTwitchTimerRef.current);
        idleTwitchTimerRef.current = null;
      }

      if (idleTwitchRafRef.current !== null) {
        window.cancelAnimationFrame(idleTwitchRafRef.current);
        idleTwitchRafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, reducedMotion, storeDemoMode, bootMode, attract]);

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
        denseRows,
        heroDock: heroDocked,
        interference,
        latheOpen: benchOpen,
        meter: meterMode,
        reducedMotion: initialState.reducedMotion === true,
        repeat: repeatMode,
        shelfSize,
        takeoutSongs,
        toneByTrack: Object.fromEntries(
          Object.entries(toneByTrack).filter(([trackId]) => durableTracks.some((track) => track.id === trackId))
        ),
        tracks: durableTracks,
        volume
      } satisfies StoredState)
    );
  }, [
    activeShelf,
    benchOpen,
    currentId,
    denseRows,
    heroDocked,
    interference,
    initialState.reducedMotion,
    meterMode,
    repeatMode,
    shelfSize,
    storeDemoMode,
    takeoutSongs,
    toneByTrack,
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
        // Keep the active catalog row in view as selection moves (J/K, row
        // arrows, auto-advance). The old card-shelf scroll targets
        // (data-track-id / .track-list) died in the shelf redesign and their
        // early-return kept this line from ever running.
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

  // Keep queue-visible mirrors fresh so the long-running tracing loop always
  // reads the latest library and selection without restarting.
  useEffect(() => {
    tracksQueueRef.current = tracks;
    currentIdQueueRef.current = currentId;
  });

  useEffect(() => {
    // Re-arm on mount so StrictMode's simulated remount doesn't leave the
    // tracing queue permanently stopped.
    spineQueueStoppedRef.current = false;

    return () => {
      spineQueueStoppedRef.current = true;

      if (spinePersistTimerRef.current !== null) {
        window.clearTimeout(spinePersistTimerRef.current);
        persistSpines(spinesRef.current);
      }
    };
  }, []);

  // Background tracing queue: one decode at a time, current track first, with
  // breathing room between items. Each new import kicks the runner; the loop
  // re-scans the library every iteration so it never goes stale.
  useEffect(() => {
    if (storeDemoMode) {
      return;
    }

    async function runSpineQueue() {
      if (spineQueueRunningRef.current) {
        return;
      }

      const isPendingTrack = (track: Track) =>
        isLocalPlaybackUrl(track.url) && !spinesRef.current.has(track.id) && !spineFailedRef.current.has(track.id);

      if (!tracksQueueRef.current.some(isPendingTrack)) {
        return;
      }

      spineQueueRunningRef.current = true;
      let done = 0;

      try {
        for (;;) {
          if (spineQueueStoppedRef.current) {
            return;
          }

          const pending = tracksQueueRef.current.filter(isPendingTrack);

          if (pending.length === 0) {
            break;
          }

          const next = pending.find((track) => track.id === currentIdQueueRef.current) ?? pending[0];
          setTracing({ done, total: done + pending.length, label: next.title, trackId: next.id });

          try {
            const spine = await buildTrackSpine(next.url);

            if (spineQueueStoppedRef.current) {
              return;
            }

            spinesRef.current.set(next.id, spine);
            spineImagesRef.current.delete(next.id);
            pressingsRef.current.delete(next.id);
            heroTexturesRef.current.delete(next.id);
            schedulePersistSpines();
            setSpineRevision((revision) => revision + 1);

            // Scanner grammar: flash TRACE LOCKED on the row before it
            // settles back into its normal status chips.
            setLockFlashId(next.id);

            if (lockFlashTimerRef.current !== null) {
              window.clearTimeout(lockFlashTimerRef.current);
            }

            lockFlashTimerRef.current = window.setTimeout(() => {
              setLockFlashId("");
              lockFlashTimerRef.current = null;
            }, 950);
          } catch {
            spineFailedRef.current.add(next.id);
            // Re-render so the row settles into its NO LOCK state.
            setSpineRevision((revision) => revision + 1);
          }

          done += 1;
          await new Promise((resolve) => window.setTimeout(resolve, 320));
        }
      } finally {
        spineQueueRunningRef.current = false;

        if (!spineQueueStoppedRef.current) {
          setTracing(null);

          if (done > 0) {
            flashSystemMessage(
              `TRACE ARCHIVE UPDATED · ${String(spinesRef.current.size).padStart(2, "0")} SPINES`,
              1600
            );
          }
        }
      }
    }

    runSpineQueue();
    // spineRevision is included so manual RETRACE requests re-kick the runner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, storeDemoMode, spineRevision]);

  // C2 plotter draw: when a spine lands for the selected track (track change
  // or trace completion), the seek bar draws it left→right like a pen sweep.
  // The rAF loop is purely cosmetic — paintSeekSpine derives progress from
  // wall-clock time, so any later paint lands on the correct frame.
  const currentSpineAvailable = Boolean(currentSpine);
  useEffect(() => {
    if (seekRevealRafRef.current !== null) {
      window.cancelAnimationFrame(seekRevealRafRef.current);
      seekRevealRafRef.current = null;
    }

    if (!currentSpineAvailable || reducedMotion || storeDemoMode) {
      seekRevealStartRef.current = 0;
      paintSeekSpineRef.current();
      return undefined;
    }

    seekRevealStartRef.current = performance.now();
    paintSeekSpineRef.current();

    const step = () => {
      paintSeekSpineRef.current();
      seekRevealRafRef.current = seekRevealStartRef.current > 0 ? window.requestAnimationFrame(step) : null;
    };

    seekRevealRafRef.current = window.requestAnimationFrame(step);
    // Safety net for rAF-starved (hidden) windows: land the finished sweep.
    const settleTimer = window.setTimeout(() => paintSeekSpineRef.current(), 1050);

    return () => {
      window.clearTimeout(settleTimer);

      if (seekRevealRafRef.current !== null) {
        window.cancelAnimationFrame(seekRevealRafRef.current);
        seekRevealRafRef.current = null;
      }

      seekRevealStartRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentSpineAvailable, reducedMotion, storeDemoMode]);

  // Keep the seek spine and approach lane painted outside the visualizer
  // loop too (paused, seeking, spine arrival) — cheap, and the tick loop
  // covers 60fps playback.
  useEffect(() => {
    paintSeekSpineRef.current();
    paintGrooveLatticeRef.current();
  });

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
    // Leaving the window fires dragleave on whichever CHILD the cursor was
    // over, so a currentTarget===target check missed it and the drop overlay
    // stuck until the next click. relatedTarget is null when the drag truly
    // exits the document.
    if (event.currentTarget === event.target || !(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
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

  function getTrackSpine(track: Track | undefined): TrackSpine | undefined {
    if (!track) {
      return undefined;
    }

    const cached = spinesRef.current.get(track.id);

    if (cached) {
      return cached;
    }

    // Store surfaces get deterministic synthetic spines so screenshots stay
    // alive and pixel-stable without shipping audio.
    if (storeDemoMode || storePosterMode) {
      const synthetic = syntheticSpine(track.id, track.duration || 214);
      spinesRef.current.set(track.id, synthetic);
      return synthetic;
    }

    return undefined;
  }

  function getSpineRowImage(track: Track | undefined) {
    if (!track) {
      return undefined;
    }

    const cached = spineImagesRef.current.get(track.id);

    if (cached) {
      return cached;
    }

    const spine = getTrackSpine(track);

    if (!spine) {
      return undefined;
    }

    const url = spineToDataUrl(spine, 480, 30, rowSpinePalette);

    if (url) {
      spineImagesRef.current.set(track.id, url);
    }

    return url;
  }

  function getPressing(track: Track | undefined) {
    if (!track) {
      return undefined;
    }

    const cached = pressingsRef.current.get(track.id);

    if (cached) {
      return cached;
    }

    const spine = getTrackSpine(track);

    if (!spine) {
      return undefined;
    }

    const url = spineCoverDataUrl(spine, albumHue(track), 160);

    if (url) {
      pressingsRef.current.set(track.id, url);
    }

    return url;
  }

  function getHeroTexture(track: Track | undefined) {
    if (!track) {
      return undefined;
    }

    const cached = heroTexturesRef.current.get(track.id);

    if (cached) {
      return cached;
    }

    const url = heroTextureDataUrl(track.id + track.fileName, albumHue(track), getTrackSpine(track));

    if (url) {
      heroTexturesRef.current.set(track.id, url);
    }

    return url;
  }

  function schedulePersistSpines() {
    if (storeDemoMode) {
      return;
    }

    if (spinePersistTimerRef.current !== null) {
      window.clearTimeout(spinePersistTimerRef.current);
    }

    spinePersistTimerRef.current = window.setTimeout(() => {
      spinePersistTimerRef.current = null;
      persistSpines(spinesRef.current);
    }, 800);
  }

  // The seek bar IS the song's shape: paint the current spine with a
  // played/unplayed split and the plotter-reveal sweep. Reads live audio time
  // so the visualizer tick can repaint at 60fps without re-rendering React.
  function paintSeekSpine() {
    const canvas = seekSpineCanvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * pixelRatio);
    const height = Math.round(canvas.clientHeight * pixelRatio);

    if (!width || !height) {
      return;
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const spine = getTrackSpine(currentTrack);

    if (!spine) {
      context.clearRect(0, 0, width, height);
      return;
    }

    const total = audioRef.current?.duration || playbackDuration || spine.duration || 0;
    const time = audioRef.current?.currentTime ?? currentTime;
    const progress = total > 0 ? Math.min(1, Math.max(0, time / total)) : 0;

    // Smoothness: at ~4px/sec of playhead motion most frames are pixel-
    // identical — skip them unless an animation (reveal/loop) is running.
    const animating = seekRevealStartRef.current > 0 || seekLoopRef.current > 0;
    const paintKey = `${currentTrack?.id ?? ""}|${width}x${height}|${Math.round(progress * width)}|${spineRevision}`;

    if (!animating && paintKey === seekPaintKeyRef.current) {
      return;
    }

    seekPaintKeyRef.current = animating ? "" : paintKey;
    let reveal = 1;

    if (seekRevealStartRef.current > 0) {
      const linear = Math.min(1, (performance.now() - seekRevealStartRef.current) / 950);
      reveal = linear < 1 ? Math.pow(linear, 0.9) : 1;

      if (linear >= 1) {
        seekRevealStartRef.current = 0;
      }
    }

    drawSpineStrip(context, spine, width, height, {
      progress,
      reveal,
      palette: seekSpinePalette
    });

    // Repeat grammar: on a repeat-one wrap, a highlight sweeps back through
    // the line right-to-left as the machine rewinds to the top.
    if (seekLoopRef.current > 0) {
      const loopProgress = (performance.now() - seekLoopRef.current) / 380;

      if (loopProgress >= 1) {
        seekLoopRef.current = 0;
      } else {
        const sweepX = width * (1 - loopProgress);
        context.fillStyle = `rgba(202, 48, 48, ${(0.85 * (1 - loopProgress)).toFixed(3)})`;
        context.fillRect(sweepX - 2, 0, 3, height);
      }
    }
  }

  paintSeekSpineRef.current = paintSeekSpine;

  // The Groove Lattice: live onsets measured against the song's archived
  // beat grid. Gridlines scroll through a fixed strike line at constant
  // velocity; hits are ticks colored by tightness; LOCK% reads the last 12.
  function paintGrooveLattice() {
    const canvas = latticeCanvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * pixelRatio);
    const height = Math.round(canvas.clientHeight * pixelRatio);

    if (!width || !height) {
      return;
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.clearRect(0, 0, width, height);

    const scene = currentSpineTickRef.current;
    const monoFont = `900 ${Math.round(8 * pixelRatio)}px "Courier New", monospace`;
    const middle = height / 2;

    // Rail.
    context.fillStyle = "rgba(156, 199, 216, 0.14)";
    context.fillRect(0, middle, width, 1);

    if (!getTrackSpine(currentTrack)) {
      context.fillStyle = "rgba(156, 199, 216, 0.4)";
      context.font = monoFont;
      context.textAlign = "center";
      context.fillText("NO TRACE", width / 2, middle - 6 * pixelRatio);
      context.textAlign = "left";
      return;
    }

    const now = audioRef.current?.currentTime ?? currentTime;
    const strikeX = width * 0.66;
    const hits = grooveHitsRef.current;

    if (scene.bpm <= 0) {
      context.fillStyle = "rgba(255, 189, 79, 0.5)";
      context.font = monoFont;
      context.textAlign = "center";
      context.fillText("NO TEMPO LOCK", width / 2, middle - 6 * pixelRatio);
      context.textAlign = "left";
    }

    const period = scene.bpm > 0 ? 60 / scene.bpm : 0.5;
    const windowSeconds = period * 6;
    const secondsPerPx = windowSeconds / width;
    const hue = scene.hue;

    // Gridlines at integer beats, every 4th emphasized (4/4 assumption).
    if (scene.bpm > 0) {
      const windowStart = now - strikeX * secondsPerPx;
      const firstBeat = Math.ceil((windowStart - scene.gridPhase) / period);

      for (let beat = firstBeat; ; beat += 1) {
        const beatTime = scene.gridPhase + beat * period;
        const x = strikeX + (beatTime - now) / secondsPerPx;

        if (x > width) {
          break;
        }

        if (x < 0 || beatTime < 0) {
          continue;
        }

        const downbeat = ((beat % 4) + 4) % 4 === 0;
        context.fillStyle = downbeat ? `hsla(${hue}, 45%, 66%, 0.4)` : `hsla(${hue}, 40%, 60%, 0.16)`;
        context.fillRect(x, height * (downbeat ? 0.12 : 0.24), 1, height * (downbeat ? 0.76 : 0.52));
      }
    }

    // Live hits: ticks at their absolute times, colored by tightness; fresh
    // hits flash brighter.
    const tight = Math.min(0.06, period * 0.12);
    const loose = Math.min(0.11, period * 0.24);

    for (const hit of hits) {
      const x = strikeX + (hit.time - now) / secondsPerPx;

      if (x < -4 || x > width) {
        continue;
      }

      const absErr = Math.abs(hit.err);
      const age = now - hit.time;
      const flash = age < 0.25 ? 1.6 - age * 2.4 : 1;
      const color =
        absErr <= tight
          ? `rgba(239, 239, 231, ${Math.min(1, 0.6 * flash).toFixed(3)})`
          : absErr <= loose
            ? `rgba(255, 189, 79, ${Math.min(1, 0.55 * flash).toFixed(3)})`
            : `rgba(202, 48, 48, ${Math.min(1, 0.6 * flash).toFixed(3)})`;
      context.fillStyle = color;
      context.fillRect(x - pixelRatio, middle - height * 0.2, 2 * pixelRatio, height * 0.4);
    }

    // Strike line.
    context.fillStyle = "rgba(239, 239, 231, 0.8)";
    context.fillRect(strikeX - pixelRatio, height * 0.08, 2 * pixelRatio, height * 0.84);

    // LOCK%: how many of the last 12 hits landed tight.
    if (scene.bpm > 0) {
      const recent = hits.slice(-12);
      context.font = monoFont;
      context.textAlign = "right";

      if (recent.length >= 3) {
        const locked = recent.filter((hit) => Math.abs(hit.err) <= tight).length;
        const lockPct = Math.round((locked / recent.length) * 100);
        context.fillStyle =
          lockPct >= 70 ? "rgba(239, 239, 231, 0.75)" : lockPct >= 40 ? "rgba(255, 189, 79, 0.7)" : "rgba(202, 48, 48, 0.75)";
        context.fillText(`LOCK ${lockPct}%`, width - 6 * pixelRatio, 11 * pixelRatio);
      } else {
        context.fillStyle = "rgba(156, 199, 216, 0.4)";
        context.fillText(`${scene.bpm}BPM GRID`, width - 6 * pixelRatio, 11 * pixelRatio);
      }

      context.textAlign = "left";
    }
  }

  // The Lathe instrument: the bench's real combined frequency response,
  // key-tinted, plotted over the pressing's archived tonal profile (ghost).
  // Same canvas slot as the lattice; the publish below swaps painters.
  function paintLatheBench() {
    const canvas = latticeCanvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * pixelRatio);
    const height = Math.round(canvas.clientHeight * pixelRatio);

    if (!width || !height) {
      return;
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.clearRect(0, 0, width, height);

    const scene = currentSpineTickRef.current;
    const hue = scene.hue;
    const tone = toneApplyRef.current;
    const bypassed = benchBypassRef.current;
    const monoFont = `900 ${Math.round(8 * pixelRatio)}px "Courier New", monospace`;
    const middle = height / 2;
    const windowDb = 14;
    const yFor = (db: number) => middle - (db / windowDb) * (height * 0.42);

    // 0dB rail.
    context.fillStyle = "rgba(156, 199, 216, 0.14)";
    context.fillRect(0, middle, width, 1);

    // Ghost: the pressing's natural tone (24-band spine profile, ±24dB).
    if (scene.profile) {
      context.strokeStyle = `hsla(${hue}, 40%, 60%, 0.16)`;
      context.lineWidth = Math.max(1, pixelRatio);
      context.beginPath();

      for (let band = 0; band < scene.profile.length; band += 1) {
        const x = (band / (scene.profile.length - 1)) * width;
        const y = yFor(Math.max(-windowDb, Math.min(windowDb, scene.profile[band] * 24)));

        if (band === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.stroke();
    }

    // The cut: combined biquad response. Bypassed → the live line is flat
    // at 0dB and the cut dims to ghost strength (brightness only).
    const curve = benchTickRef.current.curveDb;

    if (curve) {
      context.strokeStyle = bypassed ? `hsla(${hue}, 45%, 66%, 0.18)` : `hsla(${hue}, 52%, 68%, 0.85)`;
      context.lineWidth = Math.max(1.5, 1.6 * pixelRatio);
      context.beginPath();

      for (let index = 0; index < curve.length; index += 1) {
        const x = (index / (curve.length - 1)) * width;
        const y = yFor(Math.max(-windowDb, Math.min(windowDb, curve[index])));

        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.stroke();
    }

    if (bypassed) {
      context.strokeStyle = `hsla(${hue}, 45%, 66%, 0.7)`;
      context.lineWidth = Math.max(1.5, 1.6 * pixelRatio);
      context.beginPath();
      context.moveTo(0, middle);
      context.lineTo(width, middle);
      context.stroke();
    }

    // DRIVE reads as a dashed ceiling whose presence follows the wet mix.
    if (tone.drive >= 0.005 && !bypassed) {
      context.strokeStyle = `hsla(28, 70%, 60%, ${0.15 + tone.drive * 0.5})`;
      context.lineWidth = Math.max(1, pixelRatio);
      context.setLineDash([4 * pixelRatio, 4 * pixelRatio]);
      context.beginPath();
      context.moveTo(0, yFor(windowDb - 2));
      context.lineTo(width, yFor(windowDb - 2));
      context.stroke();
      context.setLineDash([]);
    }

    // Corner readout: non-stock scalar settings only.
    const cornerParts: string[] = [];

    if (Math.abs(tone.width - 1) >= 0.01) {
      cornerParts.push(`WIDTH ${tone.width.toFixed(2)}`);
    }

    if (tone.drive >= 0.005) {
      cornerParts.push(`DRV ${Math.round(tone.drive * 100)}%`);
    }

    if (Math.abs(tone.speed - 1) >= 0.005) {
      cornerParts.push(`${tone.speed.toFixed(2)}×`);
    }

    context.font = monoFont;
    context.textAlign = "right";

    if (bypassed) {
      context.fillStyle = "rgba(255, 189, 79, 0.6)";
      context.fillText("BYPASS", width - 6 * pixelRatio, 11 * pixelRatio);
    } else if (cornerParts.length > 0) {
      context.fillStyle = "rgba(156, 199, 216, 0.4)";
      context.fillText(cornerParts.join(" · "), width - 6 * pixelRatio, 11 * pixelRatio);
    }

    context.textAlign = "left";
  }

  paintGrooveLatticeRef.current = benchOpen ? paintLatheBench : paintGrooveLattice;

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
  function drawScopeTrace(wave: Uint8Array | null, bass: number, beat: number, shuttle = 0, jitter = 0) {
    const resolved = resolveScopeContext();

    if (!resolved) {
      return;
    }

    const { context, width, height, pixelRatio } = resolved;
    const middle = height / 2;

    // Persistence: fade the previous frame toward black instead of clearing.
    // Short tails — a clean instrument line, not a hairball.
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "rgba(3, 3, 4, 0.34)";
    context.fillRect(0, 0, width, height);

    if (!wave) {
      drawScopeBaseline(context, width, height, pixelRatio);
      return;
    }

    const points = 140;
    // Fixed geometry: brightness may ride the audio, the shape may not.
    const waveHeight = height * 0.42;
    const stride = wave.length / points;

    // Filament loom: keep a short ring of recent displayed waves so the
    // strands can lag behind the live signal.
    const history = waveHistoryRef.current;

    if (history.frames.length < 13) {
      history.frames.push(Uint8Array.from(wave));
      history.cursor = history.frames.length - 1;
    } else {
      history.cursor = (history.cursor + 1) % 13;
      history.frames[history.cursor].set(wave);
    }

    const frameAt = (lag: number) => {
      if (history.frames.length === 0) {
        return wave;
      }

      // Normalize against the CURRENT ring length: the fixed +52 offset is
      // only a clean multiple when the ring is full (52 % 13 === 0); during
      // warm-up it selected scrambled frames.
      const length = history.frames.length;
      const clampedLag = Math.min(lag, length - 1);
      const index = ((history.cursor - clampedLag) % length + length) % length;
      return history.frames[index] ?? wave;
    };

    const strokeWave = (source: Uint8Array, smooth: number, offsetY: number) => {
      context.beginPath();

      for (let index = 0; index <= points; index += 1) {
        // Clamp to the buffer: the final column used to sample past the end,
        // decode as full deflection, and pin a spike to the right edge.
        const center = Math.min(source.length - 1, Math.floor(index * stride));
        let sum = 0;
        let count = 0;

        for (let k = -smooth; k <= smooth; k += 1) {
          const at = center + k * 6;

          if (at >= 0 && at < source.length) {
            sum += source[at];
            count += 1;
          }
        }

        const sample = count > 0 ? (sum / count - 128) / 128 : 0;
        const smear = shuttle > 0 ? (((index * 53) % 17) / 17 - 0.5) * shuttle * waveHeight * 0.5 : 0;
        // Interference instability: per-point vertical noise, trace only.
        const wobble = jitter > 0 ? (Math.random() - 0.5) * jitter * waveHeight : 0;
        const x = (index / points) * width;
        const y = middle + sample * waveHeight + smear + wobble + offsetY;

        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
    };

    context.globalCompositeOperation = "lighter";

    // Key tint: the phosphor hue follows the song's detected key around the
    // circle of fifths (C keeps the stock cool blue).
    const phosphorHue = currentSpineTickRef.current.hue;

    // Under-glow: one soft constant-width stroke beneath the bundle.
    context.lineWidth = 3.2 * pixelRatio;
    context.strokeStyle = `hsla(${phosphorHue}, 44%, 64%, ${(0.08 + bass * 0.12).toFixed(3)})`;
    context.shadowColor = `hsla(${phosphorHue}, 44%, 64%, 0.9)`;
    context.shadowBlur = (6 + bass * 18 + shuttle * 14) * pixelRatio;
    strokeWave(wave, 0, 0);

    // Lagged strands, faintest first: progressively smoothed copies of the
    // recent signal with small constant offsets and a hue spread — the loom.
    const strands: Array<{ lag: number; smooth: number; offset: number; hueShift: number; alpha: number; width: number }> = [
      { lag: 12, smooth: 4, offset: 7, hueShift: 16, alpha: 0.08, width: 2.6 },
      { lag: 9, smooth: 3, offset: -6, hueShift: -16, alpha: 0.12, width: 2.2 },
      { lag: 6, smooth: 2, offset: 4, hueShift: 10, alpha: 0.18, width: 1.9 },
      { lag: 3, smooth: 1, offset: -3, hueShift: -8, alpha: 0.3, width: 1.6 }
    ];

    // No per-strand shadows: canvas shadowBlur is the classic scope-render
    // cost; the additive overlap of the strands supplies the glow instead.
    context.shadowBlur = 0;

    for (const strand of strands) {
      context.lineWidth = strand.width * pixelRatio;
      context.strokeStyle = `hsla(${phosphorHue + strand.hueShift}, 52%, 68%, ${(strand.alpha * (0.8 + bass * 0.5)).toFixed(3)})`;
      strokeWave(frameAt(strand.lag), strand.smooth, strand.offset * pixelRatio);
    }

    // Core strand — the live wire, brightening on the beat.
    context.lineWidth = Math.max(1, 1.15 * pixelRatio);
    context.strokeStyle = `hsla(${phosphorHue}, 72%, 94%, ${(0.68 + beat * 0.32).toFixed(3)})`;
    context.shadowColor = `hsla(${phosphorHue}, 60%, 82%, 0.95)`;
    context.shadowBlur = (2 + beat * 6) * pixelRatio;
    strokeWave(wave, 0, 0);

    // Node sparks: on a fresh beat, bright dots where the filaments touch.
    if (beat > 0.55) {
      const sparkSeed = Math.floor(performance.now() / 380);

      for (let spark = 0; spark < 3; spark += 1) {
        const fraction = (((sparkSeed + spark * 97) * 2654435761) >>> 0) % 89 / 89;
        const sampleIndex = Math.floor(fraction * (wave.length - 1));
        const sample = ((wave[sampleIndex] ?? 128) - 128) / 128;
        const x = fraction * width;
        const y = middle + sample * waveHeight;
        context.fillStyle = `hsla(${phosphorHue}, 80%, 92%, ${(beat * 0.7).toFixed(3)})`;
        context.shadowColor = `hsla(${phosphorHue}, 80%, 88%, 0.95)`;
        context.shadowBlur = 8 * pixelRatio;
        context.beginPath();
        context.arc(x, y, (1.4 + beat * 1.6) * pixelRatio, 0, Math.PI * 2);
        context.fill();
      }
    }

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

  // Onset rain: upcoming transients (from the archived trace) fall toward an
  // impact line and flash exactly on the beat they mark — rhythm as tracer
  // fire on the tube. Runs after the trace each frame.
  function drawOnsetRain() {
    const resolved = resolveScopeContext();
    const scene = currentSpineTickRef.current;
    const audio = audioRef.current;

    if (!resolved || !scene.onsets || scene.onsets.length === 0 || !audio) {
      return;
    }

    const { context, width, height, pixelRatio } = resolved;
    const now = audio.currentTime;
    const lookahead = 2.6;
    const impactY = height * 0.86;
    const hue = scene.hue;

    context.globalCompositeOperation = "lighter";
    context.fillStyle = `hsla(${hue}, 45%, 64%, 0.1)`;
    context.fillRect(0, impactY, width, 1);

    const startFrame = Math.floor(now * 30) - 6;
    const endFrame = Math.ceil((now + lookahead) * 30);
    const onsets = scene.onsets;
    let lo = 0;
    let hi = onsets.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (onsets[mid] < startFrame) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    for (let index = lo; index < onsets.length && onsets[index] <= endFrame; index += 1) {
      const onsetTime = onsets[index] / 30;
      const remain = onsetTime - now;
      const x = (((onsets[index] * 2654435761) >>> 0) % 997) / 997 * (width * 0.92) + width * 0.04;

      if (remain <= 0) {
        const since = -remain;

        if (since < 0.18) {
          const fade = 1 - since / 0.18;
          context.fillStyle = `hsla(${hue}, 62%, 80%, ${(0.5 * fade).toFixed(3)})`;
          context.beginPath();
          context.arc(x, impactY, (2 + (1 - fade) * 7) * pixelRatio, 0, Math.PI * 2);
          context.fill();
        }

        continue;
      }

      const progress = 1 - remain / lookahead;
      context.fillStyle = `hsla(${hue}, 50%, 70%, ${(0.12 + progress * 0.4).toFixed(3)})`;
      context.fillRect(x - pixelRatio, progress * impactY - 3 * pixelRatio, 2 * pixelRatio, 3 * pixelRatio);
    }

    context.globalCompositeOperation = "source-over";
  }

  // The constellation: the library plotted tempo × brightness, every star
  // pulsing at its own BPM, the playing cartridge burning red.
  function drawConstellation(timestamp: number) {
    const resolved = resolveScopeContext();
    const stars = constellationRef.current;

    if (!resolved || !stars) {
      return;
    }

    const { context, width, height, pixelRatio } = resolved;

    context.globalCompositeOperation = "source-over";
    context.fillStyle = "rgba(3, 3, 4, 0.32)";
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";

    for (const star of stars) {
      const phase = (timestamp / 1000) * (star.bpm / 60) * Math.PI * 2;
      const pulse = 0.55 + Math.sin(phase) * 0.45;
      const x = width * (0.06 + star.x * 0.88);
      const y = height * (0.08 + star.y * 0.8);

      if (star.active) {
        context.fillStyle = `rgba(214, 60, 60, ${(0.5 + pulse * 0.5).toFixed(3)})`;
        context.beginPath();
        context.arc(x, y, (2.4 + pulse * 2.4) * pixelRatio, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(214, 60, 60, 0.35)";
        context.lineWidth = pixelRatio;
        context.beginPath();
        context.arc(x, y, (6 + pulse * 3) * pixelRatio, 0, Math.PI * 2);
        context.stroke();
      } else {
        context.fillStyle = `hsla(${star.hue}, 45%, 66%, ${(0.1 + pulse * 0.26).toFixed(3)})`;
        context.beginPath();
        context.arc(x, y, (1 + pulse * 1.3) * pixelRatio, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.globalCompositeOperation = "source-over";
    context.fillStyle = "rgba(156, 199, 216, 0.18)";
    context.font = `${9 * pixelRatio}px "Courier New", monospace`;
    context.textAlign = "left";
    context.fillText("SLOW", 8 * pixelRatio, height - 6 * pixelRatio);
    context.fillText("BRIGHT", 8 * pixelRatio, 12 * pixelRatio);
    context.textAlign = "right";
    context.fillText("FAST", width - 8 * pixelRatio, height - 6 * pixelRatio);
    context.textAlign = "left";
  }

  // Pause = study the tape: the scope renders the song's full structure map —
  // the archived energy silhouette with detected section boundaries and the
  // playhead position, burned in the song's key phosphor.
  function drawScopeStructure() {
    const resolved = resolveScopeContext();

    if (!resolved) {
      return;
    }

    const { context, width, height, pixelRatio } = resolved;
    const spine = getTrackSpine(currentTrack);

    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#030304";
    context.fillRect(0, 0, width, height);

    if (!spine) {
      drawScopeBaseline(context, width, height, pixelRatio);
      return;
    }

    const hue = keyHue(spine.key);
    const middle = height / 2;
    const columnWidth = width / spine.cols;

    context.globalCompositeOperation = "lighter";

    for (let column = 0; column < spine.cols; column += 1) {
      const energyLevel = spine.energy[column] / 255;
      const half = Math.max(1, energyLevel * height * 0.4);
      const barWidth = Math.max(1, columnWidth * 0.8);
      context.fillStyle = `hsla(${hue}, 45%, 60%, 0.15)`;
      context.fillRect(column * columnWidth, middle - half, barWidth, half * 2);
      context.fillStyle = `hsla(${hue}, 52%, 76%, 0.4)`;
      context.fillRect(column * columnWidth, middle - half, barWidth, 1.2 * pixelRatio);
    }

    // Section boundaries: spikes in the smoothed energy derivative.
    const smoothed: number[] = [];

    for (let column = 0; column < spine.cols; column += 1) {
      let sum = 0;
      let count = 0;

      for (let k = -3; k <= 3; k += 1) {
        const index = column + k;

        if (index >= 0 && index < spine.cols) {
          sum += spine.energy[index];
          count += 1;
        }
      }

      smoothed.push(sum / count / 255);
    }

    const derivative = smoothed.map((value, index) => (index === 0 ? 0 : Math.abs(value - smoothed[index - 1])));
    const meanDerivative = derivative.reduce((total, value) => total + value, 0) / derivative.length;

    context.globalCompositeOperation = "source-over";
    context.strokeStyle = `hsla(${hue}, 30%, 80%, 0.38)`;
    context.setLineDash([4 * pixelRatio, 5 * pixelRatio]);
    context.lineWidth = pixelRatio;
    let lastBoundary = -20;

    for (let column = 4; column < spine.cols - 4; column += 1) {
      if (derivative[column] > Math.max(0.035, meanDerivative * 2.6) && column - lastBoundary >= 18) {
        lastBoundary = column;
        context.beginPath();
        context.moveTo(column * columnWidth, height * 0.08);
        context.lineTo(column * columnWidth, height * 0.92);
        context.stroke();
      }
    }

    context.setLineDash([]);

    const total = audioRef.current?.duration || spine.duration || 0;
    const position = total > 0 ? Math.min(1, (audioRef.current?.currentTime ?? 0) / total) : 0;
    context.fillStyle = "rgba(202, 48, 48, 0.9)";
    context.fillRect(position * width - pixelRatio, 0, 2 * pixelRatio, height);
  }

  drawScopeStructureRef.current = drawScopeStructure;

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
    container.style.setProperty("--vu-lamp-l", vu.lampL.toFixed(3));
    container.style.setProperty("--vu-lamp-r", vu.lampR.toFixed(3));
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

  // "hard" clears everything including the scope (track ops, reset).
  // "freeze" is the pause grammar: the trace stays burned on the tube while
  // glow, meters, and needles decay to rest over ~480ms.
  function stopVisualizerFrame(mode: "hard" | "freeze" = "hard") {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      window.clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (meterDecayRafRef.current !== null) {
      window.cancelAnimationFrame(meterDecayRafRef.current);
      meterDecayRafRef.current = null;
    }

    bassBinsRef.current = null;
    bassEnvelopeRef.current = { floor: 0.035, hold: 0, last: 0, peak: 0.26 };
    beatRef.current = { pulse: 0, gate: 0, threshold: 0.12 };
    lastTickAtRef.current = 0;

    const settle = () => {
      bassLevelRef.current = 0;
      vuStateRef.current = { l: 0, r: 0, peakL: 0, peakR: 0, peakHoldL: 0, peakHoldR: 0, lampL: 0, lampR: 0 };

      // Memory faces (TRACK/ARCHIVE/SESSION/HEAT) own the needles at rest —
      // settle back onto their values instead of zero, so pausing doesn't
      // blank a dial that isn't measuring the live signal.
      if (meterModeRef.current !== "vu") {
        vuStateRef.current.l = needleSourceRef.current.l;
        vuStateRef.current.r = needleSourceRef.current.r;
      }

      writeBassVars(0, 0);
      writeSignalColumns(0);
      writeVuNeedles();
      paintGrooveLatticeRef.current();
    };

    if (mode === "freeze") {
      if (reducedMotion) {
        settle();
        drawScopeStructureRef.current();
        return;
      }

      const startedAt = performance.now();
      const vuAtPause = { ...vuStateRef.current };
      const bassAtPause = bassLevelRef.current;

      const decay = () => {
        const progress = Math.min(1, (performance.now() - startedAt) / 480);
        const keep = Math.pow(1 - progress, 1.7);
        const vu = vuStateRef.current;
        vu.l = vuAtPause.l * keep;
        vu.r = vuAtPause.r * keep;
        vu.peakHoldL = Math.max(vu.l, vuAtPause.peakHoldL * keep);
        vu.peakHoldR = Math.max(vu.r, vuAtPause.peakHoldR * keep);
        vu.lampL = vuAtPause.lampL * keep;
        vu.lampR = vuAtPause.lampR * keep;
        bassLevelRef.current = bassAtPause * keep;

        writeVuNeedles();
        writeBassVars(bassLevelRef.current, 0);
        writeSignalColumns(bassLevelRef.current);

        if (progress < 1) {
          meterDecayRafRef.current = window.requestAnimationFrame(decay);
          return;
        }

        meterDecayRafRef.current = null;
        settle();
        // The frozen trace has had its moment; settle into the structure map.
        drawScopeStructureRef.current();
      };

      meterDecayRafRef.current = window.requestAnimationFrame(decay);
      return;
    }

    settle();
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

    // A resume cancels any in-flight pause decay.
    if (meterDecayRafRef.current !== null) {
      window.cancelAnimationFrame(meterDecayRafRef.current);
      meterDecayRafRef.current = null;
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
          // Analyser bytes are linear-in-dB across the configured window;
          // keep the RAW dB-normalized value here — the Delta/absolute split
          // (tilt, song-profile comparison, ballistics) happens downstream.
          return Math.min(1, Math.max(0, (average / 255 - 0.14) / 0.78));
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
        // Shell-smoke probe: un-normalized bass energy. __codyLiveLevel is
        // envelope-adapted (a static EQ cut renormalizes away in ~1s), so
        // tone assertions must read this raw value instead.
        (window as Window & { __codyRawBass?: number }).__codyRawBass = averageBass;
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

      // C1 signal-lock: on track change (or resume) the scope shows a static
      // burst, then the trace slides horizontally and snaps into sync.
      // Duration is per-trigger: 620ms for a new cartridge, ~300ms on resume.
      const lock = signalLockRef.current;

      if (lock && wave) {
        const lockElapsed = timestamp - lock.startedAt;
        const staticPhase = lock.duration * 0.38;

        if (lockElapsed >= lock.duration) {
          signalLockRef.current = null;
        } else {
          if (!scratchWaveRef.current || scratchWaveRef.current.length !== wave.length) {
            scratchWaveRef.current = new Uint8Array(wave.length);
          }

          const scratch = scratchWaveRef.current;

          if (lockElapsed < staticPhase) {
            let noiseSeed = (Math.floor(timestamp * 7) * 2654435761) >>> 0;

            for (let index = 0; index < scratch.length; index += 1) {
              noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
              scratch[index] = 128 + Math.round(((noiseSeed >>> 24) - 128) * 0.55);
            }
          } else {
            const syncProgress = (lockElapsed - staticPhase) / (lock.duration - staticPhase);
            const offset = Math.round(
              (1 - syncProgress) * wave.length * 0.4 * Math.cos(syncProgress * Math.PI * 3)
            );

            for (let index = 0; index < scratch.length; index += 1) {
              scratch[index] = wave[(index + offset + wave.length * 4) % wave.length];
            }
          }

          wave = scratch;
        }
      }

      // Skip grammar: the tape rapidly winds past — a short hard smear.
      const wind = tapeWindRef.current;
      const windActive = Boolean(wind && timestamp - wind.startedAt < 280);

      if (wind && !windActive) {
        tapeWindRef.current = null;
      }

      // MAX interference: intercepted-broadcast dropouts — the trace cuts out
      // for ~160ms every so often.
      const interferenceNow = interferenceRef.current;

      if (interferenceNow === "max") {
        const dropout = scopeDropoutRef.current;

        if (dropout.nextAt === 0) {
          dropout.nextAt = timestamp + 5000 + Math.random() * 7000;
        }

        if (timestamp >= dropout.nextAt && dropout.until < timestamp) {
          dropout.until = timestamp + 160;
          dropout.nextAt = timestamp + 6000 + Math.random() * 9000;
        }

        if (timestamp < dropout.until) {
          wave = null;
        }
      } else {
        scopeDropoutRef.current.until = 0;
      }

      const scopeJitter =
        interferenceNow === "max" ? 0.15 : interferenceNow === "med" ? 0.07 : interferenceNow === "low" ? 0.012 : 0;

      if (!liveSignal) {
        const fallbackFrame = getAnalysisFrame(
          getCachedTrackAnalysis(currentTrack),
          audioRef.current?.currentTime ?? currentTime
        );

        if (fallbackFrame) {
          shapedBass = Math.max(shapedBass, Math.min(1, Math.pow(fallbackFrame.bass, 0.72) * 1.08));

          if (fallbackFrame.levels) {
            // Offline analysis rows are stored in the legacy 10-92px scale;
            // renormalize so they run through the same ballistics pipeline.
            nextLevels = fallbackFrame.levels.map((value) => Math.min(1, Math.max(0, (value - 10) / 82)));
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

      // Groove Lattice: record each fresh live onset against the archived
      // beat grid (signed error to the nearest grid beat).
      if (beat.pulse === 1 && lastBeatPulseRef.current < 1) {
        const grooveScene = currentSpineTickRef.current;
        const hitTime = audioRef.current?.currentTime ?? 0;
        let gridError = 0;

        if (grooveScene.bpm > 0) {
          const gridPeriod = 60 / grooveScene.bpm;
          const offset = (((hitTime - grooveScene.gridPhase) % gridPeriod) + gridPeriod) % gridPeriod;
          gridError = offset > gridPeriod / 2 ? offset - gridPeriod : offset;
        }

        const hits = grooveHitsRef.current;
        hits.push({ time: hitTime, err: gridError });

        if (hits.length > 24) {
          hits.shift();
        }
      }

      lastBeatPulseRef.current = beat.pulse;

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
        const meterFace = meterModeRef.current;
        const monoLevel = (rawL + rawR) / 2;

        // The session odometer and heat physics run regardless of the face:
        // listening time accrues, temperature integrates energy and cools
        // slowly even at full tilt.
        sessionRef.current.seconds += (dtFrames * 33.33) / 1000;
        const heat = heatRef.current;
        heat.level = Math.min(1, heat.level * Math.pow(0.99985, dtFrames) + monoLevel * dtFrames * 0.0011);
        heat.peak = Math.max(heat.peak, heat.level);

        // The dials read the machine's memory. VU keeps true 300ms meter
        // ballistics; memory modes get a statelier ~600ms swing toward the
        // values the mode effect computed.
        let targetL = rawL;
        let targetR = rawR;
        let vuCoefOverride: number | null = null;

        if (meterFace === "heat") {
          targetL = heat.level;
          targetR = heat.peak;
        } else if (meterFace !== "vu") {
          targetL = needleSourceRef.current.l;
          targetR = needleSourceRef.current.r;
          vuCoefOverride = 1 - Math.exp(-(dtFrames * 33.33) / 600);
        }

        const vuCoef = vuCoefOverride ?? 1 - Math.exp(-(dtFrames * 33.33) / 100);

        vu.l += (targetL - vu.l) * vuCoef;
        vu.r += (targetR - vu.r) * vuCoef;
        // Peak lamps always track true channel peaks regardless of face mode,
        // lighting above 0.86 and lingering as they decay.
        vu.peakHoldL = rawL > vu.peakHoldL ? rawL : Math.max(vu.l, vu.peakHoldL - 0.012 * dtFrames);
        vu.peakHoldR = rawR > vu.peakHoldR ? rawR : Math.max(vu.r, vu.peakHoldR - 0.012 * dtFrames);
        vu.lampL = Math.max(vu.lampL * Math.pow(0.93, dtFrames), rawL > 0.86 ? 1 : 0);
        vu.lampR = Math.max(vu.lampR * Math.pow(0.93, dtFrames), rawR > 0.86 ? 1 : 0);
      } else {
        const vuCoef = 1 - Math.exp(-(dtFrames * 33.33) / 100);
        vu.l += (0 - vu.l) * vuCoef;
        vu.r += (0 - vu.r) * vuCoef;
        vu.peakHoldL = Math.max(vu.l, vu.peakHoldL - 0.012 * dtFrames);
        vu.peakHoldR = Math.max(vu.r, vu.peakHoldR - 0.012 * dtFrames);
        vu.lampL *= Math.pow(0.93, dtFrames);
        vu.lampR *= Math.pow(0.93, dtFrames);
      }

      // C5 motor spool-up: from a standing start the meter bank lights bar by
      // bar and the needles rise with one analog overshoot before tracking.
      let spoolProgress = 1;

      if (spoolStartRef.current) {
        const spoolElapsed = timestamp - spoolStartRef.current;

        if (spoolElapsed >= 700) {
          spoolStartRef.current = 0;
        } else {
          spoolProgress = spoolElapsed / 700;

          const overshoot =
            spoolProgress < 0.55
              ? (spoolProgress / 0.55) * 1.16
              : 1 + 0.16 * Math.cos(((spoolProgress - 0.55) / 0.45) * Math.PI * 1.5) * (1 - (spoolProgress - 0.55) / 0.45 * 0.8);
          vu.l = Math.min(1, vu.l * Math.max(0, overshoot));
          vu.r = Math.min(1, vu.r * Math.max(0, overshoot));
        }
      }

      writeBassVars(bassLevelRef.current, beat.pulse);
      writeSignalColumns(bassLevelRef.current);
      writeVuNeedles();

      // Shell-smoke probe: a nonzero level proves real signal is flowing
      // through the Web Audio graph (a cross-origin-muted source reads 0).
      (window as Window & { __codyLiveLevel?: number }).__codyLiveLevel = bassLevelRef.current;

      // Smoothness: playback progress rides an imperative CSS var at 60fps
      // (row illumination, fallback seek rail) while React ticks at 1Hz.
      const progressAudio = audioRef.current;

      if (progressAudio && shellRef.current) {
        const totalTime = progressAudio.duration || 0;

        if (Number.isFinite(totalTime) && totalTime > 0) {
          const progressPct = Math.min(100, (progressAudio.currentTime / totalTime) * 100);
          shellRef.current.style.setProperty("--playback-progress", `${progressPct.toFixed(2)}%`);
          shellRef.current.style.setProperty("--playback-ratio", (progressPct / 100).toFixed(4));
        }
      }

      paintGrooveLatticeRef.current();

      // Scope scenes: the constellation owns the tube during attract mode;
      // otherwise the live trace plus onset rain.
      if (attractTickRef.current && constellationRef.current && constellationRef.current.length > 0) {
        drawConstellation(timestamp);
      } else {
        drawScopeTrace(
          wave,
          bassLevelRef.current,
          beat.pulse,
          shuttleRateRef.current > 0 || windActive ? 1 : 0,
          scopeJitter
        );
        drawOnsetRain();
      }

      paintSeekSpineRef.current();
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
      analyserRef.current.smoothingTimeConstant = 0.4;
      // Wider dB window than the default [-100,-30]: post-amp program
      // material (plus the low-shelf warmth) routinely exceeds -30 dBFS in
      // the low bins, which used to slam those bytes to 255 every frame.
      analyserRef.current.minDecibels = -82;
      analyserRef.current.maxDecibels = -14;

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

      // The Lathe: always-in-circuit bench between the warmth shelf and the
      // AMP gain. BYPASS ramps every stage to neutral instead of
      // reconnecting (the graph is built once; reconnects pop). All meters
      // tap post-ampGain, so the cut reads on every instrument for free.
      const subShelf = context.createBiquadFilter();
      subShelf.type = "lowshelf";
      subShelf.frequency.value = 60;
      const bassShelf = context.createBiquadFilter();
      bassShelf.type = "lowshelf";
      bassShelf.frequency.value = 150;
      const midPeak = context.createBiquadFilter();
      midPeak.type = "peaking";
      midPeak.frequency.value = 1000;
      midPeak.Q.value = 0.9;
      const trebleShelf = context.createBiquadFilter();
      trebleShelf.type = "highshelf";
      trebleShelf.frequency.value = 5500;

      // WIDTH via mid/side: force stereo before the splitter so mono
      // sources upmix (otherwise side = L/2 and the right channel dies).
      const widthIn = context.createGain();
      widthIn.channelCount = 2;
      widthIn.channelCountMode = "explicit";
      const msSplit = context.createChannelSplitter(2);
      const msMid = context.createGain();
      msMid.gain.value = 0.5;
      const msInvR = context.createGain();
      msInvR.gain.value = -1;
      const msSide = context.createGain();
      msSide.gain.value = 0.5;
      const msSideLevel = context.createGain();
      msSideLevel.gain.value = 1;
      const msInvSide = context.createGain();
      msInvSide.gain.value = -1;
      const msMerge = context.createChannelMerger(2);

      // DRIVE: tanh soft-clip on a wet path; postTrim restores unity
      // small-signal gain so drive changes texture, not loudness.
      const driveIn = context.createGain();
      const dryGain = context.createGain();
      dryGain.gain.value = 1;
      const shaper = context.createWaveShaper();
      const curve = new Float32Array(1024);

      for (let index = 0; index < curve.length; index += 1) {
        const x = (index / (curve.length - 1)) * 2 - 1;
        curve[index] = Math.tanh(2.2 * x) / Math.tanh(2.2);
      }

      shaper.curve = curve;
      shaper.oversample = "2x";
      const postTrim = context.createGain();
      postTrim.gain.value = Math.tanh(2.2) / 2.2;
      const wetGain = context.createGain();
      wetGain.gain.value = 0;
      const benchOut = context.createGain();

      // EQ ladder.
      toneShelf.connect(subShelf);
      subShelf.connect(bassShelf);
      bassShelf.connect(midPeak);
      midPeak.connect(trebleShelf);
      trebleShelf.connect(widthIn);

      // M/S matrix: mid = (L+R)/2 to both channels; side = (L-R)/2 scaled
      // by WIDTH, added to L and subtracted from R.
      widthIn.connect(msSplit);
      msSplit.connect(msMid, 0);
      msSplit.connect(msMid, 1);
      msMid.connect(msMerge, 0, 0);
      msMid.connect(msMerge, 0, 1);
      msSplit.connect(msSide, 0);
      msSplit.connect(msInvR, 1);
      msInvR.connect(msSide);
      msSide.connect(msSideLevel);
      msSideLevel.connect(msMerge, 0, 0);
      msSideLevel.connect(msInvSide);
      msInvSide.connect(msMerge, 0, 1);

      // Drive wet/dry into the bench output.
      msMerge.connect(driveIn);
      driveIn.connect(dryGain);
      dryGain.connect(benchOut);
      driveIn.connect(shaper);
      shaper.connect(postTrim);
      postTrim.connect(wetGain);
      wetGain.connect(benchOut);

      toneNodesRef.current = { subShelf, bassShelf, midPeak, trebleShelf, msSideLevel, dryGain, wetGain };

      // source → toneShelf → [bench] → ampGain → analyser → destination
      sourceRef.current.connect(toneShelf);
      benchOut.connect(ampGain);
      ampGain.connect(analyserRef.current);
      analyserRef.current.connect(context.destination);

      // First play picks up an archived cut with no audible ramp.
      applyToneSettings(toneApplyRef.current, true);

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

    const wasStopped = audio.paused;
    const resumePosition = audio.currentTime;
    await ensureAudioGraph().catch(() => undefined);

    try {
      await audio.play();
      setIsPlaying(true);

      // C5: a standing start (including a fresh cartridge) spools the motor.
      if (wasStopped && !reducedMotion) {
        spoolStartRef.current = performance.now();

        // Play grammar: resuming mid-tape gets a short re-lock — the frozen
        // trace snaps back into alignment. Fresh cartridges get the full
        // sequence from the track-change effect instead.
        if (resumePosition > 0.1) {
          signalLockRef.current = { startedAt: performance.now(), duration: 300 };
        }
      }

      startVisualizerFrame();
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : "Playback error";
      setIsPlaying(false);
      setImportStatus(`${errorName} - click Play`);
      // importStatus only surfaces as a hover tooltip — the teletype line is
      // the visible fault channel.
      flashSystemMessage(`SIGNAL FAULT · ${errorName.toUpperCase()}`, 1600);
      playScopeTear();
      return;
    }
  }

  // File-error grammar: the waveform tears — segmented offsets and dropped
  // samples that decay back to the baseline over ~340ms.
  function playScopeTear() {
    if (reducedMotion) {
      return;
    }

    const startedAt = performance.now();
    const wave = new Uint8Array(1024);

    const frame = () => {
      const progress = (performance.now() - startedAt) / 340;

      if (progress >= 1) {
        drawScopeTrace(null, 0, 0);
        return;
      }

      const settle = 1 - progress;
      let sliceOffset = 0;

      for (let index = 0; index < wave.length; index += 1) {
        if (index % 96 === 0 && Math.random() < 0.7) {
          sliceOffset = (Math.random() - 0.5) * 150 * settle;
        }

        const dropped = Math.random() < 0.05 * settle;
        const base = Math.sin((index / wave.length) * Math.PI * 7) * 26 * settle;
        wave[index] = dropped ? 128 : Math.max(0, Math.min(255, Math.round(128 + base + sliceOffset)));
      }

      drawScopeTrace(wave, 0.5 * settle, 1, 0);
      window.requestAnimationFrame(frame);
    };

    window.requestAnimationFrame(frame);
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

  function toggleFavorite(trackId: string) {
    setTracks((existing) =>
      existing.map((track) => (track.id === trackId ? { ...track, favorite: !track.favorite } : track))
    );
  }

  // Row action: force a fresh fingerprint pass for one cartridge. The bumped
  // revision re-kicks the tracing queue, whose progress drives the scanner.
  function retraceTrack(track: Track) {
    spinesRef.current.delete(track.id);
    spineFailedRef.current.delete(track.id);
    spineImagesRef.current.delete(track.id);
    pressingsRef.current.delete(track.id);
    heroTexturesRef.current.delete(track.id);
    setSpineRevision((revision) => revision + 1);
    flashSystemMessage(`RETRACING · ${track.title.toUpperCase()}`, 900);
  }

  // Row action: re-strike the generated pressing/plate from the current
  // trace (artless tracks only — real covers never get overwritten).
  function restrikePressing(track: Track) {
    pressingsRef.current.delete(track.id);
    heroTexturesRef.current.delete(track.id);
    spineImagesRef.current.delete(track.id);
    setSpineRevision((revision) => revision + 1);
    flashSystemMessage("PRESSING RE-STRUCK", 900);
  }

  function cueTrackNext(track: Track) {
    setPlayNextId(track.id);
    flashSystemMessage(`CUED NEXT · ${track.title.toUpperCase()}`, 1100);
  }

  function setShelfSizeAndReport(next: ShelfSize) {
    setShelfSize(next);
    flashSystemMessage(`SHELF ${next.toUpperCase()}`, 700);
  }

  function cycleShelfSize() {
    const nextIndex = (shelfSizeOrder.indexOf(shelfSize) + 1) % shelfSizeOrder.length;
    setShelfSizeAndReport(shelfSizeOrder[nextIndex]);
  }

  // Drag-resize: live deltas preview the resize, release snaps to the
  // nearest of the three states. Deltas are divided by the console scale so
  // the handle tracks the cursor on a scaled stage.
  function onShelfHandlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    shelfDragRef.current = { startY: event.clientY, pointerId: event.pointerId, moved: false };
    deckRef.current?.classList.add("is-shelf-dragging");
  }

  function onShelfHandlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = shelfDragRef.current;
    const deck = deckRef.current;

    if (!drag || !deck) {
      return;
    }

    const delta = (event.clientY - drag.startY) / Math.max(0.2, consoleScale);

    if (Math.abs(delta) > 4) {
      drag.moved = true;
    }

    // Dragging up grows the shelf (hero shrinks); dragging down shrinks the
    // shelf toward the collapsed single-row state.
    const heroBase = shelfSize === "expanded" ? 96 : 264;
    deck.style.setProperty("--hero-h", `${Math.round(Math.min(264, Math.max(96, heroBase + delta)))}px`);
    deck.style.setProperty(
      "--shelf-cap",
      delta > 0 && shelfSize !== "expanded" ? `${Math.round(Math.max(46, 260 - delta))}px` : "none"
    );
  }

  function onShelfHandlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = shelfDragRef.current;
    const deck = deckRef.current;
    shelfDragRef.current = null;

    if (deck) {
      deck.classList.remove("is-shelf-dragging");
      deck.style.removeProperty("--hero-h");
      deck.style.removeProperty("--shelf-cap");
    }

    if (!drag) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }

    const delta = (event.clientY - drag.startY) / Math.max(0.2, consoleScale);

    if (!drag.moved) {
      // A plain click on the handle cycles states.
      cycleShelfSize();
      return;
    }

    const currentIndex = shelfSizeOrder.indexOf(shelfSize);
    const shift = delta < -140 ? 2 : delta < -55 ? 1 : delta > 140 ? -2 : delta > 55 ? -1 : 0;
    const nextIndex = Math.max(0, Math.min(shelfSizeOrder.length - 1, currentIndex + shift));

    if (nextIndex !== currentIndex) {
      setShelfSizeAndReport(shelfSizeOrder[nextIndex]);
    }
  }

  function onShelfHandleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = shelfSizeOrder.indexOf(shelfSize);

    if (event.key === "ArrowUp" && currentIndex < shelfSizeOrder.length - 1) {
      event.preventDefault();
      setShelfSizeAndReport(shelfSizeOrder[currentIndex + 1]);
    } else if (event.key === "ArrowDown" && currentIndex > 0) {
      event.preventDefault();
      setShelfSizeAndReport(shelfSizeOrder[currentIndex - 1]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      cycleShelfSize();
    }
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
      sessionRef.current.plays += 1;
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
      stopVisualizerFrame("freeze");
      setIsPlaying(false);
    } else if (fallbackTrack?.url || currentTrack?.url) {
      playTrack(fallbackTrack?.id ?? currentTrack?.id);
    } else {
      setIsPlaying(true);
      startAudioPlayback();
    }
  }

  // Skip grammar: mark the transition as a tape wind so the scope smears past
  // instead of re-running the full signal-lock sequence.
  function markTapeWind() {
    if (reducedMotion || !isPlaying) {
      return;
    }

    tapeWindRef.current = { startedAt: performance.now() };
    skipWindRef.current = true;
  }

  function nextTrack(autoAdvance = false) {
    // A cued PLAY NEXT wins over queue order, once.
    if (playNextId) {
      const cued = tracks.find((track) => track.id === playNextId);
      setPlayNextId("");

      if (cued && isLocalPlaybackUrl(cued.url)) {
        if (!autoAdvance) {
          markTapeWind();
        }

        playTrack(cued.id);
        return;
      }
    }

    if (playbackQueue.length === 0) {
      return;
    }

    const queueIndex = playbackQueue.findIndex((track) => track.id === currentTrack?.id);
    const nextIndex = queueIndex < 0 ? 0 : (queueIndex + 1) % playbackQueue.length;

    // A natural end-of-track advance re-locks like a fresh cartridge; only a
    // deliberate skip winds the tape. A single-track queue wraps onto itself:
    // no track change, so don't arm the wind flag (it would leak and
    // suppress the next real cartridge swap's lock sequence).
    if (!autoAdvance && playbackQueue[nextIndex].id !== currentTrack?.id) {
      markTapeWind();
    }

    playTrack(playbackQueue[nextIndex].id);
  }

  function previousTrack() {
    if (playbackQueue.length === 0) {
      return;
    }

    const queueIndex = playbackQueue.findIndex((track) => track.id === currentTrack?.id);
    const previousIndex = queueIndex <= 0 ? playbackQueue.length - 1 : queueIndex - 1;

    if (playbackQueue[previousIndex].id !== currentTrack?.id) {
      markTapeWind();
    }

    playTrack(playbackQueue[previousIndex].id);
  }

  // B6 repeat: ONE re-arms the same cartridge, ALL wraps the queue (stock
  // behavior), OFF lets the deck stop at the end of the shelf.
  function onTrackEnded() {
    // A cued PLAY NEXT wins over repeat-one and end-of-shelf: the user
    // explicitly asked for that cartridge next, so never strand it as a
    // stuck CUED row.
    if (playNextId && tracks.some((track) => track.id === playNextId && isLocalPlaybackUrl(track.url))) {
      nextTrack(true);
      return;
    }

    if (repeatMode === "one" && audioRef.current) {
      // Repeat grammar: the progress line visibly loops back through the
      // machine — paintSeekSpine sweeps a highlight right-to-left.
      if (!reducedMotion) {
        seekLoopRef.current = performance.now();
      }

      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      startAudioPlayback();
      return;
    }

    if (repeatMode === "off") {
      const queueIndex = playbackQueue.findIndex((track) => track.id === currentTrack?.id);

      if (queueIndex >= 0 && queueIndex === playbackQueue.length - 1) {
        setIsPlaying(false);
        stopVisualizerFrame("freeze");
        flashSystemMessage("END OF SHELF", 1200);
        return;
      }
    }

    nextTrack(true);
  }

  function cycleRepeatMode() {
    const nextMode: RepeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
    setRepeatMode(nextMode);
    flashSystemMessage(`REPEAT ${nextMode.toUpperCase()}`, 760);
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
      // Never shadow browser/OS chords (Cmd+F find, Cmd+K, Alt+Arrow…).
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target instanceof HTMLElement ? event.target : null;
      const targetInput = target instanceof HTMLInputElement ? target : null;
      // Only text-entry surfaces swallow shortcuts. Sliders and knobs are
      // INPUTs too, but SPACE/J/K/F should keep working with one focused;
      // their own arrow handling stops propagation where it must win.
      const isTyping =
        (targetInput && !["range", "button", "checkbox", "radio"].includes(targetInput.type)) ||
        target?.tagName === "TEXTAREA" ||
        target?.getAttribute("contenteditable") === "true";

      if (isTyping) {
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShowKeyLegend((visible) => !visible);
        return;
      }

      if (event.key === "Escape" && showKeyLegend) {
        event.preventDefault();
        setShowKeyLegend(false);
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
        // A focused slider (seek bar) owns its own arrow keys natively —
        // seeking on top of that would double-step.
        if (targetInput?.type === "range") {
          return;
        }

        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;

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
    navigator.mediaSession.setActionHandler("seekbackward", () => seekBy(-10));
    navigator.mediaSession.setActionHandler("seekforward", () => seekBy(10));

    try {
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime == null || !audioRef.current) {
          return;
        }

        audioRef.current.currentTime = details.seekTime;
        setCurrentTime(details.seekTime);
      });
    } catch {
      // Older engines without seekto support.
    }

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  });

  // B5: hold a host power-save blocker only while audio actually plays, so
  // long sessions survive display sleep without ever blocking it at idle.
  useEffect(() => {
    window.musicHost?.setPlaybackActive?.(isPlaying)?.catch?.(() => undefined);

    return () => {
      if (isPlaying) {
        window.musicHost?.setPlaybackActive?.(false)?.catch?.(() => undefined);
      }
    };
  }, [isPlaying]);

  // Keep the OS Now Playing widget's scrubber in sync.
  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setPositionState !== "function") {
      return;
    }

    try {
      if (!currentTrack || !Number.isFinite(playbackDuration) || playbackDuration <= 0) {
        navigator.mediaSession.setPositionState();
        return;
      }

      navigator.mediaSession.setPositionState({
        duration: playbackDuration,
        playbackRate: audioRef.current?.playbackRate ?? 1,
        position: Math.min(currentTime, playbackDuration)
      });
    } catch {
      // Position state is best-effort.
    }
  }, [currentTime, currentTrack, playbackDuration]);

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
    stopVisualizerFrame("freeze");
    setIsPlaying(false);
  }

  const appClasses = [
    "app-shell",
    reducedMotion ? "reduced-motion" : "",
    `interference-${interference}`,
    isDragActive ? "is-dragging" : "",
    microGlitch ? "is-microglitching" : "",
    microGlitch ? `micro-${microGlitch}` : "",
    isRelocking ? "is-relocking" : "",
    seekPulse ? "is-seeking" : "",
    attract ? "is-attract" : "",
    isFindSweeping ? "is-findsweep" : "",
    volume > 0.78 ? "is-hot" : "",
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
        // CORS mode keeps the Web Audio graph untainted when media arrives
        // cross-origin (cody-app:// page + cody-media:// audio in the
        // packaged shell). Without it the element plays but every analyser
        // reads zeros. Harmless for blob: and same-origin sources.
        crossOrigin="anonymous"
        onPlay={onAudioPlay}
        onPause={onAudioPause}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={() => {
          const time = audioRef.current?.currentTime ?? 0;
          registerPlayProgress(time);

          // Smoothness: every canvas reads the element clock directly at
          // 60fps; React only re-renders when the printed second changes.
          if (Math.floor(time) !== Math.floor(currentTime)) {
            setCurrentTime(time);
          }
        }}
        onEnded={onTrackEnded}
        onError={() => {
          // Mid-playback media faults (file deleted, decode failure) never
          // hit startAudioPlayback's catch — surface them the same way.
          const mediaError = audioRef.current?.error;

          if (!mediaError) {
            return;
          }

          const label =
            mediaError.code === MediaError.MEDIA_ERR_DECODE
              ? "DECODE FAULT"
              : mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                ? "UNREADABLE SIGNAL"
                : mediaError.code === MediaError.MEDIA_ERR_NETWORK
                  ? "SIGNAL DROPOUT"
                  : "MEDIA FAULT";
          setIsPlaying(false);
          setImportStatus(`${label} - click Play`);
          flashSystemMessage(`SIGNAL FAULT · ${label}`, 1600);
          playScopeTear();
        }}
      />

      <section className={`console-screen ${isDegaussing ? "is-degauss" : ""}`} aria-label="Cody Cartridge player">
        <header className="screen-header">
          <div className="screen-title">
            <span className="eyebrow">Cody Noir</span>
            <h1 className="sr-only">{currentTrack?.title ?? "No cartridge inserted"}</h1>
            <p>{currentTrack ? "Cover signal" : "No track loaded"}</p>
            <div className="system-header-line" title={diagnosticsTitle}>
              <span className="import-status">
                {"CODY NOIR // LOCAL INDEX · "}
                {/* C12: counters roll like split-flap digits when they change. */}
                <span className="stat-roll" key={`files-${tracks.length}`}>
                  {tracks.length.toString().padStart(2, "0")} FILES
                </span>
                {" · "}
                <span className="stat-roll" key={`matched-${ytMatchCount}`}>
                  {ytMatchCount.toString().padStart(2, "0")} MATCHED
                </span>
                {" · "}
                <span className="stat-roll" key={`gaps-${tagIssueCount}`}>
                  {tagIssueCount.toString().padStart(2, "0")} TAG GAPS
                </span>
                {" · "}
                {activeShelfLabel.toUpperCase()}
              </span>
              <span
                className={`system-message ${isPlaying ? "live" : hasTagGap(currentTrack) ? "warn" : ""} ${
                  printedSystemMessage.length < systemMessage.length ? "is-printing" : ""
                }`}
              >
                {printedSystemMessage}
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

        {/* Item 14: interference visual layer — grain/scanlines/chromatic
            fringe/tears scale with the mode; decorative only, never text. */}
        <span className="interference-veil" aria-hidden="true" />

        <div ref={deckRef} className={`deck ${heroDocked ? "hero-docked" : ""} shelf-${shelfSize}`}>
          <section className="deck-hero" aria-label="Now playing">
            <button
              type="button"
              className="hero-dock-toggle"
              aria-pressed={heroDocked}
              title={heroDocked ? "Show the scope" : "Dock the scope for more shelf rows"}
              onClick={() => {
                setHeroDocked((docked) => !docked);
                flashSystemMessage(heroDocked ? "SCOPE RAISED" : "SCOPE DOCKED", 760);
              }}
            >
              {heroDocked ? "▴ SCOPE" : "▾ DOCK"}
            </button>
            {heroDocked || shelfSize === "expanded" ? (
              <div className="hero-mini" aria-live="polite">
                <span className="hero-mini-index">
                  {currentTrackNumber ? currentTrackNumber.toString().padStart(2, "0") : "--"}
                </span>
                <strong className="hero-mini-title">{currentTrack?.title ?? "NO FILE"}</strong>
                <span className="hero-mini-artist">{currentTrack?.artist ?? "No active artist"}</span>
                <span className="hero-mini-quality">{currentQualityLine}</span>
              </div>
            ) : null}
            <div
              className={`cartridge-art ${isPlaying || storePosterMode ? "powered" : ""} ${currentTrack ? "has-track" : "is-empty"} ${
                cartridgeSwap ? `is-${cartridgeSwap}` : ""
              }`}
              data-wear={currentWearTier > 0 ? currentWearTier : undefined}
              aria-label={currentTrack ? `Signal map for ${currentTrack.title} by ${currentTrack.artist}` : "Empty signal map"}
            >
              <div className="signal-map signal-scope-only" aria-hidden="true">
                {/* The pilot light: crimson smoke curls in the glass whenever
                    the deck idles — dim beneath the structure map while a
                    cartridge is paused, full-strength in an empty tube. The
                    scope canvas blends screen, so its black field lets the
                    smoke show through. */}
                {(!currentTrack || !isPlaying) && !bootMode && !reducedMotion ? (
                  <span className={`tube-smoke ${currentTrack ? "is-pilot" : ""}`}>
                    <SmokeRing
                      colorBack="#00000000"
                      colors={["#8b111b", "#41100f", "#d8c79b"]}
                      noiseScale={1.6}
                      thickness={0.55}
                      radius={0.42}
                      speed={0.35}
                      style={{ width: "100%", height: "100%" }}
                    />
                  </span>
                ) : null}
                {heroBackdropUrl ? (
                  <span className="hero-backdrop" style={{ backgroundImage: `url(${heroBackdropUrl})` }} />
                ) : heroTextureUrl ? (
                  <span className="hero-texture" style={{ backgroundImage: `url(${heroTextureUrl})` }} />
                ) : null}
                <span className="signal-vignette" />
                <canvas ref={scopeCanvasRef} className="signal-scope" />
                {attract && burnGhostTitle ? <span className="burn-ghost">{burnGhostTitle}</span> : null}
                <span className="signal-frame signal-frame-bezel" />
                {shuttle ? (
                  <span className="shuttle-indicator">
                    {shuttle.dir > 0 ? "▶▶ CUE" : "◀◀ REW"} ×{shuttle.rate}
                  </span>
                ) : null}
              </div>

              <div className="hero-overlay" aria-live="polite">
                <div className="hero-np">
                  <span className="module-label">
                    NOW PLAYING
                    {currentTrack ? (
                      <button
                        type="button"
                        className={`fav-toggle hero-fav ${currentTrack.favorite ? "is-fav" : ""}`}
                        aria-pressed={currentTrack.favorite}
                        aria-label={
                          currentTrack.favorite
                            ? `Remove ${currentTrack.title} from Crowned`
                            : `Add ${currentTrack.title} to Crowned`
                        }
                        title={currentTrack.favorite ? "Remove from Crowned shelf" : "Add to Crowned shelf"}
                        onClick={() => toggleFavorite(currentTrack.id)}
                      >
                        {currentTrack.favorite ? "♥" : "♡"}
                      </button>
                    ) : null}
                  </span>
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
              <span className="stage-elapsed">
                {formatTime(playbackDuration > 0 ? Math.min(currentTime, playbackDuration) : currentTime)}
              </span>
              {seekPulse ? <span className="seek-pulse">{seekPulse}</span> : null}
              <div
                className={`seek-spine ${currentSpineAvailable ? "has-spine" : ""} ${
                  isTracingCurrentTrack ? "is-tracing" : ""
                }`}
              >
                <canvas ref={seekSpineCanvasRef} className="seek-spine-canvas" aria-hidden="true" />
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
              </div>
              <span>{formatTime(duration || currentTrack?.duration || 0)}</span>
            </div>

            <div
              className="file-inspector deck-inspector"
              ref={fileInspectorRef}
              tabIndex={-1}
              aria-label="Selected local file inspection"
            >
              {isTakeoutMatched(currentTrack) ? <span className="match-stamp">MATCHED</span> : null}
              <span className="inspector-source">
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
                <span className="artifact-label">TRACE</span>{" "}
                {currentSpine && currentSpineStats
                  ? `ARCHIVED · ${currentSpine.bpm > 0 ? `${currentSpine.bpm}BPM · ` : ""}${
                      currentSpine.key >= 0
                        ? `KEY ${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][currentSpine.key]} · `
                        : ""
                    }DR ${currentSpineStats.dynamicRangeDb.toFixed(0)}dB · PEAK ${Math.round(
                      currentSpineStats.peakAt * 100
                    )}%`
                  : isTracingCurrentTrack
                    ? "TRACING..."
                    : currentTrack
                      ? "NO TRACE"
                      : "no file"}
              </span>
              <span>
                <span className="artifact-label">CUT</span>{" "}
                {currentTrack ? (benchBypass ? "BYPASSED" : formatCutSummary(currentTone)) : "no file"}
              </span>
              <span>
                <span className="artifact-label">ERRORS</span> {currentTagErrors}
              </span>
            </div>
          </section>

          <section className={`deck-catalog ${denseRows ? "rows-compact" : ""}`} aria-label="Local tracks">
            <button
              type="button"
              className="shelf-resize-handle"
              aria-label={`Resize shelf. Current: ${shelfSize}. Drag, click to cycle, or use arrow keys`}
              title={`Shelf: ${shelfSize.toUpperCase()} — drag or click to resize`}
              onPointerDown={onShelfHandlePointerDown}
              onPointerMove={onShelfHandlePointerMove}
              onPointerUp={onShelfHandlePointerUp}
              onPointerCancel={onShelfHandlePointerUp}
              onKeyDown={onShelfHandleKeyDown}
            >
              <span aria-hidden="true">▔▔▔</span>
            </button>

            <div className="metadata-panel" aria-label="Track metadata">
              <div className="shelf-bar">
                <div className="shelf-id" title={diagnosticsTitle}>
                  <span className="eyebrow">Shelf</span>
                  <span className="shelf-id-line">
                    <h2>{activeShelfLabel}</h2>
                    <span className="shelf-count">
                      {query
                        ? `${filteredCards.length.toString().padStart(2, "0")}/${shelfCards.length
                            .toString()
                            .padStart(2, "0")}`
                        : shelfCards.length.toString().padStart(2, "0")}{" "}
                      FILES
                    </span>
                  </span>
                </div>
                {shelfTabs.length > 1 ? (
                  <div className="shelf-tabs" aria-label="Shelf views">
                    {shelfTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={activeShelf === tab.id ? "active" : ""}
                        aria-pressed={activeShelf === tab.id}
                        onClick={() => {
                          if (activeShelf === tab.id) {
                            return;
                          }

                          setActiveShelf(tab.id);
                          triggerDegauss();
                          flashSystemMessage(`SHELF ${tab.label}`, 760);
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <label className="catalog-search">
                  <span>FIND</span>
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="FIND / filter... artist:che missing:cover cut:yes"
                    title="Try artist:che, missing:cover, match:<80, type:flac, fav:yes, tag:gap, or cut:yes"
                    aria-label="Filter catalog"
                  />
                  {query ? (
                    <button
                      type="button"
                      className="find-clear"
                      aria-label="Clear filter"
                      title="Clear filter"
                      onClick={() => setQuery("")}
                    >
                      ✕
                    </button>
                  ) : null}
                </label>
                <div className="catalog-tools">
                  <span className="nav-hint" aria-hidden="true">J/K</span>
                  <button
                    type="button"
                    className={`density-toggle ${denseRows ? "active" : ""}`}
                    aria-pressed={denseRows}
                    title={denseRows ? "Switch to roomy rows" : "Switch to compact rows"}
                    onClick={() => {
                      setDenseRows((dense) => !dense);
                      flashSystemMessage(denseRows ? "SHELF ROOMY" : "SHELF DENSE", 760);
                    }}
                  >
                    DENSE
                  </button>
                </div>
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
                {filteredCards.length === 0 ? (
                  tracks.length === 0 && takeoutSongs.length === 0 ? (
                    <div className="no-cartridge">
                      <CartridgeCube />
                      <span className="no-cartridge-title">NO CARTRIDGE</span>
                      <span className="no-cartridge-sub">INSERT MEDIA // IMPORT LOCAL AUDIO FILES</span>
                      <div className="no-cartridge-actions">
                        <button type="button" onClick={importAudioFiles}>
                          IMPORT FILES
                        </button>
                        <button type="button" onClick={importAudioFolder}>
                          IMPORT FOLDER
                        </button>
                      </div>
                      <span className="no-cartridge-hint">or drop audio files anywhere on the deck</span>
                    </div>
                  ) : (
                    <div className="no-cartridge no-trace-match">
                      <CartridgeCube compact />
                      <span className="no-cartridge-title">NO TRACE MATCHES FIND</span>
                      <div className="no-cartridge-actions">
                        <button type="button" onClick={() => setQuery("")}>
                          CLEAR FIND
                        </button>
                      </div>
                    </div>
                  )
                ) : null}
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
                  const rowSpineImage = track ? getSpineRowImage(track) : undefined;
                  const rowPressing = !rowHasCover && track ? getPressing(track) : undefined;
                  // Item 3: the playing track's identity moves at its own
                  // tempo — radial pulses for energetic program, slow liquid
                  // drift for ambient.
                  const rowIdentity = (() => {
                    if (!isActiveRow || !isPlaying || !track || reducedMotion) {
                      return undefined;
                    }

                    const rowSpine = getTrackSpine(track);
                    return rowSpine && rowSpine.bpm > 0 ? spineIdentity(rowSpine) : undefined;
                  })();
                  // Item 4: scanner state comes from the REAL tracing queue —
                  // no fake background scans.
                  const isRowScanning = Boolean(track) && tracing?.trackId === track?.id;
                  const isRowLockFlash = Boolean(track) && lockFlashId === track?.id;
                  const rowHasNoLock = Boolean(track && spineFailedRef.current.has(track.id));

                  return (
                    <div
                      className={`metadata-row ${isActiveRow ? "active" : ""} ${
                        card.kind === "missing" ? "missing" : ""
                      } ${isRowScanning ? "is-scanning" : ""} ${isRowLockFlash ? "is-lock-flash" : ""}`}
                      key={`metadata-${card.id}`}
                      role={track ? "button" : undefined}
                      tabIndex={track ? 0 : undefined}
                      title={fullDetail}
                      style={{ "--row-i": Math.min(index, 16) } as CSSProperties}
                      onClick={() => track && setCurrentId(track.id)}
                      onDoubleClick={() => track && playTrack(track.id)}
                      onKeyDown={(event) => {
                        // Favorite toggles and row actions handle their own keys.
                        if (
                          event.target instanceof HTMLElement &&
                          event.target.closest(".fav-toggle, .row-actions")
                        ) {
                          return;
                        }

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
                        // The row owns this press: without stopPropagation
                        // the global SPACE handler also fires togglePlayback,
                        // pausing the track this handler just started.
                        event.stopPropagation();
                        playTrack(track.id);
                      }}
                    >
                      {rowSpineImage ? (
                        <img
                          className="metadata-row-spine"
                          src={rowSpineImage}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                        />
                      ) : null}
                      {rowSpineImage && isActiveRow && isPlaying ? (
                        // The playing row's waveform illuminates left-to-right
                        // with playback progress (clip driven by the shell's
                        // --playback-progress var).
                        <img
                          className="metadata-row-spine metadata-row-spine-lit"
                          src={rowSpineImage}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                        />
                      ) : null}
                      <span className="metadata-index">
                        {String(index + 1).padStart(2, "0")}
                        <span className="metadata-play-marker">{isActiveRow && isPlaying ? "▶" : isActiveRow ? "//" : ""}</span>
                      </span>
                      <span
                        className={`metadata-cover ${rowHasCover ? "has-cover" : "generated-cover"} ${
                          card.kind === "missing" ? "is-missing" : ""
                        } ${rowIdentity ? `identity-live identity-${rowIdentity.energetic ? "pulse" : "liquid"}` : ""}`}
                        style={
                          {
                            ...albumGraphicStyle(rowArtSource, index),
                            ...(rowIdentity ? { "--pulse-period": `${(60 / rowIdentity.bpm).toFixed(3)}s` } : {})
                          } as CSSProperties
                        }
                        aria-hidden="true"
                      >
                        {rowHasCover ? (
                          <img className="metadata-cover-img" src={track?.artworkUrl} alt="" draggable={false} />
                        ) : rowPressing ? (
                          <img
                            className="metadata-cover-img metadata-cover-pressing"
                            src={rowPressing}
                            alt=""
                            draggable={false}
                          />
                        ) : (
                          <span className="metadata-cover-bands" />
                        )}
                      </span>
                      <span className="metadata-title">
                        {track ? (
                          <button
                            type="button"
                            className={`fav-toggle ${track.favorite ? "is-fav" : ""}`}
                            aria-pressed={track.favorite}
                            aria-label={track.favorite ? `Remove ${title} from Crowned` : `Add ${title} to Crowned`}
                            title={track.favorite ? "Remove from Crowned shelf" : "Add to Crowned shelf"}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFavorite(track.id);
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            {track.favorite ? "♥" : "♡"}
                          </button>
                        ) : null}
                        <strong data-scramble={scrambleLabel(title, `${card.id}-${index}`)}>{title}</strong>
                      </span>
                      <span className="metadata-artist">{artist}</span>
                      <span className="metadata-album">{album}</span>
                      <span className="metadata-time">{track ? formatTime(track.duration) : "--:--"}</span>
                      <span className="metadata-quality" title={fullDetail}>
                        <span>
                          {qualityLine}
                          {track && cutIds.has(track.id) ? (
                            <span className="cut-stamp" title="This cartridge carries an archived Lathe cut">
                              CUT
                            </span>
                          ) : null}
                        </span>
                        <small>
                          {track
                            ? `${formatFileSize(track.size)} · ${sourceDetail}`
                            : missingSong?.videoId
                              ? `yt ${missingSong.videoId}`
                              : "takeout row"}
                        </small>
                      </span>
                      <span className="metadata-status-chips">
                        {isRowScanning ? (
                          <span className="status-chip scanning">SCANNING</span>
                        ) : isRowLockFlash ? (
                          <span className="status-chip trace-locked">TRACE LOCKED</span>
                        ) : (
                          <>
                            {rowHasNoLock ? (
                              <span className="status-chip alert no-lock" title="Trace failed — RETRACE to retry">
                                NO LOCK
                              </span>
                            ) : null}
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
                          </>
                        )}
                      </span>
                      {track ? (
                        <span
                          className="row-actions"
                          aria-label={`Actions for ${title}`}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className={`row-action ${playNextId === track.id ? "engaged" : ""}`}
                            aria-label={`Play ${title} next`}
                            title="Cue this cartridge to play next"
                            onClick={() => cueTrackNext(track)}
                          >
                            {playNextId === track.id ? "CUED" : "PLAY NEXT"}
                          </button>
                          <button
                            type="button"
                            className="row-action"
                            aria-label={`Re-trace ${title}`}
                            title="Re-run the fingerprint trace"
                            disabled={isRowScanning}
                            onClick={() => retraceTrack(track)}
                          >
                            TRACE
                          </button>
                          <button
                            type="button"
                            className="row-action"
                            aria-label={`Re-strike pressing for ${title}`}
                            title={
                              track.artworkUrl
                                ? "Cover present — generated pressing not used"
                                : "Re-strike the generated pressing from the trace"
                            }
                            disabled={Boolean(track.artworkUrl)}
                            onClick={() => restrikePressing(track)}
                          >
                            RE-STRIKE
                          </button>
                          <button
                            type="button"
                            className="row-action"
                            aria-label={`Inspect tags for ${title}`}
                            title="Open the inspector (archive is read-only; tag writes need a writable backend)"
                            onClick={() => {
                              setCurrentId(track.id);
                              fileInspectorRef.current?.focus();
                              fileInspectorRef.current?.scrollIntoView({
                                behavior: reducedMotion ? "auto" : "smooth",
                                block: "nearest"
                              });
                            }}
                          >
                            INSPECT
                          </button>
                          <button
                            type="button"
                            className="row-action row-menu-btn"
                            aria-label={`More actions for ${title}`}
                            aria-haspopup="menu"
                            aria-expanded={rowMenuId === track.id}
                            title="More"
                            onClick={() => setRowMenuId(rowMenuId === track.id ? "" : track.id)}
                          >
                            ⋯
                          </button>
                          {rowMenuId === track.id ? (
                            <span className="row-menu-pop" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setQuery(`"${track.artist.toLowerCase()}"`);
                                  setRowMenuId("");
                                }}
                              >
                                FILTER ARTIST
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setQuery(`"${track.album.toLowerCase()}"`);
                                  setRowMenuId("");
                                }}
                              >
                                FILTER ALBUM
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  toggleFavorite(track.id);
                                  setRowMenuId("");
                                }}
                              >
                                {track.favorite ? "UNCROWN" : "CROWN"}
                              </button>
                            </span>
                          ) : null}
                        </span>
                      ) : null}
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
                  onClick={() => nextTrack()}
                >
                  <SkipForward size={24} />
                </button>
              </div>
              <div className="transport-pad">
                <span>{repeatMode === "off" ? "REPEAT" : `RPT ${repeatMode.toUpperCase()}`}</span>
                <button
                  className={`icon-button repeat-button ${repeatMode !== "off" ? "engaged" : ""}`}
                  type="button"
                  title={`Repeat: ${repeatMode}`}
                  aria-label={`Repeat mode: ${repeatMode}. Click to change`}
                  onClick={cycleRepeatMode}
                >
                  {repeatMode === "one" ? <Repeat1 size={22} /> : <Repeat size={22} />}
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
              <div
                className={`visualizer groove-lattice-wrap ${benchOpen ? "is-bench" : ""}`}
                {...(benchOpen
                  ? {}
                  : {
                      role: "img" as const,
                      "aria-label": "Groove lattice: live onsets measured against the song's beat grid",
                      title: "GROOVE LATTICE — live hits vs the archived beat grid; LOCK% reads tightness"
                    })}
              >
                <canvas ref={latticeCanvasRef} className="groove-lattice" aria-hidden="true" />
                <button
                  type="button"
                  className={`bench-toggle ${benchOpen ? "engaged" : ""}`}
                  aria-pressed={benchOpen}
                  title={benchOpen ? "Close the tone bench" : "Open The Lathe — per-cartridge tone bench"}
                  onClick={() => {
                    setBenchOpen((open) => !open);
                    flashSystemMessage(benchOpen ? "LATHE CLOSED" : "LATHE OPEN", 760);
                  }}
                >
                  {benchOpen ? "▾ LATTICE" : "▴ TUNE"}
                </button>
                {benchOpen ? (
                  <div className="lathe-bench" role="group" aria-label="The Lathe — tone bench">
                    <Knob
                      size="bench"
                      bipolar
                      label="SUB"
                      ariaLabel="Sub shelf gain"
                      value={currentTone.sub / 24 + 0.5}
                      defaultValue={0.5}
                      format={(next) => `${(next - 0.5) * 24 >= 0 ? "+" : ""}${Math.round((next - 0.5) * 24)}dB`}
                      disabled={!currentTrack}
                      onChange={(next) => updateTone({ sub: (next - 0.5) * 24 })}
                    />
                    <Knob
                      size="bench"
                      bipolar
                      label="BASS"
                      ariaLabel="Bass shelf gain"
                      value={currentTone.bass / 24 + 0.5}
                      defaultValue={0.5}
                      format={(next) => `${(next - 0.5) * 24 >= 0 ? "+" : ""}${Math.round((next - 0.5) * 24)}dB`}
                      disabled={!currentTrack}
                      onChange={(next) => updateTone({ bass: (next - 0.5) * 24 })}
                    />
                    <Knob
                      size="bench"
                      bipolar
                      label="MID"
                      ariaLabel="Mid peak gain"
                      value={currentTone.mid / 20 + 0.5}
                      defaultValue={0.5}
                      format={(next) => `${(next - 0.5) * 20 >= 0 ? "+" : ""}${Math.round((next - 0.5) * 20)}dB`}
                      disabled={!currentTrack}
                      onChange={(next) => updateTone({ mid: (next - 0.5) * 20 })}
                    />
                    <Knob
                      size="bench"
                      bipolar
                      label="TREBLE"
                      ariaLabel="Treble shelf gain"
                      value={currentTone.treble / 24 + 0.5}
                      defaultValue={0.5}
                      format={(next) => `${(next - 0.5) * 24 >= 0 ? "+" : ""}${Math.round((next - 0.5) * 24)}dB`}
                      disabled={!currentTrack}
                      onChange={(next) => updateTone({ treble: (next - 0.5) * 24 })}
                    />
                    <Knob
                      size="bench"
                      bipolar
                      label="WIDTH"
                      ariaLabel="Stereo width"
                      value={currentTone.width / 1.6}
                      defaultValue={1 / 1.6}
                      format={(next) => `${Math.round(next * 160)}%`}
                      disabled={!currentTrack}
                      onChange={(next) => updateTone({ width: next * 1.6 })}
                    />
                    <Knob
                      size="bench"
                      label="DRIVE"
                      ariaLabel="Drive amount"
                      value={currentTone.drive}
                      defaultValue={0}
                      format={(next) => `${Math.round(next * 100)}%`}
                      disabled={!currentTrack}
                      onChange={(next) => updateTone({ drive: next })}
                    />
                    <Knob
                      size="bench"
                      bipolar
                      label="SPEED"
                      ariaLabel="Playback speed"
                      value={(currentTone.speed - 0.8) / 0.45}
                      defaultValue={(1 - 0.8) / 0.45}
                      format={(next) => `${(0.8 + next * 0.45).toFixed(2)}×`}
                      disabled={!currentTrack}
                      onChange={(next) => {
                        let rate = 0.8 + next * 0.45;

                        // Detent: snap onto stock speed.
                        if (Math.abs(rate - 1) < 0.01) {
                          rate = 1;
                        }

                        updateTone({ speed: rate });
                      }}
                    />
                    <div className="lathe-switches">
                      <button
                        type="button"
                        className={`lathe-switch ${benchBypass ? "engaged" : ""}`}
                        aria-pressed={benchBypass}
                        title="Bypass the cut (A/B against stock)"
                        onClick={() => {
                          setBenchBypass((bypass) => !bypass);
                          flashSystemMessage(benchBypass ? "LATHE ENGAGED" : "LATHE BYPASSED", 760);
                        }}
                      >
                        BYP
                      </button>
                      <button
                        type="button"
                        className="lathe-switch"
                        disabled={isFlatCut(toneByTrack[currentId])}
                        title="Reset this cartridge's cut to stock"
                        onClick={() => {
                          updateTone({ ...flatTone });
                          flashSystemMessage("CUT FLATTENED", 900);
                        }}
                      >
                        FLAT
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <VuMeter
                containerRef={vuMeterRef}
                mode={meterMode}
                onCycle={() => {
                  const nextMode = meterModeOrder[(meterModeOrder.indexOf(meterMode) + 1) % meterModeOrder.length];
                  setMeterMode(nextMode);
                  flashSystemMessage(`METER ${meterModeTitles[nextMode]}`, 760);
                }}
              />
            </div>

            <div className="key-hints" aria-hidden="true">
              <span>SPACE PLAY</span>
              <span>LEFT/RIGHT SEEK</span>
              <span>J/K TRACK</span>
              <span>F FIND</span>
              <span>I INSPECT</span>
              <span>? LEGEND</span>
            </div>
          </section>
        </div>

        {showKeyLegend ? (
          <div
            className="key-legend-overlay"
            role="dialog"
            aria-label="Keyboard controls"
            onClick={() => setShowKeyLegend(false)}
          >
            <div className="key-legend-panel" onClick={(event) => event.stopPropagation()}>
              <span className="key-legend-title">OPERATOR REFERENCE // FACEPLATE LEGEND</span>
              <div className="key-legend-grid">
                {[
                  ["SPACE", "PLAY / HOLD"],
                  ["← / →", "SEEK ±5S · HOLD = TAPE SHUTTLE"],
                  ["J / K", "PREVIOUS / NEXT CARTRIDGE"],
                  ["↑ / ↓", "MOVE SHELF SELECTION"],
                  ["ENTER", "PLAY SELECTED CARTRIDGE"],
                  ["F", "FOCUS FIND"],
                  ["I", "FOCUS INSPECTOR"],
                  ["?", "TOGGLE THIS LEGEND"],
                  ["ESC", "CLOSE LEGEND / SKIP BOOT"]
                ].map(([keys, action]) => (
                  <React.Fragment key={keys}>
                    <span className="key-legend-keys">{keys}</span>
                    <span className="key-legend-action">{action}</span>
                  </React.Fragment>
                ))}
              </div>
              <button type="button" className="key-legend-close" onClick={() => setShowKeyLegend(false)}>
                CLOSE
              </button>
            </div>
          </div>
        ) : null}
      </section>

    </main>
      </div>
    </div>
  );
}

export default App;
