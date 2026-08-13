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
