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
- [x] Steam: Spielerzahlen, Spielzeit; Preisvergleich nur mit offizieller Preis-API. (Spieler: Steam-Web-API; Spielzeit: SteamSpy; Preise: IsThereAnyDeal-API mit eigenem Schlüssel)
- [x] Hinweis: Automatisches Sammeln von Kanalpunkten/Drops verstößt gegen Twitchs Regeln (Kontosperre möglich) – nur nach ausdrücklicher Zustimmung von Ali. → Ali hat zugestimmt: Kanalpunkte-Bonus automatisch abholen, eigener Schalter (standardmäßig aus, mit Warnung). Drops nicht automatisiert.

## Etappe 6 – Komfort beim Lesen und Surfen
- [x] Lesemodus: Artikel ohne Werbung/Ablenkung (Mozilla Readability), Schriftgröße, Hell/Sepia/Dunkel, Vorlesen; Buch-Symbol in der Adressleiste, wenn die Seite ein Artikel ist.
- [x] Tab-Suche: Strg+Umschalt+A durchsucht alle offenen Tabs aller Fenster.
- [x] Lesezeichen-Ordner (PC und Android, synchronisiert); Import übernimmt Ordner.
- [x] Leseliste: Artikel für später merken, auch offline lesbar.


## Etappe 7 – Mehr Komfort, Streams und Schutz
- [x] Bildschirmfoto der ganzen Seite (auch der Teil unterhalb, per Chromium-DevTools-Protokoll).
- [x] Sitzungen speichern: alle offenen Tabs unter einem Namen merken und später wieder öffnen.
- [x] Tracker-Übersicht: pro Seite anzeigen, wie viel Werbung und Tracker blockiert wurden.
- [x] Notizen zur Seite: kleine Notiz an eine Webseite heften, erscheint beim nächsten Besuch wieder.
- [x] Mausgesten: rechte Maustaste halten und ziehen (zurück, vor, Tab schließen, neu laden).
- [x] Geteilter Bildschirm: zwei Tabs nebeneinander in einem Fenster.
- [x] Twitch „Nur Ton“: Stream im Hintergrund nur als Audio, spart Daten und Leistung.
- [x] Benachrichtigung, wenn ein gemerkter Twitch-Kanal oder YouTuber live geht.
- [x] Warnung vor bekannten Betrugs- und Phishing-Seiten (öffentliche Liste, täglich aktualisiert).
- [x] Verlauf und Passwörter mit einer PIN sperren (PC).
- [x] Startseiten-Widgets: Wetter, Uhrzeit in Japan, Tageszitat (PC und Android).
- [x] Tab ans Handy schicken und umgekehrt (über den Sync).
- [x] Oberfläche im Liquid-Glass-Stil: Glas-Flächen mit durchscheinender Seite, runde Kapseln, federnde Animationen.
- [x] Fernsteuerung (abschaltbar, standardmäßig aus): Programme auf diesem PC, z. B. Claude über Chrome DevTools MCP, dürfen Sakura bedienen.

## Etappe 8 – Bedienung, Fokus und neue Nutzer
- [x] Passwort-Generator: starkes Passwort bei der Registrierung vorschlagen und speichern.
- [x] QR-Code der Seite (zum Öffnen auf einem anderen Handy).
- [x] Tab-Vorschau: Vorschaubild beim Überfahren eines Tabs.
- [x] Befehlssuche (Strg+K): Befehle, Tabs, Lesezeichen, Verlauf, Einstellungen in einem Feld.
- [x] Link-Vorschau: langes Drücken auf einen Link öffnet eine schwebende Vorschau.
- [x] Vertikale Tabs (wahlweise links untereinander).
- [x] Fokus-Modus: ablenkende Seiten zu bestimmten Zeiten sperren.
- [ ] Bildschirmzeit: wie lange heute auf welchen Seiten (nur lokal).
- [ ] Tab-Archiv: lange unbenutzte Tabs automatisch aufräumen.
- [ ] Willkommens-Tour beim ersten Start (Design, Suchmaschine, Import, Sync).
- [ ] Einstellungsseite im Liquid-Glass-Stil.
- [ ] Android: Wischgesten (zurück/vor, Tab wechseln).
- [ ] Android: Leseliste und Notizen.

## Etappe 9 – Ton, Video und Extras
- [ ] Seiten-Lautstärke: eigener Lautstärkeregler pro Tab.
- [ ] Bild-in-Bild per Knopf am Video (nicht automatisch).
- [ ] Wegwerf-E-Mail: anonyme Adresse per Klick, Posteingang in Sakura.
- [ ] Clip-Knopf: die letzten 30 Sekunden eines Videos/Streams speichern.
- [ ] Android: Widget für den Startbildschirm (Suchfeld, öffnet Sakura).
