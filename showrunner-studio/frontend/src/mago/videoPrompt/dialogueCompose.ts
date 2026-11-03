/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
import {
  detectLanguage,
  linePlaceholder,
  normalizeLanguage,
  normalizeLine,
  textOf
} from "../vlm/dialogue";

/**
 * The composing half of the backend: turning a shot's
 * dialogue into the turns a prompt document places, and binding them into it.
 * The other half (languages, line normalisation, speech time) is in
 * vlm/dialogue.ts. Same order of operations and messages as the backend, which
 * the parity fixtures check.
 */

type JsonRecord = Record<string, unknown>;

export interface DialogueTurn {
  /** 1-based: the `n` in `{{line:n}}`. */
  index: number;
  line: string;
  speaker: string;
  speaker_ref_id: string | null;
  language: string;
  /** "S1": contiguous, in speaking order (or the script's registry order). */
  speaker_id: string;
  script_speaker_id: number | null;
}

/** speaker_ref_id -> the placeholder addressing that subject, or null. */
export type SubjectLabelFor = (refId: string) => string | null | undefined;

const LINE_PLACEHOLDER_RE = /\{\{line:(\d+)\}\}/g;
const SPEAKER_ID_RE = /\(S(\d+)\)/g;
const DIALOGUE_SPAN_RE = /<\s*d\s*>[\s\S]*?<\s*\/\s*d\s*>/gi;
const STRAY_DIALOGUE_TAG_RE = /<\s*\/?\s*d\s*>/gi;

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** `" ".join(str(text or "").split())`. */
const collapse = (text: unknown): string =>
  textOf(text).split(/\s+/).filter(Boolean).join(" ");

const speakerKey = (
  entry: { speaker_ref_id: string | null; speaker: unknown },
  position: number
): string => {
  const ref = collapse(entry.speaker_ref_id ?? "");
  if (ref) return `ref:${ref}`;
  const name = collapse(entry.speaker ?? "").toLowerCase();
  if (name) return `name:${name}`;
  return `anon:${position}`;
};

/** `[turns, warnings]`. */
export const normalizeDialogue = (
  turns: unknown,
  characterIds: readonly string[] = []
): [DialogueTurn[], string[]] => {
  const warnings: string[] = [];
  const known = new Set(characterIds);
  const staged: Array<
    Omit<DialogueTurn, "index" | "speaker_id"> & { key: string }
  > = [];

  (Array.isArray(turns) ? turns : []).forEach((entry, position) => {
    if (!isRecord(entry)) return;
    const declared = collapse(entry.language || "");
    const { language, warning } = normalizeLanguage(
      declared || detectLanguage(entry.line || "")
    );
    if (warning) warnings.push(warning);

    const line = normalizeLine(entry.line, language);
    if (!line) {
      warnings.push(
        `dialogue turn ${position + 1} has no spoken words after normalisation`
      );
      return;
    }

    let speakerRefId: string | null =
      collapse(entry.speaker_ref_id || "") || null;
    if (speakerRefId && known.size && !known.has(speakerRefId)) {
      warnings.push(
        `dialogue turn ${position + 1} names speaker_ref_id "${speakerRefId}", ` +
          "which is not a character in this shot; the speaker is described instead"
      );
      speakerRefId = null;
    }

    const rawSpeakerId = entry.speaker_id;
    const scriptSpeakerId =
      typeof rawSpeakerId === "number" && Number.isFinite(rawSpeakerId)
        ? Math.trunc(rawSpeakerId)
        : null;

    staged.push({
      key: speakerKey(
        { speaker_ref_id: speakerRefId, speaker: entry.speaker },
        position
      ),
      line,
      speaker: collapse(entry.speaker || ""),
      speaker_ref_id: speakerRefId,
      language,
      script_speaker_id: scriptSpeakerId
    });
  });

  const firstAppearance = new Map<string, number>();
  const registryNumber = new Map<string, number>();
  staged.forEach((turn, position) => {
    if (!firstAppearance.has(turn.key)) firstAppearance.set(turn.key, position);
    if (turn.script_speaker_id !== null && !registryNumber.has(turn.key))
      registryNumber.set(turn.key, turn.script_speaker_id);
  });
  // A registry number wins; speakers without one follow, in the order they
  // first speak. Both fall back to first appearance, so the order is total.
  const order = (key: string): [number, number] =>
    registryNumber.has(key)
      ? [0, registryNumber.get(key)!]
      : [1, firstAppearance.get(key)!];
  const ordered = [...firstAppearance.keys()].sort((left, right) => {
    const [a0, a1] = order(left);
    const [b0, b1] = order(right);
    return a0 - b0 || a1 - b1;
  });
  const idByKey = new Map(
    ordered.map((key, position) => [key, `S${position + 1}`])
  );

  return [
    staged.map((turn, position) => ({
      index: position + 1,
      line: turn.line,
      speaker: turn.speaker,
      speaker_ref_id: turn.speaker_ref_id,
      language: turn.language,
      speaker_id: idByKey.get(turn.key)!,
      script_speaker_id: turn.script_speaker_id
    })),
    warnings
  ];
};

