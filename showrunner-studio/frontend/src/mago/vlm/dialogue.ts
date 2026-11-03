/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
/* oxlint-disable eslint/no-magic-numbers -- the timing constants and alias tables are the backend's, ported verbatim so the two can be diffed */
/**
 * Dialogue primitives for local casting: the TypeScript side of the backend, whose port note names this file as its reference.
 * Same constants, same branch structure, same rounding — casting sizes a shot
 * from these numbers on both sides, so a divergence shows up as a shot the
 * cloud and the desktop disagree about.
 *
 * Ported so far: the language helpers, line normalisation, the speech-time
 * estimate and the casting-side checks. The composer half (binding into a
 * prompt document) lives with the H3 prompt adaptation.
 *
 * **If you change a constant or a branch here, change it there too.**
 */

export const DEFAULT_LANGUAGE = "English";

/** Keys are the folded form: accents stripped, lowercased, non-letters removed. */
const LANGUAGE_ALIASES: Record<string, string> = {
  en: "English",
  eng: "English",
  english: "English",
  fr: "French",
  fra: "French",
  fre: "French",
  french: "French",
  francais: "French",
  es: "Spanish",
  spa: "Spanish",
  spanish: "Spanish",
  espanol: "Spanish",
  de: "German",
  deu: "German",
  ger: "German",
  german: "German",
  deutsch: "German",
  it: "Italian",
  ita: "Italian",
  italian: "Italian",
  pt: "Portuguese",
  por: "Portuguese",
  portuguese: "Portuguese",
  ru: "Russian",
  rus: "Russian",
  russian: "Russian",
  ja: "Japanese",
  jpn: "Japanese",
  japanese: "Japanese",
  ko: "Korean",
  kor: "Korean",
  korean: "Korean",
  zh: "Chinese",
  zho: "Chinese",
  chi: "Chinese",
  chinese: "Chinese",
  mandarin: "Chinese",
  ar: "Arabic",
  ara: "Arabic",
  arabic: "Arabic",
  hi: "Hindi",
  hin: "Hindi",
  hindi: "Hindi",
  pl: "Polish",
  pol: "Polish",
  polish: "Polish",
  uk: "Ukrainian",
  ukr: "Ukrainian",
  ukrainian: "Ukrainian",
  th: "Thai",
  tha: "Thai",
  thai: "Thai",
  he: "Hebrew",
  heb: "Hebrew",
  hebrew: "Hebrew",
  el: "Greek",
  ell: "Greek",
  gre: "Greek",
  greek: "Greek"
};

/** ~150 wpm conversational, deliberately conservative. */
const WORDS_PER_SECOND = 2.5;
/** Scripts with no word spacing are timed per character. */
const CHARS_PER_SECOND_CJK = 5.5;
/** Even a one-word turn occupies a beat. */
const MIN_TURN_S = 0.6;
const LEAD_IN_S = 0.4;
const TURN_GAP_S = 0.35;
const TAIL_S = 0.4;

/** Kana, Han, Hangul, plus the scripts written without spaces between words —
 *  what decides how a line is timed. */
const UNSPACED_SCRIPT_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯฀-๿຀-໿ក-៿က-႟]/;

