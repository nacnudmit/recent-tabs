# Chrome Web Store Submission Prep — Design

This prepares the Recent Tabs extension for submission to the Chrome Web Store as an **unlisted** item (installable via direct link, not searchable). It covers everything that can be prepared in the repository; the actual submission (developer registration, the one-time $5 fee, uploading the package, pasting in listing copy) is a manual process the user performs themselves in the Chrome Web Store Developer Dashboard, since it involves account and payment actions.

## Scope

In scope (this repo, this plan):
1. An icon set (16/48/128px PNGs), wired into `manifest.json`.
2. A standalone privacy policy page, for the user to host wherever they choose and link from the dashboard.
3. Manifest updates: `icons` block, version bump to `1.1.0`.
4. A packaging script producing a clean submission zip.
5. Draft store-listing copy (summary, description, permission justifications) as a markdown file for the user to paste into the dashboard.
6. A submission checklist documenting the manual dashboard steps.

Out of scope: the actual Chrome Web Store submission itself, hosting the privacy policy, creating a developer account, payment.

## Icon

A simple, flat, two-shape icon: two overlapping rounded-rectangle "tab" shapes with a small circular arrow accent (cycling/recency). Rendered programmatically with Pillow (already available in this environment) at 128×128, then downscaled with high-quality resampling to produce 48×48 and 16×16 versions — a single source-of-truth drawing rather than three independently hand-tuned images, which is simpler to implement correctly and appropriate for a small personal-use extension icon (not aiming for pixel-perfect hinting at 16px).

Palette: a blue tab-shape (`#4A90D9`-ish, consistent with a generic "productivity tool" feel) with a white cycling-arrow accent, on a transparent background — standard for Chrome extension toolbar icons, which render on both light and dark toolbar themes.

Files: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`.

## Manifest changes

```json
"icons": {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
},
"action": {
  "default_popup": "popup.html",
  "default_icon": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

`version` bumps from `"1.0.0"` to `"1.1.0"` — user-visible functionality (cycling overlay, configurable limit, options page) has shipped since `1.0.0`, and the Chrome Web Store expects the manifest version to reflect what's being submitted.

## Privacy policy

A standalone `privacy-policy.html`, self-contained (no external assets, so it can be hosted anywhere as a single file — GitHub Pages, a Gist's raw view, Google Sites, etc.). Content, stated plainly and accurately based on the actual code:

- The extension does not collect, transmit, sell, or share any user data with any third party or server. There is no backend, no analytics, no network requests of any kind.
- Tab titles, favicon URLs, and tab/window IDs are read via the `tabs` permission solely to build the in-memory recency list and render it in the popup — this data never leaves the browser.
- Data storage: `chrome.storage.session` (per-window recent-tabs lists, cleared on browser restart) and `chrome.storage.sync` (the single "tabs remembered" setting, synced by Chrome's own account-sync mechanism across the user's own signed-in devices — not accessible to the developer or anyone else).
- No account, sign-in, or personal information is collected by the extension itself.

## Packaging script

A shell script (`package.sh`) that builds `recent-tabs.zip` containing only: `manifest.json`, `background.js`, `popup.html`, `popup.js`, `options.html`, `options.js`, `icons/`. Explicitly excludes `docs/`, `.git`, `.claude`, `.DS_Store`, `privacy-policy.html`, `package.sh` itself, and the store-listing/checklist markdown files — none of those belong inside the extension package. The script always rebuilds the zip fresh (removes any existing `recent-tabs.zip` first) so it can be re-run safely after future changes.

## Store listing copy

A markdown file (`docs/store-listing.md`, not part of the packaged extension) with:
- **Summary** (≤132 characters): a one-line pitch.
- **Description**: a short paragraph explaining the shortcut cycling, the popup overlay, and the configurable limit.
- **Single purpose justification**: required by Chrome Web Store policy — a one-sentence statement of the extension's single purpose (recency-based tab navigation).
- **Permission justifications**: one sentence each for `tabs` (read tab metadata to build the recency list and switch tabs) and `storage` (persist the recency list and the user's chosen limit).

## Submission checklist

A markdown file (`docs/submission-checklist.md`) listing the manual steps in order: register as a Chrome Web Store developer (one-time $5 fee), create a new item in the dashboard, upload `recent-tabs.zip`, set visibility to **Unlisted**, paste in the listing copy from `docs/store-listing.md`, paste in the hosted privacy policy URL, upload the 128px icon as the store listing icon if requested separately from the manifest icon, submit for review.

## Testing

No automated framework, consistent with the rest of the project. Manual verification:
- Load the extension unpacked after the manifest/icon changes and confirm the icon renders correctly in the toolbar and on `chrome://extensions` (not a broken-image icon).
- Open `privacy-policy.html` directly in a browser and confirm it renders as a readable, self-contained page.
- Run `package.sh` and confirm `recent-tabs.zip` contains exactly the expected files (no docs, no dev artifacts) and that re-loading the unpacked *contents of the zip* (extracted to a fresh folder) works identically to the source tree.