/** The bound form: what actually reaches the engine. */
export const dialogueTag = (turn: DialogueTurn): string =>
  `<d>[${turn.language}] ${turn.line}</d>`;

/** Replace every `{{line:n}}` with its turn's `<d>` tag. */
export const bindDialogue = (
  text: string,
  turns: readonly DialogueTurn[]
): string => {
  const byIndex = new Map(turns.map((turn) => [turn.index, turn]));
  return (text || "").replace(LINE_PLACEHOLDER_RE, (match, index: string) => {
    const turn = byIndex.get(Number(index));
    return turn ? dialogueTag(turn) : match;
  });
};

/** The block the model writes around: each turn's placeholder, not its words. */
export const dialogueBrief = (
  turns: readonly DialogueTurn[],
  labelFor?: SubjectLabelFor
): string => {
  if (!turns.length) return "";
  const lines = turns.map((turn) => {
    const subject =
      labelFor && turn.speaker_ref_id ? labelFor(turn.speaker_ref_id) : null;
    const who =
      subject ||
      (turn.speaker
        ? `"${turn.speaker}" (no reference image)`
        : "an unseen voice");
    return (
      `- ${linePlaceholder(turn.index)} — spoken by ${who} as (${turn.speaker_id}), ` +
      `in ${turn.language}. The words, for context only: ${turn.line}`
    );
  });
  return [
    "## Dialogue — placeholders, not text",
    "",
    ...lines,
    "",
    "Place every placeholder above in detailed_description, in this order, each in a",
    "clause that names who speaks and how. When the shot text ALREADY carries a",
    "placeholder inside a [Shot n] cut, keep it in THAT cut — the cut it sits in is the",
    "one the line is spoken in, and moving it puts the words on the wrong picture.",
    "Never retype the words themselves and never",
    "write a <d> tag: the placeholder is replaced with the exact tagged line afterwards,",
    "so anything you type instead is a second, wrong copy. Delivery, volume and action go",
    "in the prose around the placeholder, never inside it. A placeholder never appears in",
    "overall_soundscape — spoken words are not ambience.",
    "The prose you write around each placeholder is ENGLISH, whatever language the line",
    "itself is in: the language shown above belongs to the spoken words alone, and the",
    "tag carrying them is inserted for you."
  ].join("\n");
};

const squeezeSpaces = (text: string) => text.replace(/[ \t]{2,}/g, " ").trim();

/**
 * Bind the turns into a model-written
 * document, repairing where it strayed. `[sections, repairs]`.
 */
