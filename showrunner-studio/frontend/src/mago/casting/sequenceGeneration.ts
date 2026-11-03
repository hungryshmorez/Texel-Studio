/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
/* oxlint-disable eslint/no-magic-numbers -- the costs, framing durations and windows are the backend's calibration, ported verbatim so the two can be diffed */
import {
  linePlaceholder,
  pythonRound,
  speechSeconds,
  textOf
} from "../vlm/dialogue";

import { CHARACTER_SLOT_CAP, type BreakdownShot } from "./scenarioShots";

/**
 * Render sequences: consecutive atomic beats packed into one video generation.
 * The backend, ported function for function
 * (same names in camelCase, same order) so the two can be diffed when the
 * backend moves. The rationale for every rule lives in that file's comments;
 * only what is specific to the port is noted here.
 */

type JsonRecord = Record<string, unknown>;

/** A beat as the packer sees it: a breakdown shot plus the packer's own fields. */
export type Beat = Partial<BreakdownShot> &
  JsonRecord & {
    _framing?: FramingEntry;
    _speech_continuation?: boolean;
  };

type FramingEntry = {
  framing: string;
  token: string | null;
  scripted: boolean;
};

export const DEFAULT_ENGINE = "v9.1.0";

const MAX_DIALOGUE_TURNS = 20;
const MAX_PROPS = 20;

const INTEGRATED_ENGINE_DURATION_BOUNDS: Record<string, [number, number]> = {
  seedance_2_5: [4, 30],
  minimax_h3_max: [5, 15]
};

const PLAN_MULTI_REFERENCE_LIMITS: Record<string, number> = {
  "v9.1.0": 9,
  seedance_2: 9,
  seedance_2_5: 9,
  minimax_h3_max: 12,
  happy_horse_1: 5,
  kling_o1: 2,
  kling_o3_edit_pro: 2
};
const PLAN_DEFAULT_REFERENCE_LIMIT = 1;
const planReferenceLimit = (engine: string): number =>
  PLAN_MULTI_REFERENCE_LIMITS[engine] ?? PLAN_DEFAULT_REFERENCE_LIMIT;

const BOUNDARY_COST_NEEDS_PREVIOUS_FRAME = 6.0;
const BOUNDARY_COST_MID_EXCHANGE = 4.0;
const BOUNDARY_COST_LOOP = 3.0;
const BOUNDARY_BONUS_SUBJECT_CHANGE = -1.5;
const BOUNDARY_BONUS_SPEECH_CHANGE = -1.2;
const BOUNDARY_BONUS_CAMERA_CHANGE = -1.0;

const REBALANCE_MAX_BEATS = 150;

const PAD_COST_PER_SECOND = 2.0;
const BALANCE_COST_PER_SECOND = 0.15;

const SPEECH_PACING_HEADROOM = 1.35;

const CAMERA_ACCENT_BEAT_TYPE = "push_in_emotional";

const DIALOGUE_COVERAGE_LADDER = [
  "a medium two-shot holding both speakers",
  "a closer single favouring the speaker, the other just in frame",
  "the reverse angle, favouring the listener as they answer",
  "a wider two-shot taking in the space around them"
];

const SHOT_FRAMINGS = [
  "wide",
  "full",
  "medium",
  "medium close-up",
  "close-up",
  "extreme close-up",
  "over-the-shoulder",
  "two-shot",
  "insert",
  "POV"
];

const FRAMING_ALIASES: Record<string, string> = {
  establishing: "wide",
  "wide shot": "wide",
  "full shot": "full",
  "medium close": "medium close-up",
  "mid shot": "medium",
  closeup: "close-up",
  "close shot": "close-up",
  "close on": "close-up",
  "extreme close": "extreme close-up",
  "over the shoulder": "over-the-shoulder",
  ots: "over-the-shoulder",
  "two shot": "two-shot",
  "point of view": "POV"
};

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/** Longest phrase first, so "extreme close-up" never resolves to "close-up".
 *  A stable sort, as Python's is. */
const FRAMING_LOOKUP: Array<[string, string]> = [
  ...SHOT_FRAMINGS.map((framing): [string, string] => [
    framing.toLowerCase(),
    framing
  ]),
  ...Object.entries(FRAMING_ALIASES)
].sort((left, right) => right[0].length - left[0].length);

const BOUNDED_FRAMING_PHRASES = new Set(["ots", "pov", "full", "wide"]);

const FRAMING_MATCHERS: Array<[RegExp, string]> = FRAMING_LOOKUP.map(
  ([phrase, framing]) => [
    new RegExp(
      BOUNDED_FRAMING_PHRASES.has(phrase)
        ? `\\b${escapeRegExp(phrase)}\\b`
        : escapeRegExp(phrase)
    ),
    framing
  ]
);

/** The vocabulary term `text` names, or null when it names none of them. */
export const normalizeFraming = (text: unknown): string | null => {
  const lowered = (typeof text === "string" ? text : "").toLowerCase();
  for (const [pattern, framing] of FRAMING_MATCHERS) {
    if (pattern.test(lowered)) return framing;
  }
  return null;
};

const DEFAULT_FRAMING_DURATIONS: Record<string, [number, number]> = {
  insert: [0.8, 1.5],
  "extreme close-up": [1.0, 2.0],
  "close-up": [1.5, 2.5],
  POV: [1.5, 3.0],
  "medium close-up": [2.0, 3.0],
  medium: [2.0, 4.0],
  "over-the-shoulder": [2.0, 4.0],
  "two-shot": [2.5, 4.5],
  full: [3.0, 5.0],
  wide: [3.0, 5.0]
};

const FRAMING_LADDERS: Record<"insert" | "single" | "pair", string[]> = {
  insert: ["insert", "extreme close-up"],
  single: ["close-up", "medium", "medium close-up", "wide"],
  pair: ["two-shot", "over-the-shoulder", "wide", "medium"]
};

