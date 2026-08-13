# Recent Tabs Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that tracks, per window, the last 5 tabs used, lets the user cycle backward through them with a keyboard shortcut, and lists them in a popup for direct navigation.

**Architecture:** A background service worker (`background.js`) maintains an in-memory MRU (most-recently-used) tab-ID list per window, updated via `chrome.tabs` event listeners. A `commands` keyboard shortcut cycles through the focused window's list. A popup (`popup.html`/`popup.js`) reads the current window's list via message passing and renders it as a clickable list.

**Tech Stack:** Vanilla JavaScript (no build step, no frameworks), Chrome Extension Manifest V3 APIs (`chrome.tabs`, `chrome.windows`, `chrome.commands`, `chrome.runtime`, `chrome.action`).

## Global Constraints

- Manifest V3 only (no MV2 APIs like persistent background pages).
- No external dependencies, no build/bundle step — plain JS/HTML/CSS loaded directly.
- No persistence — all state lives in the service worker's memory for the session (per spec's "Persistence: None").
- Max 5 tabs tracked per window, ordered most-recent-first (index 0 = most recent).
- Default shortcut: `Ctrl+Shift+Y` (`Cmd+Shift+Y` on Mac), user-remappable via `chrome://extensions/shortcuts`.
- No automated test framework — this project is verified via manual load-unpacked testing in Chrome, per the spec's Testing section. Every task ends with explicit manual verification steps instead of an automated test run.

---

### Task 1: Extension scaffold (manifest + empty entry points)

**Files:**
- Create: `manifest.json`
- Create: `background.js`
- Create: `popup.html`
- Create: `popup.js`

**Interfaces:**
- Produces: a loadable-but-inert MV3 extension — `background.js` is the registered service worker (empty for now except a startup log), `popup.html`/`popup.js` is the registered action popup (empty shell for now). Later tasks fill in behavior.

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Recent Tabs",
  "version": "1.0.0",
  "description": "Cycle back through the last 5 tabs used in each Chrome window.",
  "permissions": ["tabs"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  },
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

- [ ] **Step 2: Write a minimal `background.js`**

```javascript
console.log("Recent Tabs: service worker loaded");
```

- [ ] **Step 3: Write a minimal `popup.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Recent Tabs</title>
  <style>
    body { font-family: system-ui, sans-serif; width: 260px; margin: 0; padding: 8px; }
  </style>
</head>
<body>
  <div id="list">Loading…</div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write a minimal `popup.js`**

```javascript
document.getElementById("list").textContent = "Popup loaded";
```

- [ ] **Step 5: Manually verify the extension loads**

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select the `Chrome-tab-tool` directory.
4. Confirm the extension appears with no errors ("Errors" button should not appear on the card).
5. Open the service worker inspector (click "service worker" link on the extension card) and confirm the console shows `Recent Tabs: service worker loaded`.
6. Click the extension's toolbar icon and confirm the popup shows "Popup loaded".

- [ ] **Step 6: Commit**

```bash
cd "/Users/brandon/Chrome-tab-tool"
git add manifest.json background.js popup.html popup.js
git commit -m "Scaffold Recent Tabs extension (manifest, empty entry points)"
```

---

### Task 2: MRU tracking in the background service worker

**Files:**
- Modify: `background.js`

**Interfaces:**
- Consumes: none (first real logic in the file).
- Produces (module-level state and functions in `background.js`, used by Task 3 and Task 4):
  - `const MAX_RECENT = 5`
  - `const recentByWindow = new Map()` — `windowId (number) -> tabId[] `, index 0 = most recent.
  - `function recordActivation(windowId, tabId)` — moves `tabId` to front of `recentByWindow.get(windowId)`, creating the array if absent, trimming to `MAX_RECENT`.
  - `function removeTab(tabId)` — removes `tabId` from every window's array in `recentByWindow`.
  - `function removeWindow(windowId)` — deletes `recentByWindow.get(windowId)` and any cycle state for it (cycle state added in Task 3, so for now just delete from `recentByWindow`).

- [ ] **Step 1: Implement MRU state and helper functions**

Replace the contents of `background.js` with:

```javascript
const MAX_RECENT = 5;

// windowId -> array of tabIds, index 0 = most recently used
const recentByWindow = new Map();

function recordActivation(windowId, tabId) {
  let list = recentByWindow.get(windowId);
  if (!list) {
    list = [];
    recentByWindow.set(windowId, list);
  }
  const existingIndex = list.indexOf(tabId);
  if (existingIndex !== -1) {
    list.splice(existingIndex, 1);
  }
  list.unshift(tabId);
  if (list.length > MAX_RECENT) {
    list.length = MAX_RECENT;
  }
}

function removeTab(tabId) {
  for (const list of recentByWindow.values()) {
    const index = list.indexOf(tabId);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }
}

function removeWindow(windowId) {
  recentByWindow.delete(windowId);
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  recordActivation(windowId, tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTab(tabId);
});

chrome.windows.onRemoved.addListener((windowId) => {
  removeWindow(windowId);
});

