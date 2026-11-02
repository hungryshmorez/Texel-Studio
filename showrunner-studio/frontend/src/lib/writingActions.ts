// writingActions.ts — CRUD for beats, revisions, shots and reference images.
import { db, uid } from "./db";
import { beatTemplateById } from "./beatTemplates";
import type { BeatEntity, ImageAsset, RevisionEntity, SceneEntity, SceneSnapshot, ShotEntity } from "../types";

const now = () => Date.now();

// --- Beats -------------------------------------------------------------------

export async function createBeat(episodeId: string, label = "Beat", text = ""): Promise<string> {
  const existing = await db.beats.where("episodeId").equals(episodeId).toArray();
  const order = existing.length ? Math.max(...existing.map((b) => b.order)) + 1 : 1;
  const id = uid("beat");
  const ts = now();
  await db.beats.put({ id, episodeId, order, label, text, sceneId: null, createdAt: ts, updatedAt: ts });
  return id;
}

export async function updateBeat(id: string, patch: Partial<Pick<BeatEntity, "label" | "text" | "sceneId">>) {
  await db.beats.update(id, { ...patch, updatedAt: now() });
}

export async function deleteBeat(id: string) {
  await db.beats.delete(id);
}

/** Swaps a beat with its neighbour. Returns false at the ends of the board. */
export async function moveBeat(id: string, direction: -1 | 1): Promise<boolean> {
  return db.transaction("rw", db.beats, async () => {
    const beat = await db.beats.get(id);
    if (!beat) return false;
    const sorted = (await db.beats.where("episodeId").equals(beat.episodeId).toArray()).sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((b) => b.id === id);
    const other = sorted[index + direction];
    if (!other) return false;
    await db.beats.update(beat.id, { order: other.order, updatedAt: now() });
    await db.beats.update(other.id, { order: beat.order, updatedAt: now() });
    return true;
  });
}

/** Appends a template's beats to the episode's board. */
export async function applyBeatTemplate(episodeId: string, templateId: string): Promise<number> {
  const template = beatTemplateById(templateId);
  if (!template) throw new Error(`Unknown beat template: ${templateId}`);
  for (const beat of template.beats) await createBeat(episodeId, beat.label, "");
  return template.beats.length;
}

// --- Revisions ---------------------------------------------------------------

export const snapshotScene = (scene: SceneEntity): SceneSnapshot => ({
  sceneName: scene.sceneName,
  action: scene.action,
  dialogue: scene.dialogue.map((line) => ({ ...line })),
  sceneNotes: scene.sceneNotes,
  targetSetId: scene.targetSetId,
  activeCharacterIds: [...scene.activeCharacterIds],
  status: scene.status,
  intExt: scene.intExt,
  timeOfDayTag: scene.timeOfDayTag,
  summary: scene.summary,
});

export async function saveRevision(sceneId: string, label = "", auto = false): Promise<string> {
  const scene = await db.scenes.get(sceneId);
  if (!scene) throw new Error("Scene not found.");
  const id = uid("rev");
  await db.revisions.put({ id, sceneId, label: label.trim(), auto, createdAt: now(), snapshot: snapshotScene(scene) });
  return id;
}

/** Restores a revision. The current text is kept first as an automatic revision, so a restore can be undone. */
export async function restoreRevision(revisionId: string): Promise<void> {
  await db.transaction("rw", db.scenes, db.revisions, async () => {
    const revision = await db.revisions.get(revisionId);
    if (!revision) throw new Error("Revision not found.");
    const scene = await db.scenes.get(revision.sceneId);
    if (!scene) throw new Error("Scene not found.");
    await db.revisions.put({ id: uid("rev"), sceneId: scene.id, label: "Before restore", auto: true, createdAt: now(), snapshot: snapshotScene(scene) });
    await db.scenes.update(scene.id, { ...revision.snapshot, updatedAt: now() });
  });
}

export async function deleteRevision(id: string) {
  await db.revisions.delete(id);
}

export async function listRevisions(sceneId: string): Promise<RevisionEntity[]> {
  return (await db.revisions.where("sceneId").equals(sceneId).toArray()).sort((a, b) => b.createdAt - a.createdAt);
}

// --- Shots -------------------------------------------------------------------

