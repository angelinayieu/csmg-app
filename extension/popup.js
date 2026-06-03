// InterAxis Tab Sync — popup logic.
//
// Lists the user's open browser WINDOWS (chrome.windows.getAll) and lets
// them choose which ones to sync. On "Sync", the http/https tabs of the
// CHECKED windows are POSTed to <App URL>/api/tabs/sync with the pairing
// token as a Bearer header. The server treats each sync as a snapshot, so
// deselecting a window removes its tabs. Config (App URL + token + last
// window selection) persists in chrome.storage.local.

const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "http://localhost:3000";

// Captured at render time: [{ id, tabs: [<http/https tab>] }] per window,
// so "Sync" sends exactly the chosen windows' tabs (no second query).
let WINDOWS = [];

function setStatus(msg, ok) {
  const s = $("status");
  s.textContent = msg;
  s.style.color = ok ? "#16A34A" : "#DC2626";
}

function httpTabs(tabs) {
  return (tabs || []).filter((t) => t.url && /^https?:\/\//i.test(t.url));
}

async function renderWindows() {
  const container = $("windows");
  let wins;
  try {
    wins = await chrome.windows.getAll({ populate: true });
  } catch {
    container.innerHTML = '<div class="empty">Could not read windows.</div>';
    return;
  }

  const { selectedWindowIds } = await chrome.storage.local.get([
    "selectedWindowIds",
  ]);
  const stored = Array.isArray(selectedWindowIds)
    ? new Set(selectedWindowIds)
    : null;

  // Only windows with at least one http/https tab are syncable.
  WINDOWS = wins
    .map((w) => ({
      id: w.id,
      focused: !!w.focused,
      tabs: httpTabs(w.tabs),
      active: (w.tabs || []).find((t) => t.active),
    }))
    .filter((w) => w.tabs.length > 0);

  if (WINDOWS.length === 0) {
    container.innerHTML = '<div class="empty">No syncable tabs open.</div>';
    return;
  }

  container.innerHTML = "";
  WINDOWS.forEach((w, i) => {
    const hint =
      (w.active && w.active.title) || w.tabs[0].title || `Window ${i + 1}`;
    // Pre-check: the remembered selection if we have one, else the focused
    // window so a one-click sync does the obvious thing.
    const checked = stored ? stored.has(w.id) : w.focused;

    const row = document.createElement("label");
    row.className = "win";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = String(w.id);
    cb.checked = !!checked;

    const meta = document.createElement("span");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = hint;
    const count = document.createElement("div");
    count.className = "count";
    count.textContent = `${w.tabs.length} tab${w.tabs.length === 1 ? "" : "s"}`;
    meta.appendChild(title);
    meta.appendChild(count);

    row.appendChild(cb);
    row.appendChild(meta);
    container.appendChild(row);
  });
}

async function load() {
  const { baseUrl, token } = await chrome.storage.local.get([
    "baseUrl",
    "token",
  ]);
  $("baseUrl").value = baseUrl || DEFAULT_BASE;
  $("token").value = token || "";
  await renderWindows();
}

function checkedWindowIds() {
  return Array.from($("windows").querySelectorAll('input[type="checkbox"]'))
    .filter((c) => c.checked)
    .map((c) => Number(c.value));
}

$("sync").addEventListener("click", async () => {
  const baseUrl = $("baseUrl").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  await chrome.storage.local.set({ baseUrl, token });
  if (!baseUrl) return setStatus("Set the App URL first.", false);
  if (!token) return setStatus("Paste your pairing token first.", false);

  const ids = checkedWindowIds();
  if (ids.length === 0) return setStatus("Pick at least one window.", false);
  await chrome.storage.local.set({ selectedWindowIds: ids });

  const idSet = new Set(ids);
  const payload = WINDOWS.filter((w) => idSet.has(w.id))
    .flatMap((w) => w.tabs)
    .map((t) => ({
      url: t.url,
      title: t.title || "",
      favIconUrl: t.favIconUrl || "",
      tab_group:
        typeof t.groupId === "number" && t.groupId > 0
          ? String(t.groupId)
          : null,
    }));

  setStatus("Syncing…", true);
  try {
    const res = await fetch(`${baseUrl}/api/tabs/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tabs: payload }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return setStatus(json.error || `Failed (HTTP ${res.status}).`, false);
    }
    setStatus(`Synced ${json.synced} tab${json.synced === 1 ? "" : "s"} ✓`, true);
  } catch (err) {
    setStatus("Error: " + (err && err.message ? err.message : "sync failed"), false);
  }
});

load();
