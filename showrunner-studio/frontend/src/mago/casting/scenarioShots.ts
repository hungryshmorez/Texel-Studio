/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
import { applySpeechFloor, speechSeconds } from "../vlm/dialogue";

import { speakerKey } from "./castingTokens";

/**
 * Casting -> shot breakdown: the backend.
 * Pure, and kept line-for-line close to the original so the two can be
 * diffed when the backend moves.
 */

type JsonRecord = Record<string, unknown>;

export const CHARACTER_SLOT_CAP = 7;

const KIND_KEYS = ["characters", "environments", "props"] as const;
export type EntityKind = (typeof KIND_KEYS)[number];
const KIND_LABEL: Record<EntityKind, string> = {
  characters: "character",
  environments: "environment",
  props: "prop"
};

type AliasMap = Record<EntityKind, Record<string, JsonRecord[]>>;

export type NormalizedCasting = {
  title: unknown;
  sequences: JsonRecord[];
  shots: JsonRecord[];
  characters: Record<string, JsonRecord>;
  environments: Record<string, JsonRecord>;
  props: Record<string, JsonRecord>;
  _alias_map: AliasMap;
};

const records = (value: unknown): JsonRecord[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          !!item && typeof item === "object" && !Array.isArray(item)
      )
    : [];

const sequenceIds = (entity: JsonRecord): unknown[] =>
  Array.isArray(entity.sequence_ids) ? entity.sequence_ids : [];

/** Python `x in list` for the JSON scalars sequence ids are. */
const includesId = (ids: unknown[], id: unknown): boolean =>
  ids.some((candidate) => candidate === id);

/**
 * Dedupe colliding `token_name`s casting-wide (the first
 * keeps the bare token, later ones get `_2`, `_3`, ...) and index entities by
 * token, with an alias map back from each original token.
 */
export const normalizeCasting = (casting: unknown): NormalizedCasting => {
  const source =
    casting && typeof casting === "object" ? (casting as JsonRecord) : {};
  const result: NormalizedCasting = {
    title: source.title ?? null,
    sequences: records(source.sequences),
    shots: records(source.shots),
    characters: {},
    environments: {},
    props: {},
    _alias_map: { characters: {}, environments: {}, props: {} }
  };
  const seen = new Set<string>();
  const uniqueToken = (token: string): string => {
    if (!seen.has(token)) {
      seen.add(token);
      return token;
    }
    let n = 2;
    while (seen.has(`${token}_${n}`)) n += 1;
    const renamed = `${token}_${n}`;
    seen.add(renamed);
    return renamed;
  };
  for (const kind of KIND_KEYS) {
    for (const entity of records(source[kind])) {
      const original = entity.token_name;
      if (typeof original !== "string" || !original) continue;
      const token = uniqueToken(original);
      const renamed = { ...entity, token_name: token };
      result[kind][token] = renamed;
      (result._alias_map[kind][original] ??= []).push(renamed);
    }
  }
  return result;
};

/** The renamed token an original reference means in a sequence. */
const resolveToken = (
  aliasMap: AliasMap,
  kind: EntityKind,
  original: unknown,
  sequenceId: unknown
): string | null => {
  const candidates =
    typeof original === "string" ? (aliasMap[kind]?.[original] ?? []) : [];
  if (!candidates.length) return null;
  for (const entity of candidates) {
    if (includesId(sequenceIds(entity), sequenceId))
      return entity.token_name as string;
  }
  return candidates[0]!.token_name as string;
};

/** Add `speaker_token` to each turn, exact-after-folding. */
const resolveSpeakers = (
  dialogue: JsonRecord[],
  aliasMap: AliasMap,
  charactersPool: Record<string, JsonRecord>,
  sequenceId: unknown
): JsonRecord[] => {
  if (!dialogue.length) return [];
  const byKey = new Map<string, string[]>();
  const register = (keySource: unknown, original: string) => {
    const key = speakerKey(keySource);
    if (!key) return;
    const originals = byKey.get(key) ?? [];
    if (!originals.includes(original)) originals.push(original);
    byKey.set(key, originals);
  };
  for (const [original, candidates] of Object.entries(
    aliasMap.characters ?? {}
  )) {
    for (const entity of candidates) {
      register(entity.name, original);
      register(entity.token_name, original);
      register(original, original);
    }
  }
  for (const [token, entity] of Object.entries(charactersPool ?? {})) {
    register(entity.name, token);
    register(token, token);
  }

  const tokenFor = (speaker: unknown): string | null => {
    const originals = byKey.get(speakerKey(speaker)) ?? [];
    // A design that appears in this sequence wins over one that does not.
    for (const original of originals) {
      const token = resolveToken(aliasMap, "characters", original, sequenceId);
      if (
        token &&
        (aliasMap.characters?.[original] ?? []).some(
          (entity) =>
            entity.token_name === token &&
            includesId(sequenceIds(entity), sequenceId)
        )
      )
        return token;
    }
    for (const original of originals) {
      const token = resolveToken(aliasMap, "characters", original, sequenceId);
      if (token) return token;
      if (original in (charactersPool ?? {})) return original;
    }
    return null;
  };

  return dialogue.map((turn) => ({
    ...turn,
    speaker_token: tokenFor(turn.speaker)
  }));
};

