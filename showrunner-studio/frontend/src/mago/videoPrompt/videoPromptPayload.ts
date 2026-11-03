/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
import { textOf } from "../vlm/dialogue";

/**
 * One shot's video-prompt body from project state, and the reference slots it
 * renders against, as the backend builds them.
 */

type JsonRecord = Record<string, unknown>;

/** Highest priority last to be collapsed: characters suffer most in a grid. */
export const GROUP_ORDER = ["characters", "environments", "props"] as const;

const GRID_REF_ID_SUFFIX = "_grid";
/**
 * How a `last_frame` sequential shot continues from the previous shot's last
 * frame, as a slot's `continuation`. The `off` opening frame sends none; the
 * full opening-frame set lives in ../shots/sequentialContinuation.ts.
 */
export const CONTINUATION_CUT = "cut";
export const CONTINUATION_PIN = "pin";
export const CONTINUATIONS = [CONTINUATION_CUT, CONTINUATION_PIN] as const;
export type Continuation = (typeof CONTINUATIONS)[number];
/** ref_ids of the cross-shot reference a sequential shot continues from. */
export const CROSS_SHOT_REF_ID = "prev_shot";
export const CROSS_SHOT_VIDEO_REF_ID = "prev_shot_video";

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);
const records = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const normalizeReferenceGroups = (raw: unknown): Map<string, string[]> => {
  const groups = new Map<string, string[]>();
  const source = isRecord(raw) ? raw : {};
  for (const name of GROUP_ORDER) {
    const ids = (Array.isArray(source[name]) ? (source[name] as unknown[]) : [])
      .filter(Boolean)
      .map(String);
    if (ids.length) groups.set(name, ids);
  }
  return groups;
};

/**
 * The slots a shot's references
 * occupy, as asset-id lists in reference order. Only the overflow of the
 * lowest-priority groups is gridded, and nothing is ever dropped.
 */
export const planReferenceSlots = (
  referenceGroups: unknown,
  limit: number
): string[][] => {
  const groups = normalizeReferenceGroups(referenceGroups);
  if (!groups.size) return [];
  const budget = Math.max(1, Math.trunc(limit || 1));
  const names = GROUP_ORDER.filter((name) => groups.has(name));
  const alone = new Map(names.map((name) => [name, [...groups.get(name)!]]));
  const gridded = new Map<string, string[]>(names.map((name) => [name, []]));
  const slotCount = () =>
    names.reduce(
      (total, name) =>
        total + alone.get(name)!.length + (gridded.get(name)!.length ? 1 : 0),
      0
    );
  for (const name of [...names].reverse()) {
    const excess = slotCount() - budget;
    if (excess <= 0) break;
    const ids = alone.get(name)!;
    const size = Math.min(ids.length, excess + 1);
    if (size < 2) continue;
    alone.set(name, ids.slice(0, ids.length - size));
    gridded.set(name, ids.slice(ids.length - size));
  }
  const buckets: string[][] = [];
  for (const name of names) {
    buckets.push(...alone.get(name)!.map((id) => [id]));
    if (gridded.get(name)!.length) buckets.push(gridded.get(name)!);
  }
  while (buckets.length > budget) {
    const tail = buckets.pop()!;
    buckets[buckets.length - 1] = [...buckets[buckets.length - 1]!, ...tail];
  }
  return buckets;
};

export interface PayloadEntity {
  id: string;
  name: string;
  description: string;
  kind?: string;
  source?: string;
}

export interface ReferenceSlot {
  ref_id: string;
  kind?: "image" | "video";
  members: string[];
  labels: string[];
  description: string;
  source?: string;
  continuation?: Continuation;
}

/** The slot descriptor for the previous shot's reference, appended last. */
export const crossShotSlot = (
  description: string | null | undefined,
  kind: "image" | "video" = "image",
  continuation: Continuation | null = null
): ReferenceSlot => ({
  ref_id: kind === "video" ? CROSS_SHOT_VIDEO_REF_ID : CROSS_SHOT_REF_ID,
  kind,
  members: [],
  labels: [],
  description: description || "",
  ...(continuation ? { continuation } : {})
});

/**
 * How a sequential shot's
 * prompt treats the previous frame, or null for `off` and the other modes.
 */
export const sequentialContinuation = (sequential: {
  mode?: unknown;
  opening_frame?: unknown;
}): Continuation | null => {
  if (sequential.mode !== "last_frame") return null;
  const openingFrame = sequential.opening_frame || CONTINUATION_CUT;
  return (CONTINUATIONS as readonly unknown[]).includes(openingFrame)
    ? (openingFrame as Continuation)
    : null;
};

