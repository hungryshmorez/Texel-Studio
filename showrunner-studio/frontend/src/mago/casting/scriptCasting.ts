/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: constructor parameter property written out (the build forbids non-erasable syntax).
 * See LICENSE and NOTICE.md at the repository root.
 */
/* oxlint-disable eslint/no-magic-numbers -- the duration tables and limits are the backend's, ported verbatim so the two can be diffed */
import {
  applySpeechFloor,
  detectLanguage,
  normalizeLanguage,
  pythonRound,
  speechSeconds
} from "../vlm/dialogue";

import { CastingModel, type CastingModelName } from "./castingModels";
import {
  ATOMIC_SHOTS_RESPONSE_SCHEMA,
  GEMINI_RESPONSE_SCHEMA,
  INCLUDE_DIALOGUE_INSTRUCTION,
  INCLUDE_DIALOGUE_SCENES_INSTRUCTION,
  INCLUDE_DIALOGUE_SHOTS_INSTRUCTION,
  PROMPTS_RESPONSE_SCHEMA,
  SCRIPT_CASTING_ATOMIC_SHOTS_BATCH_SIZE,
  SCRIPT_CASTING_PROMPT,
  SCRIPT_CASTING_PROMPTS_PROMPT,
  SCRIPT_CASTING_SHOTS_PROMPT,
  SCRIPT_CASTING_SHOTS_SEQUENCE_PROMPT,
  SCRIPT_CASTING_SINGLE_CALL_MAX_WORDS,
  SCRIPT_CASTING_STRUCTURE_PROMPT,
  SEPARATE_CAMERA_INSTRUCTION,
  SEPARATE_STYLE_CONTENT_ONLY_INSTRUCTION,
  SEPARATE_STYLE_INSTRUCTION,
  SPLIT_ALTS_INSTRUCTION,
  STRUCTURE_RESPONSE_SCHEMA
} from "./castingPrompts.generated";
import { slugifyName } from "./castingTokens";

/**
 * Script -> casting: the backend, ported function
 * for function. The model call is the only part that differs — Gemini with a
 * response schema there, the caller's runner here — so everything before and
 * after it is checked against the backend's own output in backendParity.test.
 */

type JsonRecord = Record<string, unknown>;

export type RegexSequence = {
  id: number;
  heading: string;
  int_ext: string;
  time_of_day: string;
  text: string;
};

const SCRIPT_SHOT_MIN_DURATION_SECONDS = 5;
const SCRIPT_SHOT_MAX_DURATION_SECONDS = 15;

const SLUGLINE_RE =
  /^(?<int_ext>INT\.\/EXT\.|EXT\.\/INT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.|INT\.|EXT\.)\s+(?<location>.+)\s+[—–-]\s+(?<time>.+?)\s*$/gim;

const NOTES_HEADING_RE =
  /^(?:SHOOTING NOTES|Shooting Notes|Shooting notes)\s*$/gm;

const NOTES_EXAMPLE_MIN_SCENE_WORDS = 12;

const wordCount = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const matchesOf = (pattern: RegExp, text: string): RegExpExecArray[] => {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  );
  return [...text.matchAll(global)];
};

const firstMatch = (pattern: RegExp, text: string): RegExpExecArray | null =>
  matchesOf(pattern, text)[0] ?? null;

const stripIntExtPunctuation = (raw: string): string =>
  raw.trim().toUpperCase().replace(/\./g, "");

const normalizeIntExt = (raw: string): string => {
  const cleaned = stripIntExtPunctuation(raw);
  return cleaned === "INT" || cleaned === "EXT" ? cleaned : "INT/EXT";
};

const notesCandidateHasRealSceneAfter = (candidateNotes: string): boolean => {
  for (const match of matchesOf(SLUGLINE_RE, candidateNotes)) {
    let following = candidateNotes.slice(match.index + match[0].length);
    const nextHeading = firstMatch(SLUGLINE_RE, following);
    if (nextHeading) following = following.slice(0, nextHeading.index);
    if (wordCount(following) >= NOTES_EXAMPLE_MIN_SCENE_WORDS) return true;
  }
  return false;
};

/** Python's `str.strip()`: whitespace, as Python reckons it. */
const pyStrip = (text: string): string => text.replace(/^\s+|\s+$/g, "");

const splitBodyAndNotes = (text: string): [string, string] => {
  const matches = matchesOf(NOTES_HEADING_RE, text);
  for (const match of [...matches].reverse()) {
    const candidateNotes = text.slice(match.index + match[0].length);
    if (!notesCandidateHasRealSceneAfter(candidateNotes))
      return [text.slice(0, match.index), pyStrip(candidateNotes)];
  }
  return [text, ""];
};