const CASTING_DURATION_FLOOR = 1.5;
const CASTING_DURATION_CEILING = 4.0;

const DEFAULT_SEQUENCE_WINDOW: [number, number] = [5.0, 15.0];

export const engineDurationWindow = (
  engine?: string | null
): [number, number] => {
  const bounds = INTEGRATED_ENGINE_DURATION_BOUNDS[engine || DEFAULT_ENGINE];
  return bounds ? [bounds[0], bounds[1]] : DEFAULT_SEQUENCE_WINDOW;
};

/** Always: see the backend's docstring for why it is uniform across engines. */
const rendersWholeSeconds = (): boolean => true;

/** Python's `f"{value:g}"` for the magnitudes used here. */
export const formatG = (value: number): string =>
  Number.isInteger(value)
    ? String(value)
    : String(Number(value.toPrecision(6)));

/** Python's `str(value)` for the JSON scalars that reach generated text. */
const pyStr = (value: unknown): string => {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  return textOf(value);
};

/** Python's `str(float)`: a whole float still prints its ".0". */
const pyFloatStr = (value: number): string =>
  Number.isInteger(value) ? `${value}.0` : String(value);

const asSentence = (text: unknown): string => {
  const trimmed = (typeof text === "string" ? text : "").trim();
  if (!trimmed) return "";
  const capitalised = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return ".!?".includes(capitalised.at(-1)!) ? capitalised : `${capitalised}.`;
};

const collapseWhitespace = (text: string): string =>
  text.split(/\s+/).filter(Boolean).join(" ");

const isRealNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const tokens = (beat: Beat, key: string): string[] =>
  (Array.isArray(beat[key]) ? (beat[key] as unknown[]) : []).filter(
    (token): token is string => typeof token === "string" && !!token
  );

const durationPair = (beat: Beat): [number, number] | null => {
  const low = beat.duration_short_s;
  const high = beat.duration_long_s;
  if (!isRealNumber(low) || low <= 0) return null;
  return [low, isRealNumber(high) && high >= low ? high : low];
};

const turnsOf = (beat: Beat): JsonRecord[] =>
  (Array.isArray(beat.dialogue) ? (beat.dialogue as unknown[]) : []).filter(
    (turn): turn is JsonRecord =>
      !!turn &&
      typeof turn === "object" &&
      !Array.isArray(turn) &&
      typeof (turn as JsonRecord).line === "string" &&
      !!((turn as JsonRecord).line as string).trim()
  );

const requiredSpeech = (
  turns: JsonRecord[],
  headroom: number = SPEECH_PACING_HEADROOM
): number => {
  const seconds = speechSeconds(turns);
  return seconds ? pythonRound(seconds * headroom, 2) : 0;
};

const fillTurns = (
  turns: JsonRecord[],
  limit: number,
  headroom: number
): JsonRecord[][] => {
  const runs: JsonRecord[][] = [];
  let current: JsonRecord[] = [];
  for (const turn of turns) {
    const candidate = [...current, turn];
    if (current.length && requiredSpeech(candidate, headroom) > limit) {
      runs.push(current);
      current = [turn];
    } else {
      current = candidate;
    }
  }
  if (current.length) runs.push(current);
  return runs;
};

const splitTurnsForSpeech = (
  turns: JsonRecord[],
  maxS: number,
  headroom: number
): JsonRecord[][] => {
  const runs = fillTurns(turns, maxS, headroom);
  if (runs.length < 2) return runs;
  let low = 0;
  let high = maxS;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (fillTurns(turns, middle, headroom).length <= runs.length) high = middle;
    else low = middle;
  }
  const balanced = fillTurns(turns, high, headroom);
  return balanced.length === runs.length ? balanced : runs;
};

const splitBeatsForSpeech = (
  beats: Beat[],
  maxS: number,
  headroom: number
): Beat[] => {
  const out: Beat[] = [];
  for (const beat of beats) {
    const turns = turnsOf(beat);
    if (!turns.length || requiredSpeech(turns, headroom) <= maxS) {
      out.push(beat);
      continue;
    }
    const runs = splitTurnsForSpeech(turns, maxS, headroom);
    if (runs.length < 2) {
      out.push(beat);
      continue;
    }
    const [natural, held] = durationPair(beat)!;
    const ratio = held / natural;
    runs.forEach((run, index) => {
      const low = requiredSpeech(run, headroom);
      out.push({
        ...beat,
        key: beat.key ? `${textOf(beat.key)}#${index + 1}` : beat.key,
        dialogue: run,
        speech_s: speechSeconds(run),
        duration_short_s: low,
        duration_long_s: pythonRound(low * ratio, 2),
        _speech_continuation: index > 0
      });
    });
  }
  return out;
};

const isSubset = (small: string[], large: string[]): boolean => {
  const set = new Set(large);
  return small.every((item) => set.has(item));
};

const locationCompatible = (group: string[], beat: string[]): boolean => {
  if (!beat.length || !group.length) return true;
  return isSubset(group, beat) || isSubset(beat, group);
};

const mergedLocation = (group: string[], beat: string[]): string[] => {
  if (!beat.length) return [...group];
  if (!group.length) return [...beat];
  return isSubset(beat, group) ? [...beat] : [...group];
};

const runLocation = (beats: Beat[]): string[] | null => {
  let location: string[] = [];
  for (const beat of beats) {
    const environments = tokens(beat, "environment_tokens");
    if (!locationCompatible(location, environments)) return null;
    location = mergedLocation(location, environments);
  }
  return location;
};

const union = (beats: Beat[], key: string): string[] => {
  const seen: string[] = [];
  for (const beat of beats) {
    for (const token of tokens(beat, key)) {
      if (!seen.includes(token)) seen.push(token);
    }
  }
  return seen;
};

type TokenUnion = [string[], string[], string[]];

const unionTokens = (beats: Beat[]): TokenUnion => [
  union(beats, "character_tokens"),
  union(beats, "environment_tokens"),
  union(beats, "prop_tokens")
];

