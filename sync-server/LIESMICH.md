# Sakura-Sync-Dienst

Speichert für den Abgleich per Sync-Code die **verschlüsselten** Daten der Sakura-Geräte.
Der Dienst kennt weder den Sync-Code noch den Inhalt – er sieht nur eine Speicher-Nummer und Datensalat.

Läuft auf Netlify (Projekt `sakura-sync`, Adresse `https://sakura-sync.netlify.app`).
Netlify baut den Dienst automatisch aus diesem Ordner, sobald das Projekt mit dem GitHub-Repo verbunden ist:
Netlify → Projekt „sakura-sync“ → Project configuration → Build & deploy → „Link repository“ →
GitHub → `sakura-browser` → Base directory: `sync-server` → Deploy.