/** Split on sluglines; [] when there are none. */
export const parseSequences = (text: string): RegexSequence[] => {
  const [bodyText] = splitBodyAndNotes(text);
  const headings = matchesOf(SLUGLINE_RE, bodyText);
  return headings.map((match, index) => {
    const start = match.index + match[0].length;
    const end =
      index + 1 < headings.length
        ? headings[index + 1]!.index
        : bodyText.length;
    return {
      id: index + 1,
      heading: pyStrip(match[0]),
      int_ext: normalizeIntExt(match.groups!.int_ext!),
      time_of_day: pyStrip(match.groups!.time!),
      text: pyStrip(bodyText.slice(start, end))
    };
  });
};

/** The header before the first slugline and any notes. */
export const extractSupplementaryText = (
  text: string,
  regexSequences: RegexSequence[]
): string => {
  if (!regexSequences.length) return "";
  const [bodyText, notes] = splitBodyAndNotes(text);
  const first = firstMatch(SLUGLINE_RE, bodyText);
  const preamble = first ? pyStrip(bodyText.slice(0, first.index)) : "";
  const parts: string[] = [];
  if (preamble)
    parts.push(`SCRIPT HEADER (may include title/episode info):\n${preamble}`);
  if (notes) {
    parts.push(
      "SHOOTING NOTES (continuity/appearance guidance — fold anything " +
        "relevant into every affected entity's description and " +
        "t2i_prompt, e.g. a character described as soaked in one state " +
        `and dry in another):\n${notes}`
    );
  }
  return parts.join("\n\n");
};

/** The parts sent with a call that reads the script itself. */
export const buildContents = (
  regexSequences: RegexSequence[],
  fullText: string,
  instructions: string,
  shotLimit: number | null,
  splitAlts = false,
  separateStyle = false,
  separateCamera = false,
  includeDialogue = false
): string[] => {
  let context: string;
  if (regexSequences.length) {
    const known = regexSequences
      .map(
        (sequence) =>
          `### Sequence ${sequence.id} [${sequence.int_ext}, ${sequence.time_of_day}]: ${sequence.heading}\n${sequence.text}`
      )
      .join("\n\n");
    context =
      "KNOWN SEQUENCE STRUCTURE — already parsed from the script's own " +
      "scene headings. Use these ids, headings, int_ext and time_of_day " +
      'exactly as given for the "sequences" field; do not renumber or ' +
      `reinterpret them.\n\n${known}`;
    const supplementary = extractSupplementaryText(fullText, regexSequences);
    if (supplementary) context += `\n\n${supplementary}`;
  } else {
    const limitClause = shotLimit
      ? ` Segment only the first ${shotLimit} logical sequences/scenes ` +
        "you encounter, reading from the start, and stop there — do " +
        `not go beyond id ${shotLimit} even if the text continues ` +
        "further. Only include characters/environments/props that " +
        `appear within those first ${shotLimit} sequences.`
      : "";
    context =
      "This script has no standard screenplay scene headings " +
      '("INT./EXT. LOCATION — TIME"). Read the full text below and ' +
      "segment it yourself into sequences. A sequence is what one slugline " +
      "would cover: continuous action in ONE place at ONE time. Start a new " +
      "sequence only when the location or the time changes. A shot or " +
      'camera heading ("SHOT 3", "CLOSE-UP", "MONTAGE", "CUT TO") is NOT a ' +
      "new sequence: it is a shot inside the current one, and shots are " +
      "split out later. Assign sequential integer ids starting at 1, " +
      "synthesize a short heading for each, and infer int_ext/time_of_day " +
      "as best you can — use " +
      '"UNKNOWN" for either only when the text truly gives no clue.' +
      `${limitClause}\n\n${fullText}`;
  }
  const contents = [context, instructions];
  if (splitAlts) contents.push(SPLIT_ALTS_INSTRUCTION);
  if (separateStyle) contents.push(SEPARATE_STYLE_INSTRUCTION);
  if (separateCamera) contents.push(SEPARATE_CAMERA_INSTRUCTION);
  if (includeDialogue) contents.push(INCLUDE_DIALOGUE_INSTRUCTION);
  return contents;
};

/** Any case or spacing of "default" is the default. */
export const normalizeAlt = (raw: unknown): string => {
  const alt = pyStrip(typeof raw === "string" && raw ? raw : "default");
  return alt.toLowerCase() === "default" ? "default" : alt;
};

const formatRegistryBlock = (label: string, entities: JsonRecord[]): string => {
  if (!entities.length) return `${label}: (none)`;
  const lines = entities
    .map((entity, index) => {
      const alt = normalizeAlt(entity.alt);
      const suffix = alt !== "default" ? ` (${alt})` : "";
      return `- [${index}] ${String(entity.name)}${suffix}: ${String(entity.description)}`;
    })
    .join("\n");
  return `${label}:\n${lines}`;
};

