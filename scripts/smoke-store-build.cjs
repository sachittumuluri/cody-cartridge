const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");

const projectRoot = path.resolve(__dirname, "..");
const distIndexPath = path.join(projectRoot, "dist", "index.html");
const storageKey = "cody-cartridge-state-v1";
const surfaces = [
  {
    name: "library",
    query: { "store-demo": "1", "store-shelf": "library" },
    expectedText: "Signal Drift",
    minCards: 8
  },
  {
    name: "takeout",
    query: { "store-demo": "1", "store-shelf": "takeout" },
    expectedText: "Signal Drift",
    minCards: 8
  },
  {
    name: "missing",
    query: { "store-demo": "1", "store-shelf": "missing" },
    expectedText: "Unmatched Tape",
    minCards: 1
  }
];

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isErrorConsoleMessage(level, message) {
  return (
    (typeof level === "number" && level >= 2) ||
    /(?:uncaught|typeerror|referenceerror|syntaxerror|failed to load|error:)/i.test(message)
  );
}

function hasPixelVariation(image) {
  const bitmap = image.toBitmap();
  const stride = Math.max(4, Math.floor(bitmap.length / 12000 / 4) * 4);
  let min = 255;
  let max = 0;
  let samples = 0;

  for (let index = 0; index < bitmap.length; index += stride) {
    const red = bitmap[index] ?? 0;
    const green = bitmap[index + 1] ?? 0;
    const blue = bitmap[index + 2] ?? 0;
    min = Math.min(min, red, green, blue);
    max = Math.max(max, red, green, blue);
    samples += 1;
  }

  return samples > 100 && max - min > 18;
}

