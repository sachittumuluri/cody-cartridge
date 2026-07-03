import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

type TrackMetadata = Awaited<ReturnType<typeof import("music-metadata").parseFile>>;
type TakeoutTrackMetadata = {
  album: string;
  artists: string[];
  sourceFile: string;
  title: string;
  videoId: string;
};

const audioExtensions = new Set([".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus", ".aiff", ".aif"]);
const desktopPath = path.join(process.env.HOME ?? "", "Desktop");
const defaultMusicPath = path.join(desktopPath, "music");
const defaultTakeoutPaths = [path.join(desktopPath, "Takeout"), path.join(desktopPath, "Amherst", "Takeout")];
const metadataCache = new Map<string, Promise<TrackMetadata | null>>();
const mimeTypes = new Map([
  [".aac", "audio/aac"],
  [".aif", "audio/aiff"],
  [".aiff", "audio/aiff"],
  [".flac", "audio/flac"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".wav", "audio/wav"]
]);

function parseTrackName(filePath: string) {
  const fileName = path.basename(filePath);
  const clean = fileName.replace(path.extname(fileName), "");
  const parts = clean.split(/\s+-\s+/);

  if (parts.length >= 2) {
    return {
      artist: parts[0].trim() || "Unknown Artist",
      title: parts.slice(1).join(" - ").trim() || clean,
      album: "Local Cuts"
    };
  }

  return {
    artist: "Unknown Artist",
    title: clean,
    album: "Local Cuts"
  };
}

function firstValue(value: string | string[] | undefined, fallback: string) {
  if (Array.isArray(value)) {
    return value.find(Boolean) ?? fallback;
  }

  return value || fallback;
}

function firstMeaningfulValue(values: Array<string | string[] | undefined>, fallback: string) {
  for (const value of values) {
    const nextValue = Array.isArray(value) ? value.find(Boolean) : value;

    if (nextValue?.trim()) {
      return nextValue.trim();
    }
  }

  return fallback;
}

function encodeMusicPath(filePath: string) {
  return Buffer.from(filePath, "utf8").toString("base64url");
}

function decodeSafeMusicPath(encodedPath: string) {
  const decodedPath = Buffer.from(encodedPath, "base64url").toString("utf8");
  const resolvedPath = path.resolve(decodedPath);
  const resolvedRoot = path.resolve(defaultMusicPath);

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }

  return resolvedPath;
}

async function collectAudioFiles(folderPath: string): Promise<string[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        return collectAudioFiles(nextPath);
      }

      if (entry.isFile() && audioExtensions.has(path.extname(nextPath).toLowerCase())) {
        return [nextPath];
      }

      return [];
    })
  );

  return files.flat();
}

async function collectTakeoutCsvFiles(folderPath: string): Promise<string[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        return collectTakeoutCsvFiles(nextPath);
      }

      if (entry.isFile() && path.extname(nextPath).toLowerCase() === ".csv") {
        return [nextPath];
      }

      return [];
    })
  );

  return files.flat();
}

async function loadAudioMetadata(filePath: string) {
  try {
    const { parseFile } = await import("music-metadata");
    return parseFile(filePath, {
      duration: true,
      skipCovers: false
    });
  } catch {
    return null;
  }
}

function getAudioMetadata(filePath: string) {
  if (!metadataCache.has(filePath)) {
    metadataCache.set(filePath, loadAudioMetadata(filePath));
  }

  return metadataCache.get(filePath);
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

  return rows.slice(1).flatMap((row): TakeoutTrackMetadata[] => {
    const title = (row[titleIndex] ?? "").trim();

    if (!title) {
      return [];
    }

    const artists = artistIndexes
      .map((artistIndex) => (row[artistIndex] ?? "").trim())
      .filter(Boolean);

    return [
      {
        album: albumIndex >= 0 ? (row[albumIndex] ?? "").trim() : "",
        artists: artists.length ? artists : ["Unknown Artist"],
        sourceFile,
        title,
        videoId: videoIdIndex >= 0 ? (row[videoIdIndex] ?? "").trim() : ""
      }
    ];
  });
}

