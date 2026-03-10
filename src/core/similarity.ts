// Duplikat-Erkennung fuer Task-Titel
// Kombiniert Trigram-Similarity mit Wort-Overlap fuer bessere Erkennung

// Text in Trigramme zerlegen
function trigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().trim();
  const result = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    result.add(normalized.slice(i, i + 3));
  }
  return result;
}

// Jaccard-Similarity: |A ∩ B| / |A ∪ B|
function trigramSimilarity(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return 0;
  const triA = trigrams(a);
  const triB = trigrams(b);

  let intersection = 0;
  for (const tri of triA) {
    if (triB.has(tri)) intersection++;
  }
  const union = triA.size + triB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Wort-basierte Similarity: Anteil gemeinsamer Woerter
function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Kombinierte Similarity: max aus Trigram und Wort-basiert
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.toLowerCase() === b.toLowerCase()) return 1;

  const tri = trigramSimilarity(a, b);
  const word = wordSimilarity(a, b);

  // Gewichteter Mix: Wort-Overlap zaehlt staerker bei Task-Titeln
  return Math.max(tri, word);
}

// Schwellenwert: ab wann gelten Titel als "aehnlich"
export const SIMILARITY_THRESHOLD = 0.5;
