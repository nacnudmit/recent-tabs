# Cycling Overlay & Idle Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Recent Tabs extension's MRU lists resetting when the background service worker idles out, and replace the keyboard shortcut's silent tab-switch with a visual cycling popup that highlights a candidate tab and lets the user confirm, click, or let a countdown commit it.

**Architecture:** `background.js` gains a `chrome.storage.session` write-through/hydrate layer for `recentByWindow` (Part 1), and a per-window cycling-session state machine driven by `chrome.action.openPopup()` plus a long-lived `chrome.runtime.connect` port to the popup (Part 2). `popup.js` gains a second render mode, active only when the background reports an open cycling session for its window, that highlights a row, opens the port, and runs a local fallback timer as a backstop against background-worker restarts.

**Tech Stack:** Same as the base extension — vanilla JS, Manifest V3 (`chrome.storage.session`, `chrome.action.openPopup`, `chrome.runtime.connect`/`onConnect`), no build step, no dependencies.

## Global Constraints

- Manifest V3 only.
- No external dependencies, no build/bundle step.
- `chrome.storage.session` persists `recentByWindow` only (survives service worker idle-unload, clears on browser quit) — no other state is persisted.
- Cycling countdown is 1500ms (`CYCLE_TIMEOUT_MS`), restarted on every highlight advance and on mouse-leave, paused on mouse-enter.
- `chrome.action.openPopup()` requires Chrome 116+; if it throws, fall back to the original Task 3 behavior (immediate silent `chrome.tabs.update`, no popup).
- Any way the cycling popup closes (timer, port disconnect from blur/Escape/click-away, or a row click) commits whatever tab is currently highlighted — never leaves the tab unchanged unless the extension is left completely idle with the popup never opened.
- No automated test framework — verification is manual, in real Chrome, exactly as the base extension was verified.

---

### Task 1: Idle persistence via chrome.storage.session

**Files:**
- Modify: `manifest.json`
- Modify: `background.js`

**Interfaces:**
- Consumes: none new.
- Produces: `function persistRecentByWindow()` — writes the current `recentByWindow` Map to `chrome.storage.session` as a plain object. Called at the end of every mutation to `recentByWindow` (inside `recordActivation` and `removeTab`, and inside `removeWindow` since it also mutates the map). Later tasks do not need to call this directly — they only need to know it exists so they don't reintroduce unpersisted mutation paths.

- [ ] **Step 1: Add the `storage` permission to `manifest.json`**

Change the `permissions` line from:
```json
  "permissions": ["tabs"],
```
to:
```json
  "permissions": ["tabs", "storage"],
```

- [ ] **Step 2: Add hydration and write-through to `background.js`**

Add this near the top of `background.js`, immediately after the `let cyclingInProgress = false;` line (so it runs before any listener could plausibly fire):

```javascript
function persistRecentByWindow() {
  chrome.storage.session.set({ recentByWindow: Object.fromEntries(recentByWindow) });
}

async function hydrateFromStorage() {
  const stored = await chrome.storage.session.get("recentByWindow");
  if (stored.recentByWindow) {
    for (const [windowId, list] of Object.entries(stored.recentByWindow)) {
      recentByWindow.set(Number(windowId), list);
    }
  }
}
hydrateFromStorage();
```

- [ ] **Step 3: Call `persistRecentByWindow()` after every `recentByWindow` mutation**

Modify `recordActivation` (append the call at the end of the function body, after the trim block):

```javascript
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
  persistRecentByWindow();
}
```

Modify `removeTab` (append the call at the end):

```javascript
function removeTab(tabId) {
  for (const list of recentByWindow.values()) {
    const index = list.indexOf(tabId);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }
  persistRecentByWindow();
}
```

Modify `removeWindow` (append the call at the end, after both deletes):

```javascript
function removeWindow(windowId) {
  recentByWindow.delete(windowId);
  cycleOffsetByWindow.delete(windowId);
  persistRecentByWindow();
}
```

- [ ] **Step 4: Manually verify persistence**

No automated test framework for this project. You do not have Chrome available in this sandboxed environment, so:
- Verify `manifest.json` is still valid JSON after the edit.
- Read through `background.js` and confirm `persistRecentByWindow()` is called at the end of all three mutation functions, and that `hydrateFromStorage()` is called once at module load, before any `chrome.tabs`/`chrome.windows`/`chrome.commands`/`chrome.runtime` listener registration.
- Report that full Chrome-based manual verification (loading the updated extension, building up a recent-tabs list, waiting 2+ minutes idle, confirming the list survives; then fully restarting Chrome and confirming the list resets) still needs a human with real Chrome.

- [ ] **Step 5: Commit**

