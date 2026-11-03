/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
/**
 * Python's text forms for the values the composer prints, so a ported prompt
 * reads byte-for-byte like the backend's: `str(float)` keeps its ".0", and
 * `json.dumps` uses ", " / ": " separators and escapes non-ASCII.
 *
 * JavaScript has one number type, so which values are floats is stated by the
 * caller (`floatKeys`): the composer knows its durations are floats.
 */

/** `str(x)` for a Python float. */
export const pyFloat = (value: number): string => {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
};

/** Everything outside printable ASCII is escaped, astral characters as their
 * surrogate pair, as `ensure_ascii` does. */
const HEX_RADIX = 16;
const ESCAPE_DIGITS = 4;

const escapeString = (value: string): string =>
  JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) =>
      `\\u${char.charCodeAt(0).toString(HEX_RADIX).padStart(ESCAPE_DIGITS, "0")}`
  );

/**
 * `json.dumps(value)`: default separators, `ensure_ascii=True`. Numbers under
 * a key in `floatKeys` print as floats; every other number as JSON does.
 */
export const pyJsonDumps = (
  value: unknown,
  floatKeys: ReadonlySet<string> = new Set()
): string => {
  const dump = (member: unknown, key: string | null): string => {
    if (member === null || member === undefined) return "null";
    if (typeof member === "boolean") return member ? "true" : "false";
    if (typeof member === "number")
      return key !== null && floatKeys.has(key)
        ? pyFloat(member)
        : Number.isFinite(member)
          ? String(member)
          : pyFloat(member).replace("inf", "Infinity").replace("nan", "NaN");
    if (typeof member === "string") return escapeString(member);
    if (Array.isArray(member))
      return `[${member.map((item) => dump(item, key)).join(", ")}]`;
    if (typeof member === "object")
      return `{${Object.entries(member as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([name, item]) => `${escapeString(name)}: ${dump(item, name)}`)
        .join(", ")}}`;
    // Not a JSON value (a function, a symbol): json.dumps would refuse it.
    return "null";
  };
  return dump(value, null);
};

const PYTHON_LINE_BOUNDARIES = new Set([
  "\n",
  "\v",
  "\f",
  "\r",
  "\x1c",
  "\x1d",
  "\x1e",
  "\x85",
  "\u2028",
  "\u2029"
]);
const CARRIAGE_RETURN = "\r";
const LINE_FEED = "\n";

/** `str.splitlines()`: every Python line boundary, no trailing empty line. */
export const pySplitLines = (text: string): string[] => {
  const lines: string[] = [];
  let currentLine = "";
  for (let position = 0; position < text.length; position += 1) {
    const character = text[position]!;
    if (!PYTHON_LINE_BOUNDARIES.has(character)) {
      currentLine += character;
      continue;
    }
    lines.push(currentLine);
    currentLine = "";
    if (character === CARRIAGE_RETURN && text[position + 1] === LINE_FEED)
      position += 1;
  }
  if (currentLine) lines.push(currentLine);
  return lines;
};
