# Sakura – Aufgaben

Vorbild ist der „Beta Browser“ (https://beta-browser.de/). Jede Etappe wird als eigenes Update veröffentlicht (auf `main` pushen). Erledigtes abhaken `[x]`.

## Etappe 1 – Import, Designs, Cookie-Banner, YouTube

- [x] **Import aus anderen Browsern** (Windows): Einstellungen → „Daten importieren“ und Menüpunkt „Lesezeichen und Verlauf importieren …“.
  - Profile automatisch finden: Chrome, Edge, Brave, Vivaldi (`%LOCALAPPDATA%\…\User Data\<Profil>`, Namen aus `Local State` → `profile.info_cache`), Opera und Opera GX (`%APPDATA%\Opera Software\Opera Stable` bzw. `Opera GX Stable`), Firefox (`%APPDATA%\Mozilla\Firefox\profiles.ini` → `places.sqlite`).
  - Lesezeichen: Chromium-Datei `Bookmarks` (JSON; `roots.bookmark_bar` → Favoritenleiste, Rest danach), Firefox `moz_bookmarks` + `moz_places` (Ordner `toolbar_____` → Favoritenleiste). Ordner gibt es in Sakura noch nicht → flach übernehmen. Doppelte Adressen überspringen.
  - Verlauf: Chromium `History` (Tabelle `urls`, Zeit = Mikrosekunden seit 1601), Firefox `moz_places.last_visit_date` (Mikrosekunden seit 1970). Nur die letzten 90 Tage, höchstens 3000 Einträge.
  - SQLite mit dem eingebauten `node:sqlite` (`DatabaseSync`, readOnly) lesen – vorher die Datei samt `-wal`/`-shm` in einen Temp-Ordner kopieren. Ist sie gesperrt (Browser offen), klare Meldung: „Schließ Chrome und versuch es noch einmal.“
  - Zusätzlich: „Aus HTML-Datei importieren“ (Netscape-Lesezeichenformat, das jeder Browser exportieren kann; ermöglicht auch Safari usw.).
  - Ergebnis anzeigen: „87 Lesezeichen und 1.240 Verlaufseinträge aus Chrome übernommen.“ Tests mit nachgebauten Profilen.
- [x] **Cookies importieren** (Wunsch von Ali): Firefox direkt, Chromium-Browser über den mit Windows-DPAPI geschützten Schlüssel aus „Local State“ (AES-GCM „v10“). „v20“-Cookies (App-gebundene Verschlüsselung, Chrome ab 127) sind für andere Programme nicht lesbar → zählen und Hinweis zeigen.
- [x] **Designs:** mindestens 8 fertige Designs (Sakura als Standard, z. B. Yoru/Mitternacht, Momiji/Herbst, Matcha, Fuji/Lila, Sumi/Schwarz-Weiß, Washi/Hell, Neon/Synthwave) + eigene Akzentfarbe. Gilt für Oberfläche, Startseite (Himmel/Blütenfarben der gezeichneten Szene) und Titelleiste (`win.setTitleBarOverlay`). Einstellung `theme`/`accent` in den synchronisierten Einstellungen; Android-Startseite und `manage.html` übernehmen das Design.
- [x] **Cookie-Banner automatisch ablehnen** (Schalter in den Einstellungen, standardmäßig an): eingebautes Seitenskript nach dem Laden (wie `runUserScripts`). Bekannte Banner direkt ablehnen (OneTrust `#onetrust-reject-all-handler`, Cookiebot, Usercentrics im Shadow-DOM `#usercentrics-root`, Didomi, Quantcast, Google/YouTube-Zustimmungsseite „Alle ablehnen“), sonst Knöpfe mit Text wie „Alle ablehnen“/„Nur notwendige“/„Reject all“ in Elementen mit cookie/consent/gdpr/cmp in id/class. 10 Sekunden lang per MutationObserver nachsehen. Ausnahme pro Seite über das Schild-Menü.
- [x] **YouTube** (Schalter, standardmäßig an): Werbung überspringen (bei `.ad-showing` Video ans Ende setzen, Überspringen-Knöpfe klicken, Werbeflächen per CSS ausblenden), Sponsor-Abschnitte über die SponsorBlock-API mit Hash-Präfix (`/api/skipSegments/<sha256-Präfix>` – schützt die Privatsphäre) überspringen, Qualität auf 1080p setzen. Auch beim Wechsel zwischen Videos (YouTube lädt ohne Seitenwechsel → `yt-navigate-finish`).
- [x] **Hintergrundbilder** (Wunsch von Ali): Ordner `desktop/backgrounds/` – Bilder darin zeigt die Startseite auf PC und Android als Diashow, Wechsel jede Minute mit weichem Überblenden und langsamem Zoom. Bilder lädt Ali selbst auf GitHub hoch.
- [x] Danach: Version veröffentlichen, Lauf prüfen, Ali in einfachen Worten berichten.

## Etappe 2 – Leistung und Gaming
- [x] Leistungs-Panel: CPU/RAM pro Tab (`app.getAppMetrics()`), Internet, Ping; Tab „schlafen legen“.
- [x] Grenzen für RAM/CPU; Hintergrund-Tabs automatisch schlafen legen.
- [x] Gaming-Modus: erkennt laufende Spiele (Prozessliste) und senkt Sakuras Priorität.
- [x] Schwebendes Video über allem (always-on-top, optional durchklickbar), Medientasten.

## Etappe 3 – Video und Serien
- [x] Weiterschauen, wo man war (auf jeder Seite), Intro überspringen, nächste Folge automatisch.
- [x] Sleep-Timer (30 Min. / Ende der Folge), Kino-Modus, Helligkeit, Bass/Dialog-Verstärker, Equalizer pro Seite.
- [x] Popup-Blocker gegen Werbefenster und Klickfallen.

## Etappe 4 – Konten und Sicherheit
- [x] Passwortmanager (mit Windows-Konto verschlüsselt über `safeStorage`), Leck-Prüfung über die k-Anonymität-API von Have I Been Pwned, Import per CSV aus Chrome/Firefox.
- [x] Mehrere Konten gleichzeitig (bis zu 5 getrennte „Konto-Tabs“ über eigene Sitzungen).
- [x] Seitenüberwachung: Benachrichtigung bei Preisänderung oder wieder verfügbar.
- [x] Streamer-Modus (private Daten unscharf, wenn OBS läuft).

## Etappe 5 – Twitch und Steam
- [x] 7TV/BTTV/FFZ-Emotes im Twitch-Chat, Multistream (bis 4 Streams nebeneinander).
- [ ] Steam: Spielerzahlen, Spielzeit; Preisvergleich nur mit offizieller Preis-API.
- [x] Hinweis: Automatisches Sammeln von Kanalpunkten/Drops verstößt gegen Twitchs Regeln (Kontosperre möglich) – nur nach ausdrücklicher Zustimmung von Ali. → Ali hat zugestimmt: Kanalpunkte-Bonus automatisch abholen, eigener Schalter (standardmäßig aus, mit Warnung). Drops nicht automatisiert.
