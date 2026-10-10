// HostedUrlPanel.tsx — render with files you already host (no storage bucket needed).
// Supply readable HTTPS input URLs and a writable output URL plus a read URL for the same file.
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { jsonRequest, texelRequest, type TexelTrailer } from "../lib/texelExport";
import { Button, Field, TextInput as Input } from "./ui";
import { useConfirm } from "./ConfirmDialog";

interface Row { uid: string; url: string; start: string; length: string }
const newRow = (): Row => ({ uid: crypto.randomUUID(), url: "", start: "0", length: "" });
const https = (url: string) => { try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password; } catch { return false; } };
const inRange = (value: string, min: number, max: number) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;

export function HostedUrlPanel({ projectId, disabled, onProject, onError }: {
  projectId: string; disabled: boolean; onProject: (project: TexelTrailer) => void; onError: (message: string | null) => void;
}) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [audio, setAudio] = useState("");
  const [audioStart, setAudioStart] = useState("0");
  const [upload, setUpload] = useState("");
  const [read, setRead] = useState("");
  const [normalize, setNormalize] = useState(true);
  const [keepAudio, setKeepAudio] = useState(true);
  const edit = (uid: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  const ready = rows.every((row) => https(row.url) && inRange(row.start, 0, 7200) && inRange(row.length, 0.1, 300)) && https(upload) && https(read) && (!audio || (https(audio) && inRange(audioStart, 0, 7200)));
  const submit = async () => {
    if (!await confirm({ message: "Submit a Texel render using these URLs? This uses Texel credits. Keep the links valid until the render finishes.", confirmLabel: "Render with Texel" })) return;
    onError(null);
    try {
      onProject(await texelRequest<TexelTrailer>(`/trailers/${projectId}/url-render`, jsonRequest({
        clips: rows.map((row) => ({ url: row.url, start_seconds: Number(row.start), duration_seconds: Number(row.length) })),
        output_upload_url: upload, output_read_url: read, audio_url: audio || null, audio_start_seconds: audio ? Number(audioStart) : 0,
        preserve_audio: keepAudio && !audio, normalize_audio: normalize, enhance_voice: false, fps: 30,
      })));
    } catch (cause) { onError(cause instanceof Error ? cause.message : "Request failed."); }
  };
  return <details className="space-y-2 rounded-lg border border-neutral-800 p-3">
    <summary className="cursor-pointer text-[13px] font-medium text-neutral-200">I already host my files (paste signed URLs)</summary>
    <p className="mt-2 text-[11px] text-neutral-500">For when you have no storage bucket. Texel reads each input URL and writes the result to the output upload URL; the app then downloads it from the output read URL. Every length must be entered because the app can’t probe remote files.</p>
    <fieldset disabled={disabled} className="space-y-2">
      {rows.map((row, index) => <div key={row.uid} className="space-y-2 rounded border border-neutral-800 p-2">
        <Field label={`${index + 1}. Clip URL`}><Input type="url" aria-label={`Clip URL ${index + 1}`} placeholder="https://…" value={row.url} onChange={(event) => edit(row.uid, { url: event.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Start in source (seconds)"><Input type="number" min="0" step="0.1" aria-label={`URL clip ${index + 1} start`} value={row.start} onChange={(event) => edit(row.uid, { start: event.target.value })} /></Field>
          <Field label="Length (seconds)"><Input type="number" min="0.1" max="300" step="0.1" aria-label={`URL clip ${index + 1} length`} value={row.length} onChange={(event) => edit(row.uid, { length: event.target.value })} /></Field>
        </div>
        {rows.length > 1 && <Button aria-label={`Remove URL clip ${index + 1}`} onClick={() => setRows((current) => current.filter((item) => item.uid !== row.uid))}><Trash2 size={13} /> Remove</Button>}
      </div>)}
      <Button disabled={rows.length >= 12} onClick={() => setRows((current) => [...current, newRow()])}><Plus size={13} /> Add clip</Button>
      <Field label="Theme song URL (optional, replaces clip audio)"><Input type="url" aria-label="Song URL" placeholder="https://…" value={audio} onChange={(event) => setAudio(event.target.value)} /></Field>
      {!!audio && <Field label="Start the song at (seconds)"><Input type="number" min="0" step="0.1" aria-label="Song start" value={audioStart} onChange={(event) => setAudioStart(event.target.value)} /></Field>}
      <Field label="Output upload URL (signed PUT)"><Input type="url" aria-label="Output upload URL" placeholder="https://…" value={upload} onChange={(event) => setUpload(event.target.value)} /></Field>
      <Field label="Output read URL (for the same file)"><Input type="url" aria-label="Output read URL" placeholder="https://…" value={read} onChange={(event) => setRead(event.target.value)} /></Field>
      <label className="flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" className="accent-amber-500" checked={keepAudio && !audio} disabled={!!audio} onChange={(event) => setKeepAudio(event.target.checked)} />Keep original clip audio (every clip must have audio)</label>
      <label className="flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" className="accent-amber-500" checked={normalize} onChange={(event) => setNormalize(event.target.checked)} />Normalize loudness (−16 LUFS)</label>
      <Button variant="primary" className="w-full" disabled={!ready} onClick={() => void submit()}>Render these URLs with Texel</Button>
    </fieldset>
  </details>;
}
