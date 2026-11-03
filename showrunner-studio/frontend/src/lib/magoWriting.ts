// magoWriting.ts — Showwriter's use of the ported Mago Studio writing pipelines (src/mago).
//
// Mago's code reads a screenplay into a cast, breaks scenes into shots, composes the video
// prompt and builds the storyboard prompt. Here the same code runs over Showwriter's scenes.
// Everything is pure except `geminiRun`, so tests drive it with canned model replies.
import type { CharacterEntity, SceneEntity, SetEntity, ShotEntity, ShowMeta } from "../types";
import { createQwenStructuredCall } from "../mago/casting/qwenStructuredCall";
import { slugifyName } from "../mago/casting/castingTokens";
import { generateCasting } from "../mago/casting/scriptCasting";
import { buildStoryboardPrompt } from "../mago/storyboards/buildStoryboardPrompt";
import { createQwenVideoPromptCall } from "../mago/videoPrompt/qwenVideoPromptCall";
import { generateVideoPrompt } from "../mago/videoPrompt/videoPrompt";
import { shotVideoPromptPayload } from "../mago/videoPrompt/videoPromptPayload";
import { runAiJob } from "./aiJobs";
import { screenplayText } from "./magoExport";
import { FRAMING_OPTIONS, MOVEMENT_OPTIONS, shotTimings, sortShots, totalDuration } from "./shotlist";
import type { ShotDraft } from "./writingActions";

type JsonRecord = Record<string, unknown>;

/** One model call: a prompt in, the model's raw JSON text out. */
export type Run = (prompt: string) => Promise<string>;

/** Sends a prompt to the studio server, which asks Gemini for a JSON object. */
export const geminiRun = (signal?: AbortSignal): Run => (prompt) => runAiJob<string>("/api/mago/complete/start", { prompt }, { signal, timeoutMs: 600_000 });

/** Mago composes for one 16:9 frame; Showwriter has no aspect setting yet. */
const OUTPUT_SIZE = [1920, 1080];
/** The longest clip Mago renders in one go. */
export const MAX_CLIP_SECONDS = 15;

const asRecords = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.filter((v): v is JsonRecord => !!v && typeof v === "object" && !Array.isArray(v)) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const sentence = (value: string): string => { const t = value.trim(); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };

/** The scenes as plain screenplay text, the form Mago reads. */
export function scriptText(scenes: SceneEntity[], sets: SetEntity[], characters: CharacterEntity[]): string {
  const withWriting = scenes.filter((s) => s.action.trim() || s.dialogue.some((d) => d.text.trim()));
  return withWriting.map((s) => screenplayText(s, sets.find((x) => x.id === s.targetSetId), characters)).join("\n\n");
}

// --- Cast from script -------------------------------------------------------

export interface CastCharacter { name: string; visualDescription: string; distinctiveFeatures: string; voiceDescription: string; exists: boolean }
export interface CastSet { name: string; description: string; exists: boolean }
export interface CastProposal { title: string; visualStyle: string; characters: CastCharacter[]; sets: CastSet[]; props: string[] }

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Turns Mago's casting into proposals, marking what the show already has. */
export function proposalFromCasting(casting: JsonRecord, characters: CharacterEntity[], sets: SetEntity[]): CastProposal {
  return {
    title: text(casting.title),
    visualStyle: text(casting.visual_style),
    characters: asRecords(casting.characters).filter((c) => text(c.name).trim()).map((c) => ({
      name: text(c.name).trim(),
      visualDescription: sentence(text(c.description)),
      distinctiveFeatures: (Array.isArray(c.distinctive_features) ? c.distinctive_features : []).map(String).filter(Boolean).join(", "),
      voiceDescription: sentence(text(c.voice_profile)),
      exists: characters.some((x) => sameName(x.name, text(c.name))),
    })),
    sets: asRecords(casting.environments).filter((e) => text(e.name).trim()).map((e) => ({
      name: text(e.name).trim(),
      description: sentence(text(e.description)),
      exists: sets.some((x) => sameName(x.name, text(e.name))),
    })),
    props: asRecords(casting.props).map((p) => text(p.name).trim()).filter(Boolean),
  };
}

/** Reads the script and proposes the cast, locations and props. Nothing is saved. */
export async function castFromScript(script: string, run: Run, characters: CharacterEntity[], sets: SetEntity[]): Promise<CastProposal> {
  if (!script.trim()) throw new Error("Write some action or dialogue first. There is nothing to read.");
  const casting = await generateCasting(script, createQwenStructuredCall(run), { includeDialogue: true });
  return proposalFromCasting(casting, characters, sets);
}

