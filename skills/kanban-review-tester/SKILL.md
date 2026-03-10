---
name: kanban-review-tester
description: Testet alle Kanban-Tasks im Status "Review" automatisch mit Chrome/Playwright und VHS (Terminal). Erkennt automatisch ob ein Task Browser- oder Terminal-Tests braucht. Liest Task-Notes, startet Server wenn nötig, testet visuell und funktional, und dokumentiert Ergebnisse in den Task-Notes. Nutze diesen Skill wenn JoPa sagt "teste die Reviews", "prüfe das Kanban", "review testen", "Playwright review" oder ähnliches.
---

# Kanban Review Tester

Automatisiertes Testen von Kanban-Tasks im Status "Review" mit Chrome/Playwright (Browser) und VHS (Terminal).

**Ansage bei Start:** "Ich teste jetzt die Review-Tasks aus dem Kanban."

## Workflow

```
1. Kanban lesen → Review-Tasks sammeln
2. Pro Task: Test-Typ erkennen (Browser / Terminal / Beides)
3. Projekt-Setup erkennen → Server starten (nur wenn Browser-Tests nötig)
4. Pro Task: Notes lesen → Testplan ableiten → Testen → Ergebnis dokumentieren
5. Zusammenfassung an JoPa
```

## Phase 1: Review-Tasks sammeln

1. `kanban_list_tasks` aufrufen — nach Tasks mit Status/Column "review" filtern
2. Für jeden Review-Task: `kanban_get_task` aufrufen um vollständige Notes zu lesen
3. Task-Liste mit Titel, ID und Notes-Zusammenfassung ausgeben
4. Wenn keine Review-Tasks vorhanden: JoPa informieren und stoppen

## Phase 2: Test-Typ pro Task erkennen

Für jeden Review-Task anhand von **Titel**, **Notes** und **Labels** entscheiden welcher Test-Typ passt.

### Erkennungs-Regeln

**Terminal-Test** wenn eines oder mehrere dieser Keywords zutreffen:

| Kategorie | Keywords |
|-----------|----------|
| CLI/Scripts | `cli`, `command`, `terminal`, `script`, `bash`, `shell`, `zsh` |
| Build/Tooling | `build`, `compile`, `bundle`, `lint`, `format`, `prettier`, `eslint` |
| Backend-only | `api`, `endpoint`, `migration`, `seed`, `database`, `schema`, `query` |
| Config/Infra | `config`, `env`, `.env`, `docker`, `ci`, `pipeline`, `deploy` |
| Refactoring | `refactor`, `rename`, `cleanup`, `performance`, `optimize` |
| Tests | `test`, `spec`, `jest`, `vitest`, `unittest`, `e2e setup` |

**Browser-Test** wenn eines oder mehrere dieser Keywords zutreffen:

| Kategorie | Keywords |
|-----------|----------|
| UI-Elemente | `button`, `dialog`, `modal`, `form`, `input`, `dropdown`, `menu`, `tooltip` |
| Layout/Design | `layout`, `responsive`, `css`, `style`, `animation`, `theme`, `dark mode` |
| Seiten/Routes | `seite`, `page`, `route`, `navigation`, `sidebar`, `header`, `footer` |
| Frontend | `frontend`, `component`, `ui`, `ux`, `view`, `render`, `display` |
| Interaktion | `click`, `hover`, `drag`, `scroll`, `keyboard shortcut`, `focus` |

**Beides** wenn Keywords aus beiden Kategorien vorkommen (z.B. "API-Endpoint + UI-Anzeige").

**Fallback:** Wenn keine Keywords matchen → Browser-Test (Smoke-Test der App).

### Ergebnis

Pro Task einen Test-Typ zuweisen und in der Task-Übersicht anzeigen:

```
Review-Tasks:
- #12 "CLI Export-Befehl"           → Terminal
- #15 "Neuer Dialog für Settings"   → Browser
- #18 "API + Frontend Anzeige"      → Beides
```

## Phase 3: Projekt erkennen & Server starten

**Nur ausführen wenn mindestens ein Task Browser-Tests braucht.** Bei reinen Terminal-Tasks diese Phase überspringen.

