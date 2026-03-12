# VHS Tape fuer TUI-Screenshot (Detail-Ansicht)
Output docs/tui-detail.gif
Set Shell "bash"
Set FontSize 14
Set Width 1400
Set Height 700
Set Padding 20
Set Theme "Catppuccin Mocha"

# Demo-Daten erzeugen und TUI starten
Type "bun run scripts/seed-demo.ts && bun run src/index.ts tui"
Enter
Sleep 3s

# Zu In Progress navigieren (1x rechts) und ersten Task oeffnen
Right
Sleep 500ms
Enter
Sleep 1s
Screenshot docs/tui-detail.png
