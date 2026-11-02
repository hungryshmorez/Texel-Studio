// magoExport.ts — the Showwriter → Mago Studio bridge.
//
// Mago Studio (https://github.com/MagoStudio/MagoStudio, AGPL-3.0) has no script importer: its
// Director casts a script pasted or typed into its own chat, and its shot table saves rows as
// "[Shot n] (start-end s) ..." lines. So this package is built to be pasted and attached by hand:
//   director-script.txt  one block to paste into Mago Director (style, cast, environments, script)
//   script.fountain      the screenplay for any other tool
//   shots/*.txt          per-scene shot-table lines to paste into Mago's shot table
//   storyboard-prompts.md  the storyboard wording for each shot
//   cast/, environments/ descriptions and reference images to attach when casting
//   showwriter-project.json  everything, machine-readable, for a future importer
// This module only reads Showwriter data. It shares no code with Mago, so the licenses stay separate.
import { zipSync, strToU8 } from "fflate";
import type { CharacterEntity, EpisodeEntity, ImageAsset, SceneEntity, SetEntity, ShotEntity, ShowMeta } from "../types";
import { plainHeading, toFountain } from "./fountain";
import { formatShotLines, shotTimings, sortShots, totalDuration } from "./shotlist";

export const BRIDGE_SCHEMA = { name: "showwriter-mago-bridge", version: 1 } as const;

export interface BridgeInput {
  show: ShowMeta;
  episodes: EpisodeEntity[];
  scenes: SceneEntity[];
  shots: ShotEntity[];
  sets: SetEntity[];
  characters: CharacterEntity[];
  images: ImageAsset[];
  /** Export one episode only. Omit for the whole show. */
  episodeId?: string;
}

export interface PackageFile {
  path: string;
  text?: string;
  bytes?: Uint8Array;
}

export interface BridgePackage {
  files: PackageFile[];
  warnings: string[];
}

export const slugify = (text: string, fallback = "item"): string =>
  text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || fallback;

function uniqueSlugger() {
  const used = new Map<string, number>();
  return (text: string, fallback?: string) => {
    const base = slugify(text, fallback);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime: match[1], bytes };
  } catch {
    return null;
  }
}

const sentence = (text: string): string => {
  const t = text.trim();
  return t && !/[.!?]$/.test(t) ? `${t}.` : t;
};

function characterLine(c: CharacterEntity): string {
  const facts = [c.role, c.age.trim(), c.gender.trim()].filter(Boolean).join(", ");
  const parts = [
    sentence(c.visualDescription),
    c.wardrobe?.trim() ? `Wardrobe: ${sentence(c.wardrobe)}` : "",
    c.distinctiveFeatures?.trim() ? `Distinctive features: ${sentence(c.distinctiveFeatures)}` : "",
    c.voiceDescription.trim() ? `Voice: ${sentence(c.voiceDescription)}` : "",
  ].filter(Boolean);
  return `- ${c.name.toUpperCase()}${facts ? ` (${facts})` : ""}${parts.length ? `: ${parts.join(" ")}` : ""}`;
}

function environmentLine(s: SetEntity): string {
  const parts = [sentence(s.description), s.lookNotes?.trim() ? `Look: ${sentence(s.lookNotes)}` : ""].filter(Boolean);
  return `- ${s.name.toUpperCase()}${s.timeOfDay.trim() ? ` (${s.timeOfDay.trim()})` : ""}${parts.length ? `: ${parts.join(" ")}` : ""}`;
}

/** Plain screenplay text: the heading, action and dialogue, with no Fountain syntax or writer's notes. */
function screenplayText(scene: SceneEntity, set: SetEntity | undefined, characters: CharacterEntity[]): string {
  const blocks = [plainHeading(scene, set)];
  if (scene.action.trim()) blocks.push(scene.action.trim());
  for (const line of scene.dialogue) {
    if (!line.text.trim()) continue;
    const name = (characters.find((c) => c.id === line.characterId)?.name ?? "UNKNOWN").toUpperCase();
    blocks.push([name, line.parenthetical?.trim() ? `(${line.parenthetical.trim().replace(/^\(|\)$/g, "")})` : "", line.text.trim()].filter(Boolean).join("\n"));
  }
  return blocks.join("\n\n");
}

