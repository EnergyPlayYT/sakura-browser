# Sakura – Projektanleitung für Claude

Sakura ist ein eigener Browser für **Windows** (Electron/Chromium) und **Android** (System-WebView) im japanischen Sakura-Stil, gebaut für Ali (GitHub: EnergyPlayYT). Ali spricht **Deutsch** – alle Texte in der Oberfläche, Commit-Nachrichten, Kommentare im Code und Antworten an ihn sind auf Deutsch. Er ist kein Entwickler: erkläre Ergebnisse in einfachen Worten, ohne Fachjargon.

Offene Aufgaben stehen in **ROADMAP.md**. Arbeite sie der Reihe nach ab und hake Erledigtes dort ab.

## Aufbau

```
desktop/            Windows-Browser (Electron 45, kein Framework, kein Build-Schritt)
  main.js           Hauptprozess: Fenster (SakuraWindow), Tabs, Menüs, Befehle (uiCommands/pageCommands)
  preload-ui.js     Brücke für die Browser-Oberfläche (window.chrome2.call / .on)
  preload-page.js   Brücke für sakura://-Seiten + „Zu Sakura hinzufügen“-Knopf im Chrome Web Store
  ui/               Browser-Oberfläche: Tabs, Adressleiste, Favoritenleiste, Menüs, Seitenleisten-Panels
  pages/            sakura://newtab (Startseite), sakura://error und themes.js (Designs) – auch von Android genutzt;
                    sakura://settings (settings.html/.js, Einstellungsseite – nur PC, Befehle über pageCommands.settings mit fester Liste)
  assets/           blocklist.txt, cookie-reject.js (Cookie-Banner), youtube.js/.css (Werbung, SponsorBlock, Qualität), video.js (Weiterschauen, Intro, nächste Folge), media.js (Kino-Modus, Helligkeit, Ton, Sleep-Timer) – auch Android
  lib/              model.js (Datenmodell + Zusammenführen), store.js, importer.js (Import aus anderen Browsern), passwords.js (Passwortmanager, safeStorage), sponsorblock.js, sync.js (Firebase, Ende-zu-Ende-verschlüsselt),
                    crypto.js, adblock.js, extensions.js + crx.js (Chrome-Erweiterungen), downloads.js,
                    updater.js (electron-updater), favicons.js
  test/             Tests ohne Electron (electron-mock.js ersetzt es) → `npm test` im Ordner desktop
android/            Android-App (Kotlin, ein Activity, WebView) – app/src/main/java/de/ali/sakura/*.kt
  app/src/main/assets  newtab.html (Kopie aus desktop/pages!), manage.html (Lesezeichen/Verlauf/Skripte/Einstellungen), error.html, blocklist.txt
.github/workflows/  release.yml (baut + veröffentlicht), security-update.yml (wöchentlich Electron-Patches)
sync-server/        Sakura-Sync-Dienst (Netlify Function + Blobs) für den Abgleich per Sync-Code – speichert nur Verschlüsseltes;
                    läuft auf https://sakura-sync.netlify.app; nach Änderungen von Hand neu hochladen (siehe sync-server/LIESMICH.md)
firebase/           firestore.rules (alternativer Abgleich über ein eigenes Firebase-Projekt)
```

## Regeln

- **Gemeinsame Dateien synchron halten:** Nach jeder Änderung an `desktop/pages/newtab.html`, `error.html`, `themes.js` (Designs), `desktop/assets/blocklist.txt`, `cookie-reject.js`, `youtube.js`, `youtube.css`, `video.js` oder `media.js` die Datei nach `android/app/src/main/assets/` kopieren (`theme-test` prüft newtab.html und themes.js).
- **Synchronisierte Daten** (Lesezeichen, Kacheln, Verlauf, Skripte, Geräte, Einstellungen) müssen auf PC (`lib/model.js`) und Android (`SyncModel.kt`) gleich zusammengeführt werden. Neue synchronisierte Felder in beiden ergänzen. Die Verschlüsselung (`crypto.js` / `SyncCrypto.kt`) und die Ableitung aus dem Sync-Code (`synccode.js` / `SyncCode.kt`) nicht ändern, sonst können sich Geräte nicht mehr lesen.
- **Sicherheit:** Seiten-Inhalte niemals mit Node-Rechten ausführen. Neue Befehle für sakura://-Seiten nur in `pageCommands` (prüft die Herkunft). Webinhalte, Dateinamen, Titel immer mit `esc()` ausgeben. Die Oberfläche hat eine CSP ohne Inline-Skripte/-Handler.
- **Design:** Farben nie fest eintragen, sondern über die CSS-Variablen aus `pages/themes.js` (Nutzer können Designs und Akzentfarbe wählen). Standard: Dunkles Nachtindigo (`--yoru #1C1A33`), Kirschblüte als Akzent (`--sakura #F2B3C5`), Rot für Siegel/Privat (`--beni #D9566F`), Mincho-Schrift für Überschriften. Keine Emojis in der Oberfläche. Texte kurz, im Du, aktiv („Lesezeichen gespeichert“).
- **Tests:** Vor jedem Commit `cd desktop && npm test`. Für neue Logik Tests in `desktop/test/` ergänzen und in `run-all.js` eintragen. Android-Code kann ohne Android-SDK nicht gebaut werden – Kotlin sorgfältig schreiben; GitHub baut die APK nur, wenn der Signaturschlüssel hinterlegt ist.
- **Veröffentlichen = auf `main` pushen.** Jeder Push, der `desktop/` oder `android/` ändert, baut automatisch eine neue Version (Versionsnummer zählt der Workflow selbst hoch – `package.json`-Version nicht von Hand ändern). Installierte Sakura-Versionen aktualisieren sich dann selbst. Nach dem Push den Lauf unter Actions prüfen; schlägt er fehl, Ursache beheben und erneut pushen.
- Vor dem Push `git pull --rebase`, weil der Workflow Versions-Commits auf `main` schreibt.
- Commits mit aussagekräftiger deutscher Nachricht, eine Funktion pro Commit.

## Bekannte Grenzen

- Chrome-Erweiterungen laufen über Electrons eingeschränkte Unterstützung; nicht jede funktioniert.
- Electron-Hauptversionen werden nicht automatisch übernommen (Dependabot-PR), Patches schon.
- Die portable .exe aktualisiert sich nicht selbst; nur die per Installer installierte Version.
