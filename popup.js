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