/** The two-call path's prompts call. */
export const buildRegistryContents = (
  characters: JsonRecord[],
  environments: JsonRecord[],
  props: JsonRecord[],
  separateStyle = false
): string[] => {
  const registry = [
    formatRegistryBlock("CHARACTERS", characters),
    formatRegistryBlock("ENVIRONMENTS", environments),
    formatRegistryBlock("PROPS", props)
  ].join("\n\n");
  const contents = [registry, SCRIPT_CASTING_PROMPTS_PROMPT];
  if (separateStyle) contents.push(SEPARATE_STYLE_CONTENT_ONLY_INSTRUCTION);
  return contents;
};

const formatTokenRegistryBlock = (
  label: string,
  entities: JsonRecord[]
): string => {
  if (!entities.length) return `${label}: (none)`;
  const lines = entities
    .map(
      (entity) =>
        `- ${String(entity.token_name)}: ${String(entity.name)} — ${String(entity.description)}`
    )
    .join("\n");
  return `${label}:\n${lines}`;
};

/** Python's `str(list_of_str)`: `['a', 'b']`, with Python's quoting. */
const pyListRepr = (items: unknown): string => {
  const list = Array.isArray(items) ? items : [];
  return `[${list
    .map((item) => {
      const text = String(item);
      if (text.includes("'") && !text.includes('"')) return `"${text}"`;
      return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    })
    .join(", ")}]`;
};

/** The atomic-shots call's parts. */
export const buildAtomicShotsContents = (
  castingSequences: JsonRecord[],
  regexSequences: RegexSequence[],
  scriptText: string,
  characters: JsonRecord[],
  environments: JsonRecord[],
  props: JsonRecord[],
  separateStyle = false,
  separateCamera = false,
  includeDialogue = false,
  sequenceMode = false
): string[] => {
  const textsById = new Map(
    regexSequences.map((sequence) => [sequence.id, sequence.text])
  );
  const blocks = castingSequences.map((sequence) => {
    const text = textsById.get(sequence.id as number);
    const header = `### Sequence ${String(sequence.id)} [${String(sequence.int_ext)}, ${String(sequence.time_of_day)}]: ${String(sequence.heading)}`;
    const known =
      `Known in this sequence — characters: ${pyListRepr(sequence.characters)}, ` +
      `environments: ${pyListRepr(sequence.environments)}, props: ${pyListRepr(sequence.props)}`;
    const body = text ?? "(text not repeated here — see full script below)";
    return `${header}\n${known}\n${body}`;
  });
  let context =
    "KNOWN SEQUENCES — split each into its atomic shots. Reference only " +
    "the token_names listed as known for that sequence; never invent " +
    `one.\n\n${blocks.join("\n\n")}`;
  if (regexSequences.length) {
    const supplementary = extractSupplementaryText(scriptText, regexSequences);
    if (supplementary) context += `\n\n${supplementary}`;
  } else {
    context +=
      "\n\nFULL SCRIPT TEXT (segmentation above is already fixed — use " +
      "this only to locate each sequence's action, do not " +
      `re-segment):\n\n${scriptText}`;
  }
  const registry = [
    formatTokenRegistryBlock("CHARACTERS", characters),
    formatTokenRegistryBlock("ENVIRONMENTS", environments),
    formatTokenRegistryBlock("PROPS", props)
  ].join("\n\n");
  if (sequenceMode) {
    const contents = [context, registry, SCRIPT_CASTING_SHOTS_SEQUENCE_PROMPT];
    if (separateStyle) contents.push(SEPARATE_STYLE_CONTENT_ONLY_INSTRUCTION);
    if (includeDialogue) contents.push(INCLUDE_DIALOGUE_SCENES_INSTRUCTION);
    return contents;
  }

  const contents = [context, registry, SCRIPT_CASTING_SHOTS_PROMPT];
  if (separateStyle) contents.push(SEPARATE_STYLE_CONTENT_ONLY_INSTRUCTION);
  if (separateCamera) contents.push(SEPARATE_CAMERA_INSTRUCTION);
  if (includeDialogue) contents.push(INCLUDE_DIALOGUE_SHOTS_INSTRUCTION);
  return contents;
};

/** An environment's int_ext from its own sequences. */
const applyIntExtFromSequences = (
  environments: JsonRecord[],
  sequencesById: Map<unknown, JsonRecord>
): void => {
  for (const environment of environments) {
    const values = (
      Array.isArray(environment.sequence_ids) ? environment.sequence_ids : []
    )
      .filter((id) => sequencesById.has(id))
      .map((id) => sequencesById.get(id)!.int_ext as string);
    const known = [
      ...new Set(
        values.filter((value) => value !== "INT/EXT" && value !== "UNKNOWN")
      )
    ];
    if (known.length === 1) environment.int_ext = known[0];
    else if (known.length > 1) environment.int_ext = "INT/EXT";
    else if (values.includes("INT/EXT")) environment.int_ext = "INT/EXT";
    else environment.int_ext = "UNKNOWN";
  }
};

const addTokenNames = (entities: JsonRecord[]): JsonRecord[] => {
  for (const entity of entities) {
    const baseToken = slugifyName(String(entity.name));
    const alt = normalizeAlt(entity.alt);
    entity.alt = alt;
    entity.token_name =
      alt === "default" ? baseToken : `${baseToken}--${slugifyName(alt)}`;
  }
  return entities;
};

