/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
import { REFERENCE_STYLE_NOTE, USER_MARKS_NOTE } from "../storyboards/prompts";

import {
  type Continuation,
  CROSS_SHOT_VIDEO_REF_ID,
  crossShotSlot,
  type PayloadEntity,
  type ReferenceSlot,
  shotVideoPromptPayload,
  slotsForReferenceLayout
} from "./videoPromptPayload";

/**
 * One local shot's composer body, assembled the way the cloud plan and its
 * submit tool assemble it: the shot's text from
 * project state, its slots folded onto the layout being rendered, each slot
 * paired with the asset that fills it, and the continuity reference last.
 *
 * Two local additions ride the shot's own fields, which the composer already
 * reads: the project's visual style as `style`, and the shot's camera as
 * `camera`.
 */

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);
const records = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * The pinned image's own description
 * once it has one (a blank one included), else the casting seed.
 */
export const resolvedDescription = (key: JsonRecord): string => {
  const image = records(key.images).find(
    (candidate) => candidate.asset_id === key.effective_asset_id
  );
  if (image && image.has_description === true) return text(image.description);
  return text(key.seed_description) || text(key.description);
};

/** The stored caption of a sheet image, for references described by nothing else. */
export const storedCaptionFor =
  (keys: JsonRecord[]) =>
  (assetId: string): string | null => {
    for (const key of keys)
      for (const image of records(key.images))
        if (image.asset_id === assetId && image.has_description === true)
          return text(image.description) || null;
    return null;
  };

export const aspectRatioLabel = (outputSize: unknown): string | null => {
  if (!Array.isArray(outputSize) || outputSize.length !== 2) return null;
  const width = Math.trunc(Number(outputSize[0]) || 0);
  const height = Math.trunc(Number(outputSize[1]) || 0);
  if (width <= 0 || height <= 0) return null;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const divisor = gcd(width, height) || 1;
  return `${width / divisor}:${height / divisor}`;
};

/**
 * When nothing composes the shot's document (rewrite off,
 * or no composer body), its sequential prompt_appendix is appended to the
 * shot's own prompt so the previous shot's reference still carries an
 * instruction.
 */
export const shotPromptWithSequentialAppendix = (
  shotPrompt: string | null | undefined,
  promptAppendix: string | null | undefined
): string =>
  [shotPrompt, (promptAppendix ?? "").trim()].filter(Boolean).join(" ");

const cameraText = (camera: unknown): string =>
  isRecord(camera)
    ? [camera.framing, camera.movement, camera.lens]
        .map(text)
        .filter(Boolean)
        .join("; ")
    : "";

export const buildShotVideoPromptBody = (input: {
  shot: JsonRecord;
  keys: JsonRecord[];
  referenceSlots: string[][];
  /** The asset filling each slot, in slot order (a gridded slot's grid). */
  imageAssetIds: string[];
  continuityImage: {
    id: string;
    description: string;
    continuation?: Continuation | null;
  } | null;
  continuityVideo: { id: string; description: string } | null;
  durationSeconds: number;
  outputSize?: unknown;
  visualStyle?: string;
}): JsonRecord => {
  const keys = input.keys.map((key) => ({
    ...key,
    description: resolvedDescription(key)
  }));
  const { entities, ...payload } = shotVideoPromptPayload(input.shot, keys);
  const [folded, ok] = slotsForReferenceLayout(
    entities as PayloadEntity[],
    input.referenceSlots
  );
  if (!ok)
    throw new Error(
      "The shot's described entities do not match the references being rendered"
    );
  const board = isRecord(input.shot._local_storyboard)
    ? input.shot._local_storyboard
    : null;
  const count = Number(board?.panel_count ?? 1);
  const boardDescription =
    count === 1
      ? "A storyboard for this clip, not something that appears in it: its one panel shows the clip's composition. Follow its framing, subject placement, eye level and camera direction."
      : `A storyboard for this clip, not something that appears in it: its ${count} panels, read left to right then top to bottom, are [Shot 1] to [Shot ${count}]. Follow each panel's framing, subject placement, eye level and camera direction for its shot. Never show several panels at once.`;
  const entitySlots: ReferenceSlot[] = board
    ? [
        ...folded,
        {
          ref_id: "storyboard-sheet",
          kind: "image",
          members: [],
          labels: [],
          description: `${boardDescription} ${REFERENCE_STYLE_NOTE} ${USER_MARKS_NOTE}`
        }
      ]
    : folded;
  const slots = input.continuityImage
    ? [
        ...entitySlots,
        crossShotSlot(
          input.continuityImage.description,
          "image",
          input.continuityImage.continuation ?? null
        )
      ]
    : entitySlots;
  const baseImageIds = [
    ...input.imageAssetIds,
    ...(board ? [String(board.asset_id)] : [])
  ];
  const imageIds = input.continuityImage
    ? [...baseImageIds, input.continuityImage.id]
    : baseImageIds;
  const references: JsonRecord[] = slots
    .slice(0, imageIds.length)
    .map((slot, index) => ({
      type: "reference_frame",
      asset_id: imageIds[index],
      ref_id: slot.ref_id,
      ...(slot.ref_id === "storyboard-sheet" ? { panel_count: count } : {}),
      ...(slot.members.length ? { members: slot.members } : {}),
      ...(slot.source ? { source: slot.source } : {}),
      ...(slot.description ? { description: slot.description } : {}),
      ...(slot.continuation ? { continuation: slot.continuation } : {})
    }));
  if (input.continuityVideo)
    references.push({
      type: "reference_video",
      asset_id: input.continuityVideo.id,
      ref_id: CROSS_SHOT_VIDEO_REF_ID,
      ...(input.continuityVideo.description
        ? { description: input.continuityVideo.description }
        : {})
    });

  const shot: JsonRecord = {
    ...(payload.shot as JsonRecord),
    duration_s: input.durationSeconds
  };
  const aspectRatio = aspectRatioLabel(input.outputSize);
  if (aspectRatio) shot.aspect_ratio = aspectRatio;
  if (input.visualStyle) shot.style = input.visualStyle;
  const camera = cameraText(input.shot.camera);
  if (camera) shot.camera = camera;
  return { ...payload, shot, references };
};
