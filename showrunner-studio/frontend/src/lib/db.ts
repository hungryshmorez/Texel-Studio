// db.ts — Dexie (IndexedDB) schema, single source of local-first persistence.
import Dexie, { type EntityTable } from "dexie";
import type {
  ShowMeta,
  SetEntity,
  CharacterEntity,
  EpisodeEntity,
  SceneEntity,
  BeatEntity,
  RevisionEntity,
  ShotEntity,
  ImageAsset,
} from "../types";

export class StudioDB extends Dexie {
  shows!: EntityTable<ShowMeta, "id">;
  sets!: EntityTable<SetEntity, "id">;
  characters!: EntityTable<CharacterEntity, "id">;
  episodes!: EntityTable<EpisodeEntity, "id">;
  scenes!: EntityTable<SceneEntity, "id">;
  beats!: EntityTable<BeatEntity, "id">;
  revisions!: EntityTable<RevisionEntity, "id">;
  shots!: EntityTable<ShotEntity, "id">;
  images!: EntityTable<ImageAsset, "id">;

  constructor(name = "showrunner-studio") {
    // The name stays "showrunner-studio" so projects written before the rename keep loading.
    super(name);
    this.version(1).stores({
      shows: "id, title, updatedAt",
      sets: "id, showId, name, updatedAt",
      characters: "id, showId, name, role, updatedAt",
      episodes: "id, showId, order, updatedAt",
      scenes: "id, episodeId, order, targetSetId, updatedAt",
    });
    // v2 is additive: new tables only. New optional fields on old rows are read with defaults.
    this.version(2).stores({
      beats: "id, episodeId, order, sceneId",
      revisions: "id, sceneId, createdAt",
      shots: "id, sceneId, order",
      images: "id, showId",
    });
  }
}

export const db = new StudioDB();

export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// --- Full project export/import (JSON) ---

export interface ProjectSnapshot {
  version: 1 | 2;
  exportedAt: number;
  shows: ShowMeta[];
  sets: SetEntity[];
  characters: CharacterEntity[];
  episodes: EpisodeEntity[];
  scenes: SceneEntity[];
  // Present from version 2. Version 1 files simply lack them.
  beats?: BeatEntity[];
  revisions?: RevisionEntity[];
  shots?: ShotEntity[];
  images?: ImageAsset[];
}

export async function exportProjectSnapshot(): Promise<ProjectSnapshot> {
  const [shows, sets, characters, episodes, scenes, beats, revisions, shots, images] = await Promise.all([
    db.shows.toArray(),
    db.sets.toArray(),
    db.characters.toArray(),
    db.episodes.toArray(),
    db.scenes.toArray(),
    db.beats.toArray(),
    db.revisions.toArray(),
    db.shots.toArray(),
    db.images.toArray(),
  ]);
  return { version: 2, exportedAt: Date.now(), shows, sets, characters, episodes, scenes, beats, revisions, shots, images };
}

export async function importProjectSnapshot(snapshot: ProjectSnapshot, mode: "merge" | "replace" = "merge") {
  const tables = [db.shows, db.sets, db.characters, db.episodes, db.scenes, db.beats, db.revisions, db.shots, db.images];
  await db.transaction("rw", tables, async () => {
    if (mode === "replace") await Promise.all(tables.map((table) => table.clear()));
    await db.shows.bulkPut(snapshot.shows);
    await db.sets.bulkPut(snapshot.sets);
    await db.characters.bulkPut(snapshot.characters);
    await db.episodes.bulkPut(snapshot.episodes);
    await db.scenes.bulkPut(snapshot.scenes);
    await db.beats.bulkPut(snapshot.beats ?? []);
    await db.revisions.bulkPut(snapshot.revisions ?? []);
    await db.shots.bulkPut(snapshot.shots ?? []);
    await db.images.bulkPut(snapshot.images ?? []);
  });
}