const sequenceIdsOf = (entity: JsonRecord): unknown[] =>
  Array.isArray(entity.sequence_ids) ? entity.sequence_ids : [];

const excludeVariantSequenceIdsFromBaseline = (
  entities: JsonRecord[]
): void => {
  const claimedByName = new Map<string, Set<unknown>>();
  for (const entity of entities) {
    if (normalizeAlt(entity.alt) !== "default") {
      const key = slugifyName(String(entity.name));
      const claimed = claimedByName.get(key) ?? new Set<unknown>();
      for (const id of sequenceIdsOf(entity)) claimed.add(id);
      claimedByName.set(key, claimed);
    }
  }
  for (const entity of entities) {
    if (normalizeAlt(entity.alt) === "default") {
      const claimed = claimedByName.get(slugifyName(String(entity.name)));
      if (claimed?.size)
        entity.sequence_ids = sequenceIdsOf(entity).filter(
          (id) => !claimed.has(id)
        );
    }
  }
};

const dropEmptySequenceIds = (entities: JsonRecord[]): JsonRecord[] =>
  entities.filter((entity) => sequenceIdsOf(entity).length > 0);

const dedupeSequencesById = (sequences: JsonRecord[]): JsonRecord[] => {
  const seen = new Set<unknown>();
  return sequences.filter((sequence) => {
    if (seen.has(sequence.id)) return false;
    seen.add(sequence.id);
    return true;
  });
};

const normalizeLlmIntExt = (raw: string): string => {
  const cleaned = stripIntExtPunctuation(raw);
  if (cleaned === "INT" || cleaned === "INTERIOR") return "INT";
  if (cleaned === "EXT" || cleaned === "EXTERIOR") return "EXT";
  if (["INT/EXT", "EXT/INT", "INTERIOR/EXTERIOR", "I/E"].includes(cleaned))
    return "INT/EXT";
  return "UNKNOWN";
};

/** Regex output wins when present. */
const resolveSequences = (
  regexSequences: RegexSequence[],
  llmSequences: JsonRecord[]
): [JsonRecord[], "regex" | "llm"] => {
  if (regexSequences.length)
    return [regexSequences.map((sequence) => ({ ...sequence })), "regex"];
  const sequences = dedupeSequencesById(
    llmSequences.map((sequence) => ({ ...sequence }))
  );
  for (const sequence of sequences)
    sequence.int_ext = normalizeLlmIntExt(String(sequence.int_ext));
  return [sequences, "llm"];
};

const sequenceMembership = (
  sequences: JsonRecord[],
  characters: JsonRecord[],
  environments: JsonRecord[],
  props: JsonRecord[]
): Map<unknown, Record<"characters" | "environments" | "props", string[]>> => {
  const membership = new Map<
    unknown,
    Record<"characters" | "environments" | "props", string[]>
  >(
    sequences.map((sequence) => [
      sequence.id,
      { characters: [], environments: [], props: [] }
    ])
  );
  for (const [key, entities] of [
    ["characters", characters],
    ["environments", environments],
    ["props", props]
  ] as const) {
    for (const entity of entities) {
      for (const id of sequenceIdsOf(entity)) {
        membership.get(id)?.[key].push(entity.token_name as string);
      }
    }
  }
  return membership;
};

/** A usable `language` on every turn. */
const resolvedDialogue = (lines: unknown): JsonRecord[] =>
  (Array.isArray(lines) ? lines : [])
    .filter(
      (entry): entry is JsonRecord =>
        !!entry && typeof entry === "object" && !Array.isArray(entry)
    )
    .map((entry) => {
      const declared = pyStrip(
        typeof entry.language === "string" ? entry.language : ""
      );
      const { language } = normalizeLanguage(
        declared ||
          detectLanguage(typeof entry.line === "string" ? entry.line : "")
      );
      return { ...entry, language };
    });

const videoPromptsById = (
  sequenceVideoPrompts: JsonRecord[],
  knownIds: Set<unknown>
): Map<unknown, JsonRecord> => {
  const byId = new Map<unknown, JsonRecord>();
  for (const entry of sequenceVideoPrompts) {
    if (!knownIds.has(entry.id)) continue;
    byId.set(entry.id, {
      video_prompt: entry.video_prompt,
      needs_previous_frame: entry.needs_previous_frame ?? false,
      camera: entry.camera ?? null,
      dialogue: resolvedDialogue(entry.dialogue)
    });
  }
  return byId;
};

