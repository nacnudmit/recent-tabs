# Cycling Overlay & Idle Persistence — Design

This extends the original [Recent Tabs design](2026-08-13-recent-tabs-design.md), adding two related changes to the already-implemented extension:

1. A visual overlay for the keyboard-shortcut cycling flow (today it switches tabs silently, one per press, with no feedback).
2. Fixing the MRU lists resetting after the background service worker idles out (a Manifest V3 characteristic, not something the original spec anticipated as user-visible).

Both changes touch `background.js` and `popup.js`/`popup.html`, and are being implemented together.

## Part 1: Idle Persistence Fix

### Problem

`recentByWindow` lives only in the background service worker's in-memory `Map`. Chrome unloads an inactive MV3 service worker after roughly 30 seconds (longer with pending timers/listeners) and restarts it fresh on the next event. Since state is memory-only, an idle-unload silently wipes every window's recent-tabs list even though no window or tab actually closed — this reads as a bug, not the "resets on browser restart" behavior the original spec intended.

### Fix

Persist `recentByWindow` to `chrome.storage.session` — an in-memory store Chrome manages on the extension's behalf. It survives the service worker being unloaded and restarted, but is still cleared automatically when the browser quits, so it does not change the original "no disk persistence, browser-restart resets are fine" requirement — it only fixes the *mid-session* idle-unload data loss.

- **Write-through:** every mutation to `recentByWindow` (inside `recordActivation`, `removeTab`, `removeWindow`) is followed by `chrome.storage.session.set({ recentByWindow: Object.fromEntries(recentByWindow) })`. (`chrome.storage` requires JSON-serializable values, so the `Map` is converted to a plain object keyed by window ID as a string.)
- **Hydrate on startup:** at the top of `background.js`, before registering listeners, read `chrome.storage.session.get("recentByWindow")` and repopulate the `Map` (converting keys back to numbers) before any event can be processed. Because service worker top-level code re-runs on every restart, this naturally covers both the very first load and every subsequent idle-restart.
- **Scope:** only `recentByWindow` is persisted. `cycleOffsetByWindow`, `cyclingInProgress`, and the new cycling-session state (Part 2) are NOT persisted — a full cycling interaction (press → highlight → commit) completes in a few seconds, well under the idle-unload window, so persisting that ephemeral state would add complexity for a scenario that essentially never occurs. If a worker restart does happen mid-cycle, Part 2's error handling covers it via the popup's local fallback timer.

## Part 2: Cycling Overlay

### Problem

Today, pressing the cycle-recent-tabs shortcut immediately activates the next tab with zero visual feedback — the user has to infer their position in the recency list by watching which tab appears. There's no way to preview a tab before committing to it.

### Design

The shortcut handler no longer activates a tab directly. Instead it opens (or updates) a **cycling session** for the focused window, using the extension's existing action popup as the visual overlay.

#### Components

**`background.js` additions:**
- A per-window cycling-session state, active only while a cycling popup is open:
  ```js
  // windowId -> { pendingTabId, timeoutId, port }
  const cycleSessionByWindow = new Map();
  const CYCLE_TIMEOUT_MS = 1500;
  ```
- `chrome.commands.onCommand` handler for `cycle-recent-tabs` is rewritten:
  1. Compute the next candidate tab ID using the existing offset/wrap-around logic from the original cycling implementation (unchanged).
  2. If no session exists for this window: try `chrome.action.openPopup()`. If it throws, fall back to today's behavior — `chrome.tabs.update(candidateTabId, { active: true })` directly, no popup, no session created. If it succeeds, store a session for this window with `pendingTabId = candidateTabId` and no port yet (the port attaches when `popup.js` connects); start the countdown timer.
  3. If a session already exists for this window: update `pendingTabId` to the new candidate, restart the countdown timer, and — if a port is attached — send it a `{ type: "highlight", tabId }` message.