export function buildBridge(input: BridgeInput): BridgePackage {
  const { show, sets, characters, images } = input;
  const warnings: string[] = [];
  const episodes = [...input.episodes].filter((e) => !input.episodeId || e.id === input.episodeId).sort((a, b) => a.order - b.order);
  const episodeIds = new Set(episodes.map((e) => e.id));
  const inScope = input.scenes.filter((s) => episodeIds.has(s.episodeId));
  // A scene with no action and no dialogue (a beat-board idea) would export as a bare heading, so leave it out.
  const hasWriting = (s: SceneEntity) => s.action.trim() !== "" || s.dialogue.some((d) => d.text.trim() !== "");
  const scenes = inScope.filter(hasWriting);
  const orderedScenes = episodes.flatMap((e) => scenes.filter((s) => s.episodeId === e.id).sort((a, b) => a.order - b.order));
  const setOf = (scene: SceneEntity) => sets.find((s) => s.id === scene.targetSetId);
  const castNames = (ids: string[]) => ids.map((id) => characters.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
  const shotsOf = (scene: SceneEntity) => sortShots(input.shots.filter((s) => s.sceneId === scene.id));

  if (orderedScenes.length === 0) warnings.push("There are no scenes to export.");
  const skipped = inScope.length - scenes.length;
  if (skipped > 0) warnings.push(`${skipped} ${skipped === 1 ? "scene has" : "scenes have"} no action or dialogue yet and ${skipped === 1 ? "was" : "were"} left out.`);
  for (const scene of orderedScenes) {
    if (!scene.targetSetId) warnings.push(`"${scene.sceneName}" has no set, so its heading will be a forced heading.`);
    if (scene.action.trim() && shotsOf(scene).length === 0) warnings.push(`"${scene.sceneName}" has no shot list yet.`);
  }
  if (!show.visualStyle?.trim()) warnings.push("The show has no visual style, so Mago will choose one when it casts.");

  const files: PackageFile[] = [];
  const title = episodes.length === 1 && input.episodeId ? `${show.title} — ${episodes[0].title}` : show.title;

  // Only describe the cast and sets the exported scenes actually use.
  const usedCharacterIds = new Set(orderedScenes.flatMap((s) => [...s.activeCharacterIds, ...s.dialogue.map((d) => d.characterId), ...shotsOf(s).flatMap((sh) => sh.castIds)]));
  const usedSetIds = new Set(orderedScenes.map((s) => s.targetSetId).filter((id): id is string => !!id));
  const cast = characters.filter((c) => usedCharacterIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  const environments = sets.filter((s) => usedSetIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));

  // director-script.txt
  const header = [
    `TITLE: ${title}`,
    show.logline?.trim() ? `LOGLINE: ${show.logline.trim()}` : "",
    show.genre.trim() ? `GENRE: ${show.genre.trim()}` : "",
    show.visualStyle?.trim() ? `VISUAL STYLE: ${show.visualStyle.trim()}` : "",
    show.premise.trim() ? `WORLD: ${show.premise.trim()}` : "",
  ].filter(Boolean).join("\n");
  const director = [
    header,
    cast.length ? `CAST\n${cast.map(characterLine).join("\n")}` : "",
    environments.length ? `ENVIRONMENTS\n${environments.map(environmentLine).join("\n")}` : "",
    `SCRIPT\n\n${orderedScenes.map((s) => screenplayText(s, setOf(s), characters)).join("\n\n")}`,
  ].filter(Boolean).join("\n\n") + "\n";
  files.push({ path: "director-script.txt", text: director });

  // script.fountain
  const fountainEpisode = input.episodeId ? episodes[0] : undefined;
  files.push({ path: "script.fountain", text: toFountain({ show, episode: fountainEpisode, scenes: orderedScenes, sets, characters }) });

  // shots/*.txt and storyboard-prompts.md
  const slug = uniqueSlugger();
  const storyboard: string[] = [`# Storyboard prompts: ${title}`, ""];
  let sceneNumber = 0;
  const shotFiles: { path: string; scene: string }[] = [];
  for (const episode of episodes) {
    const episodeIndex = episodes.indexOf(episode) + 1;
    let inEpisode = 0;
    for (const scene of orderedScenes.filter((s) => s.episodeId === episode.id)) {
      sceneNumber += 1;
      inEpisode += 1;
      const shots = shotsOf(scene);
      if (shots.length === 0) continue;
      const heading = plainHeading(scene, setOf(scene));
      const base = `shots/E${String(episodeIndex).padStart(2, "0")}-S${String(inEpisode).padStart(2, "0")}-${slug(scene.sceneName, "scene")}`;
      const lines = formatShotLines(shots, castNames);
      const body = [
        `${heading}`,
        `${episode.title} · ${scene.sceneName} · ${shots.length} shots · ${totalDuration(shots)} s`,
        "",
        "SHOT TABLE (paste into the scene's video prompt)",
        ...lines,
        "",
        "VIDEO PROMPTS (one per shot, if you want to render shots separately)",
        ...shotTimings(shots).map(({ shot }, i) => `[Shot ${i + 1}] ${shot.videoPrompt.trim() || "(not written)"}`),
      ].join("\n") + "\n";
      files.push({ path: `${base}.txt`, text: body });
      shotFiles.push({ path: `${base}.txt`, scene: scene.sceneName });
      storyboard.push(`## ${episode.title} · ${scene.sceneName}`, `_${heading}_`, "");
      shotTimings(shots).forEach(({ shot }, i) => storyboard.push(`${i + 1}. ${shot.storyboardPrompt.trim() || "(not written)"}`));
      storyboard.push("");
    }
  }
  files.push({ path: "storyboard-prompts.md", text: storyboard.join("\n") });

  // cast/ and environments/ with images
  const imageById = new Map(images.map((i) => [i.id, i]));
  const castSlug = uniqueSlugger();
  const envSlug = uniqueSlugger();
  const castImages = new Map<string, string[]>();
  const addImages = (folder: string, baseName: string, ids: string[] | undefined, key: string) => {
    const paths: string[] = [];
    (ids ?? []).forEach((id, index) => {
      const asset = imageById.get(id);
      const decoded = asset ? decodeDataUrl(asset.dataUrl) : null;
      if (!asset || !decoded) {
        warnings.push(`A reference image for ${key} could not be read and was skipped.`);
        return;
      }
      const path = `${folder}/${baseName}-${index + 1}.${EXTENSIONS[decoded.mime] ?? "img"}`;
      files.push({ path, bytes: decoded.bytes });
      paths.push(path);
    });
    return paths;
  };
  for (const c of cast) {
    const base = castSlug(c.name, "character");
    const paths = addImages("cast", base, c.referenceImageIds, c.name);
    castImages.set(c.id, paths);
    files.push({ path: `cast/${base}.md`, text: [`# ${c.name}`, "", characterLine(c).replace(/^- /, ""), "", paths.length ? `Reference images: ${paths.map((p) => p.split("/")[1]).join(", ")}` : "No reference images."].join("\n") + "\n" });
  }
  for (const s of environments) {
    const base = envSlug(s.name, "environment");
    const paths = addImages("environments", base, s.referenceImageIds, s.name);
    files.push({ path: `environments/${base}.md`, text: [`# ${s.name}`, "", environmentLine(s).replace(/^- /, ""), "", paths.length ? `Reference images: ${paths.map((p) => p.split("/")[1]).join(", ")}` : "No reference images."].join("\n") + "\n" });
  }

  // showwriter-project.json
  const json = {
    schema: BRIDGE_SCHEMA,
    exportedAt: new Date().toISOString(),
    title,
    logline: show.logline ?? "",
    genre: show.genre,
    visualStyle: show.visualStyle ?? "",
    world: show.premise,
    cast: cast.map((c) => ({
      name: c.name, role: c.role, age: c.age, gender: c.gender, description: c.visualDescription, wardrobe: c.wardrobe ?? "",
      distinctiveFeatures: (c.distinctiveFeatures ?? "").split(",").map((t) => t.trim()).filter(Boolean), voice: c.voiceDescription,
      referenceImages: castImages.get(c.id) ?? [],
    })),
    environments: environments.map((s) => ({ name: s.name, kind: s.timeOfDay, description: s.description, look: s.lookNotes ?? "" })),
    episodes: episodes.map((e) => ({
      title: e.title,
      scenes: orderedScenes.filter((s) => s.episodeId === e.id).map((scene) => ({
        name: scene.sceneName, heading: plainHeading(scene, setOf(scene)), status: scene.status ?? "draft", summary: scene.summary ?? "",
        action: scene.action, dialogue: scene.dialogue.map((d) => ({ character: characters.find((c) => c.id === d.characterId)?.name ?? "UNKNOWN", parenthetical: d.parenthetical ?? "", text: d.text })),
        shots: shotTimings(shotsOf(scene)).map(({ shot, start, end }, i) => ({
          number: i + 1, startSeconds: start, endSeconds: end, durationSeconds: shot.durationSeconds, framing: shot.framing, movement: shot.movement,
          description: shot.description, dialogue: shot.dialogue, cast: castNames(shot.castIds), storyboardPrompt: shot.storyboardPrompt, videoPrompt: shot.videoPrompt, notes: shot.notes,
        })),
      })),
    })),
  };
  files.push({ path: "showwriter-project.json", text: JSON.stringify(json, null, 2) + "\n" });

  files.unshift({ path: "README.txt", text: readme(title, shotFiles.length, cast.length, warnings) });
  return { files, warnings };
}

function readme(title: string, shotFileCount: number, castCount: number, warnings: string[]): string {
  return [
    `Showwriter → Mago Studio package: ${title}`,
    "",
    "Showwriter wrote the words. Mago Studio makes the pictures. Mago has no import button for scripts, so",
    "this package is meant to be pasted and attached by hand:",
    "",
    "1. In Mago Studio, create a Mago Director project (Script Project).",
    "2. Paste the whole of director-script.txt into the script box. It starts with the visual style, the",
    "   cast and the environments, then the script with standard scene headings, which is what Mago's",
    "   casting reads.",
    castCount ? `3. When casting, attach the images in cast/ and environments/ as references (${castCount} characters).` : "3. Add reference images in Mago if you have them.",
    shotFileCount ? `4. For each scene, paste the lines under "SHOT TABLE" from the matching file in shots/ into the scene's video prompt (${shotFileCount} scenes have shot lists). The [Shot n] (start-end s) format matches Mago's shot table.` : "4. No shot lists were written, so Mago will plan the shots itself.",
    "5. storyboard-prompts.md has the written storyboard direction for each shot.",
    "",
    "script.fountain is the same script for Final Draft, Highland, Fade In and other screenwriting tools.",
    "showwriter-project.json holds everything in a structured form (schema showwriter-mago-bridge v1).",
    "",
    "Mago Studio is licensed AGPL-3.0-only. This package is your own writing and shares no Mago code.",
    ...(warnings.length ? ["", "Things to look at before you export:", ...warnings.map((w) => `- ${w}`)] : []),
    "",
  ].join("\n");
}

/** Zips the package. Text files are UTF-8; images are stored as-is. */
export function zipPackage(pkg: BridgePackage): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of pkg.files) entries[file.path] = file.bytes ?? strToU8(file.text ?? "");
  return zipSync(entries, { level: 6 });
}

export const packageFileName = (title: string): string => `${slugify(title, "showwriter")}-mago-package.zip`;
