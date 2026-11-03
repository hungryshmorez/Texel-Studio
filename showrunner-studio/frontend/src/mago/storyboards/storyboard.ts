/*
 * Part of Showwriter Studio. Ported from Mago Studio
 * (https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
 * licensed under the GNU Affero General Public License, version 3 only.
 * This file is modified: import paths and type-only imports adjusted for the browser build.
 * See LICENSE and NOTICE.md at the repository root.
 */
import { fingerprint } from "../renderSpec";

type Row = Record<string, unknown>;
export const rows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Row =>
          !!item && typeof item === "object" && !Array.isArray(item)
      )
    : [];
export const storyboardToken = (id: string) =>
  `storyboard_${id.replace(/-/g, "_")}`;
export const isStoryboard = (key: Row) => key.role === "storyboard";
const clean = (value: string) =>
  value
    .replace(/(?:[A-Z][A-Z0-9 .'\-]*:\s*)?\{\{line:\d+\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const sceneCuts = (
  prompt: unknown
): { context: string; cuts: string[] } => {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  const headings = [
    ...text.matchAll(/\[Shot\s+(\d+)\]\s*(?:\([^)]*\))?\s*/g)
  ].reduce<RegExpMatchArray[]>(
    (found, match) =>
      Number(match[1]) === found.length + 1 ? [...found, match] : found,
    []
  );
  if (!headings.length) {
    const paragraphs = text.split(/\n\s*\n/);
    const cut = clean(paragraphs.pop() ?? "");
    return { context: clean(paragraphs.join(" ")), cuts: cut ? [cut] : [] };
  }
  return {
    context: clean(text.slice(0, headings[0]!.index)),
    cuts: headings.map((heading, index) =>
      clean(
        text.slice(
          heading.index! + heading[0].length,
          headings[index + 1]?.index ?? text.length
        )
      )
    )
  };
};

export const sceneCast = (shot: Row, keys: Row[]): Row[] => {
  const tags = (shot.tags ?? {}) as Row;
  return [
    ["characters", "character"],
    ["environments", "environment"],
    ["props", "prop"]
  ].flatMap(([group, kind]) =>
    (Array.isArray(tags[group!]) ? (tags[group!] as unknown[]) : []).flatMap(
      (token) => {
        const key = keys.find((candidate) => candidate.token === token);
        return [
          {
            kind,
            name: String(key?.name || token),
            description:
              typeof key?.description === "string" ? key.description : ""
          }
        ];
      }
    )
  );
};

export const sceneFingerprint = (shot: Row, keys: Row[]) =>
  fingerprint({
    kind: "storyboard_scene",
    cuts: sceneCuts(shot.video_prompt).cuts,
    cast: sceneCast(shot, keys).map((member) => [member.kind, member.name])
  });

export const storyboardState = (
  shot: Row,
  keys: Row[],
  plans: Row[] = [],
  withVersions = false
): Row => {
  const key = keys.find(
    (candidate) =>
      isStoryboard(candidate) && candidate.timeline_id === shot.timeline_id
  );
  const images = [...rows(key?.images)].reverse();
  const effective =
    images.find((image) => image.asset_id === key?.selected_asset_id) ??
    images.find(
      (image) => image.status === "available" || image.status === "finished"
    );
  const attempts = plans.filter((plan) =>
    rows(plan.local_targets).some(
      (target) =>
        isStoryboard(target) && target.timeline_id === shot.timeline_id
    )
  );
  const latest = attempts.at(-1);
  const versions = [
    ...images,
    ...attempts.flatMap((plan) => {
      if (
        plan.status === "COMPLETED" ||
        images.some((image) => image.storyboard_plan_id === plan.id)
      )
        return [];
      const target = rows(plan.local_targets).find(
        (item) => item.timeline_id === shot.timeline_id
      );
      return [
        {
          asset_id: String(plan.id),
          clip_id: null,
          status: ["PENDING", "RUNNING"].includes(String(plan.status))
            ? "rendering"
            : "failed",
          url: null,
          thumbnail_url: null,
          created_at: plan.created_at ?? null,
          panel_count: target?.panel_count ?? null,
          prompt: target?._local_render_prompt ?? null
        }
      ];
    })
  ].sort((a, b) =>
    (typeof b.created_at === "string" ? b.created_at : "").localeCompare(
      typeof a.created_at === "string" ? a.created_at : ""
    )
  );
  const running =
    latest && ["PENDING", "RUNNING"].includes(String(latest.status));
  const failed =
    latest?.status === "PAUSED" ||
    latest?.status === "FAILED" ||
    latest?.status === "CANCELLED";
  const target = rows(latest?.local_targets).find(
    (item) => item.timeline_id === shot.timeline_id
  );
  const spec =
    effective?.storyboard_scene_fingerprint ??
    (effective?.render_spec as Row | undefined)?.storyboard_scene_fingerprint;
  return {
    credits_per_render: null,
    shot_count: sceneCuts(shot.video_prompt).cuts.length,
    status: running
      ? "generating"
      : effective
        ? spec === sceneFingerprint(shot, keys)
          ? "ready"
          : "stale"
        : failed
          ? "failed"
          : "missing",
    enabled: key?.enabled !== false,
    selected_asset_id: key?.selected_asset_id ?? null,
    effective_asset_id: effective?.asset_id ?? null,
    image_url: effective?.url ?? null,
    thumbnail_url: effective?.thumbnail_url ?? null,
    panel_count:
      effective?.panel_count ??
      (effective?.render_spec as Row | undefined)?.panel_count ??
      null,
    version_count: versions.length,
    last_attempt_failed: !!failed,
    generating_clip_id: null,
    generating_started_at: running ? (latest.created_at ?? null) : null,
    ...(withVersions
      ? {
          versions: versions.map((image) => ({ ...image, origin: "generated" }))
        }
      : {}),
    ...(running && target ? { generating_plan_id: latest.id } : {})
  };
};

export const storyboardReference = (shot: Row, keys: Row[]) => {
  const state = storyboardState(shot, keys);
  return state.enabled &&
    state.status === "ready" &&
    typeof state.effective_asset_id === "string"
    ? {
        asset_id: state.effective_asset_id,
        panel_count: Number(state.panel_count)
      }
    : null;
};
