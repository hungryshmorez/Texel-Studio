/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
/**
 * How a sequential shot continues from its predecessor: the backend's
 * reference descriptions, default appendix, prompt defaults and fingerprint
 *.
 */

type JsonRecord = Record<string, unknown>;

export const OPENING_FRAME_CUT = "cut";
export const OPENING_FRAME_PIN = "pin";
export const OPENING_FRAME_OFF = "off";
export const OPENING_FRAMES = [
  OPENING_FRAME_CUT,
  OPENING_FRAME_PIN,
  OPENING_FRAME_OFF
] as const;
export type OpeningFrame = (typeof OPENING_FRAMES)[number];

export const SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION =
  "A summary of the immediately preceding shot, provided for continuity. Keep the " +
  "characters, wardrobe, location, lighting and color grade consistent with it, and " +
  "continue the action naturally from where it leaves off — do not repeat the action " +
  "it already shows, and do not reuse its camera angle or framing.";
export const SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CUT =
  "The last frame of the preceding shot. This shot cuts to a new camera angle on that same " +
  "moment: the same characters in the same places and poses, already in the middle of what " +
  "they were doing. Only the camera changes. Nothing restarts: nobody enters, leaves, stands " +
  "up or sits down again unless the action below says so.";
export const SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_PIN =
  "The last frame of the preceding shot, and this video opens exactly on it: the same " +
  "characters in the same places and poses, already in the middle of what they were doing, " +
  "seen from the same camera. Nothing restarts: nobody enters, leaves, stands up or sits " +
  "down again unless the action below says so.";
export const SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CHUNK =
  "The end of the preceding shot, and this video continues straight on from its last " +
  "moment: the same characters in the same places, already in the middle of what they were " +
  "doing. Nothing restarts and nobody enters again; its action is not repeated.";

const DEFAULT_SEQUENTIAL_APPENDICES = new Set([
  SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION,
  SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CUT,
  SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_PIN,
  SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CHUNK
]);

export const isDefaultSequentialAppendix = (appendix: string): boolean =>
  DEFAULT_SEQUENTIAL_APPENDICES.has(appendix);

export const defaultSequentialAppendix = (
  mode: string,
  openingFrame?: string | null
): string => {
  if (mode === "last_chunk") return SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CHUNK;
  if (mode !== "last_frame") return SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION;
  if (openingFrame === OPENING_FRAME_PIN)
    return SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_PIN;
  if (openingFrame === OPENING_FRAME_OFF)
    return SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION;
  return SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CUT;
};

export const sequentialPromptDefaults = (): JsonRecord => ({
  last_frame: Object.fromEntries(
    OPENING_FRAMES.map((openingFrame) => [
      openingFrame,
      defaultSequentialAppendix("last_frame", openingFrame)
    ])
  ),
  key_frames: defaultSequentialAppendix("key_frames"),
  last_chunk: defaultSequentialAppendix("last_chunk")
});

export const sequentialFingerprint = (config: JsonRecord): JsonRecord =>
  config.prompt_appendix !==
  defaultSequentialAppendix(
    String(config.mode),
    typeof config.opening_frame === "string" ? config.opening_frame : null
  )
    ? config
    : { ...config, prompt_appendix: SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION };
