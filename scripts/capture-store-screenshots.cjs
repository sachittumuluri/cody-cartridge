const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");

const projectRoot = path.resolve(__dirname, "..");
const distIndexPath = path.join(projectRoot, "dist", "index.html");
const outputDir = path.join(projectRoot, "app-store-assets", "screenshots");
const manifestPath = path.join(outputDir, "STORE_SCREENSHOTS.json");
const appStoreConnectSpec = {
  acceptedFormats: ["jpeg", "jpg", "png"],
  acceptedSizes: [
    { height: 800, width: 1280 },
    { height: 900, width: 1440 },
    { height: 1600, width: 2560 },
    { height: 1800, width: 2880 }
  ],
  aspectRatio: "16:10",
  count: { max: 10, min: 1 },
  platform: "macOS",
  requiredFor: "Mac apps",
  sourceUrl: "https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/"
};
const screenshots = [
  {
    fileName: "01-library-1440x900.png",
    id: "library",
    label: "Local library shelf",
    query: { "store-demo": "1", "store-shelf": "library", "store-poster": "1" },
    width: 1440,
    height: 900
  },
  {
    fileName: "02-takeout-map-1440x900.png",
    id: "takeout",
    label: "YouTube Music Takeout map",
    query: { "store-demo": "1", "store-shelf": "takeout", "store-poster": "1" },
    width: 1440,
    height: 900
  },
  {
    fileName: "03-missing-files-1440x900.png",
    id: "missing",
    label: "Missing local files",
    query: { "store-demo": "1", "store-shelf": "missing", "store-poster": "1" },
    width: 1440,
    height: 900
  },
  {
    fileName: "04-lathe-bench-1440x900.png",
    id: "lathe",
    label: "The Lathe tone bench",
    query: { "store-demo": "1", "store-shelf": "library", "store-poster": "1", "store-lathe": "1" },
    readySelector: ".lathe-bench",
    width: 1440,
    height: 900
  }
];

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForDemoRender(window, extraSelector) {
  const rendered = await window.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const started = Date.now();
      const extraSelector = ${JSON.stringify(extraSelector ?? null)};
      const check = () => {
        const ready =
          document.querySelector(".deck-hero") &&
          document.querySelector(".metadata-panel") &&
          document.querySelector(".deck-controls") &&
          document.querySelector(".hero-title") &&
          (!extraSelector || document.querySelector(extraSelector));

        if (ready || Date.now() - started > 6000) {
          resolve(Boolean(ready));
          return;
        }

        requestAnimationFrame(check);
      };

      check();
    })`
  );

  if (!rendered) {
    throw new Error("Timed out waiting for store demo UI to render.");
  }

  await wait(450);
}

async function captureScreenshot(window, config) {
  window.setContentSize(config.width, config.height);

  const url = `${pathToFileURL(distIndexPath).toString()}?${new URLSearchParams(config.query).toString()}`;
  await window.loadURL(url);
  await waitForDemoRender(window, config.readySelector);
  await window.webContents.executeJavaScript('document.documentElement.classList.add("store-capture");');

  const image = await window.capturePage();
  const normalized = image.resize({
    width: config.width,
    height: config.height,
    quality: "best"
  });
  const outputPath = path.join(outputDir, config.fileName);
  const buffer = normalized.toPNG();
  const relativePath = path.relative(projectRoot, outputPath);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  await fs.writeFile(outputPath, buffer);
  return {
    bytes: buffer.length,
    filePath: relativePath,
    height: config.height,
    id: config.id,
    label: config.label,
    appStoreConnectAccepted: appStoreConnectSpec.acceptedSizes.some(
      (size) => size.width === config.width && size.height === config.height
    ),
    format: "png",
    query: config.query,
    sha256,
    source: "store-demo",
    sourceUrl: `dist/index.html?${new URLSearchParams(config.query).toString()}`,
    width: config.width
  };
}

async function main() {
  await fs.access(distIndexPath);
  await fs.mkdir(outputDir, { recursive: true });

  const manifestEntries = [];
  const window = new BrowserWindow({
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

  try {
    for (const config of screenshots) {
      manifestEntries.push(await captureScreenshot(window, config));
    }
  } finally {
    window.destroy();
  }
  const manifest = {
    appStoreConnectSpec,
    generatedAt: new Date().toISOString(),
    renderer: "dist/index.html",
    screenshotCount: manifestEntries.length,
    source: "store-demo",
    viewport: {
      height: 900,
      width: 1440
    },
    screenshots: manifestEntries
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Captured ${manifestEntries.length} App Store screenshots:`);
  manifestEntries.forEach((entry) => console.log(`- ${entry.filePath}`));
  console.log(`Built ${path.relative(projectRoot, manifestPath)}`);
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.quit();
    process.exitCode = 1;
  });
