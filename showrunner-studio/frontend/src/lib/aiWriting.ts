// aiWriting.ts — build AI requests from project data and turn replies back into project data.
// Pure functions, so the rules (what is sent, what may be overwritten) are tested without a server.
import type { CharacterEntity, SceneEntity, SetEntity, ShotEntity, ShowMeta } from "../types";
import { plainHeading } from "./fountain";
import type { ShotDraft } from "./writingActions";
import { sortShots } from "./shotlist";

const clip = (text: string | undefined, limit: number): string => (text ?? "").trim().slice(0, limit);

export function showInfo(show: ShowMeta) {
  return { title: clip(show.title, 200), genre: clip(show.genre, 120), premise: clip(show.premise, 6000), logline: clip(show.logline, 600), visual_style: clip(show.visualStyle, 1500) };
}

export const characterInfos = (characters: CharacterEntity[]) =>
  characters.slice(0, 40).map((c) => ({ name: clip(c.name, 80), visual: clip(c.visualDescription, 1500), wardrobe: clip(c.wardrobe, 600), features: clip(c.distinctiveFeatures, 600), voice: clip(c.voiceDescription, 600) }));

export const setInfos = (sets: SetEntity[]) => sets.slice(0, 40).map((s) => ({ name: clip(s.name, 80), description: clip(s.description, 1500), look: clip(s.lookNotes, 600) }));

export function sceneInfo(scene: SceneEntity, set: SetEntity | undefined, characters: CharacterEntity[], actionLimit = 12000) {
  return {
    name: clip(scene.sceneName, 200),
    heading: clip(plainHeading(scene, set), 200),
    action: clip(scene.action, actionLimit),
    dialogue: scene.dialogue
      .filter((d) => d.text.trim())
      .slice(0, 200)
      .map((d) => ({ speaker: clip(characters.find((c) => c.id === d.characterId)?.name ?? "Unknown", 80), parenthetical: clip(d.parenthetical, 200), text: clip(d.text, 2000) })),
    set_name: clip(set?.name, 80),
  };
}

/** Characters the model may name: the scene's cast, plus anyone who speaks in it. */
export function sceneCast(scene: SceneEntity, characters: CharacterEntity[]): CharacterEntity[] {
  const ids = new Set([...scene.activeCharacterIds, ...scene.dialogue.map((d) => d.characterId)]);
  return characters.filter((c) => ids.has(c.id));
}

export function shotListRequest(show: ShowMeta, scene: SceneEntity, set: SetEntity | undefined, characters: CharacterEntity[], targetSeconds?: number) {
  const cast = sceneCast(scene, characters);
  return { show: showInfo(show), scene: sceneInfo(scene, set, characters), characters: characterInfos(cast), sets: set ? setInfos([set]) : [], ...(targetSeconds ? { target_seconds: targetSeconds } : {}) };
}

export interface AiShot {
  duration_seconds: number;
  framing: string;
  movement: string;
  description: string;
  dialogue: string;
  cast: string[];
  storyboard_prompt: string;
  video_prompt: string;
}

/** Turns the model's shots into shot drafts, mapping cast names back to character ids. */
export function shotDraftsFromAi(shots: AiShot[], characters: CharacterEntity[]): ShotDraft[] {
  return shots.map((s) => ({
    durationSeconds: s.duration_seconds,
    framing: s.framing,
    movement: s.movement,
    description: s.description,
    dialogue: s.dialogue,
    castIds: s.cast.map((name) => characters.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id).filter((id): id is string => !!id),
    storyboardPrompt: s.storyboard_prompt,
    videoPrompt: s.video_prompt,
  }));
}

export function shotPromptsRequest(show: ShowMeta, scene: SceneEntity, set: SetEntity | undefined, characters: CharacterEntity[], shots: ShotEntity[]) {
  const cast = sceneCast(scene, characters);
  const nameOf = (ids: string[]) => ids.map((id) => characters.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
  return {
    show: showInfo(show), scene: sceneInfo(scene, set, characters), characters: characterInfos(cast), sets: set ? setInfos([set]) : [],
    shots: sortShots(shots).slice(0, 30).map((shot, index) => ({
      number: index + 1, duration_seconds: shot.durationSeconds > 0 ? Math.min(shot.durationSeconds, 60) : 3, framing: clip(shot.framing, 120), movement: clip(shot.movement, 120),
      description: clip(shot.description, 2000), dialogue: clip(shot.dialogue, 2000), cast: nameOf(shot.castIds).slice(0, 12), storyboard_prompt: clip(shot.storyboardPrompt, 2000), video_prompt: clip(shot.videoPrompt, 3000),
    })),
  };
}

export interface AiPrompt { number: number; storyboard_prompt: string; video_prompt: string }

/** Patches that fill ONLY empty prompt fields. The writer's own words are never overwritten. */
export function promptPatches(shots: ShotEntity[], prompts: AiPrompt[]): { id: string; patch: ShotDraft }[] {
  const ordered = sortShots(shots);
  const patches: { id: string; patch: ShotDraft }[] = [];
  for (const prompt of prompts) {
    const shot = ordered[prompt.number - 1];
    if (!shot) continue;
    const patch: ShotDraft = {};
    if (!shot.storyboardPrompt.trim() && prompt.storyboard_prompt) patch.storyboardPrompt = prompt.storyboard_prompt;
    if (!shot.videoPrompt.trim() && prompt.video_prompt) patch.videoPrompt = prompt.video_prompt;
    if (Object.keys(patch).length) patches.push({ id: shot.id, patch });
  }
  return patches;
}

export const hasMissingPrompts = (shots: ShotEntity[]): boolean => shots.some((s) => !s.storyboardPrompt.trim() || !s.videoPrompt.trim());

export function continuityRequest(show: ShowMeta, scenes: SceneEntity[], sets: SetEntity[], characters: CharacterEntity[]) {
  const written = scenes.filter((s) => s.action.trim() || s.dialogue.some((d) => d.text.trim())).slice(0, 40);
  return {
    show: showInfo(show), characters: characterInfos(characters), sets: setInfos(sets),
    scenes: written.map((scene) => sceneInfo(scene, sets.find((s) => s.id === scene.targetSetId), characters, 3000)),
  };
}

export interface ContinuityNote { severity: "error" | "warn" | "info"; scene: string; message: string }