- `chrome.runtime.onConnect` handler, for connections named `"cycle-popup"`:
  - The popup's first message on the port carries its `windowId` (from `chrome.windows.getCurrent()`, run in `popup.js`). Attach the port to that window's session (if one exists — a plain icon-click open never connects this port at all, see below).
  - Listen for `{ type: "select", tabId }` (row click) → mark the session resolved, clear the timer, `chrome.tabs.update(tabId, { active: true })`.
  - Listen for `{ type: "pause" }` / `{ type: "resume" }` (mouse enter/leave) → clear/restart the countdown timer without changing `pendingTabId`.
  - `port.onDisconnect` → if the session is not already resolved, commit: `chrome.tabs.update(pendingTabId, { active: true })`. Either way, delete the session from `cycleSessionByWindow`.
  - The countdown timer firing runs the same commit-and-cleanup logic as `onDisconnect`, then tells the popup to close: `port.postMessage({ type: "close" })`.
- The existing `get-recent-tabs` message handler (from the original Task 4) gains one additional field in its response: `cycling: { active: boolean, highlightedTabId: number | null }`, reflecting whether `cycleSessionByWindow` has an entry for the sender's window.

**`popup.js` changes:**
- On load, `get-recent-tabs` is called exactly as before. If the response's `cycling.active` is `false`, render exactly as today (Task 4's static list, no port, no timer, no auto-close) — a plain icon click never touches any of the new code paths.
- If `cycling.active` is `true`:
  - Render the same list, but the row matching `cycling.highlightedTabId` gets a distinct highlight style.
  - Open `chrome.runtime.connect({ name: "cycle-popup" })`, immediately send `{ windowId: (await chrome.windows.getCurrent()).id }`.
  - Listen for `{ type: "highlight", tabId }` → move the highlight to that row (no full re-render needed, just a class swap).
  - Listen for `{ type: "close" }` → `window.close()`.
  - `mouseenter`/`mouseleave` on the popup body → `port.postMessage({ type: "pause" | "resume" })`.
  - Row click → `port.postMessage({ type: "select", tabId })`, then `window.close()` (same as today's click behavior, just also notifying the background so it can skip its own commit-on-disconnect).
  - **Local fallback timer:** since the background could theoretically restart mid-session (Part 1 doesn't persist this state), `popup.js` also runs its own local `setTimeout` mirroring `CYCLE_TIMEOUT_MS`, resettable by the same highlight/pause/resume messages. If the port disconnects unexpectedly (background died) before the local timer fires, the popup commits directly — `chrome.tabs.update(currentlyHighlightedTabId, { active: true })` — using its own last-known highlight state, then closes itself. This is a backstop only; in the normal case the background's own commit-on-disconnect/timeout fires first and this local timer is just cleared on `window.close()`.

#### Constraint

`chrome.action.openPopup()` requires Chrome 116+. This is a hard requirement for this feature; it degrades gracefully (falls back to the original silent-switch behavior) on older Chrome rather than failing outright.

## Testing

No automated framework (consistent with the rest of the project) — manual verification in real Chrome:

**Idle persistence:**
- Build up a window's recent-tabs list, wait 2+ minutes without interacting with the extension, open the popup and confirm the list is unchanged.
- Restart Chrome entirely and confirm the list resets to empty (browser-restart reset is still intended behavior).

**Cycling overlay:**
- Single press, no follow-up: popup opens, highlights the 2nd-most-recent tab, auto-activates and closes after ~1.5s.
- Rapid repeated presses: highlight advances each press without reopening the popup; countdown restarts each press; wraps correctly at the end of the list.
- Hover over the popup mid-countdown: timer visibly pauses; resumes on mouse-leave.
- Click a row mid-cycle: that tab activates immediately, popup closes, no double-activation follows.
- Click away / press Escape mid-cycle: whatever was highlighted at that moment activates.
- Trigger the shortcut on a pre-116 Chrome (or simulate `openPopup` throwing): confirm it falls back to an immediate silent switch with no popup and no error in the console.
- Idle 2+ minutes *while* a cycling popup is open (contrived — e.g. via debugger pause): confirm the popup's local fallback timer still commits a switch and closes itself rather than hanging open forever.
