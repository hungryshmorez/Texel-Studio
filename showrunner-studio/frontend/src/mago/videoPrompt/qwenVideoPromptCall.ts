/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
import { buildStructuredPrompt } from "../casting/qwenStructuredCall";
import { stripQwenReasoning } from "../stripQwenReasoning";

import { SECTION_ORDER, type VideoPromptModelCall } from "./videoPrompt";

/**
 * The local stand-in for the composer's Gemini call. Gemini enforces the
 * six-section response schema itself; the local text model is told it, so an
 * answer that is not the object is asked for once more before the composer
 * treats the call as failed (and falls back to its skeleton, as the backend
 * does when Gemini errors).
 */

export const VIDEO_PROMPT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    subject_definitions: {
      type: "string",
      description:
        "one line per reference/subject, {{kind:ref_id}} placeholders only"
    },
    summary: {
      type: "string",
      description: "one paragraph opening with the [task types] prefix"
    },
    retention_analysis: {
      type: "string",
      description: "one line per label, allowed markers only, never a (Sx)"
    },
    detailed_description: {
      type: "string",
      description: "style line, then [Shot 1] ..., 350-500 words"
    },
    overall_soundscape: {
      type: "string",
      description: "ambience and physical sound, no dialogue"
    },
    non_diegetic_music: { type: "string", description: "score, or N/A" }
  },
  required: [...SECTION_ORDER]
};

const problemsWith = (
  answer: string
): [Record<string, unknown> | null, string] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripQwenReasoning(answer));
  } catch {
    return [null, "the answer was not valid JSON"];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return [null, "the answer was not a JSON object"];
  const value = parsed as Record<string, unknown>;
  const missing = SECTION_ORDER.filter(
    (name) => typeof value[name] !== "string"
  );
  return missing.length
    ? [null, `these sections are missing or not strings: ${missing.join(", ")}`]
    : [value, ""];
};

export const createQwenVideoPromptCall =
  (run: (prompt: string) => Promise<string>): VideoPromptModelCall =>
  async (contents) => {
    const prompt = buildStructuredPrompt(contents, VIDEO_PROMPT_SCHEMA);
    const [first, problem] = problemsWith(await run(prompt));
    if (first) return first;
    const [second, repeated] = problemsWith(
      await run(
        [
          prompt,
          `RETRY REQUIREMENT: The previous answer was rejected: ${problem}.`,
          "Return the complete corrected JSON object immediately."
        ].join("\n\n")
      )
    );
    if (second) return second;
    throw new Error(
      `Invalid video prompt from the local text model: ${repeated}`
    );
  };
