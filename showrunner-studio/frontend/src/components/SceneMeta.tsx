// SceneMeta.tsx — screenplay heading parts, writing status and the one-line summary for a scene.
import { History } from "lucide-react";
import type { IntExt, SceneEntity, SceneStatus, SetEntity } from "../types";
import { inferIntExt, inferTimeOfDay, sceneHeading } from "../lib/fountain";
import { Button, Field, Select, TextInput } from "./ui";

const STATUSES: { id: SceneStatus; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "draft", label: "Draft" },
  { id: "revised", label: "Revised" },
  { id: "locked", label: "Locked" },
];
const TIMES = ["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "CONTINUOUS", "LATER"];

interface SceneMetaProps {
  scene: SceneEntity;
  set: SetEntity | undefined;
  patch: (p: Partial<SceneEntity>) => void;
  onOpenHistory: () => void;
}

export function SceneMeta({ scene, set, patch, onOpenHistory }: SceneMetaProps) {
  const autoIntExt = inferIntExt(set);
  const autoTime = inferTimeOfDay({ ...scene, timeOfDayTag: undefined }, set);
  return (
    <section className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3" aria-label="Scene heading and status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[12px] text-amber-200" aria-label="Screenplay heading">{sceneHeading(scene, set).replace(/^\./, "")}</p>
        <Button size="sm" onClick={onOpenHistory} aria-label="Open scene history"><History size={12} /> History</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Status">
          <Select value={scene.status ?? "draft"} onChange={(e) => patch({ status: e.target.value as SceneStatus })} aria-label="Scene status">
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="INT / EXT">
          <Select value={scene.intExt ?? ""} onChange={(e) => patch({ intExt: (e.target.value || undefined) as IntExt | undefined })} aria-label="Interior or exterior">
            <option value="">Auto ({autoIntExt})</option>
            <option value="INT">INT</option>
            <option value="EXT">EXT</option>
            <option value="INT/EXT">INT/EXT</option>
          </Select>
        </Field>
        <Field label="Time of day">
          <Select value={scene.timeOfDayTag ?? ""} onChange={(e) => patch({ timeOfDayTag: e.target.value || undefined })} aria-label="Time of day">
            <option value="">Auto ({autoTime})</option>
            {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Summary" className="col-span-2 sm:col-span-1">
          <TextInput value={scene.summary ?? ""} onChange={(e) => patch({ summary: e.target.value })} placeholder="One line for the beat board" aria-label="Scene summary" />
        </Field>
      </div>
      {scene.status === "locked" && <p className="text-[11px] text-amber-300/80">Locked: AI tools will not overwrite this scene. Unlock it to apply an AI draft or shot list.</p>}
    </section>
  );
}
