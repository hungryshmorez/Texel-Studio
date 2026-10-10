import type { CharacterEntity, SceneEntity, SetEntity, ShowMeta } from "../types";

export interface TexelShotPlan {
  id: string;
  scene_id: string;
  title: string;
  prompt: string;
  duration_seconds: number;
  motion_prompt?: string;
}

export interface TexelShot extends TexelShotPlan {
  status: "planned" | "generating" | "ready" | "approved" | "error" | "interrupted";
  image_url: string | null;
  clip_url: string | null;
  video_status?: "planned" | "generating" | "ready" | "error" | "interrupted";
  video_error?: string | null;
  video_progress?: number;
  video_job?: { job_id: string; model_type: string } | null;
  error: string | null;
}

export interface TexelAsset {
  id: string;
  name: string;
  kind: "video" | "audio";
  duration: number;
  has_audio: boolean;
  width: number;
  height: number;
  size: number;
}

export interface TexelTrailer {
  id: string;
  show_id: string;
  show_title: string;
  status: "draft" | "rendering" | "complete" | "error";
  shots: TexelShot[];
  assets?: TexelAsset[];
  mode?: "edit";
  video_url: string | null;
  animated?: boolean;
  cloud_render?: { client_id: string; job_id: string | null; status: "running" | "interrupted" | "error" | "complete"; progress: number; error: string | null } | null;
  audio_name: string | null;
  error: string | null;
}

export interface TexelCapabilities {
  configured: boolean;
  cloud_configured: boolean;
  image_model: string;
  video_model: string;
  video_generation: boolean;
  generation_source: string;
  cloud_render_available: boolean;
  ffmpeg_available: boolean;
  audio_available: boolean;
  storage_configured?: boolean;
  max_edit_clips?: number;
}

/** A representative still from each chosen scene, with registered cast/set
 * descriptions expanded. Tags themselves aren't a visual-reference mechanism.
 * Deliberately independent of the older 15-second extension exporters.
 */
export function compileTexelShots(show: ShowMeta, scenes: SceneEntity[], sets: SetEntity[], characters: CharacterEntity[]): TexelShotPlan[] {
  if (!scenes.length || scenes.length > 3) throw new Error("Choose one to three scenes.");
  return scenes.map((scene) => {
    const cast = characters.filter((character) => scene.activeCharacterIds.includes(character.id));
    if (cast.length > 3) throw new Error(`“${scene.sceneName}” has more than three characters. Split its cast into a smaller scene before creating the trailer.`);
    const set = sets.find((location) => location.id === scene.targetSetId);
    const action = scene.action.trim().split(/\n\s*\n/)[0];
    if (!action) throw new Error(`Add action to “${scene.sceneName}” before creating its keyframe.`);
    const prompt = [
      "Create one cinematic 16:9 storyboard keyframe. Depict a single instant from the opening action beat. Clear staging, readable silhouettes, coherent lighting. Do not draw typography, captions, a collage, or multiple panels.",
      `Show: ${show.title.slice(0, 160)}. Genre: ${show.genre.slice(0, 100)}.`,
      `Visual world and tone: ${show.premise.slice(0, 1000) || "Cinematic natural lighting."}`,
      set ? `Location: ${set.name}. ${set.timeOfDay}. ${set.description.slice(0, 1000)}` : "Location: use the setting described in the action.",
      cast.length ? `Registered cast:\n${cast.map((c) => `${c.name}: ${c.visualDescription.slice(0, 800) || `${c.age} ${c.gender}, ${c.role}`}`).join("\n")}` : "No named cast is selected; show only the subjects specified by the action.",
      `Opening action beat: ${action.slice(0, 1800)}`,
      scene.sceneNotes ? `Director notes: ${scene.sceneNotes.slice(0, 300)}` : "",
    ].filter(Boolean).join("\n\n");
    return { id: crypto.randomUUID(), scene_id: scene.id, title: scene.sceneName.slice(0, 160) || "Untitled scene", prompt, duration_seconds: 6, motion_prompt: `Animate the approved keyframe as one continuous cinematic shot. Preserve the cast, setting, and visual style. Natural movement, no cuts or text.\n\nAction: ${scene.action.slice(0, 3500)}${scene.sceneNotes ? `\n\nDirector notes: ${scene.sceneNotes.slice(0, 1000)}` : ""}` };
  });
}

export async function texelRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/texel${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : `Studio request failed (${response.status}).`;
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export function jsonRequest(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
