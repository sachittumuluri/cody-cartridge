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
          ".deck",
          ".deck-hero",
          ".deck-catalog",
          ".deck-controls",
          ".metadata-panel",
          ".metadata-list",
          ".hero-title",
          ".stage-path",
          ".transport"
        ];
        const missingSelectors = requiredSelectors.filter((selector) => !document.querySelector(selector));
        const shell = document.querySelector(".app-shell");
        const cards = document.querySelectorAll(".metadata-cover").length;
        const rows = document.querySelectorAll(".metadata-row").length;
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
        const layout = {
          catalogToolbar: rectSnapshot(".catalog-toolbar"),
          documentScrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
          deckHero: rectSnapshot(".deck-hero"),
          deckCatalog: rectSnapshot(".deck-catalog"),
          deckControls: rectSnapshot(".deck-controls"),
          metadataPanel: rectSnapshot(".metadata-panel"),
          stagePath: rectSnapshot(".stage-path"),
          transport: rectSnapshot(".transport"),
          viewportWidth: window.innerWidth
        };
        layout.noHorizontalOverflow = layout.documentScrollWidth <= layout.viewportWidth + 2;
        const layoutStable =
          layout.noHorizontalOverflow &&
          insideViewportX(layout.deckHero) &&
          insideViewportX(layout.deckCatalog) &&
          insideViewportX(layout.deckControls) &&
          containsX(layout.deckHero, layout.stagePath) &&
          containsX(layout.deckControls, layout.transport) &&
          containsX(layout.deckCatalog, layout.metadataPanel) &&
          containsX(layout.deckCatalog, layout.catalogToolbar) &&
          (layout.deckHero?.height ?? 0) >= 200 &&
          (layout.deckCatalog?.height ?? 0) >= 120 &&
          (layout.deckControls?.height ?? 0) >= 60 &&
          (layout.stagePath?.height ?? 0) >= 20 &&
          (layout.metadataPanel?.height ?? 0) >= 100;

        // Bass reactivity must never reflow layout: snapshot key rects, drive
        // bass hard, re-measure. transform/opacity/filter-only visuals => 0 shift.
        const beforeCatalog = rectSnapshot(".metadata-panel");
        const beforeHero = rectSnapshot(".deck-hero");
        const beforeRow = rectSnapshot(".metadata-row");
        if (shell) {
          shell.classList.add("is-playing");
          shell.style.setProperty("--bass-level", "1");
          shell.style.setProperty("--bass-hit", "2.2");
          shell.style.setProperty("--bass-scale", "1.18");
          shell.style.setProperty("--bass-offset", "-24px");
          shell.style.setProperty("--bass-glow", "260px");
          shell.style.setProperty("--bass-opacity", "1");
          shell.style.setProperty("--beat-pulse", "1");
          shell.style.setProperty("--playback-progress", "83%");
        }
        const rectShift = (a, b) =>
          a && b
            ? Math.max(Math.abs(a.top - b.top), Math.abs(a.left - b.left), Math.abs(a.width - b.width), Math.abs(a.height - b.height))
            : 999;
        const catalogBassShift = rectShift(beforeCatalog, rectSnapshot(".metadata-panel"));
        const heroBassShift = rectShift(beforeHero, rectSnapshot(".deck-hero"));
        const rowBassShift = rectShift(beforeRow, rectSnapshot(".metadata-row"));

        const externalResources = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => !name.startsWith("file:") && !name.startsWith("data:") && !name.startsWith("blob:"));
        const ready = missingSelectors.length === 0 &&
          cards >= ${surface.minCards} &&
          rows >= ${surface.minCards} &&
          bodyText.includes(${JSON.stringify(surface.expectedText)}) &&
          catalogBassShift <= 0.5 &&
          heroBassShift <= 0.5 &&
          rowBassShift <= 0.5 &&
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
            catalogBassShift: Number(catalogBassShift.toFixed(3)),
            heroBassShift: Number(heroBassShift.toFixed(3)),
            rowBassShift: Number(rowBassShift.toFixed(3)),
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
      `- ${result.name}: ${result.cards} covers, ${result.rows} rows, catalog bass shift ${result.catalogBassShift}px, hero bass shift ${result.heroBassShift}px, row bass shift ${result.rowBassShift}px, layout ${result.layoutStable ? "stable" : "unstable"}`
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
