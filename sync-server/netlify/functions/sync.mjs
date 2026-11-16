// Sakura-Sync: speichert pro Sync-Code ein verschlüsseltes Dokument.
// Der Server sieht nie den Code und kann die Daten nicht lesen:
//   id    = SHA-256("sakura-id:" + Code)    – Speicher-Nummer (64 Hex-Zeichen)
//   write = SHA-256("sakura-write:" + Code) – Schreibberechtigung; der Server merkt sich nur deren Hash
//   Daten = mit dem Code verschlüsselt (AES-256-GCM), Format "enc1:…"
import { createHash } from "node:crypto";

const MAX = 3 * 1024 * 1024; // 3 MB pro Dokument
const sha = s => createHash("sha256").update(s).digest("hex");
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});

/** Eigentliche Logik – store ist ein Netlify-Blobs-Speicher (im Test ein Nachbau) */
export async function handle(req, id, store) {
  if (!/^[0-9a-f]{64}$/.test(id)) return json({ error: "Ungültige Kennung" }, 400);

  if (req.method === "GET") {
    const doc = await store.get(id, { type: "json" });
    if (!doc) return json({ error: "Nicht gefunden" }, 404);
    return json({ payload: doc.payload, salt: doc.salt || "", updatedAt: doc.updatedAt || 0 });
  }

  if (req.method === "PUT") {
    const write = req.headers.get("x-sakura-write") || "";
    if (!/^[0-9a-f]{64}$/.test(write)) return json({ error: "Keine Schreibberechtigung" }, 403);
    const text = await req.text();
    if (text.length > MAX) return json({ error: "Zu groß" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Ungültige Daten" }, 400); }
    if (typeof body.payload !== "string" || !body.payload.startsWith("enc1:")) return json({ error: "Nur verschlüsselte Daten" }, 400);
    const old = await store.get(id, { type: "json" });
    if (old && old.writeHash !== sha(write)) return json({ error: "Keine Schreibberechtigung" }, 403);
    const updatedAt = Date.now();
    await store.setJSON(id, { payload: body.payload, salt: String(body.salt || "").slice(0, 100), writeHash: sha(write), updatedAt });
    return json({ ok: true, updatedAt });
  }

  if (req.method === "DELETE") {
    const write = req.headers.get("x-sakura-write") || "";
    const old = await store.get(id, { type: "json" });
    if (!old) return json({ ok: true });
    if (old.writeHash !== sha(write)) return json({ error: "Keine Schreibberechtigung" }, 403);
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: "Nicht erlaubt" }, 405);
}

export default async (req, context) => {
  const { getStore } = await import("@netlify/blobs");
  return handle(req, context.params.id || "", getStore({ name: "sakura-sync", consistency: "strong" }));
};

export const config = { path: "/api/sync/:id" };
