// types.ts — Core data model for Showrunner / Seedance Studio

export type CharacterRole = "Protagonist" | "Antagonist" | "Supporting";

export interface ShowMeta {
  id: string;
  title: string;
  genre: string;
  premise: string; // world rules, lore, visual style, glitch/broadcast aesthetics
  logline?: string; // one-sentence pitch
  visualStyle?: string; // shared look handed to the video tool (mirrors Mago's "visual style")
  createdAt: number;
  updatedAt: number;
}

export interface SetEntity {
  id: string;
  showId: string;
  name: string; // exact name used for #TagName calls
  timeOfDay: string; // "Interior" | "Exterior" | "Night" | "Liminal" | free text
  description: string; // physical traits, props, textures, ambient audio
  lookNotes?: string; // lighting, palette, lens feel
  referenceImageIds?: string[]; // ImageAsset ids
  createdAt: number;
  updatedAt: number;
}

export interface CharacterEntity {
  id: string;
  showId: string;
  name: string; // exact name used for @CharacterName calls
  role: CharacterRole;
  age: string; // number or free text ("62yo", "ageless")
  gender: string;
  visualDescription: string; // physical form, material, clothing, visual quirks
  voiceDescription: string; // timbre, dialect, cadence, audio processing/distortion traits
  wardrobe?: string; // what they wear, per default look
  distinctiveFeatures?: string; // comma-separated recognisable traits (scars, glasses, gait)
  referenceImageIds?: string[]; // ImageAsset ids
  createdAt: number;
  updatedAt: number;
}

export interface DialogueLine {
  id: string;
  characterId: string;
  text: string;
  parenthetical?: string;
}

export type SceneStatus = "idea" | "draft" | "revised" | "locked";
export type IntExt = "INT" | "EXT" | "INT/EXT";

export interface SceneEntity {
  id: string;
  episodeId: string;
  sceneName: string;
  order: number;
  targetSetId: string | null; // links to Set catalog
  activeCharacterIds: string[]; // links to Character catalog
  action: string; // cinematic verbs, stage movement, camera instructions
  dialogue: DialogueLine[];
  sceneNotes: string;
  status?: SceneStatus; // writing progress; "locked" scenes are protected from AI rewrites
  intExt?: IntExt; // screenplay heading parts
  timeOfDayTag?: string; // "DAY", "NIGHT", "DAWN"...
  summary?: string; // one-line card text on the beat board
  createdAt: number;
  updatedAt: number;
}

/** One slot on an episode's beat board; may be linked to the scene that delivers it. */
export interface BeatEntity {
  id: string;
  episodeId: string;
  order: number;
  label: string; // template slot, e.g. "Catalyst"
  text: string;
  sceneId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A saved copy of a scene's writing, for history and restore. */
export interface SceneSnapshot {
  sceneName: string;
  action: string;
  dialogue: DialogueLine[];
  sceneNotes: string;
  targetSetId: string | null;
  activeCharacterIds: string[];
  status?: SceneStatus;
  intExt?: IntExt;
  timeOfDayTag?: string;
  summary?: string;
}

export interface RevisionEntity {
  id: string;
  sceneId: string;
  label: string;
  auto: boolean; // true for the safety copy taken before a restore
  createdAt: number;
  snapshot: SceneSnapshot;
}

/** One row of a scene's shot table. Written here, rendered in Mago Studio. */
export interface ShotEntity {
  id: string;
  sceneId: string;
  order: number;
  durationSeconds: number;
  framing: string; // "Wide", "Medium close-up"...
  movement: string; // "Static", "Slow push-in"...
  description: string; // what the camera sees
  dialogue: string; // spoken text in this shot, if any
  castIds: string[];
  storyboardPrompt: string; // words for the storyboard sketch
  videoPrompt: string; // words for the video generator
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/** A reference image, stored as a (downscaled) data URL so projects stay portable JSON. */
export interface ImageAsset {
  id: string;
  showId: string;
  name: string;
  mime: string;
  dataUrl: string;
  createdAt: number;
}

export interface EpisodeEntity {
  id: string;
  showId: string;
  title: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

// --- Export engine types ---

export type TransitionType =
  | "hard_cut"
  | "cut_to_black"
  | "dissolve"
  | "whip_pan"
  | "match_cut"
  | "push_through";

/** An explicit written-out cut between two takes. afterTake/toTake are take numbers. */
export interface TakeTransition {
  afterTake: number;
  toTake: number;
  type: TransitionType;
  nextCastNames: string[];
  nextSetName: string | null;
}

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "21:9";

export interface SeedanceShotBlock {
  shotNumber: number;
  takeNumber: number; // a "take" = 1 regular generation + up to 3 locked-cast extensions
  segmentIndex: number; // 0 = regular generation, 1-3 = extension
  generationType: "regular" | "extension";
  durationSeconds: number; // fixed 15s per Seedance's per-generation cap
  aspect: AspectRatio;
  tags: string; // "@Char1 @Char2 #SetName"
  characterDnaRefs: string[]; // ["DNA_CUSTARD_CURATOR", ...]
  castNames: string[]; // locked cast for this take (max 3)
  setName: string | null;
  surroundings: string; // visual atmosphere/surroundings for THIS generation — restated every shot since each 15s call is a standalone gen
  subjectMotion: string;
  cameraMotion: string;
  beats: string[];
  audio: {
    speech: { characterName: string; line: string }[];
    ambient: string;
    sfx: string;
    voiceProfiles: { characterName: string; voiceDescription: string }[];
  };
}

export interface SeedanceCastWarning {
  takeNumber: number;
  excludedNames: string[];
}

export interface SeedanceExportPayload {
  sceneId: string;
  sceneName: string;
  aspect: AspectRatio;
  fps: number;
  totalShots: number;
  totalTakes: number;
  characterDna: Record<string, string>; // DNA_KEY -> description
  shots: SeedanceShotBlock[];
  castWarnings: SeedanceCastWarning[];
  pacingWarnings: ShowrunnerPacingWarning[];
  takeTransitions: TakeTransition[];
}

export interface ShowrunnerClip {
  takeNumber: number; // 1-based — a "take" is a locked-cast chain of up to 4 segments
  segmentIndex: number; // 0 = the regular (first) generation, 1-3 = extensions
  generationType: "regular" | "extension";
  tagLine: string; // "@Character1 @Character2 #SetName"
  shotFraming: string; // "Wide shot:" | "Extreme close-up:" | "Push-in:" etc.
  description: string;
  dialogue: { characterName: string; text: string; parenthetical?: string }[];
  durationSeconds: number; // fixed 15s per Showrunner/Seedance clip limit
  castNames: string[]; // locked cast for this take (max 3)
  setName: string | null;
  surroundings: string; // visual atmosphere/surroundings for THIS generation — restated every clip since each 15s call is a standalone gen
}

export interface ShowrunnerCastWarning {
  takeNumber: number;
  excludedNames: string[];
}

/** A clip whose dialogue exceeds what can naturally be spoken in 15 seconds. */
export interface ShowrunnerPacingWarning {
  takeNumber: number;
  segmentIndex: number;
  wordCount: number;
  maxWords: number;
}

export interface ShowrunnerFormatResult {
  sceneId: string;
  sceneName: string;
  clips: ShowrunnerClip[];
  dialogueBlocks: { characterName: string; text: string; parenthetical?: string }[];
  castWarnings: ShowrunnerCastWarning[];
  pacingWarnings: ShowrunnerPacingWarning[];
  takeTransitions: TakeTransition[];
}
