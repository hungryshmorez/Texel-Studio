/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: constructor parameter property written out (the build forbids non-erasable syntax).
 * See LICENSE and NOTICE.md at the repository root.
 */
/* oxlint-disable eslint/no-magic-numbers -- the caps, word bounds and engine tables are the backend's, ported verbatim so the two can be diffed */
import { speechSeconds, textOf } from "../vlm/dialogue";
import { ADAPT_PROMPT_I2V_INSTRUCTION } from "../vlm/prompts/adaptPromptI2vMinimaxH3";
import {
  SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CHUNK,
  SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CUT,
  SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_PIN
} from "../shots/sequentialContinuation";
import {
  applyStoryboardLines,
  storyboardRetention
} from "../storyboards/composer";

import {
  applyDialogue,
  dialogueBrief,
  dialogueFailures,
  type DialogueTurn,
  normalizeDialogue,
  type SubjectLabelFor
} from "./dialogueCompose";
import { pyFloat, pyJsonDumps, pySplitLines } from "./pythonText";
import {
  type Continuation,
  CONTINUATION_CUT,
  CONTINUATION_PIN,
  CONTINUATIONS,
  CROSS_SHOT_VIDEO_REF_ID
} from "./videoPromptPayload";
import { VIDEO_PROMPT_TEMPLATE } from "./videoPromptTemplate.generated";

/**
 * Shot data -> MiniMax H3 full-reference prompt document: the backend's composer, with Gemini replaced by the caller's model call.
 *
 * The split is the backend's: code owns reference order, tag numbering,
 * task types, retention markers, timing and the format; the model writes
 * prose against `{{kind:ref_id}}` placeholders and never a number, and
 * `bindPlaceholders` assigns the numbers afterwards. A model that fails
 * (or is rejected twice) degrades to the deterministic skeleton, so a valid
 * shot always gets a usable document.
 */

type JsonRecord = Record<string, unknown>;

export const SECTION_ORDER = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "overall_soundscape",
  "non_diegetic_music"
] as const;
export type Sections = Record<(typeof SECTION_ORDER)[number], string>;

const ALLOWED_TASK_TYPES = [
  "keyframe completion",
  "reference generation",
  "video editing",
  "video continuation",
  "audio reuse",
  "audio reference"
];
const VISIBLE_RETENTION_MARKERS = [
  "fully_preserved",
  "partially_preserved",
  "attribute_transfer",
  "weak_reference"
];
const AUDIO_RETENTION_MARKERS = [
  "fully_copy",
  "partially_copy",
  "reference",
  "weak_reference"
];
const REFERENCE_CAPS: Record<string, number> = { image: 9, video: 3, audio: 3 };
const SUPPORTED_REFERENCE_KINDS = ["image", "video", "audio"];
const REFERENCE_TYPE_ALIASES: Record<string, string> = {
  image: "image",
  reference_image: "image",
  reference_frame: "image",
  video: "video",
  reference_video: "video",
  audio: "audio",
  reference_audio: "audio"
};
const RENDERER_REFERENCE_TYPES: Record<string, string> = {
  image: "reference_frame",
  video: "reference_video",
  audio: "reference_audio"
};
const SOURCES_KEY_BY_KIND: Record<string, string> = {
  image: "images",
  video: "videos",
  audio: "audios"
};

