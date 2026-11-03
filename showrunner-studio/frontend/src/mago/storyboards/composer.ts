/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
type Label = {
  label: string;
  kind: string;
  ref_id: string | null;
  panel_count?: number;
  anchored_to?: string | null;
  replaces?: string;
  character_sheet?: boolean;
};

export const storyboardRetention = (
  labels: Label[]
): Record<string, string> => {
  const board = labels.find(
    (label) => label.kind === "image" && label.ref_id === "storyboard-sheet"
  );
  if (!board) return {};
  const subjects = labels.filter((label) => label.kind === "subject");
  const anchors = new Set(subjects.map((label) => label.anchored_to));
  const sheets = labels
    .filter(
      (label) =>
        label.kind === "image" &&
        label.character_sheet &&
        anchors.has(label.label)
    )
    .map((label) => label.label);
  return Object.fromEntries([
    [board.label, "partially_preserved"],
    ...sheets.map((label) => [label, "fully_preserved"]),
    ...subjects
      .filter(
        (label) => sheets.includes(label.anchored_to ?? "") && !label.replaces
      )
      .map((label) => [label.label, "fully_preserved"])
  ]);
};

export const applyStoryboardLines = <
  T extends { retention_analysis: string; detailed_description: string }
>(
  sections: T,
  labels: Label[],
  retention: Record<string, string>
): T => {
  const board = labels.find(
    (label) => label.kind === "image" && label.ref_id === "storyboard-sheet"
  );
  if (!board) return sections;
  let analysis = sections.retention_analysis;
  for (const label of Object.keys(storyboardRetention(labels))) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    analysis = analysis.replace(
      new RegExp(
        `^(\\s*(?:(?:[-*•]|\\d+[.)])\\s+)?${escaped}(?!\\d)[^:\\n]*:\\s*)weak_reference\\b`,
        "gm"
      ),
      `$1${retention[label]}`
    );
  }
  const text = sections.detailed_description;
  const starts = [...text.matchAll(/\[Shot (\d+)\]/g)].reduce<
    RegExpMatchArray[]
  >(
    (found, item) =>
      Number(item[1]) === found.length + 1 ? [...found, item] : found,
    []
  );
  const detailed = starts.length
    ? text.slice(0, starts[0]!.index) +
      starts
        .map((start, i) => {
          const segment = text.slice(
            start.index,
            starts[i + 1]?.index ?? text.length
          );
          if (i + 1 > (board.panel_count ?? 1)) return segment;
          const body = segment.trimEnd();
          return `${body}${/[.!?]$/.test(body) ? "" : "."} Stage this shot as panel ${i + 1} of ${board.label}.${segment.slice(body.length)}`;
        })
        .join("")
    : text;
  return {
    ...sections,
    retention_analysis: analysis,
    detailed_description: detailed
  };
};
