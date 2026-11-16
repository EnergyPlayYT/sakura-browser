# Sakura-Sync-Dienst

Speichert für den Abgleich per Sync-Code die **verschlüsselten** Daten der Sakura-Geräte.
Der Dienst kennt weder den Sync-Code noch den Inhalt – er sieht nur eine Speicher-Nummer und Datensalat.

Läuft auf Netlify (Projekt `sakura-sync`, Adresse `https://sakura-sync.netlify.app`).
Hochgeladen wird er direkt mit dem Netlify-Werkzeug (nicht automatisch bei jedem Push):
In diesem Ordner das Netlify-MCP-Werkzeug „deploy-site“ für das Projekt `sakura-sync`
(Site-ID `b6693404-c320-4519-9692-bac8f3a4cc91`) aufrufen und den genannten `npx @netlify/mcp …`-Befehl
mit `NODE_USE_ENV_PROXY=1` ausführen. Nach Änderungen an `netlify/functions/sync.mjs` erneut hochladen.
