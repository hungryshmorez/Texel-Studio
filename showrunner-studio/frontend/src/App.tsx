// App.tsx — Texel Studio shell: selection state, live Dexie queries,
// three-pane layout (tree · script editor · export rails) and modals.
import { useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Clapperboard, Plus } from "lucide-react";
import { db } from "./lib/db";
import {
  createEpisode,
  createScene,
  createShow,
  deleteEpisode,
  deleteScene,
  deleteShow,
  updateEpisode,
  updateShow,
} from "./lib/actions";
import type { CharacterEntity, EpisodeEntity, SceneEntity, SetEntity, ShowMeta } from "./types";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { CritiquePanel } from "./components/CritiquePanel";
import { useConfirm } from "./components/ConfirmDialog";
import { SceneEditor } from "./components/SceneEditor";
import { OutputPanel } from "./components/OutputPanel";
import { CharactersManager, SetsManager, ShowBibleModal } from "./components/CatalogModals";
import { ImportPanel } from "./components/ImportPanel";
import { FootageEditor } from "./components/FootageEditor";
import { Button, Field, Modal, TextInput } from "./components/ui";

type ModalKind = "newShow" | "sets" | "characters" | "bible" | "import" | "ailab" | null;

export default function App() {
  const confirm = useConfirm();
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [footageMode, setFootageMode] = useState(false);

  // --- Live queries -----------------------------------------------------------
  const shows = useLiveQuery(() => db.shows.orderBy("updatedAt").reverse().toArray(), [], [] as ShowMeta[]);
  const episodes = useLiveQuery(
    () => (selectedShowId ? db.episodes.where("showId").equals(selectedShowId).sortBy("order") : Promise.resolve([] as EpisodeEntity[])),
    [selectedShowId],
    [] as EpisodeEntity[]
  );
  const scenes = useLiveQuery(
    () => (selectedEpisodeId ? db.scenes.where("episodeId").equals(selectedEpisodeId).sortBy("order") : Promise.resolve([] as SceneEntity[])),
    [selectedEpisodeId],
    [] as SceneEntity[]
  );
  const sets = useLiveQuery(
    () => (selectedShowId ? db.sets.where("showId").equals(selectedShowId).sortBy("name") : Promise.resolve([] as SetEntity[])),
    [selectedShowId],
    [] as SetEntity[]
  );
  const characters = useLiveQuery(
    () => (selectedShowId ? db.characters.where("showId").equals(selectedShowId).sortBy("name") : Promise.resolve([] as CharacterEntity[])),
    [selectedShowId],
    [] as CharacterEntity[]
  );

  const showList = shows ?? [];
  const episodeList = episodes ?? [];
  const sceneList = scenes ?? [];
  const setList = sets ?? [];
  const characterList = characters ?? [];

  const show = showList.find((s) => s.id === selectedShowId) ?? null;
  const episode = episodeList.find((e) => e.id === selectedEpisodeId) ?? null;
  const scene = sceneList.find((s) => s.id === selectedSceneId) ?? null;
  const set = setList.find((t) => t.id === scene?.targetSetId);

  // Flattened current script text for the AI Script Lab (critique/rewrite).
  const currentScriptText = scene
    ? [
        scene.sceneName,
        "",
        scene.action,
        "",
        ...scene.dialogue.map((d) => {
          const name = characterList.find((c) => c.id === d.characterId)?.name ?? "UNKNOWN";
          return `${name}: ${d.parenthetical ? `(${d.parenthetical}) ` : ""}${d.text}`;
        }),
      ]
        .join("\n")
        .trim() || null
    : null;

  // --- Selection sync (auto-select first, prune dead selections) ---------------
  useEffect(() => {
    if (showList.length === 0) {
      if (selectedShowId !== null) setSelectedShowId(null);
      return;
    }
    if (!showList.some((s) => s.id === selectedShowId)) setSelectedShowId(showList[0].id);
  }, [showList, selectedShowId]);

  useEffect(() => {
    if (!selectedShowId) {
      if (selectedEpisodeId !== null) setSelectedEpisodeId(null);
      return;
    }
    if (!episodeList.some((e) => e.id === selectedEpisodeId)) {
      setSelectedEpisodeId(episodeList[0]?.id ?? null);
    }
  }, [episodeList, selectedShowId, selectedEpisodeId]);

  useEffect(() => {
    if (!selectedEpisodeId) {
      if (selectedSceneId !== null) setSelectedSceneId(null);
      return;
    }
    if (!sceneList.some((s) => s.id === selectedSceneId)) {
      setSelectedSceneId(sceneList[0]?.id ?? null);
    }
  }, [sceneList, selectedEpisodeId, selectedSceneId]);

  // --- Handlers -----------------------------------------------------------------
  const addEpisode = async () => {
    if (!selectedShowId) return;
    const id = await createEpisode(selectedShowId);
    setSelectedEpisodeId(id);
  };

  const addScene = async () => {
    if (!selectedEpisodeId) return;
    const id = await createScene(selectedEpisodeId);
    setSelectedSceneId(id);
  };

  const noShows = showList.length === 0;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-neutral-950 text-neutral-200">
      <TopBar
        shows={showList}
        show={show}
        onSelectShow={setSelectedShowId}
        onNewShow={() => setModal("newShow")}
        onOpenShowBible={() => setModal("bible")}
        onEditFootage={() => setFootageMode(true)}
      />

      {footageMode ? (
        <FootageEditor onClose={() => setFootageMode(false)} />
      ) : noShows ? (
        <WelcomeScreen onNewShow={() => setModal("newShow")} onImport={() => setModal("import")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <Sidebar
            shows={showList}
            selectedShowId={selectedShowId}
            episodes={episodeList}
            selectedEpisodeId={selectedEpisodeId}
            scenes={sceneList}
            selectedSceneId={selectedSceneId}
            setCount={setList.length}
            characterCount={characterList.length}
            onSelectShow={setSelectedShowId}
            onSelectEpisode={setSelectedEpisodeId}
            onSelectScene={setSelectedSceneId}
            onAddShow={() => setModal("newShow")}
            onAddEpisode={addEpisode}
            onAddScene={addScene}
            onDeleteShow={async (s) => {
              if (await confirm({ message: `Delete show "${s.title}" with all its episodes, scenes, sets and characters?`, confirmLabel: "Delete show" })) {
                if (selectedShowId === s.id) setSelectedShowId(null);
                void deleteShow(s.id);
              }
            }}
            onDeleteEpisode={async (ep) => {
              if (await confirm({ message: `Delete episode "${ep.title}" and all its scenes?`, confirmLabel: "Delete episode" })) {
                if (selectedEpisodeId === ep.id) setSelectedEpisodeId(null);
                void deleteEpisode(ep.id);
              }
            }}
            onDeleteScene={async (sc) => {
              if (await confirm({ message: `Delete scene "${sc.sceneName}"?`, confirmLabel: "Delete scene" })) {
                if (selectedSceneId === sc.id) setSelectedSceneId(null);
                void deleteScene(sc.id);
              }
            }}
            onRenameShow={(s, title) => void updateShow(s.id, { title })}
            onRenameEpisode={(ep, title) => void updateEpisode(ep.id, { title })}
            onOpenSets={() => setModal("sets")}
            onOpenCharacters={() => setModal("characters")}
            onOpenShowBible={() => setModal("bible")}
            onOpenImport={() => setModal("import")}
            onOpenAiLab={() => setModal("ailab")}
          />

          {/* Script editor */}
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto border-neutral-800 lg:border-r">
            {scene ? (
              <SceneEditor
                key={scene.id}
                scene={scene}
                episode={episode}
                sets={setList}
                characters={characterList}
                onOpenSets={() => setModal("sets")}
                onOpenCharacters={() => setModal("characters")}
              />
            ) : (
              <EmptyPane
                title={selectedEpisodeId ? "No scene selected" : "No episode selected"}
                body={
                  selectedEpisodeId
                    ? "Pick a scene from the tree, or create a new one to start writing."
                    : "Pick or create an episode first — scenes live inside episodes."
                }
                action={
                  selectedEpisodeId ? (
                    <Button variant="primary" size="md" onClick={addScene}>
                      <Plus size={13} strokeWidth={2.5} /> New scene
                    </Button>
                  ) : selectedShowId ? (
                    <Button variant="primary" size="md" onClick={addEpisode}>
                      <Plus size={13} strokeWidth={2.5} /> New episode
                    </Button>
                  ) : undefined
                }
              />
            )}
          </main>

          {/* Export rails */}
          <OutputPanel
            show={show}
            episode={episode}
            scene={scene}
            set={set}
            sets={setList}
            characters={characterList}
            onSceneApplied={(id) => setSelectedSceneId(id)}
          />
        </div>
      )}

      {/* Modals */}
      <NewShowModal
        open={modal === "newShow"}
        onClose={() => setModal(null)}
        onCreate={async (title) => {
          const id = await createShow(title);
          setSelectedShowId(id);
          setModal(null);
        }}
      />
      {show && (
        <>
          <SetsManager
            open={modal === "sets"}
            onClose={() => setModal(null)}
            showId={show.id}
            sets={setList}
          />
          <CharactersManager
            open={modal === "characters"}
            onClose={() => setModal(null)}
            showId={show.id}
            characters={characterList}
          />
        </>
      )}
      <ShowBibleModal open={modal === "bible"} onClose={() => setModal(null)} show={show} />
      <CritiquePanel
        open={modal === "ailab"}
        onClose={() => setModal(null)}
        showTitle={show?.title ?? null}
        showGenre={show?.genre ?? null}
        showBibleText={show?.premise?.trim() || null}
        currentScriptText={currentScriptText}
      />
      <ImportPanel
        key={modal === "import" ? "open" : "closed"}
        open={modal === "import"}
        onClose={() => setModal(null)}
        show={show}
        sets={setList}
        characters={characterList}
        onImported={(showId, episodeId, sceneId) => {
          setSelectedShowId(showId);
          if (episodeId) setSelectedEpisodeId(episodeId);
          if (sceneId) setSelectedSceneId(sceneId);
        }}
      />
    </div>
  );
}

