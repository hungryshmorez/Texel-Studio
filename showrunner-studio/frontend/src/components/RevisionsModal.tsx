// RevisionsModal.tsx — save, compare and restore versions of a scene's writing.
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { Save, Trash, Undo2 } from "lucide-react";
import type { CharacterEntity, RevisionEntity, SceneEntity } from "../types";
import { db } from "../lib/db";
import { deleteRevision, restoreRevision, saveRevision, snapshotScene } from "../lib/writingActions";
import { diffLines, hasChanges } from "../lib/textDiff";
import { sceneText } from "../lib/sceneText";
import { Button, Chip, Modal, TextInput } from "./ui";

interface RevisionsModalProps {
  open: boolean;
  onClose: () => void;
  scene: SceneEntity;
  characters: CharacterEntity[];
}

export function RevisionsModal({ open, onClose, scene, characters }: RevisionsModalProps) {
  const [label, setLabel] = useState("");
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revisions = useLiveQuery(
    async () => (await db.revisions.where("sceneId").equals(scene.id).toArray()).sort((a, b) => b.createdAt - a.createdAt),
    [scene.id],
    [] as RevisionEntity[]
  );
  const comparing = (revisions ?? []).find((r) => r.id === comparingId);
  const diff = useMemo(() => (comparing ? diffLines(sceneText(comparing.snapshot, characters), sceneText(snapshotScene(scene), characters)) : []), [comparing, scene, characters]);

  const run = async (task: () => Promise<unknown>) => {
    setError(null);
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong."); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Scene history" subtitle={`Saved versions of “${scene.sceneName}”. Restoring keeps your current text as a safety copy.`} wide>
      <div className="space-y-4 p-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await saveRevision(scene.id, label); setLabel(""); }); }}>
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version (optional)" aria-label="Revision name" />
          <Button variant="primary" size="md" type="submit"><Save size={13} /> Save version</Button>
        </form>
        {error && <p role="alert" className="text-[12px] text-red-300">{error}</p>}
        {(revisions ?? []).length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-800 px-3 py-4 text-[12px] text-neutral-600">No saved versions yet. Save one before a big rewrite.</p>
        ) : (
          <ul className="space-y-1.5" aria-label="Saved versions">
            {(revisions ?? []).map((revision) => (
              <li key={revision.id} className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-800 px-2.5 py-1.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-neutral-200">{revision.label || "Snapshot"}</span>
                {revision.auto && <Chip tone="dim">auto</Chip>}
                <time className="font-mono text-[10px] text-neutral-500" dateTime={new Date(revision.createdAt).toISOString()}>{new Date(revision.createdAt).toLocaleString()}</time>
                <Button size="xs" onClick={() => setComparingId(comparingId === revision.id ? null : revision.id)} aria-pressed={comparingId === revision.id}>Compare</Button>
                <Button size="xs" onClick={() => void run(() => restoreRevision(revision.id))} aria-label={`Restore ${revision.label || "snapshot"}`}><Undo2 size={11} /> Restore</Button>
                <Button size="icon" variant="subtle" onClick={() => void run(() => deleteRevision(revision.id))} aria-label={`Delete ${revision.label || "snapshot"}`}><Trash size={12} /></Button>
              </li>
            ))}
          </ul>
        )}
        {comparing && (
          <section aria-label="Comparison with the current scene" className="space-y-1">
            <p className="text-[11px] text-neutral-500">This version → current scene. Red lines were removed, green lines were added.</p>
            {hasChanges(diff) ? (
              <pre className="max-h-72 overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-2 font-mono text-[11.5px] leading-relaxed">
                {diff.map((op, index) => (
                  <div key={index} className={clsx(op.type === "added" && "bg-emerald-950/60 text-emerald-300", op.type === "removed" && "bg-red-950/60 text-red-300", op.type === "same" && "text-neutral-500")}>
                    {op.type === "added" ? "+ " : op.type === "removed" ? "- " : "  "}{op.text}
                  </div>
                ))}
              </pre>
            ) : <p className="text-[12px] text-neutral-500">No differences from the current scene.</p>}
          </section>
        )}
      </div>
    </Modal>
  );
}
