// TopBar.tsx — App header: show selector, new show, project JSON export/import.
import { useRef, useState, type ChangeEvent } from "react";
import { Clapperboard, Download, Film, Plus, Upload } from "lucide-react";
import type { ShowMeta } from "../types";
import { exportProjectSnapshot, importProjectSnapshot, type ProjectSnapshot } from "../lib/db";
import { Button, Chip, Modal, Select } from "./ui";

interface TopBarProps {
  shows: ShowMeta[];
  show: ShowMeta | null;
  onSelectShow: (id: string) => void;
  onNewShow: () => void;
  onOpenShowBible: () => void;
  onEditFootage: () => void;
}

function downloadSnapshot(snapshot: ProjectSnapshot) {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `texel-studio-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function TopBar({ shows, show, onSelectShow, onNewShow, onOpenShowBible, onEditFootage }: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<ProjectSnapshot | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = async () => {
    const snapshot = await exportProjectSnapshot();
    downloadSnapshot(snapshot);
  };

  const handleFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError(null);
    try {
      const parsed = JSON.parse(await file.text()) as ProjectSnapshot;
      if (!parsed || !Array.isArray(parsed.shows)) {
        setImportError("That file doesn't look like a Texel Studio project export.");
        return;
      }
      setPendingImport(parsed);
    } catch {
      setImportError("Could not parse the selected file as JSON.");
    }
  };

  const runImport = async (mode: "merge" | "replace") => {
    if (!pendingImport) return;
    try {
      await importProjectSnapshot(pendingImport, mode);
      setPendingImport(null);
    } catch (err) {
      setImportError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      setPendingImport(null);
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-900/60 px-3 sm:px-4">
      <div className="flex shrink-0 items-center gap-2">
        <Clapperboard size={18} className="text-amber-400" aria-hidden />
        <span className="hidden font-mono text-[12px] font-semibold tracking-[0.2em] text-neutral-100 sm:inline">
          TEXEL<span className="text-amber-400"> STUDIO</span>
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <Select
          aria-label="Current show"
          value={show?.id ?? ""}
          onChange={(e) => onSelectShow(e.target.value)}
          className="max-w-52 truncate font-medium sm:max-w-64"
        >
          {shows.length === 0 && <option value="">No show yet</option>}
          {shows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </Select>
        {show && (
          <button
            type="button"
            onClick={onOpenShowBible}
            title="Open Show Bible"
            className="min-w-0 cursor-pointer"
          >
            <Chip tone={show.genre ? "amber" : "dim"} className="max-w-36 truncate">
              {show.genre || "set genre"}
            </Chip>
          </button>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <a
          href="/legacy/public/"
          target="_blank"
          rel="noreferrer"
          title="Open the old Script Studio prototype (archived, no longer maintained)"
          className="hidden shrink-0 rounded-md px-2 py-1 text-[11px] text-neutral-600 transition-colors hover:bg-neutral-900 hover:text-neutral-400 sm:inline-block"
        >
          Old version
        </a>
        <Button onClick={onEditFootage} aria-label="Edit footage">
          <Film size={13} />
          <span className="hidden sm:inline">Edit footage</span>
        </Button>
        <Button variant="primary" onClick={onNewShow} aria-label="New show">
          <Plus size={13} strokeWidth={2.5} />
          <span className="hidden sm:inline">New Show</span>
        </Button>
        <Button onClick={handleExport} disabled={shows.length === 0} aria-label="Export project JSON">
          <Download size={13} />
          <span className="hidden md:inline">Export JSON</span>
        </Button>
        <Button onClick={() => fileInputRef.current?.click()} aria-label="Import project JSON">
          <Upload size={13} />
          <span className="hidden md:inline">Import JSON</span>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFilePicked}
          aria-hidden
        />
      </div>

      <Modal
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        title="Import project"
        subtitle="Choose how to bring this snapshot into your local library."
      >
        <div className="space-y-3 p-4">
          <p className="text-[13px] text-neutral-400">
            <span className="font-mono text-neutral-200">{pendingImport?.shows.length ?? 0}</span> shows,{" "}
            <span className="font-mono text-neutral-200">{pendingImport?.sets.length ?? 0}</span> sets,{" "}
            <span className="font-mono text-neutral-200">{pendingImport?.characters.length ?? 0}</span> characters,{" "}
            <span className="font-mono text-neutral-200">{pendingImport?.episodes.length ?? 0}</span> episodes,{" "}
            <span className="font-mono text-neutral-200">{pendingImport?.scenes.length ?? 0}</span> scenes.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" size="md" className="flex-1" onClick={() => runImport("merge")}>
              Merge into library
            </Button>
            <Button variant="danger" size="md" className="flex-1" onClick={() => runImport("replace")}>
              Replace everything
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-neutral-600">
            Merge keeps existing data and overwrites entries with the same ids. Replace wipes the local
            database first — export a backup if unsure.
          </p>
        </div>
      </Modal>

      <Modal open={importError !== null} onClose={() => setImportError(null)} title="Import problem">
        <p className="p-4 text-[13px] text-red-300">{importError}</p>
      </Modal>
    </header>
  );
}
