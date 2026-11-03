/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
import {
  LINE_ART_STYLE,
  KEEP_THE_GRID,
  NO_DRAWING_MEDIUM,
  STORY_PROGRESSION,
  MOVEMENT_ARROWS,
  NO_OTHER_TEXT,
  CAST_HAS_ITS_OWN_REFERENCES,
  EMPTY_PANEL_DESCRIPTION
} from "./prompts";
import { sceneCast, sceneCuts } from "./storyboard";
import { templateLayout } from "./template";

type Row = Record<string, unknown>;
const MAX_CAST_DESCRIPTION = 90;
export const buildStoryboardPrompt = (
  shot: Row,
  keys: Row[],
  size: unknown[]
): string => {
  const { context, cuts } = sceneCuts(shot.video_prompt);
  const { columns, rows, aspect, orientation } = templateLayout(
    cuts.length,
    size
  );
  const shape = `${orientation} ${aspect}`;
  const empty = columns * rows - cuts.length;
  const arrangement =
    cuts.length === 1
      ? "centred on the sheet"
      : rows === 1
        ? "side by side in one row"
        : `in ${rows} rows of ${columns}, read left to right, then top to bottom${empty ? `, with the last ${empty === 1 ? "cell" : `${empty} cells`} of the bottom row left empty` : ""}`;
  const template = `The input image is a blank storyboard template: ${cuts.length === 1 ? `1 empty ${shape} panel` : `${cuts.length} empty ${shape} panels`} ${arrangement}, each with a thick black border and a circled number (1 to ${cuts.length}) just above its top-left corner. ${KEEP_THE_GRID} Compose every panel for a ${shape} frame, the shape of the final video: never make a panel wider, taller, or a different shape.`;
  const cast = sceneCast(shot, keys);
  const names = (kind: string) =>
    cast
      .filter((member) => member.kind === kind)
      .map((member) => {
        const firstSentence = String(member.description)
          .replace(/\s+/g, " ")
          .trim()
          .split(/(?<=[.!?])\s/)[0]!;
        const description =
          firstSentence.length > MAX_CAST_DESCRIPTION
            ? `${firstSentence.slice(0, MAX_CAST_DESCRIPTION).trimEnd()}…`
            : firstSentence;
        return description
          ? `${String(member.name)} (${description})`
          : String(member.name);
      });
  const join = (values: string[]) =>
    values.length < 2
      ? (values[0] ?? "")
      : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
  const characters = names("character"),
    places = names("environment"),
    props = names("prop");
  return [
    LINE_ART_STYLE,
    template,
    NO_DRAWING_MEDIUM,
    ...(cuts.length > 1 ? [STORY_PROGRESSION] : []),
    MOVEMENT_ARROWS,
    NO_OTHER_TEXT,
    ...(characters.length
      ? [
          `This scene has exactly ${characters.length} ${characters.length === 1 ? "character" : "characters"}: ${join(characters)}. Draw each one as what its description says: an animal stays that animal with its own body shape, never a person. "They", "their" and "both" mean ${characters.length === 1 ? "this character" : "these characters"}. Draw no other people or animals, and never more figures than a panel names.`
        ]
      : []),
    ...(places.length ? [`The place: ${join(places)}.`] : []),
    ...(props.length ? [`Props: ${join(props)}.`] : []),
    ...(cast.length ? [CAST_HAS_ITS_OWN_REFERENCES] : []),
    ...(context ? [`The scene: ${context}`] : []),
    ...cuts.map(
      (cut, i) =>
        `Panel ${i + 1}: ${cut.replace(/\.+$/, "") || EMPTY_PANEL_DESCRIPTION}.`
    )
  ].join("\n");
};
