const MAX_RECENT = 5;

// windowId -> array of tabIds, index 0 = most recently used
const recentByWindow = new Map();

// windowId -> current offset into recentByWindow's list while cycling
const cycleOffsetByWindow = new Map();
let cyclingInProgress = false;

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "get-recent-tabs") {
    return false;
  }

  (async () => {
    const windowId = message.windowId;
    const [currentTab] = windowId !== undefined
      ? await chrome.tabs.query({ active: true, windowId })
      : [];
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

    const session = windowId !== undefined ? cycleSessionByWindow.get(windowId) : undefined;
    const cycling = {
      active: Boolean(session),
      highlightedTabId: session ? session.pendingTabId : null,
    };

    sendResponse({ tabs, cycling });
  })();

  return true; // keep the message channel open for the async sendResponse
});

console.log("Recent Tabs: service worker loaded");
