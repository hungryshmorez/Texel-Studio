// CatalogModals.tsx — Modal dialogs for the show-level catalog: Sets,
// Characters, and the Show Bible (ShowMeta) editor.
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Hash, AtSign, Plus, Trash } from "lucide-react";
import type { CharacterEntity, CharacterRole, SetEntity, ShowMeta } from "../types";
import { ImagePicker } from "./ImagePicker";
import { createCharacter, createSet, deleteCharacter, deleteSet, updateCharacter, updateSet, updateShow } from "../lib/actions";
import { Button, Chip, Field, Label, Modal, Select, TextArea, TextInput } from "./ui";
import { useConfirm } from "./ConfirmDialog";

// --- Shared bits --------------------------------------------------------------

function CatalogLayout({ list, form }: { list: ReactNode; form: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row">
      <div className="shrink-0 border-b border-neutral-800 sm:w-56 sm:border-b-0 sm:border-r">{list}</div>
      <div className="min-w-0 flex-1 p-4">{form}</div>
    </div>
  );
}

function CatalogList({ count, noun, children }: { count: number; noun: string; children: ReactNode }) {
  return (
    <div className="flex h-full max-h-52 flex-col sm:max-h-none">
      <div className="flex items-center justify-between px-3 py-2.5">
        <Label>
          {count} {noun}
        </Label>
      </div>
      <ul className="min-h-0 flex-1 space-y-px overflow-y-auto px-1.5 pb-2">{children}</ul>
    </div>
  );
}

// --- Sets manager ----------------------------------------------------------------

const TIME_OF_DAY_IDEAS = ["Interior", "Exterior", "Night", "Day", "Dusk", "Liminal", "Void"];

interface SetsManagerProps {
  open: boolean;
  onClose: () => void;
  showId: string;
  sets: SetEntity[];
}

