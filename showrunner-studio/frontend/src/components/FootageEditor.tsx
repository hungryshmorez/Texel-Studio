// FootageEditor.tsx — upload existing footage and a theme song, trim/reorder
// clips, normalize audio and render with Texel's production editing API.
// Media goes to backend-managed storage; the browser never sees storage URLs or API keys.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Download, Film, Music, Trash2, Upload } from "lucide-react";
import { jsonRequest, texelRequest, type TexelAsset, type TexelCapabilities, type TexelTrailer } from "../lib/texelExport";
import { Button, Chip, Field, Spinner, TextInput as Input } from "./ui";
import { useConfirm } from "./ConfirmDialog";

const PROJECT_KEY = "texel-studio:footage-project";
const SHOW_ID = "media-projects";

interface TimelineClip { uid: string; assetId: string; start: string; length: string }
interface Timeline { clips: TimelineClip[]; soundId: string; soundStart: string; keepAudio: boolean; normalize: boolean; enhance: boolean }
const emptyTimeline: Timeline = { clips: [], soundId: "", soundStart: "0", keepAudio: true, normalize: true, enhance: false };

const seconds = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const valid = (value: string, min: number, max: number) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;

function loadTimeline(id: string): Timeline {
  try { return { ...emptyTimeline, ...JSON.parse(localStorage.getItem(`${PROJECT_KEY}:${id}`) ?? "{}") }; } catch { return emptyTimeline; }
}

