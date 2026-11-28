# Sakura im Microsoft Store

- Store-ID: 9PJD8PGG8VL2 – https://apps.microsoft.com/detail/9PJD8PGG8VL2
- Paketfamilie: EnergyPlay.SakuraBrowser_bcka1n6kqs4pj
- Das Store-Paket (`Sakura-Store-x.y.z.appx`) baut GitHub bei jeder Version automatisch mit und hängt es an das Release – sobald in `desktop/package.json` unter `build.appx.publisher` der Publisher-Wert (`CN=…`) aus Partner Center steht.
- Die Store-Version aktualisiert sich nicht selbst, das übernimmt der Store. Für ein Update einfach die neue `.appx` als neue Einreichung hochladen.

## Einreichen in Partner Center (partner.microsoft.com → Apps und Spiele → Sakura Browser)

1. **Preise und Verfügbarkeit:** Märkte „Alle“, Preis „Kostenlos“.
2. **Eigenschaften:** Kategorie „Produktivität“ (Unterkategorie keine), Datenschutzrichtlinie: `https://sakura-browser.netlify.app/datenschutz.html`, Website: `https://sakura-browser.netlify.app`, Supportkontakt: `https://github.com/EnergyPlayYT/sakura-browser/issues`.
   Häkchen: „Diese App greift auf das Internet zu“ – keine weiteren Systemanforderungen.
3. **Altersfreigaben:** Fragebogen ausfüllen. Bei der Frage nach uneingeschränktem Internetzugang „Ja“ (Browser) – ergibt meist „ab 12/16“, das ist für Browser normal.
4. **Pakete:** die Datei `Sakura-Store-x.y.z.appx` aus dem neuesten GitHub-Release hochladen.
5. **Store-Einträge → Deutsch:** Texte unten einfügen, Bilder aus `website/img/` (mind. 1 Screenshot, 1366×768 oder größer).
6. **Einreichungsoptionen:** Bei „Hinweise für Zertifizierung“ den Text unten einfügen. Dann **An Store übermitteln**.

## Store-Texte (Deutsch)

**Beschreibung**

Sakura ist ein ruhiger, schneller Browser im japanischen Kirschblüten-Stil – kostenlos, ohne Werbung und ohne Konto.

Werbe- und Trackerblocker, Schutz vor Betrugsseiten und automatisches Ablehnen von Cookie-Bannern sind eingebaut. Der Passwortmanager speichert Zugangsdaten verschlüsselt, schlägt starke Passwörter vor und warnt bei Datenlecks.

Neben jeder Seite öffnest du auf Wunsch die KI-Seitenleiste mit Claude, ChatGPT, Gemini oder Mistral – mit deinem eigenen Konto. Arbeitsbereiche trennen deine Tabs für Schule, Gaming oder Privat. Mit dem Sync-Code gleichst du Lesezeichen, Verlauf und offene Tabs Ende-zu-Ende-verschlüsselt mit deinem Handy ab.

Für Videos und Streams: YouTube-Werbung überspringen, Sponsor-Abschnitte auslassen, Twitch-Emotes von 7TV, BTTV und FFZ, Bild-in-Bild, Clips der letzten 30 Sekunden, Lautstärke pro Tab und eine Medien-Leiste für Musik im Hintergrund.

Dazu: Lesemodus und Leseliste, Notizen an Webseiten, Fokus-Modus gegen Ablenkung, Bildschirmzeit, geteilter Bildschirm, vertikale Tabs, Befehlssuche mit Strg+K und acht Designs mit Liquid-Glass-Oberfläche.

**Was ist neu in dieser Version**

KI-Seitenleiste, Arbeitsbereiche, Medien-Leiste und flüssigere Animationen.

**Funktionen (je eine Zeile)**

- Werbe-, Tracker- und Cookie-Banner-Blocker
- KI-Seitenleiste mit Claude, ChatGPT, Gemini und Mistral
- Passwortmanager mit Passwort-Generator und Leck-Prüfung
- Verschlüsselter Sync mit dem Handy – ohne Konto
- Arbeitsbereiche und vertikale Tabs
- YouTube ohne Werbung, Twitch-Emotes, Bild-in-Bild
- Fokus-Modus und Bildschirmzeit
- Lesemodus, Leseliste und Notizen
- Acht Designs im Liquid-Glass-Stil

**Kurzbeschreibung**

Ruhiger, schneller Browser mit Werbeblocker, KI-Seitenleiste und verschlüsseltem Sync.

**Suchbegriffe**

Browser, Werbeblocker, Datenschutz, KI, Sakura, Chromium, Passwortmanager

**Hinweise für Zertifizierung**

Sakura ist ein Webbrowser auf Basis von Chromium (Electron). Die Rendering-Engine wird mit jedem Release aktualisiert; Electron-Sicherheitspatches werden wöchentlich automatisch übernommen. Es ist kein Testkonto nötig. Netzwerkzugriff wird zum Laden von Webseiten benötigt.