const applyShotLimit = (
  shotLimit: number | null,
  sequences: JsonRecord[],
  sequenceVideoPrompts: JsonRecord[],
  characters: JsonRecord[],
  environments: JsonRecord[],
  props: JsonRecord[]
): [JsonRecord[], JsonRecord[], JsonRecord[], JsonRecord[], JsonRecord[]] => {
  let kept = sequences;
  if (shotLimit) {
    kept = [...sequences]
      .sort((left, right) => (left.id as number) - (right.id as number))
      .slice(0, shotLimit);
  }
  const knownIds = new Set(kept.map((sequence) => sequence.id));
  const filterEntities = (entities: JsonRecord[]): JsonRecord[] =>
    entities.flatMap((entity) => {
      const keptIds = sequenceIdsOf(entity).filter((id) => knownIds.has(id));
      return keptIds.length ? [{ ...entity, sequence_ids: keptIds }] : [];
    });
  return [
    kept,
    sequenceVideoPrompts.filter((entry) => knownIds.has(entry.id)),
    filterEntities(characters),
    filterEntities(environments),
    filterEntities(props)
  ];
};

export const finalizeCasting = (
  title: unknown,
  segmentationSource: string,
  sequencesIn: JsonRecord[],
  sequenceVideoPromptsIn: JsonRecord[],
  charactersIn: JsonRecord[],
  environmentsIn: JsonRecord[],
  propsIn: JsonRecord[],
  shotLimit: number | null = null,
  splitAlts = false,
  visualStyle: string | null = null
): JsonRecord => {
  let [sequences, sequenceVideoPrompts, characters, environments, props] =
    applyShotLimit(
      shotLimit,
      sequencesIn,
      sequenceVideoPromptsIn,
      charactersIn,
      environmentsIn,
      propsIn
    );
  const sequencesById = new Map(
    sequences.map((sequence) => [sequence.id, sequence])
  );
  applyIntExtFromSequences(environments, sequencesById);
  if (!splitAlts) {
    for (const entities of [characters, environments, props])
      for (const entity of entities) entity.alt = "default";
  }
  if (splitAlts) {
    for (const entities of [characters, environments, props])
      excludeVariantSequenceIdsFromBaseline(entities);
    characters = dropEmptySequenceIds(characters);
    environments = dropEmptySequenceIds(environments);
    props = dropEmptySequenceIds(props);
  }
  characters = addTokenNames(characters);
  environments = addTokenNames(environments);
  props = addTokenNames(props);
  const membership = sequenceMembership(
    sequences,
    characters,
    environments,
    props
  );
  const videoPrompts = videoPromptsById(
    sequenceVideoPrompts,
    new Set(sequencesById.keys())
  );
  const ids = sequences.map((sequence) => sequence.id as number);
  const firstSequenceId = ids.length ? Math.min(...ids) : null;
  const casting: JsonRecord = {
    title,
    segmentation_source: segmentationSource,
    shot_limit: shotLimit,
    sequences: sequences.map((sequence) => {
      const prompt = videoPrompts.get(sequence.id) ?? {};
      const members = membership.get(sequence.id)!;
      return {
        id: sequence.id,
        heading: sequence.heading,
        int_ext: sequence.int_ext,
        time_of_day: sequence.time_of_day,
        characters: members.characters,
        environments: members.environments,
        props: members.props,
        video_prompt: prompt.video_prompt ?? "",
        needs_previous_frame:
          sequence.id === firstSequenceId
            ? false
            : (prompt.needs_previous_frame ?? false),
        camera: prompt.camera ?? null,
        dialogue: prompt.dialogue ?? []
      };
    }),
    characters,
    environments,
    props
  };
  if (visualStyle) casting.visual_style = visualStyle;
  return casting;
};

const mergePromptsIntoRegistry = (
  entities: JsonRecord[],
  promptsByIndex: Map<number, string>
): JsonRecord[] =>
  entities.map((entity, index) => ({
    ...entity,
    t2i_prompt: promptsByIndex.get(index) ?? ""
  }));

const BEAT_DURATION_DEFAULTS_BY_BEAT_TYPE: Record<string, [number, number]> = {
  insert_pov: [1.5, 2.5],
  contained_reaction: [2.0, 3.25],
  physical_beat: [2.5, 4.0],
  push_in_emotional: [3.75, 6.0],
  continuous_multi_beat: [2.5, 4.0]
};

const DURATION_DEFAULTS_BY_BEAT_TYPE: Record<string, [number, number]> = {
  insert_pov: [5.0, 5.0],
  contained_reaction: [5.0, 5.0],
  physical_beat: [5.0, 5.0],
  push_in_emotional: [5.0, 6.0],
  continuous_multi_beat: [5.0, 5.0]
};

const normalizeScriptShotDuration = (durationS: number): number =>
  Math.min(
    SCRIPT_SHOT_MAX_DURATION_SECONDS,
    Math.max(SCRIPT_SHOT_MIN_DURATION_SECONDS, pythonRound(durationS, 0))
  );