console.log("Recent Tabs: service worker loaded");
```

- [ ] **Step 2: Manually verify MRU tracking**

1. Reload the extension in `chrome://extensions` (click the reload icon on the card).
2. Open the service worker inspector's console.
3. Open a window with at least 4 tabs. Click between them a few times in a deliberate order (e.g. tab A, tab B, tab C, tab A again).
4. In the service worker console, run `recentByWindow` and confirm it shows a `Map` with one entry whose array reflects the click order, most-recent-first, with no duplicate tab IDs (tab A should appear once, at the front, after being reclicked).
5. Close one of the tracked tabs. Re-inspect `recentByWindow` and confirm its ID was removed from the array.
6. Close the whole window. Re-inspect `recentByWindow` and confirm that window's entry is gone.

- [ ] **Step 3: Commit**

```bash
cd "/Users/brandon/Chrome-tab-tool"
git add background.js
git commit -m "Track per-window MRU tab lists in background service worker"
```

---

### Task 3: Keyboard shortcut cycling

**Files:**
- Modify: `background.js`

**Interfaces:**
- Consumes: `MAX_RECENT`, `recentByWindow`, `recordActivation` from Task 2.
- Produces:
  - `const cycleOffsetByWindow = new Map()` — `windowId (number) -> number`, current position while cycling.
  - `let cyclingInProgress = false` — module-level flag set true immediately before the extension programmatically activates a tab via cycling, so the resulting `onActivated` event doesn't reset the cycle offset.
  - Updates `removeWindow` to also clear `cycleOffsetByWindow`.

- [ ] **Step 1: Update `recordActivation`'s caller to reset cycle offset on manual switches, and clear it on window removal**

In `background.js`, add the cycle-offset map near the top (after `recentByWindow`):

```javascript
// windowId -> current offset into recentByWindow's list while cycling
const cycleOffsetByWindow = new Map();
let cyclingInProgress = false;
```

Update `removeWindow` to also drop cycle state:

```javascript
function removeWindow(windowId) {
  recentByWindow.delete(windowId);
  cycleOffsetByWindow.delete(windowId);
}
```

Update the `chrome.tabs.onActivated` listener so a manual switch resets the offset, but a cycling-driven switch does not:

```javascript
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  recordActivation(windowId, tabId);
  if (!cyclingInProgress) {
    cycleOffsetByWindow.set(windowId, 0);
  }
});
```

- [ ] **Step 2: Implement the `cycle-recent-tabs` command handler**

Append to `background.js`:

```javascript
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "cycle-recent-tabs") {
    return;
  }

  const [focusedWindow] = await chrome.windows.getAll({ populate: false, windowTypes: ["normal"] })
    .then((windows) => windows.filter((w) => w.focused));
  if (!focusedWindow) {
    return;
  }

  const windowId = focusedWindow.id;
  const list = recentByWindow.get(windowId) || [];
  if (list.length === 0) {
    return;
  }

  const currentOffset = cycleOffsetByWindow.get(windowId) || 0;

  for (let step = 1; step <= list.length; step++) {
    const candidateOffset = (currentOffset + step) % list.length;
    const candidateTabId = list[candidateOffset];
    try {
      await chrome.tabs.get(candidateTabId);
    } catch {
      continue;
    }

    cyclingInProgress = true;
    cycleOffsetByWindow.set(windowId, candidateOffset);
    try {
      await chrome.tabs.update(candidateTabId, { active: true });
    } finally {
      cyclingInProgress = false;
    }
    return;
  }
});
```

- [ ] **Step 3: Manually verify cycling**

1. Reload the extension.
2. Open a window with 4+ tabs. Switch between at least 3 of them in order (A, B, C) so the MRU list for that window is `[C, B, A, ...]`.
3. Press the shortcut (`Ctrl+Shift+Y` / `Cmd+Shift+Y` — check `chrome://extensions/shortcuts` if it doesn't fire, some keys may be reserved by the OS) once. Confirm the active tab becomes `B` (2nd most recent).
4. Press it again. Confirm the active tab becomes `A`.
5. Press it again. Confirm it wraps back to `C`.
6. Manually click a different, untracked tab. Press the shortcut once and confirm it jumps to the 2nd-most-recent tab relative to the new state (i.e. the manual click reset the cycle offset).
7. Close the tab currently 2 steps back in the list, then press the shortcut enough times to reach that offset, and confirm the extension skips the closed tab instead of erroring (check the service worker console for uncaught exceptions — there should be none).

- [ ] **Step 4: Commit**

```bash
cd "/Users/brandon/Chrome-tab-tool"
git add background.js
git commit -m "Add keyboard shortcut cycling through recent tabs"
```

---

### Task 4: Popup listing and messaging

**Files:**
- Modify: `background.js`
- Modify: `popup.html`
- Modify: `popup.js`

**Interfaces:**
- Consumes: `recentByWindow` from Task 2 (read-only, from a `chrome.runtime.onMessage` handler added in this task).
- Produces: a `chrome.runtime.onMessage` handler in `background.js` responding to `{ type: "get-recent-tabs" }` with `{ tabs: Array<{ id: number, title: string, favIconUrl: string|undefined }> }` for the sender's current window, most-recent-first, excluding the currently active tab (so it doesn't offer to "navigate to the tab you're already on"). Later tasks (none currently) would consume this message contract; it's the popup's only source of data.

