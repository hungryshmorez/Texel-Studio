/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
export const LINE_ART_STYLE =
  "Simple black line art on white paper, like a storyboard artist's blocking boards: plain outlines that show who and what is where, how big they are in the frame, which way each faces, and the camera angle. Draw every character as a simple outline of its body shape and pose, with a blank face: no eyes, mouth, fur, hair, clothes, patterns or accessories. Draw every object as a plain closed outline with nothing on or inside it: a map, letter, book, sign or screen is a blank shape, never its pictures, lines or writing. Backgrounds are a few outlines for the ground, the horizon and the largest shapes. No shading, no grey fills, no hatching, no textures, no colour: most of each panel stays white paper.";
export const KEEP_THE_GRID =
  "Draw each panel's content inside the panel with that number, and only inside it. Keep every border, circled number, panel size and position, and the white space between and around the panels exactly as they are in the input image. Draw nothing outside the panels, and never draw over a border or a number.";
export const NO_DRAWING_MEDIUM =
  "It is a flat digital page, not a photograph: never a hand, pen, marker, pencil, desk, table, paper edge or shadow.";
export const STORY_PROGRESSION =
  "Each panel is a different moment and a different camera set-up: the characters move through the place and the framing changes, so the panels read as a story, never the same picture repeated.";
export const MOVEMENT_ARROWS =
  "Add simple arrows for movement: a solid arrow for the direction a character or object moves, a dashed arrow for the camera move. When nothing moves, draw no arrows.";
export const CAST_HAS_ITS_OWN_REFERENCES =
  "Every character, place and prop named here has its own reference image elsewhere, so this storyboard must not describe how it looks: draw only its outline, size and position, never its markings, surface details, contents or writing.";
export const NO_OTHER_TEXT =
  "No other text, captions or speech bubbles anywhere.";
export const EMPTY_PANEL_DESCRIPTION =
  "the same moment continues while a line is spoken, framed as before";
export const REFERENCE_STYLE_NOTE =
  "Never show the drawing itself, its panels, borders, numbers, arrows, outlines or drawing style in the video. The storyboard only sets where things are, how big they are and how the camera sees them. How every character, prop and place looks comes from its own reference, never from the storyboard: a blank shape in a panel is that reference's subject, drawn in full detail from the reference.";
export const USER_MARKS_NOTE =
  "Arrows, circles and lines drawn over the panels by hand are the director's own notes on movement and placement: follow them, and never show them in the video.";