function uploadFile(projectId: string, file: File, onProgress: (fraction: number) => void): Promise<TexelTrailer> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/texel/trailers/${projectId}/assets`);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onerror = () => reject(new Error("Upload interrupted. Check your connection and try again."));
    request.onload = () => {
      let body: { detail?: unknown } | null = null;
      try { body = JSON.parse(request.responseText); } catch { /* non-JSON error body */ }
      if (request.status >= 200 && request.status < 300) resolve(body as unknown as TexelTrailer);
      else reject(new Error(typeof body?.detail === "string" ? body.detail : `Upload failed (${request.status}).`));
    };
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}

export function FootageEditor({ onClose }: { onClose: () => void }) {
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [caps, setCaps] = useState<TexelCapabilities | null>(null);
  const [projects, setProjects] = useState<TexelTrailer[]>([]);
  const [project, setProject] = useState<TexelTrailer | null>(null);
  const [timeline, setTimeline] = useState<Timeline>(emptyTimeline);
  const [title, setTitle] = useState("My music video");
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [working, setWorking] = useState(false);

  const select = useCallback((next: TexelTrailer | null) => {
    setProject(next);
    if (next) { localStorage.setItem(PROJECT_KEY, next.id); setTimeline(loadTimeline(next.id)); } else setTimeline(emptyTimeline);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setCaps(await texelRequest<TexelCapabilities>("/capabilities"));
        const list = await texelRequest<TexelTrailer[]>(`/trailers?show_id=${SHOW_ID}`);
        setProjects(list);
        select(list.find((item) => item.id === localStorage.getItem(PROJECT_KEY)) ?? list[0] ?? null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reach the studio backend."); }
    })();
  }, [select]);

  useEffect(() => { if (project) localStorage.setItem(`${PROJECT_KEY}:${project.id}`, JSON.stringify(timeline)); }, [project, timeline]);

  const projectId = project?.id;
  const running = project?.cloud_render?.status === "running";
  useEffect(() => {
    if (!projectId || !running) return;
    const timer = setInterval(() => {
      texelRequest<TexelTrailer>(`/trailers/${projectId}`).then(setProject).catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [projectId, running]);

  const run = async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    setError(null); setWorking(true);
    try { return await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); } finally { setWorking(false); }
  };

  const create = () => run(async () => {
    const created = await texelRequest<TexelTrailer>("/edits", jsonRequest({ request_id: crypto.randomUUID(), title: title.trim() || "Untitled edit" }));
    setProjects((current) => [created, ...current]);
    select(created);
  });

  const addFiles = async (files: FileList | null) => {
    if (!project || !files) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploads((current) => ({ ...current, [key]: 0 }));
      setError(null);
      try {
        const updated = await uploadFile(project.id, file, (fraction) => setUploads((current) => ({ ...current, [key]: fraction })));
        setProject(updated);
      } catch (cause) { setError(`${file.name}: ${cause instanceof Error ? cause.message : "Upload failed."}`); }
      setUploads(({ [key]: _done, ...rest }) => rest);
    }
  };

  const assets = project?.assets ?? [];
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const sounds = assets.filter((asset) => asset.has_audio);
  const update = (patch: Partial<Timeline>) => setTimeline((current) => ({ ...current, ...patch }));
  const editClip = (uid: string, patch: Partial<TimelineClip>) => update({ clips: timeline.clips.map((clip) => (clip.uid === uid ? { ...clip, ...patch } : clip)) });
  const move = (index: number, direction: number) => {
    const next = [...timeline.clips];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    update({ clips: next });
  };
  const addClip = (asset: TexelAsset) => update({ clips: [...timeline.clips, { uid: crypto.randomUUID(), assetId: asset.id, start: "0", length: String(Math.min(asset.duration, 300).toFixed(1)) }] });
  const removeAsset = async (asset: TexelAsset) => {
    if (!project || !await confirm({ message: `Delete “${asset.name}” from this project?`, confirmLabel: "Delete" })) return;
    await run(async () => {
      setProject(await texelRequest<TexelTrailer>(`/trailers/${project.id}/assets/${asset.id}`, { method: "DELETE" }));
      update({ clips: timeline.clips.filter((clip) => clip.assetId !== asset.id), soundId: timeline.soundId === asset.id ? "" : timeline.soundId });
    });
  };

  const total = timeline.clips.reduce((sum, clip) => sum + (valid(clip.length, 0.1, 300) ? Number(clip.length) : 0), 0);
  const maxClips = caps?.max_edit_clips ?? 12;
  const clipProblem = timeline.clips.map((clip) => {
    const asset = byId.get(clip.assetId);
    if (!asset) return "Source file was removed.";
    if (!valid(clip.start, 0, 7200) || !valid(clip.length, 0.1, 300)) return "Enter a start of 0+ seconds and a length of 0.1–300 seconds.";
    if (Number(clip.start) + 0.1 >= asset.duration) return `Starts after the end of this ${seconds(asset.duration)} source.`;
    if (timeline.keepAudio && !timeline.soundId && !asset.has_audio) return "No audio track. Turn off original audio or add a theme song.";
    return null;
  });
  const soundOk = !timeline.soundId || (byId.has(timeline.soundId) && valid(timeline.soundStart, 0, 7200));
  const ready = !!caps?.cloud_configured && !!caps.storage_configured && timeline.clips.length > 0 && timeline.clips.length <= maxClips && clipProblem.every((p) => !p) && soundOk;
  const cloud = project?.cloud_render;

  const render = async () => {
    if (!project) return;
    if (!await confirm({ message: `Submit a Texel render of ${seconds(total)}? This uses Texel credits. If a previous job was interrupted, resume it instead of submitting again.`, confirmLabel: "Render with Texel" })) return;
    await run(async () => setProject(await texelRequest<TexelTrailer>(`/trailers/${project.id}/edit-render`, jsonRequest({
      clips: timeline.clips.map((clip) => ({ asset_id: clip.assetId, start_seconds: Number(clip.start), duration_seconds: Number(clip.length) })),
      audio_asset_id: timeline.soundId || null, audio_start_seconds: timeline.soundId ? Number(timeline.soundStart) : 0,
      preserve_audio: timeline.keepAudio && !timeline.soundId, normalize_audio: timeline.normalize, enhance_voice: !!timeline.soundId && timeline.enhance, fps: 30,
    }))));
  };

  const resume = () => project && run(async () => setProject(await texelRequest<TexelTrailer>(`/trailers/${project.id}/cloud-render/resume`, jsonRequest({}))));

  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button onClick={onClose} aria-label="Back to the writers' room"><ArrowLeft size={13} /> Writers' room</Button>
        <h1 className="text-base font-semibold text-neutral-100">Edit footage</h1>
        {caps && <Chip tone={caps.cloud_configured && caps.storage_configured ? "green" : "danger"}>{caps.cloud_configured && caps.storage_configured ? "Texel + storage ready" : "Backend setup needed"}</Chip>}
      </div>
      <p className="text-[12px] leading-relaxed text-neutral-500">Upload existing clips and a theme song, trim and reorder them, and Texel’s GPU editor renders a normalized 720p cut. Files are held in your storage bucket by the backend; no links to paste.</p>
      {caps && !caps.storage_configured && <p role="alert" className="rounded border border-amber-500/30 p-2 text-[12px] text-amber-300">Set TEXEL_S3_ENDPOINT, TEXEL_S3_BUCKET, TEXEL_S3_ACCESS_KEY_ID and TEXEL_S3_SECRET_ACCESS_KEY on the backend to enable uploads.</p>}
      {caps && !caps.cloud_configured && <p role="alert" className="rounded border border-amber-500/30 p-2 text-[12px] text-amber-300">Set TEXEL_EDITING_API_KEY on the backend to enable Texel renders.</p>}
      {error && <p role="alert" className="rounded border border-red-500/30 p-2 text-[12px] text-red-300">{error}</p>}

      <section className="space-y-2 rounded-lg border border-neutral-800 p-3" aria-label="Project">
        <div className="flex flex-wrap items-end gap-2">
          {projects.length > 0 && <Field label="Project" className="min-w-48 flex-1">
            <select aria-label="Footage project" className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-[13px]" value={project?.id ?? ""} onChange={(event) => select(projects.find((item) => item.id === event.target.value) ?? null)}>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.show_title}</option>)}
            </select>
          </Field>}
          <Field label="New project" className="min-w-48 flex-1"><Input aria-label="New project name" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Button variant="primary" disabled={working} onClick={() => void create()}>Create project</Button>
        </div>
      </section>

      {project && <>
        <section className="space-y-2 rounded-lg border border-neutral-800 p-3" aria-label="Media library">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-medium text-neutral-200">Media library</h2>
            <Button variant="primary" disabled={!caps?.storage_configured || running} onClick={() => input.current?.click()}><Upload size={13} /> Upload video or audio</Button></div>
          <input ref={input} type="file" multiple accept="video/*,audio/*,.mp4,.mov,.mkv,.webm,.mp3,.wav,.m4a,.aac" className="hidden" aria-label="Upload media files" onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} />
          {Object.entries(uploads).map(([key, fraction]) => <div key={key} role="status" className="flex items-center gap-2 text-[11px] text-amber-300"><Spinner /> Uploading {key.split("-")[0]} · {Math.round(fraction * 100)}%</div>)}
          {assets.length === 0 && Object.keys(uploads).length === 0 && <p className="text-[12px] text-neutral-600">No media yet. Upload your clips and your theme song (an MP4 with the song works).</p>}
          <ul className="space-y-1">{assets.map((asset) => <li key={asset.id} className="flex items-center gap-2 rounded border border-neutral-800 px-2 py-1.5 text-[12px]">
            {asset.kind === "video" ? <Film size={13} className="text-amber-400" /> : <Music size={13} className="text-amber-400" />}
            <span className="min-w-0 flex-1 truncate">{asset.name}</span>
            <span className="shrink-0 text-neutral-500">{seconds(asset.duration)} · {megabytes(asset.size)}{asset.kind === "video" ? ` · ${asset.width}×${asset.height}` : ""}{asset.kind === "video" && !asset.has_audio ? " · silent" : ""}</span>
            {asset.kind === "video" && <Button disabled={running || timeline.clips.length >= maxClips} onClick={() => addClip(asset)}>Add to timeline</Button>}
            <Button aria-label={`Delete ${asset.name}`} disabled={running} onClick={() => void removeAsset(asset)}><Trash2 size={13} /></Button>
          </li>)}</ul>
        </section>

        <section className="space-y-2 rounded-lg border border-neutral-800 p-3" aria-label="Timeline">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-medium text-neutral-200">Timeline</h2><span className="text-[11px] text-neutral-500">{timeline.clips.length}/{maxClips} clips · {seconds(total)} total</span></div>
          {timeline.clips.length === 0 && <p className="text-[12px] text-neutral-600">Add clips from the media library. They play top to bottom.</p>}
          <fieldset disabled={running} className="space-y-2">{timeline.clips.map((clip, index) => {
            const asset = byId.get(clip.assetId);
            return <div key={clip.uid} className="space-y-2 rounded border border-neutral-800 p-2">
              <div className="flex items-center gap-2 text-[12px]"><span className="font-mono text-amber-400">{index + 1}</span><span className="min-w-0 flex-1 truncate">{asset?.name ?? "Removed file"}</span>
                <Button aria-label={`Move clip ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></Button>
                <Button aria-label={`Move clip ${index + 1} down`} disabled={index === timeline.clips.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></Button>
                <Button aria-label={`Remove clip ${index + 1}`} onClick={() => update({ clips: timeline.clips.filter((item) => item.uid !== clip.uid) })}><Trash2 size={13} /></Button></div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start in source (seconds)"><Input type="number" min="0" step="0.1" aria-label={`Start of clip ${index + 1}`} value={clip.start} onChange={(event) => editClip(clip.uid, { start: event.target.value })} /></Field>
                <Field label="Length (seconds)"><Input type="number" min="0.1" max="300" step="0.1" aria-label={`Length of clip ${index + 1}`} value={clip.length} onChange={(event) => editClip(clip.uid, { length: event.target.value })} /></Field>
              </div>
              {clipProblem[index] && <p role="alert" className="text-[11px] text-amber-300">{clipProblem[index]}</p>}
            </div>;
          })}</fieldset>
        </section>

        <section className="space-y-2 rounded-lg border border-neutral-800 p-3" aria-label="Audio">
          <h2 className="text-[13px] font-medium text-neutral-200">Audio</h2>
          <fieldset disabled={running} className="space-y-2">
            <Field label="Theme song / soundtrack (replaces clip audio)">
              <select aria-label="Soundtrack" className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-[13px]" value={timeline.soundId} onChange={(event) => update({ soundId: event.target.value })}>
                <option value="">None — keep each clip’s own audio</option>
                {sounds.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({seconds(asset.duration)})</option>)}
              </select>
            </Field>
            {timeline.soundId && <Field label="Start the song at (seconds)" hint="Skip a silent intro, e.g. 8.9"><Input type="number" min="0" step="0.1" aria-label="Soundtrack start" value={timeline.soundStart} onChange={(event) => update({ soundStart: event.target.value })} /></Field>}
            {timeline.soundId && !valid(timeline.soundStart, 0, 7200) && <p role="alert" className="text-[11px] text-amber-300">Enter a start between 0 and 7200 seconds.</p>}
            <label className="flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" className="accent-amber-500" checked={timeline.keepAudio && !timeline.soundId} disabled={!!timeline.soundId} onChange={(event) => update({ keepAudio: event.target.checked })} />Keep original clip audio</label>
            <label className="flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" className="accent-amber-500" checked={timeline.normalize} onChange={(event) => update({ normalize: event.target.checked })} />Normalize loudness (−16 LUFS)</label>
            <label className="flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" className="accent-amber-500" checked={timeline.enhance} disabled={!timeline.soundId} onChange={(event) => update({ enhance: event.target.checked })} />Enhance with Texel Studio Voice (speech only, not music)</label>
            <p className="text-[11px] text-neutral-500">A soundtrack replaces all clip audio and ends in silence if shorter than the cut. There is no multi-track mix yet.</p>
          </fieldset>
        </section>

        <Button variant="primary" size="md" className="w-full" disabled={working || running || !ready} onClick={() => void render()}>{running ? "Rendering…" : "Render with Texel"}</Button>

        {cloud && <div className="space-y-2 text-[12px]">
          <p role="status" className="flex items-center gap-2 text-amber-300">{running && <Spinner />}Texel render: {cloud.status} · {cloud.progress}%</p>
          {cloud.error && <p role="alert" className="text-amber-300">{cloud.error}</p>}
          {cloud.status === "interrupted" && <Button disabled={working} onClick={() => void resume()}>Resume render · no new submission</Button>}
        </div>}

        {project.video_url && cloud?.status === "complete" && <section className="space-y-2" aria-label="Result">
          <video controls className="w-full rounded-lg border border-neutral-800 bg-black" src={project.video_url} aria-label="Rendered cut" />
          <a className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-[12px] text-neutral-200 hover:bg-neutral-900" href={`${project.video_url}?download=true`} download><Download size={13} /> Download MP4</a>
        </section>}
      </>}
    </div>
  </div>;
}
