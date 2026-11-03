// ClipPrompts.tsx — whole-scene prompts built by Mago's writing engine from the scene's shot list:
// a storyboard-sheet prompt (instant, no AI) and a composed video prompt (one model call).
import { useState } from "react";
import { Clapperboard, Save, Sparkles, X } from "lucide-react";
import type { CharacterEntity, SceneEntity, SetEntity, ShotEntity, ShowMeta } from "../types";
import { updateScene } from "../lib/actions";
import { composeClipVideoPrompt, geminiRun, MAX_CLIP_SECONDS, storyboardPromptFor } from "../lib/magoWriting";
import { totalDuration } from "../lib/shotlist";
import { Button, Chip, CopyButton, Field, TextArea } from "./ui";

interface ClipPromptsProps {
  show: ShowMeta | null;
  scene: SceneEntity;
  set: SetEntity | undefined;
  characters: CharacterEntity[];
  shots: ShotEntity[];
}

const friendly = (message: string) => (/not configured/i.test(message) ? "AI writing is not set up. Add PROJEC_GOOGLE_API_KEY to the server's .env and restart it." : message);

export function ClipPrompts({ show, scene, set, characters, shots }: ClipPromptsProps) {
  const saved = scene.clipPrompts;
  const [storyboard, setStoryboard] = useState(saved?.storyboard ?? "");
  const [video, setVideo] = useState(saved?.video ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [abort, setAbort] = useState<AbortController | null>(null);
  const seconds = totalDuration(shots);
  const dirty = storyboard !== (saved?.storyboard ?? "") || video !== (saved?.video ?? "");

  const buildStoryboard = () => {
    try {
      setStoryboard(storyboardPromptFor(shots, characters, set));
      setNotice({ tone: "ok", text: `Built a ${shots.length}-panel storyboard prompt from the shot list.` });
    } catch (cause) {
      setNotice({ tone: "error", text: (cause as Error).message });
    }
  };

  const composeVideo = async () => {
    const controller = new AbortController();
    setAbort(controller);
    setBusy(true);
    setNotice(null);
    try {
      const result = await composeClipVideoPrompt(show, shots, characters, set, geminiRun(controller.signal));
      setVideo(result.prompt);
      setNotice(result.fallback
        ? { tone: "error", text: `The model could not write the document, so this is Mago's plain skeleton. ${result.warnings.join(" ")}`.trim() }
        : { tone: "ok", text: result.warnings.length ? `Composed. ${result.warnings.join(" ")}` : "Composed the video prompt." });
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setNotice({ tone: "error", text: friendly((cause as Error).message) });
    } finally {
      setBusy(false);
      setAbort(null);
    }
  };

  const save = async () => {
    await updateScene(scene.id, { clipPrompts: { storyboard, video, updatedAt: Date.now() } });
    setNotice({ tone: "ok", text: "Saved to the scene. It goes into the Mago package." });
  };

  return (
    <section className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2" aria-label="Scene clip prompts">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1 text-[12px] font-semibold text-neutral-200"><Clapperboard size={12} /> Scene prompts</h3>
        <Chip tone="dim">Mago engine</Chip>
        {seconds > MAX_CLIP_SECONDS && <Chip tone="danger">{Math.round(seconds)}s is over {MAX_CLIP_SECONDS}s</Chip>}
      </div>
      <p className="text-[11px] leading-snug text-neutral-500">Mago renders a scene as one clip of up to {MAX_CLIP_SECONDS} seconds. These two prompts cover the whole shot list: a storyboard sheet with one panel per shot, and the video document.</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={buildStoryboard} disabled={shots.length === 0 || busy} aria-label="Build storyboard prompt"><Clapperboard size={12} /> Build storyboard prompt</Button>
        <Button size="sm" onClick={() => void composeVideo()} disabled={shots.length === 0 || busy} aria-label="Compose video prompt with AI"><Sparkles size={12} /> {busy ? "Composing…" : "Compose video prompt"}</Button>
        {busy && abort && <Button size="sm" variant="subtle" onClick={() => abort.abort()} aria-label="Cancel composing"><X size={12} /> Cancel</Button>}
      </div>
      {shots.length === 0 && <p className="text-[11px] text-neutral-600">Add shots above first. Both prompts are built from them.</p>}
      {notice && <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "text-[11.5px] text-red-300" : "text-[11.5px] text-emerald-300/90"}>{notice.text}</p>}
      <Field label="Storyboard sheet prompt" hint="Paste into the storyboard step in Mago Studio.">
        <TextArea rows={5} value={storyboard} onChange={(e) => setStoryboard(e.target.value)} aria-label="Storyboard sheet prompt" />
      </Field>
      <Field label="Composed video prompt" hint="The six-section document Mago's video model reads.">
        <TextArea rows={8} value={video} onChange={(e) => setVideo(e.target.value)} aria-label="Composed video prompt" />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        <CopyButton text={storyboard} label="Copy storyboard" size="xs" variant="ghost" />
        <CopyButton text={video} label="Copy video prompt" size="xs" variant="ghost" />
        <Button size="xs" variant="primary" className="ml-auto" disabled={!dirty || (!storyboard.trim() && !video.trim())} onClick={() => void save()} aria-label="Save scene prompts"><Save size={11} /> Save to scene</Button>
      </div>
    </section>
  );
}
