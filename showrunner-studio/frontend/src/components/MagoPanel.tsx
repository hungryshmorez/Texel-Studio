// MagoPanel.tsx — check the writing against the bible, then package it for Mago Studio.
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { AlertTriangle, CircleAlert, FileText, Info, Package } from "lucide-react";
import type { CharacterEntity, EpisodeEntity, ImageAsset, SceneEntity, SetEntity, ShotEntity, ShowMeta } from "../types";
import { db } from "../lib/db";
import { checkProject, countBySeverity, type Issue, type Severity } from "../lib/consistency";
import { buildBridge, packageFileName, zipPackage } from "../lib/magoExport";
import { downloadBlob } from "../lib/download";
import { Button, Chip, CopyButton, Select } from "./ui";

const ICONS: Record<Severity, typeof Info> = { error: CircleAlert, warn: AlertTriangle, info: Info };
const TONES: Record<Severity, string> = { error: "text-red-300", warn: "text-amber-300", info: "text-neutral-400" };

interface MagoPanelProps {
  show: ShowMeta | null;
  episode: EpisodeEntity | null;
  sets: SetEntity[];
  characters: CharacterEntity[];
  onOpenScene: (episodeId: string, sceneId: string) => void;
}

export function MagoPanel({ show, episode, sets, characters, onOpenScene }: MagoPanelProps) {
  const [scope, setScope] = useState<"show" | "episode">("show");
  const [showAll, setShowAll] = useState(false);
  const data = useLiveQuery(async () => {
    if (!show) return null;
    const episodes = await db.episodes.where("showId").equals(show.id).toArray();
    const ids = new Set(episodes.map((e) => e.id));
    const scenes = (await db.scenes.toArray()).filter((s) => ids.has(s.episodeId));
    const sceneIds = new Set(scenes.map((s) => s.id));
    const shots = (await db.shots.toArray()).filter((s) => sceneIds.has(s.sceneId));
    const images = await db.images.where("showId").equals(show.id).toArray();
    return { episodes, scenes, shots, images } as { episodes: EpisodeEntity[]; scenes: SceneEntity[]; shots: ShotEntity[]; images: ImageAsset[] };
  }, [show?.id], null);

  const issues = useMemo(() => (show && data ? checkProject({ show, sets, characters, ...data }) : []), [show, data, sets, characters]);
  const counts = countBySeverity(issues);
  const effectiveScope = scope === "episode" && episode ? "episode" : "show";
  const pkg = useMemo(() => (show && data ? buildBridge({ show, sets, characters, ...data, episodeId: effectiveScope === "episode" ? episode?.id : undefined }) : null), [show, data, sets, characters, effectiveScope, episode?.id]);

  if (!show) return <p className="text-xs text-neutral-500">Select a show to export it.</p>;
  if (!data || !pkg) return <p className="text-xs text-neutral-500">Loading…</p>;

  const title = effectiveScope === "episode" && episode ? `${show.title} ${episode.title}` : show.title;
  const visible = showAll ? issues : issues.slice(0, 6);
  const director = pkg.files.find((f) => f.path === "director-script.txt")?.text ?? "";
  const fountain = pkg.files.find((f) => f.path === "script.fountain")?.text ?? "";
  const hasScenes = data.scenes.length > 0;

  return (
    <div className="space-y-4">
      <section className="space-y-2" aria-label="Checks">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-[12px] font-semibold text-neutral-200">Checks</h3>
          <Chip tone={counts.error ? "danger" : "green"}>{counts.error} errors</Chip>
          <Chip tone={counts.warn ? "amber" : "dim"}>{counts.warn} warnings</Chip>
          <Chip tone="dim">{counts.info} notes</Chip>
        </div>
        {issues.length === 0 ? <p className="text-[12px] text-emerald-300/80">Nothing to fix. The writing matches the bible.</p> : (
          <ul className="space-y-1" aria-label="Check results">
            {visible.map((issue: Issue, index) => {
              const Icon = ICONS[issue.severity];
              return (
                <li key={`${issue.code}-${index}`} className="flex items-start gap-1.5 text-[11.5px] leading-snug">
                  <Icon size={12} className={clsx("mt-0.5 shrink-0", TONES[issue.severity])} aria-label={issue.severity} />
                  <span className="text-neutral-300">{issue.message}</span>
                  {issue.sceneId && issue.episodeId && <button type="button" onClick={() => onOpenScene(issue.episodeId!, issue.sceneId!)} className="ml-auto shrink-0 cursor-pointer text-amber-400 hover:underline">Open</button>}
                </li>
              );
            })}
          </ul>
        )}
        {issues.length > 6 && <Button size="xs" variant="subtle" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${issues.length}`}</Button>}
      </section>

      <section className="space-y-2" aria-label="Export to Mago Studio">
        <h3 className="text-[12px] font-semibold text-neutral-200">Send to Mago Studio</h3>
        <p className="text-[11px] leading-snug text-neutral-500">Mago has no script importer, so this makes a package you paste into Mago Director: the script with style, cast and environments, the shot table for each scene, storyboard prompts, and reference images.</p>
        <Select value={effectiveScope} onChange={(e) => setScope(e.target.value as "show" | "episode")} aria-label="What to export">
          <option value="show">Whole show</option>
          {episode && <option value="episode">This episode: {episode.title}</option>}
        </Select>
        {pkg.warnings.length > 0 && (
          <ul className="space-y-0.5 rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] text-amber-200/90" aria-label="Export notes">
            {pkg.warnings.slice(0, 5).map((w) => <li key={w}>• {w}</li>)}
            {pkg.warnings.length > 5 && <li>• …and {pkg.warnings.length - 5} more</li>}
          </ul>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button variant="primary" size="md" disabled={!hasScenes} onClick={() => downloadBlob(packageFileName(title), zipPackage(pkg), "application/zip")} aria-label="Download Mago package"><Package size={13} /> Download package (.zip)</Button>
          <CopyButton text={director} label="Copy Director script" size="md" variant="ghost" />
          <Button size="md" disabled={!hasScenes} onClick={() => downloadBlob(`${packageFileName(title).replace(/-mago-package\.zip$/, "")}.fountain`, fountain, "text/plain")} aria-label="Download Fountain screenplay"><FileText size={13} /> Fountain</Button>
        </div>
        <details className="text-[11.5px] text-neutral-400">
          <summary className="cursor-pointer text-neutral-300">How to use it in Mago Studio</summary>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 leading-snug">
            <li>Create a Mago Director project.</li>
            <li>Paste <code className="font-mono text-amber-300">director-script.txt</code> into the script box.</li>
            <li>When casting, attach the images from <code className="font-mono text-amber-300">cast/</code> and <code className="font-mono text-amber-300">environments/</code>.</li>
            <li>Paste each <code className="font-mono text-amber-300">shots/*.txt</code> shot table into its scene's video prompt.</li>
            <li>Use <code className="font-mono text-amber-300">storyboard-prompts.md</code> for the storyboard wording.</li>
          </ol>
          <p className="mt-1.5">Mago Studio is a separate program licensed AGPL-3.0. Nothing here includes its code.</p>
        </details>
      </section>
    </div>
  );
}