const capacityError = (
  beats: Beat[],
  referenceBudget: number,
  given?: TokenUnion
): string | null => {
  const [characters, environments, props] = given ?? unionTokens(beats);
  if (characters.length > CHARACTER_SLOT_CAP)
    return `${characters.length} characters (max ${CHARACTER_SLOT_CAP} reference slots)`;
  const extraEnvironments = Math.max(0, environments.length - 1);
  if (props.length + extraEnvironments > MAX_PROPS) {
    let counted = `${props.length} props`;
    if (extraEnvironments)
      counted += ` + ${extraEnvironments} extra environments`;
    return `${counted} (max ${MAX_PROPS})`;
  }
  const total = characters.length + environments.length + props.length;
  if (total > referenceBudget)
    return `${total} references (max ${referenceBudget})`;
  return null;
};

type Group = {
  beats: Beat[];
  sequence_id: unknown;
  heading: unknown;
  natural: number;
  turns: JsonRecord[];
  environments: string[];
};

type PackLimits = { maxS: number; referenceBudget: number; maxTurns: number };

type SceneScope = { sequence_id?: unknown; heading?: unknown };

/** One sequence, one heading. */
const sameSceneScope = (left: SceneScope, right: SceneScope): boolean =>
  (left.sequence_id ?? null) === (right.sequence_id ?? null) &&
  (left.heading ?? null) === (right.heading ?? null);

const groupAdmits = (group: Group, beat: Beat, limits: PackLimits): boolean => {
  if (!sameSceneScope(beat, group)) return false;
  if (
    !locationCompatible(group.environments, tokens(beat, "environment_tokens"))
  )
    return false;
  const pair = durationPair(beat);
  if (pair === null) return false;
  if (group.natural + pair[0] > limits.maxS) return false;
  if (requiredSpeech([...group.turns, ...turnsOf(beat)]) > limits.maxS)
    return false;
  if (capacityError([...group.beats, beat], limits.referenceBudget))
    return false;
  if (group.turns.length + turnsOf(beat).length > limits.maxTurns) return false;
  return true;
};

const greedyGroups = (beats: Beat[], limits: PackLimits): Group[] => {
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const beat of beats) {
    if (current && groupAdmits(current, beat, limits)) {
      current.beats.push(beat);
      current.natural += durationPair(beat)![0];
      current.turns.push(...turnsOf(beat));
      current.environments = mergedLocation(
        current.environments,
        tokens(beat, "environment_tokens")
      );
      continue;
    }
    const pair = durationPair(beat);
    current = {
      beats: [beat],
      sequence_id: beat.sequence_id ?? null,
      heading: beat.heading ?? null,
      natural: pair ? pair[0] : 0,
      turns: [...turnsOf(beat)],
      environments: [...tokens(beat, "environment_tokens")]
    };
    groups.push(current);
  }
  return groups;
};

const DRAMATIC_MOVEMENT_WORDS = [
  "crane",
  "craning",
  "boom",
  "jib",
  "dolly",
  "tracking",
  "track",
  "steadicam",
  "handheld",
  "whip",
  "swish",
  "orbit",
  "arc",
  "spin",
  "push",
  "pull",
  "zoom",
  "tilt",
  "pan",
  "rise",
  "rising",
  "descend",
  "drop",
  "sweep"
];

const DRAMATIC_MOVEMENT_RE = new RegExp(
  `\\b(?:${DRAMATIC_MOVEMENT_WORDS.map(escapeRegExp).join("|")})`
);

const fieldText = (value: unknown): string => textOf(value).trim();

const cameraRecord = (beat: Beat): JsonRecord | null =>
  beat.camera && typeof beat.camera === "object" && !Array.isArray(beat.camera)
    ? (beat.camera as JsonRecord)
    : null;

export const cameraText = (beat: Beat): string => {
  const camera = cameraRecord(beat);
  if (camera) {
    return ["framing", "movement", "lens"]
      .map((field) => fieldText(camera[field]))
      .filter(Boolean)
      .join(", ");
  }
  return fieldText(beat.camera);
};

const cameraMovement = (beat: Beat): string => {
  const camera = cameraRecord(beat);
  return camera ? fieldText(camera.movement) : cameraText(beat);
};

const framingWithoutMovement = (beat: Beat): string => {
  const camera = cameraRecord(beat);
  if (camera) {
    return ["framing", "lens"]
      .map((field) => fieldText(camera[field]))
      .filter(Boolean)
      .join(", ");
  }
  return cameraText(beat);
};

const isDramaticMove = (text: string): boolean =>
  DRAMATIC_MOVEMENT_RE.test((text || "").toLowerCase());

const NO_MOVEMENT = new Set([
  "static",
  "none",
  "locked off",
  "locked-off",
  "no movement"
]);

const scriptedMove = (beat: Beat): string => {
  const camera = cameraRecord(beat);
  if (!camera?.from_script) return "";
  const movement = fieldText(camera.movement);
  return NO_MOVEMENT.has(movement.toLowerCase()) ? "" : movement;
};

const narratesCamera = (beat: Beat): boolean =>
  /\bcamera\b/i.test(beatProse(beat));

const scriptedFraming = (beat: Beat): string => {
  const camera = cameraRecord(beat);
  return camera ? fieldText(camera.framing) : cameraText(beat);
};

const cameraSignature = (beat: Beat): string =>
  `${cameraText(beat).toLowerCase()}\u0000${textOf(beat.beat_type)}`;

const sameSet = (left: string[], right: string[]): boolean => {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((item) => b.has(item));
};

