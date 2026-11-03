import assert from "node:assert/strict";
import { test } from "node:test";

import { breakDownScene, castFromScript, clipVideoPrompt, composeClipVideoPrompt, scriptText, storyboardPromptFor, type Run } from "../src/lib/magoWriting.ts";
import { al, galley, rooftop, scene1, scene2, show, shot1, shot2, sloppy } from "./fixtures.ts";

const characters = [al, sloppy];
const sets = [rooftop, galley];

const CASTING = {
  title: "Couch Pirates",
  sequences: [{ id: 1, heading: "EXT. CROW'S NEST - DAY", int_ext: "EXT", time_of_day: "DAY" }],
  sequence_video_prompts: [{ id: 1, video_prompt: "Al climbs the mast.", needs_previous_frame: false, camera: null, dialogue: [{ speaker: "AL", line: "Welcome back, folks.", language: "English" }] }],
  characters: [
    { name: "Al", description: "A weathered pirate in a red coat", sequence_ids: [1], alt: "default", body_plan: "upright", distinctive_features: ["eyepatch"], voice_profile: "Gravelly baritone", t2i_prompt: "Turnaround of Al" },
    { name: "Captain Mags", description: "A stern captain with a brass telescope", sequence_ids: [1], alt: "default", body_plan: "upright", distinctive_features: [], voice_profile: null, t2i_prompt: "Turnaround of Mags" },
  ],
  environments: [{ name: "Crow's Nest", description: "A tiny lookout above the sails", sequence_ids: [1], alt: "default", t2i_prompt: "plate" }],
  props: [],
  visual_style: "Grainy public access video",
};

const SHOTS = {
  sequence_shots: [{
    sequence_id: 1,
    shots: [
      { action: "Al climbs", video_prompt: "Al hauls himself up the mast against a dusk sky.", characters: ["al"], environments: ["crow_s_nest"], props: [], needs_previous_frame: false, beat_type: "physical_beat", duration_short_s: 2, duration_long_s: 4, camera: { framing: "wide", movement: "slow push-in", lens: "35mm", from_script: false }, dialogue: [] },
      { action: "Al greets", video_prompt: "Al grins into the lens.", characters: ["al"], environments: ["crow_s_nest"], props: [], needs_previous_frame: true, beat_type: "contained_reaction", duration_short_s: 2, duration_long_s: 3, camera: { framing: "Close-up", movement: "", lens: "" , from_script: false }, dialogue: [{ speaker: "AL", line: "Welcome back, folks.", language: "English" }] },
    ],
  }],
};

const fakeRun = (log: string[] = []): Run => async (prompt) => {
  log.push(prompt);
  if (prompt.includes("sequence_shots")) return JSON.stringify(SHOTS);
  if (prompt.includes("subject_definitions")) throw new Error("model unavailable");
  return JSON.stringify(CASTING);
};

