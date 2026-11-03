/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: constructor parameter property written out (the build forbids non-erasable syntax).
 * See LICENSE and NOTICE.md at the repository root.
 */
/**
 * The pydantic models the backend validates
 * Gemini's casting answers with, and what `model_dump()` turns them into:
 * declared fields only, in declaration order, defaults filled, extra keys
 * dropped, with pydantic's lax-mode coercions. Everything downstream reads
 * the dump, so matching it is what keeps the post-processing identical.
 */

type JsonRecord = Record<string, unknown>;

type FieldType =
  | { kind: "int" }
  | { kind: "float" }
  | { kind: "str" }
  | { kind: "bool" }
  | { kind: "list"; of: FieldType }
  | { kind: "model"; name: CastingModelName }
  | { kind: "optional"; of: FieldType };

type Field = { name: string; type: FieldType; default?: () => unknown };

const int: FieldType = { kind: "int" };
const float: FieldType = { kind: "float" };
const str: FieldType = { kind: "str" };
const bool: FieldType = { kind: "bool" };
const list = (of: FieldType): FieldType => ({ kind: "list", of });
const model = (name: CastingModelName): FieldType => ({ kind: "model", name });
const optional = (of: FieldType): FieldType => ({ kind: "optional", of });

export const CastingModel = {
  SequenceEntity: "SequenceEntity",
  CameraDirection: "CameraDirection",
  ShotCameraDirection: "ShotCameraDirection",
  DialogueLine: "DialogueLine",
  SequenceVideoPrompt: "SequenceVideoPrompt",
  NamedEntityDescription: "NamedEntityDescription",
  NamedEntity: "NamedEntity",
  CharacterEntityDescription: "CharacterEntityDescription",
  CharacterEntity: "CharacterEntity",
  ScriptCastingResult: "ScriptCastingResult",
  ScriptCastingStructureResult: "ScriptCastingStructureResult",
  NamedEntityPrompt: "NamedEntityPrompt",
  ScriptCastingPromptsResult: "ScriptCastingPromptsResult",
  AtomicShotDraft: "AtomicShotDraft",
  AtomicShotGroup: "AtomicShotGroup",
  ScriptCastingAtomicShotsResult: "ScriptCastingAtomicShotsResult"
} as const;

export type CastingModelName = (typeof CastingModel)[keyof typeof CastingModel];

const namedEntityDescriptionFields: Field[] = [
  { name: "name", type: str },
  { name: "description", type: str },
  { name: "sequence_ids", type: list(int) },
  { name: "alt", type: str }
];

const characterFields: Field[] = [
  ...namedEntityDescriptionFields,
  { name: "body_plan", type: optional(str), default: () => null },
  { name: "distinctive_features", type: list(str), default: () => [] },
  { name: "voice_profile", type: optional(str), default: () => null }
];

const castingResultFields = (
  entity: CastingModelName,
  character: CastingModelName
): Field[] => [
  { name: "title", type: str },
  { name: "sequences", type: list(model(CastingModel.SequenceEntity)) },
  {
    name: "sequence_video_prompts",
    type: list(model(CastingModel.SequenceVideoPrompt))
  },
  { name: "characters", type: list(model(character)) },
  { name: "environments", type: list(model(entity)) },
  { name: "props", type: list(model(entity)) },
  { name: "visual_style", type: optional(str), default: () => null }
];