// --- New Show modal ------------------------------------------------------------

function NewShowModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (title: string) => void }) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (open) setTitle("");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="New show" subtitle="Each show keeps its own sets, characters, episodes and scenes.">
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(title.trim() || "Untitled Show");
        }}
      >
        <Field label="Title">
          <TextInput
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. SIGNAL LOST — Season 1"
            aria-label="Show title"
          />
        </Field>
        <Button variant="primary" size="md" className="w-full" type="submit">
          Create show
        </Button>
      </form>
    </Modal>
  );
}

// --- Empty states -----------------------------------------------------------------

function WelcomeScreen({ onNewShow, onImport }: { onNewShow: () => void; onImport: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <Clapperboard size={40} className="mx-auto text-amber-400" aria-hidden />
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-neutral-100">Texel Studio</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-neutral-500">
          A local-first writers' room: build your show bible, register sets and characters as{" "}
          <span className="font-mono text-amber-300">#tags</span> and{" "}
          <span className="font-mono text-amber-300">@tags</span>, outline scenes, then export AI-video-ready
          Write scenes, prepare shots, and render with Texel. Scripts stay in this browser; media jobs run on the backend.
        </p>
        <Button variant="primary" size="lg" className="mx-auto mt-5" onClick={onNewShow}>
          <Plus size={14} strokeWidth={2.5} /> Create your first show
        </Button>
        <button
          type="button"
          onClick={onImport}
          className="mx-auto mt-3 block text-[12px] text-neutral-500 underline-offset-2 transition-colors hover:text-amber-300 hover:underline"
        >
          …or import a Show Bible / script to start
        </button>
      </div>
    </div>
  );
}

function EmptyPane({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold text-neutral-300">{title}</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-neutral-600">{body}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
