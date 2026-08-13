const MAX_RECENT = 5;

// windowId -> array of tabIds, index 0 = most recently used
const recentByWindow = new Map();

// windowId -> current offset into recentByWindow's list while cycling
const cycleOffsetByWindow = new Map();
let cyclingInProgress = false;

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

function removeTab(tabId) {
  for (const list of recentByWindow.values()) {
    const index = list.indexOf(tabId);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }
  persistRecentByWindow();
}

function removeWindow(windowId) {
  recentByWindow.delete(windowId);
  cycleOffsetByWindow.delete(windowId);
  persistRecentByWindow();
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  recordActivation(windowId, tabId);
  if (!cyclingInProgress) {
    cycleOffsetByWindow.set(windowId, 0);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTab(tabId);
});

chrome.windows.onRemoved.addListener((windowId) => {
  removeWindow(windowId);
});

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

console.log("Recent Tabs: service worker loaded");