const castingSpeechFloor = (
  durationShortS: number,
  durationLongS: number,
  dialogue: JsonRecord[],
  sequenceMode: boolean
): [number, number] => {
  let [shortS, longS] = applySpeechFloor(
    durationShortS,
    durationLongS,
    dialogue
  );
  if (!sequenceMode) {
    shortS = normalizeScriptShotDuration(shortS);
    longS = normalizeScriptShotDuration(longS);
  }
  return [shortS, longS];
};

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** The model's beat type and lengths, validated. */
export const resolveShotDuration = (
  beatType: unknown,
  durationShortS: unknown,
  durationLongS: unknown,
  sequenceMode = false
): [string, number, number] => {
  const table = sequenceMode
    ? BEAT_DURATION_DEFAULTS_BY_BEAT_TYPE
    : DURATION_DEFAULTS_BY_BEAT_TYPE;
  const defaults = typeof beatType === "string" ? table[beatType] : undefined;
  if (!defaults) return ["physical_beat", ...table.physical_beat!];
  if (!isPositiveNumber(durationShortS) || !isPositiveNumber(durationLongS))
    return [beatType as string, ...defaults];
  let shortS = durationShortS;
  let longS = durationLongS;
  if (longS < shortS) [shortS, longS] = [longS, shortS];
  if (sequenceMode) return [beatType as string, shortS, longS];
  return [
    beatType as string,
    normalizeScriptShotDuration(shortS),
    normalizeScriptShotDuration(longS)
  ];
};

export const finalizeAtomicShots = (
  groups: JsonRecord[],
  castingSequences: JsonRecord[],
  batchIndexBySequenceId: Map<unknown, number> | null = null,
  sequenceMode = false
): JsonRecord[] => {
  const knownIds = new Set(castingSequences.map((sequence) => sequence.id));
  const shotsBySequence = new Map<unknown, JsonRecord[]>();
  for (const group of groups) {
    const id = group.sequence_id;
    if (!knownIds.has(id)) continue;
    if (shotsBySequence.has(id) && shotsBySequence.get(id)!.length) continue;
    shotsBySequence.set(
      id,
      Array.isArray(group.shots) ? (group.shots as JsonRecord[]) : []
    );
  }

  const allShots: JsonRecord[] = [];
  let n = 0;
  let previousBatchIndex: number | undefined;
  let previousWasFallback: boolean | null = null;
  for (const sequence of castingSequences) {
    const id = sequence.id;
    let drafts = shotsBySequence.get(id);
    const isFallback = !drafts?.length;
    if (isFallback) {
      const fallbackTable = sequenceMode
        ? BEAT_DURATION_DEFAULTS_BY_BEAT_TYPE
        : DURATION_DEFAULTS_BY_BEAT_TYPE;
      const [shortS, longS] = fallbackTable.physical_beat!;
      drafts = [
        {
          action: sequence.heading,
          video_prompt: sequence.video_prompt,
          characters: sequence.characters,
          environments: sequence.environments,
          props: sequence.props,
          needs_previous_frame: false,
          beat_type: "physical_beat",
          duration_short_s: shortS,
          duration_long_s: longS,
          camera: null
        }
      ];
    }
    const known = {
      characters: new Set(sequence.characters as string[]),
      environments: new Set(sequence.environments as string[]),
      props: new Set(sequence.props as string[])
    };
    const currentBatchIndex = batchIndexBySequenceId?.get(id);
    drafts!.forEach((draft, offset) => {
      const localIndex = offset + 1;
      n += 1;
      const [beatType, resolvedShort, resolvedLong] = resolveShotDuration(
        draft.beat_type,
        draft.duration_short_s,
        draft.duration_long_s,
        sequenceMode
      );
      const shotDialogue = resolvedDialogue(draft.dialogue);
      const [durationShortS, durationLongS] = castingSpeechFloor(
        resolvedShort,
        resolvedLong,
        shotDialogue,
        sequenceMode
      );
      let needsPreviousFrame: boolean;
      if (isFallback) needsPreviousFrame = false;
      else if (localIndex > 1)
        needsPreviousFrame = !!draft.needs_previous_frame;
      else if (
        previousWasFallback === null ||
        previousWasFallback ||
        previousBatchIndex !== currentBatchIndex
      )
        needsPreviousFrame = false;
      else needsPreviousFrame = !!draft.needs_previous_frame;
      const filterKnown = (tokens: unknown, allowed: Set<string>): string[] =>
        (Array.isArray(tokens) ? tokens : []).filter((token): token is string =>
          allowed.has(token as string)
        );
      allShots.push({
        id: `${String(id)}.${localIndex}`,
        sequence_id: id,
        n,
        action: draft.action,
        video_prompt: draft.video_prompt,
        characters: filterKnown(draft.characters, known.characters),
        environments: filterKnown(draft.environments, known.environments),
        props: filterKnown(draft.props, known.props),
        needs_previous_frame: needsPreviousFrame,
        beat_type: beatType,
        duration_short_s: durationShortS,
        duration_long_s: durationLongS,
        camera: draft.camera ?? null,
        dialogue: shotDialogue,
        speech_s: speechSeconds(shotDialogue)
      });
    });
    previousBatchIndex = currentBatchIndex;
    previousWasFallback = isFallback;
  }
  return allShots;
};