// --- Smarter shot breakdown -------------------------------------------------

const FRAMINGS = FRAMING_OPTIONS.map((f) => f.toLowerCase());
const MOVEMENTS = MOVEMENT_OPTIONS.map((m) => m.toLowerCase());
const canonical = (value: string, options: string[], labels: string[]): string => {
  const v = value.trim();
  if (!v) return "";
  const hit = options.indexOf(v.toLowerCase());
  return hit >= 0 ? labels[hit] : v;
};

const MIN_SHOT_SECONDS = 1;
const MAX_SHOT_SECONDS = 15;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Maps Mago's atomic shots onto Showwriter shot rows. Cast tokens are matched to characters by name. */
export function shotDraftsFromMago(shots: JsonRecord[], characters: CharacterEntity[]): ShotDraft[] {
  const byToken = new Map(characters.map((c) => [slugifyName(c.name), c.id]));
  return shots.map((shot) => {
    const camera = (shot.camera && typeof shot.camera === "object" ? shot.camera : {}) as JsonRecord;
    const short = Number(shot.duration_short_s);
    const long = Number(shot.duration_long_s);
    const seconds = Number.isFinite(short) && Number.isFinite(long) ? (short + long) / 2 : 3;
    const lens = text(camera.lens).trim();
    const dialogue = asRecords(shot.dialogue).filter((d) => text(d.line).trim()).map((d) => `${text(d.speaker).trim() || "UNKNOWN"}: ${text(d.line).trim()}`).join("\n");
    return {
      durationSeconds: Math.min(MAX_SHOT_SECONDS, Math.max(MIN_SHOT_SECONDS, round1(seconds))),
      framing: canonical(text(camera.framing), FRAMINGS, FRAMING_OPTIONS),
      movement: canonical(text(camera.movement), MOVEMENTS, MOVEMENT_OPTIONS),
      description: text(shot.video_prompt).trim() || text(shot.action).trim(),
      dialogue,
      castIds: (Array.isArray(shot.characters) ? shot.characters : []).map((t) => byToken.get(String(t))).filter((id): id is string => !!id),
      notes: [text(shot.beat_type) && `Beat: ${text(shot.beat_type).replace(/_/g, " ")}.`, lens && `Lens: ${lens}.`].filter(Boolean).join(" "),
    };
  });
}

/** Breaks one scene into cuts with Mago's atomic-shot pass in sequence mode (1.5-6 s shots, not 5 s render clips). */
export async function breakDownScene(scene: SceneEntity, set: SetEntity | undefined, characters: CharacterEntity[], run: Run): Promise<ShotDraft[]> {
  const script = screenplayText(scene, set, characters);
  if (!scene.action.trim() && !scene.dialogue.some((d) => d.text.trim())) throw new Error("Write some action or dialogue first. There is nothing to break into shots.");
  const casting = await generateCasting(script, createQwenStructuredCall(run), { atomicShots: true, includeDialogue: true, separateCamera: true, sequenceMode: true });
  const failure = casting.shots_error as JsonRecord | undefined;
  if (failure) throw new Error(`${text(failure.message) || "The shot breakdown failed."} ${text(failure.error)}`.trim());
  const drafts = shotDraftsFromMago(asRecords(casting.shots), characters);
  if (drafts.length === 0) throw new Error("The model returned no shots. Try again.");
  return drafts;
}

// --- Clips: storyboard prompt and video prompt ------------------------------

/** What Mago calls a "shot" is a clip of up to 15 s holding several cuts; here, one scene's shot list. */
export interface Clip { video_prompt: string; tags: { characters: string[]; environments: string[]; props: string[] }; dialogue: JsonRecord[] }
export interface Key { token: string; name: string; description: string }

const noFinalStop = (value: string): string => value.trim().replace(/\.$/, "");
const castLine = (c: CharacterEntity) => noFinalStop([sentence(c.visualDescription), c.wardrobe?.trim() ? `Wears ${sentence(c.wardrobe).toLowerCase()}` : "", c.distinctiveFeatures?.trim() ? `Distinctive: ${sentence(c.distinctiveFeatures)}` : ""].filter(Boolean).join(" "));

