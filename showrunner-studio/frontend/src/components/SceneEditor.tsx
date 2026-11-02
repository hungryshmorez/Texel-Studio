// SceneEditor.tsx — Scene Outline & Script editor. Writes partial patches to
// Dexie on every change (local-first autosave); exports engines re-run live.
import { useState } from "react";
import { Clapperboard, MessageSquare, Plus, Trash } from "lucide-react";
import clsx from "clsx";
import type { CharacterEntity, DialogueLine, EpisodeEntity, SceneEntity, SetEntity } from "../types";
import { deleteScene, updateScene } from "../lib/actions";
import { uid } from "../lib/db";
import { Button, Chip, Field, Label, Select, TextArea, TextInput } from "./ui";
import { TaggedTextarea } from "./TaggedTextarea";
import { useConfirm } from "./ConfirmDialog";
import { SceneMeta } from "./SceneMeta";
import { RevisionsModal } from "./RevisionsModal";

interface SceneEditorProps {
  scene: SceneEntity;
  episode: EpisodeEntity | null;
  sets: SetEntity[];
  characters: CharacterEntity[];
  onOpenSets: () => void;
  onOpenCharacters: () => void;
}

export function SceneEditor({ scene, episode, sets, characters, onOpenSets, onOpenCharacters }: SceneEditorProps) {
  const confirm = useConfirm();
  const patch = (p: Partial<SceneEntity>) => void updateScene(scene.id, p);
  const [historyOpen, setHistoryOpen] = useState(false);
  const set = sets.find((s) => s.id === scene.targetSetId);

  // --- Active characters ----------------------------------------------------
  const toggleCharacter = (cid: string) => {
    const next = scene.activeCharacterIds.includes(cid)
      ? scene.activeCharacterIds.filter((id) => id !== cid)
      : [...scene.activeCharacterIds, cid];
    patch({ activeCharacterIds: next });
  };

  // --- Dialogue ---------------------------------------------------------------
  const setDialogue = (next: DialogueLine[]) => patch({ dialogue: next });
  const addLine = () =>
    setDialogue([...scene.dialogue, { id: uid("dl"), characterId: characters[0]?.id ?? "", text: "", parenthetical: "" }]);
  const patchLine = (id: string, p: Partial<DialogueLine>) =>
    setDialogue(scene.dialogue.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const removeLine = (id: string) => setDialogue(scene.dialogue.filter((d) => d.id !== id));

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="amber">
          <Clapperboard size={10} aria-hidden />
          SCENE {scene.order}
          {episode ? ` · ${episode.title}` : ""}
        </Chip>
        <TextInput
          value={scene.sceneName}
          onChange={(e) => patch({ sceneName: e.target.value })}
          placeholder="Scene name"
          aria-label="Scene name"
          className="min-w-0 flex-1 border-transparent bg-transparent text-base font-semibold text-neutral-100 hover:border-neutral-800 focus:border-amber-500/60 focus:bg-neutral-950"
        />
        <Button
          variant="danger"
          onClick={async () => {
            if (await confirm({ message: `Delete "${scene.sceneName}"? This cannot be undone.`, confirmLabel: "Delete scene" })) void deleteScene(scene.id);
          }}
          aria-label="Delete scene"
        >
          <Trash size={13} />
          Delete
        </Button>
      </div>

      <SceneMeta scene={scene} set={set} patch={patch} onOpenHistory={() => setHistoryOpen(true)} />
      <RevisionsModal open={historyOpen} onClose={() => setHistoryOpen(false)} scene={scene} characters={characters} />

      {/* Set + cast */}
      <div className="grid grid-cols-1 gap-4">
        <Field
          label="Target set"
          hint={
            sets.length === 0
              ? "No sets registered yet — open the Sets catalog to add one."
              : "The #Set tag attached to every shot/clip in both export formats."
          }
        >
          <div className="flex items-center gap-2">
            <Select
              value={scene.targetSetId ?? ""}
              onChange={(e) => patch({ targetSetId: e.target.value || null })}
              aria-label="Target set"
            >
              <option value="">— no set —</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.timeOfDay ? ` · ${s.timeOfDay}` : ""}
                </option>
              ))}
            </Select>
            <Button size="md" onClick={onOpenSets} title="Manage sets">
              Manage
            </Button>
          </div>
        </Field>

        <Field label="Active characters">
          {characters.length === 0 ? (
            <p className="text-[12px] leading-snug text-neutral-600">
              No characters registered yet.{" "}
              <button type="button" onClick={onOpenCharacters} className="cursor-pointer text-amber-400 underline-offset-2 hover:underline">
                Open the Characters manager
              </button>{" "}
              to create your cast.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Active characters">
                {characters.map((c) => {
                  const active = scene.activeCharacterIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={clsx(
                        "flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                        active
                          ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
                          : "border-neutral-800 bg-neutral-900 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={active}
                        onChange={() => toggleCharacter(c.id)}
                      />
                      <span className="font-mono text-[10px] text-amber-400/80">@</span>
                      {c.name}
                    </label>
                  );
                })}
              </div>
              <Button variant="subtle" size="xs" className="self-start" onClick={onOpenCharacters}>
                <Plus size={11} />
                Manage characters
              </Button>
            </>
          )}
        </Field>
      </div>

      {/* Action */}
      <Field label="Action" hint="Blank-line-separated paragraphs become separate shots (Seedance) / clips (Showrunner). Type @ or # to tag characters and sets.">
        <TaggedTextarea
          value={scene.action}
          onChange={(v) => patch({ action: v })}
          characters={characters.map((c) => ({ id: c.id, name: c.name }))}
          sets={sets.map((s) => ({ id: s.id, name: s.name }))}
          rows={10}
          ariaLabel="Scene action"
          placeholder={
            "Describe the action in cinematic verbs — one paragraph per shot.\n\nExample:\nCUSTARD waddles to the dead CRT and taps the glass twice. The screen flickers to static. Camera slowly pushes in on his reflection.\n\nCUSTARD turns to camera, eyes wide. Whip pan to the booth door creaking open."
          }
        />
      </Field>

      {/* Dialogue */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare size={11} aria-hidden /> Dialogue ({scene.dialogue.length})
            </span>
          </Label>
          <Button variant="ghost" size="xs" onClick={addLine} disabled={characters.length === 0}>
            <Plus size={11} />
            Add line
          </Button>
        </div>
        {scene.dialogue.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-800 px-3 py-2.5 text-[12px] text-neutral-600">
            No dialogue yet. Added lines are attached to the final shot of the Seedance batch and rendered as
            “@Name: “line”” blocks in Showrunner format.
          </p>
        ) : (
          <ul className="space-y-2">
            {scene.dialogue.map((line) => {
              const speaker = characters.find((c) => c.id === line.characterId);
              return (
                <li key={line.id} className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/50 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={line.characterId}
                      onChange={(e) => patchLine(line.id, { characterId: e.target.value })}
                      aria-label="Speaking character"
                      className="w-44 shrink-0"
                    >
                      {!speaker && line.characterId && <option value={line.characterId}>(missing character)</option>}
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          @{c.name}
                        </option>
                      ))}
                    </Select>
                    <TextInput
                      value={line.parenthetical ?? ""}
                      onChange={(e) => patchLine(line.id, { parenthetical: e.target.value })}
                      placeholder="(parenthetical — optional)"
                      aria-label="Parenthetical"
                      className="w-48 flex-1 italic"
                    />
                    <Button
                      variant="subtle"
                      size="icon"
                      onClick={() => removeLine(line.id)}
                      aria-label="Remove dialogue line"
                    >
                      <Trash size={12} />
                    </Button>
                  </div>
                  <TaggedTextarea
                    value={line.text}
                    onChange={(v) => patchLine(line.id, { text: v })}
                    characters={characters.map((c) => ({ id: c.id, name: c.name }))}
                    sets={sets.map((s) => ({ id: s.id, name: s.name }))}
                    rows={2}
                    ariaLabel={`Line for @${speaker?.name ?? "unknown"}`}
                    placeholder={`What does ${speaker ? `@${speaker.name}` : "they"} say…`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Notes */}
      <Field label="Scene notes" hint="Internal only — not included in exports.">
        <TextArea
          value={scene.sceneNotes}
          onChange={(e) => patch({ sceneNotes: e.target.value })}
          rows={3}
          placeholder="Continuity, prop checks, things to fix in the next pass…"
          aria-label="Scene notes"
        />
      </Field>
    </div>
  );
}
