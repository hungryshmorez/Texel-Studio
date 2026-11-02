// ImagePicker.tsx — attach reference images to a character or set. Images are downscaled in the
// browser and stored as data URLs inside the project, so exports and backups stay one JSON file.
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ImagePlus, X } from "lucide-react";
import { db } from "../lib/db";
import { addImage, deleteImage } from "../lib/writingActions";
import { prepareImage } from "../lib/imageUtils";
import type { ImageAsset } from "../types";
import { Button } from "./ui";

interface ImagePickerProps {
  showId: string;
  ids: string[];
  onChange: (ids: string[]) => void;
  label: string;
}

export function ImagePicker({ showId, ids, onChange, label }: ImagePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const images = useLiveQuery(() => db.images.bulkGet(ids), [ids.join(",")], [] as (ImageAsset | undefined)[]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image.`);
        const prepared = await prepareImage(file);
        added.push(await addImage(showId, file.name, prepared.mime, prepared.dataUrl));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add that image.");
    } finally {
      if (added.length) onChange([...ids, ...added]);
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    onChange(ids.filter((x) => x !== id));
    await deleteImage(id);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {(images ?? []).map((image, index) =>
          image ? (
            <div key={image.id} className="group relative h-16 w-16 overflow-hidden rounded-md border border-neutral-800">
              <img src={image.dataUrl} alt={`${label} reference ${index + 1}`} className="h-full w-full object-cover" />
              <button type="button" onClick={() => void remove(image.id)} aria-label={`Remove reference image ${index + 1}`}
                className="absolute right-0.5 top-0.5 cursor-pointer rounded bg-black/70 p-0.5 text-neutral-200 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100">
                <X size={11} />
              </button>
            </div>
          ) : null
        )}
        <Button size="sm" onClick={() => input.current?.click()} disabled={busy} aria-label={`Add reference image for ${label}`}>
          <ImagePlus size={13} /> {busy ? "Adding…" : "Add image"}
        </Button>
        <input ref={input} type="file" accept="image/*" multiple className="hidden" aria-label={`Upload reference images for ${label}`}
          onChange={(event) => { void add(event.target.files); event.target.value = ""; }} />
      </div>
      {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
