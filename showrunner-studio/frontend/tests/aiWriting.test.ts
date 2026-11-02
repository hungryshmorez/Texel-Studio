import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { errorMessage, runAiJob } from "../src/lib/aiJobs";
import { characterInfos, continuityRequest, hasMissingPrompts, promptPatches, sceneCast, shotDraftsFromAi, shotListRequest, shotPromptsRequest } from "../src/lib/aiWriting";
import { al, rooftop, scene1, scene2, shot1, shot2, show, sloppy } from "./fixtures";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("runAiJob", () => {
  const fast = { intervalMs: 1 };

  it("starts a job, polls until it is done, and returns the data", async () => {
    const calls: string[] = [];
    let polls = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/x/start") return json({ job_id: "j1" });
      return json(++polls < 3 ? { status: "pending", result: null, error: null } : { status: "done", result: { data: [1, 2] }, error: null });
    }) as typeof fetch;
    assert.deepEqual(await runAiJob<number[]>("/api/x/start", { a: 1 }, { ...fast, fetchImpl }), [1, 2]);
    assert.equal(calls[0], "POST /api/x/start");
    assert.equal(polls, 3);
  });

  it("surfaces a job error, a refused start and a validation error as readable text", async () => {
    const failing = (async (url: string) => (url.endsWith("/start") ? json({ job_id: "j" }) : json({ status: "error", result: null, error: "The model did not return valid JSON." }))) as typeof fetch;
    await assert.rejects(() => runAiJob("/api/x/start", {}, { ...fast, fetchImpl: failing }), /did not return valid JSON/);
    const refused = (async () => json({ detail: "Write some action first." }, 400)) as typeof fetch;
    await assert.rejects(() => runAiJob("/api/x/start", {}, { ...fast, fetchImpl: refused }), /Write some action first/);
    assert.match(await errorMessage(json({ detail: [{ loc: ["body"] }] }, 422)), /not valid/);
    assert.match(await errorMessage(new Response("boom", { status: 500 })), /\(500\)/);
  });

  it("gives up after the timeout and can be cancelled", async () => {
    const pending = (async (url: string) => (url.endsWith("/start") ? json({ job_id: "j" }) : json({ status: "pending", result: null, error: null }))) as typeof fetch;
    await assert.rejects(() => runAiJob("/api/x/start", {}, { intervalMs: 1, timeoutMs: 20, fetchImpl: pending }), /took too long/);
    const controller = new AbortController();
    const promise = runAiJob("/api/x/start", {}, { intervalMs: 50, fetchImpl: pending, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(() => promise, (error: Error) => error.name === "AbortError");
  });
});

describe("AI request building", () => {
  it("sends only the scene's own cast and set, with writer's notes left out", () => {
    const request = shotListRequest(show, scene1, rooftop, [al, sloppy], 12);
    assert.deepEqual(request.characters.map((c) => c.name), ["Al"], "Sloppy is neither cast nor speaking in this scene");
    assert.equal(request.scene.heading, "EXT. CROW'S NEST - DAY");
    assert.deepEqual(request.scene.dialogue, [{ speaker: "Al", parenthetical: "to camera", text: "Welcome back, folks." }]);
    assert.equal(request.target_seconds, 12);
    assert.equal(request.show.visual_style, "Grainy 1990s public access video, warm tungsten light");
    assert.ok(!JSON.stringify(request).includes("Keep it deadpan"), "scene notes are private");
    assert.deepEqual(sceneCast(scene2, [al, sloppy]).map((c) => c.name), ["Sloppy"], "a speaker counts as cast");
  });

  it("clips everything to the limits the server enforces so a long scene is never a 422", () => {
    const huge = { ...scene1, action: "x".repeat(50_000) };
    assert.equal(shotListRequest(show, huge, rooftop, [al]).scene.action.length, 12000);
    assert.equal(characterInfos([{ ...al, visualDescription: "y".repeat(9000) }])[0].visual.length, 1500);
    const many = Array.from({ length: 60 }, (_, i) => ({ ...scene1, id: `s${i}` }));
    const request = continuityRequest(show, many, [rooftop], [al]);
    assert.equal(request.scenes.length, 40);
    assert.ok(request.scenes.every((s) => s.action.length <= 3000));
  });

  it("only sends written scenes to the continuity check", () => {
    const empty = { ...scene1, id: "e", action: "", dialogue: [] };
    assert.equal(continuityRequest(show, [scene1, empty], [rooftop], [al]).scenes.length, 1);
  });

  it("numbers shots in order for the prompt request, whatever their stored order", () => {
    const request = shotPromptsRequest(show, scene1, rooftop, [al], [shot2, shot1]);
    assert.deepEqual(request.shots.map((s) => [s.number, s.description]), [[1, "Al on the mast at dusk"], [2, "Al's face, \"grinning\""]]);
    assert.deepEqual(request.shots[0].cast, ["Al"]);
  });
});

describe("applying AI results", () => {
  it("maps cast names back to ids case-insensitively and drops unknown names", () => {
    const drafts = shotDraftsFromAi([{ duration_seconds: 4, framing: "Wide", movement: "", description: "d", dialogue: "", cast: ["AL", "Ghost"], storyboard_prompt: "s", video_prompt: "v" }], [al, sloppy]);
    assert.deepEqual(drafts[0].castIds, ["chr1"]);
    assert.equal(drafts[0].durationSeconds, 4);
    assert.equal(drafts[0].videoPrompt, "v");
  });

  it("fills only empty prompt fields and never overwrites the writer's words", () => {
    const written = { ...shot1, storyboardPrompt: "MY OWN SKETCH WORDS", videoPrompt: "" };
    const patches = promptPatches([shot2, written], [
      { number: 1, storyboard_prompt: "AI sketch", video_prompt: "AI video" },
      { number: 2, storyboard_prompt: "AI sketch 2", video_prompt: "AI video 2" },
      { number: 9, storyboard_prompt: "no such shot", video_prompt: "" },
    ]);
    const first = patches.find((p) => p.id === written.id)!;
    assert.deepEqual(first.patch, { videoPrompt: "AI video" }, "the writer's storyboard prompt is untouched");
    const second = patches.find((p) => p.id === shot2.id)!;
    assert.deepEqual(second.patch, { storyboardPrompt: "AI sketch 2", videoPrompt: "AI video 2" });
    assert.equal(patches.length, 2);
  });

  it("knows whether any prompt is missing", () => {
    assert.equal(hasMissingPrompts([shot1]), false);
    assert.equal(hasMissingPrompts([shot1, shot2]), true);
    assert.equal(hasMissingPrompts([]), false);
  });
});
