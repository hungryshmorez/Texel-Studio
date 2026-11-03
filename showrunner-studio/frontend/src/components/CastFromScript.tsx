// CastFromScript.tsx — read the written scenes with Mago's casting engine and propose the characters
// and locations they need. Nothing is saved until the writer picks what to add.
import { useState } from "react";
import { Sparkles, UserPlus, X } from "lucide-react";
import type { CharacterEntity, SceneEntity, SetEntity, ShowMeta } from "../types";
import { createCharacter, createSet, updateShow } from "../lib/actions";
import { castFromScript, geminiRun, scriptText, type CastProposal } from "../lib/magoWriting";
import { Button, Chip } from "./ui";

interface CastFromScriptProps {
  show: ShowMeta;
  scenes: SceneEntity[];
  sets: SetEntity[];
  characters: CharacterEntity[];
}

const friendly = (message: string) => (/not configured/i.test(message) ? "AI writing is not set up. Add PROJEC_GOOGLE_API_KEY to the server's .env and restart it." : message);

export function CastFromScript({ show, scenes, sets, characters }: CastFromScriptProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CastProposal | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [abort, setAbort] = useState<AbortController | null>(null);

  const script = scriptText([...scenes].sort((a, b) => a.order - b.order), sets, characters);

  const read = async () => {
    const controller = new AbortController();
    setAbort(controller);
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await castFromScript(script, geminiRun(controller.signal), characters, sets);
      setProposal(result);
      setPicked(new Set([...result.characters.filter((c) => !c.exists).map((c) => `c:${c.name}`), ...result.sets.filter((s) => !s.exists).map((s) => `s:${s.name}`)]));
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(friendly((cause as Error).message));
    } finally {
      setBusy(false);
      setAbort(null);
    }
  };

  const toggle = (key: string) => setPicked((previous) => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const add = async () => {
    if (!proposal) return;
    let characterCount = 0;
    let setCount = 0;
    for (const c of proposal.characters) {
      if (c.exists || !picked.has(`c:${c.name}`)) continue;
      await createCharacter(show.id, { name: c.name, role: "Supporting", age: "", gender: "", visualDescription: c.visualDescription, voiceDescription: c.voiceDescription, distinctiveFeatures: c.distinctiveFeatures });
      characterCount += 1;
    }
    for (const s of proposal.sets) {
      if (s.exists || !picked.has(`s:${s.name}`)) continue;
      await createSet(show.id, { name: s.name, timeOfDay: "", description: s.description });
      setCount += 1;
    }
    if (!show.visualStyle?.trim() && proposal.visualStyle.trim() && picked.has("style")) await updateShow(show.id, { visualStyle: proposal.visualStyle.trim() });
    setDone(`Added ${characterCount} ${characterCount === 1 ? "character" : "characters"} and ${setCount} ${setCount === 1 ? "set" : "sets"}.`);
    setProposal(null);
  };

  const offerStyle = !!proposal && !show.visualStyle?.trim() && !!proposal.visualStyle.trim();

  return (
    <section className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5" aria-label="Cast from script">
      <div className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold text-neutral-200">Cast from script</h3>
        <Chip tone="dim">Mago engine</Chip>
      </div>
      <p className="text-[11px] leading-snug text-neutral-500">Reads the written scenes the way Mago Studio does and lists the characters and locations they need. You choose what to add; existing ones are never changed.</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => void read()} disabled={busy || !script.trim()} aria-label="Read the script and propose a cast"><Sparkles size={12} /> {busy ? "Reading…" : "Read the script"}</Button>
        {busy && abort && <Button size="sm" variant="subtle" onClick={() => abort.abort()} aria-label="Cancel reading"><X size={12} /> Cancel</Button>}
      </div>
      {!script.trim() && <p className="text-[11px] text-neutral-600">Write some action or dialogue first.</p>}
      {error && <p role="alert" className="text-[11.5px] text-red-300">{error}</p>}
      {done && <p role="status" className="text-[11.5px] text-emerald-300/90">{done}</p>}
      {proposal && (
        <div className="space-y-2" aria-label="Proposed cast">
          {proposal.characters.length === 0 && proposal.sets.length === 0 && <p className="text-[11.5px] text-neutral-500">The model found no characters or locations.</p>}
          {proposal.characters.length > 0 && <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Characters</h4>}
          <ul className="space-y-1.5">
            {proposal.characters.map((c) => (
              <li key={c.name} className="rounded-md border border-neutral-800 p-2 text-[11.5px]">
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={c.exists ? false : picked.has(`c:${c.name}`)} disabled={c.exists} onChange={() => toggle(`c:${c.name}`)} aria-label={`Add ${c.name}`} />
                  <span className="min-w-0">
                    <span className="font-semibold text-neutral-200">{c.name}</span> {c.exists && <Chip tone="dim">already in the show</Chip>}
                    <span className="block text-neutral-400">{[c.visualDescription, c.distinctiveFeatures && `Distinctive: ${c.distinctiveFeatures}.`, c.voiceDescription && `Voice: ${c.voiceDescription}`].filter(Boolean).join(" ")}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {proposal.sets.length > 0 && <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Sets</h4>}
          <ul className="space-y-1.5">
            {proposal.sets.map((s) => (
              <li key={s.name} className="rounded-md border border-neutral-800 p-2 text-[11.5px]">
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={s.exists ? false : picked.has(`s:${s.name}`)} disabled={s.exists} onChange={() => toggle(`s:${s.name}`)} aria-label={`Add ${s.name}`} />
                  <span className="min-w-0">
                    <span className="font-semibold text-neutral-200">{s.name}</span> {s.exists && <Chip tone="dim">already in the show</Chip>}
                    <span className="block text-neutral-400">{s.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {offerStyle && (
            <label className="flex cursor-pointer items-start gap-2 text-[11.5px] text-neutral-300">
              <input type="checkbox" className="mt-0.5" checked={picked.has("style")} onChange={() => toggle("style")} aria-label="Use the proposed visual style" />
              <span>Use as the show's visual style: <span className="text-neutral-400">{proposal.visualStyle}</span></span>
            </label>
          )}
          <Button variant="primary" size="sm" onClick={() => void add()} disabled={picked.size === 0} aria-label="Add the selected to the show"><UserPlus size={12} /> Add selected ({[...picked].filter((k) => k !== "style").length})</Button>
        </div>
      )}
    </section>
  );
}
