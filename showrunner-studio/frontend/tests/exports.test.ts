import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { inferIntExt, plainHeading, sceneHeading, toFountain } from "../src/lib/fountain";
import { formatShotLines, shotsToCsv, shotTimings, totalDuration } from "../src/lib/shotlist";
import { buildBridge, decodeDataUrl, slugify, zipPackage } from "../src/lib/magoExport";
import { al, episode, galley, images, PNG_DATA_URL, rooftop, scene1, scene2, shot1, shot2, show, sloppy } from "./fixtures";

const characters = [al, sloppy];
const sets = [rooftop, galley];

describe("fountain", () => {
  it("builds a standard heading from the set, int/ext and time of day", () => {
    assert.equal(sceneHeading(scene1, rooftop), "EXT. CROW'S NEST - DAY");
    assert.equal(sceneHeading({ ...scene1, intExt: "INT", timeOfDayTag: "night" }, rooftop), "INT. CROW'S NEST - NIGHT");
    assert.equal(sceneHeading(scene2, undefined), ".KITCHEN CHAT", "no set becomes a forced heading");
    assert.equal(plainHeading(scene2, undefined), "KITCHEN CHAT");
    assert.equal(inferIntExt(galley), "INT");
    assert.equal(sceneHeading({ ...scene1, targetSetId: "set2" }, galley), "INT. GALLEY - NIGHT");
  });

  it("formats action, notes, cues and parentheticals", () => {
    const text = toFountain({ show, episode, scenes: [scene1], sets, characters });
    assert.match(text, /^Title: Couch Pirates\n    Pilot\nCredit: Written by\nNotes: Two pirates/);
    assert.match(text, /\n====\n\nEXT\. CROW'S NEST - DAY\n\n\[\[Keep it deadpan\]\]\n\nAl climbs the mast\.\n\nThe wind howls\.\n\nAL\n\(to camera\)\nWelcome back, folks\.\n$/);
  });

  it("escapes lines that would be read as other Fountain syntax", () => {
    const text = toFountain({ show, scenes: [scene2], sets, characters });
    assert.match(text, /!#hashtag stays action\. @Annabel waves\./);
    assert.match(text, /SLOPPY\nIs this thing on\?/);
  });

  it("never lets a note break out of its brackets", () => {
    const text = toFountain({ show, scenes: [{ ...scene1, sceneNotes: "bad ]] note\n\nsecond" }], sets, characters });
    assert.match(text, /\[\[bad \] \] note second\]\]/);
  });
});

describe("shot list", () => {
  const shots = [shot2, shot1]; // deliberately out of order

  it("times shots in order and totals the duration", () => {
    const timings = shotTimings(shots).map((t) => [t.shot.id, t.start, t.end]);
    assert.deepEqual(timings, [["sh1", 0, 4], ["sh2", 4, 6.5]]);
    assert.equal(totalDuration(shots), 6.5);
  });

  it("writes Mago-style [Shot n] (start-end s) lines", () => {
    const lines = formatShotLines(shots, (ids) => ids.map((id) => (id === "chr1" ? "Al" : "?")));
    assert.equal(lines[0], "[Shot 1] (0-4 s) Wide, Slow push-in: Al on the mast at dusk Cast: Al.");
    assert.equal(lines[1], '[Shot 2] (4-6.5 s) Close-up, Static: Al\'s face, "grinning" Cast: Al. Dialogue: Welcome back, folks.');
  });

  it("quotes CSV cells that contain commas, quotes or newlines", () => {
    const csv = shotsToCsv([{ ...shot1, description: 'He said "hi", twice\nthen left' }]);
    assert.match(csv, /"He said ""hi"", twice\nthen left"/);
    assert.equal(csv.split("\n")[0], "shot,start_s,end_s,duration_s,framing,movement,description,dialogue,cast,storyboard_prompt,video_prompt,notes");
  });
});

