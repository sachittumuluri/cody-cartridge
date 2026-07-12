#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const passes = [];
const failures = [];

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (condition) {
    pass(message);
  } else {
    fail(message);
  }
}

function main() {
  const main = readText("electron/main.cjs");
  const preload = readText("electron/preload.cjs");
  const index = readText("index.html");
  const pkg = JSON.parse(readText("package.json"));
  const fuses = pkg.build?.electronFuses ?? {};

  assert(main.includes("contextIsolation: true"), "Main BrowserWindow enables contextIsolation");
  assert(main.includes("nodeIntegration: false"), "Main BrowserWindow disables nodeIntegration");
  assert(main.includes("sandbox: true"), "BrowserWindow renderers enable sandbox");
  assert(main.includes("configureSessionSecurity(mainWindow.webContents.session)"), "Main window installs session permission guard");
  assert(main.includes("configureSessionSecurity(documentWindow.webContents.session)"), "Document windows install session permission guard");
  assert(main.includes("setPermissionRequestHandler"), "Electron shell denies permission requests");
  assert(main.includes("setPermissionCheckHandler"), "Electron shell denies permission checks");
  assert(main.includes("setWindowOpenHandler(() => ({ action: \"deny\" }))"), "Electron shell denies new window requests");
  assert(main.includes("will-navigate"), "Electron shell guards top-level navigation");
  assert(main.includes("isMainWindowNavigationAllowed"), "Main window has explicit navigation allowlist");
  assert(main.includes("isDocumentWindowNavigationAllowed"), "Document windows have explicit navigation allowlist");
  assert(main.includes("scheme: \"cody-app\""), "Electron shell registers custom app protocol");
  assert(main.includes("protocol.handle(\"cody-app\""), "Electron shell serves packaged renderer through custom app protocol");
  assert(main.includes("getAppProtocolFilePath"), "Electron shell resolves app protocol paths through a containment guard");
  assert(main.includes("isTrustedRendererEvent"), "Electron IPC validates trusted sender frame");
  assert(main.includes("withTrustedRenderer"), "Electron IPC handlers use trusted sender wrapper");
  assert((main.match(/ipcMain\.handle\("music:/g) ?? []).length === 7, "Electron shell exposes expected music IPC handler count");
  assert((main.match(/ipcMain\.handle\("music:[^"]+", withTrustedRenderer/g) ?? []).length === 7, "All music IPC handlers are trusted-renderer guarded");
  assert(main.includes("event.senderFrame?.url"), "Trusted IPC guard checks sender frame URL");
  assert(main.includes("filterRendererProvidedPaths"), "Electron shell filters renderer-provided file paths");
  assert(main.includes("if (!process.mas)"), "Renderer-provided path filtering preserves non-MAS local imports");
  assert(main.includes("findSecurityScopedBookmark(filePath)"), "MAS renderer-provided paths require stored security-scoped bookmarks");
  assert(main.includes("function isAllowedMediaPath(filePath)"), "Electron shell centralizes media path access policy");
  assert(main.includes("return filePaths.filter(isAllowedMediaPath);"), "Renderer-provided path filtering reuses media path access policy");
  assert(
    (main.match(/if \(!isAllowedMediaPath\(mediaPath\)\) {\n\s+return new Response\("", { status: 404 }\);\n\s+}/g) ?? []).length === 2,
    "Custom media/art protocol handlers reject paths before filesystem access"
  );
  assert(
    main.includes("music:import-audio-paths\", withTrustedRenderer(async (_event, filePaths) => {\n    const safePaths = filterRendererProvidedPaths(filePaths);"),
    "Renderer audio path imports use MAS-aware path filter"
  );
  assert(
    main.includes("music:read-takeout-csv-paths\", withTrustedRenderer(async (_event, filePaths) => {\n    const safePaths = filterRendererProvidedPaths(filePaths);"),
    "Renderer Takeout CSV path imports use MAS-aware path filter"
  );
  assert(main.includes("devServerOrigin"), "Development server origin is centralized");
  assert(main.includes("loadURL(getRendererUrl())"), "Packaged app loads renderer through custom app protocol");
  assert(main.includes("loadURL(devServerOrigin)"), "Development app only loads the local Vite origin");
  assert(!main.includes("require(\"electron\").shell") && !main.includes("shell.openExternal"), "Electron shell does not open external URLs");
  assert(!main.includes("eval("), "Electron main does not use eval");
  assert(!preload.includes("remote"), "Preload does not expose Electron remote");
  assert(preload.includes("contextBridge.exposeInMainWorld(\"musicHost\""), "Preload exposes one named bridge");
  assert(!preload.includes("ipcRenderer.send("), "Preload avoids fire-and-forget IPC sends");
  assert(!preload.includes("ipcRenderer.on(") || preload.includes("app-menu:command"), "Preload only subscribes to menu command events");
  assert(index.includes("Content-Security-Policy"), "Renderer HTML declares CSP");
  assert(index.includes("script-src 'self'"), "Renderer CSP restricts scripts to self");
  assert(!index.includes("'unsafe-eval'"), "Renderer CSP does not allow unsafe-eval");
  assert(!index.includes(" file:"), "Renderer CSP does not grant file: resource access");
  assert(index.includes("cody-art:"), "Renderer CSP allows custom artwork protocol");
  assert(index.includes("cody-media:"), "Renderer CSP allows custom media protocol");
  assert(pkg.build?.mas?.hardenedRuntime === true, "MAS build uses hardened runtime");
  assert(pkg.build?.masDev?.hardenedRuntime === true, "MAS development build uses hardened runtime");
  assert(fuses.runAsNode === false, "Electron fuse disables ELECTRON_RUN_AS_NODE");
  assert(fuses.enableCookieEncryption === true, "Electron fuse enables cookie encryption");
  assert(fuses.enableNodeOptionsEnvironmentVariable === false, "Electron fuse disables NODE_OPTIONS");
  assert(fuses.enableNodeCliInspectArguments === false, "Electron fuse disables Node inspector CLI arguments");
  assert(fuses.enableEmbeddedAsarIntegrityValidation === true, "Electron fuse enables embedded ASAR integrity validation");
  assert(fuses.onlyLoadAppFromAsar === true, "Electron fuse restricts app loading to app.asar");
  assert(fuses.loadBrowserProcessSpecificV8Snapshot === false, "Electron fuse does not require a missing browser-process V8 snapshot");
  assert(fuses.grantFileProtocolExtraPrivileges === false, "Electron fuse disables file protocol extra privileges");

  console.log(`Electron security checks: ${passes.length} passed, ${failures.length} failures`);
  passes.forEach((message) => console.log(`PASS ${message}`));

  if (failures.length > 0) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    process.exitCode = 1;
  }
}

main();