### Projekt-Erkennung

Das aktuelle Projekt anhand des Working Directory identifizieren:

1. **package.json lesen** — Scripts für `dev`, `start`, `build` identifizieren
2. **Projektstruktur scannen** — Monorepo? Separate Backend/Frontend-Ordner?
3. **CLAUDE.md des Projekts lesen** — Dort steht oft der Tech-Stack und wie man startet
4. **.env prüfen** — Sind Umgebungsvariablen vorhanden?

### Server starten

**Typische Patterns erkennen und anwenden:**

| Pattern | Erkennung | Start-Befehl |
|---------|-----------|--------------|
| Monorepo (Turborepo/Nx) | `turbo.json` oder `nx.json` | `npm run dev` im Root |
| Separate Ordner | `backend/` + `frontend/` | Zwei separate Prozesse |
| Single App (Next.js, Nuxt, etc.) | Framework in package.json | `npm run dev` |
| Electron | `electron` in dependencies | `npm run dev` oder `npm start` |
| Python Backend + JS Frontend | `requirements.txt` + `package.json` | `python manage.py runserver` + `npm run dev` |

**Server-Start Prozedur:**

1. Dependencies prüfen — `node_modules` vorhanden? Sonst `npm install` / `bun install`
2. Backend starten (falls separat) — als Hintergrundprozess via Bash mit `run_in_background`
3. Frontend starten — als Hintergrundprozess via Bash mit `run_in_background`
4. Warten bis Server erreichbar sind — Port-Check mit `curl` oder `lsof`
5. Base-URL für Tests merken (typisch: `http://localhost:3000`, `http://localhost:5173`, etc.)

**WICHTIG:**
- Ports aus package.json Scripts, .env oder Projekt-Konfiguration ableiten
- Wenn unklar welcher Port: häufige Ports probieren (3000, 5173, 8080, 4200)
- Server-Prozess-IDs merken für Cleanup am Ende

## Phase 4: Tasks testen

Für **jeden** Review-Task folgende Schritte durchführen — je nach erkanntem Test-Typ.

### 4a. Testplan aus Notes ableiten

Die Task-Notes frei interpretieren. Typische Informationen die daraus abgeleitet werden:

- **Was wurde implementiert?** → Was muss getestet werden
- **Welche Seite/Route betroffen?** → Wo navigieren
- **Erwartetes Verhalten?** → Was visuell/funktional prüfen
- **UI-Elemente erwähnt?** → Buttons, Formulare, Dialoge die interagiert werden sollen
- **Edge Cases erwähnt?** → Fehlerzustände, leere Zustände testen

Wenn die Notes wenig hergeben:
- Task-Titel als Hinweis nutzen
- Labels des Tasks berücksichtigen
- Grundlegende Smoke-Tests durchführen (Seite lädt, keine Console-Errors, UI rendert)

### 4b. Browser-Tests durchführen (Test-Typ: Browser)

**Playwright MCP Tools nutzen** (NICHT Python-Scripts):

1. **Browser öffnen & navigieren:**
   - `browser_navigate` zur relevanten URL
   - Warten bis Seite geladen

2. **Visueller Check:**
   - `browser_snapshot` — Accessibility-Snapshot des DOM lesen
   - `browser_take_screenshot` — Visuellen Screenshot machen und analysieren
   - Prüfen: Rendert die UI korrekt? Fehlen Elemente? Layout-Probleme?

3. **Funktionale Tests:**
   - `browser_click` — Buttons, Links, Menüs testen
   - `browser_fill_form` — Formulare ausfüllen wenn relevant
   - `browser_select_option` — Dropdowns testen
   - `browser_press_key` — Keyboard-Shortcuts testen wenn erwähnt
   - Nach jeder Aktion: erneut `browser_snapshot` oder `browser_take_screenshot`

4. **Console & Netzwerk prüfen:**
   - `browser_console_messages` — Auf Errors/Warnings prüfen
   - `browser_network_requests` — Fehlgeschlagene API-Calls identifizieren