async function loadTakeoutCatalog(rootPaths: string[]) {
  const csvPathGroups = await Promise.all(
    rootPaths.map(async (rootPath) => {
      const stats = await fs.stat(rootPath).catch(() => null);

      if (!stats) {
        return [];
      }

      if (stats.isDirectory()) {
        return collectTakeoutCsvFiles(rootPath);
      }

      return path.extname(rootPath).toLowerCase() === ".csv" ? [rootPath] : [];
    })
  );
  const csvPaths = [...new Set(csvPathGroups.flat())];
  const csvTexts = await Promise.all(
    csvPaths.map(async (csvPath) => ({
      sourceFile: path.basename(csvPath),
      text: await fs.readFile(csvPath, "utf8")
    }))
  );
  const known = new Set<string>();

  return csvTexts.flatMap(({ sourceFile, text }) =>
    parseTakeoutCsvText(text, sourceFile).filter((song) => {
      const key = song.videoId || `${normalizeSongText(song.title)}::${normalizeSongText(song.album)}::${song.artists
        .map(normalizeSongText)
        .join("|")}`;

      if (known.has(key)) {
        return false;
      }

      known.add(key);
      return true;
    })
  );
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

function normalizedTokenSet(value: string) {
  return new Set(normalizeSongText(value).split(/\s+/).filter(Boolean));
}

function scoreTitleMatch(localTitle: string, takeoutTitle: string) {
  const local = normalizeSongText(localTitle);
  const remote = normalizeSongText(takeoutTitle);

  if (!local || !remote) {
    return 0;
  }

  if (local === remote) {
    return 120;
  }

  const localTokens = normalizedTokenSet(local);
  const remoteTokens = normalizedTokenSet(remote);
  const shared = [...localTokens].filter((token) => remoteTokens.has(token)).length;
  const smallestTokenCount = Math.max(1, Math.min(localTokens.size, remoteTokens.size));
  const overlap = shared / smallestTokenCount;
  const contains = (local.length >= 4 && remote.includes(local)) || (remote.length >= 4 && local.includes(remote));

  if (contains && overlap >= 0.66) {
    return 82 + overlap * 16;
  }

  if (overlap >= 0.85 && Math.abs(localTokens.size - remoteTokens.size) <= 2) {
    return 74 + overlap * 12;
  }

  if (overlap >= 0.7 && smallestTokenCount >= 2) {
    return 58 + overlap * 10;
  }

  return 0;
}

function scoreTakeoutMatch(
  song: TakeoutTrackMetadata,
  hints: { album: string; artists: string[]; filePath: string; titles: string[] }
) {
  const titleScore = Math.max(...hints.titles.map((title) => scoreTitleMatch(title, song.title)), 0);

  if (titleScore < 58) {
    return 0;
  }

  let score = titleScore;
  const localAlbum = normalizeSongText(hints.album);

  if (localAlbum && localAlbum === normalizeSongText(song.album)) {
    score += 18;
  }

  const localArtists = hints.artists.map(normalizeSongText).filter(Boolean);
  const takeoutArtists = song.artists.map(normalizeSongText).filter(Boolean);

  if (localArtists.some((artist) => takeoutArtists.some((candidate) => artist === candidate))) {
    score += 24;
  }

  if (normalizeSongText(path.basename(hints.filePath, path.extname(hints.filePath))) === normalizeSongText(song.title)) {
    score += 8;
  }

  return score;
}

function artistSignature(song: TakeoutTrackMetadata) {
  return song.artists.map(normalizeSongText).filter(Boolean).join("|");
}

function findTakeoutMatch(filePath: string, metadata: TrackMetadata | null, fallback: ReturnType<typeof parseTrackName>, catalog: TakeoutTrackMetadata[]) {
  if (catalog.length === 0) {
    return undefined;
  }

  const common = metadata?.common ?? {};
  const fileStem = path.basename(filePath, path.extname(filePath)).replace(/\s+\[[^\]]+\]$/, "");
  const titles = [...new Set([firstValue(common.title, ""), fallback.title, fileStem].filter(Boolean))];
  const artists = [...new Set([firstValue(common.artist, ""), fallback.artist].filter(Boolean))];
  const album = firstValue(common.album, "");
  let bestMatch: { score: number; song: TakeoutTrackMetadata } | undefined;
  let secondBestScore = 0;

  for (const song of catalog) {
    const score = scoreTakeoutMatch(song, { album, artists, filePath, titles });

    if (!bestMatch || score > bestMatch.score) {
      secondBestScore = bestMatch?.score ?? 0;
      bestMatch = { score, song };
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestMatch || bestMatch.score < 88) {
    return undefined;
  }

  if (bestMatch.score - secondBestScore < 6) {
    const tiedMatches = catalog
      .map((song) => ({ score: scoreTakeoutMatch(song, { album, artists, filePath, titles }), song }))
      .filter((match) => Math.abs(match.score - bestMatch.score) < 0.001);
    const exactTitle = normalizeSongText(path.basename(filePath, path.extname(filePath)));
    const allShareExactTitle = tiedMatches.every((match) => normalizeSongText(match.song.title) === exactTitle);
    const allShareArtist = tiedMatches.every((match) => artistSignature(match.song) === artistSignature(bestMatch.song));

    if (bestMatch.score >= 120 && tiedMatches.length > 1 && allShareExactTitle && allShareArtist) {
      return {
        score: bestMatch.score - 4,
        song: {
          ...bestMatch.song,
          album: `${tiedMatches.length} Takeout matches`,
          videoId: ""
        }
      };
    }

    return undefined;
  }

  return bestMatch;
}

async function trackFromFilePath(filePath: string, takeoutCatalog: TakeoutTrackMetadata[] = []) {
  const fallback = parseTrackName(filePath);
  const encodedPath = encodeMusicPath(filePath);
  const stats = await fs.stat(filePath).catch(() => ({ size: 0 }));
  const metadata = await getAudioMetadata(filePath);
  const common = metadata?.common ?? {};
  const format = metadata?.format ?? {};
  const picture = common.picture?.[0];
  const takeoutMatch = findTakeoutMatch(filePath, metadata, fallback, takeoutCatalog);
  const takeoutSong = takeoutMatch?.song;
  const takeoutArtist = takeoutSong?.artists.join(", ");

  return {
    id: `${encodedPath}-${path.basename(filePath)}`,
    title: firstMeaningfulValue([common.title, takeoutSong?.title], fallback.title),
    artist: firstMeaningfulValue([common.artist, takeoutArtist], fallback.artist),
    album: firstMeaningfulValue([common.album, takeoutSong?.album], fallback.album),
    artworkUrl: picture ? `/__cody_music__/art/${encodedPath}` : "",
    bitrate: format.bitrate ?? 0,
    codec: format.codec ?? format.container ?? "",
    duration: format.duration ?? 0,
    filePath,
    fileName: path.basename(filePath),
    genre: Array.isArray(common.genre) ? common.genre.join(", ") : "",
    metadataSource: takeoutSong ? "YouTube Music Takeout" : picture || common.title || common.artist || common.album ? "Embedded tags" : "Local file",
    sampleRate: format.sampleRate ?? 0,
    size: stats.size,
    takeoutMatchConfidence: takeoutMatch?.score ?? 0,
    takeoutSourceFile: takeoutSong?.sourceFile ?? "",
    url: `/__cody_music__/media/${encodedPath}`,
    youtubeMusicUrl: takeoutSong?.videoId ? `https://music.youtube.com/watch?v=${takeoutSong.videoId}` : "",
    youtubeVideoId: takeoutSong?.videoId ?? "",
    year: common.year ?? 0
  };
}

function sendJson(res: ServerResponse, body: unknown) {
  res.statusCode = 200;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendNotFound(res: ServerResponse) {
  res.statusCode = 404;
  res.end();
}

async function streamAudio(req: IncomingMessage, res: ServerResponse, filePath: string) {
  const stats = await fs.stat(filePath).catch(() => null);

  if (!stats?.isFile()) {
    sendNotFound(res);
    return;
  }

  const range = req.headers.range;
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";

  res.setHeader("accept-ranges", "bytes");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", contentType);

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const requestedStart = match?.[1] ? Number(match[1]) : 0;
    const requestedEnd = match?.[2] ? Number(match[2]) : stats.size - 1;
    const start = Math.min(Math.max(requestedStart, 0), stats.size - 1);
    const end = Math.min(Math.max(requestedEnd, start), stats.size - 1);

    res.statusCode = 206;
    res.setHeader("content-length", String(end - start + 1));
    res.setHeader("content-range", `bytes ${start}-${end}/${stats.size}`);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader("content-length", String(stats.size));

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

async function sendArtwork(res: ServerResponse, filePath: string) {
  const metadata = await getAudioMetadata(filePath);
  const picture = metadata?.common.picture?.[0];

  if (!picture) {
    sendNotFound(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", picture.format || "image/jpeg");
  res.end(Buffer.from(picture.data));
}

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "cody-local-music-dev",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const requestUrl = new URL(req.url ?? "/", "http://localhost");

          if (requestUrl.pathname === "/__cody_music__/library") {
            const stats = await fs.stat(defaultMusicPath).catch(() => null);

            if (!stats?.isDirectory()) {
              sendJson(res, []);
              return;
            }

            const filePaths = await collectAudioFiles(defaultMusicPath);
            const takeoutCatalog = await loadTakeoutCatalog(defaultTakeoutPaths);
            sendJson(res, await Promise.all(filePaths.map((filePath) => trackFromFilePath(filePath, takeoutCatalog))));
            return;
          }

          if (requestUrl.pathname.startsWith("/__cody_music__/media/")) {
            const encodedPath = requestUrl.pathname.replace("/__cody_music__/media/", "");
            const filePath = decodeSafeMusicPath(encodedPath);

            if (!filePath) {
              sendNotFound(res);
              return;
            }

            await streamAudio(req, res, filePath);
            return;
          }

          if (requestUrl.pathname.startsWith("/__cody_music__/art/")) {
            const encodedPath = requestUrl.pathname.replace("/__cody_music__/art/", "");
            const filePath = decodeSafeMusicPath(encodedPath);

            if (!filePath) {
              sendNotFound(res);
              return;
            }

            await sendArtwork(res, filePath);
            return;
          }

          next();
        });
      }
    }
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});
