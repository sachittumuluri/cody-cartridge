const fs = require("node:fs/promises");
const path = require("node:path");
const { getReleaseStoreEnvValue, loadStoreEnv } = require("./store-env.cjs");

const projectRoot = path.resolve(__dirname, "..");
loadStoreEnv(projectRoot);

const outputDir = path.join(projectRoot, "app-store-assets", "site");
const supportEmail = getReleaseStoreEnvValue("CODY_SUPPORT_EMAIL", "TODO_SUPPORT_EMAIL");
const siteUrl = getReleaseStoreEnvValue("CODY_SITE_URL", "TODO_PUBLIC_SITE_URL").replace(/\/$/, "");
const supportContactLine = supportEmail === "TODO_SUPPORT_EMAIL" ? "Contact: pending public support email" : `Contact: ${supportEmail}`;
const supportPageUrl = siteUrl === "TODO_PUBLIC_SITE_URL" ? "supportUrl=pending" : `${siteUrl}/support.html`;
const privacyPageUrl = siteUrl === "TODO_PUBLIC_SITE_URL" ? "privacyPolicyUrl=pending" : `${siteUrl}/privacy.html`;

const pages = [
  {
    description: "Cody Cartridge is a local-first music player for macOS.",
    fileName: "index.html",
    nav: "Home",
    source: "",
    title: "Cody Cartridge"
  },
  {
    description: "App Store listing draft for Cody Cartridge.",
    fileName: "listing.html",
    nav: "Listing",
    source: "app-store-assets/APP_STORE_LISTING.md",
    title: "App Store Listing"
  },
  {
    description: "Privacy policy for Cody Cartridge.",
    fileName: "privacy.html",
    nav: "Privacy",
    source: "app-store-assets/PRIVACY_POLICY.md",
    title: "Privacy Policy"
  },
  {
    description: "Support information for Cody Cartridge.",
    fileName: "support.html",
    nav: "Support",
    source: "app-store-assets/SUPPORT.md",
    title: "Support"
  },
  {
    description: "Accessibility information for Cody Cartridge.",
    fileName: "accessibility.html",
    nav: "Accessibility",
    source: "app-store-assets/ACCESSIBILITY.md",
    title: "Accessibility"
  },
  {
    description: "Third-party notices for Cody Cartridge.",
    fileName: "third-party-notices.html",
    nav: "Notices",
    source: "app-store-assets/THIRD_PARTY_NOTICES.md",
    title: "Third-Party Notices"
  }
];
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", "&apos;");
}

function publicFileUrl(fileName) {
  return siteUrl === "TODO_PUBLIC_SITE_URL" ? `TODO_PUBLIC_SITE_URL/${fileName}` : `${siteUrl}/${fileName}`;
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  return html;
}

function normalizeMarkdown(markdown) {
  return markdown
    .replaceAll("TODO: Add public support email before App Store submission.", supportContactLine)
    .replaceAll("Pending release value: set `CODY_SUPPORT_EMAIL` before App Store submission.", supportContactLine)
    .replaceAll("TODO: Add support contact email or public support page before App Store submission.", supportContactLine)
    .replaceAll(
      "Pending release value: set `CODY_SUPPORT_EMAIL` and publish the support page before App Store submission.",
      supportContactLine
    )
    .replaceAll("TODO: Publish `app-store-assets/SUPPORT.md` as a public webpage with contact information.", supportPageUrl)
    .replaceAll("TODO: Publish `app-store-assets/PRIVACY_POLICY.md` as a public webpage.", privacyPageUrl);
}

function markdownToHtml(markdown) {
  const lines = normalizeMarkdown(markdown).split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${inlineMarkdown(trimmed.slice(3))}</h2>`);
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h1>${inlineMarkdown(trimmed.slice(2))}</h1>`);
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      list.push(trimmed.slice(2));
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks.join("\n");
}

