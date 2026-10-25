import { describe, expect, it } from "vitest";
import { mergeNotebook } from "./storage";
import { original } from "../../tests/fixtures/ai";

const entry = { id: "saved-one", savedAt: "2026-10-25", original, servings: 2 };
describe("notebook transfer between app addresses", () => {
  it("imports the existing export format while preserving saved duplicates", () => {
    const text = JSON.stringify({
      version: 1,
      recipes: [entry, { ...entry, id: "saved-two" }],
    });
    const result = mergeNotebook(text, [entry]);
    expect(result.added).toBe(1);
    expect(result.entries.map((item) => item.id)).toEqual([
      "saved-one",
      "saved-two",
    ]);
  });
  it("rejects broken records and executable source links", () => {
    expect(() => mergeNotebook("{broken", [])).toThrow("valid recipe JSON");
    expect(() =>
      mergeNotebook(
        JSON.stringify({
          recipes: [{ ...entry, sourceUrl: "javascript:alert(1)" }],
        }),
        [],
      ),
    ).toThrow("valid Vegetate");
  });
});