async function waitForStoreSurface(window, surface) {
  const details = await window.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const started = Date.now();
      const inspect = () => {
        const bodyText = document.body?.innerText || "";
        const requiredSelectors = [
          ".app-shell",
          ".now-playing-bay",
          ".library-bay",
          ".metadata-panel",
          ".track-list",
          ".focused-track-strip",
          ".catalog-index-rail",
          ".catalog-index-line",
          ".catalog-index-fill",
          ".catalog-index-thumb"
        ];
        const missingSelectors = requiredSelectors.filter((selector) => !document.querySelector(selector));
        const shell = document.querySelector(".app-shell");
        const cards = document.querySelectorAll(".song-card").length;
        const rows = document.querySelectorAll(".metadata-row").length;
        const shelfRail = document.querySelector(".catalog-index-rail");
        const rail = document.querySelector(".catalog-index-line");
        const fill = document.querySelector(".catalog-index-fill");
        const thumb = document.querySelector(".catalog-index-thumb");
        const railRect = rail?.getBoundingClientRect();
        const fillRect = fill?.getBoundingClientRect();
        const thumbRect = thumb?.getBoundingClientRect();
        const railCenterY = railRect ? railRect.y + railRect.height / 2 : 0;
        const railHeight = railRect ? railRect.height : 0;
        const fillWidth = fillRect ? fillRect.width : 0;
        const thumbCenterY = thumbRect ? thumbRect.y + thumbRect.height / 2 : 999;
        const thumbHeight = thumbRect ? thumbRect.height : 0;
        const shelfThumbDeltaY = Math.abs(thumbCenterY - railCenterY);
        const thumbCenterX = thumbRect ? thumbRect.x + thumbRect.width / 2 : 0;
        const transformY = (transformValue) => {
          if (!transformValue || transformValue === "none") {
            return 0;
          }

          const matrix = transformValue.match(/^matrix\\(([^)]+)\\)$/);
          if (matrix) {
            return Number(matrix[1].split(",").map((part) => part.trim())[5] || 0);
          }

          const matrix3d = transformValue.match(/^matrix3d\\(([^)]+)\\)$/);
          if (matrix3d) {
            return Number(matrix3d[1].split(",").map((part) => part.trim())[13] || 0);
          }

          return 999;
        };
        const styleSnapshot = (element) => {
          if (!element) {
            return {
              animationName: "missing",
              filter: "missing",
              transform: "missing",
              transitionProperty: "missing",
              transformY: 999
            };
          }

          const style = getComputedStyle(element);
          const transform = style.transform;
          return {
            animationName: style.animationName,
            filter: style.filter,
            transform,
            transitionProperty: style.transitionProperty,
            transformY: transformY(transform)
          };
        };
        const rectSnapshot = (selector) => {
          const element = document.querySelector(selector);

          if (!element) {
            return null;
          }

          const rect = element.getBoundingClientRect();
          return {
            bottom: rect.bottom,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width
          };
        };
        const insideViewportX = (rect) => Boolean(rect) && rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width > 0;
        const containsX = (outer, inner) =>
          Boolean(outer) && Boolean(inner) && inner.left >= outer.left -1 && inner.right <= outer.right + 1 && inner.width > 0;
        const shelfFlowStylesBefore = {
          fill: styleSnapshot(fill),
          line: styleSnapshot(rail),
          rail: styleSnapshot(shelfRail),
          thumb: styleSnapshot(thumb)
        };
        const layout = {
          catalogToolbar: rectSnapshot(".catalog-toolbar"),
          documentScrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
          focusedTrackStrip: rectSnapshot(".focused-track-strip"),
          libraryBay: rectSnapshot(".library-bay"),
          metadataPanel: rectSnapshot(".metadata-panel"),
          nowPlayingBay: rectSnapshot(".now-playing-bay"),
          shelfFlowRail: rectSnapshot(".catalog-index-rail"),
          stagePath: rectSnapshot(".stage-path"),
          trackList: rectSnapshot(".track-list"),
          transport: rectSnapshot(".transport"),
          viewportWidth: window.innerWidth
        };
        layout.bayGap = layout.libraryBay && layout.nowPlayingBay ? layout.libraryBay.left - layout.nowPlayingBay.right : -999;
        layout.noHorizontalOverflow = layout.documentScrollWidth <= layout.viewportWidth + 2;
        const layoutStable =
          layout.noHorizontalOverflow &&
          insideViewportX(layout.nowPlayingBay) &&
          insideViewportX(layout.libraryBay) &&
          layout.bayGap >= 8 &&
          containsX(layout.nowPlayingBay, layout.stagePath) &&
          containsX(layout.nowPlayingBay, layout.transport) &&
          containsX(layout.libraryBay, layout.catalogToolbar) &&
          containsX(layout.libraryBay, layout.focusedTrackStrip) &&
          containsX(layout.libraryBay, layout.metadataPanel) &&
          containsX(layout.libraryBay, layout.shelfFlowRail) &&
          containsX(layout.libraryBay, layout.trackList) &&
          (layout.stagePath?.height ?? 0) >= 32 &&
          (layout.transport?.height ?? 0) >= 60 &&
          (layout.metadataPanel?.height ?? 0) >= 180 &&
          (layout.trackList?.height ?? 0) >= 120;

        if (shell) {
          shell.classList.add("is-playing");
          shell.style.setProperty("--bass-level", "1");
          shell.style.setProperty("--bass-hit", "2.2");
          shell.style.setProperty("--bass-scale", "1.18");
          shell.style.setProperty("--bass-offset", "-24px");
          shell.style.setProperty("--bass-glow", "260px");
          shell.style.setProperty("--bass-opacity", "1");
          shell.style.setProperty("--playback-progress", "83%");
        }

        const reactiveRailRect = rail?.getBoundingClientRect();
        const reactiveFillRect = fill?.getBoundingClientRect();
        const reactiveThumbRect = thumb?.getBoundingClientRect();
        const reactiveRailCenterY = reactiveRailRect ? reactiveRailRect.y + reactiveRailRect.height / 2 : 0;
        const reactiveThumbCenterY = reactiveThumbRect ? reactiveThumbRect.y + reactiveThumbRect.height / 2 : 999;
        const reactiveThumbCenterX = reactiveThumbRect ? reactiveThumbRect.x + reactiveThumbRect.width / 2 : 999;
        const shelfRailBassShiftY = Math.abs(reactiveRailCenterY - railCenterY);
        const shelfRailHeightShift = Math.abs((reactiveRailRect?.height ?? 0) - railHeight);
        const shelfFillBassShiftWidth = Math.abs((reactiveFillRect?.width ?? 0) - fillWidth);
        const shelfThumbBassDeltaY = Math.abs(reactiveThumbCenterY - reactiveRailCenterY);
        const shelfThumbBassShiftX = Math.abs(reactiveThumbCenterX - thumbCenterX);
        const shelfThumbHeightShift = Math.abs((reactiveThumbRect?.height ?? 0) - thumbHeight);
        const shelfFlowStylesAfter = {
          fill: styleSnapshot(fill),
          line: styleSnapshot(rail),
          rail: styleSnapshot(shelfRail),
          thumb: styleSnapshot(thumb)
        };
        const shelfFlowStyleLock = Object.entries(shelfFlowStylesAfter).every(([key, style]) => {
          const beforeStyle = shelfFlowStylesBefore[key];

          return style.animationName === "none" &&
            style.filter === "none" &&
            style.transitionProperty === "none" &&
            Boolean(beforeStyle) &&
            Math.abs(style.transformY - beforeStyle.transformY) <= 0.01;
        });
        const externalResources = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => !name.startsWith("file:") && !name.startsWith("data:") && !name.startsWith("blob:"));
        const ready = missingSelectors.length === 0 &&
          cards >= ${surface.minCards} &&
          rows >= ${surface.minCards} &&
          bodyText.includes(${JSON.stringify(surface.expectedText)}) &&
          shelfThumbDeltaY <= 1 &&
          shelfRailBassShiftY <= 0.5 &&
          shelfRailHeightShift <= 0.5 &&
          shelfFillBassShiftWidth <= 0.5 &&
          shelfThumbBassDeltaY <= 1 &&
          shelfThumbBassShiftX <= 0.5 &&
          shelfThumbHeightShift <= 0.5 &&
          shelfFlowStyleLock &&
          layoutStable &&
          externalResources.length === 0;

        if (ready || Date.now() - started > 7000) {
          resolve({
            ready,
            bodyHasExpectedText: bodyText.includes(${JSON.stringify(surface.expectedText)}),
            cards,
            rows,
            missingSelectors,
            externalResources,
            shelfThumbDeltaY: Number(shelfThumbDeltaY.toFixed(3)),
            shelfRailBassShiftY: Number(shelfRailBassShiftY.toFixed(3)),
            shelfRailHeightShift: Number(shelfRailHeightShift.toFixed(3)),
            shelfFillBassShiftWidth: Number(shelfFillBassShiftWidth.toFixed(3)),
            shelfThumbBassDeltaY: Number(shelfThumbBassDeltaY.toFixed(3)),
            shelfThumbBassShiftX: Number(shelfThumbBassShiftX.toFixed(3)),
            shelfThumbHeightShift: Number(shelfThumbHeightShift.toFixed(3)),
            shelfFlowStyleLock,
            shelfFlowStylesAfter,
            shelfFlowStylesBefore,
            shelfProgress: shelfRail ? getComputedStyle(shelfRail).getPropertyValue("--catalog-index-position").trim() : "",
            layout,
            layoutStable,
            title: document.title
          });
          return;
        }

        requestAnimationFrame(inspect);
      };

      inspect();
    })`
  );

  if (!details.ready) {
    throw new Error(`${surface.name} store surface did not become healthy: ${JSON.stringify(details)}`);
  }

  await wait(250);
  return details;
}

async function waitForPoisonedStateSanitizer(window) {
  const details = await window.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const started = Date.now();
      const inspect = () => {
        const bodyText = document.body?.innerText || "";
        const shell = document.querySelector(".app-shell");
        const audio = document.querySelector("audio");
        const cards = document.querySelectorAll(".song-card").length;
        const rows = document.querySelectorAll(".metadata-row").length;
        const externalResources = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => /^https?:/i.test(name));
        const stored = JSON.parse(window.localStorage.getItem(${JSON.stringify(storageKey)}) || "{}");
        const persistedTracks = Array.isArray(stored.tracks) ? stored.tracks.length : 0;
        const persistedSlotIds = Array.isArray(stored.saveSlots)
          ? stored.saveSlots.flatMap((slot) => Array.isArray(slot.trackIds) ? slot.trackIds : [])
          : [];
        const ready = Boolean(shell) &&
          cards === 0 &&
          rows === 0 &&
          !bodyText.includes("Remote Probe") &&
          !audio?.getAttribute("src") &&
          persistedTracks === 0 &&
          persistedSlotIds.length === 0 &&
          externalResources.length === 0;

        if (ready || Date.now() - started > 7000) {
          resolve({
            ready,
            cards,
            rows,
            audioSrc: audio?.getAttribute("src") || "",
            bodyHasRemoteProbe: bodyText.includes("Remote Probe"),
            externalResources,
            persistedTracks,
            persistedSlotIds,
            title: document.title
          });
          return;
        }

        requestAnimationFrame(inspect);
      };

      inspect();
    })`
  );

  if (!details.ready) {
    throw new Error(`poisoned stored-state sanitizer did not become healthy: ${JSON.stringify(details)}`);
  }

  return details;
}

