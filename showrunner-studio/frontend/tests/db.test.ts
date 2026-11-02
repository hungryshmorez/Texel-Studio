import "fake-indexeddb/auto";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, exportProjectSnapshot, importProjectSnapshot, type ProjectSnapshot } from "../src/lib/db";
import { createCharacter, createEpisode, createScene, createSet, createShow, deleteCharacter, deleteEpisode, deleteScene, deleteShow, updateScene } from "../src/lib/actions";
import { addImage, applyBeatTemplate, createBeat, createShot, deleteImage, deleteShot, listRevisions, listShots, moveBeat, moveShot, replaceShots, restoreRevision, saveRevision, updateBeat } from "../src/lib/writingActions";
import { BEAT_TEMPLATES } from "../src/lib/beatTemplates";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

async function clearAll() {
  await Promise.all([db.shows, db.sets, db.characters, db.episodes, db.scenes, db.beats, db.revisions, db.shots, db.images].map((t) => t.clear()));
}

async function seed() {
  const showId = await createShow("Test Show");
  const episodeId = await createEpisode(showId);
  const sceneId = await createScene(episodeId, { action: "Rain on the window." });
  return { showId, episodeId, sceneId };
}

describe("writing data layer", () => {
  beforeEach(clearAll);

  it("deleting a scene removes its shots and revisions and unlinks its beat", async () => {
    const { episodeId, sceneId } = await seed();
    await createShot(sceneId);
    await saveRevision(sceneId, "first");
    const beatId = await createBeat(episodeId, "Hook");
    await updateBeat(beatId, { sceneId });
    await deleteScene(sceneId);
    assert.equal(await db.shots.count(), 0);
    assert.equal(await db.revisions.count(), 0);
    assert.equal((await db.beats.get(beatId))?.sceneId, null);
    assert.equal(await db.beats.count(), 1, "the beat itself stays; only the link is cleared");
  });

  it("deleting an episode or a show cascades through everything it owns", async () => {
    const { showId, episodeId, sceneId } = await seed();
    await createShot(sceneId);
    await saveRevision(sceneId);
    await createBeat(episodeId);
    await addImage(showId, "ref.png", "image/png", PNG);
    const secondEpisode = await createEpisode(showId);
    const secondScene = await createScene(secondEpisode);
    await createShot(secondScene);
    await deleteEpisode(episodeId);
    assert.equal(await db.shots.count(), 1, "only the other episode's shot remains");
    assert.equal(await db.beats.count(), 0);
    await deleteShow(showId);
    for (const table of [db.shows, db.episodes, db.scenes, db.shots, db.revisions, db.beats, db.images]) assert.equal(await table.count(), 0);
  });

  it("restoring a revision brings back the old text and keeps the current text as a safety copy", async () => {
    const { sceneId } = await seed();
    await saveRevision(sceneId, "v1");
    await updateScene(sceneId, { action: "A completely different scene.", status: "revised" });
    const [first] = (await listRevisions(sceneId)).filter((r) => r.label === "v1");
    await restoreRevision(first.id);
    const scene = await db.scenes.get(sceneId);
    assert.equal(scene?.action, "Rain on the window.");
    const revisions = await listRevisions(sceneId);
    const safety = revisions.find((r) => r.auto);
    assert.equal(safety?.label, "Before restore");
    assert.equal(safety?.snapshot.action, "A completely different scene.");
    assert.equal(safety?.snapshot.status, "revised");
  });

  it("beats reorder by swapping with a neighbour and stop at the ends", async () => {
    const { episodeId } = await seed();
    const a = await createBeat(episodeId, "A");
    const b = await createBeat(episodeId, "B");
    assert.equal(await moveBeat(a, -1), false);
    assert.equal(await moveBeat(a, 1), true);
    const order = (await db.beats.toArray()).sort((x, y) => x.order - y.order).map((x) => x.label);
    assert.deepEqual(order, ["B", "A"]);
    assert.equal(await moveBeat(b, -1), false);
  });

  it("a beat template adds all of its beats in order", async () => {
    const { episodeId } = await seed();
    const template = BEAT_TEMPLATES.find((t) => t.id === "save_the_cat")!;
    assert.equal(await applyBeatTemplate(episodeId, "save_the_cat"), template.beats.length);
    const labels = (await db.beats.toArray()).sort((x, y) => x.order - y.order).map((x) => x.label);
    assert.deepEqual(labels, template.beats.map((b) => b.label));
    await assert.rejects(() => applyBeatTemplate(episodeId, "nope"));
  });

  it("shots stay numbered 1..n after a delete and can be moved and replaced", async () => {
    const { sceneId } = await seed();
    const a = await createShot(sceneId, { description: "A" });
    const b = await createShot(sceneId, { description: "B" });
    await createShot(sceneId, { description: "C" });
    await deleteShot(a);
    let shots = await listShots(sceneId);
    assert.deepEqual(shots.map((s) => [s.order, s.description]), [[1, "B"], [2, "C"]]);
    assert.equal(await moveShot(b, 1), true);
    shots = await listShots(sceneId);
    assert.deepEqual(shots.map((s) => s.description), ["C", "B"]);
    await replaceShots(sceneId, [{ description: "X", durationSeconds: 5 }, { description: "Y" }]);
    shots = await listShots(sceneId);
    assert.deepEqual(shots.map((s) => [s.order, s.description, s.durationSeconds]), [[1, "X", 5], [2, "Y", 3]]);
  });

  it("deleting a character removes it from every shot's cast", async () => {
    const { showId, sceneId } = await seed();
    const keep = await createCharacter(showId, { name: "Ann", role: "Protagonist", age: "30", gender: "f", visualDescription: "", voiceDescription: "" });
    const drop = await createCharacter(showId, { name: "Bo", role: "Supporting", age: "40", gender: "m", visualDescription: "", voiceDescription: "" });
    const shotId = await createShot(sceneId, { castIds: [keep, drop] });
    await deleteCharacter(drop);
    assert.deepEqual((await db.shots.get(shotId))?.castIds, [keep]);
  });

  it("images validate their input and deleting one clears every reference to it", async () => {
    const { showId } = await seed();
    await assert.rejects(() => addImage(showId, "x.txt", "text/plain", "data:text/plain;base64,AA=="));
    await assert.rejects(() => addImage(showId, "x.png", "image/png", "not a data url"));
    await assert.rejects(() => addImage(showId, "big.png", "image/png", "data:image/png;base64," + "A".repeat(3_000_001)));
    const imageId = await addImage(showId, "ref.png", "image/png", PNG);
    const characterId = await createCharacter(showId, { name: "Ann", role: "Protagonist", age: "", gender: "", visualDescription: "", voiceDescription: "", referenceImageIds: [imageId] });
    const setId = await createSet(showId, { name: "Roof", timeOfDay: "Night", description: "" });
    await db.sets.update(setId, { referenceImageIds: [imageId] });
    await deleteImage(imageId);
    assert.deepEqual((await db.characters.get(characterId))?.referenceImageIds, []);
    assert.deepEqual((await db.sets.get(setId))?.referenceImageIds, []);
    assert.equal(await db.images.count(), 0);
  });

  it("a project export round-trips through replace, and a version 1 file still imports", async () => {
    const { showId, sceneId } = await seed();
    await createShot(sceneId, { description: "Close on the window" });
    await addImage(showId, "ref.png", "image/png", PNG);
    const snapshot = await exportProjectSnapshot();
    assert.equal(snapshot.version, 2);
    await importProjectSnapshot(snapshot, "replace");
    assert.equal(await db.shots.count(), 1);
    assert.equal(await db.images.count(), 1);

    const legacy: ProjectSnapshot = { version: 1, exportedAt: 0, shows: snapshot.shows, sets: [], characters: [], episodes: snapshot.episodes, scenes: snapshot.scenes };
    await importProjectSnapshot(legacy, "replace");
    assert.equal(await db.shows.count(), 1);
    assert.equal(await db.shots.count(), 0, "a version 1 file has no shots, and replace clears them");
  });
});
