Cody Cartridge App Store support site.

Build with:
1. Fill ignored app-store-assets/site.env with the real CODY_SUPPORT_EMAIL and CODY_SITE_URL values.
2. Run npm run site:store.

Publish every file in this folder as a static website.
Use privacy.html as the App Store Privacy Policy URL.
Use support.html as the App Store Support URL.
Use accessibility.html as the optional App Store Accessibility URL.
Publish third-party-notices.html with the same site for dependency-license transparency.
Publish robots.txt and sitemap.xml with the same origin so App Store and search crawlers can discover the public support pages.
Publish _headers and vercel.json when your static host supports them so content types and cache policies match the release packet.