const boundaryCost = (before: Beat, after: Beat): number => {
  let cost = 0;
  if (after.needs_previous_frame) cost += BOUNDARY_COST_NEEDS_PREVIOUS_FRAME;
  const speakingBefore = turnsOf(before).length > 0;
  const speakingAfter = turnsOf(after).length > 0;
  if (speakingBefore && speakingAfter) cost += BOUNDARY_COST_MID_EXCHANGE;
  else if (speakingBefore !== speakingAfter)
    cost += BOUNDARY_BONUS_SPEECH_CHANGE;
  const subjectsChanged = !sameSet(
    tokens(before, "character_tokens"),
    tokens(after, "character_tokens")
  );
  const cameraChanged = cameraSignature(before) !== cameraSignature(after);
  if (subjectsChanged) cost += BOUNDARY_BONUS_SUBJECT_CHANGE;
  if (cameraChanged) cost += BOUNDARY_BONUS_CAMERA_CHANGE;
  if (!subjectsChanged && !cameraChanged) cost += BOUNDARY_COST_LOOP;
  return cost;
};

const groupCost = (
  beats: Beat[],
  minS: number,
  ideal: number,
  natural?: number
): number => {
  const total =
    natural ?? beats.reduce((sum, beat) => sum + durationPair(beat)![0], 0);
  const pad = Math.max(0, minS - total);
  return (
    PAD_COST_PER_SECOND * pad +
    BALANCE_COST_PER_SECOND * Math.abs(total - ideal)
  );
};

const rebalance = (
  beats: Beat[],
  count: number,
  minS: number,
  limits: PackLimits
): Beat[][] | null => {
  const n = beats.length;
  if (count <= 1 || count >= n) return null;
  if (n > REBALANCE_MAX_BEATS) return null;

  const ideal =
    beats.reduce((sum, beat) => sum + durationPair(beat)![0], 0) / count;

  const feasible = new Map<string, number>();
  for (let start = 0; start < n; start += 1) {
    let natural = 0;
    const turns: JsonRecord[] = [];
    let turnCount = 0;
    for (let end = start + 1; end <= n; end += 1) {
      const beat = beats[end - 1]!;
      const pair = durationPair(beat);
      if (pair === null) break;
      natural += pair[0];
      if (natural > limits.maxS) break;
      turns.push(...turnsOf(beat));
      turnCount += turnsOf(beat).length;
      if (turnCount > limits.maxTurns) break;
      if (requiredSpeech(turns) > limits.maxS) break;
      const window = beats.slice(start, end);
      if (capacityError(window, limits.referenceBudget)) break;
      if (runLocation(window) === null) break;
      feasible.set(`${start},${end}`, groupCost(window, minS, ideal, natural));
    }
  }

  const best = new Map<string, number>([["0,0", 0]]);
  const back = new Map<string, number>();
  for (let groupsUsed = 1; groupsUsed <= count; groupsUsed += 1) {
    for (let end = 1; end <= n; end += 1) {
      for (let start = 0; start < end; start += 1) {
        const previous = best.get(`${start},${groupsUsed - 1}`);
        const window = feasible.get(`${start},${end}`);
        if (previous === undefined || window === undefined) continue;
        let cost = previous + window;
        if (start > 0) cost += boundaryCost(beats[start - 1]!, beats[start]!);
        if (cost < (best.get(`${end},${groupsUsed}`) ?? Infinity)) {
          best.set(`${end},${groupsUsed}`, cost);
          back.set(`${end},${groupsUsed}`, start);
        }
      }
    }
  }
  if (!best.has(`${n},${count}`)) return null;

  const bounds: Array<[number, number]> = [];
  let end = n;
  let groupsUsed = count;
  while (groupsUsed) {
    const start = back.get(`${end},${groupsUsed}`)!;
    bounds.push([start, end]);
    end = start;
    groupsUsed -= 1;
  }
  return bounds.reverse().map(([start, stop]) => beats.slice(start, stop));
};

const targetDuration = (
  beats: Beat[],
  minS: number,
  maxS: number,
  wholeSeconds: boolean
): [number, number, string[]] => {
  const warnings: string[] = [];
  const pairs = beats.map((beat) => durationPair(beat)!);
  const natural = pairs.reduce((sum, pair) => sum + pair[0], 0);
  const ceiling = pairs.reduce((sum, pair) => sum + pair[1], 0);
  const turns = beats.flatMap((beat) => turnsOf(beat));
  const speech = speechSeconds(turns);
  const required = requiredSpeech(turns);

  let target = natural;
  if (target < minS) {
    target = Math.min(minS, ceiling);
    if (target < minS) {
      warnings.push(
        `padded ${pyFloatStr(pythonRound(minS - ceiling, 2))}s to reach the ${formatG(minS)}s minimum: this ` +
          `sequence's beats are only ${pyFloatStr(pythonRound(ceiling, 2))}s even fully held`
      );
      target = minS;
    }
  }
  target = Math.max(target, required);

  if (target > maxS) {
    target = maxS;
    if (required > maxS) {
      warnings.push(
        `these lines need about ${pyFloatStr(required)}s to be delivered at a natural pace but ` +
          `the clip is capped at ${formatG(maxS)}s; they will sound rushed or be cut off — ` +
          `shorten them`
      );
    }
  }

  if (wholeSeconds) {
    const floor = Math.min(Math.max(required, natural), maxS);
    const snapped = pythonRound(target, 0);
    target = Math.min(
      Math.max(snapped >= floor ? snapped : Math.ceil(floor), minS),
      maxS
    );
  } else {
    target = pythonRound(target, 2);
  }
  return [target, pythonRound(speech, 2), warnings];
};