5. **Ergebnis pro Test-Schritt dokumentieren:**
   - Was wurde getestet
   - Was war das Ergebnis (bestanden/fehlgeschlagen)
   - Bei Fehler: Was genau ist schiefgegangen

### 4c. Terminal-Tests durchführen (Test-Typ: Terminal)

**VHS** für visuelle Terminal-Dokumentation, **Bash** für funktionale Prüfung.

#### Schritt 1: Befehl(e) aus Notes ableiten

Aus den Task-Notes die relevanten Befehle identifizieren:
- CLI-Befehle die getestet werden sollen
- Build-Commands (`npm run build`, `cargo build`, etc.)
- Migrations (`npm run migrate`, `python manage.py migrate`)
- Lint/Format-Checks (`npm run lint`, `prettier --check`)
- Test-Suites (`npm test`, `pytest`, `cargo test`)
- Skript-Ausführungen die im Task beschrieben sind

Wenn Notes keine konkreten Befehle nennen → aus dem Kontext ableiten (z.B. bei Task "ESLint Config angepasst" → `npm run lint` ausführen).

#### Schritt 2: Funktionaler Test via Bash

Zuerst den Befehl direkt via Bash ausführen und Ergebnis prüfen:

1. **Befehl ausführen** — Via Bash Tool im Projekt-Verzeichnis
2. **Exit-Code prüfen** — 0 = Erfolg, alles andere = Fehler
3. **Output analysieren** — Errors, Warnings, erwartete Ausgabe vorhanden?
4. **Ergebnis merken** — Für die Dokumentation in den Notes

#### Schritt 3: Visuelle Dokumentation via VHS

Nach dem funktionalen Test ein VHS-Tape erstellen um den Terminal-Output visuell festzuhalten:

**Tape-Datei dynamisch generieren:**

```bash
cat <<'TAPE' > /tmp/kanban_test_[task-id].tape
Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 800
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms

Type "[der zu testende Befehl]"
Sleep 300ms
Enter
Sleep [angemessene Wartezeit]s
TAPE
```

**VHS ausführen:**

```bash
vhs /tmp/kanban_test_[task-id].tape -o /tmp/kanban_test_[task-id].gif
```

**GIF analysieren:**

Das erzeugte GIF mit dem Read-Tool öffnen und visuell prüfen:
- Befehl wurde korrekt ausgeführt?
- Output sieht wie erwartet aus?
- Keine Fehler oder unerwartete Ausgaben?

**VHS-Einstellungen anpassen je nach Kontext:**

| Situation | Anpassung |
|-----------|-----------|
| Langer Output | `Set Height 1200` für mehr Zeilen |
| Schneller Befehl | `Sleep 2s` nach Enter reicht |
| Langsamer Befehl (Build) | `Sleep 10s` oder mehr |
| Mehrere Befehle | Mehrere Type+Enter Blöcke hintereinander |
| Interaktiver Befehl | `Type` + `Enter` + `Type "y"` + `Enter` etc. |

**WICHTIG:**
- VHS braucht den `-o` Flag für absolute Pfade
- Tape-Dateien in `/tmp/` ablegen — werden nicht ins Projekt geschrieben
- GIF-Dateien ebenfalls in `/tmp/` — temporär für die Analyse
- Nach Analyse aufräumen: Tape + GIF löschen

#### Schritt 4: Kombinierte Bewertung

- Bash Exit-Code + Output = funktionales Ergebnis
- VHS GIF = visuelle Bestätigung
- Beides zusammen ergibt das Testergebnis für die Notes

### 4d. Ergebnis in Task-Notes schreiben

**Bei bestandenem Browser-Test:**

```markdown
## Testergebnis (automatisch)
**Status:** Bestanden
**Test-Typ:** Browser (Playwright)
**Getestet am:** [Datum]
**Getestete URL:** [URL]

### Durchgeführte Tests:
- [x] Seite lädt ohne Fehler
- [x] [Spezifischer Test aus Notes]
- [x] Keine Console-Errors

### Beobachtungen:
[Kurze Beschreibung was gesehen wurde]
```

**Bei bestandenem Terminal-Test:**

