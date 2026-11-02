import type { CharacterEntity, EpisodeEntity, ImageAsset, SceneEntity, SetEntity, ShotEntity, ShowMeta } from "../src/types";

const t = 1;
export const show: ShowMeta = { id: "show1", title: "Couch Pirates", genre: "Surreal comedy", premise: "A public-access couch show on a pirate ship.", logline: "Two pirates host a talk show nobody asked for.", visualStyle: "Grainy 1990s public access video, warm tungsten light", createdAt: t, updatedAt: t };
export const episode: EpisodeEntity = { id: "ep1", showId: "show1", title: "Pilot", order: 1, createdAt: t, updatedAt: t };
export const rooftop: SetEntity = { id: "set1", showId: "show1", name: "Crow's Nest", timeOfDay: "Exterior", description: "A tiny wooden lookout above the sails", lookNotes: "Blue moonlight, wind noise", referenceImageIds: ["img_env"], createdAt: t, updatedAt: t };
export const galley: SetEntity = { id: "set2", showId: "show1", name: "Galley", timeOfDay: "Interior night", description: "A cramped kitchen with hanging pots", createdAt: t, updatedAt: t };
export const al: CharacterEntity = { id: "chr1", showId: "show1", name: "Al", role: "Protagonist", age: "50", gender: "male", visualDescription: "A weathered pirate in a red velvet coat", voiceDescription: "gravelly baritone", wardrobe: "Red coat, one boot", distinctiveFeatures: "eyepatch, gold tooth", referenceImageIds: ["img_al"], createdAt: t, updatedAt: t };
export const sloppy: CharacterEntity = { id: "chr2", showId: "show1", name: "Sloppy", role: "Supporting", age: "30", gender: "female", visualDescription: "", voiceDescription: "", createdAt: t, updatedAt: t };
export const scene1: SceneEntity = { id: "scn1", episodeId: "ep1", sceneName: "Opening", order: 1, targetSetId: "set1", activeCharacterIds: ["chr1"], action: "Al climbs the mast.\n\nThe wind howls.", dialogue: [{ id: "d1", characterId: "chr1", text: "Welcome back, folks.", parenthetical: "to camera" }], sceneNotes: "Keep it deadpan", status: "draft", createdAt: t, updatedAt: t };
export const scene2: SceneEntity = { id: "scn2", episodeId: "ep1", sceneName: "Kitchen chat", order: 2, targetSetId: null, activeCharacterIds: [], action: "#hashtag stays action. @Annabel waves.", dialogue: [{ id: "d2", characterId: "chr2", text: "Is this thing on?" }], sceneNotes: "", createdAt: t, updatedAt: t };
export const shot1: ShotEntity = { id: "sh1", sceneId: "scn1", order: 1, durationSeconds: 4, framing: "Wide", movement: "Slow push-in", description: "Al on the mast at dusk", dialogue: "", castIds: ["chr1"], storyboardPrompt: "Marker sketch of a tiny man on a tall mast", videoPrompt: "Wide shot, Al climbing", notes: "", createdAt: t, updatedAt: t };
export const shot2: ShotEntity = { id: "sh2", sceneId: "scn1", order: 2, durationSeconds: 2.5, framing: "Close-up", movement: "Static", description: "Al's face, \"grinning\"", dialogue: "Welcome back, folks.", castIds: ["chr1"], storyboardPrompt: "", videoPrompt: "", notes: "", createdAt: t, updatedAt: t };
// 1x1 transparent PNG
export const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const images: ImageAsset[] = [
  { id: "img_al", showId: "show1", name: "al.png", mime: "image/png", dataUrl: PNG_DATA_URL, createdAt: t },
  { id: "img_env", showId: "show1", name: "nest.png", mime: "image/png", dataUrl: PNG_DATA_URL, createdAt: t },
];
