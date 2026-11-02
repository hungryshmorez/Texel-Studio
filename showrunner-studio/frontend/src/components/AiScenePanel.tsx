// AiScenePanel.tsx — Generate a scene draft with AI (POST /api/generate-scene),
// preview it, then apply it to the selected scene (or create a new one).
import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, Sparkles, WandSparkles } from "lucide-react";
import clsx from "clsx";
import type { CharacterEntity, EpisodeEntity, SceneEntity, SetEntity, ShowMeta } from "../types";
import { createScene, updateScene } from "../lib/actions";
import { saveRevision } from "../lib/writingActions";
import { uid } from "../lib/db";
import { Button, Chip, Field, Label, Select, Spinner, TextArea } from "./ui";

interface GeneratedDialogue {
  character_id: string;
  text: string;
  parenthetical?: string;
}

interface GeneratedScene {
  scene_name: string;
  action: string;
  dialogue: GeneratedDialogue[];
  scene_notes: string;
}

interface AiScenePanelProps {
  show: ShowMeta | null;
  episode: EpisodeEntity | null;
  scene: SceneEntity | null;
  sets: SetEntity[];
  characters: CharacterEntity[];
  onApplied: (sceneId: string) => void;
}

type Status = "idle" | "loading" | "done" | "error";

export function AiScenePanel({ show, episode, scene, sets, characters, onApplied }: AiScenePanelProps) {
  const [concept, setConcept] = useState("");
  const [chosenSetId, setChosenSetId] = useState<string>(scene?.targetSetId ?? "");
  const [chosenCharIds, setChosenCharIds] = useState<string[]>(scene?.activeCharacterIds ?? []);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<GeneratedScene | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed defaults when the working scene changes.
  useEffect(() => {
    setChosenSetId(scene?.targetSetId ?? "");
    setChosenCharIds(scene?.activeCharacterIds ?? []);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, [scene?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCharacter = (cid: string) => {
    setChosenCharIds((ids) => (ids.includes(cid) ? ids.filter((id) => id !== cid) : [...ids, cid]));
  };

  const canGenerate = show !== null && concept.trim().length > 0 && status !== "loading";

  const generate = async () => {
    if (!show || !concept.trim()) return;
    setStatus("loading");
    setError(null);
    try {
      const chosenSet = sets.find((s) => s.id === chosenSetId) ?? null;
      const chosenCharacters = chosenCharIds
        .map((id) => characters.find((c) => c.id === id))
        .filter((c): c is CharacterEntity => Boolean(c));

      const res = await fetch("/api/generate-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_title: show.title,
          show_genre: show.genre,
          show_premise: show.premise,
          set: chosenSet
            ? {
                id: chosenSet.id,
                name: chosenSet.name,
                time_of_day: chosenSet.timeOfDay,
                description: chosenSet.description,
              }
            : null,
          characters: chosenCharacters.map((c) => ({
            id: c.id,
            name: c.name,
            role: c.role,
            age: c.age,
            gender: c.gender,
            visual_description: c.visualDescription,
            voice_description: c.voiceDescription,
          })),
          scene_concept: concept.trim(),
          episode_title: episode?.title ?? "",
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`API responded ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
      }
      const data = (await res.json()) as GeneratedScene;
      setResult(data);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };

  const apply = async () => {
    if (!result) return;
    const dialogue = result.dialogue.map((d) => ({
      id: uid("dl"),
      characterId: d.character_id,
      text: d.text,
      parenthetical: d.parenthetical ?? "",
    }));
    const patch = {
      sceneName: result.scene_name || scene?.sceneName || "Generated scene",
      action: result.action,
      dialogue,
      sceneNotes: result.scene_notes ?? "",
      targetSetId: chosenSetId || null,
      activeCharacterIds: chosenCharIds,
    };
    if (scene) {
      if (scene.status === "locked") return; // the button is disabled too; never overwrite a locked scene
      // Keep the writer's text so an AI draft can always be undone from the scene history.
      await saveRevision(scene.id, "Before AI scene", true);
      await updateScene(scene.id, patch);
      onApplied(scene.id);
    } else if (episode) {
      const newId = await createScene(episode.id, patch);
      onApplied(newId);
    }
    setStatus("idle");
    setResult(null);
    setConcept("");
  };

  return (
    <div className="space-y-4">
      <Label className="inline-flex items-center gap-1.5">
        <WandSparkles size={11} aria-hidden /> AI scene generator
      </Label>
      <p className="text-[12px] leading-snug text-neutral-500">
        Show context comes from the{" "}
        <span className="text-neutral-300">{show?.title ?? "current show"}</span> Show Bible. Pick a set and
        cast, describe what happens, and the generated draft lands in the script editor for revision.
      </p>

      <Field label="Set">
        <Select value={chosenSetId} onChange={(e) => setChosenSetId(e.target.value)} aria-label="Set for generation">
          <option value="">— no set —</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              #{s.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Characters">
        {characters.length === 0 ? (
          <p className="text-[12px] text-neutral-600">No characters registered for this show yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Characters for generation">
            {characters.map((c) => {
              const active = chosenCharIds.includes(c.id);
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
                  <input type="checkbox" className="sr-only" checked={active} onChange={() => toggleCharacter(c.id)} />
                  <span className="font-mono text-[10px] text-amber-400/80">@</span>
                  {c.name}
                </label>
              );
            })}
          </div>
        )}
      </Field>

      <Field label="Scene concept" hint="One or two sentences: what happens, the mood, the turn.">
        <TextArea
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          rows={4}
          placeholder="Custard discovers the booth's teleprompter is writing back. He reads his own lines a half-second early…"
          aria-label="Scene concept"
        />
      </Field>

      <Button variant="primary" size="md" className="w-full" onClick={generate} disabled={!canGenerate}>
        {status === "loading" ? <Spinner /> : <Sparkles size={13} />}
        {status === "loading" ? "Generating…" : "Generate with AI"}
      </Button>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-900/50 bg-red-950/30 p-2.5 text-[12px] leading-snug text-red-300">
          <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>Generation failed: {error}</span>
        </div>
      )}

      {result && <GeneratedPreview result={result} characters={characters} />}

      {result && (
        <Button
          variant="success"
          size="md"
          className="w-full"
          onClick={apply}
          disabled={(!scene && !episode) || scene?.status === "locked"}
          title={scene?.status === "locked" ? "This scene is locked. Unlock it to apply an AI draft." : !scene && !episode ? "Select or create an episode first" : undefined}
        >
          {scene?.status === "locked" ? "Scene is locked" : `Apply to ${scene ? "current scene" : "new scene"}`}
        </Button>
      )}
    </div>
  );
}

function GeneratedPreview({ result, characters }: { result: GeneratedScene; characters: CharacterEntity[] }): ReactNode {
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? "UNKNOWN";
  return (
    <div className="space-y-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <Chip tone="amber">DRAFT</Chip>
        <span className="truncate text-[13px] font-semibold text-neutral-100">{result.scene_name}</span>
      </div>
      {result.action && (
        <div>
          <Label className="text-[9px]">Action</Label>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-neutral-300">{result.action}</p>
        </div>
      )}
      {result.dialogue.length > 0 && (
        <div>
          <Label className="text-[9px]">Dialogue</Label>
          <ul className="mt-1 space-y-1">
            {result.dialogue.map((d, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-neutral-300">
                <span className="font-mono text-amber-300">@{nameOf(d.character_id)}</span>
                {d.parenthetical ? <span className="italic text-neutral-500"> ({d.parenthetical})</span> : null}
                <span>: “{d.text}”</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.scene_notes && (
        <div>
          <Label className="text-[9px]">Notes</Label>
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-500">{result.scene_notes}</p>
        </div>
      )}
    </div>
  );
}
