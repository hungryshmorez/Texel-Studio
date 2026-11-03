import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { sha1Hex, sha256Hex } from "../src/mago/hash.ts";

const samples = [
  "",
  "a",
  "abc",
  "D'Artagnan",
  "名前 مرحبا Привет",
  "x".repeat(55),
  "x".repeat(56),
  "x".repeat(64),
  "x".repeat(1000)
];

test("sha1Hex matches node:crypto", () => {
  for (const s of samples)
    assert.equal(sha1Hex(s), createHash("sha1").update(s, "utf8").digest("hex"));
});

test("sha256Hex matches node:crypto", () => {
  for (const s of samples)
    assert.equal(
      sha256Hex(s),
      createHash("sha256").update(s, "utf8").digest("hex")
    );
});