export function SetsManager({ open, onClose, showId, sets }: SetsManagerProps) {
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("");
  const [description, setDescription] = useState("");
  const [lookNotes, setLookNotes] = useState("");
  const [imageIds, setImageIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setName("");
      setTimeOfDay("");
      setDescription("");
      setLookNotes("");
      setImageIds([]);
    }
  }, [open]);

  const loadForEdit = (s: SetEntity) => {
    setEditingId(s.id);
    setName(s.name);
    setTimeOfDay(s.timeOfDay);
    setDescription(s.description);
    setLookNotes(s.lookNotes ?? "");
    setImageIds(s.referenceImageIds ?? []);
  };

  const reset = () => {
    setEditingId(null);
    setName("");
    setTimeOfDay("");
    setDescription("");
    setLookNotes("");
    setImageIds([]);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (editingId) {
      await updateSet(editingId, { name: trimmed, timeOfDay: timeOfDay.trim(), description, lookNotes, referenceImageIds: imageIds });
    } else {
      const id = await createSet(showId, { name: trimmed, timeOfDay: timeOfDay.trim(), description });
      await updateSet(id, { lookNotes, referenceImageIds: imageIds });
    }
    reset();
  };

  const validName = name.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose} title="Sets" subtitle="Physical locations referenced by #TagName in scene actions." wide>
      <CatalogLayout
        list={
          <CatalogList count={sets.length} noun={sets.length === 1 ? "set" : "sets"}>
            {sets.map((s) => (
              <li key={s.id}>
                <div
                  className={clsx(
                    "group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12px]",
                    s.id === editingId ? "bg-amber-500/10 text-amber-200" : "text-neutral-300 hover:bg-neutral-800/70"
                  )}
                  onClick={() => loadForEdit(s)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="truncate text-[10px] text-neutral-600">{s.timeOfDay || "—"}</div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete set ${s.name}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirm({ message: `Delete set "${s.name}"? Scenes pointing at it will be unlinked.`, confirmLabel: "Delete set" })) {
                        if (s.id === editingId) reset();
                        void deleteSet(s.id);
                      }
                    }}
                    className="shrink-0 rounded p-1 text-neutral-500 opacity-70 transition-colors hover:bg-red-950/70 hover:text-red-400 hover:opacity-100"
                  >
                    <Trash size={11} />
                  </button>
                </div>
              </li>
            ))}
          </CatalogList>
        }
        form={
          <div className="space-y-3">
            <Field label={editingId ? "Edit set" : "New set"}>
              <div className="flex items-center gap-2">
                <TextInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Abandoned Broadcast Booth"
                  aria-label="Set name"
                  onKeyDown={(e) => e.key === "Enter" && save()}
                />
                <Chip tone={validName ? "amber" : "dim"} className="h-7 shrink-0">
                  <Hash size={10} aria-hidden />
                  {validName ? name.trim() : "TagName"}
                </Chip>
              </div>
            </Field>
            <Field label="Time of day / quality">
              <TextInput
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                placeholder="Interior, Night, Liminal…"
                aria-label="Time of day"
                list="timeofday-ideas"
              />
              <datalist id="timeofday-ideas">
                {TIME_OF_DAY_IDEAS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Description" hint="Physical traits, props, textures, ambient audio — feeds Seedance ambience.">
              <TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Peeling varnish, a dead CRT glowing faint blue, tape-hiss ambience…"
                aria-label="Set description"
              />
            </Field>
            <Field label="Look" hint="Lighting, palette, lens feel. Handed to the video tool with the location.">
              <TextInput value={lookNotes} onChange={(e) => setLookNotes(e.target.value)} placeholder="Cold blue moonlight, wet surfaces, shallow focus" aria-label="Set look" />
            </Field>
            <Field label="Reference images" hint="Attach these when casting in Mago Studio.">
              <ImagePicker showId={showId} ids={imageIds} onChange={setImageIds} label={name.trim() || "this set"} />
            </Field>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="md" onClick={save} disabled={!validName}>
                <Plus size={13} strokeWidth={2.5} />
                {editingId ? "Save changes" : "Add set"}
              </Button>
              {editingId && (
                <Button variant="subtle" size="md" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        }
      />
    </Modal>
  );
}

// --- Characters manager -------------------------------------------------------------

const ROLES: CharacterRole[] = ["Protagonist", "Antagonist", "Supporting"];

interface CharactersManagerProps {
  open: boolean;
  onClose: () => void;
  showId: string;
  characters: CharacterEntity[];
}

export function CharactersManager({ open, onClose, showId, characters }: CharactersManagerProps) {
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<CharacterRole>("Supporting");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [visualDescription, setVisualDescription] = useState("");
  const [voiceDescription, setVoiceDescription] = useState("");
  const [wardrobe, setWardrobe] = useState("");
  const [distinctiveFeatures, setDistinctiveFeatures] = useState("");
  const [imageIds, setImageIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reset = () => {
    setEditingId(null);
    setName("");
    setRole("Supporting");
    setAge("");
    setGender("");
    setVisualDescription("");
    setVoiceDescription("");
    setWardrobe("");
    setDistinctiveFeatures("");
    setImageIds([]);
  };

  const loadForEdit = (c: CharacterEntity) => {
    setEditingId(c.id);
    setName(c.name);
    setRole(c.role);
    setAge(c.age);
    setGender(c.gender);
    setVisualDescription(c.visualDescription);
    setVoiceDescription(c.voiceDescription);
    setWardrobe(c.wardrobe ?? "");
    setDistinctiveFeatures(c.distinctiveFeatures ?? "");
    setImageIds(c.referenceImageIds ?? []);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const payload = {
      name: trimmed,
      role,
      age: age.trim(),
      gender: gender.trim(),
      visualDescription,
      voiceDescription,
      wardrobe,
      distinctiveFeatures,
      referenceImageIds: imageIds,
    };
    if (editingId) {
      await updateCharacter(editingId, payload);
    } else {
      await createCharacter(showId, payload);
    }
    reset();
  };

  const validName = name.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Characters"
      subtitle="Cast referenced by @TagName in actions and dialogue."
      wide
    >
      <CatalogLayout
        list={
          <CatalogList count={characters.length} noun={characters.length === 1 ? "character" : "characters"}>
            {characters.map((c) => (
              <li key={c.id}>
                <div
                  className={clsx(
                    "group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12px]",
                    c.id === editingId ? "bg-amber-500/10 text-amber-200" : "text-neutral-300 hover:bg-neutral-800/70"
                  )}
                  onClick={() => loadForEdit(c)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-[10px] text-neutral-600">{c.role}</div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete character ${c.name}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirm({ message: `Delete character "${c.name}"? Their dialogue lines will be removed from scenes.`, confirmLabel: "Delete character" })) {
                        if (c.id === editingId) reset();
                        void deleteCharacter(c.id);
                      }
                    }}
                    className="shrink-0 rounded p-1 text-neutral-500 opacity-70 transition-colors hover:bg-red-950/70 hover:text-red-400 hover:opacity-100"
                  >
                    <Trash size={11} />
                  </button>
                </div>
              </li>
            ))}
          </CatalogList>
        }
        form={
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <Field label={editingId ? "Edit character" : "New character"} className="flex-1">
                <div className="flex items-center gap-2">
                  <TextInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. CUSTARD"
                    aria-label="Character name"
                    onKeyDown={(e) => e.key === "Enter" && save()}
                  />
                  <Chip tone={validName ? "amber" : "dim"} className="h-7 shrink-0">
                    <AtSign size={10} aria-hidden />
                    {validName ? name.trim() : "Name"}
                  </Chip>
                </div>
              </Field>
              <Field label="Role" className="w-36">
                <Select value={role} onChange={(e) => setRole(e.target.value as CharacterRole)} aria-label="Role">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Age">
                <TextInput value={age} onChange={(e) => setAge(e.target.value)} placeholder='62yo, "ageless"' aria-label="Age" />
              </Field>
              <Field label="Gender">
                <TextInput value={gender} onChange={(e) => setGender(e.target.value)} placeholder="—" aria-label="Gender" />
              </Field>
            </div>
            <Field label="Visual description" hint="Physical form, material, clothing, visual quirks → Character DNA persistence block.">
              <TextArea
                value={visualDescription}
                onChange={(e) => setVisualDescription(e.target.value)}
                rows={4}
                placeholder="A custard-yellow puppet of indeterminate species; frayed velvet seams, oversized bow tie…"
                aria-label="Visual description"
              />
            </Field>
            <Field label="Voice description" hint="Timbre, dialect, cadence, audio processing / distortion traits.">
              <TextArea
                value={voiceDescription}
                onChange={(e) => setVoiceDescription(e.target.value)}
                rows={3}
                placeholder="Warm baritone warped through a 1970s tape delay; slight clip at phrase ends…"
                aria-label="Voice description"
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Wardrobe" hint="What they wear by default.">
                <TextInput value={wardrobe} onChange={(e) => setWardrobe(e.target.value)} placeholder="Red velvet coat, one boot" aria-label="Wardrobe" />
              </Field>
              <Field label="Distinctive features" hint="Comma-separated: scars, glasses, gait.">
                <TextInput value={distinctiveFeatures} onChange={(e) => setDistinctiveFeatures(e.target.value)} placeholder="eyepatch, gold tooth" aria-label="Distinctive features" />
              </Field>
            </div>
            <Field label="Reference images" hint="Attach these when casting in Mago Studio so the face stays consistent.">
              <ImagePicker showId={showId} ids={imageIds} onChange={setImageIds} label={name.trim() || "this character"} />
            </Field>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="md" onClick={save} disabled={!validName}>
                <Plus size={13} strokeWidth={2.5} />
                {editingId ? "Save changes" : "Add character"}
              </Button>
              {editingId && (
                <Button variant="subtle" size="md" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        }
      />
    </Modal>
  );
}

// --- Show Bible -----------------------------------------------------------------------

interface ShowBibleModalProps {
  open: boolean;
  onClose: () => void;
  show: ShowMeta | null;
}

export function ShowBibleModal({ open, onClose, show }: ShowBibleModalProps) {
  // Local draft synced from the store; saved on every change (partial patch).
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [premise, setPremise] = useState("");
  const [logline, setLogline] = useState("");
  const [visualStyle, setVisualStyle] = useState("");

  useEffect(() => {
    setTitle(show?.title ?? "");
    setGenre(show?.genre ?? "");
    setPremise(show?.premise ?? "");
    setLogline(show?.logline ?? "");
    setVisualStyle(show?.visualStyle ?? "");
  }, [show?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null;

  return (
    <Modal open={open} onClose={onClose} title="Show Bible" subtitle="Top-level context fed to the AI scene generator." wide>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title">
            <TextInput
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                void updateShow(show.id, { title: e.target.value.trim() || "Untitled Show" });
              }}
              placeholder="Show title"
              aria-label="Show title"
            />
          </Field>
          <Field label="Genre">
            <TextInput
              value={genre}
              onChange={(e) => {
                setGenre(e.target.value);
                void updateShow(show.id, { genre: e.target.value });
              }}
              placeholder="e.g. Analog-horror sitcom"
              aria-label="Show genre"
            />
          </Field>
        </div>
        <Field label="Logline" hint="One sentence that sells the show.">
          <TextInput value={logline} onChange={(e) => { setLogline(e.target.value); void updateShow(show.id, { logline: e.target.value }); }} placeholder="Two pirates host a talk show nobody asked for." aria-label="Logline" />
        </Field>
        <Field label="Visual style" hint="The shared look. Sent to Mago Studio so every scene matches. Describe the treatment, not the story.">
          <TextArea value={visualStyle} onChange={(e) => { setVisualStyle(e.target.value); void updateShow(show.id, { visualStyle: e.target.value }); }} rows={3} placeholder="Grainy 1990s public-access video, warm tungsten light, slightly crushed blacks" aria-label="Visual style" />
        </Field>
        <Field
          label="Premise"
          hint="World rules, lore, visual style, glitch / broadcast aesthetics. Included as context when generating scenes with AI."
        >
          <TextArea
            value={premise}
            onChange={(e) => {
              setPremise(e.target.value);
              void updateShow(show.id, { premise: e.target.value });
            }}
            rows={8}
            placeholder="A lost children's program broadcast from a station that shouldn't exist…"
            aria-label="Show premise"
          />
        </Field>
        <p className="font-mono text-[10px] text-neutral-600">Changes save automatically to this browser.</p>
      </div>
    </Modal>
  );
}