- [ ] **Step 1: Add the message handler to `background.js`**

Append to `background.js`:

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "get-recent-tabs") {
    return false;
  }

  (async () => {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: false, lastFocusedWindow: true });
    const windowId = currentTab ? currentTab.windowId : undefined;
    const list = windowId !== undefined ? (recentByWindow.get(windowId) || []) : [];

    const tabs = [];
    for (const tabId of list) {
      if (currentTab && tabId === currentTab.id) {
        continue;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        tabs.push({ id: tab.id, title: tab.title || "(untitled)", favIconUrl: tab.favIconUrl });
      } catch {
        // tab no longer exists; skip it
      }
    }

    sendResponse({ tabs });
  })();

  return true; // keep the message channel open for the async sendResponse
});
```

- [ ] **Step 2: Update `popup.html` with a list container and basic styling**

Replace the contents of `popup.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Recent Tabs</title>
  <style>
    body { font-family: system-ui, sans-serif; width: 280px; margin: 0; padding: 8px; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; align-items: center; gap: 8px; padding: 6px 4px; cursor: pointer; border-radius: 4px; }
    li:hover { background: #eee; }
    img { width: 16px; height: 16px; flex-shrink: 0; }
    span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #empty { color: #666; padding: 6px 4px; }
  </style>
</head>
<body>
  <ul id="list"></ul>
  <div id="empty" style="display: none;">No recent tabs yet</div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 3: Implement `popup.js` rendering and click-to-navigate**

Replace the contents of `popup.js`:

```javascript
async function loadRecentTabs() {
  const response = await chrome.runtime.sendMessage({ type: "get-recent-tabs" });
  const tabs = response?.tabs || [];

  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  listEl.innerHTML = "";

  if (tabs.length === 0) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  for (const tab of tabs) {
    const li = document.createElement("li");

    const img = document.createElement("img");
    img.src = tab.favIconUrl || "";
    img.alt = "";

    const span = document.createElement("span");
    span.textContent = tab.title;

    li.appendChild(img);
    li.appendChild(span);
    li.addEventListener("click", async () => {
      await chrome.tabs.update(tab.id, { active: true });
      window.close();
    });

    listEl.appendChild(li);
  }
}

loadRecentTabs();
```

- [ ] **Step 4: Manually verify the popup**

1. Reload the extension.
2. Open a window with 5+ tabs, switch between at least 4 of them in a distinct order.
3. Click the extension's toolbar icon. Confirm the popup lists up to 4 tabs (the 5th being whichever is currently active, which is excluded), most-recent-first, with correct titles and favicons.
4. Click one of the listed entries. Confirm the browser navigates to that tab and the popup closes.
5. Open the popup again in a window with no tracked history yet (e.g. a brand-new window with only one tab). Confirm it shows "No recent tabs yet".

- [ ] **Step 5: Commit**

```bash
cd "/Users/brandon/Chrome-tab-tool"
git add background.js popup.html popup.js
git commit -m "Add popup listing recent tabs with click-to-navigate"
```

---

### Task 5: Full end-to-end verification pass

**Files:** none (verification only, per the spec's Testing section).

**Interfaces:** none.

- [ ] **Step 1: Multi-window independence**

1. Reload the extension. Open two separate Chrome windows, each with 4+ tabs.
2. In window 1, switch between tabs in order A, B, C. In window 2, switch between tabs in order X, Y, Z.
3. Open the popup in window 1 and confirm it only shows window 1's tabs (B, A, ...), not X/Y/Z.
4. Repeat for window 2.

- [ ] **Step 2: Shortcut wraps and resets correctly**

1. In a window with exactly 3 tracked entries in its MRU list, press the shortcut 3 times and confirm it visits all 3 in order, then a 4th press returns to the 1st (wraps).
2. Manually click a 4th, previously-untracked tab, then press the shortcut once and confirm the cycle restarts from that new state's 2nd-most-recent tab.

- [ ] **Step 3: Tab and window teardown**

1. With a window's MRU list populated, close a tab that appears in the middle of the list (not the active one). Confirm subsequent shortcut presses and popup opens no longer reference it, and nothing errors in the service worker console.
2. Close an entire tracked window. Confirm no errors appear in the service worker console (check via `chrome://extensions` on another window's service worker link, since the closed window's own inspector is gone).

- [ ] **Step 4: Session-only persistence**

1. Note a window's current MRU order (e.g. via the popup).
2. Reload the extension (this restarts the service worker, simulating memory being cleared).
3. Confirm the popup for that window now shows "No recent tabs yet" (state was not persisted, matching the spec).

- [ ] **Step 5: Commit a final marker if any fixes were needed**

If steps 1-4 all pass with no code changes, no commit is needed here. If any bug was found and fixed during this pass, commit it:

```bash
cd "/Users/brandon/Chrome-tab-tool"
git add -A
git commit -m "Fix issue found during end-to-end verification: <describe>"
```
