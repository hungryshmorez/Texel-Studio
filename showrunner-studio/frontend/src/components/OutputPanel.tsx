// OutputPanel.tsx — Right rail: tabbed Showrunner preview / Seedance export /
// AI scene generator. Tabs stay mounted so drafts survive tab switches.
import { useState } from "react";
import clsx from "clsx";
import { MonitorPlay, Video, WandSparkles } from "lucide-react";
import type { CharacterEntity, EpisodeEntity, SceneEntity, SetEntity, ShowMeta } from "../types";
import { ShowrunnerPanel } from "./ShowrunnerPanel";
import { SeedancePanel } from "./SeedancePanel";
import { AiScenePanel } from "./AiScenePanel";

type Tab = "showrunner" | "seedance" | "ai";

const TABS: { id: Tab; label: string; icon: typeof MonitorPlay }[] = [
  { id: "showrunner", label: "Showrunner", icon: MonitorPlay },
  { id: "seedance", label: "Seedance", icon: Video },
  { id: "ai", label: "AI Scene", icon: WandSparkles },
];

interface OutputPanelProps {
  show: ShowMeta | null;
  episode: EpisodeEntity | null;
  scene: SceneEntity | null;
  set: SetEntity | undefined;
  sets: SetEntity[];
  characters: CharacterEntity[];
  onSceneApplied: (sceneId: string) => void;
}

export function OutputPanel({ show, episode, scene, set, sets, characters, onSceneApplied }: OutputPanelProps) {
  const [tab, setTab] = useState<Tab>("showrunner");

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-neutral-800 bg-neutral-900/30 lg:w-[380px] lg:border-l xl:w-[420px]">
      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Output panels"
        className="flex shrink-0 gap-0.5 border-b border-neutral-800 bg-neutral-900/70 p-1"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={clsx(
              "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium transition-colors",
              tab === id
                ? "bg-neutral-800 text-amber-200"
                : "text-neutral-500 hover:bg-neutral-800/50 hover:text-neutral-300"
            )}
          >
            <Icon size={12} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div role="tabpanel" aria-label="Showrunner preview" hidden={tab !== "showrunner"}>
          <ShowrunnerPanel scene={scene} set={set} characters={characters} />
        </div>
        <div role="tabpanel" aria-label="Seedance export" hidden={tab !== "seedance"}>
          <SeedancePanel scene={scene} set={set} characters={characters} />
        </div>
        <div role="tabpanel" aria-label="AI scene generator" hidden={tab !== "ai"}>
          <AiScenePanel
            show={show}
            episode={episode}
            scene={scene}
            sets={sets}
            characters={characters}
            onApplied={onSceneApplied}
          />
        </div>
      </div>
    </aside>
  );
}
