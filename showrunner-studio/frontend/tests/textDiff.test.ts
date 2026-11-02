import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffLines, hasChanges } from "../src/lib/textDiff";

describe("diffLines", () => {
  it("marks identical text as unchanged", () => {
    const ops = diffLines("a\nb", "a\nb");
    assert.deepEqual(ops.map((o) => o.type), ["same", "same"]);
    assert.equal(hasChanges(ops), false);
  });
  it("finds an inserted and a removed line", () => {
    const ops = diffLines("a\nb\nc", "a\nx\nb");
    assert.deepEqual(ops, [
      { type: "same", text: "a" },
      { type: "added", text: "x" },
      { type: "same", text: "b" },
      { type: "removed", text: "c" },
    ]);
  });
  it("handles empty sides", () => {
    assert.deepEqual(diffLines("", "hi"), [{ type: "added", text: "hi" }]);
    assert.deepEqual(diffLines("hi", ""), [{ type: "removed", text: "hi" }]);
    assert.deepEqual(diffLines("", ""), []);
  });
  it("falls back to a block replacement for huge inputs instead of freezing", () => {
    const big = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
    const other = Array.from({ length: 2500 }, (_, i) => `other ${i}`).join("\n");
    const ops = diffLines(big, other);
    assert.equal(ops.length, 5000);
    assert.equal(ops.filter((o) => o.type === "removed").length, 2500);
  });
});
