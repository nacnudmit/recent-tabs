# Configurable Recent-Tabs Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the extension's hardcoded 5-tab-per-window limit with a user-configurable choice of 5, 10, 15, or 20, set via a dedicated options page and synced across Chrome installs via `chrome.storage.sync`.

**Architecture:** A new `options.html`/`options.js` page lets the user pick a value, saved to `chrome.storage.sync` under the key `maxRecent`. `background.js`'s hardcoded `MAX_RECENT` constant becomes a mutable `maxRecent` variable, hydrated from storage at startup (folded into the existing `recentByWindow` hydration so there's still just one `hydrationPromise`) and kept live via a `chrome.storage.onChanged` listener.

**Tech Stack:** Same as the rest of the extension — vanilla JS, Manifest V3 (`chrome.storage.sync`, `chrome.storage.onChanged`, `options_page`), no build step, no dependencies.

## Global Constraints

- Manifest V3 only, no build step, no dependencies.
- Allowed values: 5, 10, 15, 20. Default: 5 (matches current hardcoded behavior).
- Setting is stored in `chrome.storage.sync` (persists across restarts, syncs across devices) — separate from `chrome.storage.session` (used for the tab-history data itself, which intentionally does not persist).
- Lowering the limit does NOT retroactively shrink an already-longer list — it only caps future growth. No new trimming logic is needed for this; it falls out of the existing write-only trim check.
- No automated test framework — verification is manual, in real Chrome, consistent with the rest of the project.
- The `"storage"` permission already exists in `manifest.json` and covers both `chrome.storage.session` and `chrome.storage.sync` — no permission changes needed.

---

### Task 1: Options page

**Files:**
- Modify: `manifest.json`
- Create: `options.html`
- Create: `options.js`

**Interfaces:**
- Produces: a `chrome.storage.sync` entry under the key `maxRecent` (a plain number: 5, 10, 15, or 20), written whenever the user changes the radio selection. Task 2 reads this key; no other interface is shared between these files and background.js.

- [ ] **Step 1: Add the options page to `manifest.json`**

Add an `"options_page"` entry. The full file should read:

```json
{
  "manifest_version": 3,
  "name": "Recent Tabs",
  "version": "1.0.0",
  "description": "Cycle back through the last 5 tabs used in each Chrome window.",
  "permissions": ["tabs", "storage"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "options_page": "options.html",
  "commands": {
    "cycle-recent-tabs": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y"
      },
      "description": "Cycle back through recently used tabs in this window"
    }
  }
}
```

- [ ] **Step 2: Write `options.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Recent Tabs Settings</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 320px; margin: 24px; }
    h1 { font-size: 16px; margin: 0 0 12px; }
    label { display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Tabs remembered per window</h1>
  <form id="settings-form">
    <label><input type="radio" name="maxRecent" value="5"> 5</label>
    <label><input type="radio" name="maxRecent" value="10"> 10</label>
    <label><input type="radio" name="maxRecent" value="15"> 15</label>
    <label><input type="radio" name="maxRecent" value="20"> 20</label>
  </form>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `options.js`**

```javascript
const DEFAULT_MAX_RECENT = 5;