describe("Mago bridge package", () => {
  const input = { show, episodes: [episode], scenes: [scene1, scene2], shots: [shot1, shot2], sets, characters, images };

  it("contains the director script with style, cast, environments and standard headings", () => {
    const pkg = buildBridge(input);
    const director = pkg.files.find((f) => f.path === "director-script.txt")!.text!;
    assert.match(director, /^TITLE: Couch Pirates\nLOGLINE: Two pirates host a talk show nobody asked for\.\nGENRE: Surreal comedy\nVISUAL STYLE: Grainy 1990s public access video, warm tungsten light\nWORLD: /);
    assert.match(director, /- SLOPPY \(Supporting, 30, female\)\n/, "a character with no description has no dangling colon");
    assert.match(director, /CAST\n- AL \(Protagonist, 50, male\): A weathered pirate in a red velvet coat\. Wardrobe: Red coat, one boot\. Distinctive features: eyepatch, gold tooth\. Voice: gravelly baritone\./);
    assert.match(director, /ENVIRONMENTS\n- CROW'S NEST \(Exterior\): A tiny wooden lookout above the sails\. Look: Blue moonlight, wind noise\./);
    assert.match(director, /SCRIPT\n\nEXT\. CROW'S NEST - DAY\n\nAl climbs the mast\./);
    assert.doesNotMatch(director, /Keep it deadpan/, "writer's notes never go to the video tool");
    assert.doesNotMatch(director, /\[\[/);
  });

  it("only describes the cast and sets that exported scenes use", () => {
    const only = buildBridge({ ...input, scenes: [scene1], shots: [shot1] });
    const director = only.files.find((f) => f.path === "director-script.txt")!.text!;
    assert.doesNotMatch(director, /GALLEY/);
    assert.doesNotMatch(director, /SLOPPY \(/);
  });

  it("writes shot files, storyboard prompts and warns about gaps", () => {
    const pkg = buildBridge(input);
    const shotFile = pkg.files.find((f) => f.path.startsWith("shots/E01-S01-"))!;
    assert.match(shotFile.text!, /\[Shot 1\] \(0-4 s\) Wide, Slow push-in/);
    assert.match(shotFile.text!, /\[Shot 1\] Wide shot, Al climbing/);
    assert.match(shotFile.text!, /\[Shot 2\] \(not written\)/);
    const board = pkg.files.find((f) => f.path === "storyboard-prompts.md")!.text!;
    assert.match(board, /1\. Marker sketch of a tiny man on a tall mast\n2\. \(not written\)/);
    assert.ok(pkg.warnings.some((w) => w.includes("Kitchen chat") && w.includes("no set")));
  });

  it("includes decoded reference images and a machine-readable project file", () => {
    const pkg = buildBridge(input);
    const png = pkg.files.find((f) => f.path === "cast/al-1.png");
    assert.ok(png?.bytes && png.bytes.length > 20);
    assert.deepEqual([...png.bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], "a real PNG signature");
    assert.ok(pkg.files.some((f) => f.path === "environments/crow-s-nest-1.png"));
    const json = JSON.parse(pkg.files.find((f) => f.path === "showwriter-project.json")!.text!);
    assert.deepEqual(json.schema, { name: "showwriter-mago-bridge", version: 1 });
    assert.deepEqual(json.cast[0].referenceImages, ["cast/al-1.png"]);
    assert.equal(json.episodes[0].scenes[0].shots[1].endSeconds, 6.5);
  });

  it("can export a single episode", () => {
    const second = { ...episode, id: "ep2", title: "Second", order: 2 };
    const other = { ...scene1, id: "scnX", episodeId: "ep2", sceneName: "Elsewhere" };
    const pkg = buildBridge({ ...input, episodes: [episode, second], scenes: [scene1, other], episodeId: "ep2" });
    const director = pkg.files.find((f) => f.path === "director-script.txt")!.text!;
    assert.match(director, /TITLE: Couch Pirates — Second/);
    assert.match(director, /EXT\. CROW'S NEST - DAY/);
    assert.equal((director.match(/Al climbs the mast/g) ?? []).length, 1);
  });

  it("zips to a valid archive whose files read back identically", () => {
    const pkg = buildBridge(input);
    const entries = unzipSync(zipPackage(pkg));
    assert.deepEqual(Object.keys(entries).sort(), pkg.files.map((f) => f.path).sort());
    const readme = strFromU8(entries["README.txt"]);
    assert.match(readme, /Paste the whole of director-script\.txt/);
    assert.match(readme, /AGPL-3\.0-only/);
    assert.equal(strFromU8(entries["script.fountain"]), pkg.files.find((f) => f.path === "script.fountain")!.text);
  });

  it("leaves out scenes that have nothing written and says so", () => {
    const idea = { ...scene1, id: "idea1", sceneName: "Just an idea", order: 3, action: "  ", dialogue: [], status: "idea" as const };
    const pkg = buildBridge({ ...input, scenes: [scene1, idea] });
    const director = pkg.files.find((f) => f.path === "director-script.txt")!.text!;
    assert.doesNotMatch(director, /JUST AN IDEA/i);
    assert.doesNotMatch(pkg.files.find((f) => f.path === "script.fountain")!.text!, /JUST AN IDEA/i);
    assert.ok(pkg.warnings.includes("1 scene has no action or dialogue yet and was left out."));
    const json = JSON.parse(pkg.files.find((f) => f.path === "showwriter-project.json")!.text!);
    assert.equal(json.episodes[0].scenes.length, 1);
  });

  it("copes with an empty project and unreadable images without throwing", () => {
    const empty = buildBridge({ ...input, scenes: [], shots: [] });
    assert.ok(empty.warnings.includes("There are no scenes to export."));
    const broken = buildBridge({ ...input, images: [{ ...images[0], dataUrl: "data:image/png;base64,!!!" }, images[1]] });
    assert.ok(broken.warnings.some((w) => w.includes("could not be read")));
  });

  it("slugifies names safely", () => {
    assert.equal(slugify("Crow's Nest!"), "crow-s-nest");
    assert.equal(slugify("Ünïcode Wörld"), "unicode-world");
    assert.equal(slugify("***", "fallback"), "fallback");
    assert.equal(decodeDataUrl("nonsense"), null);
    assert.ok(decodeDataUrl(PNG_DATA_URL));
  });
});