const distribute = (beats: Beat[], target: number): [number[], number[]] => {
  const pairs = beats.map((beat) => durationPair(beat)!);
  const natural = pairs.reduce((sum, pair) => sum + pair[0], 0);
  const slackTotal = pairs.reduce((sum, pair) => sum + (pair[1] - pair[0]), 0);
  let extra = target - natural;

  let shares = pairs.map((pair) => pair[0]);
  if (extra < 0 && natural > 0) {
    shares = shares.map((share) => (share * target) / natural);
    extra = 0;
  }
  if (extra > 0 && slackTotal > 0) {
    const usable = Math.min(extra, slackTotal);
    pairs.forEach(([low, high], index) => {
      shares[index] = low + ((high - low) / slackTotal) * usable;
    });
    extra -= usable;
  }
  if (Math.abs(extra) > 0.001) {
    shares[shares.length - 1] = Math.max(
      pairs[pairs.length - 1]![0],
      shares[shares.length - 1]! + extra
    );
  }

  const offsets: number[] = [];
  let running = 0;
  for (const share of shares) {
    offsets.push(pythonRound(running, 3));
    running += share;
  }
  return [shares.map((share) => pythonRound(share, 3)), offsets];
};

const framingLadderFor = (beat: Beat): "insert" | "single" | "pair" => {
  const people = tokens(beat, "character_tokens").length;
  if (!people) return "insert";
  return people === 1 ? "single" : "pair";
};

const framedDuration = (
  beat: Beat,
  token: string | null,
  budget: Record<string, [number, number]> | null
): [number, number] | null => {
  const pair = durationPair(beat);
  if (pair === null || !token || !budget) return pair;
  const span = budget[token];
  if (!span) return pair;
  const [low, high] = span;
  let position =
    (pair[0] - CASTING_DURATION_FLOOR) /
    (CASTING_DURATION_CEILING - CASTING_DURATION_FLOOR);
  position = Math.min(Math.max(position, 0), 1);
  const speech = requiredSpeech(turnsOf(beat));
  const natural = Math.max(low + position * (high - low), speech);
  const held = Math.max(natural, high);
  return [pythonRound(natural, 2), pythonRound(held, 2)];
};

const resolveShotFramings = (
  beats: Beat[],
  previousFraming: string | null,
  budget: Record<string, [number, number]> | null
): Beat[] => {
  const steps = { insert: 0, single: 0, pair: 0 };
  let previous = previousFraming;
  const out: Beat[] = [];
  for (const beat of beats) {
    const scripted = scriptedFraming(beat).trim();
    let entry: FramingEntry;
    if (scripted) {
      const token = normalizeFraming(scripted);
      previous = token || previous;
      const display = isDramaticMove(scripted) ? (token ?? "") : scripted;
      entry = { framing: display, token, scripted: true };
    } else {
      const kind = framingLadderFor(beat);
      const ladder = FRAMING_LADDERS[kind];
      let token = ladder[steps[kind] % ladder.length]!;
      steps[kind] += 1;
      if (token === previous && ladder.length > 1) {
        token = ladder[steps[kind] % ladder.length]!;
        steps[kind] += 1;
      }
      previous = token;
      entry = { framing: token, token, scripted: false };
    }
    const framed = framedDuration(beat, entry.token, budget);
    out.push({
      ...beat,
      _framing: entry,
      duration_short_s: framed ? framed[0] : beat.duration_short_s,
      duration_long_s: framed ? framed[1] : beat.duration_long_s
    });
  }
  return out;
};

const lastFramingOf = (beats: Beat[]): string | null =>
  beats.length ? (beats[beats.length - 1]!._framing?.token ?? null) : null;

const groupCoverage = (beats: Beat[]): FramingEntry[] =>
  beats.length < 2
    ? []
    : beats.map(
        (beat) => beat._framing ?? { framing: "", token: null, scripted: false }
      );

export type CameraPlan = {
  baseline: string | null;
  accent: string | null;
  accent_move: string | null;
  accent_key: string | null;
  accent_beat_index: number | null;
  moves: Record<number, string>;
  extracted: boolean;
  coverage: FramingEntry[];
  dropped_move: string | null;
};

const cameraPlan = (
  beats: Beat[],
  previousAccent: string | null,
  allowMove = true
): CameraPlan => {
  const extracted = beats
    .map((beat, index): [number, string] => [index, cameraText(beat)])
    .filter(([, text]) => !!text);
  const scripted = new Map<number, string>();
  beats.forEach((beat, index) => {
    const movement = scriptedMove(beat);
    if (movement) scripted.set(index, movement);
  });
  const dramatic = extracted.filter(
    ([index]) =>
      !scripted.has(index) && isDramaticMove(cameraMovement(beats[index]!))
  );

  let baseline: string | null = null;
  if (extracted.length) {
    const held = extracted
      .filter(([index]) => !isDramaticMove(cameraMovement(beats[index]!)))
      .map(([, text]) => text);
    baseline = held.length
      ? held[0]!
      : framingWithoutMovement(beats[extracted[0]![0]]!);
  }

  const coverage = groupCoverage(beats);

  if (scripted.size) {
    const first = Math.min(...scripted.keys());
    const firstMove = scripted.get(first)!;
    return {
      baseline,
      accent: firstMove,
      accent_move: firstMove,
      accent_key: `move:${firstMove.toLowerCase()}`,
      accent_beat_index: first,
      moves: Object.fromEntries(scripted),
      extracted: extracted.length > 0,
      coverage,
      dropped_move: dramatic[0]?.[1] ?? null
    };
  }

  let accentIndex: number | null;
  let accent: string | null;
  let accentMove: string | null = null;
  let accentKey: string;
  if (dramatic.length) {
    [accentIndex, accent] = dramatic[0]!;
    accentMove = cameraMovement(beats[accentIndex]!) || null;
    accentKey = `move:${cameraMovement(beats[accentIndex]!).toLowerCase()}`;
  } else {
    let candidate: number | null = beats.findIndex(
      (beat) => beat.beat_type === CAMERA_ACCENT_BEAT_TYPE
    );
    if (candidate < 0) candidate = null;
    if (candidate === null) {
      // Python's `max` returns the first maximal element, so ties keep the earliest.
      let bestSpeech = -Infinity;
      beats.forEach((beat, index) => {
        if (!turnsOf(beat).length) return;
        const seconds = speechSeconds(turnsOf(beat));
        if (seconds > bestSpeech) {
          bestSpeech = seconds;
          candidate = index;
        }
      });
    }
    if (candidate === null) {
      let bestHeld = -Infinity;
      beats.forEach((beat, index) => {
        const held = (durationPair(beat) ?? [0, 0])[1];
        if (held > bestHeld) {
          bestHeld = held;
          candidate = index;
        }
      });
    }
    accentIndex = candidate;
    accent = null;
    accentKey = `beat_type:${textOf(beats[candidate!]!.beat_type) || "default"}`;
  }

  const droppedMove = accent !== null && !allowMove ? accent : null;
  if (droppedMove || (previousAccent && accentKey === previousAccent)) {
    return {
      baseline,
      accent: null,
      accent_move: null,
      accent_key: null,
      accent_beat_index: null,
      moves: {},
      extracted: extracted.length > 0,
      coverage,
      dropped_move: droppedMove
    };
  }
  const moves =
    accentIndex !== null && accentMove ? { [accentIndex]: accentMove } : {};
  return {
    baseline,
    accent,
    accent_move: accentMove,
    accent_key: accentKey,
    accent_beat_index: accentIndex,
    moves,
    extracted: extracted.length > 0,
    coverage,
    dropped_move: null
  };
};

