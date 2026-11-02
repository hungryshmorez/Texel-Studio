// consistency.ts — deterministic checks of the writing against the show bible.
// No AI: these run instantly, offline, and say exactly where the problem is.
import type { CharacterEntity, EpisodeEntity, SceneEntity, SetEntity, ShotEntity, ShowMeta } from "../types";
import { totalDuration } from "./shotlist";

export type Severity = "error" | "warn" | "info";

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  sceneId?: string;
  episodeId?: string;
  characterId?: string;
  setId?: string;
}

export interface CheckInput {
  show: ShowMeta;
  episodes: EpisodeEntity[];
  scenes: SceneEntity[];
  sets: SetEntity[];
  characters: CharacterEntity[];
  shots: ShotEntity[];
}

/** Spoken words per second used for the pacing check. About 150 words a minute. */
export const WORDS_PER_SECOND = 2.5;

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** Finds @Name / #Set tags in text that match no known name. Names may contain spaces. */
export function unknownTags(text: string, trigger: "@" | "#", names: string[]): string[] {
  const known = [...names].map((n) => n.toLowerCase()).sort((a, b) => b.length - a.length);
  const found: string[] = [];
  const pattern = new RegExp(`${trigger === "@" ? "@" : "#"}([\\p{L}\\p{N}_][\\p{L}\\p{N}_' -]*)`, "gu");
  const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);
  for (const match of text.matchAll(pattern)) {
    const rest = match[1].toLowerCase();
    // A tag matches a known name only when the name ends at a word boundary: "@Annabel" is not "@Ann".
    const matched = known.some((name) => rest.startsWith(name) && !isWordChar(rest[name.length]));
    if (!matched) {
      const token = match[1].split(/[ ,.;:!?]/)[0];
      if (!found.includes(token)) found.push(token);
    }
  }
  return found;
}

const ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export function checkProject(input: CheckInput): Issue[] {
  const { show, episodes, scenes, sets, characters, shots } = input;
  const issues: Issue[] = [];
  const add = (issue: Issue) => issues.push(issue);
  const characterName = (id: string) => characters.find((c) => c.id === id)?.name ?? "Unknown character";
  const episodeTitle = (id: string) => episodes.find((e) => e.id === id)?.title ?? "Episode";

  if (!show.visualStyle?.trim()) add({ severity: "info", code: "show-no-style", message: "The show has no visual style yet. Mago keeps scenes consistent from it." });

  for (const character of characters) {
    if (!character.visualDescription.trim()) add({ severity: "warn", code: "character-no-look", characterId: character.id, message: `${character.name} has no visual description, so the video tool must invent a face.` });
    else if (!character.referenceImageIds?.length) add({ severity: "info", code: "character-no-image", characterId: character.id, message: `${character.name} has no reference image.` });
  }
  for (const set of sets) {
    if (!set.description.trim()) add({ severity: "warn", code: "set-no-description", setId: set.id, message: `${set.name} has no description.` });
  }

  const sceneIds = new Set(scenes.map((s) => s.id));
  for (const scene of scenes) {
    const where = `${episodeTitle(scene.episodeId)} · ${scene.sceneName}`;
    const base = { sceneId: scene.id, episodeId: scene.episodeId };
    if (!scene.targetSetId) add({ ...base, severity: "warn", code: "scene-no-set", message: `${where}: no set chosen, so the heading has no location.` });
    else if (!sets.some((s) => s.id === scene.targetSetId)) add({ ...base, severity: "error", code: "scene-missing-set", message: `${where}: its set no longer exists.` });
    if (scene.status !== "idea" && !scene.action.trim() && scene.dialogue.length === 0) add({ ...base, severity: "info", code: "scene-empty", message: `${where}: nothing written yet.` });

    const cast = new Set(scene.activeCharacterIds);
    for (const id of scene.activeCharacterIds) {
      if (!characters.some((c) => c.id === id)) add({ ...base, severity: "error", code: "scene-missing-character", characterId: id, message: `${where}: a character in the cast no longer exists.` });
    }
    const speakers = new Set<string>();
    for (const line of scene.dialogue) {
      if (!characters.some((c) => c.id === line.characterId)) {
        add({ ...base, severity: "error", code: "dialogue-missing-character", message: `${where}: a line is spoken by a deleted character.` });
      } else if (!cast.has(line.characterId) && !speakers.has(line.characterId)) {
        speakers.add(line.characterId);
        add({ ...base, severity: "warn", code: "speaker-not-in-cast", characterId: line.characterId, message: `${where}: ${characterName(line.characterId)} speaks but is not in the scene's cast.` });
      }
    }

    const text = [scene.action, scene.sceneNotes, ...scene.dialogue.map((d) => d.text)].join("\n");
    for (const tag of unknownTags(text, "@", characters.map((c) => c.name))) add({ ...base, severity: "warn", code: "unknown-character-tag", message: `${where}: @${tag} matches no character.` });
    for (const tag of unknownTags(text, "#", sets.map((s) => s.name))) add({ ...base, severity: "warn", code: "unknown-set-tag", message: `${where}: #${tag} matches no set.` });

    const sceneShots = shots.filter((s) => s.sceneId === scene.id);
    if (scene.action.trim() && sceneShots.length === 0 && scene.status !== "idea") add({ ...base, severity: "info", code: "scene-no-shots", message: `${where}: no shot list yet.` });
    for (const shot of sceneShots) {
      const label = `${where} · shot ${shot.order}`;
      if (!shot.description.trim()) add({ ...base, severity: "warn", code: "shot-no-description", message: `${label}: no description.` });
      if (!(shot.durationSeconds > 0)) add({ ...base, severity: "error", code: "shot-bad-duration", message: `${label}: duration must be above zero.` });
      for (const id of shot.castIds) {
        if (!cast.has(id)) add({ ...base, severity: "warn", code: "shot-cast-not-in-scene", characterId: id, message: `${label}: ${characterName(id)} is in the shot but not in the scene's cast.` });
      }
      const spoken = words(shot.dialogue);
      if (spoken > 0 && shot.durationSeconds > 0 && spoken / shot.durationSeconds > WORDS_PER_SECOND * 1.4) {
        add({ ...base, severity: "warn", code: "shot-too-fast", message: `${label}: ${spoken} words in ${shot.durationSeconds}s is too fast to speak naturally.` });
      }
    }
    const dialogueWords = scene.dialogue.reduce((sum, d) => sum + words(d.text), 0);
    const planned = totalDuration(sceneShots);
    if (sceneShots.length > 0 && dialogueWords / WORDS_PER_SECOND > planned * 1.3 + 2) {
      add({ ...base, severity: "warn", code: "scene-dialogue-longer-than-shots", message: `${where}: the dialogue needs about ${Math.ceil(dialogueWords / WORDS_PER_SECOND)}s but the shots total ${planned}s.` });
    }
  }
  for (const shot of shots) {
    if (!sceneIds.has(shot.sceneId)) add({ severity: "error", code: "orphan-shot", sceneId: shot.sceneId, message: "A shot belongs to a scene that no longer exists." });
  }
  return issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export const countBySeverity = (issues: Issue[]): Record<Severity, number> => ({
  error: issues.filter((i) => i.severity === "error").length,
  warn: issues.filter((i) => i.severity === "warn").length,
  info: issues.filter((i) => i.severity === "info").length,
});
