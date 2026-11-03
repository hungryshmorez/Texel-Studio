/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: node:crypto SHA-256 replaced by the synchronous implementation in ./hash.ts.
 * See LICENSE and NOTICE.md at the repository root.
 */
import { sha256Hex } from "./hash";

/**
 * What a render was asked for, hashed, so the same thing is never rendered
 * twice in bulk: the backend. The rules are the
 * backend's (NFC, whitespace collapsed, keys sorted); the bytes are not, so a
 * local fingerprint never matches a cloud one and is only compared locally.
 */

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

const normalizeText = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ");

const canonical = (value: unknown): unknown => {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
};

/** A stable hash of a spec: keys sorted, text normalised. */
export const fingerprint = (spec: JsonRecord): string =>
  "sha256:" + sha256Hex(JSON.stringify(canonical(spec)));

const flatten = (spec: JsonRecord, prefix = ""): Map<string, string> => {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(spec)) {
    const path = `${prefix}${key}`;
    if (isRecord(value))
      for (const entry of flatten(value, `${path}.`)) flat.set(...entry);
    else flat.set(path, JSON.stringify(canonical(value)));
  }
  return flat;
};

/** Dotted paths that differ, [] with nothing to compare. */
export const changedFields = (
  previous: unknown,
  current: unknown
): string[] => {
  if (!isRecord(previous) || !isRecord(current)) return [];
  if (!Object.keys(previous).length || !Object.keys(current).length) return [];
  const before = flatten(previous);
  const after = flatten(current);
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
};
