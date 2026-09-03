// Einzeilige Texteingabe fuer die TUI -- Ersatz fuer ink-text-input
// (GitHub #50, Plan .claude/plans/tui-input-flicker.md Schritt 2).
//
// Warum ein eigener Ersatz: ink-text-input erwartet 'value' als
// kontrollierten Prop und rechnet bei jeder Taste
// 'originalValue.slice(...) + input + ...'. Lag der Wert bisher in app.tsx
// (inputValue), loeste jeder Tastendruck ein Rendern des GESAMTEN Boards aus
// (gemessen 9ms im Schnitt, 23ms max pro Frame). Und weil Inks useInput()
// seinen Handler in einem useEffect mit dem Handler selbst als Dependency
// registriert (node_modules/ink/build/hooks/use-input.js), lief bei
// schnellem Tippen noch der ALTE Handler mit dem ALTEN Prop-Wert weiter, bis
// der Passive-Effect nachzog. Ergebnis: verschluckte und vertauschte
// Zeichen, gemessen ab 15ms Tastenabstand.
//
// LineInput haelt Wert UND Cursor in einem useRef HIER in der Komponente
// (nicht als Prop von aussen). Der Ref ist die alleinige Quelle der
// Wahrheit: jeder Tastendruck liest und schreibt stateRef.current SYNCHRON
// im Handler, egal welcher Handler-Closure gerade laeuft (alt oder neu aus
// Inks useEffect-Registrierung) -- ein Ref hat keine Closure-Kopie, alle
// Generationen des Handlers sehen denselben, immer aktuellen Wert.
// useState daneben loest nur noch das Rendern aus. Ein 'setState(prev => ...)'
// allein haette dasselbe Problem nicht geloest, weil onSubmit/onCancel DARIN
// aufgerufen ein State-Update einer anderen Komponente (App) waehrend der
// Render-Phase von LineInput ausloest -- React verweigert das ("Cannot
// update a component while rendering a different component"). Deshalb hier:
// Ref zuerst synchron aktualisieren, danach Callback separat aufrufen.
// Ausserdem rendert ein Tastendruck jetzt nur noch DIESE Komponente, nicht
// mehr das ganze Board.
import React, { useRef, useState } from "react";
import { Text, useInput, type Key } from "ink";

export interface LineInputState {
  value: string;
  cursor: number;
}

// Cursor als Code-Point-Index, nicht als UTF-16-Code-Unit-Index -- ein
// Emoji ausserhalb der Basic Multilingual Plane (z.B. 😀, U+1F600) besteht
// aus zwei Code-Units, aber einem Code-Point. Rechnete der Cursor in
// Code-Units (frueher: 'initialValue.length'), landete er nach dem Tippen
// eines solchen Emoji mitten im Surrogatpaar (gefunden im Review von #50).
export function initLineInputState(initialValue: string): LineInputState {
  return { value: initialValue, cursor: [...initialValue].length };
}

export type LineInputAction = "none" | "submit" | "cancel";

