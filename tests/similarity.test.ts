// Tests fuer Duplikat-Erkennung / Similarity
import { test, expect, describe } from "bun:test";
import { similarity, SIMILARITY_THRESHOLD } from "../src/core/similarity.ts";

describe("similarity", () => {
  test("identische Titel = 1.0", () => {
    expect(similarity("Login Feature", "Login Feature")).toBe(1);
  });

  test("case-insensitive identisch = 1.0", () => {
    expect(similarity("Login Feature", "login feature")).toBe(1);
  });

  test("aehnliche Titel ueber Schwellenwert", () => {
    const score = similarity("Login Feature bauen", "Login Feature implementieren");
    expect(score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  test("verschiedene Titel unter Schwellenwert", () => {
    const score = similarity("Login Feature bauen", "Datenbank Schema redesignen");
    expect(score).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  test("komplett verschiedene Titel = niedriger Score", () => {
    const score = similarity("API erstellen", "Frontend Design anpassen");
    expect(score).toBeLessThan(0.3);
  });

  test("leere Strings", () => {
    expect(similarity("", "")).toBe(1); // identisch
  });

  test("kurze Strings unter Trigram-Laenge", () => {
    // Nur Wort-basiert, da < 3 Zeichen keine Trigrams bilden
    const score = similarity("ab", "ab");
    expect(score).toBe(1);
  });

  test("Schwellenwert ist definiert", () => {
    expect(SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(SIMILARITY_THRESHOLD).toBeLessThan(1);
  });
});
