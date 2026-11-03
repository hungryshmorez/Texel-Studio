/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths adjusted; the fixtures are Mago's own, unchanged.
 * See LICENSE and NOTICE.md at the repository root.
 */
import { describe, expect, it } from "vitest";

import { buildShotVideoPromptBody } from "../videoPrompt/shotVideoPromptBody";
import fixtures from "./videoPromptParity.fixtures.json";

import { buildStoryboardPrompt } from "../storyboards/buildStoryboardPrompt";
import { sceneCast, sceneCuts, sceneFingerprint } from "../storyboards/storyboard";
import { templateLayout } from "../storyboards/template";

describe("Storyboards match the pinned backend", () => {
  for (const entry of fixtures.storyboards) {
    it(entry.name, () => {
      expect(sceneCuts(entry.shot.video_prompt)).toEqual(entry.cuts);
      expect(sceneCast(entry.shot, entry.keys)).toEqual(entry.cast);
      expect(
        buildStoryboardPrompt(entry.shot, entry.keys, entry.outputSize)
      ).toBe(entry.prompt);
      expect(
        templateLayout(entry.cuts.cuts.length, entry.outputSize).aspect
      ).toBe(entry.aspect);
      const original = sceneFingerprint(entry.shot, entry.keys);
      expect(
        original !==
          sceneFingerprint(
            entry.shot,
            entry.keys.map((key) => ({
              ...key,
              description: "Another caption."
            }))
          )
      ).toBe(entry.descriptionChangeIsStale);
      expect(
        original !==
          sceneFingerprint(
            entry.shot,
            entry.keys.map((key) =>
              key.token === "cat" ? { ...key, name: "Mittens" } : key
            )
          )
      ).toBe(entry.renameIsStale);
      const body = buildShotVideoPromptBody({
        shot: {
          video_prompt: entry.shot.video_prompt,
          references: {},
          _local_storyboard: {
            asset_id: "board",
            panel_count: entry.cuts.cuts.length
          }
        },
        keys: [],
        referenceSlots: [],
        imageAssetIds: [],
        continuityImage: null,
        continuityVideo: null,
        durationSeconds: 6
      });
      expect(body.references).toEqual([
        expect.objectContaining({
          ref_id: "storyboard-sheet",
          panel_count: entry.cuts.cuts.length,
          description: entry.slotDescription
        })
      ]);
    });
  }
});