// Reine Tastenlogik ohne State-Zugriff aus einem Closure -- separat testbar
// ohne Renderer (siehe tests/line-input.test.ts). Gibt zusaetzlich zum
// naechsten Zustand nur zurueck, OB submit/cancel ausgeloest werden soll;
// ruft selbst keine Callbacks auf und bleibt damit eine reine Funktion.
//
// Rechnet durchgehend auf einem Code-Point-Array ('chars'), nicht auf
// UTF-16-Indizes des Strings direkt (siehe initLineInputState-Kommentar).
// Frueher zerlegte ein Backspace direkt NACH einem Emoji dessen
// Surrogatpaar in ein einzelnes, ungueltiges Lone-Surrogate-Zeichen --
// dieser kaputte Text konnte bis in die SQLite-Datenbank durchreichen.
// Deckt Emoji als einzelnen Code-Point ab, NICHT Grapheme-Cluster
// (z.B. Familien-Emoji aus mehreren Code-Points per ZWJ, oder ein
// Buchstabe + Combining-Akzent in NFD-Normalform, wie ihn macOS bei
// eingefuegten Dateipfaden liefert) -- das braeuchte Grapheme-Segmentierung
// und ist bewusst nicht Teil dieses Fixes (kein kaputter Text, nur ein
// Backspace, der optisch nichts zu tun scheint).
export function reduceLineInput(
  state: LineInputState,
  input: string,
  key: Key,
): { state: LineInputState; action: LineInputAction } {
  if (key.upArrow || key.downArrow || key.tab || (key.ctrl && input === "c")) {
    return { state, action: "none" };
  }
  if (key.return) return { state, action: "submit" };
  if (key.escape) return { state, action: "cancel" };

  const chars = [...state.value];

  if (key.leftArrow) {
    return { state: { ...state, cursor: Math.max(0, state.cursor - 1) }, action: "none" };
  }
  if (key.rightArrow) {
    return { state: { ...state, cursor: Math.min(chars.length, state.cursor + 1) }, action: "none" };
  }
  if (key.home) return { state: { ...state, cursor: 0 }, action: "none" };
  if (key.end) return { state: { ...state, cursor: chars.length }, action: "none" };

  if (key.backspace || key.delete) {
    if (state.cursor === 0) return { state, action: "none" };
    chars.splice(state.cursor - 1, 1);
    return { state: { value: chars.join(""), cursor: state.cursor - 1 }, action: "none" };
  }

  if (key.ctrl || key.meta || !input) {
    return { state, action: "none" };
  }

  // Normales Zeichen ODER Paste (input.length > 1 bei mehreren Zeichen auf
  // einmal). Zeilenumbrueche aus Paste entfernen -- LineInput ist einzeilig.
  const clean = input.replace(/[\r\n]/g, "");
  if (!clean) return { state, action: "none" };
  const insertChars = [...clean];
  chars.splice(state.cursor, 0, ...insertChars);
  return { state: { value: chars.join(""), cursor: state.cursor + insertChars.length }, action: "none" };
}

interface LineInputProps {
  // Vorbelegung beim Mount, z.B. bestehender Titel oder Export-Pfad mit
  // Datum. Aenderungen an dieser Prop NACH dem Mount werden bewusst
  // ignoriert (kein useEffect-Sync) -- der Wert lebt danach ausschliesslich
  // im internen State, genau das vermeidet die Board-weiten Rerenders.
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
}

export function LineInput({ initialValue = "", onSubmit, onCancel }: LineInputProps) {
  const stateRef = useRef<LineInputState>(initLineInputState(initialValue));
  const [state, setState] = useState<LineInputState>(stateRef.current);

  useInput((input, key) => {
    // Ref ist die Quelle der Wahrheit (siehe Datei-Kommentar oben) --
    // 'stateRef.current', nicht 'state' aus dem Closure.
    const { state: next, action } = reduceLineInput(stateRef.current, input, key);
    stateRef.current = next;
    setState(next);
    // Callback NACH dem Ref-Update, aber ausserhalb des State-Setters --
    // damit ein Enter direkt nach der letzten Taste garantiert den
    // vollstaendigen Wert abschickt, ohne den State-Setter einer anderen
    // Komponente aus der Render-Phase heraus aufzurufen.
    if (action === "submit") onSubmit(next.value);
    else if (action === "cancel") onCancel?.();
  });

  const chars = [...state.value];
  const { cursor } = state;

  return (
    <Text>
      {chars.length === 0 ? (
        <Text inverse> </Text>
      ) : (
        chars.map((ch, i) => (
          <Text key={i} inverse={i === cursor}>{ch}</Text>
        ))
      )}
      {chars.length > 0 && cursor === chars.length && <Text inverse> </Text>}
    </Text>
  );
}
