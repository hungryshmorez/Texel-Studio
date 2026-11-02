// actions.ts — Thin CRUD wrappers over Dexie. All writes go through here so
// timestamps / ids / cascade rules stay consistent.
import { db, uid } from "./db";
import type {
  CharacterEntity,
  DialogueLine,
  EpisodeEntity,
  SceneEntity,
  SetEntity,
  ShowMeta,
} from "../types";

const now = () => Date.now();

// --- Shows -----------------------------------------------------------------

export async function createShow(title: string): Promise<string> {
  const id = uid("show");
  const ts = now();
  await db.shows.put({ id, title: title.trim() || "Untitled Show", genre: "", premise: "", createdAt: ts, updatedAt: ts });
  return id;
}

export async function updateShow(id: string, patch: Partial<Omit<ShowMeta, "id" | "createdAt">>) {
  await db.shows.update(id, { ...patch, updatedAt: now() });
}

const CASCADE_TABLES = [db.shows, db.episodes, db.scenes, db.sets, db.characters, db.beats, db.revisions, db.shots, db.images];

/** Removes a scene's dependants (shots, revision history) and unlinks it from any beat. */
async function removeSceneDependants(sceneId: string) {
  await db.shots.where("sceneId").equals(sceneId).delete();
  await db.revisions.where("sceneId").equals(sceneId).delete();
  await db.beats.where("sceneId").equals(sceneId).modify({ sceneId: null });
}

export async function deleteShow(id: string) {
  await db.transaction("rw", CASCADE_TABLES, async () => {
    const episodes = await db.episodes.where("showId").equals(id).toArray();
    for (const ep of episodes) {
      const scenes = await db.scenes.where("episodeId").equals(ep.id).toArray();
      for (const scene of scenes) await removeSceneDependants(scene.id);
      await db.scenes.where("episodeId").equals(ep.id).delete();
      await db.beats.where("episodeId").equals(ep.id).delete();
    }
    await db.images.where("showId").equals(id).delete();
    await db.episodes.where("showId").equals(id).delete();
    await db.sets.where("showId").equals(id).delete();
    await db.characters.where("showId").equals(id).delete();
    await db.shows.delete(id);
  });
}

// --- Episodes ----------------------------------------------------------------

export async function createEpisode(showId: string, title?: string): Promise<string> {
  const existing = await db.episodes.where("showId").equals(showId).toArray();
  const order = existing.length ? Math.max(...existing.map((e) => e.order)) + 1 : 1;
  const id = uid("ep");
  const ts = now();
  const episode: EpisodeEntity = {
    id,
    showId,
    title: title?.trim() || `Episode ${order}`,
    order,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.episodes.put(episode);
  return id;
}

export async function updateEpisode(id: string, patch: Partial<Omit<EpisodeEntity, "id" | "createdAt">>) {
  await db.episodes.update(id, { ...patch, updatedAt: now() });
}

export async function deleteEpisode(id: string) {
  await db.transaction("rw", CASCADE_TABLES, async () => {
    const scenes = await db.scenes.where("episodeId").equals(id).toArray();
    for (const scene of scenes) await removeSceneDependants(scene.id);
    await db.scenes.where("episodeId").equals(id).delete();
    await db.beats.where("episodeId").equals(id).delete();
    await db.episodes.delete(id);
  });
}

// --- Scenes ------------------------------------------------------------------

export async function createScene(episodeId: string, patch: Partial<Omit<SceneEntity, "id" | "episodeId" | "createdAt">> = {}): Promise<string> {
  const existing = await db.scenes.where("episodeId").equals(episodeId).toArray();
  const order = existing.length ? Math.max(...existing.map((s) => s.order)) + 1 : 1;
  const id = uid("scn");
  const ts = now();
  const scene: SceneEntity = {
    id,
    episodeId,
    sceneName: "Scene 1",
    order,
    targetSetId: null,
    activeCharacterIds: [],
    action: "",
    dialogue: [],
    sceneNotes: "",
    ...patch,
    createdAt: ts,
    updatedAt: ts,
  };
  if (!patch.sceneName) scene.sceneName = `Scene ${order}`;
  await db.scenes.put(scene);
  return id;
}

export async function updateScene(id: string, patch: Partial<Omit<SceneEntity, "id" | "episodeId" | "createdAt">>) {
  await db.scenes.update(id, { ...patch, updatedAt: now() });
}

export async function deleteScene(id: string) {
  await db.transaction("rw", CASCADE_TABLES, async () => {
    await removeSceneDependants(id);
    await db.scenes.delete(id);
  });
}

// --- Sets ----------------------------------------------------------------------

export async function createSet(showId: string, data: Pick<SetEntity, "name" | "timeOfDay" | "description">): Promise<string> {
  const id = uid("set");
  const ts = now();
  await db.sets.put({ id, showId, ...data, createdAt: ts, updatedAt: ts });
  return id;
}

export async function updateSet(id: string, patch: Partial<Omit<SetEntity, "id" | "showId" | "createdAt">>) {
  await db.sets.update(id, { ...patch, updatedAt: now() });
}

export async function deleteSet(id: string) {
  await db.transaction("rw", db.sets, db.scenes, async () => {
    const affected = await db.scenes.filter((s) => s.targetSetId === id).toArray();
    for (const sc of affected) {
      await db.scenes.update(sc.id, { targetSetId: null, updatedAt: now() });
    }
    await db.sets.delete(id);
  });
}

// --- Characters ------------------------------------------------------------------

export async function createCharacter(showId: string, data: Omit<CharacterEntity, "id" | "showId" | "createdAt" | "updatedAt">): Promise<string> {
  const id = uid("chr");
  const ts = now();
  await db.characters.put({ id, showId, ...data, createdAt: ts, updatedAt: ts });
  return id;
}

export async function updateCharacter(id: string, patch: Partial<Omit<CharacterEntity, "id" | "showId" | "createdAt">>) {
  await db.characters.update(id, { ...patch, updatedAt: now() });
}

export async function deleteCharacter(id: string) {
  await db.transaction("rw", db.characters, db.scenes, db.shots, async () => {
    await db.shots.filter((shot) => shot.castIds.includes(id)).modify((shot) => {
      shot.castIds = shot.castIds.filter((cid) => cid !== id);
    });
    const affected = await db.scenes
      .filter((s) => s.activeCharacterIds.includes(id) || s.dialogue.some((d) => d.characterId === id))
      .toArray();
    for (const sc of affected) {
      const dialogue: DialogueLine[] = sc.dialogue.filter((d) => d.characterId !== id);
      await db.scenes.update(sc.id, {
        activeCharacterIds: sc.activeCharacterIds.filter((cid) => cid !== id),
        dialogue,
        updatedAt: now(),
      });
    }
    await db.characters.delete(id);
  });
}