const chunkSequences = (
  sequences: JsonRecord[],
  batchSize: number
): JsonRecord[][] => {
  const batches: JsonRecord[][] = [];
  for (let start = 0; start < sequences.length; start += batchSize)
    batches.push(sequences.slice(start, start + batchSize));
  return batches;
};

const approximateLlmFallbackSlice = (
  scriptText: string,
  castingSequences: JsonRecord[],
  batch: JsonRecord[]
): string => {
  const positions = new Map<unknown, number>();
  let cursor = 0;
  for (const sequence of castingSequences) {
    const heading = String(sequence.heading);
    const index = scriptText.indexOf(heading, cursor);
    if (index === -1) continue;
    positions.set(sequence.id, index);
    cursor = index + heading.length;
  }
  const batchStarts = batch
    .filter((sequence) => positions.has(sequence.id))
    .map((sequence) => positions.get(sequence.id)!);
  if (!batchStarts.length) return scriptText;
  const start = Math.min(...batchStarts);
  let end = scriptText.length;
  const batchEndIndex = castingSequences.indexOf(batch[batch.length - 1]!);
  for (const sequence of castingSequences.slice(batchEndIndex + 1)) {
    if (positions.has(sequence.id)) {
      end = positions.get(sequence.id)!;
      break;
    }
  }
  return scriptText.slice(start, end);
};

const effectiveWordCount = (
  scriptText: string,
  regexSequences: RegexSequence[]
): number => {
  if (!regexSequences.length) return wordCount(scriptText);
  const combined = `${extractSupplementaryText(scriptText, regexSequences)} ${regexSequences
    .map((sequence) => sequence.text)
    .join(" ")}`;
  return wordCount(combined);
};

/**
 * One structured model call: the parts the backend sends Gemini, the schema
 * it constrains the answer with, and the label that tells the steps apart.
 * Resolves to the answer already validated and shaped like the pydantic
 * model's `model_dump()`; rejects when it cannot be.
 */
export type StructuredCall = (input: {
  contents: string[];
  schema: Record<string, unknown>;
  model: CastingModelName;
  stepLabel: string;
}) => Promise<JsonRecord>;

/**
 * A failed call, carrying the backend's error body: `message` is
 * "Error generating casting (<step>)" when the model could not be reached and
 * "Invalid response from model (<step>)" when its answer failed validation.
 */
export class CastingCallError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

export type CastingOptions = {
  shotLimit?: number | null;
  atomicShots?: boolean;
  splitAlts?: boolean;
  separateStyle?: boolean;
  separateCamera?: boolean;
  includeDialogue?: boolean;
  sequenceMode?: boolean;
  /** The single-call word threshold. Defaults to the backend's. */
  singleCallMaxWords?: number;
};

const dumpList = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? (value as JsonRecord[]) : [];

const singleCall = async (
  call: StructuredCall,
  scriptText: string,
  regexSequences: RegexSequence[],
  options: Required<CastingOptions>
): Promise<JsonRecord> => {
  const parsed = await call({
    contents: buildContents(
      regexSequences,
      scriptText,
      SCRIPT_CASTING_PROMPT,
      options.shotLimit,
      options.splitAlts,
      options.separateStyle,
      options.separateCamera,
      options.includeDialogue
    ),
    schema: GEMINI_RESPONSE_SCHEMA,
    model: CastingModel.ScriptCastingResult,
    stepLabel: ""
  });
  const [sequences, source] = resolveSequences(
    regexSequences,
    dumpList(parsed.sequences)
  );
  const casting = finalizeCasting(
    parsed.title,
    source,
    sequences,
    dumpList(parsed.sequence_video_prompts),
    dumpList(parsed.characters),
    dumpList(parsed.environments),
    dumpList(parsed.props),
    options.shotLimit,
    options.splitAlts,
    (parsed.visual_style as string | null) ?? null
  );
  casting.generation_mode = "single_call";
  return casting;
};