const MODELS: Record<CastingModelName, Field[]> = {
  SequenceEntity: [
    { name: "id", type: int },
    { name: "heading", type: str },
    { name: "int_ext", type: str },
    { name: "time_of_day", type: str }
  ],
  CameraDirection: [
    { name: "framing", type: str },
    { name: "movement", type: str },
    { name: "lens", type: str }
  ],
  ShotCameraDirection: [
    { name: "framing", type: str },
    { name: "movement", type: str },
    { name: "lens", type: str },
    { name: "from_script", type: bool, default: () => false }
  ],
  DialogueLine: [
    { name: "speaker", type: str },
    { name: "line", type: str },
    { name: "language", type: optional(str), default: () => null }
  ],
  SequenceVideoPrompt: [
    { name: "id", type: int },
    { name: "video_prompt", type: str },
    { name: "needs_previous_frame", type: bool },
    {
      name: "camera",
      type: optional(model(CastingModel.CameraDirection)),
      default: () => null
    },
    {
      name: "dialogue",
      type: list(model(CastingModel.DialogueLine)),
      default: () => []
    }
  ],
  NamedEntityDescription: namedEntityDescriptionFields,
  NamedEntity: [
    ...namedEntityDescriptionFields,
    { name: "t2i_prompt", type: str }
  ],
  CharacterEntityDescription: characterFields,
  CharacterEntity: [...characterFields, { name: "t2i_prompt", type: str }],
  ScriptCastingResult: castingResultFields(
    CastingModel.NamedEntity,
    CastingModel.CharacterEntity
  ),
  ScriptCastingStructureResult: castingResultFields(
    CastingModel.NamedEntityDescription,
    CastingModel.CharacterEntityDescription
  ),
  NamedEntityPrompt: [
    { name: "index", type: int },
    { name: "name", type: str },
    { name: "t2i_prompt", type: str }
  ],
  ScriptCastingPromptsResult: [
    { name: "characters", type: list(model(CastingModel.NamedEntityPrompt)) },
    { name: "environments", type: list(model(CastingModel.NamedEntityPrompt)) },
    { name: "props", type: list(model(CastingModel.NamedEntityPrompt)) }
  ],
  AtomicShotDraft: [
    { name: "action", type: str },
    { name: "video_prompt", type: str },
    { name: "characters", type: list(str) },
    { name: "environments", type: list(str) },
    { name: "props", type: list(str) },
    { name: "needs_previous_frame", type: bool },
    { name: "beat_type", type: str },
    { name: "duration_short_s", type: float },
    { name: "duration_long_s", type: float },
    {
      name: "camera",
      type: optional(model(CastingModel.ShotCameraDirection)),
      default: () => null
    },
    {
      name: "dialogue",
      type: list(model(CastingModel.DialogueLine)),
      default: () => []
    }
  ],
  AtomicShotGroup: [
    { name: "sequence_id", type: int },
    { name: "shots", type: list(model(CastingModel.AtomicShotDraft)) }
  ],
  ScriptCastingAtomicShotsResult: [
    { name: "sequence_shots", type: list(model(CastingModel.AtomicShotGroup)) }
  ]
};

/** How many problems an error message lists before it stops. */
const PROBLEMS_SHOWN = 8;

export class CastingValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.slice(0, PROBLEMS_SHOWN).join("; "));
    this.problems = problems;
  }
}

const TRUE_STRINGS = new Set(["true", "t", "yes", "y", "on", "1"]);
const FALSE_STRINGS = new Set(["false", "f", "no", "n", "off", "0"]);
const NUMERIC_RE = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$/;

const coerceValue = (
  type: FieldType,
  value: unknown,
  path: string,
  problems: string[]
): unknown => {
  switch (type.kind) {
    case "optional":
      return value === null
        ? null
        : coerceValue(type.of, value, path, problems);
    case "int": {
      const number =
        typeof value === "string" && NUMERIC_RE.test(value)
          ? Number(value)
          : value;
      if (
        typeof number === "number" &&
        Number.isFinite(number) &&
        Number.isInteger(number)
      )
        return number;
      problems.push(`${path}: Input should be a valid integer`);
      return null;
    }
    case "float": {
      const number =
        typeof value === "string" && NUMERIC_RE.test(value)
          ? Number(value)
          : value;
      if (typeof number === "number" && Number.isFinite(number)) return number;
      problems.push(`${path}: Input should be a valid number`);
      return null;
    }
    case "str":
      if (typeof value === "string") return value;
      problems.push(`${path}: Input should be a valid string`);
      return null;
    case "bool":
      if (typeof value === "boolean") return value;
      if (value === 0 || value === 1) return value === 1;
      if (typeof value === "string") {
        const folded = value.trim().toLowerCase();
        if (TRUE_STRINGS.has(folded)) return true;
        if (FALSE_STRINGS.has(folded)) return false;
      }
      problems.push(`${path}: Input should be a valid boolean`);
      return null;
    case "list":
      if (!Array.isArray(value)) {
        problems.push(`${path}: Input should be a valid list`);
        return [];
      }
      return value.map((item, index) =>
        coerceValue(type.of, item, `${path}.${index}`, problems)
      );
    case "model":
      return coerceFields(type.name, value, path, problems);
  }
};

const coerceFields = (
  name: CastingModelName,
  value: unknown,
  path: string,
  problems: string[]
): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${path || name}: Input should be a valid dictionary`);
    return {};
  }
  const source = value as JsonRecord;
  const dumped: JsonRecord = {};
  for (const field of MODELS[name]) {
    const fieldPath = path ? `${path}.${field.name}` : field.name;
    if (!(field.name in source) || source[field.name] === undefined) {
      if (field.default) dumped[field.name] = field.default();
      else problems.push(`${fieldPath}: Field required`);
      continue;
    }
    dumped[field.name] = coerceValue(
      field.type,
      source[field.name],
      fieldPath,
      problems
    );
  }
  return dumped;
};

/**
 * `Model.model_validate(value).model_dump()`. Throws CastingValidationError
 * listing every problem when pydantic would have rejected the value.
 */
export const coerceModel = (
  name: CastingModelName,
  value: unknown
): JsonRecord => {
  const problems: string[] = [];
  const dumped = coerceFields(name, value, "", problems);
  if (problems.length) throw new CastingValidationError(problems);
  return dumped;
};
