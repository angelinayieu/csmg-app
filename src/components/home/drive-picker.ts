// Google Drive Picker (client).
//
// Loads the Google Picker API on demand, authorizes it with a short-lived
// access token minted by /api/integrations/google/token (server-side OAuth),
// lets the user pick files, then streams the picks through
// /api/integrations/google/import — which fetches/exports each file and
// persists it as an ingested_files row. onPicked fires once per imported
// file with its name + ingested_files id (so the chatbox attaches it).

const GAPI_SRC = "https://apis.google.com/js/api.js";
let pickerLoaded = false;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load the Google API."));
    document.head.appendChild(s);
  });
}

async function ensurePicker(): Promise<void> {
  await loadScript(GAPI_SRC);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (window as any).gapi;
  if (!g) throw new Error("Google API failed to load.");
  if (!pickerLoaded) {
    await new Promise<void>((resolve) =>
      g.load("picker", { callback: () => resolve() }),
    );
    pickerLoaded = true;
  }
}

export async function openDrivePicker(
  onPicked: (name: string, assetId: string) => void,
): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Google Picker isn't configured (missing API key).");
  }

  // 1. Short-lived access token for the current user.
  const tokRes = await fetch("/api/integrations/google/token");
  if (!tokRes.ok) throw new Error("Connect Google Drive first.");
  const { accessToken } = (await tokRes.json()) as { accessToken?: string };
  if (!accessToken) throw new Error("Could not get a Drive token.");

  // 2. Load the Picker.
  await ensurePicker();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picker = (window as any).google.picker;

  // 3. Build + show the picker; import on pick.
  return new Promise<void>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const built = new picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .setCallback(async (data: any) => {
        if (data.action === picker.Action.PICKED) {
          const files = (data.docs ?? []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType }),
          );
          try {
            const res = await fetch("/api/integrations/google/import", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ files }),
            });
            const json = (await res.json()) as {
              imported?: Array<{ name: string; assetId: string }>;
            };
            for (const it of json.imported ?? []) {
              onPicked(it.name, it.assetId);
            }
          } catch (err) {
            console.warn("[drive-picker] import failed:", err);
          }
          resolve();
        } else if (data.action === picker.Action.CANCEL) {
          resolve();
        }
      })
      .build();
    built.setVisible(true);
  });
}
