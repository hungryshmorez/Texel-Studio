// BeatBoard.tsx — plan an episode as story beats, then turn each beat into a scene.
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ArrowDown, ArrowUp, FilePlus2, LayoutList, Plus, Trash } from "lucide-react";
import type { BeatEntity, EpisodeEntity, SceneEntity } from "../types";
import { db } from "../lib/db";
import { createScene } from "../lib/actions";
import { BEAT_TEMPLATES } from "../lib/beatTemplates";
import { applyBeatTemplate, createBeat, deleteBeat, moveBeat, updateBeat } from "../lib/writingActions";
import { Button, Chip, Field, Select, TextArea, TextInput } from "./ui";
import { useConfirm } from "./ConfirmDialog";

interface BeatBoardProps {
  episode: EpisodeEntity;
  scenes: SceneEntity[];
  onOpenScene: (sceneId: string) => void;
}

export function BeatBoard({ episode, scenes, onOpenScene }: BeatBoardProps) {
  const confirm = useConfirm();
  const [templateId, setTemplateId] = useState(BEAT_TEMPLATES[0].id);
  const beats = useLiveQuery(async () => (await db.beats.where("episodeId").equals(episode.id).toArray()).sort((a, b) => a.order - b.order), [episode.id], [] as BeatEntity[]);
  const list = beats ?? [];
  const template = BEAT_TEMPLATES.find((t) => t.id === templateId);
  const covered = list.filter((b) => b.sceneId && scenes.some((s) => s.id === b.sceneId)).length;

  const makeScene = async (beat: BeatEntity) => {
    const id = await createScene(episode.id, { sceneName: beat.label, summary: beat.text.split("\n")[0].slice(0, 140), status: "idea" });
    await updateBeat(beat.id, { sceneId: id });
    onOpenScene(id);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="amber"><LayoutList size={10} aria-hidden /> BEAT BOARD · {episode.title}</Chip>
        <span className="text-[11px] text-neutral-500">{list.length === 0 ? "No beats yet" : `${covered} of ${list.length} beats have a scene`}</span>
      </div>

      <section className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3" aria-label="Add beats">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Structure" className="min-w-48 flex-1">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Beat template">
              {BEAT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.beats.length})</option>)}
            </Select>
          </Field>
          <Button size="md" onClick={() => void applyBeatTemplate(episode.id, templateId)}><FilePlus2 size={13} /> Add these beats</Button>
          <Button size="md" onClick={() => void createBeat(episode.id, "New beat")}><Plus size={13} /> Blank beat</Button>
        </div>
        {template && <p className="text-[11px] text-neutral-500">{template.description}</p>}
      </section>

      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-800 px-3 py-6 text-center text-[12px] text-neutral-600">Pick a structure above to lay out the episode, or add blank beats.</p>
      ) : (
        <ol className="space-y-3" aria-label="Beats">
          {list.map((beat, index) => {
            const hint = BEAT_TEMPLATES.flatMap((t) => t.beats).find((b) => b.label === beat.label)?.hint;
            const linked = scenes.find((s) => s.id === beat.sceneId);
            return (
              <li key={beat.id} className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-amber-400">{index + 1}</span>
                  <TextInput value={beat.label} onChange={(e) => void updateBeat(beat.id, { label: e.target.value })} aria-label={`Beat ${index + 1} name`} className="min-w-0 flex-1 font-medium" />
                  <Button size="icon" variant="subtle" onClick={() => void moveBeat(beat.id, -1)} disabled={index === 0} aria-label={`Move beat ${index + 1} up`}><ArrowUp size={12} /></Button>
                  <Button size="icon" variant="subtle" onClick={() => void moveBeat(beat.id, 1)} disabled={index === list.length - 1} aria-label={`Move beat ${index + 1} down`}><ArrowDown size={12} /></Button>
                  <Button size="icon" variant="subtle" aria-label={`Delete beat ${index + 1}`} onClick={async () => { if (await confirm({ message: `Delete the beat “${beat.label}”? Its scene, if any, is kept.`, confirmLabel: "Delete beat" })) void deleteBeat(beat.id); }}><Trash size={12} /></Button>
                </div>
                <TextArea value={beat.text} onChange={(e) => void updateBeat(beat.id, { text: e.target.value })} rows={2} placeholder={hint ?? "What happens in this beat?"} aria-label={`Beat ${index + 1} text`} />
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={beat.sceneId ?? ""} onChange={(e) => void updateBeat(beat.id, { sceneId: e.target.value || null })} aria-label={`Scene for beat ${index + 1}`} className="w-56">
                    <option value="">No scene yet</option>
                    {scenes.map((s) => <option key={s.id} value={s.id}>{s.order}. {s.sceneName}</option>)}
                  </Select>
                  {linked ? <Button size="sm" onClick={() => onOpenScene(linked.id)}>Open scene</Button> : <Button size="sm" variant="primary" onClick={() => void makeScene(beat)}><Plus size={12} /> Create scene</Button>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