```bash
git add manifest.json background.js
git commit -m "Persist recentByWindow to chrome.storage.session to survive idle-unload"
```

---

### Task 2: Cycling session core in the background service worker

**Files:**
- Modify: `background.js`

**Interfaces:**
- Consumes: `recentByWindow`, `cycleOffsetByWindow`, `cyclingInProgress` from the base extension; `persistRecentByWindow` from Task 1 (not called by this task's new code — cycling session state is intentionally not persisted, per the design's Part 1 scope note).
- Produces (used by Task 3's popup code via message-passing, not direct JS calls):
  - `chrome.runtime.onConnect` listener accepting connections named `"cycle-popup"`. First message on the port must be `{ windowId: number }` to attach it to that window's session. Subsequent messages: `{ type: "select", tabId: number }`, `{ type: "pause" }`, `{ type: "resume" }`.
  - Port messages sent to the popup: `{ type: "highlight", tabId: number }`, `{ type: "close" }`.
  - The `get-recent-tabs` response (existing handler from the base extension) gains a `cycling: { active: boolean, highlightedTabId: number | null }` field.

- [ ] **Step 1: Add cycling-session state**

Add this in `background.js`, immediately after the `let cyclingInProgress = false;` line (before or after Task 1's `persistRecentByWindow`/`hydrateFromStorage` block — either order is fine, they don't depend on each other):

```javascript
// windowId -> { pendingTabId, port, timeoutId, resolved }
const cycleSessionByWindow = new Map();
const CYCLE_TIMEOUT_MS = 1500;

function restartCycleTimer(windowId) {
  const session = cycleSessionByWindow.get(windowId);
  if (!session) {
    return;
  }
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  session.timeoutId = setTimeout(() => commitCycleSession(windowId), CYCLE_TIMEOUT_MS);
}

async function commitCycleSession(windowId) {
  const session = cycleSessionByWindow.get(windowId);
  if (!session || session.resolved) {
    return;
  }
  session.resolved = true;
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  cyclingInProgress = true;
  try {
    await chrome.tabs.update(session.pendingTabId, { active: true });
  } catch {
    // tab may no longer exist; nothing to activate
  } finally {
    cyclingInProgress = false;
  }
  if (session.port) {
    try {
      session.port.postMessage({ type: "close" });
    } catch {
      // port may already be disconnected
    }
  }
  cycleSessionByWindow.delete(windowId);
}

async function findNextCandidate(windowId) {
  const list = recentByWindow.get(windowId) || [];
  if (list.length === 0) {
    return null;
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
    return { candidateOffset, candidateTabId };
  }
  return null;
}
```

- [ ] **Step 2: Replace the existing `chrome.commands.onCommand` listener**

Replace the entire existing listener (the one that starts with `chrome.commands.onCommand.addListener(async (command) => {` and ends at its matching `});`) with:

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

  const candidate = await findNextCandidate(windowId);
  if (!candidate) {
    return;
  }
  cycleOffsetByWindow.set(windowId, candidate.candidateOffset);

  const existingSession = cycleSessionByWindow.get(windowId);
  if (existingSession) {
    existingSession.pendingTabId = candidate.candidateTabId;
    existingSession.resolved = false;
    restartCycleTimer(windowId);
    if (existingSession.port) {
      existingSession.port.postMessage({ type: "highlight", tabId: candidate.candidateTabId });
    }
    return;
  }

  let popupOpened = true;
  try {
    await chrome.action.openPopup();
  } catch {
    popupOpened = false;
  }

  if (!popupOpened) {
    cyclingInProgress = true;
    try {
      await chrome.tabs.update(candidate.candidateTabId, { active: true });
    } finally {
      cyclingInProgress = false;
    }
    return;
  }

  cycleSessionByWindow.set(windowId, {
    pendingTabId: candidate.candidateTabId,
    port: null,
    timeoutId: null,
    resolved: false,
  });
  restartCycleTimer(windowId);
});
```

- [ ] **Step 3: Add the `chrome.runtime.onConnect` listener**

Add this after the command listener (and can go before or after the existing `chrome.runtime.onMessage` listener):

```javascript
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "cycle-popup") {
    return;
  }

  let attachedWindowId = null;

  port.onMessage.addListener((message) => {
    if (message?.windowId !== undefined && attachedWindowId === null) {
      attachedWindowId = message.windowId;
      const session = cycleSessionByWindow.get(attachedWindowId);
      if (session) {
        session.port = port;
      }
      return;
    }

    if (attachedWindowId === null) {
      return;
    }
    const session = cycleSessionByWindow.get(attachedWindowId);
    if (!session) {
      return;
    }

    if (message?.type === "select") {
      session.resolved = true;
      if (session.timeoutId) {
        clearTimeout(session.timeoutId);
      }
      cyclingInProgress = true;
      chrome.tabs.update(message.tabId, { active: true }).finally(() => {
        cyclingInProgress = false;
      });
      cycleSessionByWindow.delete(attachedWindowId);
    } else if (message?.type === "pause") {
      if (session.timeoutId) {
        clearTimeout(session.timeoutId);
        session.timeoutId = null;
      }
    } else if (message?.type === "resume") {
      restartCycleTimer(attachedWindowId);
    }
  });

  port.onDisconnect.addListener(() => {
    if (attachedWindowId === null) {
      return;
    }
    commitCycleSession(attachedWindowId);
  });
});
```

- [ ] **Step 4: Update the `get-recent-tabs` message handler to report cycling state**

In the existing `chrome.runtime.onMessage` listener, inside the async IIFE, insert this right before the `sendResponse({ tabs });` line:

```javascript
    const session = windowId !== undefined ? cycleSessionByWindow.get(windowId) : undefined;
    const cycling = {
      active: Boolean(session),
      highlightedTabId: session ? session.pendingTabId : null,
    };
