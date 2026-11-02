import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkProject, countBySeverity, unknownTags, type Issue } from "../src/lib/consistency";
import { al, episode, galley, rooftop, scene1, scene2, shot1, shot2, show, sloppy } from "./fixtures";

const base = { show, episodes: [episode], scenes: [scene1], sets: [rooftop, galley], characters: [al, sloppy], shots: [shot1, shot2] };
const codes = (issues: Issue[]) => issues.map((i) => i.code);

describe("unknownTags", () => {
  const names = ["Al", "Dr Vex", "Sloppy"];
  it("accepts known names, including multi-word names and trailing punctuation", () => {
    assert.deepEqual(unknownTags("@Al waves. @Dr Vex nods, then @Sloppy!", "@", names), []);
  });
  it("requires a word boundary so '@Annabel' does not match 'Ann'", () => {
    assert.deepEqual(unknownTags("@Annabel waves", "@", ["Ann"]), ["Annabel"]);
    assert.deepEqual(unknownTags("@Ann waves", "@", ["Ann"]), []);
  });
  it("reports each unknown tag once, for both characters and sets", () => {
    assert.deepEqual(unknownTags("@Bob and @Bob again, @Al", "@", names), ["Bob"]);
    assert.deepEqual(unknownTags("Go to #Moon then #Moon", "#", ["Galley"]), ["Moon"]);
  });
});

describe("checkProject", () => {
  it("is quiet about a well-formed scene apart from the unwritten shot-cast detail", () => {
    const issues = checkProject(base);
    assert.deepEqual(codes(issues).filter((c) => c !== "character-no-look"), [], "only Sloppy's missing look is raised for the well-formed scene");
  });

  it("flags a missing set, an unknown speaker in the cast and unknown tags", () => {
    const issues = checkProject({ ...base, scenes: [scene2], shots: [] });
    assert.ok(codes(issues).includes("scene-no-set"));
    assert.ok(codes(issues).includes("speaker-not-in-cast"));
    assert.ok(codes(issues).includes("unknown-character-tag"));
    assert.ok(issues.find((i) => i.code === "speaker-not-in-cast")?.message.includes("Sloppy"));
  });

  it("raises errors for dangling references and sorts errors first", () => {
    const issues = checkProject({
      ...base,
      scenes: [{ ...scene1, targetSetId: "gone", activeCharacterIds: ["chr1", "ghost"], dialogue: [{ id: "x", characterId: "ghost2", text: "hi" }] }],
      shots: [{ ...shot1, durationSeconds: 0 }, { ...shot2, sceneId: "nowhere" }],
    });
    for (const code of ["scene-missing-set", "scene-missing-character", "dialogue-missing-character", "shot-bad-duration", "orphan-shot"]) assert.ok(codes(issues).includes(code), code);
    const severities = issues.map((i) => i.severity);
    assert.deepEqual(severities, [...severities].sort((a, b) => ({ error: 0, warn: 1, info: 2 })[a] - ({ error: 0, warn: 1, info: 2 })[b]));
  });

  it("flags shot cast outside the scene cast and dialogue spoken too fast for the shot", () => {
    const fast = { ...shot2, durationSeconds: 1, dialogue: "one two three four five six seven eight nine ten" };
    const issues = checkProject({ ...base, shots: [{ ...shot1, castIds: ["chr2"] }, fast] });
    assert.ok(codes(issues).includes("shot-cast-not-in-scene"));
    assert.ok(codes(issues).includes("shot-too-fast"));
  });

  it("warns when the scene's dialogue cannot fit in its shots", () => {
    const long = { ...scene1, dialogue: [{ id: "d", characterId: "chr1", text: Array.from({ length: 80 }, () => "word").join(" ") }] };
    const issues = checkProject({ ...base, scenes: [long], shots: [{ ...shot1, durationSeconds: 5 }] });
    assert.ok(codes(issues).includes("scene-dialogue-longer-than-shots"));
  });

  it("notes visual-bible gaps without calling them errors", () => {
    const issues = checkProject({ ...base, show: { ...show, visualStyle: "" }, characters: [{ ...al, referenceImageIds: [] }, sloppy] });
    assert.ok(codes(issues).includes("show-no-style"));
    assert.ok(codes(issues).includes("character-no-image"));
    assert.ok(codes(issues).includes("character-no-look"));
    assert.equal(countBySeverity(issues).error, 0);
  });

  it("does not ask an idea-stage scene for a set yet", () => {
    const idea = { ...scene2, status: "idea" as const, action: "", dialogue: [] };
    const ideaCodes = codes(checkProject({ ...base, scenes: [idea], shots: [] }));
    assert.ok(!ideaCodes.includes("scene-no-set"));
    assert.ok(!ideaCodes.includes("scene-missing-set"), "no set at all is not the same as a deleted set");
    assert.deepEqual(ideaCodes.filter((c) => c.startsWith("scene-") || c === "speaker-not-in-cast"), []);
    assert.ok(codes(checkProject({ ...base, scenes: [{ ...idea, status: "draft" as const }], shots: [] })).includes("scene-no-set"));
  });

  it("does not nag about an empty scene that is still just an idea", () => {
    const idea = { ...scene1, status: "idea" as const, action: "", dialogue: [] };
    assert.ok(!codes(checkProject({ ...base, scenes: [idea], shots: [] })).includes("scene-empty"));
    assert.ok(codes(checkProject({ ...base, scenes: [{ ...idea, status: "draft" as const }], shots: [] })).includes("scene-empty"));
  });
});
