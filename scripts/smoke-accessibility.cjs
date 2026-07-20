const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");

const projectRoot = path.resolve(__dirname, "..");
const distIndexPath = path.join(projectRoot, "dist", "index.html");

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createWindow() {
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

async function waitForApp(window) {
  const ready = await window.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        const isReady = document.querySelector(".app-shell") &&
          document.querySelector(".deck-catalog") &&
          document.querySelector(".metadata-panel") &&
          document.querySelector(".metadata-row[role='button']") &&
          document.querySelector(".play-button") &&
          document.body?.innerText?.includes("Signal Drift");

        if (isReady || Date.now() - started > 7000) {
          resolve(Boolean(isReady));
          return;
        }

        requestAnimationFrame(check);
      };

      check();
    })`
  );

  if (!ready) {
    throw new Error("Timed out waiting for accessibility smoke app surface.");
  }

  await wait(250);
}

async function readAccessibilityState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const visibleText = (element) => (element.textContent || "").replace(/\\s+/g, " ").trim();
    const accessibleName = (element) =>
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      visibleText(element) ||
      element.getAttribute("placeholder") ||
      "";
    const focusableSelector = [
      "button",
      "input:not(.hidden-input)",
      "[role='button']",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");
    const focusables = Array.from(document.querySelectorAll(focusableSelector))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          element.getAttribute("aria-hidden") !== "true";
      })
      .map((element) => ({
        label: accessibleName(element),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        className: element.className || "",
        type: element.getAttribute("type") || "",
        disabled: Boolean(element.disabled)
      }));
    const unlabeled = focusables.filter((item) => !item.label);
    const activeElement = document.activeElement;
    const activeInfo = activeElement
      ? {
          label: accessibleName(activeElement),
          tag: activeElement.tagName.toLowerCase(),
          className: activeElement.className || "",
          value: activeElement.value || ""
        }
      : null;
    const trackList = document.querySelector(".track-list");
    const activeRow = document.querySelector(".metadata-row.active .metadata-title strong")?.textContent?.trim() || "";
    const shell = document.querySelector(".app-shell");
    const seek = document.querySelector('input[aria-label="Seek"]');
    // The volume control is a rotary ARIA slider (role=slider), not a range input.
    const volume = document.querySelector('[aria-label="Volume"][role="slider"]');
    const search = document.querySelector('input[aria-label="Filter catalog"]');

    return {
      activeInfo,
      activeRow,
      buttonCount: document.querySelectorAll("button").length,
      disabledPlayHasTitle: Boolean(document.querySelector(".play-button[disabled][title='Play']")),
      filterChipCount: document.querySelectorAll(".metadata-row .status-chip").length,
      focusableCount: focusables.length,
      labeledFocusableCount: focusables.length - unlabeled.length,
      metadataButtonRows: document.querySelectorAll(".metadata-row[role='button']").length,
      reducedMotionClass: shell?.classList.contains("reduced-motion") || false,
      searchAriaLabel: search?.getAttribute("aria-label") || "",
      seekRange: seek ? { max: seek.getAttribute("max"), min: seek.getAttribute("min"), type: seek.getAttribute("type") } : null,
      songCardButtons: document.querySelectorAll(".song-card[role='button'][aria-label]").length,
      trackListTabIndex: trackList?.getAttribute("tabindex") ?? null,
      unlabeled,
      volumeSlider: volume
        ? {
            role: volume.getAttribute("role"),
            min: volume.getAttribute("aria-valuemin"),
            max: volume.getAttribute("aria-valuemax"),
            now: volume.getAttribute("aria-valuenow"),
            tabIndex: volume.getAttribute("tabindex")
          }
        : null
    };
  })()`);
}