/** The cast of one scene's shots as Mago "keys" (token, name, description). Tokens are unique per name. */
export function clipKeys(characters: CharacterEntity[], set: SetEntity | undefined, castIds: string[]): { keys: Key[]; characterTokens: string[]; environmentTokens: string[] } {
  const keys: Key[] = [];
  const characterTokens: string[] = [];
  for (const c of characters.filter((x) => castIds.includes(x.id))) {
    const token = slugifyName(c.name);
    if (keys.some((k) => k.token === token)) continue;
    keys.push({ token, name: c.name, description: castLine(c) });
    characterTokens.push(token);
  }
  const environmentTokens: string[] = [];
  if (set) {
    const token = slugifyName(set.name);
    if (!keys.some((k) => k.token === token)) {
      keys.push({ token, name: set.name, description: noFinalStop([sentence(set.description), set.lookNotes?.trim() ? `Look: ${sentence(set.lookNotes)}` : ""].filter(Boolean).join(" ")) });
      environmentTokens.push(token);
    }
  }
  return { keys, characterTokens, environmentTokens };
}

const trimNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(round1(n)));

/** `[Shot n] (a-b s) Framing, movement: what the camera sees.` — the cut list, with the spoken words left out. */
export function clipVideoPrompt(shots: ShotEntity[]): string {
  return shotTimings(shots).map(({ shot, start, end }, index) => {
    const camera = [shot.framing.trim(), shot.movement.trim()].filter(Boolean).join(", ");
    return `[Shot ${index + 1}] (${trimNumber(start)}-${trimNumber(end)} s) ${[camera ? `${camera}:` : "", shot.description.trim()].filter(Boolean).join(" ")}`.trimEnd();
  }).join("\n");
}

/** Dialogue lines in speaking order, "NAME: words" per line, as the composer's turns. */
export function clipDialogue(shots: ShotEntity[], characters: CharacterEntity[]): JsonRecord[] {
  const turns: JsonRecord[] = [];
  for (const shot of sortShots(shots)) {
    for (const row of shot.dialogue.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
      const match = /^([^:"]{1,60}):\s*(.+)$/.exec(row);
      const speaker = match?.[1].trim() ?? null;
      const known = speaker ? characters.find((c) => sameName(c.name, speaker)) : undefined;
      turns.push({ line: (match ? match[2] : row).replace(/^["“]|["”]$/g, "").trim(), speaker: known?.name ?? speaker, speaker_token: known ? slugifyName(known.name) : null, language: null });
    }
  }
  return turns;
}

function clipFor(shots: ShotEntity[], characters: CharacterEntity[], set: SetEntity | undefined) {
  const ordered = sortShots(shots);
  const castIds = [...new Set(ordered.flatMap((s) => s.castIds))];
  const { keys, characterTokens, environmentTokens } = clipKeys(characters, set, castIds);
  const clip: Clip = { video_prompt: clipVideoPrompt(ordered), tags: { characters: characterTokens, environments: environmentTokens, props: [] }, dialogue: clipDialogue(ordered, characters) };
  return { clip, keys };
}

/** The storyboard-sheet prompt for a scene: one panel per shot. No model call. */
export function storyboardPromptFor(shots: ShotEntity[], characters: CharacterEntity[], set: SetEntity | undefined): string {
  if (shots.length === 0) throw new Error("Write the scene's shot list first. The storyboard has one panel per shot.");
  const { clip, keys } = clipFor(shots, characters, set);
  return buildStoryboardPrompt(clip as unknown as JsonRecord, keys as unknown as JsonRecord[], OUTPUT_SIZE);
}

export interface ComposedClip { prompt: string; warnings: string[]; fallback: boolean }

/** The video prompt Mago's composer writes for a scene's clip. Falls back to its own skeleton when the model fails. */
export async function composeClipVideoPrompt(show: ShowMeta | null, shots: ShotEntity[], characters: CharacterEntity[], set: SetEntity | undefined, run: Run): Promise<ComposedClip> {
  if (shots.length === 0) throw new Error("Write the scene's shot list first. The video prompt is composed from it.");
  const { clip, keys } = clipFor(shots, characters, set);
  const seconds = Math.min(MAX_CLIP_SECONDS, Math.max(1, Math.round(totalDuration(shots))));
  const base = shotVideoPromptPayload(clip as unknown as JsonRecord, keys as unknown as JsonRecord[]);
  const payload: JsonRecord = {
    ...base,
    shot: { ...(base.shot as JsonRecord), duration_s: seconds, aspect_ratio: "16:9", ...(show?.visualStyle?.trim() ? { style: show.visualStyle.trim() } : {}) },
    references: [],
  };
  const result = await generateVideoPrompt(payload, createQwenVideoPromptCall(run));
  return { prompt: result.prompt, warnings: result.warnings, fallback: result.fallback };
}
