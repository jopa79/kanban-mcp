# Team-Memory — kanban-mcp

Lessons aus Korrekturen von JoPa. Als Regel formuliert, die denselben Fehler verhindert.

---

## Entwürfe für externe Stellen gehören nicht ins Repo

**Korrektur vom 2026-08-13.** Ich hatte einen Entwurf für einen Upstream-Bug-Report
(Ink) unter `.claude/ink-bug-report.md` im Repo angelegt und mitcommittet. Er landete
über `git add -A` auf `origin/main`. JoPa: "nimm den ink-report wieder raus".

**Warum:** Ein Entwurf ist noch nicht abgeschickt und noch nicht entschieden. Liegt er
im versionierten Repo, sieht er aus wie eine getroffene Aussage des Projekts — und er
ist danach nur mit einem History-Rewrite wieder vollständig weg, der auf einem
gepushten öffentlichen Branch gesperrt und unverhältnismäßig ist.

**Regel:** Alles, was erst nach JoPas Freigabe nach außen geht — Issue-Entwürfe für
fremde Repos, Mailtexte, Ankündigungen — wird im **Scratchpad** angelegt und per
`SendUserFile` übergeben, nie im Repo. Wenn eine solche Datei doch im Repo entstehen
soll, vorher fragen.

**Zusatz:** `git add -A` nimmt mit, was gerade herumliegt. Vor dem Commit `git status`
lesen und den Dateisatz gegen den Task prüfen. Fällt beim Committen etwas
Task-Fremdes auf, ist die richtige Reaktion "gehört das überhaupt hierher?" — nicht
"ich trenne es in einen eigenen Commit".
