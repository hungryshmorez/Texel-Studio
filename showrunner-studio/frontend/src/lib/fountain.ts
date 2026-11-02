// fountain.ts — screenplay export in the Fountain format (https://fountain.io).
import type { CharacterEntity, EpisodeEntity, SceneEntity, SetEntity, ShowMeta } from "../types";

const TIMES = /^(day|night|dawn|dusk|morning|evening|afternoon|noon|midnight|continuous|later)$/i;

/** "Interior"/"Exterior" style set labels map to INT/EXT. */
export function inferIntExt(set: SetEntity | undefined): "INT" | "EXT" | "INT/EXT" {
  const label = (set?.timeOfDay ?? "").toLowerCase();
  if (/int\/ext|interior.*exterior|exterior.*interior/.test(label)) return "INT/EXT";
  if (/exterior|\bext\b|outdoor/.test(label)) return "EXT";
  return "INT";
}

export function inferTimeOfDay(scene: SceneEntity, set: SetEntity | undefined): string {
  if (scene.timeOfDayTag?.trim()) return scene.timeOfDayTag.trim().toUpperCase();
  const label = (set?.timeOfDay ?? "").trim();
  if (TIMES.test(label)) return label.toUpperCase();
  const found = label.match(/day|night|dawn|dusk|morning|evening|afternoon/i);
  return found ? found[0].toUpperCase() : "DAY";
}

/** "INT. ROOFTOP - NIGHT". Scenes without a set fall back to the scene name as a forced heading. */
export function sceneHeading(scene: SceneEntity, set: SetEntity | undefined): string {
  if (!set) return `.${scene.sceneName.trim().toUpperCase() || "UNTITLED SCENE"}`;
  const intExt = scene.intExt ?? inferIntExt(set);
  return `${intExt}. ${set.name.trim().toUpperCase()} - ${inferTimeOfDay(scene, set)}`;
}

/** Plain heading text without the Fountain "force" dot, for tools that read screenplay headings. */
export const plainHeading = (scene: SceneEntity, set: SetEntity | undefined): string => sceneHeading(scene, set).replace(/^\./, "");

// A line that starts with one of these would be read as other Fountain syntax. "!" forces action.
const NEEDS_FORCE = /^[@!~=>#.]/;

function actionBlock(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => (NEEDS_FORCE.test(line) ? `!${line}` : line))
        .join("\n")
    );
}

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ").trim();

export function sceneToFountain(scene: SceneEntity, set: SetEntity | undefined, characters: CharacterEntity[]): string {
  const blocks: string[] = [sceneHeading(scene, set)];
  if (scene.sceneNotes.trim()) blocks.push(`[[${oneLine(scene.sceneNotes).replace(/\]\]/g, "] ]")}]]`);
  blocks.push(...actionBlock(scene.action));
  for (const line of scene.dialogue) {
    const name = characters.find((c) => c.id === line.characterId)?.name ?? "UNKNOWN";
    const cue = name.toUpperCase();
    const text = line.text.trim();
    if (!text) continue;
    const lines = [NEEDS_FORCE.test(cue) ? `@${cue}` : cue];
    if (line.parenthetical?.trim()) lines.push(`(${line.parenthetical.trim().replace(/^\(|\)$/g, "")})`);
    lines.push(...text.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0));
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

export function titlePage(show: ShowMeta, episode?: EpisodeEntity): string {
  const title = episode ? `${show.title}\n    ${episode.title}` : show.title;
  const lines = [`Title: ${title}`, "Credit: Written by"];
  if (show.logline?.trim()) lines.push(`Notes: ${oneLine(show.logline)}`);
  return lines.join("\n");
}

export interface FountainInput {
  show: ShowMeta;
  episode?: EpisodeEntity;
  scenes: SceneEntity[]; // already in script order
  sets: SetEntity[];
  characters: CharacterEntity[];
}

export function toFountain({ show, episode, scenes, sets, characters }: FountainInput): string {
  const body = [...scenes].sort((a, b) => a.order - b.order).map((scene) => sceneToFountain(scene, sets.find((s) => s.id === scene.targetSetId), characters));
  return [titlePage(show, episode), "====", ...body].join("\n\n") + "\n";
}