const moveAllowed = (
  sequenceId: unknown,
  sequencesThatMoved: Set<unknown>,
  previousSceneMoved: boolean
): boolean => !previousSceneMoved && !sequencesThatMoved.has(sequenceId);

const STATIC_CAMERA = "The camera holds steady with no added movement";

const beatProse = (beat: Beat): string =>
  fieldText(beat.action) || fieldText(beat.video_prompt);

const MID_EXCHANGE_OPENING =
  "They are already mid-conversation as the shot opens.";

const openedMidExchange = (beats: Beat[], parts: string[]): string[] =>
  beats[0]?._speech_continuation ? [MID_EXCHANGE_OPENING, ...parts] : parts;

const spokenHere = (beat: Beat, firstIndex: number): string => {
  const placed = turnsOf(beat).map(
    (turn, offset) =>
      `${(textOf(turn.speaker) || "A voice").trim()}: ${linePlaceholder(firstIndex + offset)}`
  );
  return placed.length ? ` ${placed.join(" ")}` : "";
};

const coverageProse = (
  beats: Beat[],
  camera: CameraPlan,
  shares: number[],
  offsets: number[]
): string => {
  const cuts: string[] = [];
  let spokenSoFar = 0;
  beats.forEach((beat, index) => {
    const start = pythonRound(offsets[index]!, 1);
    const end = pythonRound(offsets[index]! + shares[index]!, 1);
    const keptMove = camera.moves[index];
    const move = keptMove
      ? ` The camera move: ${keptMove}.`
      : narratesCamera(beat)
        ? ""
        : ` ${STATIC_CAMERA}.`;
    const framing = camera.coverage.length
      ? (camera.coverage[index]?.framing ?? "")
      : "";
    const heading =
      `[Shot ${index + 1}] (${formatG(start)}-${formatG(end)}s) ` +
      `${asSentence(framing)} ${asSentence(beatProse(beat))}${move}` +
      spokenHere(beat, spokenSoFar + 1);
    spokenSoFar += turnsOf(beat).length;
    cuts.push(collapseWhitespace(heading));
  });
  return openedMidExchange(beats, cuts).join("\n");
};

const mergeProse = (
  beats: Beat[],
  camera: CameraPlan,
  shares: number[] | null,
  offsets: number[] | null = null,
  coverage: string | null = null
): string => {
  if (camera.coverage.length && offsets !== null && shares !== null)
    return coverageProse(beats, camera, shares, offsets);

  const parts: string[] = [];
  for (const beat of beats) {
    const prose = beatProse(beat);
    if (prose) parts.push(asSentence(prose));
  }
  const body = openedMidExchange(beats, parts).join(" ");

  const baseline = camera.extracted ? camera.baseline : null;
  const statesMove = !!(
    camera.extracted &&
    camera.accent &&
    camera.accent !== camera.baseline
  );
  const framing = baseline || (statesMove ? null : coverage);
  const sentences = [body];
  if (framing) sentences.push(`Camera: ${framing}.`);
  if (statesMove) sentences.push(`The camera move: ${camera.accent}.`);
  return sentences.filter(Boolean).join(" ").trim();
};

const sequenceKey = (
  beats: Beat[],
  sequenceId: unknown,
  ordinal: number
): unknown => {
  const key = beats[0]?.key;
  if (beats.length === 1 && key !== null && key !== undefined && key !== "")
    return key;
  return `rseq_${pyStr(sequenceId)}_${ordinal}`;
};

export type RenderSequence = {
  key: unknown;
  sequence_id: unknown;
  heading: unknown;
  shot_keys: unknown[];
  video_prompt: string;
  dialogue: JsonRecord[];
  duration_s: number | null;
  speech_s: number;
  needs_previous_frame: boolean;
  character_tokens: string[];
  environment_tokens: string[];
  prop_tokens: string[];
  camera: CameraPlan;
  _beats: Beat[];
  warnings: string[];
};

const calibratedRuns = (shots: Beat[]): Array<[boolean, Beat[]]> => {
  const runs: Array<[boolean, Beat[]]> = [];
  let current: Beat[] = [];
  for (const beat of shots) {
    if (durationPair(beat) === null) {
      if (current.length) {
        runs.push([true, current]);
        current = [];
      }
      runs.push([false, [beat]]);
    } else {
      current.push(beat);
    }
  }
  if (current.length) runs.push([true, current]);
  return runs;
};