function layout(page, body) {
  const navigation = pages
    .map((item) => {
      const href = item.fileName;
      const active = item.fileName === page.fileName ? ' aria-current="page"' : "";
      return `<a${active} href="${href}">${item.nav}</a>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(page.description)}" />
    <title>${escapeHtml(page.title)} - Cody Cartridge</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07080b;
        --panel: #101217;
        --line: rgba(156, 199, 216, 0.22);
        --text: #efefe7;
        --muted: rgba(239, 239, 231, 0.64);
        --accent: #8b111b;
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
          radial-gradient(circle at 70% 20%, rgba(139, 17, 27, 0.18), transparent 34%),
          var(--bg);
        font-family: "Courier New", ui-monospace, SFMono-Regular, Menlo, monospace;
        line-height: 1.6;
      }

      a {
        color: var(--blue);
      }

      .shell {
        width: min(1020px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 56px;
      }

      header {
        display: flex;
        gap: 18px;
        align-items: end;
        justify-content: space-between;
        padding: 14px 0 20px;
        border-bottom: 1px solid var(--line);
      }

      .brand {
        display: grid;
        gap: 4px;
      }

      .eyebrow,
      nav a,
      footer {
        color: var(--muted);
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .brand strong {
        color: var(--text);
        font-size: clamp(26px, 5vw, 48px);
        line-height: 1;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      nav {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }

      nav a {
        padding: 7px 10px;
        border: 1px solid rgba(156, 199, 216, 0.18);
        color: var(--muted);
        text-decoration: none;
      }

      nav a[aria-current="page"] {
        border-color: rgba(139, 17, 27, 0.84);
        color: var(--text);
        box-shadow: inset 3px 0 0 var(--accent);
      }

      main {
        display: grid;
        gap: 20px;
        margin-top: 24px;
        padding: 28px;
        border: 1px solid var(--line);
        background:
          linear-gradient(90deg, rgba(139, 17, 27, 0.08), transparent 42%),
          rgba(0, 0, 0, 0.42);
        box-shadow:
          inset 1px 1px 0 rgba(255, 255, 255, 0.06),
          0 28px 80px rgba(0, 0, 0, 0.34);
      }

      h1,
      h2,
      h3,
      p,
      ul {
        margin: 0;
      }

      h1 {
        color: #fff;
        font-size: clamp(28px, 5vw, 54px);
        line-height: 1.02;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      h2 {
        margin-top: 12px;
        color: var(--blue);
        font-size: 16px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h3 {
        color: #fff;
        font-size: 15px;
        text-transform: uppercase;
      }

      p,
      li {
        color: var(--muted);
        font-size: 15px;
      }

      ul {
        display: grid;
        gap: 7px;
        padding-left: 22px;
      }

      code {
        color: var(--text);
        background: rgba(156, 199, 216, 0.08);
      }

      .notice {
        padding: 12px 14px;
        border: 1px solid rgba(139, 17, 27, 0.5);
        color: var(--text);
        background: rgba(139, 17, 27, 0.12);
        font-size: 13px;
      }

      footer {
        margin-top: 24px;
      }

      @media (max-width: 720px) {
        header {
          align-items: start;
          flex-direction: column;
        }

        nav {
          justify-content: flex-start;
        }

        main {
          padding: 20px;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <div class="brand">
          <span class="eyebrow">Cody Noir // Local Index</span>
          <strong>Cody Cartridge</strong>
        </div>
        <nav aria-label="Site">
          ${navigation}
        </nav>
      </header>
      <main>
        ${supportEmail === "TODO_SUPPORT_EMAIL" ? '<p class="notice">Before publishing: set CODY_SUPPORT_EMAIL to a real support contact and rebuild this site.</p>' : ""}
        ${body}
      </main>
      <footer>
        Copyright © 2026 Sachit Tumuluri
      </footer>
    </div>
  </body>
</html>
`;
}

const landingShots = [
  { file: "01-library-1440x900.png", caption: "The archive shelf — every track wears its own signal lane" },
  { file: "04-lathe-bench-1440x900.png", caption: "The Lathe — per-cartridge tone bench with a real response curve" },
  { file: "02-takeout-map-1440x900.png", caption: "YouTube Music Takeout mapped against your local files" },
  { file: "03-missing-files-1440x900.png", caption: "The ghost shelf — missing signals rendered honestly" }
];

const landingFeatures = [
  {
    title: "Every track gets a body",
    text: "The deck decodes each file once and traces a spectral spine — a 240-column signature with BPM, key, and brightness. It becomes the seek bar, the shelf lanes, and generated pressing artwork."
  },
  {
    title: "Real instrumentation",
    text: "A live Web Audio graph drives the spectrum bank, twin glass-face VU meters with true ballistics, a groove lattice measuring rhythm tightness, and a machined AMP stage."
  },
  {
    title: "The Lathe",
    text: "A per-cartridge tone bench: EQ, stereo width, drive, reverb, and true varispeed with one-press EDITIONS (SLOWED+RVB, NIGHTCORE, NEXT ROOM). CUT presses your edit to a mastered WAV — rendered through the exact live chain."
  },
  {
    title: "Takeout, mapped",
    text: "Drop a YouTube Music Takeout export and the deck fuzzy-matches it against your files, scores confidence, and renders the unmatched remainder as a ghost library."
  },
  {
    title: "A machine, not a list",
    text: "Play locks the signal into alignment. Pause freezes the trace and shows the song's structure. Skips wind the tape. Interference lives inside the instruments."
  },
  {
    title: "Local by design",
    text: "No network entitlement, no scraping, no telemetry. Analysis, artwork, matching, and exports all run on-device against files you already own."
  }
];

function buildLandingHtml() {
  const demoUrl = siteUrl.replace(/\/site$/, "") || "https://sachittumuluri.github.io/cody-cartridge";
  const navigation = pages
    .map((item) => {
      const active = item.fileName === "index.html" ? ' aria-current="page"' : "";
      return `<a${active} href="${item.fileName}">${item.nav}</a>`;
    })
    .join("");
  const shots = landingShots
    .map(
      (shot) => `
        <figure>
          <img src="shots/${shot.file}" alt="${escapeHtml(shot.caption)}" loading="lazy" width="1440" height="900" />
          <figcaption>${escapeHtml(shot.caption)}</figcaption>
        </figure>`
    )
    .join("");
  const features = landingFeatures
    .map(
      (feature) => `
        <article>
          <h3>${escapeHtml(feature.title)}</h3>
          <p>${escapeHtml(feature.text)}</p>
        </article>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Cody Cartridge — a local-first Mac music player styled as a noir hardware deck. Every track gets a body; The Lathe re-cuts it." />
    <title>Local Music, Signal Mapped - Cody Cartridge</title>
    <style>
      :root {
        --bg: #08070c;
        --panel: #0e0d14;
        --line: rgba(156, 199, 216, 0.18);
        --text: #efefe7;
        --muted: rgba(239, 239, 231, 0.66);
        --accent: #9cc7d8;
        --ember: #8b111b;
        --bone: #d6c79b;
      }

      * { box-sizing: border-box; margin: 0; }

      body {
        background:
          repeating-linear-gradient(0deg, transparent 0 46px, rgba(156, 199, 216, 0.03) 46px 47px),
          var(--bg);
        color: var(--text);
        font-family: "Courier New", ui-monospace, monospace;
        line-height: 1.55;
      }

      .shell { max-width: 1060px; margin: 0 auto; padding: 26px 22px 60px; }

      header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }

      .brand { display: flex; align-items: center; gap: 12px; }
      .brand img { width: 44px; height: 44px; }
      .eyebrow { display: block; color: var(--accent); font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; }
      .brand strong { font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; }

      nav { display: flex; flex-wrap: wrap; gap: 4px 14px; }
      nav a { color: var(--muted); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none; }
      nav a:hover, nav a:focus-visible { color: var(--text); }
      nav a[aria-current="page"] { color: var(--bone); }

      .hero { padding: 54px 0 34px; text-align: left; }
      .hero h1 { font-size: clamp(28px, 5vw, 46px); letter-spacing: 0.04em; text-transform: uppercase; text-wrap: balance; }
      .hero h1 span { color: var(--ember); }
      .tagline { margin-top: 10px; max-width: 60ch; color: var(--muted); font-size: 16px; }

      .cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 26px; }
      .cta a, .cta span {
        display: inline-block; padding: 12px 20px; border: 1px solid var(--line);
        color: var(--text); font-size: 12px; font-weight: 700; letter-spacing: 0.16em;
        text-transform: uppercase; text-decoration: none;
      }
      .cta a.demo { border-color: rgba(214, 199, 155, 0.55); color: var(--bone); }
      .cta a.demo:hover { background: rgba(214, 199, 155, 0.08); }
      .cta span.store { color: var(--muted); border-style: dashed; }

      section { margin-top: 46px; }
      h2 { font-size: 13px; color: var(--accent); letter-spacing: 0.22em; text-transform: uppercase; padding-bottom: 12px; }

      .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
      .features article { padding: 18px; border: 1px solid var(--line); background: var(--panel); }
      .features h3 { font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--bone); padding-bottom: 8px; }
      .features p { color: var(--muted); font-size: 13.5px; }

      .gallery { display: grid; gap: 22px; }
      .gallery figure { border: 1px solid var(--line); background: var(--panel); padding: 10px; }
      .gallery img { display: block; width: 100%; height: auto; }
      .gallery figcaption { padding-top: 9px; color: var(--muted); font-size: 12px; letter-spacing: 0.06em; }

      .posture { border: 1px solid rgba(139, 17, 27, 0.45); background: rgba(139, 17, 27, 0.08); padding: 18px; }
      .posture p { color: var(--muted); font-size: 13.5px; max-width: 78ch; }

      footer { margin-top: 52px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 8px 18px; justify-content: space-between; }

      @media (max-width: 720px) {
        header { flex-direction: column; align-items: flex-start; }
        .hero { padding-top: 34px; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <div class="brand">
          <img src="icon.png" alt="" width="44" height="44" />
          <span>
            <span class="eyebrow">Cody Noir // Local Index</span>
            <strong>Cody Cartridge</strong>
          </span>
        </div>
        <nav aria-label="Site">${navigation}</nav>
      </header>
      <main>
        <section class="hero">
          <h1>Local music, <span>signal mapped</span>.</h1>
          <p class="tagline">A Mac music player styled as a noir hardware deck. It decodes the files you already own, gives every track a visual body, and hands you a lathe to re-cut them — slowed, widened, driven, reverbed, and pressed back to disk. Nothing leaves your machine.</p>
          <div class="cta">
            <span class="store">Mac App Store — submission in progress</span>
            <a class="demo" href="${demoUrl}/">Play the web demo</a>
          </div>
        </section>
        <section aria-label="Features">
          <h2>The Deck</h2>
          <div class="features">${features}</div>
        </section>
        <section aria-label="Screenshots">
          <h2>On The Bench</h2>
          <div class="gallery">${shots}</div>
        </section>
        <section aria-label="Privacy posture">
          <h2>Posture</h2>
          <div class="posture">
            <p>Local-only by design. No network entitlement, no accounts, no telemetry, no scraping — playback, analysis, artwork generation, Takeout matching, and WAV exports all run on-device against files you already own. Play counts and traces live in local storage and never leave the machine.</p>
          </div>
        </section>
      </main>
      <footer>
        <span>Copyright © 2026 Sachit Tumuluri</span>
        <span><a href="support.html" style="color: inherit;">Support</a> · <a href="privacy.html" style="color: inherit;">Privacy</a></span>
      </footer>
    </div>
  </body>
</html>
`;
}

async function main() {
  await fs.rm(outputDir, { force: true, recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  for (const page of pages) {
    if (!page.source) {
      continue;
    }

    const sourcePath = path.join(projectRoot, page.source);
    const markdown = await fs.readFile(sourcePath, "utf8");
    const html = layout(page, markdownToHtml(markdown));
    await fs.writeFile(path.join(outputDir, page.fileName), html, "utf8");
  }

  // Marketing landing: hero, screenshots, features, and the compliance nav.
  await fs.writeFile(path.join(outputDir, "index.html"), buildLandingHtml(), "utf8");
  await fs.mkdir(path.join(outputDir, "shots"), { recursive: true });
  await fs.copyFile(path.join(projectRoot, "build/icon.png"), path.join(outputDir, "icon.png"));

  for (const shot of landingShots) {
    await fs.copyFile(
      path.join(projectRoot, "app-store-assets/screenshots", shot.file),
      path.join(outputDir, "shots", shot.file)
    );
  }

  await fs.writeFile(
    path.join(outputDir, "robots.txt"),
    [
      "User-agent: *",
      "Allow: /",
      "",
      `Sitemap: ${publicFileUrl("sitemap.xml")}`,
      ""
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(outputDir, "sitemap.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...pages.map((page) => `  <url><loc>${escapeXml(publicFileUrl(page.fileName))}</loc></url>`),
      "</urlset>",
      ""
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(outputDir, "README.txt"),
    [
      "Cody Cartridge App Store support site.",
      "",
      "Build with:",
      "1. Fill ignored app-store-assets/site.env with the real CODY_SUPPORT_EMAIL and CODY_SITE_URL values.",
      "2. Run npm run site:store.",
      "",
      "Publish every file in this folder as a static website.",
      "Use privacy.html as the App Store Privacy Policy URL.",
      "Use support.html as the App Store Support URL.",
      "Use accessibility.html as the optional App Store Accessibility URL.",
      "Publish third-party-notices.html with the same site for dependency-license transparency.",
      "Publish robots.txt and sitemap.xml with the same origin so App Store and search crawlers can discover the public support pages.",
      "Publish _headers and vercel.json when your static host supports them so content types and cache policies match the release packet."
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(outputDir, "_headers"),
    [
      "/*.html",
      "  Content-Type: text/html; charset=utf-8",
      "  Cache-Control: public, max-age=300",
      "",
      "/robots.txt",
      "  Content-Type: text/plain; charset=utf-8",
      "  Cache-Control: public, max-age=3600",
      "",
      "/sitemap.xml",
      "  Content-Type: application/xml; charset=utf-8",
      "  Cache-Control: public, max-age=3600",
      ""
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(outputDir, "vercel.json"),
    `${JSON.stringify(
      {
        headers: [
          {
            source: "/(.*\\.html)",
            headers: [
              { key: "Content-Type", value: "text/html; charset=utf-8" },
              { key: "Cache-Control", value: "public, max-age=300" }
            ]
          },
          {
            source: "/robots.txt",
            headers: [
              { key: "Content-Type", value: "text/plain; charset=utf-8" },
              { key: "Cache-Control", value: "public, max-age=3600" }
            ]
          },
          {
            source: "/sitemap.xml",
            headers: [
              { key: "Content-Type", value: "application/xml; charset=utf-8" },
              { key: "Cache-Control", value: "public, max-age=3600" }
            ]
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(`Built App Store support site at ${path.relative(projectRoot, outputDir)}`);

  if (supportEmail === "TODO_SUPPORT_EMAIL") {
    console.warn("Set CODY_SUPPORT_EMAIL before publishing the site.");
  }

  if (siteUrl === "TODO_PUBLIC_SITE_URL") {
    console.warn("Set CODY_SITE_URL before using generated URLs in App Store Connect.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
