# Entwurf: Bug-Report für Ink

**Ziel:** https://github.com/vadimdemedes/ink/issues/new
**Status:** Entwurf — von JoPa zu prüfen und abzuschicken. Nichts wurde bisher gesendet.
**Titel:** `ErrorOverview uses raw stack trace lines as React keys, causing a duplicate-key warning that masks the real error`

---

When an Ink app runs without a TTY on stdin, `useInput()` throws `Raw mode is not supported`
from a React passive effect. Ink's own `ErrorBoundary` catches this and renders
`ErrorOverview` — but `ErrorOverview` uses each raw stack trace line as the React `key`:

```js
// node_modules/ink/build/components/ErrorOverview.js:56-72
error.stack
  .split('\n')
  .slice(1)
  .map(line => {
    const parsedLine = stackUtils.parseLine(line);
    if (!parsedLine) {
      return React.createElement(Box, { key: line }, /* ... */);
    }
    return React.createElement(Box, { key: line }, /* ... */);
  })
```

Stack traces are not guaranteed to have unique lines. When the throw originates inside
React's mutually recursive passive-effect traversal (`recursivelyTraversePassiveMountEffects`
↔ `commitPassiveMountOnFiber`), the same frame appears once per nesting level — and Ink's own
provider chain (Accessibility, App, Stdin, Stdout, Stderr, Focus, Cursor, ErrorBoundary)
guarantees several levels. Those identical lines collide as keys.

The result is misleading: instead of `Raw mode is not supported`, the user sees
`Encountered two children with the same key` pointing at
`react-reconciler.development.js`, which looks like a bug in their own component tree. It
cost us a full debugging cycle to trace this back to Ink rather than our own code.

## Reproduction

Eight lines, no application code involved:

```jsx
import React from 'react';
import {render, Text, useInput} from 'ink';

function App() {
  useInput(() => {});
  return <Text>hello</Text>;
}

render(<App />);
```

Run it without a TTY on stdin:

```sh
node app.js < /dev/null
```

**Expected:** a readable message that raw mode is not supported.
**Actual:** `Encountered two children with the same key, ...` where the colliding key is
itself a raw React reconciler stack frame.

Running the identical code with a working TTY produces no warning at all, which confirms the
warning is coupled to the missing raw-mode support rather than to any application state.

## Environment

- ink 6.8.0
- react-reconciler 0.33.0
- Bun 1.3.9 (also reproduces under Node)
- macOS (Darwin 25.6.0)

## Suggested fix

Make the key unique per entry rather than deriving it from the text alone — e.g. include the
index (`key={`${index}-${line}`}`). The lines are rendered in a stable order and are never
reordered, so an index-based key is safe here.

Two other `key={line}` usages in the same file (the source excerpt block around line 48 and
55) key on a line *number*, which is genuinely unique within an excerpt — those look fine.

---

## Kontext für JoPa (nicht Teil des Issues)

Gefunden bei der Untersuchung von #37. Der erste Anlauf suchte den Fehler in unserem eigenen
Code (doppelte Labels als React-Keys) und wurde vom Review widerlegt. Die tatsächliche
Ursache liegt in Ink.

Auf unserer Seite ist das mit dem TTY-Guard in `src/cli/commands/tui.ts` erledigt — wir
laufen gar nicht mehr in den kaputten Pfad. Der Upstream-Report ist reine Kulanz: Der
nächste, der über dieselbe irreführende Meldung stolpert, verliert sonst denselben Tag.

Vor dem Abschicken kurz prüfen, ob es bereits ein Issue dazu gibt — ich habe das Ink-Repo
nicht durchsucht.
