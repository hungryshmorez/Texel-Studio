/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths adjusted; the fixtures are Mago's own, unchanged.
 * See LICENSE and NOTICE.md at the repository root.
 */
import { describe, expect, it } from "vitest";

import { ADAPT_PROMPT_I2V_INSTRUCTION } from "../vlm/prompts/adaptPromptI2vMinimaxH3";

import {
  applyDialogue,
  dialogueBrief,
  dialogueFailures,
  type DialogueTurn,
  normalizeDialogue
} from "../videoPrompt/dialogueCompose";
import { generateVideoPrompt, VideoPromptError } from "../videoPrompt/videoPrompt";
import fixtures from "./videoPromptParity.fixtures.json";
import {
  crossShotSlot,
  planReferenceSlots,
  type PayloadEntity,
  shotVideoPromptPayload,
  slotsForReferenceLayout
} from "../videoPrompt/videoPromptPayload";

/**
 * Golden outputs from the backend's own composer, written by
 * scripts/castingParity/generate_fixtures.py. Each composer case replays the
 * scripted model answers the backend saw and must send the same contents and
 * produce the same document.
 */

type JsonRecord = Record<string, unknown>;

describe("video prompt parity: instruction texts", () => {
  it("uses the backend's adapt instruction word for word", () => {
    expect(ADAPT_PROMPT_I2V_INSTRUCTION).toBe(fixtures.adaptInstruction);
  });
});

describe("video prompt parity: composer", () => {
  for (const testCase of fixtures.composer as JsonRecord[]) {
    it(String(testCase.name), async () => {
      const answers = [...(testCase.answers as unknown[])];
      const sent: string[][] = [];
      const callModel = async (contents: string[]) => {
        sent.push(contents);
        const answer = answers.shift() ?? "error";
        if (answer === "error") throw new Error("model unavailable");
        return answer as Record<string, unknown>;
      };
      const captions = testCase.captions as Record<string, string>;
      const run = generateVideoPrompt(
        testCase.payload as JsonRecord,
        callModel,
        {
          engineVersion: String(testCase.engine),
          storedCaption: (assetId) => captions[assetId]
        }
      );
      if (testCase.error) {
        const expected = testCase.error as { message: string; status: number };
        await expect(run).rejects.toBeInstanceOf(VideoPromptError);
        await expect(run).rejects.toMatchObject(expected);
        return;
      }
      const result = await run;
      expect(sent).toEqual(testCase.contents);
      expect(result).toEqual(
        expect.objectContaining(testCase.result as JsonRecord)
      );
    });
  }
});

describe("video prompt parity: payload and slots", () => {
  const slots = fixtures.slots;

  it("plans reference slots the way the backend does", () => {
    for (const { groups, limit, output } of slots.planReferenceSlots)
      expect(planReferenceSlots(groups, limit)).toEqual(output);
  });

  it("builds the shot payload from project state", () => {
    const { shot, keys, output } = slots.shotVideoPromptPayload;
    expect(
      shotVideoPromptPayload(shot as JsonRecord, keys as JsonRecord[])
    ).toEqual(output);
  });

  it("folds the flat entities onto a slot layout", () => {
    for (const {
      entities,
      slots: layout,
      output
    } of slots.slotsForReferenceLayout)
      expect(
        slotsForReferenceLayout(
          entities as PayloadEntity[],
          layout as string[][] | null
        )
      ).toEqual(output);
  });

  it("describes the cross-shot reference slot", () => {
    expect([
      crossShotSlot("Continue."),
      crossShotSlot(null, "video"),
      crossShotSlot("Hold.", "image", "pin")
    ]).toEqual(slots.crossShotSlot);
  });
});

describe("video prompt parity: dialogue binding", () => {
  const dialogue = fixtures.dialogue;
  const [turns, warnings] = normalizeDialogue(
    dialogue.normalizeDialogue.input,
    ["hero"]
  );
  const labelFor = (refId: string) =>
    refId === "hero" ? "{{subject:hero}}" : undefined;

  it("normalises turns and numbers speakers", () => {
    expect(turns).toEqual(dialogue.normalizeDialogue.turns);
    expect(warnings).toEqual(dialogue.normalizeDialogue.warnings);
  });

  it("repairs and binds model documents, and reports what it cannot", () => {
    for (const { sections, applied, failures, hard } of dialogue.documents) {
      const document = sections as Record<string, string>;
      expect(
        applyDialogue(document, turns as DialogueTurn[], labelFor)
      ).toEqual(applied);
      expect(dialogueFailures(document, turns)).toEqual(failures);
      expect(dialogueFailures(document, turns, false)).toEqual(hard);
    }
  });

  it("briefs the model with placeholders, not words", () => {
    expect(dialogueBrief(turns, labelFor)).toBe(dialogue.brief);
  });
});