export const applyDialogue = (
  sections: Record<string, string>,
  turns: readonly DialogueTurn[],
  labelFor?: SubjectLabelFor
): [Record<string, string>, string[]] => {
  const repaired: Record<string, string> = { ...sections };
  const repairs: string[] = [];
  if (!turns.length) return [repaired, repairs];

  for (const name of Object.keys(repaired)) {
    if (name === "detailed_description") continue;
    let text = repaired[name] || "";
    if (new RegExp(DIALOGUE_SPAN_RE.source, "i").test(text)) {
      text = text
        .replace(DIALOGUE_SPAN_RE, " ")
        .replace(STRAY_DIALOGUE_TAG_RE, " ");
      repairs.push(
        `${name}: removed dialogue the model wrote itself; the supplied lines stand`
      );
    }
    if (new RegExp(LINE_PLACEHOLDER_RE.source).test(text)) {
      text = text.replace(LINE_PLACEHOLDER_RE, " ");
      repairs.push(
        `${name}: removed a dialogue placeholder; dialogue belongs in the description`
      );
    }
    repaired[name] = squeezeSpaces(text);
  }

  let description = repaired.detailed_description || "";
  const alreadyPlaced = new Set(
    [...description.matchAll(LINE_PLACEHOLDER_RE)].map((match) =>
      Number(match[1])
    )
  );
  const unplaced = turns
    .map((turn) => turn.index)
    .filter((index) => !alreadyPlaced.has(index));
  let swapped = 0;
  let removed = 0;
  description = description.replace(DIALOGUE_SPAN_RE, () => {
    if (!unplaced.length) {
      removed += 1;
      return "";
    }
    swapped += 1;
    return linePlaceholder(unplaced.shift()!);
  });
  description = description
    .replace(STRAY_DIALOGUE_TAG_RE, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (swapped)
    repairs.push(
      `replaced ${swapped} line(s) the model typed itself with the supplied wording`
    );
  if (removed)
    repairs.push(`removed ${removed} line(s) of dialogue the model invented`);

  const seen = new Set<number>();
  description = description.replace(
    LINE_PLACEHOLDER_RE,
    (match, raw: string) => {
      const index = Number(raw);
      if (index < 1 || index > turns.length) {
        repairs.push(`removed ${match}, which matches no line of dialogue`);
        return "";
      }
      if (seen.has(index)) {
        repairs.push(`removed a repeat of ${match}; each line is spoken once`);
        return "";
      }
      seen.add(index);
      return match;
    }
  );

  const missing = turns.filter((turn) => !seen.has(turn.index));
  if (missing.length) {
    const appended = missing.map((turn) => {
      const subject =
        labelFor && turn.speaker_ref_id ? labelFor(turn.speaker_ref_id) : null;
      const who = subject
        ? `${subject} (${turn.speaker_id})`
        : `The speaker (${turn.speaker_id})`;
      return `${who} says: ${linePlaceholder(turn.index)}`;
    });
    description = [description, ...appended].filter(Boolean).join(" ");
    repairs.push(
      `appended ${missing.length} line(s) the model left out: ` +
        missing.map((turn) => linePlaceholder(turn.index)).join(", ")
    );
  }

  repaired.detailed_description = description;
  for (const name of Object.keys(repaired))
    repaired[name] = squeezeSpaces(bindDialogue(repaired[name] || "", turns));
  return [repaired, repairs];
};

/**
 * Why this placeholder-form document cannot
 * be used as written. `repairable: false` reports only what applyDialogue
 * cannot put right.
 */
export const dialogueFailures = (
  sections: Record<string, string>,
  turns: readonly DialogueTurn[],
  repairable = true
): string[] => {
  const failures: string[] = [];
  if (!turns.length) return failures;

  const assigned = new Set(turns.map((turn) => turn.speaker_id));
  for (const [name, body] of Object.entries(sections)) {
    for (const match of (body || "").matchAll(SPEAKER_ID_RE)) {
      const speaker = `S${match[1]}`;
      if (!assigned.has(speaker))
        failures.push(
          `${name} uses speaker id (${speaker}), which was not assigned; this shot has ` +
            `${assigned.size} speaker(s): ${[...assigned].sort().join(", ")}`
        );
    }
  }
  if (!repairable) return failures;

  const description = sections.detailed_description || "";
  const placed = [...description.matchAll(LINE_PLACEHOLDER_RE)].map((match) =>
    Number(match[1])
  );
  for (const turn of turns) {
    const count = placed.filter((index) => index === turn.index).length;
    if (count === 0)
      failures.push(
        `detailed_description is missing ${linePlaceholder(turn.index)} — every ` +
          "spoken line must appear, as its placeholder"
      );
    else if (count > 1)
      failures.push(
        `${linePlaceholder(turn.index)} appears ${count} times in ` +
          "detailed_description; each line is spoken once"
      );
  }
  for (const index of placed)
    if (index < 1 || index > turns.length)
      failures.push(
        `${linePlaceholder(index)} does not match any line of dialogue`
      );
  const inRange = placed.filter((index) => index >= 1 && index <= turns.length);
  if (
    inRange.some(
      (index, position) => position > 0 && index < inRange[position - 1]!
    )
  )
    failures.push(
      "the dialogue placeholders are out of order in detailed_description; they must " +
        "appear in the order the lines are spoken"
    );
  for (const [name, body] of Object.entries(sections)) {
    if (new RegExp(STRAY_DIALOGUE_TAG_RE.source, "i").test(body || ""))
      failures.push(
        `${name} contains a literal <d> tag; write ${linePlaceholder(1)}-style ` +
          "placeholders and let the dialogue be inserted afterwards"
      );
    if (
      name !== "detailed_description" &&
      new RegExp(LINE_PLACEHOLDER_RE.source).test(body || "")
    )
      failures.push(
        `${name} contains a dialogue placeholder; dialogue belongs in detailed_description`
      );
  }
  return failures;
};