const entity = (key: JsonRecord | undefined, token: string): PayloadEntity => ({
  id: token,
  name: (typeof key?.name === "string" && key.name) || token,
  description: (typeof key?.description === "string" && key.description) || ""
});

const memberLine = (member: PayloadEntity) =>
  member.description
    ? `'${member.name}' - ${member.description}`
    : `'${member.name}'`;

const gridRefId = (kinds: string[], taken: Set<string>): string => {
  const base =
    (kinds.length ? kinds.join("_") : "references") + GRID_REF_ID_SUFFIX;
  let refId = base;
  let n = 2;
  while (taken.has(refId)) {
    refId = `${base}_${n}`;
    n += 1;
  }
  taken.add(refId);
  return refId;
};

/** This shot's references, flat, in reference order. */
export const shotReferenceEntities = (
  shot: JsonRecord,
  keysByToken: Map<string, JsonRecord>
): PayloadEntity[] => {
  const references = isRecord(shot.references) ? shot.references : {};
  const entities: PayloadEntity[] = [];
  for (const kind of GROUP_ORDER) {
    for (const entry of records(references[kind])) {
      const token = textOf(entry.token);
      if (!token || !entry.asset_id) continue;
      entities.push({
        ...entity(keysByToken.get(token), token),
        kind,
        ...(keysByToken.get(token)?.effective_source === "upload"
          ? { source: "upload" }
          : {})
      });
    }
  }
  return entities;
};

/**
 * Fold the flat entity list onto the slot
 * layout. `[slots, ok]`; not ok when the two count different references.
 */
export const slotsForReferenceLayout = (
  entities: PayloadEntity[],
  referenceSlots: string[][] | null
): [ReferenceSlot[], boolean] => {
  if (referenceSlots === null) return [[], true];
  const total = referenceSlots.reduce((sum, slot) => sum + slot.length, 0);
  if (total !== entities.length) return [[], false];
  const taken = new Set(entities.map((item) => item.id));
  const slots: ReferenceSlot[] = [];
  let cursor = 0;
  for (const assetIds of referenceSlots) {
    const members = entities.slice(cursor, cursor + assetIds.length);
    cursor += assetIds.length;
    if (members.length === 1) {
      const [only] = members;
      slots.push({
        ref_id: only!.id,
        members: [],
        labels: [],
        description: only!.description,
        ...(only!.source ? { source: only!.source } : {})
      });
      continue;
    }
    const kinds = GROUP_ORDER.filter((kind) =>
      members.some((member) => member.kind === kind)
    );
    slots.push({
      ref_id: gridRefId(kinds, taken),
      members: members.map((member) => member.id),
      labels: members.map((member) => member.name),
      description: members.map(memberLine).join("; ")
    });
  }
  return [slots, true];
};

/** The composer body for one shot, minus references. */
export const shotVideoPromptPayload = (
  shot: JsonRecord,
  keys: JsonRecord[]
): JsonRecord => {
  const keysByToken = new Map(
    keys.filter((key) => key.token).map((key) => [String(key.token), key])
  );
  const tags = isRecord(shot.tags) ? shot.tags : {};
  const tokens = (kind: string) =>
    (Array.isArray(tags[kind]) ? (tags[kind] as unknown[]) : [])
      .map(String)
      .filter((token) => keysByToken.has(token));
  const environments = tokens("environments");
  const environmentToken = environments[0];
  const propTokens = [...tokens("props"), ...environments.slice(1)];
  const payload: JsonRecord = {
    shot: {
      description:
        (typeof shot.video_prompt === "string" && shot.video_prompt) || "",
      dialogue: records(shot.dialogue)
        .filter((turn) => typeof turn.line === "string" && turn.line.trim())
        .map((turn) => ({
          line: turn.line,
          speaker: turn.speaker ?? null,
          speaker_ref_id: turn.speaker_token ?? null,
          language: turn.language ?? null
        }))
    },
    characters: tokens("characters").map((token) =>
      entity(keysByToken.get(token), token)
    ),
    props: propTokens.map((token) => entity(keysByToken.get(token), token)),
    entities: shotReferenceEntities(shot, keysByToken)
  };
  if (environmentToken)
    payload.environment = entity(
      keysByToken.get(environmentToken),
      environmentToken
    );
  return payload;
};