test("scriptText skips idea scenes and uses screenplay headings", () => {
  const idea = { ...scene2, action: "", dialogue: [] };
  const text = scriptText([scene1, idea], sets, characters);
  assert.match(text, /^EXT\. CROW'S NEST/);
  assert.ok(!text.includes("KITCHEN"));
});

test("castFromScript proposes characters and sets and marks the ones the show already has", async () => {
  const proposal = await castFromScript(scriptText([scene1], sets, characters), fakeRun(), characters, sets);
  const names = proposal.characters.map((c) => [c.name, c.exists]);
  assert.deepEqual(names, [["Al", true], ["Captain Mags", false]]);
  assert.equal(proposal.characters[1].visualDescription, "A stern captain with a brass telescope.");
  assert.equal(proposal.characters[0].distinctiveFeatures, "eyepatch");
  assert.deepEqual(proposal.sets.map((s) => [s.name, s.exists]), [["Crow's Nest", true]]);
  assert.equal(proposal.visualStyle, "Grainy public access video");
});

test("castFromScript refuses an empty script before calling the model", async () => {
  const calls: string[] = [];
  await assert.rejects(castFromScript("  ", fakeRun(calls), characters, sets), /nothing to read/);
  assert.equal(calls.length, 0);
});

test("castFromScript retries once when the model's first answer breaks the schema, then gives up with a clear error", async () => {
  let n = 0;
  const bad: Run = async () => { n++; return "not json"; };
  await assert.rejects(castFromScript("EXT. X - DAY\n\nSomeone walks.", bad, [], []), /Invalid response from model/);
  assert.equal(n, 2);
});

test("breakDownScene maps Mago's atomic shots onto Showwriter shot rows", async () => {
  const drafts = await breakDownScene(scene1, rooftop, characters, fakeRun());
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].framing, "Wide");
  assert.equal(drafts[0].movement, "Slow push-in");
  assert.equal(drafts[0].durationSeconds, 3);
  assert.deepEqual(drafts[0].castIds, ["chr1"]);
  assert.match(drafts[0].notes ?? "", /Lens: 35mm/);
  assert.equal(drafts[1].framing, "Close-up");
  assert.equal(drafts[1].dialogue, "AL: Welcome back, folks.");
  assert.ok(drafts.every((d) => (d.durationSeconds ?? 0) >= 1));
});

test("breakDownScene refuses a scene with nothing written", async () => {
  await assert.rejects(breakDownScene({ ...scene2, action: "", dialogue: [] }, undefined, characters, fakeRun()), /nothing to break into shots/);
});

test("clipVideoPrompt writes the timed cut list without the spoken words", () => {
  const text = clipVideoPrompt([shot1, shot2]);
  assert.equal(text.split("\n")[0], "[Shot 1] (0-4 s) Wide, Slow push-in: Al on the mast at dusk");
  assert.match(text.split("\n")[1], /^\[Shot 2\] \(4-6\.5 s\) Close-up, Static:/);
  assert.ok(!text.includes("Welcome back"));
});

test("storyboardPromptFor builds one panel per shot and names the cast and place", () => {
  const prompt = storyboardPromptFor([shot1, shot2], characters, rooftop);
  assert.match(prompt, /2 empty/);
  assert.match(prompt, /Panel 1: Wide, Slow push-in: Al on the mast at dusk\./);
  assert.match(prompt, /Panel 2:/);
  assert.match(prompt, /exactly 1 character: Al \(A weathered pirate in a red velvet coat\.?\)/);
  assert.match(prompt, /The place: Crow's Nest/);
  assert.ok(!prompt.includes("Welcome back"));
});

test("storyboardPromptFor needs shots", () => {
  assert.throws(() => storyboardPromptFor([], characters, rooftop), /shot list first/);
});

test("composeClipVideoPrompt falls back to Mago's deterministic skeleton when the model fails", async () => {
  const result = await composeClipVideoPrompt(show, [shot1, shot2], characters, rooftop, fakeRun());
  assert.equal(result.fallback, true);
  assert.ok(result.warnings.some((w) => /skeleton/.test(w)));
  assert.ok(result.prompt.length > 100);
  assert.match(result.prompt, /Welcome back, folks/);
});

test("composeClipVideoPrompt uses the model's document when it is valid", async () => {
  const detailed = "Grainy 1990s public access video. [Shot 1] (0-4 s) Wide, slow push-in on {{subject:al}} climbing the mast. [Shot 2] (4-6.5 s) Close-up: Al says: {{line:1}}";
  const run: Run = async () => JSON.stringify({ subject_definitions: "{{subject:al}} is a weathered pirate in a red coat.", summary: "[reference generation] Al hosts from the mast.", retention_analysis: "", detailed_description: detailed, overall_soundscape: "Wind and creaking wood.", non_diegetic_music: "N/A" });
  const result = await composeClipVideoPrompt(show, [shot1, shot2], characters, rooftop, run);
  assert.equal(result.fallback, false, result.warnings.join(" | "));
  assert.ok(result.prompt.includes("Welcome back, folks."));
  assert.ok(result.prompt.includes("Wind and creaking wood."));
});