```markdown
## Testergebnis (automatisch)
**Status:** Bestanden
**Test-Typ:** Terminal (VHS)
**Getestet am:** [Datum]

### Ausgeführte Befehle:
- `[befehl]` → Exit-Code 0

### Durchgeführte Tests:
- [x] Befehl erfolgreich ausgeführt
- [x] [Spezifischer Test aus Notes]
- [x] Keine Fehler im Output

### Terminal-Output (Zusammenfassung):
[Relevanter Output — gekürzt wenn sehr lang]

### VHS-Aufnahme:
Visuell geprüft — Output wie erwartet.
```

→ Task bleibt auf "Review" — JoPa entscheidet über "Done"
→ `kanban_update_task` mit ergänzten Notes aufrufen

**Bei fehlgeschlagenem Test (Browser oder Terminal):**

```markdown
## Testergebnis (automatisch)
**Status:** Fehlgeschlagen
**Test-Typ:** [Browser (Playwright) / Terminal (VHS)]
**Getestet am:** [Datum]

### Durchgeführte Tests:
- [x] [Bestandener Test]
- [ ] [Fehlgeschlagener Test]

### Fehler:
[Genaue Beschreibung was nicht funktioniert hat]

### Fehler-Output:
[Exit-Code, Error-Messages, Console-Errors — je nach Test-Typ]
```

→ Task zurück auf "In Progress" verschieben: `kanban_move_task`
→ `kanban_update_task` mit Fehlerbeschreibung in Notes

## Phase 5: Cleanup & Zusammenfassung

1. **Browser schließen** (falls geöffnet): `browser_close`
2. **Server stoppen** (falls gestartet): Gestartete Hintergrundprozesse beenden
3. **Temp-Dateien aufräumen:** VHS Tapes und GIFs aus `/tmp/` löschen
4. **Zusammenfassung an JoPa:**

```
Review-Test Zusammenfassung:
- X von Y Tasks bestanden
- Bestanden: [Task-Titel Liste]
- Fehlgeschlagen: [Task-Titel Liste mit Kurzgrund]

Aufschlüsselung:
- Browser-Tests: X bestanden, Y fehlgeschlagen
- Terminal-Tests: X bestanden, Y fehlgeschlagen
- Nächste Schritte: [Empfehlungen]
```

## Sonderfälle

### Task ohne testbare Änderung (weder UI noch Terminal)
Manche Tasks haben keine direkt testbare Ausgabe (z.B. reine Doku-Änderungen, Kommentar-Cleanup). In diesem Fall:
- In den Notes vermerken: "Kein automatischer Test möglich — Task betrifft [Beschreibung]"
- Wenn möglich trotzdem Smoke-Test: App startet noch? Build funktioniert?
- Task auf "Review" belassen

### Server startet nicht
- Fehlermeldung dokumentieren
- Alle Tasks als "nicht testbar" markieren mit Grund
- JoPa sofort informieren

### Mehrere Projekte / Teams
- Nur Tasks des aktuellen Projekts testen (Working Directory = Projektkontext)
- Wenn Tasks aus verschiedenen Projekten im Review stehen: JoPa fragen welches Projekt

## Regeln

- **Niemals** einen Task auf "Done" setzen — das macht nur JoPa
- **Immer** alle Review-Tasks testen, nicht nur einzelne auswählen
- **Immer** Ergebnisse in die Task-Notes schreiben
- **Immer** Server am Ende stoppen (falls gestartet)
- **Immer** VHS Temp-Dateien aufräumen (`/tmp/kanban_test_*`)
- **Bei Unsicherheit** was getestet werden soll: Smoke-Test + in Notes vermerken was unklar war
- Bestehende Notes im Task **nicht überschreiben** — Testergebnis anhängen
- **VHS nur für visuelle Dokumentation** — funktionaler Test immer zuerst via Bash (schneller, Exit-Code auswertbar)
- **VHS Voraussetzung:** `vhs` muss im PATH sein — wenn nicht vorhanden, Terminal-Tests nur via Bash durchführen und in Notes vermerken dass VHS nicht verfügbar war
