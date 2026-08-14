# Chrome Web Store Listing Copy

Draft copy for the Chrome Web Store Developer Dashboard. Paste these into the corresponding fields when creating the listing.

## Summary (max 132 characters)

Cycle back through your last few tabs per window, with a visual overlay — configurable history length.

## Description

Recent Tabs remembers the tabs you've used most recently in each Chrome window and lets you jump straight back to them.

- Press a keyboard shortcut to cycle backward through your recently used tabs, with a small popup overlay showing your current position and letting you click any entry directly.
- Open the toolbar popup any time to see and jump to your recent tabs for the current window.
- Choose how many tabs to remember (5, 10, 15, or 20) from the extension's settings page.

Everything stays local to your browser — no accounts, no tracking, no data collected or transmitted by the extension itself, aside from Chrome's own built-in sync for your chosen settings.

## Single purpose

Recent Tabs' single purpose is recency-based tab navigation: helping the user quickly return to recently used tabs within the same browser window.

## Permission justifications

- **tabs**: Required to read tab titles, favicon URLs, and IDs to build the recency list, and to activate a tab when the user selects one. No tab content or browsing history beyond what's needed for this list is accessed.
- **storage**: Required to persist the per-window recency list (`chrome.storage.session`) and the user's chosen history-length setting (`chrome.storage.sync`).
