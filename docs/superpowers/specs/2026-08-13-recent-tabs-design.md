# Recent Tabs Chrome Extension — Design

## Purpose

A Chrome extension that lets the user quickly jump back to recently used tabs, per window. Each Chrome window maintains its own "last 5 tabs used" list, ordered most-recently-used first.

## Approach

Chrome's extension APIs do not expose a queryable "last active" ordering for tabs, so the extension tracks recency itself in a background service worker by listening to tab activation events. This is the only viable approach (Manifest V3, no external dependencies).

## Components

### 1. Background service worker (`background.js`)

- Maintains an in-memory `Map<windowId, number[]>` of tab IDs in MRU order (index 0 = most recent), capped at 5 entries per window.
- Event listeners:
  - `chrome.tabs.onActivated` — when a tab becomes active (any cause, including manual switching), move its tab ID to the front of its window's list, trim the list to 5. This also resets that window's cycle position back to 0, *unless* the activation was caused by the extension's own cycling action (tracked via an internal flag so the shortcut doesn't reset its own progress).
  - `chrome.tabs.onRemoved` — remove the closed tab ID from every window's list it appears in.
  - `chrome.windows.onRemoved` — delete that window's list and cycle state entirely.
- Cycle state: `Map<windowId, number>` tracking the current offset into that window's MRU list while cycling via the keyboard shortcut.

### 2. Keyboard shortcut (`commands` in manifest.json)

- Command name: `cycle-recent-tabs`, default binding `Ctrl+Shift+Y` (`Cmd+Shift+Y` on Mac), user-remappable via `chrome://extensions/shortcuts`.
- On each invocation, for the focused window:
  1. Increment that window's cycle offset (wrapping modulo the list length, max 5).
  2. Look up the tab ID at that offset in the window's MRU list.
  3. If the tab still exists, set the internal "cycling in progress" flag, then activate it (`chrome.tabs.update(tabId, {active: true})`).
  4. If the tab ID no longer exists (stale — e.g. `onRemoved` event was missed), skip it and try the next offset, up to the length of the list.

### 3. Popup (`popup.html` + `popup.js`)

- Toolbar icon click opens a popup showing the current window's MRU list (favicon + title) for up to 5 tabs, most recent first.
- Clicking an entry activates that tab directly (`chrome.tabs.update`) and closes the popup.
- If the list is empty (e.g. window just opened, only one tab), show a simple "No recent tabs yet" message.

## Data Flow

1. User switches tabs (click, cmd+tab, etc.) → `onActivated` fires → background updates that window's MRU array and resets cycle offset.
2. User presses the shortcut → background reads current window's MRU array at the next cycle offset → activates that tab (flagged as extension-driven, so it doesn't reset the offset).
3. User opens the popup → popup script requests the current window's MRU array from the background (via `chrome.runtime.sendMessage` or direct import of shared state) → renders it → click navigates.

## Error Handling

- Stale tab IDs (tab closed but event missed) are skipped when cycling or rendering, not treated as errors.
- No persistence layer, so no storage-read/write errors to handle.

## Persistence

None. All state lives in the background service worker's memory for the browser session. A window's list is naturally discarded when the window closes (`onRemoved`). Note: Manifest V3 service workers can be unloaded when idle and woken on events — since state is only mutated/read in response to those same events, this does not cause data loss in normal operation, but a long-idle worker unload does reset all in-memory MRU lists (acceptable per the "reset is fine" requirement).

## Testing

Manual verification only (no automated test framework planned for a small unpacked extension):
- Load unpacked in `chrome://extensions`.
- Open 2+ windows, switch between several tabs in each, verify each window's MRU list tracks independently.
- Verify the shortcut cycles backward correctly and wraps after 5.
- Verify switching tabs manually mid-cycle resets the cycle offset.
- Verify the popup lists the correct 5 tabs and clicking navigates correctly.
- Verify closing a tracked tab removes it from the list without breaking cycling/popup.