const balancedGroups = (
  beats: Beat[],
  minS: number,
  limits: PackLimits
): Beat[][] => {
  const groups = greedyGroups(beats, limits);
  const balanced: Beat[][] = [];
  let runStart = 0;
  while (runStart < groups.length) {
    let runEnd = runStart + 1;
    let location = [...groups[runStart]!.environments];
    while (runEnd < groups.length) {
      const candidate = groups[runEnd]!;
      if (
        !sameSceneScope(candidate, groups[runStart]!) ||
        !locationCompatible(location, candidate.environments)
      )
        break;
      location = mergedLocation(location, candidate.environments);
      runEnd += 1;
    }
    const run = groups.slice(runStart, runEnd).flatMap((group) => group.beats);
    const count = runEnd - runStart;
    const recut = rebalance(run, count, minS, limits);
    balanced.push(
      ...(recut ?? groups.slice(runStart, runEnd).map((group) => group.beats))
    );
    runStart = runEnd;
  }
  return balanced;
};

/** Why these beats cannot be one scene, or null. */
const sceneError = (beats: Beat[], limits: PackLimits): string | null => {
  if (runLocation(beats) === null) return "two locations";
  const capacity = capacityError(beats, limits.referenceBudget);
  if (capacity) return capacity;
  const turns = beats.flatMap((beat) => turnsOf(beat));
  if (turns.length > limits.maxTurns)
    return `${turns.length} dialogue turns (max ${limits.maxTurns})`;
  const natural = beats.reduce((sum, beat) => sum + durationPair(beat)![0], 0);
  if (natural > limits.maxS)
    return `${pyFloatStr(pythonRound(natural, 2))}s of shots (max ${formatG(limits.maxS)}s)`;
  const required = requiredSpeech(turns);
  if (required > limits.maxS)
    return `${pyFloatStr(required)}s of speech (max ${formatG(limits.maxS)}s)`;
  return null;
};

/**
 * Collapse adjacent floor-padded scenes so the planned
 * total lands as close to the target as the legal merges allow.
 */
const mergeTowardTarget = (
  units: Array<[boolean, Beat[]]>,
  targetS: unknown,
  minS: number,
  limits: PackLimits,
  wholeSeconds: boolean
): Array<[boolean, Beat[]]> => {
  if (typeof targetS !== "number" || Number.isNaN(targetS) || targetS <= 0)
    return units;

  const targetOf = (beats: Beat[]): number =>
    targetDuration(beats, minS, limits.maxS, wholeSeconds)[0];

  const merged = [...units];
  const targets = merged.map(([calibrated, beats]) =>
    calibrated ? targetOf(beats) : 0
  );
  let current = targets.reduce((sum, target) => sum + target, 0);

  while (current > targetS) {
    let bestIndex: number | null = null;
    let bestDistance = current - targetS;
    let bestTarget = 0;
    for (let index = 0; index < merged.length - 1; index += 1) {
      const [calibratedBefore, beatsBefore] = merged[index]!;
      const [calibratedAfter, beatsAfter] = merged[index + 1]!;
      if (!(calibratedBefore && calibratedAfter)) continue;
      if (!sameSceneScope(beatsBefore[0]!, beatsAfter[0]!)) continue;
      const mergedBeats = [...beatsBefore, ...beatsAfter];
      if (sceneError(mergedBeats, limits)) continue;
      const mergedTarget = targetOf(mergedBeats);
      const distance = Math.abs(
        current -
          (targets[index]! + targets[index + 1]! - mergedTarget) -
          targetS
      );
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
        bestTarget = mergedTarget;
      }
    }
    if (bestIndex === null) break;
    current += bestTarget - targets[bestIndex]! - targets[bestIndex + 1]!;
    merged.splice(bestIndex, 2, [
      true,
      [...merged[bestIndex]![1], ...merged[bestIndex + 1]![1]]
    ]);
    targets.splice(bestIndex, 2, bestTarget);
  }
  return merged;
};

const uncalibratedSequence = (
  beat: Beat,
  camera: CameraPlan
): RenderSequence => ({
  key: beat.key ?? null,
  sequence_id: beat.sequence_id ?? null,
  heading: beat.heading ?? null,
  shot_keys: [beat.key ?? null],
  video_prompt: mergeProse([beat], camera, null),
  dialogue: turnsOf(beat),
  duration_s: null,
  speech_s: speechSeconds(turnsOf(beat)),
  needs_previous_frame: !!beat.needs_previous_frame,
  character_tokens: tokens(beat, "character_tokens"),
  environment_tokens: tokens(beat, "environment_tokens"),
  prop_tokens: tokens(beat, "prop_tokens"),
  camera,
  _beats: [beat],
  warnings: [
    "this beat carries no calibrated duration, so it is rendered on its own"
  ]
});