/** `[unclear]` is part of the format; every other bracketed span is a direction. */
const BRACKETED_RE = /\[(?!unclear\])[^\]]*\]/gi;
const PARENTHETICAL_RE = /\([^)]*\)/g;
/** The backend's explicit ranges were generated from this very property. */
const PICTOGRAPH_RE = /\p{Extended_Pictographic}/gu;
const DECORATIVE_RE = /[~*_`^|<>{}]/g;
/** A line already ends on a full stop, in any script. */
const TERMINAL_PUNCTUATION_RE = /[.?!。！？؟;।॥]$/;
/** Languages whose typography puts a space before ? and !. */
const SPACE_BEFORE_TERMINAL_LANGUAGES = new Set(["French"]);

/** A JSON scalar as text — what Python's `str()` gives the values that reach
 *  these functions; anything else is treated as absent. */
export const textOf = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";

const collapse = (text: unknown): string =>
  textOf(text).split(/\s+/).filter(Boolean).join(" ");

/** Accents folded (not dropped), lowercased. */
const foldAccents = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");

/** Code points, as Python's `len` counts them: a surrogate pair is one. */
const codePointLength = (text: string): number =>
  text.replace(/[�-�][�-�]/g, "_").length;

/**
 * Python's `round(value, digits)`: an exact tie rounds to even. Only exact
 * binary ties differ from rounding half up, but those are the ones a parity
 * test catches.
 */
export const pythonRound = (value: number, digits = 0): number => {
  const scale = 10 ** digits;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  if (fraction === 0.5) return (floor % 2 === 0 ? floor : floor + 1) / scale;
  return Number(value.toFixed(digits));
};

/** Resolve a language name or code to a canonical English name, never throwing. */
export const normalizeLanguage = (
  raw: unknown
): { language: string; warning: string | null } => {
  const trimmed = collapse(raw ?? "");
  if (!trimmed) return { language: DEFAULT_LANGUAGE, warning: null };

  const folded = foldAccents(trimmed).replace(/[^a-z]/g, "");
  const alias = LANGUAGE_ALIASES[folded];
  if (alias) return { language: alias, warning: null };

  // Three or more letters: a two-letter token is an ISO code, and an unlisted
  // one would be forwarded as a tag the engine cannot read.
  if (/^[A-Za-z][A-Za-z \-']{2,24}$/.test(trimmed)) {
    const titled = trimmed[0]!.toUpperCase() + trimmed.slice(1);
    return {
      language: titled,
      warning: `dialogue language "${trimmed}" is not a known alias; passed through as "${titled}"`
    };
  }
  return {
    language: DEFAULT_LANGUAGE,
    warning: `dialogue language "${trimmed}" is unusable; defaulted to ${DEFAULT_LANGUAGE}`
  };
};

/** The words actually voiced: parentheticals and bracketed directions stripped. */
export const spokenText = (line: unknown): string =>
  typeof line === "string"
    ? collapse(line.replace(BRACKETED_RE, " ").replace(PARENTHETICAL_RE, " "))
    : "";

/** The spoken words alone, punctuated the way the format wants them. */
export const normalizeLine = (
  text: unknown,
  language: string = DEFAULT_LANGUAGE
): string => {
  let line = textOf(text);
  line = line.replace(BRACKETED_RE, " ").replace(PARENTHETICAL_RE, " ");
  line = line.replace(PICTOGRAPH_RE, " ");
  line = line.replace(/[‘’ʼ]/g, "'");
  line = line.replace(/[“”«»「」『』]/g, "");
  line = line.replace(/…/g, ".");
  line = line.replace(/[–—]/g, ",");
  line = line.replace(DECORATIVE_RE, " ");
  line = collapse(line);
  line = line.replace(/^["']+/, "");
  line = line.replace(/["']+$/, "");
  if (SPACE_BEFORE_TERMINAL_LANGUAGES.has(language)) {
    line = line.replace(/\s+([,.])/g, "$1");
    line = line.replace(/\s+([?!])/g, " $1");
  } else {
    line = line.replace(/\s+([,.?!])/g, "$1");
  }
  line = line.replace(/([,.?!])\1+/g, "$1");
  line = collapse(line);
  if (!line) return "";
  return TERMINAL_PUNCTUATION_RE.test(line) ? line : `${line}.`;
};

/** Spoken duration of one line, with no lead-in, tail or gap padding. */
export const lineSeconds = (
  line: unknown,
  language: string = DEFAULT_LANGUAGE
): number => {
  if (typeof line !== "string") return 0;
  const text = normalizeLine(line, language);
  if (!text) return 0;
  if (UNSPACED_SCRIPT_RE.test(text)) {
    return Math.max(
      MIN_TURN_S,
      codePointLength(text.replace(/\s+/g, "")) / CHARS_PER_SECOND_CJK
    );
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  return words ? Math.max(MIN_TURN_S, words / WORDS_PER_SECOND) : 0;
};

export type DialogueTurnInput =
  | { line?: unknown; language?: unknown; [key: string]: unknown }
  | string
  | null
  | undefined;

/**
 * Wall-clock seconds the turns need to be spoken, including the lead-in, the
 * gaps between turns and the tail. 0 for no turns, so it applies to any shot.
 */
export const speechSeconds = (
  turns: readonly unknown[] | null | undefined
): number => {
  const usable: Array<{ line: unknown; language: string }> = (turns ?? []).map(
    (turn) => {
      if (turn && typeof turn === "object" && !Array.isArray(turn)) {
        const entry = turn as { line?: unknown; language?: unknown };
        return {
          line: entry.line,
          language:
            (typeof entry.language === "string" && entry.language) ||
            DEFAULT_LANGUAGE
        };
      }
      return {
        line: typeof turn === "string" ? turn : null,
        language: DEFAULT_LANGUAGE
      };
    }
  );
  if (!usable.length) return 0;
  const spoken = usable.reduce(
    (total, turn) => total + lineSeconds(turn.line, turn.language),
    0
  );
  if (spoken <= 0) return 0;
  return pythonRound(
    LEAD_IN_S + spoken + TURN_GAP_S * Math.max(0, usable.length - 1) + TAIL_S,
    2
  );
};

/** Scripts that identify their language on sight, most specific first. */
const SCRIPT_LANGUAGES: Array<[RegExp, string]> = [
  [/[぀-ヿ]/, "Japanese"],
  [/[가-힯ᄀ-ᇿ]/, "Korean"],
  [/[一-鿿㐀-䶿]/, "Chinese"],
  [/[฀-๿]/, "Thai"],
  [/[ऀ-ॿ]/, "Hindi"],
  [/[؀-ۿ]/, "Arabic"],
  [/[֐-׿]/, "Hebrew"],
  [/[Ͱ-Ͽ]/, "Greek"],
  [/[Ѐ-ӿ]/, "Russian"]
];

/** Latin-script languages, scored by the function words a sentence cannot avoid. */
const LATIN_MARKERS: Array<[string, Set<string>, RegExp | null]> = [
  [
    "French",
    new Set(
      "le la les un une des est et ne pas je il elle vous nous que qui pour dans avec monsieur madame plus moi toi deja non oui".split(
        " "
      )
    ),
    /[àâçéèêëîïôûùüœ]/i
  ],
  [
    "Spanish",
    new Set(
      "el los las una es y no que de por para con senor senora muy pero yo usted".split(
        " "
      )
    ),
    /[áíóúñ¿¡]/i
  ],
  [
    "German",
    new Set(
      "der die das ein eine ist und nicht ich du sie wir mit auf aber noch schon herr frau".split(
        " "
      )
    ),
    /[äöüß]/i
  ],
  [
    "Italian",
    new Set(
      "il lo gli una e non che di per con sono questo signore signora".split(
        " "
      )
    ),
    /[èìò]/i
  ],
  [
    "Portuguese",
    new Set("os as uma nao que para com voce senhor senhora muito".split(" ")),
    /[ãõ]/i
  ],
  [
    "English",
    new Set(
      "the a an is are and not i you he she we they to of for with it that this what always asleep no yo so do go be me my at in on up out if as or but his her him them was were have has had will would can just now here there get got know like one all well".split(
        " "
      )
    ),
    null
  ]
];

const LATIN_MARKER_SCORE = 2;
const LATIN_LETTER_SCORE = 3;

/** The language a line is written in, for when nobody said. Ties go to English. */
export const detectLanguage = (text: unknown): string => {
  const line = textOf(text);
  if (!line.trim()) return DEFAULT_LANGUAGE;

  for (const [pattern, language] of SCRIPT_LANGUAGES) {
    if (pattern.test(line)) return language;
  }

  const words = new Set(
    foldAccents(line)
      .split(/[^a-z']+/)
      .filter(Boolean)
  );
  const scores = new Map<string, number>();
  for (const [language, markers, letters] of LATIN_MARKERS) {
    let score = 0;
    for (const word of words)
      if (markers.has(word)) score += LATIN_MARKER_SCORE;
    if (letters?.test(line)) score += LATIN_LETTER_SCORE;
    scores.set(language, score);
  }
  const best = Math.max(...scores.values());
  if ((scores.get(DEFAULT_LANGUAGE) ?? 0) >= best) return DEFAULT_LANGUAGE;
  for (const [language] of LATIN_MARKERS) {
    if (scores.get(language) === best) return language;
  }
  return DEFAULT_LANGUAGE;
};

/** The `n` in `{{line:n}}`, for a 1-based turn index. */
export const linePlaceholder = (index: number): string => `{{line:${index}}}`;

/**
 * A script that plainly contains speech: a quotation mark, an ALL-CAPS cue
 * followed by a colon, or a speech verb. Deliberately loose — it only ever
 * decides whether to warn.
 */
export const LOOKS_LIKE_SPEECH_RE =
  /["'«»“”「」]|^\s*[A-ZÀ-Þ][A-ZÀ-Þ .'’-]{1,30}\s*[:：]|\b(says?|said|replies|asks?|whispers?|shouts?|dit|répond|dice|sagt)\b/im;

/**
 * Raise a shot's two durations to fit its spoken lines, keeping the margin
 * between them. Only ever raises.
 */
export const applySpeechFloor = (
  durationShortS: number,
  durationLongS: number,
  turns: readonly unknown[] | null | undefined
): [number, number] => {
  const needed = speechSeconds(turns);
  if (needed <= 0 || needed <= durationShortS)
    return [durationShortS, durationLongS];
  const margin = Math.max(durationLongS - durationShortS, 0);
  return [pythonRound(needed, 2), pythonRound(needed + margin, 2)];
};

/** How many spoken lines a casting carries across sequences and shots. */
export const countDialogueLines = (casting: unknown): number => {
  const record =
    casting && typeof casting === "object"
      ? (casting as Record<string, unknown>)
      : {};
  const count = (rows: unknown): number =>
    Array.isArray(rows)
      ? rows.reduce(
          (total: number, row) =>
            total +
            (row &&
            typeof row === "object" &&
            Array.isArray((row as { dialogue?: unknown }).dialogue)
              ? (row as { dialogue: unknown[] }).dialogue.length
              : 0),
          0
        )
      : 0;
  return count(record.sequences) + count(record.shots);
};