function createSmokeWindow() {
  return new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    show: false,
    backgroundColor: "#050609",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
}

async function smokeSurface(window, surface) {
  const consoleErrors = [];
  const runtimeErrors = [];
  const handleConsoleMessage = (_event, detailsOrLevel, maybeMessage) => {
    const level = typeof detailsOrLevel === "object" ? detailsOrLevel.level : detailsOrLevel;
    const message = typeof detailsOrLevel === "object" ? detailsOrLevel.message : maybeMessage;
    const renderedMessage = String(message ?? "");

    if (isErrorConsoleMessage(level, renderedMessage)) {
      consoleErrors.push(`console(${level}): ${renderedMessage}`);
    }
  };
  const handleRenderProcessGone = (_event, details) => {
    runtimeErrors.push(`render process gone: ${details.reason}`);
  };
  const handleUnresponsive = () => {
    runtimeErrors.push("window became unresponsive");
  };
  const handleFailLoad = (_event, errorCode, errorDescription, validatedURL) => {
    runtimeErrors.push(`load failed ${errorCode} ${errorDescription} ${validatedURL}`);
  };

  window.webContents.on("console-message", handleConsoleMessage);
  window.webContents.on("render-process-gone", handleRenderProcessGone);
  window.webContents.on("unresponsive", handleUnresponsive);
  window.webContents.on("did-fail-load", handleFailLoad);

  try {
    const url = `${pathToFileURL(distIndexPath).toString()}?${new URLSearchParams(surface.query).toString()}`;

    await window.loadURL(url);
    const details = await waitForStoreSurface(window, surface);
    const image = await window.capturePage();
    const size = image.getSize();
    const aspectRatio = size.width / size.height;

    if (size.width < 1440 || size.height < 900 || Math.abs(aspectRatio - 1.6) > 0.01) {
      throw new Error(`${surface.name} screenshot size was ${size.width}x${size.height}, expected 1440x900 or a high-DPI multiple.`);
    }

    if (!hasPixelVariation(image)) {
      throw new Error(`${surface.name} screenshot looked blank or nearly flat.`);
    }

    if (consoleErrors.length > 0 || runtimeErrors.length > 0) {
      throw new Error(`${surface.name} had runtime errors: ${[...runtimeErrors, ...consoleErrors].join(" | ")}`);
    }

    return details;
  } finally {
    window.webContents.removeListener("console-message", handleConsoleMessage);
    window.webContents.removeListener("render-process-gone", handleRenderProcessGone);
    window.webContents.removeListener("unresponsive", handleUnresponsive);
    window.webContents.removeListener("did-fail-load", handleFailLoad);
  }
}

