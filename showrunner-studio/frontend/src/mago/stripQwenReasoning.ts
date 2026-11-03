/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
const BACKTICK_CHARACTER_CODE = 96;
const MARKDOWN_FENCE_LENGTH = 3;

export const stripQwenReasoning = (raw: string): string => {
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|channel>[\s\S]*?<channel\|>/gi, "")
    .split("</think>")
    .at(-1)!
    .split("<channel|>")
    .at(-1)!
    .trim();
  const fence = String.fromCharCode(BACKTICK_CHARACTER_CODE).repeat(
    MARKDOWN_FENCE_LENGTH
  );
  if (cleaned.startsWith(fence)) {
    cleaned = cleaned.slice(fence.length).replace(/^json\s*/i, "");
  }
  if (cleaned.endsWith(fence)) {
    cleaned = cleaned.slice(0, -fence.length).trim();
  }
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("Qwen3.8 did not return a JSON object");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, index + 1);
    }
  }
  throw new Error("Qwen3.8 returned an incomplete JSON object");
};
