# InterAxis Tab Sync (Chrome / Edge extension)

A Manifest V3 extension that pushes your open browser tabs to InterAxis so
they can be attached as research context to an objective.

A web page **cannot** read your other tabs — that's why this is an
extension. It lists your open **windows** via `chrome.windows`, and syncs the
tabs of the windows **you choose** to `<App URL>/api/tabs/sync`, authenticated
by a per-user **pairing token**.

## Install (development — load unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. In InterAxis, open **`/app/connect/tabs`** and copy your **pairing token**
   and **App URL**.
5. Click the extension's toolbar icon, paste both, **check which windows to
   sync**, and hit **Sync selected windows**.

Your tabs now appear in the objective chatbox's **`tabs`** chip and the
homepage **"tabs synced"** row. Re-run anytime to refresh.

## How it works

- `manifest.json` — MV3 manifest. `tabs` permission (read tab metadata +
  `windows.getAll`), `storage` (persist your token, App URL, and last window
  selection), `host_permissions` for the App URL (so the cross-origin POST
  isn't blocked by CORS).
- `popup.html` / `popup.js` — the config UI + the per-window checklist.

## Notes

- **Snapshot semantics**: each sync replaces your synced set with the tabs of
  the currently-checked windows — so unchecking a window (and re-syncing)
  removes its tabs from InterAxis.
- The pairing token maps to your account; treat it like a password. It's
  stored on the `user_integrations` row (`provider = 'browser_tabs'`). Rotate
  it by deleting that row — re-visiting `/app/connect/tabs` issues a fresh one.
- Only `http`/`https` tabs are sent; `chrome://`, `file://`, and extension
  pages are skipped.
- For a production deployment, set the **App URL** to your deployed origin
  (it must be covered by `host_permissions` — `https://*/*` already is).
