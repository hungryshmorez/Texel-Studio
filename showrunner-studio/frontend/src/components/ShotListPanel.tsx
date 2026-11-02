// ShotListPanel.tsx — write a scene's shot list: camera, action, dialogue and the prompts that
// Mago Studio will turn into a storyboard and video. The words are written here.
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Copy, Download, Plus, Trash } from "lucide-react";
import type { CharacterEntity, SceneEntity, ShotEntity } from "../types";
import { listShots, createShot, deleteShot, moveShot, updateShot } from "../lib/writingActions";
import { FRAMING_OPTIONS, MOVEMENT_OPTIONS, formatShotLines, shotsToCsv, totalDuration } from "../lib/shotlist";
import { downloadBlob } from "../lib/download";
import { Button, Chip, CopyButton, Field, TextArea, TextInput } from "./ui";
import { useConfirm } from "./ConfirmDialog";

interface ShotListPanelProps {
  scene: SceneEntity | null;
  characters: CharacterEntity[];
}

export function ShotListPanel({ scene, characters }: ShotListPanelProps) {
  const confirm = useConfirm();
  const shots = useLiveQuery(() => (scene ? listShots(scene.id) : Promise.resolve([] as ShotEntity[])), [scene?.id], [] as ShotEntity[]);
  const list = shots ?? [];
  if (!scene) return <p className="text-xs text-neutral-500">Select a scene to write its shot list.</p>;

  const names = (ids: string[]) => ids.map((id) => characters.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
  const sceneCast = characters.filter((c) => scene.activeCharacterIds.includes(c.id));
  const total = totalDuration(list);
  const toggleCast = (shot: ShotEntity, id: string) => void updateShot(shot.id, { castIds: shot.castIds.includes(id) ? shot.castIds.filter((c) => c !== id) : [...shot.castIds, id] });
  const addShot = () => void createShot(scene.id, { castIds: scene.activeCharacterIds });
  const duplicate = async (shot: ShotEntity) => {
    const { id: _id, sceneId: _s, order: _o, createdAt: _c, updatedAt: _u, ...rest } = shot;
    void _id; void _s; void _o; void _c; void _u;
    await createShot(scene.id, rest);
  };

  return (
    <div className="space-y-3">
      <datalist id="framing-options">{FRAMING_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="movement-options">{MOVEMENT_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist>

      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="amber">{list.length} {list.length === 1 ? "shot" : "shots"} · {Math.round(total * 100) / 100}s</Chip>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <CopyButton text={formatShotLines(list, names).join("\n")} label="Copy shot table" size="xs" variant="ghost" />
          <Button size="xs" disabled={list.length === 0} onClick={() => downloadBlob(`${scene.sceneName.replace(/\W+/g, "-").toLowerCase() || "scene"}-shots.csv`, shotsToCsv(list, names), "text/csv")} aria-label="Download shot list as CSV"><Download size={11} /> CSV</Button>
          <Button variant="primary" size="xs" onClick={addShot}><Plus size={11} /> Add shot</Button>
        </div>
      </div>
      <p className="text-[11px] leading-snug text-neutral-500">Write the camera, the picture and the words here. Mago Studio draws the storyboard and renders the video from them.</p>

      {list.length === 0 && <p className="rounded-md border border-dashed border-neutral-800 px-3 py-5 text-center text-[12px] text-neutral-600">No shots yet. Add one, or break the action into shots.</p>}

      <ol className="space-y-3" aria-label="Shots">
        {list.map((shot, index) => (
          <li key={shot.id} className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] font-semibold text-amber-400">SHOT {index + 1}</span>
              <label className="ml-auto flex items-center gap-1 text-[11px] text-neutral-500">
                <input type="number" min="0.5" max="60" step="0.5" value={shot.durationSeconds} onChange={(e) => void updateShot(shot.id, { durationSeconds: Number(e.target.value) })} aria-label={`Shot ${index + 1} duration in seconds`}
                  className="h-6 w-14 rounded border border-neutral-800 bg-neutral-950 px-1.5 text-right text-[12px] text-neutral-200 focus:border-amber-500/60 focus:outline-none" /> s
              </label>
              <Button size="icon" variant="subtle" disabled={index === 0} onClick={() => void moveShot(shot.id, -1)} aria-label={`Move shot ${index + 1} up`}><ArrowUp size={12} /></Button>
              <Button size="icon" variant="subtle" disabled={index === list.length - 1} onClick={() => void moveShot(shot.id, 1)} aria-label={`Move shot ${index + 1} down`}><ArrowDown size={12} /></Button>
              <Button size="icon" variant="subtle" onClick={() => void duplicate(shot)} aria-label={`Duplicate shot ${index + 1}`}><Copy size={12} /></Button>
              <Button size="icon" variant="subtle" aria-label={`Delete shot ${index + 1}`} onClick={async () => { if (await confirm({ message: `Delete shot ${index + 1}?`, confirmLabel: "Delete shot" })) void deleteShot(shot.id); }}><Trash size={12} /></Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Framing"><TextInput list="framing-options" value={shot.framing} onChange={(e) => void updateShot(shot.id, { framing: e.target.value })} placeholder="Wide, Close-up…" aria-label={`Shot ${index + 1} framing`} /></Field>
              <Field label="Camera movement"><TextInput list="movement-options" value={shot.movement} onChange={(e) => void updateShot(shot.id, { movement: e.target.value })} placeholder="Static, Slow push-in…" aria-label={`Shot ${index + 1} movement`} /></Field>
            </div>
            <Field label="What the camera sees"><TextArea rows={2} value={shot.description} onChange={(e) => void updateShot(shot.id, { description: e.target.value })} aria-label={`Shot ${index + 1} description`} placeholder="Al on the mast at dusk, wind pulling at his coat" /></Field>
            <Field label="Spoken in this shot"><TextArea rows={1} value={shot.dialogue} onChange={(e) => void updateShot(shot.id, { dialogue: e.target.value })} aria-label={`Shot ${index + 1} dialogue`} placeholder="Only the words said during this shot" /></Field>
            {sceneCast.length > 0 && (
              <div className="flex flex-wrap gap-1" role="group" aria-label={`Shot ${index + 1} cast`}>
                {sceneCast.map((c) => {
                  const on = shot.castIds.includes(c.id);
                  return (
                    <button key={c.id} type="button" aria-pressed={on} onClick={() => toggleCast(shot, c.id)}
                      className={clsx("cursor-pointer rounded-full border px-2 py-0.5 text-[11px] transition-colors", on ? "border-amber-500/50 bg-amber-500/10 text-amber-200" : "border-neutral-800 text-neutral-500 hover:text-neutral-300")}>@{c.name}</button>
                  );
                })}
              </div>
            )}
            <Field label="Storyboard prompt" hint="Words for the black-marker sketch of this shot."><TextArea rows={2} value={shot.storyboardPrompt} onChange={(e) => void updateShot(shot.id, { storyboardPrompt: e.target.value })} aria-label={`Shot ${index + 1} storyboard prompt`} /></Field>
            <Field label="Video prompt" hint="Words for the video generator."><TextArea rows={3} value={shot.videoPrompt} onChange={(e) => void updateShot(shot.id, { videoPrompt: e.target.value })} aria-label={`Shot ${index + 1} video prompt`} /></Field>
            <Field label="Notes"><TextInput value={shot.notes} onChange={(e) => void updateShot(shot.id, { notes: e.target.value })} aria-label={`Shot ${index + 1} notes`} placeholder="Not exported to the video tool" /></Field>
          </li>
        ))}
      </ol>
    </div>
  );
}
