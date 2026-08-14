# Configurable Recent-Tabs Limit — Design

This extends the Recent Tabs extension with a user-configurable limit (5, 10, 15, or 20) on how many tabs are remembered per window, replacing the current hardcoded limit of 5.

## Problem

`background.js` hardcodes `const MAX_RECENT = 5`, capping every window's recency list at 5 entries with no way to change it. Some users want a longer history to cycle/browse through.

## Design

### Options page

A standard Chrome extension options page:
- `manifest.json` gains an `"options_page": "options.html"` entry, making the extension reachable via right-click the toolbar icon → Options, or the "Details" link on `chrome://extensions`.
- `options.html` + `options.js`: four radio buttons labeled 5, 10, 15, 20, defaulting to 5 (today's behavior). Selecting one immediately saves it — no separate "Save" button, consistent with how simple extension options pages typically behave.

### Storage

The choice is saved to `chrome.storage.sync` under the key `maxRecent`, as a plain number. This is a deliberately different storage area from `chrome.storage.session` (already used for the per-window tab-history data itself): the setting is meant to survive browser restarts and sync across Chrome installs signed into the same account, while the tab-history data intentionally does not persist across restarts (per the original design). Using `sync` rather than `local` costs nothing extra here — a single small integer is well within `sync`'s per-item and total quota — and gives the user cross-device consistency for free.

### Background wiring

- `background.js`'s `const MAX_RECENT = 5` becomes `let maxRecent = 5;` (mutable, since it can now change at runtime).
- Startup hydration is folded into the same pattern already used for `recentByWindow`: a single combined hydration step reads both `chrome.storage.session` (`recentByWindow`) and `chrome.storage.sync` (`maxRecent`) before any listener processes an event, using the same `hydrationPromise`-awaited-by-every-listener approach already in place. This avoids introducing a second parallel hydration race of the kind that was already found and fixed for `recentByWindow`.
- A `chrome.storage.onChanged` listener watches for changes to the `sync` area's `maxRecent` key and updates the in-memory `maxRecent` variable immediately if the change happens while the service worker is already awake. The startup hydration covers the case where the worker was asleep when the setting changed and wakes up later.
- `recordActivation`'s existing trim check (`if (list.length > MAX_RECENT) { list.length = MAX_RECENT; }`) is unchanged except for reading `maxRecent` instead of the constant.

### Behavior on change

Per the "cap future growth only" requirement: changing the setting does not retroactively shrink any window's already-stored list. If a list is currently longer than a newly-lowered limit (e.g. it was built up to 20 entries and the user switches to 5), it stays at its current length until normal MRU activity (new tab activations triggering the trim check) brings it back under the new cap over time. No other code needs to change for this — `recordActivation` already only trims on writes, never on read, so this behavior falls out of the existing logic for free.

No other component needs to change: the popup already renders however many tabs the background reports (nothing hardcodes "5" there), and the keyboard-shortcut cycling logic already operates on `list.length`, so both automatically support longer lists once `maxRecent` allows them.

## Testing

Manual, consistent with the rest of the project (no automated test framework):
- Change the setting to 10, switch through more than 5 tabs, confirm the list grows past 5 and caps at 10.
- Lower the setting back to 5 without switching tabs again, open the popup, confirm the list is still longer than 5 (not retroactively trimmed).
- Switch one more tab after lowering to 5, confirm the list is now trimmed to 5 going forward.
- Fully restart Chrome, confirm the chosen setting is still selected on the options page (persists across restarts, unlike the tab-history data itself).
- Confirm cycling via the keyboard shortcut correctly wraps through the full length of a longer list (e.g. 10 entries), not just the first 5.
