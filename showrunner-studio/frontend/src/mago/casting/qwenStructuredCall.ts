/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: unchanged apart from import paths; Showwriter passes it a Gemini-backed run function.
 * See LICENSE and NOTICE.md at the repository root.
 */
import { stripQwenReasoning } from "../stripQwenReasoning";

import { CastingValidationError, coerceModel } from "./castingModels";
import { CastingCallError, type StructuredCall } from "./scriptCasting";

/**
 * The local stand-in for the cloud's Gemini call: Gemini takes the parts and a
 * response schema it enforces itself; the local text model takes one prompt
 * and is told the schema, so its answer is validated here and asked for once
 * more when it does not hold.
 */

type JsonRecord = Record<string, unknown>;

export const buildStructuredPrompt = (
  contents: string[],
  schema: Record<string, unknown>
): string =>
  [
    ...contents,
    [
      "RESPONSE FORMAT:",
      "Return one JSON object only, valid against this JSON schema. Fill every required field; " +
        'leave out a field whose description says "only fill this when" unless that instruction ' +
        "applies to this request.",
      JSON.stringify(schema)
    ].join("\n")
  ].join("\n\n");

const buildRepairPrompt = (prompt: string, problems: string): string =>
  [
    prompt,
    `RETRY REQUIREMENT: The previous answer was rejected: ${problems}.`,
    "Return the complete corrected JSON object immediately."
  ].join("\n\n");

const parseAnswer = (answer: string): unknown =>
  JSON.parse(stripQwenReasoning(answer));

export const createQwenStructuredCall =
  (run: (prompt: string) => Promise<string>): StructuredCall =>
  async ({ contents, schema, model, stepLabel }) => {
    const suffix = stepLabel ? ` (${stepLabel})` : "";
    const prompt = buildStructuredPrompt(contents, schema);
    let problems = "";
    for (const attempt of [prompt, null]) {
      // A model that cannot be reached is not a bad answer: let it propagate,
      // so the run pauses and can be resumed rather than failing for good.
      const answer = await run(attempt ?? buildRepairPrompt(prompt, problems));
      try {
        return coerceModel(model, parseAnswer(answer)) as JsonRecord;
      } catch (error) {
        problems =
          error instanceof CastingValidationError || error instanceof Error
            ? error.message
            : String(error);
      }
    }
    throw new CastingCallError(
      `Invalid response from model${suffix}`,
      problems
    );
  };
