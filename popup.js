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
  const currentWindow = await chrome.windows.getCurrent();
  const response = await chrome.runtime.sendMessage({ type: "get-recent-tabs", windowId: currentWindow.id });
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
