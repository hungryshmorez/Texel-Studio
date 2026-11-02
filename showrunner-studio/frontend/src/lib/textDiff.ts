// textDiff.ts — small line diff (longest common subsequence) for revision history.

export type DiffOp = { type: "same" | "added" | "removed"; text: string };

export function diffLines(before: string, after: string): DiffOp[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  // Guard against pathological inputs: fall back to a whole-block replacement.
  if (a.length * b.length > 4_000_000) {
    return [...a.map((text) => ({ type: "removed" as const, text })), ...b.map((text) => ({ type: "added" as const, text }))];
  }
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ type: "same", text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ type: "removed", text: a[i] }); i++; }
    else { ops.push({ type: "added", text: b[j] }); j++; }
  }
  while (i < a.length) ops.push({ type: "removed", text: a[i++] });
  while (j < b.length) ops.push({ type: "added", text: b[j++] });
  return ops;
}

export const hasChanges = (ops: DiffOp[]): boolean => ops.some((op) => op.type !== "same");