```

And change the `sendResponse` call from:
```javascript
    sendResponse({ tabs });
```
to:
```javascript
    sendResponse({ tabs, cycling });
```

- [ ] **Step 5: Manually verify**

No automated test framework, no Chrome available in this sandboxed environment. Instead:
- Read through the modified `background.js` end to end and confirm: the command handler no longer calls `chrome.tabs.update` directly except in the `popupOpened === false` fallback path; `cycleSessionByWindow` entries are always cleaned up (deleted) on every exit path — `commitCycleSession`, and the `select` message handler; `restartCycleTimer` always clears any prior timer before setting a new one (no leaked timers).
- Trace the "double-commit guard" by hand: a `select` message sets `session.resolved = true` AND deletes the session from `cycleSessionByWindow` — so if `port.onDisconnect` fires afterward (as it will, since the popup calls `window.close()` after sending `select`), `commitCycleSession` sees no session for that window and returns immediately without a second `chrome.tabs.update`.
- Report that full Chrome-based manual verification (the shortcut opening a popup, repeated presses advancing the highlight, timeout auto-committing, row-click committing, blur/Escape committing) still needs a human with real Chrome — this is covered by Task 4.

- [ ] **Step 6: Commit**

```bash
git add background.js
git commit -m "Add cycling-session state machine driving a popup overlay"
```

---

### Task 3: Popup cycling UI

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`

**Interfaces:**
- Consumes: the `get-recent-tabs` response's new `cycling: { active, highlightedTabId }` field (Task 2); the `cycle-popup` port protocol (Task 2) — sends `{ windowId }` then `{ type: "select", tabId }` / `{ type: "pause" }` / `{ type: "resume" }`; receives `{ type: "highlight", tabId }` / `{ type: "close" }`.
- Produces: nothing consumed by later tasks — this is the last code task.

- [ ] **Step 1: Add a `.highlighted` style to `popup.html`**

Add this rule to the existing `<style>` block, after the `li:hover { background: #eee; }` line:

```css
    li.highlighted { background: #cfe3ff; }
```

- [ ] **Step 2: Replace `popup.js` in full**

Replace the entire contents of `popup.js` with:

```javascript
const CYCLE_TIMEOUT_MS = 1500;

let localTimeoutId = null;
let currentHighlightedTabId = null;
let cyclingPort = null;
let rowsById = new Map();

function setHighlight(tabId) {
  currentHighlightedTabId = tabId;
  for (const [id, row] of rowsById) {
    row.classList.toggle("highlighted", id === tabId);
  }
}

function clearLocalTimer() {
  if (localTimeoutId) {
    clearTimeout(localTimeoutId);
    localTimeoutId = null;
  }
}

function restartLocalTimer() {
  clearLocalTimer();
  localTimeoutId = setTimeout(async () => {
    if (currentHighlightedTabId !== null) {
      try {
        await chrome.tabs.update(currentHighlightedTabId, { active: true });
      } catch {
        // tab may no longer exist
      }
    }
    window.close();
  }, CYCLE_TIMEOUT_MS);
}

async function startCyclingSession() {
  const currentWindow = await chrome.windows.getCurrent();
  cyclingPort = chrome.runtime.connect({ name: "cycle-popup" });
  cyclingPort.postMessage({ windowId: currentWindow.id });

  cyclingPort.onMessage.addListener((message) => {
    if (message?.type === "highlight") {
      setHighlight(message.tabId);
      restartLocalTimer();
    } else if (message?.type === "close") {
      clearLocalTimer();
      window.close();
    }
  });

  document.body.addEventListener("mouseenter", () => {
    clearLocalTimer();
    cyclingPort.postMessage({ type: "pause" });
  });
  document.body.addEventListener("mouseleave", () => {
    restartLocalTimer();
    cyclingPort.postMessage({ type: "resume" });
  });

  restartLocalTimer();
}

async function loadRecentTabs() {
  const response = await chrome.runtime.sendMessage({ type: "get-recent-tabs" });
  const tabs = response?.tabs || [];
  const cycling = response?.cycling || { active: false, highlightedTabId: null };

  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  listEl.innerHTML = "";
  rowsById = new Map();

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
      if (cycling.active && cyclingPort) {
        clearLocalTimer();
        cyclingPort.postMessage({ type: "select", tabId: tab.id });
      } else {
        await chrome.tabs.update(tab.id, { active: true });
      }
      window.close();
    });

    listEl.appendChild(li);
    rowsById.set(tab.id, li);
  }

  if (cycling.active) {
    setHighlight(cycling.highlightedTabId);
    startCyclingSession();
  }
}

loadRecentTabs();
```