async function smokePoisonedStoredState(window) {
  const url = pathToFileURL(distIndexPath).toString();
  const remoteTrack = {
    id: "remote-poison-probe",
    title: "Remote Probe",
    artist: "Network Fixture",
    album: "Should Not Load",
    fileName: "remote-probe.mp3",
    filePath: "/tmp/remote-probe.mp3",
    metadataSource: "Poisoned localStorage",
    size: 2048,
    url: "https://example.com/remote-probe.mp3",
    duration: 42,
    favorite: true,
    badge: "bolt",
    dateAdded: 1771339200000
  };

  await window.loadURL(url);
  await window.webContents.executeJavaScript(
    `window.localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(
      JSON.stringify({
        currentId: remoteTrack.id,
        activeShelf: "library",
        interference: "low",
        reducedMotion: false,
        scanlines: true,
        saveSlots: [{ id: "save-01", label: "SAVE 01", trackIds: [remoteTrack.id] }],
        takeoutSongs: [],
        tracks: [remoteTrack],
        volume: 0.72
      })
    )});`
  );
  await window.loadURL(url);

  const details = await waitForPoisonedStateSanitizer(window);

  await window.webContents.executeJavaScript(`window.localStorage.removeItem(${JSON.stringify(storageKey)});`);

  return {
    name: "poisoned-state",
    ...details
  };
}

async function main() {
  await fs.access(distIndexPath);

  const results = [];
  const window = createSmokeWindow();

  try {
    for (const surface of surfaces) {
      results.push({
        name: surface.name,
        ...(await smokeSurface(window, surface))
      });
    }
    results.push(await smokePoisonedStoredState(window));
  } finally {
    window.destroy();
  }

  console.log(`Store smoke checks: ${results.length} surfaces passed`);
  results.forEach((result) => {
    if (result.name === "poisoned-state") {
      console.log(
        `- ${result.name}: ${result.cards} cards, ${result.rows} rows, persisted tracks ${result.persistedTracks}, external resources ${result.externalResources.length}`
      );
      return;
    }

    console.log(
      `- ${result.name}: ${result.cards} cards, ${result.rows} rows, shelf ${result.shelfProgress}, thumb delta ${result.shelfThumbDeltaY}px, rail bass shift ${result.shelfRailBassShiftY}px, fill shift ${result.shelfFillBassShiftWidth}px, thumb bass delta ${result.shelfThumbBassDeltaY}px, style lock ${result.shelfFlowStyleLock ? "yes" : "no"}, layout ${result.layoutStable ? "stable" : "unstable"}`
    );
  });
}

app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