const REF_ID_CHARS = "A-Za-z0-9_.:-";
const PLACEHOLDER_SOURCE = `\\{\\{(ref|subject|video|audio):([${REF_ID_CHARS}]+)\\}\\}`;
const placeholderRe = () => new RegExp(PLACEHOLDER_SOURCE, "g");
const LINE_PLACEHOLDER_RE = /\{\{line:(\d+)\}\}/g;
const MAX_DIALOGUE_TURNS = 20;
const MAX_DIALOGUE_CHARACTERS = 1200;
const MINIMAX_TRAINED_MAX_SECONDS = 15.04;
const UNADDRESSABLE_REF_ID_RE = new RegExp(`[^${REF_ID_CHARS}]+`, "g");
const NUMBERED_TAG_RE = /<\s*(?:Picture|Video|Audio|Subject)\s+\d+\s*>/gi;
const SPEAKER_ID_RE = /\(S\d/;
const ENTRY_PER_LINE_SECTIONS = new Set([
  "subject_definitions",
  "retention_analysis"
]);
const ENTRY_BOUNDARY_RE =
  /(?<=[.!?])[ \t]*(?=(?:\{\{(?:ref|subject|video|audio):|<[ \t]*(?:Picture|Video|Audio|Subject)[ \t]))/g;
const RUN_TOGETHER_RE = /(?<=[a-z0-9][.!?,])(?=[A-Z{<])/g;
const DETAILED_DESCRIPTION_MIN_WORDS = 350;
const DETAILED_DESCRIPTION_MAX_WORDS = 500;
const DEFAULT_ASPECT_RATIO = "16:9";
export const MAX_CHARACTERS = 12;
export const MAX_PROPS = 20;
const FPS = 24;

/**
 * The engine whose tag forms and duration rules apply. `v9.1.0` and
 * `minimax_h3_max` are the backend's; the local ComfyUI H3 workflow reads the
 * canonical `<Picture n>` tags and takes a shot's own length (5-15 s) as is.
 */
export const LOCAL_VIDEO_PROMPT_ENGINE = "minimax_h3_local";
const REFERENCE_TAG_FORMATS: Record<string, Record<string, string>> = {
  "v9.1.0": {
    image: "<Picture {n}>",
    video: "<Video {n}>",
    audio: "<Audio {n}>"
  },
  minimax_h3_max: { image: "Image {n}", video: "Video {n}" },
  [LOCAL_VIDEO_PROMPT_ENGINE]: {
    image: "<Picture {n}>",
    video: "<Video {n}>",
    audio: "<Audio {n}>"
  }
};
const CANONICAL_REFERENCE_TAG_ENGINE = "v9.1.0";
const DURATION_BOUNDS: Record<string, [number, number]> = {
  seedance_2_5: [4, 15],
  minimax_h3_max: [5, 15],
  [LOCAL_VIDEO_PROMPT_ENGINE]: [5, 15]
};
/** Engines that take a whole-second duration (the integrations worker's rounding). */
const WHOLE_SECOND_ENGINES = new Set(["seedance_2_5", "minimax_h3_max"]);

/** A request the backend answers with a 4xx. */
export class VideoPromptError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
const BAD_REQUEST = 400;
const UNPROCESSABLE = 422;

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** `str(value).strip() if value not in (None, "") else ""`, for JSON scalars. */
const cleanStr = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "True" : "False";
  return textOf(value).trim();
};

/** Python's `len`: a surrogate pair is one character. */
const codePointLength = (text: string): number => Array.from(text).length;

export const asSentence = (text: unknown): string => {
  const value = textOf(text).trim();
  if (!value) return "";
  const capitalised = value[0]!.toUpperCase() + value.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
};

const asList = (value: unknown): unknown[] | null =>
  value === null || value === undefined || value === ""
    ? []
    : Array.isArray(value)
      ? value
      : null;

const referenceTag = (engine: string, kind: string, index: number): string => {
  const formats =
    REFERENCE_TAG_FORMATS[engine] ??
    REFERENCE_TAG_FORMATS[CANONICAL_REFERENCE_TAG_ENGINE]!;
  const format = formats[kind];
  if (!format) throw new Error(`${engine} takes no ${kind} references`);
  return format.replace("{n}", String(index));
};

// ---------------------------------------------------------------------------
// Validated payload

export interface CleanReference {
  panel_count?: number | null;
  voice_of?: null;
  kind: string;
  asset_id: string;
  ref_id: string | null;
  description: string;
  members: string[];
  source?: string | null;
  continuation?: Continuation | null;
}

export interface CleanPayload {
  shot: {
    description: string;
    duration_s: number | null;
    aspect_ratio: string | null;
    camera: string;
    style: string;
    dialogue: unknown[];
    audio: unknown;
  };
  characters: JsonRecord[];
  environment: JsonRecord;
  props: unknown[];
  references: CleanReference[];
  task_types: string[];
  retention: Record<string, string>;
}

const fail = (message: string, status = BAD_REQUEST): never => {
  throw new VideoPromptError(message, status);
};

/** Throws VideoPromptError. */
export const validateShotPayload = (payload: JsonRecord): CleanPayload => {
  const shot = payload.shot;
  if (!isRecord(shot)) fail("shot must be an object");
  const shotRecord = shot as JsonRecord;
  const description = cleanStr(shotRecord.description);
  if (!description) fail("shot.description is required");

  let durationS: number | null = null;
  const rawDuration = shotRecord.duration_s;
  if (rawDuration !== null && rawDuration !== undefined && rawDuration !== "") {
    const parsed =
      typeof rawDuration === "number"
        ? rawDuration
        : typeof rawDuration === "boolean"
          ? Number(rawDuration)
          : typeof rawDuration === "string" && rawDuration.trim()
            ? Number(rawDuration)
            : Number.NaN;
    if (Number.isNaN(parsed)) fail("shot.duration_s must be a number");
    if (parsed <= 0 || !Number.isFinite(parsed))
      fail("shot.duration_s must be greater than 0");
    durationS = parsed;
  }

  const characters = asList(payload.characters);
  if (characters === null) fail("characters must be a list");
  if (characters!.length > MAX_CHARACTERS)
    fail(
      `too many characters: ${characters!.length} (max ${MAX_CHARACTERS})`,
      UNPROCESSABLE
    );
  characters!.forEach((character, index) => {
    if (!isRecord(character)) fail(`characters[${index}] must be an object`);
    if (!cleanStr((character as JsonRecord).id))
      fail(`characters[${index}].id is required`);
  });

  const props = asList(payload.props);
  if (props === null) fail("props must be a list");
  if (props!.length > MAX_PROPS)
    fail(`too many props: ${props!.length} (max ${MAX_PROPS})`, UNPROCESSABLE);

  let environment = payload.environment;
  if (environment === null || environment === undefined || environment === "")
    environment = {};
  if (!isRecord(environment)) fail("environment must be an object");

  const references = asList(payload.references);
  if (references === null) fail("references must be a list");
  const cleanReferences: CleanReference[] = references!.map((entry, index) => {
    if (!isRecord(entry)) fail(`references[${index}] must be an object`);
    const record = entry as JsonRecord;
    const kind =
      REFERENCE_TYPE_ALIASES[
        cleanStr(record.kind || record.type).toLowerCase()
      ];
    if (!kind)
      fail(
        `references[${index}].kind must be one of ${Object.keys(REFERENCE_CAPS).join(", ")}`
      );
    if (!SUPPORTED_REFERENCE_KINDS.includes(kind!))
      fail(
        `${kind} references are not supported yet (supported: ${SUPPORTED_REFERENCE_KINDS.join(", ")})`,
        UNPROCESSABLE
      );
    const assetId = cleanStr(record.asset_id);
    if (!assetId) fail(`references[${index}].asset_id is required`);
    const members = record.members;
    if (members !== null && members !== undefined && !Array.isArray(members))
      fail(`references[${index}].members must be a list`);
    return {
      kind: kind!,
      asset_id: assetId,
      ref_id: cleanStr(record.ref_id) || null,
      description: cleanStr(record.description || record.note),
      members: ((members as unknown[] | undefined) ?? [])
        .map(cleanStr)
        .filter(Boolean),
      source: cleanStr(record.source) || null,
      continuation:
        kind === "image" &&
        (CONTINUATIONS as readonly unknown[]).includes(record.continuation)
          ? (record.continuation as Continuation)
          : null,
      voice_of: null,
      panel_count: Number.isInteger(record.panel_count)
        ? Number(record.panel_count)
        : null
    };
  });

  const taskTypes = asList(payload.task_types);
  if (taskTypes === null) fail("task_types must be a list");
  for (const taskType of taskTypes!)
    if (!ALLOWED_TASK_TYPES.includes(cleanStr(taskType)))
      fail(
        `invalid task type '${textOf(taskType)}'. Allowed: ${ALLOWED_TASK_TYPES.join(", ")}`,
        UNPROCESSABLE
      );

  const dialogue = asList(shotRecord.dialogue);
  if (dialogue === null) fail("shot.dialogue must be a list");
  dialogue!.forEach((turn, index) => {
    if (!isRecord(turn)) fail(`shot.dialogue[${index}] must be an object`);
    if (!cleanStr((turn as JsonRecord).line))
      fail(`shot.dialogue[${index}].line is required`);
  });
  if (dialogue!.length > MAX_DIALOGUE_TURNS)
    fail(
      `too many dialogue turns: ${dialogue!.length} (max ${MAX_DIALOGUE_TURNS})`,
      UNPROCESSABLE
    );
  const spoken = dialogue!.reduce(
    (total: number, turn) =>
      total + codePointLength(cleanStr((turn as JsonRecord).line)),
    0
  );
  if (spoken > MAX_DIALOGUE_CHARACTERS)
    fail(
      `too much dialogue for one shot: ${spoken} characters (max ` +
        `${MAX_DIALOGUE_CHARACTERS}); split the beat across shots`,
      UNPROCESSABLE
    );

  // `payload.get("retention") or {}`: an empty list is falsy in Python too.
  const retention =
    Array.isArray(payload.retention) && !payload.retention.length
      ? {}
      : payload.retention || {};
  if (!isRecord(retention)) fail("retention must be an object keyed by label");

  return {
    shot: {
      description,
      duration_s: durationS,
      aspect_ratio: cleanStr(shotRecord.aspect_ratio) || null,
      camera: cleanStr(shotRecord.camera),
      style: cleanStr(shotRecord.style),
      dialogue: dialogue!,
      audio: shotRecord.audio || {}
    },
    characters: characters as JsonRecord[],
    environment: environment as JsonRecord,
    props: props!,
    references: cleanReferences,
    task_types: taskTypes!.map(cleanStr),
    retention: Object.fromEntries(
      Object.entries(retention as JsonRecord).map(([key, value]) => [
        key,
        cleanStr(value)
      ])
    )
  };
};

const addressableRefId = (value: string): string =>
  value.replace(UNADDRESSABLE_REF_ID_RE, "_").replace(/^_+|_+$/g, "");

/** Normalizes the reference ids on `clean` in place and returns the warnings. */
export const normalizeRefIds = (clean: CleanPayload): string[] => {
  const warnings: string[] = [];
  const addressable = (value: string, what: string): string => {
    const fixed = addressableRefId(value);
    if (fixed !== value)
      warnings.push(
        fixed
          ? `${what} '${value}' is not addressable by a placeholder; using '${fixed}'`
          : `${what} '${value}' holds no character a placeholder can address`
      );
    return fixed;
  };
  clean.references = clean.references.map((entry) => {
    let next = entry;
    if (next.ref_id)
      next = { ...next, ref_id: addressable(next.ref_id, "ref_id") || null };
    if (next.members.length)
      next = {
        ...next,
        members: next.members
          .map((member) => addressable(member, "member"))
          .filter(Boolean)
      };
    return next;
  });
  clean.characters = clean.characters.map((character, index) => {
    const refId = addressable(
      cleanStr(character.id),
      `characters[${index}].id`
    );
    if (!refId) fail(`characters[${index}].id is not usable as a reference id`);
    return { ...character, id: refId };
  });
  const environmentId = cleanStr(clean.environment.id);
  if (environmentId)
    clean.environment = {
      ...clean.environment,
      id: addressable(environmentId, "environment.id")
    };
  clean.props = clean.props.map((prop, index) => {
    if (!isRecord(prop)) return prop;
    const suppliedId = cleanStr(prop.id);
    const name = cleanStr(prop.name);
    if (suppliedId)
      return { ...prop, id: addressable(suppliedId, `props[${index}].id`) };
    if (name) return { ...prop, id: addressableRefId(name) };
    return prop;
  });
  return warnings;
};

const dedupeByAsset = (references: CleanReference[]): CleanReference[] => {
  const taken = new Set(
    references.map((entry) => cleanStr(entry.ref_id)).filter(Boolean)
  );
  const seen = new Set<string>();
  const deduped: CleanReference[] = [];
  for (const original of references) {
    if (seen.has(original.asset_id)) continue;
    seen.add(original.asset_id);
    const entry = { ...original };
    if (!entry.ref_id) {
      let n = deduped.length + 1;
      while (taken.has(`${entry.kind}_${n}`)) n += 1;
      entry.ref_id = `${entry.kind}_${n}`;
      taken.add(entry.ref_id);
    }
    deduped.push(entry);
  }
  return deduped;
};

/** The supplied list deduped, or one derived from sheet ids. */
export const referenceList = (clean: CleanPayload): CleanReference[] => {
  if (clean.references.length) return dedupeByAsset(clean.references);
  const derived: CleanReference[] = [];
  const add = (assetId: string, refId: string, description: unknown) =>
    derived.push({
      kind: "image",
      asset_id: assetId,
      ref_id: refId,
      description: cleanStr(description),
      members: []
    });
  for (const character of clean.characters) {
    const assetId = cleanStr(character.sheet_asset_id);
    if (assetId) add(assetId, cleanStr(character.id), character.description);
  }
  const environmentAsset = cleanStr(clean.environment.sheet_asset_id);
  if (environmentAsset)
    add(
      environmentAsset,
      cleanStr(clean.environment.id) || "environment",
      clean.environment.description
    );
  clean.props.forEach((prop, index) => {
    if (!isRecord(prop)) return;
    const assetId = cleanStr(prop.sheet_asset_id);
    if (assetId)
      add(assetId, cleanStr(prop.id) || `prop_${index + 1}`, prop.description);
  });
  return dedupeByAsset(derived);
};

const checkReferences = (references: CleanReference[]): void => {
  const counts = new Map<string, number>();
  for (const entry of references)
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  for (const [kind, count] of counts) {
    const cap = REFERENCE_CAPS[kind]!;
    if (count > cap)
      fail(`too many ${kind} references: ${count} (max ${cap})`, UNPROCESSABLE);
  }
  const seen = new Set<string>();
  for (const entry of references) {
    if (!entry.ref_id) continue;
    if (seen.has(entry.ref_id))
      fail(
        `duplicate ref_id '${entry.ref_id}': each reference needs a distinct ref_id to be addressable`,
        UNPROCESSABLE
      );
    seen.add(entry.ref_id);
  }
};

export interface Label {
  label: string;
  kind: string;
  ref_id: string | null;
  asset_id?: string;
  description?: string;
  slot?: string;
  name?: string;
  replaces?: string;
  anchored_to?: string | null;
  character_sheet?: boolean;
  panel_count?: number;
  continuation?: Continuation | null;
}

/** Per-kind tags in list order, then a subject per character. */
export const assignLabels = (
  clean: CleanPayload,
  references: CleanReference[],
  engineVersion: string = CANONICAL_REFERENCE_TAG_ENGINE
): [Label[], string[]] => {
  const warnings: string[] = [];
  const labels: Label[] = [];
  const slotByKind: Record<string, string> = {
    image: "ref_image",
    video: "ref_video",
    audio: "ref_audio"
  };
  const perKind = new Map<string, number>();
  const refIdToLabel = new Map<string, string>();
  for (const entry of references) {
    const kind = entry.kind || "image";
    const index = perKind.get(kind) ?? 0;
    perKind.set(kind, index + 1);
    let label: string;
    try {
      label = referenceTag(engineVersion, kind, index + 1);
    } catch {
      label = referenceTag(CANONICAL_REFERENCE_TAG_ENGINE, kind, index + 1);
      warnings.push(
        `${engineVersion} takes no ${kind} references; kept ${label}`
      );
    }
    labels.push({
      label,
      kind,
      asset_id: entry.asset_id,
      ref_id: entry.ref_id,
      description: entry.description ?? "",
      slot: `${slotByKind[kind] ?? "ref_image"}_${index}`,
      character_sheet:
        kind === "image" &&
        !entry.members.length &&
        entry.source !== "upload" &&
        !entry.continuation,
      ...(entry.panel_count ? { panel_count: entry.panel_count } : {}),
      continuation: entry.continuation ?? null
    });
    if (entry.ref_id && !refIdToLabel.has(entry.ref_id))
      refIdToLabel.set(entry.ref_id, label);
    for (const member of entry.members)
      if (!refIdToLabel.has(member)) refIdToLabel.set(member, label);
  }
  clean.characters.forEach((character, index) => {
    const refId = cleanStr(character.id);
    const anchoredTo = refIdToLabel.get(refId) ?? null;
    if (!anchoredTo)
      warnings.push(
        `character '${refId}' has no image reference; its subject is defined by text alone`
      );
    labels.push({
      label: `<Subject ${index + 1}>`,
      kind: "subject",
      ref_id: refId,
      name: cleanStr(character.name),
      description: cleanStr(character.description),
      replaces: cleanStr(character.replaces),
      anchored_to: anchoredTo
    });
  });
  return [labels, warnings];
};

export interface Timing {
  requested_duration_s: number | null;
  effective_duration_s: number | null;
  frames: number | null;
  fps: number;
  aspect_ratio?: string;
  speech_s?: number;
}

const pythonRound = (value: number): number => {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
};

/** For the bounded engines. */
export const resolveTiming = (
  clean: CleanPayload,
  references: CleanReference[],
  engineVersion: string,
  turns: DialogueTurn[] = []
): [Timing, string[]] => {
  const warnings: string[] = [];
  const durationS = clean.shot.duration_s;
  const timing: Timing = {
    requested_duration_s: durationS,
    effective_duration_s: null,
    frames: null,
    fps: FPS
  };
  if (durationS === null) {
    warnings.push(
      "shot.duration_s was not supplied: the prompt states no duration, and a " +
        `${engineVersion} render requires duration_s or frame_range`
    );
  } else if (DURATION_BOUNDS[engineVersion]) {
    const [minSeconds, maxSeconds] = DURATION_BOUNDS[engineVersion]!;
    if (!(minSeconds <= durationS && durationS <= maxSeconds))
      fail(
        `${engineVersion} renders ${minSeconds}-${maxSeconds}s; got ${pyFloat(durationS)}s`,
        UNPROCESSABLE
      );
    if (WHOLE_SECOND_ENGINES.has(engineVersion)) {
      timing.frames = pythonRound(pythonRound(durationS) * FPS);
      timing.effective_duration_s = pythonRound(durationS);
      if (Math.abs(timing.effective_duration_s - durationS) > 0.01)
        warnings.push(
          `duration rounded ${pyFloat(durationS)}s -> ${pyFloat(timing.effective_duration_s)}s: ` +
            `${engineVersion} renders whole seconds`
        );
    } else {
      // Local H3 renders the shot's own length, with no grid to snap onto.
      timing.frames = pythonRound(durationS * FPS);
      timing.effective_duration_s = durationS;
    }
  } else {
    fail(
      `${engineVersion} has no frame grid in the local composer`,
      UNPROCESSABLE
    );
  }

  const requestedAspect = clean.shot.aspect_ratio;
  const aspect = requestedAspect || DEFAULT_ASPECT_RATIO;
  if (requestedAspect && references.length)
    warnings.push(
      `aspect_ratio '${requestedAspect}' is stated in the prompt only; the render's frame ` +
        "comes from its width/height or the project canvas, and without either the engine " +
        "falls back to the first reference's aspect"
    );
  timing.aspect_ratio = aspect;

  const speechS = speechSeconds(turns);
  timing.speech_s = speechS;
  const effective = timing.effective_duration_s;
  if (speechS && effective && effective < speechS)
    warnings.push(
      `this shot is ${pyFloat(effective)}s but its dialogue takes about ${pyFloat(speechS)}s to say; ` +
        "the line will be cut off unless the shot is lengthened"
    );
  if (speechS && speechS > MINIMAX_TRAINED_MAX_SECONDS)
    warnings.push(
      `${pyFloat(speechS)}s of speech is past the engine's ${MINIMAX_TRAINED_MAX_SECONDS}s ` +
        "trained envelope; lengthening the shot that far drifts in quality — split " +
        "the beat across shots instead"
    );
  return [timing, warnings];
};

export const inferTaskTypes = (clean: CleanPayload): string[] => {
  if (clean.task_types.length) return [...new Set(clean.task_types)];
  if (clean.references.some((reference) => reference.kind === "video"))
    return ["video continuation"];
  if (
    clean.references.some(
      (reference) => reference.continuation === CONTINUATION_PIN
    )
  )
    return ["reference generation", "keyframe completion"];
  return ["reference generation"];
};

/** `CONTINUATION_RETENTION`: the marker each continuation's frame defaults to. */
export const CONTINUATION_RETENTION: Record<Continuation, string> = {
  [CONTINUATION_CUT]: "partially_preserved",
  [CONTINUATION_PIN]: "fully_preserved"
};
/** `PINNED_CAMERA`: a pinned shot's camera, replacing its own. */
export const PINNED_CAMERA =
  "locked off, holding the opening frame's framing, angle, height and lens for " +
  "the whole clip";
const NOTHING_RESTARTS =
  "Nothing restarts: nobody enters, leaves, stands up or sits down again " +
  "unless the action below says so.";

export const inferRetention = (
  clean: CleanPayload,
  labels: Label[]
): Record<string, string> => {
  const retention: Record<string, string> = {};
  for (const label of labels) {
    if (label.continuation)
      retention[label.label] = CONTINUATION_RETENTION[label.continuation];
    else if (label.kind === "image" || label.kind === "video")
      retention[label.label] = "weak_reference";
    else if (label.kind === "subject")
      retention[label.label] = label.replaces
        ? "attribute_transfer"
        : "weak_reference";
    else if (label.kind === "audio" || label.kind === "video_audio")
      retention[label.label] = "partially_copy";
    else retention[label.label] = "fully_preserved";
  }
  const known = new Map(labels.map((label) => [label.label, label.kind]));
  for (const [label, marker] of Object.entries(clean.retention)) {
    const kind = known.get(label);
    if (kind === undefined)
      fail(`retention refers to unknown label '${label}'`, UNPROCESSABLE);
    const allowed =
      kind === "audio" || kind === "video_audio"
        ? AUDIO_RETENTION_MARKERS
        : VISIBLE_RETENTION_MARKERS;
    if (!allowed.includes(marker))
      fail(
        `invalid retention marker '${marker}' for ${label}. Allowed: ${allowed.join(", ")}`,
        UNPROCESSABLE
      );
    retention[label] = marker;
  }
  return { ...retention, ...storyboardRetention(labels) };
};

const placeholder = (kind: string, refId: string) => `{{${kind}:${refId}}}`;
const placeholderKind = (labelKind: string) =>
  ({ subject: "subject", video: "video", audio: "audio" })[labelKind] ?? "ref";
const labelPlaceholder = (label: Label): string =>
  label.ref_id
    ? placeholder(placeholderKind(label.kind), label.ref_id)
    : label.label;

export const resolveDialogue = (
  clean: CleanPayload
): [DialogueTurn[], string[]] =>
  normalizeDialogue(
    clean.shot.dialogue,
    clean.characters.map((character) => cleanStr(character.id)).filter(Boolean)
  );

const subjectLabelFor = (labels: Label[]): SubjectLabelFor => {
  const byRef = new Map(
    labels
      .filter((label) => label.kind === "subject" && label.ref_id)
      .map((label) => [label.ref_id!, labelPlaceholder(label)])
  );
  return (refId) => byRef.get(refId);
};

/** The skeleton's look and camera when the shot states none. */
const DEFAULT_LOOK =
  "live-action photographic look with natural grain and a neutral grade";
const DEFAULT_CAMERA = "steady framing with no added camera movement";

/** The six sections from structured data alone. */
export const buildSkeleton = (
  clean: CleanPayload,
  labels: Label[],
  taskTypes: string[],
  retention: Record<string, string>,
  timing: Timing,
  turns: DialogueTurn[] = []
): Sections => {
  const shot = clean.shot;
  const subjectLines: string[] = [];
  const anchoredImages = new Set(
    labels.map((label) => label.anchored_to).filter(Boolean) as string[]
  );
  for (const label of labels) {
    const ph = labelPlaceholder(label);
    if (label.kind === "image") {
      if (anchoredImages.has(label.label)) continue;
      const described = label.description || "a reference image for this shot";
      subjectLines.push(`${ph} is a reference image showing ${described}.`);
    } else if (label.kind === "video") {
      const described = label.description || "the end of the preceding shot";
      subjectLines.push(`${ph} is a video clip showing ${described}.`);
    } else {
      const described =
        label.description || label.name || "a character in this shot";
      const anchor = label.anchored_to;
      let anchorRef = "";
      if (anchor) {
        const anchorLabel = labels.find(
          (candidate) => candidate.label === anchor
        );
        if (anchorLabel)
          anchorRef = (
            anchorLabel.character_sheet
              ? ", whose appearance comes from the character design sheet {ref}; the video shows them inside the scene at full frame, not the sheet's multi-view layout or studio backdrop"
              : ", whose appearance comes from the reference image {ref}"
          ).replace("{ref}", labelPlaceholder(anchorLabel));
      }
      subjectLines.push(
        `${ph} is the character in this shot: ${described}${anchorRef}.`
      );
    }
  }

  const environmentDescription = cleanStr(clean.environment.description);
  const lighting = cleanStr(clean.environment.lighting);
  const propNames = clean.props
    .filter(isRecord)
    .map((prop) => cleanStr(prop.name))
    .filter(Boolean);
  const durationClause = timing.effective_duration_s
    ? ` Approximately ${pyFloat(timing.effective_duration_s)} seconds, ${timing.aspect_ratio}.`
    : "";
  const summary = `[${taskTypes.join(" + ")}] ${asSentence(shot.description)}${durationClause}`;

  const byLabel = new Map(labels.map((label) => [label.label, label]));
  const retentionLines = Object.entries(retention).map(
    ([label, marker]) =>
      `${byLabel.has(label) ? labelPlaceholder(byLabel.get(label)!) : label}: ${marker}` +
      " - carried into the target video as described."
  );

  const look = shot.style || DEFAULT_LOOK;
  const camera = shot.camera || DEFAULT_CAMERA;
  const detailParts = [
    `Look: ${asSentence(look)}`,
    `[Shot 1] ${asSentence(shot.description)}`
  ];
  if (environmentDescription)
    detailParts.push(`Location: ${asSentence(environmentDescription)}`);
  if (lighting) detailParts.push(`Lighting: ${asSentence(lighting)}`);
  if (propNames.length)
    detailParts.push(`Visible props: ${propNames.join(", ")}.`);
  detailParts.push(`Camera: ${asSentence(camera)}`);

  const labelFor = subjectLabelFor(labels);
  for (const turn of turns) {
    const subject = turn.speaker_ref_id ? labelFor(turn.speaker_ref_id) : null;
    const speaker = subject
      ? `${subject} (${turn.speaker_id})`
      : `The speaker (${turn.speaker_id})`;
    detailParts.push(`${speaker} says: {{line:${turn.index}}}`);
  }

  const audio = isRecord(shot.audio) ? shot.audio : {};
  const soundscape =
    asSentence(cleanStr(audio.soundscape)) ||
    `Ambient tone of ${environmentDescription || "the location"}, with the physical sounds ` +
      "of the action in frame.";
  const music = cleanStr(audio.music) || "N/A";
  return {
    subject_definitions:
      subjectLines.join("\n") ||
      "No external references are used in this shot.",
    summary,
    retention_analysis:
      retentionLines.join("\n") ||
      "No references are used, so nothing is retained.",
    detailed_description: detailParts.join(" "),
    overall_soundscape: soundscape,
    non_diegetic_music: music
  };
};

/** The two layout habits the model gets wrong. */
export const normalizeSections = (
  sections: Record<string, unknown>
): Sections => {
  const normalized = {} as Sections;
  for (const name of SECTION_ORDER) {
    let text = textOf(sections[name] ?? "").trim();
    if (ENTRY_PER_LINE_SECTIONS.has(name))
      text = text.replace(ENTRY_BOUNDARY_RE, "\n");
    text = text.replace(RUN_TOGETHER_RE, " ");
    normalized[name] = text.replace(/[ \t]{2,}/g, " ").trim();
  }
  return normalized;
};

/** The only place the six-section format is assembled. */
export const renderDocument = (sections: Record<string, string>): string =>
  SECTION_ORDER.map(
    (name) => `${name}:\n${(sections[name] ?? "").trim()}`
  ).join("\n\n");

const placeholderIndex = (labels: Label[]): Map<string, Label> => {
  const index = new Map<string, Label>();
  for (const label of labels) {
    if (!label.ref_id) continue;
    const key = `${placeholderKind(label.kind)}|${label.ref_id}`;
    if (!index.has(key)) index.set(key, label);
  }
  return index;
};

/** `[hard, soft]`. */
export const validateDocument = (
  sections: Sections,
  labels: Label[],
  taskTypes: string[],
  retention: Record<string, string>,
  turns: DialogueTurn[] = []
): [string[], string[]] => {
  const hard: string[] = [...dialogueFailures(sections, turns, false)];
  const soft: string[] = [];
  const known = placeholderIndex(labels);
  const document = SECTION_ORDER.map((name) => sections[name] ?? "").join("\n");

  const used = new Set<string>();
  for (const [, kind, refId] of document.matchAll(placeholderRe())) {
    if (kind === "audio") continue;
    const key = `${kind}|${refId}`;
    if (!known.has(key))
      hard.push(
        `placeholder {{${kind}:${refId}}} names a reference that does not exist`
      );
    else used.add(key);
  }
  const numbered = new Set(
    [...document.matchAll(NUMBERED_TAG_RE)].map((match) => match[0])
  );
  if (numbered.size)
    hard.push(
      "the document writes numbered reference tags " +
        `(${[...numbered].sort().join(", ")}); it must use {{kind:ref_id}} placeholders only`
    );

  const subjectDefinitions = sections.subject_definitions ?? "";
  for (const label of labels) {
    if (label.kind !== "subject" || !label.ref_id) continue;
    if (!subjectDefinitions.includes(placeholder("subject", label.ref_id))) {
      hard.push(
        `subject '${label.ref_id}' is never defined in subject_definitions`
      );
      continue;
    }
    if (label.anchored_to) {
      const anchorLabel = labels.find(
        (candidate) => candidate.label === label.anchored_to
      );
      const anchorRef = anchorLabel?.ref_id;
      if (
        anchorRef &&
        !subjectDefinitions.includes(placeholder("ref", anchorRef))
      )
        hard.push(
          `subject '${label.ref_id}' is not anchored to its reference image in subject_definitions`
        );
      else if (
        anchorRef &&
        anchorLabel?.character_sheet &&
        !subjectDefinitions
          .split("\n")
          .some(
            (line) =>
              line.includes(placeholder("subject", label.ref_id!)) &&
              line.toLowerCase().includes("design sheet")
          )
      )
        soft.push(
          `subject '${label.ref_id}' does not call its reference a design sheet`
        );
    }
  }

  const expectedPrefix = `[${taskTypes.join(" + ")}]`;
  if (!(sections.summary ?? "").trim().startsWith(expectedPrefix))
    hard.push(`summary must open with '${expectedPrefix}'`);

  const retentionAnalysis = sections.retention_analysis ?? "";
  if (SPEAKER_ID_RE.test(retentionAnalysis))
    hard.push("retention_analysis must not contain speaker ids");
  for (const [label, marker] of Object.entries(retention))
    if (!retentionAnalysis.includes(marker))
      soft.push(`retention_analysis does not state '${marker}' for ${label}`);

  const detailed = sections.detailed_description ?? "";
  if (!detailed.includes("[Shot 1]"))
    hard.push("detailed_description must contain a [Shot 1] marker");
  for (const [, number, tail] of detailed.matchAll(
    /\[Shot (\d+)\]([^[]{0,40})/g
  ))
    if (number !== "1" && !tail!.includes("At "))
      soft.push(`[Shot ${number}] has no 'At MM:SS.mmm' timestamp`);
  const wordCount = detailed.split(/\s+/).filter(Boolean).length;
  if (
    wordCount < DETAILED_DESCRIPTION_MIN_WORDS ||
    wordCount > DETAILED_DESCRIPTION_MAX_WORDS
  )
    soft.push(
      `detailed_description is ${wordCount} words; the guide asks for ` +
        `${DETAILED_DESCRIPTION_MIN_WORDS}-${DETAILED_DESCRIPTION_MAX_WORDS}`
    );
  if (detailed.split("<d>").length !== detailed.split("</d>").length)
    soft.push("detailed_description has unbalanced <d> dialogue tags");
  for (const [key, label] of known)
    if (!used.has(key))
      soft.push(`reference '${label.ref_id}' is allocated but never mentioned`);
  return [hard, soft];
};

const continuationDefinition = (
  referencePlaceholder: string,
  continuation: Continuation
): string =>
  continuation === CONTINUATION_PIN
    ? `${referencePlaceholder}: ${SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_PIN}`
    : `${referencePlaceholder}: ${SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CUT}`;

const continuationRetention = (
  referencePlaceholder: string,
  continuation: Continuation,
  marker: string
): string =>
  continuation === CONTINUATION_PIN
    ? `${referencePlaceholder}: ${marker} - the opening moment: who is where, their ` +
      "poses, the framing, the setting and the light."
    : `${referencePlaceholder}: ${marker} - who is where, their poses, the setting and ` +
      "the light; not its framing.";

/** The "## Continuity" block, or null when the shot continues nothing. */
export const continuationBrief = (labels: Label[]): string | null => {
  const lines: string[] = [];
  for (const label of labels) {
    const referencePlaceholder = labelPlaceholder(label);
    if (label.continuation === CONTINUATION_PIN)
      lines.push(
        `- ${referencePlaceholder} is the last frame of the preceding shot, and this video opens ` +
          "exactly on it. The camera holds its framing, angle, height and lens for the " +
          "whole clip, locked off, so the cut from the preceding shot cannot be seen. " +
          "Ignore any framing, angle, lens or camera move in the shot data, and never " +
          "describe a new framing, a cut, a dissolve or a morph."
      );
    else if (label.continuation === CONTINUATION_CUT)
      lines.push(
        `- ${referencePlaceholder} is the last frame of the preceding shot, and this shot is a new ` +
          "camera angle on that same moment, after a hard cut. Frame it as the shot data " +
          `asks from the first frame; never open on ${referencePlaceholder}'s framing or dissolve ` +
          "from it."
      );
  }
  if (!lines.length) return null;
  return (
    "## Continuity\n" +
    lines.join("\n") +
    "\nThe characters are already in place and " +
    `already doing what they were doing. ${NOTHING_RESTARTS}`
  );
};

/** A pinned shot keeps the opening frame's camera instead of its own. */
export const applyPinnedCamera = (
  clean: CleanPayload,
  labels: Label[]
): CleanPayload => {
  if (!labels.some((label) => label.continuation === CONTINUATION_PIN))
    return clean;
  return { ...clean, shot: { ...clean.shot, camera: PINNED_CAMERA } };
};

const continuedVideoDefinition = (referencePlaceholder: string): string =>
  `${referencePlaceholder}: ${SEQUENTIAL_SHOT_REFERENCE_DESCRIPTION_CHUNK}`;

/** Whether `line` is the entry for `referencePlaceholder`, the first placeholder it names. */
const isEntryFor = (line: string, referencePlaceholder: string): boolean => {
  const first = placeholderRe().exec(line);
  return !!first && first[0] === referencePlaceholder;
};

const LIST_ITEM_RE = /^\s*(?:[-*•]|\d+[.)])\s/;
const STARTS_WITH_WHITESPACE_RE = /^\s/;

/**
 * Swap the placeholder's entry in each section for
 * the code-written line, together with the indented lines that wrap it.
 */
const replaceReferenceLines = (
  sections: Sections,
  referencePlaceholder: string,
  definition: string,
  retentionLine: string
): Sections => {
  const updated = { ...sections };
  for (const [name, line] of [
    ["subject_definitions", definition],
    ["retention_analysis", retentionLine]
  ] as const) {
    const kept: string[] = [];
    let isDroppingEntry = false;
    for (const existing of pySplitLines(updated[name] ?? "")) {
      if (!existing.trim()) continue;
      if (
        !STARTS_WITH_WHITESPACE_RE.test(existing) ||
        LIST_ITEM_RE.test(existing)
      )
        isDroppingEntry = isEntryFor(existing, referencePlaceholder);
      if (!isDroppingEntry) kept.push(existing);
    }
    updated[name] = [...kept, line].join("\n");
  }
  return updated;
};

/**
 * The lines tying a sequential shot to the
 * previous one are written by code, replacing the model's. A reference's own
 * description (the shot's prompt_appendix) is its line; the fixed text is the
 * fallback when it has none.
 */
export const applyContinuationLines = (
  sections: Sections,
  labels: Label[],
  retention: Record<string, string>
): Sections => {
  let updated = sections;
  for (const label of labels) {
    const referencePlaceholder = labelPlaceholder(label);
    const ownLine = cleanStr(label.description);
    if (label.continuation)
      updated = replaceReferenceLines(
        updated,
        referencePlaceholder,
        ownLine
          ? `${referencePlaceholder}: ${ownLine}`
          : continuationDefinition(referencePlaceholder, label.continuation),
        continuationRetention(
          referencePlaceholder,
          label.continuation,
          retention[label.label] ?? CONTINUATION_RETENTION[label.continuation]
        )
      );
    else if (label.kind === "video" && label.ref_id === CROSS_SHOT_VIDEO_REF_ID)
      updated = replaceReferenceLines(
        updated,
        referencePlaceholder,
        ownLine
          ? `${referencePlaceholder}: ${ownLine}`
          : continuedVideoDefinition(referencePlaceholder),
        `${referencePlaceholder}: ${retention[label.label] ?? "weak_reference"} - the characters, ` +
          "places and light the clip ends on, carried on without repeating its action."
      );
  }
  return updated;
};

/** Tags and spoken lines into the placeholder document. */
export const bindPlaceholders = (
  sections: Sections,
  labels: Label[],
  turns: DialogueTurn[] = []
): [Sections, string[]] => {
  const known = placeholderIndex(labels);
  const warnings: string[] = [];
  const dropped = new Set<string>();
  const replace = (_match: string, kind: string, refId: string): string => {
    const label = known.get(`${kind}|${refId}`);
    if (label) return label.label;
    if (!dropped.has(refId)) {
      dropped.add(refId);
      warnings.push(
        `placeholder {{${kind}:${refId}}} has no reference allocated ` +
          `(${kind} references are not supported yet); replaced with plain description`
      );
    }
    const candidate = labels.find((item) => item.ref_id === refId);
    return candidate ? candidate.description || candidate.name || "" : "";
  };
  let working: Record<string, string> = { ...sections };
  if (turns.length) {
    const [repaired, repairs] = applyDialogue(
      working,
      turns,
      subjectLabelFor(labels)
    );
    working = repaired;
    warnings.push(...repairs);
  }
  const bound = {} as Sections;
  for (const name of SECTION_ORDER) {
    let text = (working[name] ?? "").replace(placeholderRe(), replace);
    if (new RegExp(LINE_PLACEHOLDER_RE.source).test(text)) {
      text = text.replace(LINE_PLACEHOLDER_RE, "");
      if (!dropped.has("stray")) {
        dropped.add("stray");
        warnings.push(
          "the document referenced a spoken line this shot does not have; " +
            "the placeholder was removed"
        );
      }
    }
    bound[name] = text.replace(/[ \t]{2,}/g, " ").trim();
  }
  return [bound, warnings];
};

/** The placeholder -> tag map the model writes against. */
export const labelTable = (labels: Label[]): string =>
  labels
    .map((label) => {
      const ph = labelPlaceholder(label);
      const description = label.description ? `: ${label.description}` : "";
      if (label.kind === "image" || label.kind === "video")
        return `- ${ph} -> ${label.label} (${label.kind === "image" ? "image reference" : "reference video"}, slot ${label.slot})${description}`;
      return `- ${ph} -> ${label.label} (subject, anchored to ${label.anchored_to || "no image reference"})${description}`;
    })
    .join("\n") || "- (no references for this shot)";

/** The values the backend holds as floats (MAGO_IMG2VID_FPS is 24.0). */
const FLOAT_KEYS = new Set([
  "fps",
  "duration_s",
  "requested_duration_s",
  "effective_duration_s",
  "speech_s"
]);

export interface PreparedVideoPrompt {
  clean: CleanPayload;
  references: CleanReference[];
  labels: Label[];
  timing: Timing;
  taskTypes: string[];
  retention: Record<string, string>;
  skeleton: Sections;
  turns: DialogueTurn[];
  warnings: string[];
  engineVersion: string;
}

/** The parts the model is sent, in order. */
export const modelContents = (
  context: PreparedVideoPrompt,
  hardFailures: string[] | null = null
): string[] => {
  const { clean, labels, taskTypes, retention, timing, skeleton, turns } =
    context;
  const byLabel = new Map(labels.map((label) => [label.label, label]));
  const parts = [
    ADAPT_PROMPT_I2V_INSTRUCTION,
    VIDEO_PROMPT_TEMPLATE,
    "## Label table (use these placeholders, never a number)\n" +
      labelTable(labels),
    "## Task types (verbatim, in this order)\n" + taskTypes.join(" + "),
    "## Retention markers (verbatim, addressed by placeholder)\n" +
      Object.entries(retention)
        .map(
          ([label, marker]) =>
            `- ${byLabel.has(label) ? labelPlaceholder(byLabel.get(label)!) : label}: ${marker}`
        )
        .join("\n"),
    "## Timing and canvas\n" + pyJsonDumps(timing, FLOAT_KEYS),
    "## Shot data\n" + pyJsonDumps(clean, FLOAT_KEYS),
    "## Deterministic skeleton (ground truth to expand, not to contradict)\n" +
      pyJsonDumps(skeleton, FLOAT_KEYS)
  ];
  const continuity = continuationBrief(labels);
  if (continuity) parts.push(continuity);
  const brief = dialogueBrief(turns, subjectLabelFor(labels));
  if (brief) parts.push(brief);
  if (hardFailures?.length)
    parts.push(
      "## Your previous answer was rejected. Fix exactly these problems:\n" +
        hardFailures.map((failure) => `- ${failure}`).join("\n")
    );
  return parts;
};

/**
 * Give every image reference a stored
 * caption when it has none, and lend it to the entity it depicts.
 */
const backfillReferenceDescriptions = (
  clean: CleanPayload,
  references: CleanReference[],
  storedCaption: (assetId: string) => string | null | undefined
): void => {
  for (const entry of references) {
    if (entry.description || entry.kind !== "image" || entry.members.length)
      continue;
    const caption = storedCaption(entry.asset_id);
    if (caption) entry.description = caption;
  }
  const described = new Map(
    references
      .filter(
        (entry) => entry.ref_id && entry.description && !entry.members.length
      )
      .map((entry) => [entry.ref_id!, entry.description])
  );
  if (!described.size) return;
  const lend = <T extends JsonRecord>(item: T): T =>
    !cleanStr(item.description) && described.has(textOf(item.id))
      ? { ...item, description: described.get(textOf(item.id)) }
      : item;
  clean.characters = clean.characters.map(lend);
  clean.environment = lend(clean.environment);
  clean.props = clean.props.map((prop) => (isRecord(prop) ? lend(prop) : prop));
};

/** Validate and compose everything the render needs. */
export const prepareVideoPrompt = (
  payload: JsonRecord,
  engineVersion: string = LOCAL_VIDEO_PROMPT_ENGINE,
  storedCaption: (assetId: string) => string | null | undefined = () => null
): PreparedVideoPrompt => {
  let clean = validateShotPayload(payload);
  const refIdWarnings = normalizeRefIds(clean);
  const references = referenceList(clean);
  if (references.some((entry) => entry.kind === "audio"))
    fail(`${engineVersion} takes no audio references`, UNPROCESSABLE);
  backfillReferenceDescriptions(clean, references, storedCaption);
  checkReferences(references);
  const [labels, labelWarnings] = assignLabels(
    clean,
    references,
    engineVersion
  );
  const requestedCamera = clean.shot.camera;
  clean = applyPinnedCamera(clean, labels);
  const warnings = [...refIdWarnings, ...labelWarnings];
  if (requestedCamera && clean.shot.camera !== requestedCamera)
    warnings.push(
      "the shot opens on the previous shot's last frame, so its camera " +
        `('${requestedCamera}') is replaced by a locked-off hold on that frame`
    );
  const [turns, dialogueWarnings] = resolveDialogue(clean);
  warnings.push(...dialogueWarnings);
  const [timing, timingWarnings] = resolveTiming(
    clean,
    references,
    engineVersion,
    turns
  );
  warnings.push(...timingWarnings);
  const taskTypes = inferTaskTypes(clean);
  const retention = inferRetention(clean, labels);
  const skeleton = buildSkeleton(
    clean,
    labels,
    taskTypes,
    retention,
    timing,
    turns
  );
  return {
    clean,
    references,
    labels,
    timing,
    taskTypes,
    retention,
    skeleton,
    turns,
    warnings,
    engineVersion
  };
};

/** The model call: the parts in, the six sections out (throws when unusable). */
export type VideoPromptModelCall = (
  contents: string[]
) => Promise<Record<string, unknown>>;

/** pydantic's `VideoPromptSections.model_validate`: six strings, extras ignored. */
const toSections = (value: Record<string, unknown>): Record<string, string> => {
  const sections: Record<string, string> = {};
  for (const name of SECTION_ORDER) {
    if (typeof value[name] !== "string")
      throw new Error("the answer is not the six-section object");
    sections[name] = value[name] as string;
  }
  return sections;
};

export interface ComposedVideoPrompt {
  prompt: string;
  prompt_template: string;
  sections: Sections;
  labels: Array<Omit<Label, "description">>;
  references: Array<{ type: string; asset_id: string; ref_id?: string }>;
  sources: Record<string, Array<{ asset_id: string; type: string }>>;
  timing: Timing;
  task_types: string[];
  retention: Record<string, string>;
  speakers: JsonRecord[];
  engine_version: string;
  warnings: string[];
  fallback: boolean;
}

/** Run the model over the prepared context. */
export const renderVideoPrompt = async (
  context: PreparedVideoPrompt,
  callModel: VideoPromptModelCall
): Promise<ComposedVideoPrompt> => {
  const { labels, taskTypes, retention, skeleton, turns, references } = context;
  const warnings = [...context.warnings];
  let sections = skeleton;
  let fallback = true;
  let hardFailures: string[] | null = null;
  let attempt = 0;
  for (; attempt < 2; attempt += 1) {
    let generated: Sections;
    try {
      generated = normalizeSections(
        toSections(await callModel(modelContents(context, hardFailures)))
      );
    } catch {
      warnings.push(
        "prompt generation failed; returning the deterministic skeleton"
      );
      break;
    }
    const [hard, soft] = validateDocument(
      generated,
      labels,
      taskTypes,
      retention,
      turns
    );
    hardFailures = hard;
    if (!hard.length) {
      sections = generated;
      fallback = false;
      warnings.push(...soft);
      break;
    }
  }
  if (attempt === 2)
    warnings.push(
      "generated prompt failed validation twice; returning the deterministic skeleton"
    );
  if (fallback && hardFailures?.length)
    warnings.push(...hardFailures.map((failure) => `rejected: ${failure}`));

  sections = applyContinuationLines(sections, labels, retention);
  const [boundSections, bindWarnings] = bindPlaceholders(
    sections,
    labels,
    turns
  );
  const bound = applyStoryboardLines(boundSections, labels, retention);
  warnings.push(...bindWarnings);

  const tagFor = new Map(
    labels
      .filter((label) => label.kind === "subject" && label.ref_id)
      .map((label) => [label.ref_id!, label.label])
  );
  const speakers: JsonRecord[] = [];
  for (const turn of turns) {
    if (speakers.some((row) => row.speaker_id === turn.speaker_id)) continue;
    speakers.push({
      speaker_id: turn.speaker_id,
      speaker: turn.speaker,
      speaker_ref_id: turn.speaker_ref_id,
      language: turn.language,
      label: turn.speaker_ref_id
        ? (tagFor.get(turn.speaker_ref_id) ?? null)
        : null
    });
  }
  const sources: Record<string, Array<{ asset_id: string; type: string }>> = {};
  for (const entry of references) {
    const key = SOURCES_KEY_BY_KIND[entry.kind]!;
    (sources[key] ??= []).push({
      asset_id: entry.asset_id,
      type: RENDERER_REFERENCE_TYPES[entry.kind]!
    });
  }
  return {
    prompt: renderDocument(bound),
    prompt_template: renderDocument(sections),
    sections: bound,
    labels: labels.map(({ description: _description, ...rest }) => rest),
    references: references.map((entry) => ({
      type: RENDERER_REFERENCE_TYPES[entry.kind]!,
      asset_id: entry.asset_id,
      ...(entry.ref_id ? { ref_id: entry.ref_id } : {})
    })),
    sources,
    timing: context.timing,
    task_types: taskTypes,
    retention,
    speakers,
    engine_version: context.engineVersion,
    warnings,
    fallback
  };
};

/** Prepare, then render. Throws VideoPromptError for a bad payload. */
export const generateVideoPrompt = async (
  payload: JsonRecord,
  callModel: VideoPromptModelCall,
  options: {
    engineVersion?: string;
    storedCaption?: (assetId: string) => string | null | undefined;
  } = {}
): Promise<ComposedVideoPrompt> =>
  renderVideoPrompt(
    prepareVideoPrompt(payload, options.engineVersion, options.storedCaption),
    callModel
  );
