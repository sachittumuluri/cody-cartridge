const { app, BrowserWindow, dialog, ipcMain, Menu, net, powerSaveBlocker, protocol } = require("electron");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "cody-app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true
    }
  },
  {
    scheme: "cody-media",
    privileges: {
      // corsEnabled lets the renderer consume media in CORS mode: without
      // it, a cody-app:// page feeding cody-media:// audio into
      // createMediaElementSource plays fine but the graph outputs silence
      // (cross-origin taint), and spine-tracing fetches are blocked.
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true
    }
  },
  {
    scheme: "cody-art",
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true
    }
  }
]);

const audioExtensions = new Set([".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus", ".aiff", ".aif"]);
const takeoutCsvPattern = /(^|\/)(music library songs|playlist).+\.csv$|\.csv$/i;
const defaultMusicFolderName = "music";
const defaultTakeoutFolderName = "Takeout";
const metadataCache = new Map();
const securityScopedBookmarks = new Map();
const forceDist = process.env.CODY_FORCE_DIST === "1";
function getCliValue(name) {
  const prefix = `${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

const isShellSmoke = process.env.CODY_SHELL_SMOKE === "1" || process.argv.includes("--cody-shell-smoke");
const shellSmokeUserDataPath = isShellSmoke
  ? process.env.CODY_SHELL_SMOKE_USER_DATA_DIR || getCliValue("--cody-shell-smoke-user-data")
  : "";
const shellSmokeResetProbe = process.env.CODY_SHELL_SMOKE_RESET_PROBE === "1" || process.argv.includes("--cody-shell-smoke-reset-probe");
const isDev = !app.isPackaged && !forceDist;
const devServerOrigin = "http://127.0.0.1:5173";
const appProtocolHost = "renderer";
const rendererStorageKey = "cody-cartridge-state-v1";
const appProtocolOrigin = `cody-app://${appProtocolHost}`;
const staticMimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"]
]);
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

function logShellSmokeStep(message) {
  if (isShellSmoke) {
    console.log(`shell smoke: ${message}`);
  }
}

if (shellSmokeUserDataPath) {
  app.setPath("userData", path.resolve(shellSmokeUserDataPath));
}