export type ShotDraft = Partial<Omit<ShotEntity, "id" | "sceneId" | "order" | "createdAt" | "updatedAt">>;

const shotFromDraft = (sceneId: string, order: number, draft: ShotDraft): ShotEntity => {
  const ts = now();
  return {
    id: uid("shot"),
    sceneId,
    order,
    durationSeconds: 3,
    framing: "",
    movement: "",
    description: "",
    dialogue: "",
    castIds: [],
    storyboardPrompt: "",
    videoPrompt: "",
    notes: "",
    ...draft,
    createdAt: ts,
    updatedAt: ts,
  };
};

export async function createShot(sceneId: string, draft: ShotDraft = {}): Promise<string> {
  const existing = await db.shots.where("sceneId").equals(sceneId).toArray();
  const order = existing.length ? Math.max(...existing.map((s) => s.order)) + 1 : 1;
  const shot = shotFromDraft(sceneId, order, draft);
  await db.shots.put(shot);
  return shot.id;
}

export async function updateShot(id: string, patch: ShotDraft) {
  await db.shots.update(id, { ...patch, updatedAt: now() });
}

export async function deleteShot(id: string) {
  await db.transaction("rw", db.shots, async () => {
    const shot = await db.shots.get(id);
    if (!shot) return;
    await db.shots.delete(id);
    // Close the gap so shot numbers stay 1..n.
    const rest = (await db.shots.where("sceneId").equals(shot.sceneId).toArray()).sort((a, b) => a.order - b.order);
    for (const [index, item] of rest.entries()) if (item.order !== index + 1) await db.shots.update(item.id, { order: index + 1 });
  });
}

export async function moveShot(id: string, direction: -1 | 1): Promise<boolean> {
  return db.transaction("rw", db.shots, async () => {
    const shot = await db.shots.get(id);
    if (!shot) return false;
    const sorted = (await db.shots.where("sceneId").equals(shot.sceneId).toArray()).sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((s) => s.id === id);
    const other = sorted[index + direction];
    if (!other) return false;
    await db.shots.update(shot.id, { order: other.order, updatedAt: now() });
    await db.shots.update(other.id, { order: shot.order, updatedAt: now() });
    return true;
  });
}

/** Replaces all of a scene's shots at once (used when the AI writes a fresh shot list). */
export async function replaceShots(sceneId: string, drafts: ShotDraft[]): Promise<string[]> {
  return db.transaction("rw", db.shots, async () => {
    await db.shots.where("sceneId").equals(sceneId).delete();
    const ids: string[] = [];
    for (const [index, draft] of drafts.entries()) {
      const shot = shotFromDraft(sceneId, index + 1, draft);
      await db.shots.put(shot);
      ids.push(shot.id);
    }
    return ids;
  });
}

export async function listShots(sceneId: string): Promise<ShotEntity[]> {
  return (await db.shots.where("sceneId").equals(sceneId).toArray()).sort((a, b) => a.order - b.order);
}

// --- Reference images --------------------------------------------------------

export const MAX_IMAGE_DATA_URL = 3_000_000; // characters; roughly a 2 MB image after base64

export async function addImage(showId: string, name: string, mime: string, dataUrl: string): Promise<string> {
  if (!mime.startsWith("image/")) throw new Error("Only image files can be added as references.");
  if (!dataUrl.startsWith("data:image/")) throw new Error("The image data is not a valid data URL.");
  if (dataUrl.length > MAX_IMAGE_DATA_URL) throw new Error("That image is too large. Use one under about 2 MB.");
  const id = uid("img");
  const image: ImageAsset = { id, showId, name: name.slice(0, 120) || "reference", mime, dataUrl, createdAt: now() };
  await db.images.put(image);
  return id;
}

/** Removes an image and every reference to it. */
export async function deleteImage(id: string) {
  await db.transaction("rw", db.images, db.characters, db.sets, async () => {
    await db.characters.filter((c) => !!c.referenceImageIds?.includes(id)).modify((c) => {
      c.referenceImageIds = c.referenceImageIds?.filter((x) => x !== id);
    });
    await db.sets.filter((s) => !!s.referenceImageIds?.includes(id)).modify((s) => {
      s.referenceImageIds = s.referenceImageIds?.filter((x) => x !== id);
    });
    await db.images.delete(id);
  });
}
