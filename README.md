# Recent Tabs

A Manifest V3 extension that tracks recently used tabs **per window** and lets you jump back to them from the toolbar popup or with **Ctrl/Cmd+Shift+Y**.

The same source tree loads in **Chrome** and **Firefox**. Store packages differ only in the generated `manifest.json` (see below).

## Load unpacked (development)

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository folder.
4. The source `manifest.json` includes `background.service_worker`, which Chrome uses. Extra Firefox-only keys (`background.scripts`, `browser_specific_settings`, `options_ui`) are ignored by current Chrome.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select this repository's `manifest.json` (or any file in the folder).
4. Firefox MV3 does not run `background.service_worker`. It uses `background.scripts` from the same source manifest (Firefox 121+). The add-on id is `recent-tabs@nacnudmit`.

Temporary add-ons are removed when Firefox restarts. For a signed install, submit the Firefox zip to [addons.mozilla.org](https://addons.mozilla.org/).

## Package for the stores

```bash
./package.sh              # recent-tabs.zip — Chrome Web Store (default, unchanged)
./package.sh firefox      # recent-tabs-firefox.zip — AMO
./package.sh all          # both zips
```

### How the two packages differ

Both zips contain the same extension files (`background.js`, popup, options, icons). Only `manifest.json` is rewritten:

| | Chrome zip (`recent-tabs.zip`) | Firefox zip (`recent-tabs-firefox.zip`) |
| --- | --- | --- |
| Background | `service_worker` only | `scripts` only |
| Options | `options_page` | `options_ui.page` |
| Firefox id | omitted | `browser_specific_settings.gecko` |

The source `manifest.json` keeps **both** background keys plus both options keys so the folder itself can be loaded in either browser without a build step.

Chrome Web Store validators have historically rejected MV3 packages that include `background.scripts`, so the Chrome zip strips that key. Firefox does not implement `background.service_worker`, so the Firefox zip uses `background.scripts` and a gecko id (required for AMO).

## Keyboard shortcut

Suggested default: **Ctrl+Shift+Y** (Command+Shift+Y on Mac).

- Chrome: remappable at `chrome://extensions/shortcuts`
- Firefox: `about:addons` → gear → **Manage Extension Shortcuts**

If `action.openPopup()` is unavailable, the cycle command still switches tabs immediately (same fallback as before).

## Privacy

The extension does not collect or transmit user data. See [privacy-policy.html](privacy-policy.html).