function parseTrackName(filePath) {
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

function encodeMediaPath(filePath) {
  return Buffer.from(filePath, "utf8").toString("base64url");
}

function decodeMediaPath(encodedPath) {
  return Buffer.from(encodedPath, "base64url").toString("utf8");
}

function getDistRootPath() {
  return path.resolve(__dirname, "../dist");
}

function getRendererIndexPath() {
  return path.join(getDistRootPath(), "index.html");
}

function getRendererUrl(query) {
  const url = new URL(`${appProtocolOrigin}/index.html`);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function getAppProtocolFilePath(requestUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    return "";
  }

  if (parsedUrl.protocol !== "cody-app:" || parsedUrl.hostname !== appProtocolHost) {
    return "";
  }

  let requestedPath;

  try {
    requestedPath = decodeURIComponent(parsedUrl.pathname || "/");
  } catch {
    return "";
  }

  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");

  if (!relativePath || relativePath.split(/[\\/]/).includes("..")) {
    return "";
  }

  const distRoot = getDistRootPath();
  const filePath = path.resolve(distRoot, relativePath);

  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${path.sep}`)) {
    return "";
  }

  return filePath;
}

function getBookmarkStorePath() {
  return path.join(app.getPath("userData"), "security-scoped-bookmarks.json");
}

async function loadSecurityScopedBookmarks() {
  try {
    const rawBookmarks = await fs.readFile(getBookmarkStorePath(), "utf8");
    const parsedBookmarks = JSON.parse(rawBookmarks);

    if (!parsedBookmarks || typeof parsedBookmarks !== "object") {
      return;
    }

    for (const [filePath, bookmark] of Object.entries(parsedBookmarks)) {
      if (typeof filePath === "string" && typeof bookmark === "string") {
        securityScopedBookmarks.set(path.resolve(filePath), bookmark);
      }
    }
  } catch {
    // The bookmark store is optional; it will be created after the first MAS picker import.
  }
}

async function saveSecurityScopedBookmarks() {
  try {
    await fs.mkdir(path.dirname(getBookmarkStorePath()), { recursive: true });
    await fs.writeFile(
      getBookmarkStorePath(),
      JSON.stringify(Object.fromEntries(securityScopedBookmarks), null, 2),
      "utf8"
    );
  } catch {
    // Bookmark persistence should not interrupt normal local playback.
  }
}

async function clearSecurityScopedBookmarks() {
  securityScopedBookmarks.clear();

  try {
    await fs.rm(getBookmarkStorePath(), { force: true });
  } catch {
    // Resetting library state should proceed even if the optional bookmark file is already gone.
  }
}

function rememberDialogBookmarks(result) {
  if (!result?.bookmarks?.length) {
    return;
  }

  result.filePaths.forEach((filePath, index) => {
    const bookmark = result.bookmarks?.[index];

    if (filePath && bookmark) {
      securityScopedBookmarks.set(path.resolve(filePath), bookmark);
    }
  });

  saveSecurityScopedBookmarks();
}

function findSecurityScopedBookmark(filePath) {
  const resolvedPath = path.resolve(filePath);
  let bestBookmark = "";
  let bestRootLength = -1;

  for (const [bookmarkRoot, bookmark] of securityScopedBookmarks) {
    if (
      (resolvedPath === bookmarkRoot || resolvedPath.startsWith(`${bookmarkRoot}${path.sep}`)) &&
      bookmarkRoot.length > bestRootLength
    ) {
      bestBookmark = bookmark;
      bestRootLength = bookmarkRoot.length;
    }
  }

  return bestBookmark;
}

function startSecurityScopedAccess(filePath) {
  if (process.platform !== "darwin" || typeof app.startAccessingSecurityScopedResource !== "function") {
    return () => undefined;
  }

  const bookmark = findSecurityScopedBookmark(filePath);

  if (!bookmark) {
    return () => undefined;
  }

  try {
    return app.startAccessingSecurityScopedResource(bookmark);
  } catch {
    return () => undefined;
  }
}

async function withSecurityScopedAccess(filePath, action) {
  const stopAccessing = startSecurityScopedAccess(filePath);

  try {
    return await action();
  } finally {
    stopAccessing();
  }
}

function createScopedReadStream(filePath, options) {
  const stopAccessing = startSecurityScopedAccess(filePath);
  const stream = createReadStream(filePath, options);
  let didStopAccessing = false;
  const stopOnce = () => {
    if (!didStopAccessing) {
      didStopAccessing = true;
      stopAccessing();
    }
  };

  stream.once("close", stopOnce);
  stream.once("error", stopOnce);

  return stream;
}

async function loadAudioMetadata(filePath) {
  try {
    const { parseFile } = await import("music-metadata");
    return withSecurityScopedAccess(filePath, () =>
      parseFile(filePath, {
        duration: true,
        skipCovers: false
      })
    );
  } catch {
    return null;
  }
}

function getAudioMetadata(filePath) {
  if (!metadataCache.has(filePath)) {
    metadataCache.set(filePath, loadAudioMetadata(filePath));
  }

  return metadataCache.get(filePath);
}

function firstValue(value, fallback) {
  if (Array.isArray(value)) {
    return value.find(Boolean) ?? fallback;
  }

  return value || fallback;
}

function firstMeaningfulValue(values, fallback) {
  for (const value of values) {
    const nextValue = Array.isArray(value) ? value.find(Boolean) : value;

    if (nextValue?.trim()) {
      return nextValue.trim();
    }
  }

  return fallback;
}

function streamFileResponse(request, filePath, stats) {
  const range = request.headers.get("range");
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
  const headers = {
    "accept-ranges": "bytes",
    "access-control-allow-headers": "range",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "accept-ranges, content-length, content-range",
    "cache-control": "no-store",
    "content-type": contentType
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const requestedStart = match?.[1] ? Number(match[1]) : 0;
    const requestedEnd = match?.[2] ? Number(match[2]) : stats.size - 1;
    const start = Math.min(Math.max(requestedStart, 0), stats.size - 1);
    const end = Math.min(Math.max(requestedEnd, start), stats.size - 1);

    return new Response(Readable.toWeb(createScopedReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${stats.size}`
      }
    });
  }

  return new Response(Readable.toWeb(createScopedReadStream(filePath)), {
    headers: {
      ...headers,
      "content-length": String(stats.size)
    }
  });
}

async function collectAudioFiles(folderPath) {
  const entries = await withSecurityScopedAccess(folderPath, () => fs.readdir(folderPath, { withFileTypes: true }));
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

async function collectTakeoutCsvFiles(folderPath) {
  const entries = await withSecurityScopedAccess(folderPath, () => fs.readdir(folderPath, { withFileTypes: true }));
  const files = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        return collectTakeoutCsvFiles(nextPath);
      }

      if (entry.isFile() && takeoutCsvPattern.test(nextPath)) {
        return [nextPath];
      }

      return [];
    })
  );

  return files.flat();
}

async function collectImportPaths(filePaths) {
  const files = await Promise.all(
    filePaths.map(async (filePath) => {
      const stats = await withSecurityScopedAccess(filePath, () => fs.stat(filePath)).catch(() => null);

      if (!stats) {
        return [];
      }

      if (stats.isDirectory()) {
        return collectAudioFiles(filePath);
      }

      if (stats.isFile() && audioExtensions.has(path.extname(filePath).toLowerCase())) {
        return [filePath];
      }

      return [];
    })
  );

  return [...new Set(files.flat())];
}

async function collectTakeoutCsvPaths(filePaths) {
  const files = await Promise.all(
    filePaths.map(async (filePath) => {
      const stats = await withSecurityScopedAccess(filePath, () => fs.stat(filePath)).catch(() => null);

      if (!stats) {
        return [];
      }

      if (stats.isDirectory()) {
        return collectTakeoutCsvFiles(filePath);
      }

      if (stats.isFile() && takeoutCsvPattern.test(filePath)) {
        return [filePath];
      }

      return [];
    })
  );

  return [...new Set(files.flat())];
}