const twoCall = async (
  call: StructuredCall,
  scriptText: string,
  regexSequences: RegexSequence[],
  options: Required<CastingOptions>
): Promise<JsonRecord> => {
  const structure = await call({
    contents: buildContents(
      regexSequences,
      scriptText,
      SCRIPT_CASTING_STRUCTURE_PROMPT,
      options.shotLimit,
      options.splitAlts,
      options.separateStyle,
      options.separateCamera,
      options.includeDialogue
    ),
    schema: STRUCTURE_RESPONSE_SCHEMA,
    model: CastingModel.ScriptCastingStructureResult,
    stepLabel: "structure step"
  });
  const [resolved, source] = resolveSequences(
    regexSequences,
    dumpList(structure.sequences)
  );
  let [sequences, sequenceVideoPrompts, characters, environments, props] =
    applyShotLimit(
      options.shotLimit,
      resolved,
      dumpList(structure.sequence_video_prompts),
      dumpList(structure.characters),
      dumpList(structure.environments),
      dumpList(structure.props)
    );
  const prompts = await call({
    contents: buildRegistryContents(
      characters,
      environments,
      props,
      options.separateStyle
    ),
    schema: PROMPTS_RESPONSE_SCHEMA,
    model: CastingModel.ScriptCastingPromptsResult,
    stepLabel: "prompts step"
  });
  const byIndex = (list: unknown) =>
    new Map(
      dumpList(list).map((entry) => [
        entry.index as number,
        entry.t2i_prompt as string
      ])
    );
  characters = mergePromptsIntoRegistry(
    characters,
    byIndex(prompts.characters)
  );
  environments = mergePromptsIntoRegistry(
    environments,
    byIndex(prompts.environments)
  );
  props = mergePromptsIntoRegistry(props, byIndex(prompts.props));
  const casting = finalizeCasting(
    structure.title,
    source,
    sequences,
    sequenceVideoPrompts,
    characters,
    environments,
    props,
    options.shotLimit,
    options.splitAlts,
    (structure.visual_style as string | null) ?? null
  );
  casting.generation_mode = "two_call";
  return casting;
};

const generateAtomicShots = async (
  call: StructuredCall,
  casting: JsonRecord,
  regexSequences: RegexSequence[],
  scriptText: string,
  options: Required<CastingOptions>
): Promise<JsonRecord[]> => {
  const castingSequences = dumpList(casting.sequences);
  if (!castingSequences.length) return [];
  const batches = chunkSequences(
    castingSequences,
    SCRIPT_CASTING_ATOMIC_SHOTS_BATCH_SIZE
  );
  const batchIndexBySequenceId = new Map<unknown, number>();
  batches.forEach((batch, index) => {
    for (const sequence of batch)
      batchIndexBySequenceId.set(sequence.id, index);
  });
  const slicePerBatch = !regexSequences.length && batches.length > 1;
  const allGroups: JsonRecord[] = [];
  let lastError: unknown = null;
  let anyBatchSucceeded = false;
  for (const batch of batches) {
    const batchScriptText = slicePerBatch
      ? approximateLlmFallbackSlice(scriptText, castingSequences, batch)
      : scriptText;
    try {
      const parsed = await call({
        contents: buildAtomicShotsContents(
          batch,
          regexSequences,
          batchScriptText,
          dumpList(casting.characters),
          dumpList(casting.environments),
          dumpList(casting.props),
          options.separateStyle,
          options.separateCamera,
          options.includeDialogue,
          options.sequenceMode
        ),
        schema: ATOMIC_SHOTS_RESPONSE_SCHEMA,
        model: CastingModel.ScriptCastingAtomicShotsResult,
        stepLabel: "atomic shots step"
      });
      anyBatchSucceeded = true;
      allGroups.push(...dumpList(parsed.sequence_shots));
    } catch (error) {
      lastError = error;
    }
  }
  if (!anyBatchSucceeded) throw lastError;
  return finalizeAtomicShots(
    allGroups,
    castingSequences,
    batchIndexBySequenceId,
    options.sequenceMode
  );
};

/**
 * Read a script into a casting. Single call under the
 * word threshold, structure-then-prompts above it, then the optional
 * atomic-shots pass — which degrades to `shots_error` rather than failing a
 * casting that already succeeded.
 */
export const generateCasting = async (
  scriptText: string,
  call: StructuredCall,
  options: CastingOptions = {}
): Promise<JsonRecord> => {
  const resolved: Required<CastingOptions> = {
    shotLimit: options.shotLimit ?? null,
    atomicShots: !!options.atomicShots,
    splitAlts: !!options.splitAlts,
    separateStyle: !!options.separateStyle,
    separateCamera: !!options.separateCamera,
    includeDialogue: !!options.includeDialogue,
    sequenceMode: !!options.sequenceMode,
    singleCallMaxWords:
      options.singleCallMaxWords ?? SCRIPT_CASTING_SINGLE_CALL_MAX_WORDS
  };
  let regexSequences = parseSequences(scriptText);
  if (resolved.shotLimit && regexSequences.length)
    regexSequences = regexSequences.slice(0, resolved.shotLimit);
  const casting =
    effectiveWordCount(scriptText, regexSequences) <=
    resolved.singleCallMaxWords
      ? await singleCall(call, scriptText, regexSequences, resolved)
      : await twoCall(call, scriptText, regexSequences, resolved);
  if (resolved.atomicShots) {
    try {
      casting.shots = await generateAtomicShots(
        call,
        casting,
        regexSequences,
        scriptText,
        resolved
      );
    } catch (error) {
      casting.shots_error =
        error instanceof CastingCallError
          ? { message: error.message, error: error.detail }
          : {
              message: "Error generating casting (atomic shots step)",
              error: error instanceof Error ? error.message : String(error)
            };
    }
  }
  return casting;
};
