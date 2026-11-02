// shotlist.ts — shot-table helpers. Mirrors the shape of Mago Studio's shot table: each row
// has a duration, camera movement, framing, description and dialogue, and is saved in the
// video prompt as "[Shot n] (start-end s) ..." lines.
import type { ShotEntity } from "../types";

export const sortShots = (shots: ShotEntity[]): ShotEntity[] => [...shots].sort((a, b) => a.order - b.order);

const trimNumber = (value: number): string => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));

export const totalDuration = (shots: ShotEntity[]): number => shots.reduce((sum, shot) => sum + (Number.isFinite(shot.durationSeconds) ? shot.durationSeconds : 0), 0);

/** Start and end second of each shot, in order. */
export function shotTimings(shots: ShotEntity[]): { shot: ShotEntity; start: number; end: number }[] {
  let cursor = 0;
  return sortShots(shots).map((shot) => {
    const start = cursor;
    cursor += Math.max(0, shot.durationSeconds);
    return { shot, start, end: cursor };
  });
}

/** One "[Shot n] (0-3 s) Framing, movement: description. "Dialogue"" line per row. */
export function formatShotLines(shots: ShotEntity[], castNames: (ids: string[]) => string[] = () => []): string[] {
  return shotTimings(shots).map(({ shot, start, end }, index) => {
    const camera = [shot.framing.trim(), shot.movement.trim()].filter(Boolean).join(", ");
    const cast = castNames(shot.castIds);
    const parts = [
      camera ? `${camera}:` : "",
      shot.description.trim(),
      cast.length ? `Cast: ${cast.join(", ")}.` : "",
      shot.dialogue.trim() ? `Dialogue: ${shot.dialogue.trim()}` : "",
    ].filter(Boolean);
    return `[Shot ${index + 1}] (${trimNumber(start)}-${trimNumber(end)} s) ${parts.join(" ")}`.trimEnd();
  });
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const SHOT_CSV_HEADER = ["shot", "start_s", "end_s", "duration_s", "framing", "movement", "description", "dialogue", "cast", "storyboard_prompt", "video_prompt", "notes"];

export function shotsToCsv(shots: ShotEntity[], castNames: (ids: string[]) => string[] = () => []): string {
  const rows = shotTimings(shots).map(({ shot, start, end }, index) => [
    index + 1, trimNumber(start), trimNumber(end), trimNumber(shot.durationSeconds), shot.framing, shot.movement, shot.description,
    shot.dialogue, castNames(shot.castIds).join("; "), shot.storyboardPrompt, shot.videoPrompt, shot.notes,
  ]);
  return [SHOT_CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export const FRAMING_OPTIONS = ["Extreme wide", "Wide", "Full", "Medium", "Medium close-up", "Close-up", "Extreme close-up", "Over the shoulder", "Insert", "POV"];
export const MOVEMENT_OPTIONS = ["Static", "Slow push-in", "Pull-out", "Pan", "Tilt", "Tracking", "Handheld", "Crane / drone", "Whip pan", "Orbit"];