async function loadSetting() {
  const stored = await chrome.storage.sync.get("maxRecent");
  const value = stored.maxRecent || DEFAULT_MAX_RECENT;
  const radio = document.querySelector(`input[name="maxRecent"][value="${value}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function wireUpChangeHandler() {
  const form = document.getElementById("settings-form");
  form.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    chrome.storage.sync.set({ maxRecent: value });
  });
}

wireUpChangeHandler();
loadSetting();
```

- [ ] **Step 4: Manually verify**

No automated test framework, no Chrome available in this sandboxed environment. Instead:
- Confirm `manifest.json` is still valid JSON after the edit.
- Run `node --check options.js` to confirm valid syntax.
- Confirm `options.html`'s four radio button values are exactly `5`, `10`, `15`, `20` (matching the Global Constraints' allowed values) and share the same `name="maxRecent"` so they behave as a single-choice group.
- Report that full Chrome-based manual verification (opening the options page, selecting a value, confirming it's saved to `chrome.storage.sync` and pre-selected on reload) still needs a human with real Chrome — covered by Task 3.

- [ ] **Step 5: Commit**

```bash
git add manifest.json options.html options.js
git commit -m "Add options page for configuring the recent-tabs limit"
```

---

### Task 2: Wire the configurable limit into background.js

**Files:**
- Modify: `background.js`

**Interfaces:**
- Consumes: the `chrome.storage.sync` `maxRecent` key written by Task 1's options page.
- Produces: nothing new consumed by other files — `recordActivation`'s existing trim behavior (relied on by the cycling and popup-listing logic already in place) now reads a variable instead of a constant, with no change to its own interface.

- [ ] **Step 1: Replace the hardcoded constant with a mutable variable**

Change the very first line of `background.js` from:
```javascript
const MAX_RECENT = 5;
```
to:
```javascript
let maxRecent = 5;
```

- [ ] **Step 2: Fold `maxRecent` hydration into the existing `hydrateFromStorage` function**

Replace the entire existing `hydrateFromStorage` function (and the `const hydrationPromise = hydrateFromStorage();` line right after it) with:

```javascript
async function hydrateFromStorage() {
  const [sessionStored, syncStored] = await Promise.all([
    chrome.storage.session.get("recentByWindow"),
    chrome.storage.sync.get("maxRecent"),
  ]);
  if (sessionStored.recentByWindow) {
    for (const [windowId, list] of Object.entries(sessionStored.recentByWindow)) {
      recentByWindow.set(Number(windowId), list);
    }
  }
  if (syncStored.maxRecent) {
    maxRecent = syncStored.maxRecent;
  }
}
const hydrationPromise = hydrateFromStorage();
```

(This is a drop-in replacement — every existing listener that already does `await hydrationPromise;` continues to work unchanged, since it's still the same single promise, now covering both pieces of state.)

- [ ] **Step 3: Add a live-update listener for setting changes**

Add this near the other top-level `chrome.*` listener registrations (anywhere after the `hydrateFromStorage`/`hydrationPromise` block is fine — e.g. right before the `chrome.tabs.onActivated` listener):

```javascript
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.maxRecent) {
    maxRecent = changes.maxRecent.newValue;
  }
});
```

- [ ] **Step 4: Update the trim check to use the variable**

In `recordActivation`, change:
```javascript
  if (list.length > MAX_RECENT) {
    list.length = MAX_RECENT;
  }
```
to:
```javascript
  if (list.length > maxRecent) {
    list.length = maxRecent;
  }
```

- [ ] **Step 5: Manually verify**

No automated test framework, no Chrome available in this sandboxed environment. Instead:
- Run `node --check background.js` to confirm valid syntax.
- Read through the full modified file and confirm: no remaining references to `MAX_RECENT` (the old constant name) anywhere in the file; `maxRecent` is declared with `let` (not `const`, since it's now reassigned); the `chrome.storage.onChanged` listener only reacts to the `sync` area and the `maxRecent` key specifically (not every storage change); `hydrationPromise` is still the single promise every existing listener awaits, unchanged in that respect.
- Report that full Chrome-based manual verification (changing the setting and confirming it takes effect, confirming a lowered limit doesn't retroactively shrink an existing list, confirming cycling wraps through a longer list) still needs a human with real Chrome — covered by Task 3.

- [ ] **Step 6: Commit**

```bash
git add background.js
git commit -m "Read the recent-tabs limit from the options page setting"
```

---

### Task 3: Full end-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Setting persists and applies**

1. Reload the extension in `chrome://extensions`.
2. Open the options page (right-click the extension icon → Options, or the "Details" link on `chrome://extensions`). Confirm "5" is selected by default.
3. Select "10". Switch between more than 5 tabs in a window (e.g. 7 tabs). Open the popup and confirm the list grows past 5, up to 10.

- [ ] **Step 2: Lowering the limit doesn't retroactively shrink**

1. With a window's list already longer than 5 (from Step 1), open the options page and select "5".
2. Without switching any more tabs, open the popup and confirm the list is still longer than 5 (not immediately trimmed).
3. Switch one more tab. Open the popup again and confirm the list is now trimmed to 5 going forward.

- [ ] **Step 3: Persistence across restart**

1. Set the limit to 15.
2. Fully quit and reopen Chrome.
3. Open the options page and confirm "15" is still selected.

- [ ] **Step 4: Cycling works through a longer list**

1. Set the limit to 10 and build up a window's list to more than 5 tabs.
2. Use the keyboard shortcut to cycle through the list. Confirm it wraps correctly through the full length (not just the first 5) before repeating.

- [ ] **Step 5: Commit a final marker if any fixes were needed**

If steps 1-4 all pass with no code changes, no commit is needed here. If any bug was found and fixed during this pass, commit it:

```bash
git add -A
git commit -m "Fix issue found during end-to-end verification: <describe>"
```