export type BreakdownShot = {
  index: number;
  key: unknown;
  sequence_id: unknown;
  heading: unknown;
  action: string | null;
  video_prompt: string;
  character_tokens: string[];
  environment_tokens: string[];
  prop_tokens: string[];
  needs_previous_frame: unknown;
  camera: unknown;
  dialogue: JsonRecord[];
  speech_s: number;
  beat_type: unknown;
  duration_short_s: unknown;
  duration_long_s: unknown;
};

export type Breakdown = {
  shots: BreakdownShot[];
  sheets: Record<string, JsonRecord>;
  dropped: JsonRecord[];
  empty_video_prompts: unknown[];
  sheet_items: JsonRecord[];
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Python's `str or ""` then `.strip()` for a value that may not be a string. */
const stripped = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * One entry per atomic shot when the casting has them, else
 * one per sequence (first `max_shots`). Up to 7 characters per shot, every
 * environment and prop; `sheets` only lists entities a kept shot uses.
 */
export const buildBreakdown = (
  normalizedCasting: NormalizedCasting,
  maxShots: number
): Breakdown => {
  const aliasMap = normalizedCasting._alias_map ?? {
    characters: {},
    environments: {},
    props: {}
  };
  const pools = {
    characters: normalizedCasting.characters ?? {},
    environments: normalizedCasting.environments ?? {},
    props: normalizedCasting.props ?? {}
  };

  const atomicItems = normalizedCasting.shots ?? [];
  const atomicMode = atomicItems.length > 0;
  const headingsBySequence = new Map<unknown, unknown>();
  const dialogueBySequence = new Map<unknown, unknown>();
  let items: JsonRecord[];
  if (atomicMode) {
    items = atomicItems;
    for (const sequence of normalizedCasting.sequences ?? []) {
      headingsBySequence.set(sequence.id, sequence.heading);
      dialogueBySequence.set(sequence.id, sequence.dialogue);
    }
  } else {
    items = (normalizedCasting.sequences ?? []).slice(
      0,
      Math.max(1, Math.trunc(Number(maxShots) || 1))
    );
  }

  const assignedBySequence = new Set<unknown>();
  if (atomicMode) {
    for (const entry of items) {
      if (Array.isArray(entry.dialogue) && entry.dialogue.length)
        assignedBySequence.add(entry.sequence_id);
    }
  }
  const inheritedSequences = new Set<unknown>();

  const resolveAll = (
    kind: EntityKind,
    rawTokens: unknown,
    sequenceId: unknown
  ): string[] => {
    const out: string[] = [];
    for (const original of Array.isArray(rawTokens) ? rawTokens : []) {
      const token = resolveToken(aliasMap, kind, original, sequenceId);
      if (token && !out.includes(token)) out.push(token);
    }
    return out;
  };

  const entityDescription = (kind: EntityKind, token: string): unknown => {
    const entity = pools[kind][token] ?? {};
    return entity.description || entity.name || token;
  };

  const shots: BreakdownShot[] = [];
  const dropped: JsonRecord[] = [];
  const emptyVideoPrompts: unknown[] = [];
  const usedTokens = new Set<string>();

  items.forEach((item, shotIndex) => {
    const sequenceId = atomicMode ? item.sequence_id : item.id;
    const key = atomicMode ? item.id : sequenceId;
    const heading = atomicMode
      ? (headingsBySequence.get(sequenceId) ?? null)
      : (item.heading ?? null);
    const charTokensAll = resolveAll("characters", item.characters, sequenceId);
    const envTokens = resolveAll("environments", item.environments, sequenceId);
    const propTokens = resolveAll("props", item.props, sequenceId);

    const charTokens = charTokensAll.slice(0, CHARACTER_SLOT_CAP);
    for (const token of charTokensAll.slice(CHARACTER_SLOT_CAP)) {
      dropped.push({
        shot_index: shotIndex,
        kind: "character",
        token,
        reason: `character slot cap (${CHARACTER_SLOT_CAP}) exceeded`
      });
    }

    const action = atomicMode ? stripped(item.action) : null;

    // The fallback to the parent sequence's lines is decided per sequence:
    // only when no shot of it carries any, and only on its first beat.
    let dialogue: unknown = item.dialogue;
    let inherited = false;
    if (
      !(Array.isArray(dialogue) && dialogue.length) &&
      atomicMode &&
      !assignedBySequence.has(sequenceId) &&
      !inheritedSequences.has(sequenceId)
    ) {
      const sequenceDialogue = dialogueBySequence.get(sequenceId);
      dialogue = Array.isArray(sequenceDialogue) ? sequenceDialogue : [];
      inherited = (dialogue as unknown[]).length > 0;
      if (inherited) inheritedSequences.add(sequenceId);
    }
    const resolvedDialogue = resolveSpeakers(
      records(dialogue),
      aliasMap,
      pools.characters,
      sequenceId
    );

    let shortS: unknown = atomicMode ? (item.duration_short_s ?? null) : null;
    let longS: unknown = atomicMode ? (item.duration_long_s ?? null) : null;
    if (inherited && isNumber(shortS) && isNumber(longS)) {
      [shortS, longS] = applySpeechFloor(shortS, longS, resolvedDialogue);
    }

    let videoPrompt = stripped(item.video_prompt);
    if (!videoPrompt) {
      const descriptions = [
        ...charTokens.map((token) => entityDescription("characters", token)),
        ...envTokens.map((token) => entityDescription("environments", token)),
        ...propTokens.map((token) => entityDescription("props", token))
      ];
      videoPrompt = [heading, action, ...descriptions]
        .filter(Boolean)
        .join(". ");
      emptyVideoPrompts.push(key);
    }

    shots.push({
      index: shotIndex,
      key: key ?? null,
      sequence_id: sequenceId ?? null,
      heading,
      action,
      video_prompt: videoPrompt,
      character_tokens: charTokens,
      environment_tokens: envTokens,
      prop_tokens: propTokens,
      needs_previous_frame: item.needs_previous_frame ?? null,
      camera: item.camera ?? null,
      dialogue: resolvedDialogue,
      speech_s: speechSeconds(resolvedDialogue),
      beat_type: atomicMode ? (item.beat_type ?? null) : null,
      duration_short_s: shortS,
      duration_long_s: longS
    });

    for (const [kind, tokens] of [
      ["characters", charTokens],
      ["environments", envTokens],
      ["props", propTokens]
    ] as const) {
      for (const token of tokens) usedTokens.add(`${kind}\u0000${token}`);
    }
  });

  const sheets: Record<string, JsonRecord> = {};
  for (const kind of KIND_KEYS) {
    for (const [token, entity] of Object.entries(pools[kind])) {
      if (!usedTokens.has(`${kind}\u0000${token}`)) continue;
      sheets[token] = {
        kind: KIND_LABEL[kind],
        token,
        name: entity.name ?? null,
        description: entity.description ?? null,
        t2i_prompt: entity.t2i_prompt || entity.description || token,
        ...(kind === "characters"
          ? Object.fromEntries(
              ["body_plan", "distinctive_features"]
                .filter(
                  (field) =>
                    entity[field] &&
                    (!Array.isArray(entity[field]) ||
                      (entity[field] as unknown[]).length)
                )
                .map((field) => [field, entity[field]])
            )
          : {})
      };
    }
  }

  return {
    shots,
    sheets,
    dropped,
    empty_video_prompts: emptyVideoPrompts,
    sheet_items: Object.keys(sheets)
      .sort()
      .map((token) => ({
        key: token,
        prompt: sheets[token]!.t2i_prompt,
        name: sheets[token]!.name || token,
        kind: sheets[token]!.kind,
        ...Object.fromEntries(
          ["body_plan", "distinctive_features"]
            .filter((field) => field in sheets[token]!)
            .map((field) => [field, sheets[token]![field]])
        )
      }))
  };
};