- [ ] **Step 3: Manually verify**

No automated test framework, no Chrome available in this sandboxed environment. Instead:
- Run `node --check popup.js` to confirm valid syntax.
- Confirm `popup.html` is well-formed and the new `.highlighted` rule doesn't collide with or override `li:hover`/other existing rules in a way that would hide the highlight (both can coexist — hover changes background on top of/independent from the highlighted class since they're separate selectors applying the same property; whichever rule is declared later in the stylesheet wins if both match, which is acceptable since hovering a highlighted row is a rare, harmless visual case).
- Trace by hand: a plain icon-click (no cycling session active) never calls `startCyclingSession`, never opens a port, so it behaves identically to the original Task 4 popup.
- Report that full Chrome-based manual verification (the popup highlighting, timer countdown, hover pause/resume, click-to-select, blur/Escape commit) still needs a human with real Chrome — covered by Task 4.

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.js
git commit -m "Add cycling overlay UI to the popup"
```

---

### Task 4: Full end-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Idle persistence**

1. Reload the extension in `chrome://extensions`.
2. Build up a window's recent-tabs list by switching between a few tabs.
3. Wait 2+ minutes without interacting with the extension (switch away, do something else).
4. Open the popup (icon click) and confirm the list is unchanged from before the wait.
5. Fully quit and reopen Chrome. Open the popup again and confirm the list is now empty (browser-restart reset is still intended).

- [ ] **Step 2: Cycling overlay — single press**

1. Build up a window's recent-tabs list (3+ tabs).
2. Press the shortcut once. Confirm a popup opens, highlighting the 2nd-most-recent tab, without yet switching to it.
3. Wait ~1.5s without moving the mouse or pressing anything. Confirm the highlighted tab activates and the popup closes automatically.

- [ ] **Step 3: Cycling overlay — repeated presses**

1. Press the shortcut, then press it again quickly (within ~1.5s) two or three more times.
2. Confirm the popup stays open (doesn't flicker closed/reopen) and the highlight advances one step further back each press, wrapping correctly once it reaches the end of the list.
3. Stop pressing and confirm it auto-commits to whichever tab was highlighted last.

- [ ] **Step 4: Hover pause/resume**

1. Press the shortcut to open the popup.
2. Move the mouse over the popup list and hold it there for longer than 1.5s. Confirm the popup does NOT auto-close while hovered.
3. Move the mouse away. Confirm the countdown resumes and the popup closes shortly after.

- [ ] **Step 5: Click-to-select**

1. Press the shortcut to open the popup.
2. Click a row that is NOT the currently highlighted one.
3. Confirm that clicked tab activates (not the highlighted one), and the popup closes without any further tab switch afterward (no double-activation).

- [ ] **Step 6: Blur / Escape commits**

1. Press the shortcut to open the popup.
2. Before the timer fires, click somewhere outside the popup (e.g. the page behind it) or press Escape.
3. Confirm whatever was highlighted at that moment activates.

- [ ] **Step 7: Fallback on unsupported Chrome (best-effort)**

If you have access to a Chrome version older than 116, or can otherwise simulate `chrome.action.openPopup()` throwing (e.g. temporarily renaming the function call to something invalid and reloading, then reverting): confirm the shortcut still switches tabs immediately with no popup and no uncaught error in the service worker console. If you cannot test this, skip it and note that it's unverified.

- [ ] **Step 8: Commit a final marker if any fixes were needed**

If steps 1-7 all pass with no code changes, no commit is needed here. If any bug was found and fixed during this pass, commit it:

```bash
git add -A
git commit -m "Fix issue found during end-to-end verification: <describe>"
```