async function dispatchKeyboardEvent(window, selector, key) {
  return window.webContents.executeJavaScript(`(() => {
    const target = ${JSON.stringify(selector)} === "window" ? window : document.querySelector(${JSON.stringify(selector)});

    if (!target) {
      return false;
    }

    if (target.focus) {
      target.focus();
    }

    return target.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: ${JSON.stringify(key)}
    }));
  })()`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  await fs.access(distIndexPath);

  const window = createWindow();
  const url = `${pathToFileURL(distIndexPath).toString()}?${new URLSearchParams({
    "store-demo": "1",
    "store-shelf": "library",
    "store-reduced-motion": "1"
  }).toString()}`;

  try {
    await window.loadURL(url);
    await waitForApp(window);

    let state = await readAccessibilityState(window);

    assert(state.reducedMotionClass, "Store demo did not render reduced-motion shell state.");
    assert(state.focusableCount >= 24, `Expected at least 24 focusable controls, saw ${state.focusableCount}.`);
    assert(state.unlabeled.length === 0, `Found unlabeled focusable controls: ${JSON.stringify(state.unlabeled)}`);
    assert(state.metadataButtonRows >= 8, `Expected at least 8 keyboard metadata rows, saw ${state.metadataButtonRows}.`);
    assert(state.filterChipCount >= 5, `Expected clickable row status chips, saw ${state.filterChipCount}.`);
    assert(state.searchAriaLabel === "Filter catalog", "Catalog search is missing aria-label.");
    assert(state.seekRange?.type === "range" && state.seekRange.min === "0", "Seek control is not a labeled range input.");
    assert(
      state.volumeSlider?.role === "slider" &&
        state.volumeSlider.min === "0" &&
        Number.isFinite(Number(state.volumeSlider.now)) &&
        state.volumeSlider.tabIndex === "0",
      "Volume control is not a labeled, keyboard-focusable ARIA slider."
    );
    assert(state.disabledPlayHasTitle, "Disabled demo play button is missing Play title.");

    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "F" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "F" });
    await wait(120);
    state = await readAccessibilityState(window);
    assert(state.activeInfo?.label === "Filter catalog", `F shortcut did not focus catalog search: ${JSON.stringify(state.activeInfo)}`);

    await window.webContents.executeJavaScript(
      `(document.querySelector(".metadata-row.active[role='button']") || document.querySelector(".metadata-row[role='button']"))?.focus()`
    );
    const beforeRow = (await readAccessibilityState(window)).activeRow;
    await dispatchKeyboardEvent(window, ".metadata-row.active", "ArrowDown");
    await wait(220);
    state = await readAccessibilityState(window);
    assert(state.activeRow && state.activeRow !== beforeRow, "ArrowDown on a focused catalog row did not move the selection.");

    await dispatchKeyboardEvent(window, ".metadata-row.active", "ArrowUp");
    await wait(220);
    state = await readAccessibilityState(window);
    assert(state.activeRow === beforeRow, "ArrowUp on a focused catalog row did not restore the selection.");

    console.log("Accessibility smoke checks: 9 passed");
    console.log(`- focusables: ${state.focusableCount}, labeled: ${state.labeledFocusableCount}`);
    console.log(`- metadata rows: ${state.metadataButtonRows}`);
    console.log("- reduced motion: active");
    console.log("- keyboard shortcuts: search and catalog arrow navigation passed");

    // The Lathe: the tone bench must expose labeled sliders + switches.
    const bench = await window.webContents.executeJavaScript(`(async () => {
      const toggle = document.querySelector(".bench-toggle");

      if (!toggle) {
        return { toggleFound: false };
      }

      toggle.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const sliders = [...document.querySelectorAll(".lathe-bench [role='slider']")];
      const switches = [...document.querySelectorAll(".lathe-switch")];
      const state = {
        toggleFound: true,
        togglePressed: toggle.getAttribute("aria-pressed"),
        sliderCount: sliders.length,
        labeledSliders: sliders.filter((el) => (el.getAttribute("aria-label") || "").trim().length > 0).length,
        switchLabels: switches.map((el) => (el.textContent || "").trim())
      };
      toggle.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      state.closedAgain = !document.querySelector(".lathe-bench");
      return state;
    })()`);

    assert(bench.toggleFound, "Lathe TUNE toggle is missing.");
    assert(bench.sliderCount === 7, `Expected 7 Lathe bench sliders, saw ${bench.sliderCount}.`);
    assert(bench.labeledSliders === 7, `Lathe bench sliders missing aria-labels: ${JSON.stringify(bench)}`);
    assert(
      bench.switchLabels.includes("BYP") && bench.switchLabels.includes("FLAT"),
      `Lathe bench switches missing: ${JSON.stringify(bench.switchLabels)}`
    );
    assert(bench.closedAgain, "Lathe bench did not close on second toggle.");
    console.log("- lathe bench: 7 labeled tone sliders + BYP/FLAT switches passed");
  } finally {
    window.destroy();
  }
}

app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