async function readTakeoutCsvFile(filePath) {
  const text = await withSecurityScopedAccess(filePath, () => fs.readFile(filePath, "utf8"));

  return {
    fileName: path.basename(filePath),
    text
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
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

function cleanHeader(value) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function parseTakeoutCsvText(text, sourceFile) {
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

  return rows.slice(1).flatMap((row) => {
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

async function loadTakeoutCatalog(rootPaths) {
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
  const known = new Set();

  return csvTexts.flatMap(({ sourceFile, text }) =>
    parseTakeoutCsvText(text, sourceFile).filter((song) => {
      const key =
        song.videoId ||
        `${normalizeSongText(song.title)}::${normalizeSongText(song.album)}::${song.artists
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

function normalizeSongText(value) {
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

function normalizedTokenSet(value) {
  return new Set(normalizeSongText(value).split(/\s+/).filter(Boolean));
}

function scoreTitleMatch(localTitle, takeoutTitle) {
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

function scoreTakeoutMatch(song, hints) {
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

function artistSignature(song) {
  return song.artists.map(normalizeSongText).filter(Boolean).join("|");
}

function findTakeoutMatch(filePath, metadata, fallback, catalog) {
  if (catalog.length === 0) {
    return undefined;
  }

  const common = metadata?.common ?? {};
  const fileStem = path.basename(filePath, path.extname(filePath)).replace(/\s+\[[^\]]+\]$/, "");
  const titles = [...new Set([firstValue(common.title, ""), fallback.title, fileStem].filter(Boolean))];
  const artists = [...new Set([firstValue(common.artist, ""), fallback.artist].filter(Boolean))];
  const album = firstValue(common.album, "");
  let bestMatch;
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

async function trackFromFilePath(filePath, takeoutCatalog = []) {
  const fallback = parseTrackName(filePath);
  const encodedPath = encodeMediaPath(filePath);
  const stats = await withSecurityScopedAccess(filePath, () => fs.stat(filePath)).catch(() => ({ size: 0 }));
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
    artworkUrl: picture ? `cody-art://track/${encodedPath}` : "",
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
    url: `cody-media://track/${encodedPath}`,
    youtubeMusicUrl: takeoutSong?.videoId ? `https://music.youtube.com/watch?v=${takeoutSong.videoId}` : "",
    youtubeVideoId: takeoutSong?.videoId ?? "",
    year: common.year ?? 0
  };
}

function getDefaultTakeoutPaths() {
  if (process.mas) {
    return [];
  }

  const desktopPath = app.getPath("desktop");

  return [path.join(desktopPath, defaultTakeoutFolderName), path.join(desktopPath, "Amherst", defaultTakeoutFolderName)];
}

async function tracksFromFilePaths(filePaths) {
  const takeoutCatalog = await loadTakeoutCatalog(getDefaultTakeoutPaths());

  return Promise.all(filePaths.map((filePath) => trackFromFilePath(filePath, takeoutCatalog)));
}

function sendRendererCommand(mainWindow, command) {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-menu:command", command);
  }
}

function configureSessionSecurity(session) {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  session.setPermissionCheckHandler(() => false);
}

function configureWebContentsSecurity(webContents, allowedNavigation) {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  webContents.on("will-navigate", (event, nextUrl) => {
    if (!allowedNavigation(nextUrl)) {
      event.preventDefault();
    }
  });
}

function isMainWindowNavigationAllowed(nextUrl) {
  if (isDev) {
    return nextUrl === devServerOrigin || nextUrl.startsWith(`${devServerOrigin}/`);
  }

  try {
    const parsedUrl = new URL(nextUrl);
    return (
      parsedUrl.protocol === "cody-app:" &&
      parsedUrl.hostname === appProtocolHost &&
      (parsedUrl.pathname === "/" || parsedUrl.pathname === "/index.html")
    );
  } catch {
    return false;
  }
}

function isDocumentWindowNavigationAllowed(nextUrl) {
  try {
    return new URL(nextUrl).protocol === "data:";
  } catch {
    return false;
  }
}

function isTrustedRendererEvent(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  return isMainWindowNavigationAllowed(senderUrl);
}

function withTrustedRenderer(handler) {
  return async (event, ...args) => {
    if (!isTrustedRendererEvent(event)) {
      return [];
    }

    return handler(event, ...args);
  };
}

function isAllowedMediaPath(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    return false;
  }

  if (!process.mas) {
    return true;
  }

  return Boolean(findSecurityScopedBookmark(filePath));
}

function filterRendererProvidedPaths(filePaths) {
  if (!Array.isArray(filePaths)) {
    return [];
  }

  return filePaths.filter(isAllowedMediaPath);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markdownToHtml(markdown) {
  const blocks = [];
  let list = [];
  let paragraph = [];

  const inline = (value) =>
    escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  const flushList = () => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  };

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  markdown.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${inline(trimmed.slice(3))}</h2>`);
      return;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h1>${inline(trimmed.slice(2))}</h1>`);
      return;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      list.push(trimmed.slice(2));
      return;
    }

    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();

  return blocks.join("\n");
}

function renderDocumentWindowHtml({ eyebrow, markdown, title }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} - Cody Cartridge</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07080b;
        --line: rgba(156, 199, 216, 0.2);
        --text: #efefe7;
        --muted: rgba(239, 239, 231, 0.62);
        --red: #8b111b;
        --blue: #9cc7d8;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--text);
        background:
          linear-gradient(90deg, rgba(156, 199, 216, 0.035) 1px, transparent 1px) 0 0 / 24px 24px,
          linear-gradient(0deg, rgba(139, 17, 27, 0.045) 1px, transparent 1px) 0 0 / 24px 24px,
          radial-gradient(circle at 75% 16%, rgba(139, 17, 27, 0.18), transparent 32%),
          var(--bg);
        font-family: "Courier New", ui-monospace, SFMono-Regular, Menlo, monospace;
        line-height: 1.55;
      }

      main {
        width: min(980px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 30px 0 48px;
      }

      header,
      section {
        border: 1px solid var(--line);
        background: rgba(0, 0, 0, 0.48);
      }

      header {
        padding: 18px 20px;
        box-shadow: inset 4px 0 0 var(--red);
      }

      section {
        display: grid;
        gap: 18px;
        margin-top: 18px;
        padding: 22px;
      }

      h1,
      h2,
      p,
      ul {
        margin: 0;
      }

      h1 {
        color: #fff;
        font-size: clamp(27px, 5vw, 46px);
        line-height: 1.02;
        text-transform: uppercase;
      }

      h2 {
        color: var(--blue);
        font-size: 15px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      p,
      li {
        color: var(--muted);
        font-size: 14px;
      }

      ul {
        display: grid;
        gap: 7px;
        padding-left: 20px;
      }

      code {
        color: var(--text);
        background: rgba(156, 199, 216, 0.08);
      }

      .eyebrow {
        display: block;
        margin-bottom: 7px;
        color: var(--blue);
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <span class="eyebrow">${escapeHtml(eyebrow)}</span>
        <h1>${escapeHtml(title)}</h1>
      </header>
      <section>
        ${markdownToHtml(markdown)}
      </section>
    </main>
  </body>
</html>`;
}

async function readBundledMarkdown(resourceFileName, fallbackTitle) {
  const packagedPath = path.join(process.resourcesPath, resourceFileName);
  const developmentPath = path.join(__dirname, "../app-store-assets", resourceFileName);
  const documentPath = app.isPackaged ? packagedPath : developmentPath;

  try {
    return await fs.readFile(documentPath, "utf8");
  } catch {
    return `# ${fallbackTitle}\n\n- This document is unavailable in this build.`;
  }
}

async function showBundledMarkdownDocument(mainWindow, { eyebrow, resourceFileName, title }) {
  const documentWindow = new BrowserWindow({
    parent: mainWindow,
    modal: false,
    width: 920,
    height: 720,
    minWidth: 680,
    minHeight: 520,
    title,
    backgroundColor: "#07080b",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const markdown = await readBundledMarkdown(resourceFileName, title);

  configureSessionSecurity(documentWindow.webContents.session);
  configureWebContentsSecurity(documentWindow.webContents, isDocumentWindowNavigationAllowed);

  await documentWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(renderDocumentWindowHtml({ eyebrow, markdown, title }))}`
  );
}

async function showPrivacySummary(mainWindow) {
  await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Cody Cartridge Privacy",
    message: "Cody Cartridge is local-first.",
    detail:
      "The app plays user-selected local audio files, reads metadata on this Mac, and stores library state locally. It does not download music, scrape streaming services, run ads, require an account, or transmit your music library to a server.",
    buttons: ["OK"]
  });
}

async function confirmResetLocalLibrary(mainWindow) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Reset Cody Cartridge Library",
    message: "Reset local library state?",
    detail:
      "This clears Cody Cartridge's local library index, imported YouTube Music Takeout rows, saved slots, playback state, and stored file-access bookmarks. Your audio files remain untouched on disk.",
    buttons: ["Reset Library", "Cancel"],
    cancelId: 1,
    defaultId: 1,
    noLink: true
  });

  if (result.response !== 0) {
    return;
  }

  await clearSecurityScopedBookmarks();
  sendRendererCommand(mainWindow, "reset-local-library");
}

function buildApplicationMenu(mainWindow) {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        {
          label: "Import Audio Files...",
          accelerator: "CmdOrCtrl+O",
          click: () => sendRendererCommand(mainWindow, "import-audio-files")
        },
        {
          label: "Import Music Folder...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => sendRendererCommand(mainWindow, "import-audio-folder")
        },
        {
          label: "Import YouTube Music Takeout...",
          accelerator: "CmdOrCtrl+Shift+T",
          click: () => sendRendererCommand(mainWindow, "import-takeout-csv")
        },
        { type: "separator" },
        {
          label: "Reset Local Library...",
          click: () => confirmResetLocalLibrary(mainWindow)
        },
        { type: "separator" },
        { role: "close" }
      ]
    },
    {
      label: "Playback",
      submenu: [
        {
          label: "Play/Pause",
          accelerator: "CmdOrCtrl+P",
          click: () => sendRendererCommand(mainWindow, "toggle-playback")
        },
        {
          label: "Previous Track",
          accelerator: "CmdOrCtrl+Left",
          click: () => sendRendererCommand(mainWindow, "previous-track")
        },
        {
          label: "Next Track",
          accelerator: "CmdOrCtrl+Right",
          click: () => sendRendererCommand(mainWindow, "next-track")
        }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev
          ? [
              { type: "separator" },
              { role: "reload" },
              { role: "forceReload" },
              { role: "toggleDevTools" }
            ]
          : [])
      ]
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
    },
    {
      role: "help",
      submenu: [
        {
          label: "Privacy Summary",
          click: () => showPrivacySummary(mainWindow)
        },
        {
          label: "Privacy Policy",
          click: () =>
            showBundledMarkdownDocument(mainWindow, {
              eyebrow: "Cody Noir // Local Policy",
              resourceFileName: "PRIVACY_POLICY.md",
              title: "Privacy Policy"
            })
        },
        {
          label: "Support",
          click: () =>
            showBundledMarkdownDocument(mainWindow, {
              eyebrow: "Cody Noir // Local Support",
              resourceFileName: "SUPPORT.md",
              title: "Support"
            })
        },
        {
          label: "Accessibility",
          click: () =>
            showBundledMarkdownDocument(mainWindow, {
              eyebrow: "Cody Noir // Local Accessibility",
              resourceFileName: "ACCESSIBILITY.md",
              title: "Accessibility"
            })
        },
        {
          label: "Third-Party Notices",
          click: () =>
            showBundledMarkdownDocument(mainWindow, {
              eyebrow: "Cody Noir // Local Notices",
              resourceFileName: "THIRD_PARTY_NOTICES.md",
              title: "Third-Party Notices"
            })
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function flattenMenuLabels(menu) {
  if (!menu) {
    return [];
  }

  return menu.items.flatMap((item) => {
    const labels = item.label ? [item.label] : [];
    return labels.concat(flattenMenuLabels(item.submenu));
  });
}

function assertShellSmoke(condition, message) {
  if (!condition) {
    throw new Error(`Electron shell smoke failed: ${message}`);
  }
}

async function runShellSmoke(mainWindow) {
  let passCount = 21;
  const menuLabels = flattenMenuLabels(Menu.getApplicationMenu());
  const requiredMenuLabels = [
    "File",
    "Import Audio Files...",
    "Import Music Folder...",
    "Import YouTube Music Takeout...",
    "Reset Local Library...",
    "Playback",
    "Play/Pause",
    "Previous Track",
    "Next Track",
    "Privacy Summary",
    "Privacy Policy",
    "Support",
    "Accessibility",
    "Third-Party Notices"
  ];

  requiredMenuLabels.forEach((label) => {
    assertShellSmoke(menuLabels.includes(label), `missing native menu label ${label}`);
  });

  const state = await mainWindow.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        const selectors = [
          ".app-shell",
          ".console-screen",
          ".deck",
          ".deck-hero",
          ".signal-scope",
          ".metadata-panel",
          ".metadata-list",
          ".stage-path",
          ".deck-controls",
          ".vu-meter"
        ];
        const missingSelectors = selectors.filter((selector) => !document.querySelector(selector));
        const host = window.musicHost || {};
        const hostMethods = [
          "pickAudioFiles",
          "pickAudioFolder",
          "pickTakeoutCsv",
          "loadDefaultLibrary",
          "importAudioPaths",
          "readTakeoutCsvPaths",
          "onMenuCommand",
          "setPlaybackActive"
        ];
        const missingHostMethods = hostMethods.filter((key) => typeof host[key] !== "function");
        const cards = document.querySelectorAll(".metadata-cover").length;
        const rows = document.querySelectorAll(".metadata-row").length;
        const shell = document.querySelector(".app-shell");
        const ready = missingSelectors.length === 0 &&
          missingHostMethods.length === 0 &&
          cards >= 8 &&
          rows >= 8 &&
          document.body?.innerText?.includes("Signal Drift");

        if (ready || Date.now() - started > 7000) {
          resolve({
            ready,
            cards,
            rows,
            missingSelectors,
            missingHostMethods,
            reducedMotion: Boolean(shell?.classList.contains("reduced-motion")),
            title: document.title,
            url: location.href
          });
          return;
        }

        requestAnimationFrame(check);
      };

      check();
    })`
  );

  assertShellSmoke(state.ready, `renderer did not become ready: ${JSON.stringify(state)}`);
  assertShellSmoke(
    state.url.startsWith(`${appProtocolOrigin}/index.html`),
    `main window did not load production app protocol URL: ${state.url}`
  );

  const protocolState = await Promise.all(
    [
      "cody-app://renderer/%2e%2e/package.json",
      "cody-app://renderer/%E0%A4%A",
      "cody-app://renderer/not-found.js",
      "cody-media://track/not-a-valid-path",
      "cody-art://track/not-a-valid-path"
    ].map(async (url) => {
      try {
        const response = await net.fetch(url);
        return response.status;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })
  );

  assertShellSmoke(
    Array.isArray(protocolState) && protocolState.every((status) => status === 404),
    `custom protocols did not reject invalid paths with 404: ${JSON.stringify(protocolState)}`
  );

  const smokeAudioPath = process.env.CODY_SHELL_SMOKE_AUDIO_PATH;

  if (smokeAudioPath) {
    const importedTracks = await mainWindow.webContents.executeJavaScript(
      `window.musicHost.importAudioPaths(${JSON.stringify([smokeAudioPath])})`
    );
    const importedTrack = importedTracks?.[0];

    assertShellSmoke(Array.isArray(importedTracks) && importedTracks.length === 1, "local audio import IPC did not return exactly one track");
    assertShellSmoke(importedTrack.title === "Smoke Import Probe", `unexpected imported title: ${importedTrack.title}`);
    assertShellSmoke(importedTrack.filePath === smokeAudioPath, "imported track did not preserve source file path");
    assertShellSmoke(importedTrack.size > 44, `imported track size was too small: ${importedTrack.size}`);
    assertShellSmoke(importedTrack.url?.startsWith("cody-media://track/"), `imported track media URL was invalid: ${importedTrack.url}`);

    const mediaResponse = await net.fetch(importedTrack.url, {
      headers: {
        range: "bytes=0-63"
      }
    });
    const mediaBytes = Buffer.from(await mediaResponse.arrayBuffer());

    assertShellSmoke(mediaResponse.status === 206, `media range request returned ${mediaResponse.status}`);
    assertShellSmoke(mediaResponse.headers.get("content-type") === "audio/wav", "media response content type was not audio/wav");
    assertShellSmoke(mediaResponse.headers.get("content-range")?.startsWith("bytes 0-63/"), "media response did not expose expected content-range");
    assertShellSmoke(mediaBytes.length === 64, `media range response returned ${mediaBytes.length} bytes`);
    passCount += 9;

    // End-to-end playback: leave the synthetic store-demo catalog, boot the
    // real renderer, drive the transport, and assert the Web Audio graph
    // carries signal. net.fetch above runs in the main process and bypasses
    // renderer CORS entirely — only this catches a muted cross-origin
    // MediaElementSource (the element plays but every analyser reads 0).
    logShellSmokeStep("loading real-mode renderer for playback probe");
    await mainWindow.loadURL(getRendererUrl());

    const playbackProbe = await mainWindow.webContents.executeJavaScript(
      `(async () => {
        const waitFor = async (predicate, timeoutMs) => {
          const startedAt = Date.now();

          while (Date.now() - startedAt < timeoutMs) {
            if (predicate()) {
              return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
          }

          return false;
        };

        const armed = await waitFor(() => {
          const playButton = document.querySelector(".play-button");
          return Boolean(playButton) && !playButton.disabled;
        }, 9000);
        const playButton = document.querySelector(".play-button");
        const rows = document.querySelectorAll(".metadata-row").length;

        if (!armed) {
          return { skipped: true, rows, reason: "no armed track (empty local library?)" };
        }

        playButton.click();
        await new Promise((resolve) => setTimeout(resolve, 2200));
        const audio = document.querySelector("audio");
        const state = {
          skipped: false,
          rows,
          heroTitle: ((document.querySelector("h1, h2, h3") || {}).textContent || "").slice(0, 40),
          src: audio ? audio.currentSrc.slice(0, 40) : "",
          paused: audio ? audio.paused : true,
          time: audio ? audio.currentTime : 0,
          ready: audio ? audio.readyState : -1,
          mediaError: audio && audio.error ? audio.error.code : null,
          level: window.__codyLiveLevel ?? 0
        };
        if (audio) {
          audio.pause();
        }
        return state;
      })()`
    );

    if (playbackProbe.skipped) {
      logShellSmokeStep(`playback probe skipped: ${JSON.stringify(playbackProbe)}`);
    } else {
      assertShellSmoke(playbackProbe.mediaError === null, `playback probe hit media error: ${JSON.stringify(playbackProbe)}`);
      assertShellSmoke(playbackProbe.paused === false, `playback probe did not enter playing state: ${JSON.stringify(playbackProbe)}`);
      assertShellSmoke(playbackProbe.time > 0.8, `playback probe made no progress: ${JSON.stringify(playbackProbe)}`);
      assertShellSmoke(
        playbackProbe.level > 0.02,
        `web audio graph carried no signal while playing (cross-origin mute?): ${JSON.stringify(playbackProbe)}`
      );
      passCount += 4;
    }
  }

  if (shellSmokeResetProbe) {
    const bookmarkStorePath = getBookmarkStorePath();
    const seededBookmarkPath = path.join(app.getPath("userData"), "Reset Probe.mp3");

    await fs.mkdir(path.dirname(bookmarkStorePath), { recursive: true });
    await fs.writeFile(
      bookmarkStorePath,
      JSON.stringify({ [seededBookmarkPath]: "smoke-reset-bookmark" }, null, 2),
      "utf8"
    );
    securityScopedBookmarks.set(seededBookmarkPath, "smoke-reset-bookmark");

    const seededStorage = await mainWindow.webContents.executeJavaScript(
      `(() => {
        window.localStorage.setItem(${JSON.stringify(rendererStorageKey)}, JSON.stringify({
          currentId: "reset-probe",
          tracks: [{ id: "reset-probe", title: "Reset Probe", url: "cody-media://track/probe" }],
          takeoutSongs: [{ id: "probe-row", title: "Reset Probe", artists: ["Smoke"], album: "Probe" }],
          volume: 0.44
        }));
        return window.localStorage.getItem(${JSON.stringify(rendererStorageKey)});
      })()`
    );

    assertShellSmoke(Boolean(seededStorage), "clean-profile reset probe could not seed renderer local storage");

    await clearSecurityScopedBookmarks();
    sendRendererCommand(mainWindow, "reset-local-library");

    const resetState = await mainWindow.webContents.executeJavaScript(
      `new Promise((resolve) => {
        const started = Date.now();
        const inspect = () => {
          const storedState = window.localStorage.getItem(${JSON.stringify(rendererStorageKey)});
          const cards = document.querySelectorAll(".metadata-row").length;
          const statusText = document.body?.innerText || "";
          const ready = storedState === null && cards === 0;

          if (ready || Date.now() - started > 3000) {
            resolve({
              cards,
              ready,
              statusHasReset: statusText.includes("Local library reset"),
              storedState
            });
            return;
          }

          requestAnimationFrame(inspect);
        };

        inspect();
      })`
    );
    const bookmarkStoreExists = await fs.stat(bookmarkStorePath).then(() => true, () => false);

    assertShellSmoke(resetState.ready, `clean-profile reset did not clear renderer state: ${JSON.stringify(resetState)}`);
    assertShellSmoke(!bookmarkStoreExists, "clean-profile reset did not remove stored security-scoped bookmark file");
    assertShellSmoke(securityScopedBookmarks.size === 0, "clean-profile reset left in-memory security-scoped bookmarks");
    passCount += 6;
  }

  console.log(`Electron shell smoke checks: ${passCount} passed`);
  console.log(`- menu labels: ${requiredMenuLabels.length}`);
  console.log(`- preload bridge methods: ${state.missingHostMethods.length === 0 ? 8 : 0}`);
  console.log(`- renderer cards/rows: ${state.cards}/${state.rows}`);
  if (smokeAudioPath) {
    console.log("- local audio import IPC and media range streaming: passed");
  }
  if (shellSmokeResetProbe) {
    console.log("- clean profile reset probe: passed");
  }
  console.log("- custom app/media/art protocol rejection: passed");
}

async function createWindow() {
  logShellSmokeStep("creating main window");
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: "Cody Cartridge",
    backgroundColor: "#050506",
    show: !isShellSmoke,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Lock the window to the console's 16:10 design aspect so the scale-to-fit
  // stage fills it with no letterboxing on ordinary resizes.
  mainWindow.setAspectRatio(1440 / 900);

  configureSessionSecurity(mainWindow.webContents.session);
  configureWebContentsSecurity(mainWindow.webContents, isMainWindowNavigationAllowed);

  if (isDev) {
    await mainWindow.loadURL(devServerOrigin);
  } else if (isShellSmoke) {
    logShellSmokeStep("loading packaged renderer");
    await mainWindow.loadURL(
      getRendererUrl({
        "store-demo": "1",
        "store-reduced-motion": "1",
        "store-shelf": "library"
      })
    );
  } else {
    await mainWindow.loadURL(getRendererUrl());
  }

  logShellSmokeStep("packaged renderer loaded");
  buildApplicationMenu(mainWindow);
  return mainWindow;
}

app.whenReady().then(async () => {
  logShellSmokeStep("app ready");
  await loadSecurityScopedBookmarks();

  protocol.handle("cody-app", async (request) => {
    const filePath = getAppProtocolFilePath(request.url);

    if (!filePath) {
      return new Response("", { status: 404 });
    }

    const stats = await fs.stat(filePath).catch(() => null);

    if (!stats?.isFile()) {
      return new Response("", { status: 404 });
    }

    return new Response(await fs.readFile(filePath), {
      headers: {
        "cache-control": "no-store",
        "content-type": staticMimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream"
      }
    });
  });

  protocol.handle("cody-media", async (request) => {
    try {
      const encodedPath = new URL(request.url).pathname.slice(1);
      const mediaPath = decodeMediaPath(encodedPath);

      if (!isAllowedMediaPath(mediaPath)) {
        return new Response("", { status: 404 });
      }

      const stats = await withSecurityScopedAccess(mediaPath, () => fs.stat(mediaPath)).catch(() => null);

      if (!stats?.isFile()) {
        return new Response("", { status: 404 });
      }

      return streamFileResponse(request, mediaPath, stats);
    } catch {
      return new Response("", { status: 404 });
    }
  });

  protocol.handle("cody-art", async (request) => {
    let picture;

    try {
      const encodedPath = new URL(request.url).pathname.slice(1);
      const mediaPath = decodeMediaPath(encodedPath);

      if (!isAllowedMediaPath(mediaPath)) {
        return new Response("", { status: 404 });
      }

      const stats = await withSecurityScopedAccess(mediaPath, () => fs.stat(mediaPath)).catch(() => null);

      if (!stats?.isFile()) {
        return new Response("", { status: 404 });
      }

      const metadata = await getAudioMetadata(mediaPath);
      picture = metadata?.common.picture?.[0];
    } catch {
      return new Response("", { status: 404 });
    }

    if (!picture) {
      return new Response("", { status: 404 });
    }

    return new Response(Buffer.from(picture.data), {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
        "content-type": picture.format || "image/jpeg"
      }
    });
  });

  ipcMain.handle("music:pick-audio-files", withTrustedRenderer(async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose Cody FM tracks",
      properties: ["openFile", "multiSelections"],
      securityScopedBookmarks: true,
      filters: [
        {
          name: "Audio",
          extensions: [...audioExtensions].map((ext) => ext.slice(1))
        }
      ]
    });

    if (result.canceled) {
      return [];
    }

    rememberDialogBookmarks(result);
    const filePaths = await collectImportPaths(result.filePaths);
    return tracksFromFilePaths(filePaths);
  }));

  ipcMain.handle("music:pick-audio-folder", withTrustedRenderer(async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a local music folder",
      properties: ["openDirectory"],
      securityScopedBookmarks: true
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    rememberDialogBookmarks(result);
    const filePaths = await collectAudioFiles(result.filePaths[0]);
    return tracksFromFilePaths(filePaths);
  }));

  ipcMain.handle("music:load-default-library", withTrustedRenderer(async () => {
    if (process.mas) {
      return [];
    }

    const defaultMusicPath = path.join(app.getPath("desktop"), defaultMusicFolderName);
    const stats = await withSecurityScopedAccess(defaultMusicPath, () => fs.stat(defaultMusicPath)).catch(() => null);

    if (!stats?.isDirectory()) {
      return [];
    }

    const filePaths = await collectAudioFiles(defaultMusicPath);
    return tracksFromFilePaths(filePaths);
  }));

  ipcMain.handle("music:pick-takeout-csv", withTrustedRenderer(async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose YouTube Music Takeout CSV or folder",
      properties: ["openFile", "openDirectory", "multiSelections"],
      securityScopedBookmarks: true,
      filters: [
        {
          name: "CSV",
          extensions: ["csv"]
        }
      ]
    });

    if (result.canceled) {
      return [];
    }

    rememberDialogBookmarks(result);
    const filePaths = await collectTakeoutCsvPaths(result.filePaths);
    return Promise.all(filePaths.map(readTakeoutCsvFile));
  }));

  ipcMain.handle("music:import-audio-paths", withTrustedRenderer(async (_event, filePaths) => {
    const safePaths = filterRendererProvidedPaths(filePaths);

    if (safePaths.length === 0) {
      return [];
    }

    const audioPaths = await collectImportPaths(safePaths);
    return tracksFromFilePaths(audioPaths);
  }));

  ipcMain.handle("music:read-takeout-csv-paths", withTrustedRenderer(async (_event, filePaths) => {
    const safePaths = filterRendererProvidedPaths(filePaths);

    if (safePaths.length === 0) {
      return [];
    }

    const csvPaths = await collectTakeoutCsvPaths(safePaths);
    return Promise.all(csvPaths.map(readTakeoutCsvFile));
  }));

  // Keep long playback alive with the lid interaction idle: the renderer
  // reports playback state and the host holds a power-save blocker only while
  // audio is actually playing.
  let playbackBlockerId = null;

  ipcMain.handle("music:playback-active", withTrustedRenderer((_event, active) => {
    if (active && playbackBlockerId === null) {
      playbackBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!active && playbackBlockerId !== null) {
      if (powerSaveBlocker.isStarted(playbackBlockerId)) {
        powerSaveBlocker.stop(playbackBlockerId);
      }

      playbackBlockerId = null;
    }

    return playbackBlockerId !== null;
  }));

  const mainWindow = await createWindow();

  if (isShellSmoke) {
    logShellSmokeStep("running assertions");
    await runShellSmoke(mainWindow);
    mainWindow.destroy();
    app.exit(0);
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
