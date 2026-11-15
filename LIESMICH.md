# Sakura – dein eigener Browser

Zwei Apps, ein Konto:

- **desktop/** – Browser für Windows (Chromium-Engine über Electron)
- **android/** – Browser-App für Android (System-WebView)
- **firebase/** – Sicherheitsregeln für die Synchronisation

Beide teilen sich die Startseite (Uhr, Suche, Kacheln, Nachtszene mit Kirschblüten) und gleichen über Firebase Lesezeichen, Startseiten-Kacheln, Verlauf und Einstellungen ab.

---

## 1. Windows-Browser starten

Voraussetzung: [Node.js](https://nodejs.org) (LTS-Version).

```
cd desktop
npm install
npm start
```

Installationsdatei bauen:

```
npm run build
```

Danach liegen in `desktop/dist/` ein Installer (`Sakura Setup 1.0.0.exe`) und eine portable Version, die ohne Installation läuft.

### Tastenkürzel

| Kürzel | Aktion |
|---|---|
| Strg+T / Strg+W | Neuer Tab / Tab schließen |
| Strg+Umschalt+T | Zuletzt geschlossenen Tab wieder öffnen |
| Strg+N / Strg+Umschalt+N | Neues Fenster / Neues privates Fenster |
| Strg+Tab, Strg+1 … 9 | Tabs wechseln |
| Strg+L oder F6 | In die Adressleiste |
| Strg+D | Lesezeichen setzen oder entfernen |
| Strg+H / Strg+Umschalt+O | Verlauf / Lesezeichen |
| Strg+F | Auf der Seite suchen |
| Strg+J | Downloads |
| Strg+S | Seite als PDF speichern |
| Strg+Umschalt+M | Tab stumm schalten |
| Strg + / − / 0 | Zoom |
| F5, Strg+R | Neu laden |
| F11 / F12 | Vollbild / Entwicklertools |

Tabs lassen sich per Ziehen sortieren, mit der mittleren Maustaste schließen, und ein Doppelklick auf die freie Fläche der Tableiste öffnet einen neuen Tab. Ein Rechtsklick auf einen Tab bietet Anheften, Stummschalten, Duplizieren und „Andere Tabs schließen“. In die Adressleiste kannst du auch `chrome://extensions`, `chrome://downloads` oder `chrome://history` tippen.

### Tab-Gruppen

Rechtsklick auf einen Tab → **Zu neuer Gruppe hinzufügen**. Gib der Gruppe einen Namen und eine Farbe. Ein Klick auf das farbige Etikett klappt die Gruppe ein oder auf, ein Rechtsklick darauf öffnet Name, Farbe, „Neuer Tab in dieser Gruppe“, „Gruppierung aufheben“ und „Gruppe schließen“. Tabs kannst du auf das Etikett ziehen, um sie in die Gruppe zu holen, oder herausziehen. Links aus einem Gruppen-Tab öffnen sich in derselben Gruppe. Gruppen bleiben nach einem Neustart erhalten.

Auf Android: in der Tab-Übersicht lange auf einen Tab drücken. Ein Tipp auf die Gruppen-Überschrift klappt sie ein, langes Drücken öffnet Umbenennen, Farbe usw.

### Erweiterungen aus dem Chrome Web Store

1. Menü → *Erweiterungen* → **Chrome Web Store öffnen** (oder das Puzzle-Symbol).
2. Eine Erweiterung öffnen, z. B. Dark Reader oder Bitwarden.
3. Auf der Seite auf **Zu Sakura hinzufügen** klicken – Sakura ersetzt den Knopf „Zu Chrome hinzufügen“ des Stores durch seinen eigenen. Bei installierten Erweiterungen steht dort „Aus Sakura entfernen“.
4. Die Berechtigungen bestätigen. Das Symbol der Erweiterung erscheint rechts neben der Adressleiste; Klick öffnet ihr Fenster, Rechtsklick zeigt Optionen und Entfernen.

Sakura sucht einmal pro Woche nach Updates (oder auf Knopfdruck in der Verwaltung). Mit **Entpackte laden** kannst du auch eigene Erweiterungen aus einem Ordner testen.

**Ehrlich gesagt:** Sakura nutzt die Erweiterungs-Unterstützung von Electron. Die kann längst nicht alles, was Chrome kann. Erweiterungen, die nur Seiten verändern (Dark Reader, Übersetzer-Hilfen, viele Skript-Erweiterungen), laufen meist; Erweiterungen, die tief in Tabs, Fenster oder Menüs eingreifen, können teilweise oder gar nicht funktionieren. In privaten Fenstern sind Erweiterungen aus.

---

## 2. Android-App bauen

Voraussetzung: Android Studio.

1. Android Studio → **Open** → den Ordner `android` wählen.
2. Wenn Android Studio fragt, ob es den Gradle-Wrapper anlegen oder das Android-Gradle-Plugin aktualisieren soll: zustimmen.
3. Handy per USB verbinden (USB-Debugging an) und auf **Run** drücken – oder **Build → Build App Bundle(s) / APK(s) → Build APK(s)** und die APK aufs Handy kopieren.

In Android unter *Einstellungen → Apps → Standard-Apps → Browser* kannst du Sakura als Standardbrowser auswählen.

Im Menü findest du außerdem: *Auf der Seite suchen*, *Seite übersetzen*, *Eigene Skripte*.

Bedienung: Tabs-Knopf unten (zeigt die Anzahl) öffnet die Tab-Übersicht mit „Neuer Tab“ und „Privater Tab“. Im Menü (⋮) findest du Lesezeichen, Verlauf, „Zur Startseite hinzufügen“, Desktop-Version und die Einstellungen. Auf der Startseite: Kachel lange drücken zum Bearbeiten.

---

## 3. Synchronisation einrichten (einmalig, kostenlos)

Der Abgleich ist **Ende-zu-Ende-verschlüsselt**: Bevor Daten dein Gerät verlassen, werden sie mit deinem **Sync-Passwort** verschlüsselt (AES-256-GCM, Schlüssel über PBKDF2 mit 310.000 Runden). Auf dem Server liegt nur unlesbarer Datensalat – weder Google noch jemand mit Zugriff auf dein Firebase-Projekt kann ihn lesen. Das Sync-Passwort selbst verlässt nie dein Gerät; gespeichert wird nur der daraus berechnete Schlüssel, in Sakuras privatem Datenordner.

- Das **Konto-Passwort** meldet dich bei Firebase an, das **Sync-Passwort** verschlüsselt. Nimm zwei verschiedene.
- Auf allen Geräten dasselbe Sync-Passwort verwenden.
- **Vergessen?** Dann sind die Daten auf dem Server nicht mehr zu retten. Deine Geräte behalten aber ihre eigenen Daten: unter „Sync-Passwort vergessen?“ legst du die Server-Daten mit einem neuen Passwort neu an.
- **Ändern:** Einstellungen → „Sync-Passwort ändern“. Die anderen Geräte fragen dann nach dem neuen.
- Wer Sakura schon vorher genutzt hat, wird einmal nach einem Sync-Passwort gefragt; die bisherigen unverschlüsselten Daten werden dabei übernommen und verschlüsselt.

1. Auf [console.firebase.google.com](https://console.firebase.google.com) ein neues Projekt anlegen (Google Analytics kannst du abwählen).
2. **Authentication** → *Jetzt starten* → Anmeldemethode **E-Mail/Passwort** aktivieren.
3. **Firestore Database** → *Datenbank erstellen* (Standort z. B. `europe-west3`, Produktionsmodus).
4. In Firestore unter **Regeln** den Inhalt von `firebase/firestore.rules` einfügen und veröffentlichen.
5. **Projekteinstellungen → Allgemein**: „Web-API-Schlüssel“ und „Projekt-ID“ notieren.
   (Falls dort kein Web-API-Schlüssel steht: unten eine Web-App hinzufügen – dann erscheint er.)
6. Im Windows-Browser: Menü → *Einstellungen und Synchronisation* → Werte, Konto-Passwort und ein **Sync-Passwort** (mind. 8 Zeichen) eintragen → **Konto anlegen**.
7. In der Android-App: Menü → *Einstellungen und Synchronisation* → dieselben Werte und dasselbe Sync-Passwort → **Anmelden**.

Danach gleichen beide Geräte sich automatisch ab: beim Start, wenige Sekunden nach jeder Änderung und alle 5 Minuten. Gelöschte Einträge werden auf allen Geräten gelöscht.

Abgeglichen werden: Lesezeichen, Startseiten-Kacheln, Verlauf (die letzten 500 Seiten), eigene Skripte, Einstellungen und die **offenen Tabs** – die siehst du auf dem jeweils anderen Gerät oben im Verlauf. Erweiterungen werden nicht abgeglichen (Android kann keine Chrome-Erweiterungen ausführen).

---

## 4. Was drin ist

- **Tabs und Lesezeichen**, Verlauf mit Suche, Vorschläge in der Adressleiste aus Lesezeichen und Verlauf
- **Werbeblocker**: blockiert Anfragen an rund 185 bekannte Werbe- und Tracker-Domains; mit der „erweiterten Liste“ (StevenBlack-Hosts) etwa 80.000. Pro Seite pausierbar über das Schild-Symbol.
- **Eigene Startseite**: Uhr, Suche, sortierbare Kacheln; optional eigene Hintergrundbilder, die sich alle X Minuten abwechseln
- **Chrome-Erweiterungen** (nur Windows) – Installation direkt aus dem Chrome Web Store, mit Berechtigungsabfrage, Updates und Verwaltung
- **Eigene Skripte** (Windows und Android, synchronisiert) – kleine JavaScript-Programme, die auf bestimmten Seiten laufen. Tampermonkey-Skripte kannst du einfügen; Name und Seiten werden automatisch übernommen. GM_-Funktionen gibt es nicht.
- **Tabs von anderen Geräten** – was auf dem Handy offen ist, siehst du am PC im Verlauf und umgekehrt
- **Downloads** (Windows) – Liste mit Fortschritt, Pausieren, Abbrechen, Im Ordner anzeigen
- **Sitzung wiederherstellen** (Windows) – öffnet beim Start die Tabs vom letzten Mal; Hintergrund-Tabs laden erst, wenn du sie anklickst
- **Webseiten dunkel** – „Immer dunkel“ dunkelt auch Seiten ohne eigenen Dunkelmodus ab (Windows nach Neustart, Android sofort)
- **Seite übersetzen** (über Google Übersetzer), **Als PDF speichern**, **Bildschirmfoto**, **Suchen auf der Seite** (jetzt auch Android)
- **Privatmodus**
  - Windows: eigenes Fenster mit eigener Sitzung – kein Verlauf, Cookies und Anmeldungen verschwinden beim Schließen.
  - Android: private Tabs speichern keinen Verlauf; mit aktuellem „Android System WebView“ bekommen sie eigene Cookies, die gelöscht werden, wenn der letzte private Tab zu ist.
- Kamera, Mikrofon, Standort und Benachrichtigungen fragt der Windows-Browser vorher nach. Auf Android sind sie für Webseiten aus.

## 5. Grenzen, die du kennen solltest

- Der Werbeblocker arbeitet mit Domain-Listen. Werbung, die von derselben Domain kommt wie die Seite selbst (z. B. YouTube-Videowerbung), blockiert er nicht.
- Ein Passwortmanager ist nicht eingebaut – am PC kannst du z. B. Bitwarden als Erweiterung installieren.
- Auf Android gibt es keine Chrome-Erweiterungen (das kann WebView technisch nicht). Dafür laufen dort deine eigenen Skripte.
- Google-Anmeldungen können in eigenen Browsern gelegentlich mit „Dieser Browser ist möglicherweise nicht sicher“ abgelehnt werden. Sakura gibt sich deshalb als normales Chrome aus; falls es trotzdem passiert, hilft meist ein zweiter Versuch.
- Automatische Updates gibt es nur, wenn Sakura über GitHub gebaut wird (Abschnitt 6) und du den Installer nutzt. Die portable .exe und selbst gebaute Versionen aktualisieren sich nicht.
- Sakura ist nicht digital signiert. Windows SmartScreen warnt deshalb beim ersten Installieren („Weitere Informationen → Trotzdem ausführen“).

## Dateien, die du anpassen kannst

- `desktop/assets/blocklist.txt` – Grundliste des Werbeblockers (eine Domain pro Zeile). Nach Änderungen auch nach `android/app/src/main/assets/` kopieren.
- `%APPDATA%\Sakura\eigene-filter.txt` – eigene Ergänzungen am PC (Ordner über Einstellungen → *Datenordner öffnen*).
- `desktop/pages/newtab.html` – Startseite (gilt für beide Apps, ebenfalls nach `android/app/src/main/assets/` kopieren).

---

## 6. Automatische Sicherheitsupdates über GitHub einrichten

**Warum:** Am PC bringt Sakura seine eigene Chromium-Engine mit, die sich nicht von selbst aktualisiert. Auf Android ist das kein Problem – dort kommen die Webseiten-Updates über „Android System WebView“ aus dem Play Store.

**So läuft es danach von allein:**
1. Jeden Montag prüft GitHub, ob Electron (und damit Chromium) Sicherheitskorrekturen hat (`.github/workflows/security-update.yml`).
2. Wenn ja, wird Sakura mit der neuen Version gebaut und als Release veröffentlicht (`release.yml`) – Windows-Installer und, falls eingerichtet, die Android-APK.
3. Sakura am PC prüft alle 4 Stunden auf neue Releases, lädt sie im Hintergrund und zeigt oben **„Neu starten und aktualisieren“**. Spätestens beim nächsten Beenden wird installiert. Tabs bleiben erhalten.
4. Die Android-App fragt einmal am Tag nach und bietet neue Versionen zum Herunterladen an.
5. Neue **Hauptversionen** von Electron schlägt Dependabot als Pull Request vor, weil sie Anpassungen brauchen könnten. Wenn die genutzte Version keine Sicherheitsupdates mehr bekommt, legt GitHub ein Issue mit Hinweis an. Den Pull Request übernehmen („Merge“) reicht – dann wird automatisch neu gebaut.

**Einrichten (einmalig, etwa 10 Minuten):**
1. Auf github.com ein neues Repository anlegen, z. B. `sakura-browser` (privat ist in Ordnung; dann sind aber auch die Releases privat – für Updates muss es **öffentlich** sein).
2. Den Inhalt dieses Ordners hochladen, z. B. mit GitHub Desktop oder:
   ```
   git init
   git add .
   git commit -m "Sakura"
   git branch -M main
   git remote add origin https://github.com/DEIN-NAME/sakura-browser.git
   git push -u origin main
   ```
3. Im Repo unter **Settings → Actions → General → Workflow permissions** „Read and write permissions“ auswählen.
4. Unter **Actions** → „Sakura veröffentlichen“ → **Run workflow**. Nach etwa 10 Minuten liegt unter **Releases** der Installer `Sakura-Setup-….exe`. Diesen einmal installieren – ab dann aktualisiert sich Sakura selbst.

**Android-App ebenfalls automatisch bauen (optional):** Android-Updates müssen immer mit demselben Schlüssel signiert sein. Einmal am PC einen Schlüssel erzeugen (Java ist bei Android Studio dabei):
```
keytool -genkeypair -v -keystore sakura.jks -alias sakura -keyalg RSA -keysize 4096 -validity 10000
```
Dann im Repo unter **Settings → Secrets and variables → Actions** vier Secrets anlegen:
- `ANDROID_KEYSTORE_BASE64` – Inhalt von `sakura.jks` als Base64 (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("sakura.jks"))`)
- `ANDROID_KEYSTORE_PASSWORD` und `ANDROID_KEY_PASSWORD` – die vergebenen Passwörter
- `ANDROID_KEY_ALIAS` – `sakura`

Bewahre `sakura.jks` gut auf: Ohne ihn lassen sich keine Updates mehr über die installierte App spielen. Die erste APK aus dem Release installierst du von Hand; danach meldet die App neue Versionen selbst.