const sequencesFrom = (
  units: Array<[boolean, Beat[]]>,
  minS: number,
  maxS: number,
  referenceBudget: number,
  wholeSeconds: boolean
): RenderSequence[] => {
  const packed: RenderSequence[] = [];
  const ordinals = new Map<unknown, number>();
  let previousAccent: string | null = null;
  const sequencesThatMoved = new Set<unknown>();
  let previousSceneMoved = false;
  let coverageIndex = 0;

  const spendCamera = (beats: Beat[]): CameraPlan => {
    const sequenceId = beats[0]?.sequence_id ?? null;
    const camera = cameraPlan(
      beats,
      previousAccent,
      moveAllowed(sequenceId, sequencesThatMoved, previousSceneMoved)
    );
    previousAccent = camera.accent_key;
    previousSceneMoved =
      camera.accent !== null || Object.keys(camera.moves).length > 0;
    if (previousSceneMoved) sequencesThatMoved.add(sequenceId);
    return camera;
  };

  const droppedMoveWarnings = (camera: CameraPlan): string[] =>
    camera.dropped_move
      ? [
          `camera move '${camera.dropped_move}' dropped: the script did not ask for it, and ` +
            "an added move is limited to one per sequence, never next to a scripted move or " +
            "in two scenes in a row"
        ]
      : [];

  for (const [calibrated, beats] of units) {
    if (!calibrated) {
      const camera = spendCamera(beats);
      const scene = uncalibratedSequence(beats[0]!, camera);
      scene.warnings.push(...droppedMoveWarnings(camera));
      packed.push(scene);
      coverageIndex = 0;
      continue;
    }
    const sequenceId = beats[0]!.sequence_id ?? null;
    ordinals.set(sequenceId, (ordinals.get(sequenceId) ?? 0) + 1);
    const [target, speech, durationWarnings] = targetDuration(
      beats,
      minS,
      maxS,
      wholeSeconds
    );
    const warnings = [
      ...((beats[0]!._grouping_warnings as string[] | undefined) ?? []),
      ...durationWarnings
    ];
    const [shares, offsets] = distribute(beats, target);
    const camera = spendCamera(beats);
    warnings.push(...droppedMoveWarnings(camera));

    if (beats[0]!._speech_continuation) coverageIndex += 1;
    else coverageIndex = 0;
    const coverage = coverageIndex
      ? DIALOGUE_COVERAGE_LADDER[
          coverageIndex % DIALOGUE_COVERAGE_LADDER.length
        ]!
      : null;

    const union = unionTokens(beats);
    const capacity = capacityError(beats, referenceBudget, union);
    if (capacity)
      warnings.push(
        `this sequence needs ${capacity}; some references will be gridded or dropped`
      );

    packed.push({
      key: sequenceKey(beats, sequenceId, ordinals.get(sequenceId)!),
      sequence_id: sequenceId,
      heading: beats[0]!.heading ?? null,
      shot_keys: beats.map((beat) => beat.key ?? null),
      video_prompt: mergeProse(beats, camera, shares, offsets, coverage),
      dialogue: beats.flatMap((beat) => turnsOf(beat)),
      duration_s: target,
      speech_s: speech,
      needs_previous_frame: !!beats[0]!.needs_previous_frame,
      character_tokens: union[0],
      environment_tokens: union[1],
      prop_tokens: union[2],
      camera,
      _beats: beats.map((beat, index) => ({
        ...beat,
        duration_s: shares[index],
        cut_offset_s: offsets[index]
      })),
      warnings
    });
  }
  return packed;
};

/** Group atomic beats into render sequences. */
export const packRenderSequences = (
  shots: Beat[],
  options: {
    engine?: string | null;
    minS?: number;
    maxS?: number;
    referenceBudget?: number;
    maxTurns?: number;
    framingDurations?: Record<string, [number, number]> | false;
    targetDurationS?: number | null;
  } = {}
): RenderSequence[] => {
  const engine = options.engine || DEFAULT_ENGINE;
  const [windowMin, windowMax] = engineDurationWindow(engine);
  const minS = options.minS ?? windowMin;
  const maxS = options.maxS ?? windowMax;
  const limits: PackLimits = {
    maxS,
    referenceBudget: options.referenceBudget ?? planReferenceLimit(engine),
    maxTurns: options.maxTurns ?? MAX_DIALOGUE_TURNS
  };
  const wholeSeconds = rendersWholeSeconds();
  const budget =
    options.framingDurations === false
      ? null
      : { ...DEFAULT_FRAMING_DURATIONS, ...(options.framingDurations ?? {}) };

  const balanced: Array<[boolean, Beat[]]> = [];
  let previousFraming: string | null = null;
  for (const [calibrated, run] of calibratedRuns(shots ?? [])) {
    if (!calibrated) {
      balanced.push([false, run]);
      previousFraming = null;
      continue;
    }
    const prepared = resolveShotFramings(
      splitBeatsForSpeech(run, maxS, SPEECH_PACING_HEADROOM),
      previousFraming,
      budget
    );
    previousFraming = lastFramingOf(prepared) ?? previousFraming;
    for (const group of balancedGroups(prepared, minS, limits)) {
      balanced.push([true, group]);
    }
  }
  return sequencesFrom(
    mergeTowardTarget(
      balanced,
      options.targetDurationS,
      minS,
      limits,
      wholeSeconds
    ),
    minS,
    maxS,
    limits.referenceBudget,
    wholeSeconds
  );
};

export type PackedShot = {
  index: number;
  key: unknown;
  sequence_id: unknown;
  heading: unknown;
  action: string;
  video_prompt: string;
  character_tokens: string[];
  environment_tokens: string[];
  prop_tokens: string[];
  needs_previous_frame: boolean;
  dialogue: JsonRecord[];
  speech_s: number;
  duration_short_s: number | null;
  duration_long_s: number | null;
};

/**
 * Beats packed into render sequences, in the shape a
 * breakdown's `shots[]` already has, plus the warnings each sequence raised and
 * the planned total length.
 */
export const packedBreakdownShots = (
  shots: Beat[],
  engine?: string | null,
  targetDurationS?: number | null
): [PackedShot[], Array<{ key: unknown; warnings: string[] }>, number] => {
  const packed = packRenderSequences(shots ?? [], { engine, targetDurationS });
  const warnings = packed
    .filter((sequence) => sequence.warnings.length)
    .map((sequence) => ({
      key: sequence.key,
      warnings: [...sequence.warnings]
    }));
  const plannedTotalS = pythonRound(
    packed.reduce((sum, sequence) => sum + (sequence.duration_s || 0), 0),
    2
  );
  return [
    packed.map((sequence, index) => ({
      index,
      key: sequence.key,
      sequence_id: sequence.sequence_id,
      heading: sequence.heading,
      action: sequence.video_prompt,
      video_prompt: sequence.video_prompt,
      character_tokens: sequence.character_tokens,
      environment_tokens: sequence.environment_tokens,
      prop_tokens: sequence.prop_tokens,
      needs_previous_frame: sequence.needs_previous_frame,
      dialogue: sequence.dialogue,
      speech_s: sequence.speech_s,
      duration_short_s: sequence.duration_s,
      duration_long_s: sequence.duration_s
    })),
    warnings,
    plannedTotalS
  ];
};
