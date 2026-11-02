// sceneText.ts — a scene's writing as plain text, used to compare two versions line by line.
import type { CharacterEntity, SceneSnapshot } from "../types";

/** The writing of a scene as plain text, used to compare two versions line by line. */
export function sceneText(snapshot: SceneSnapshot, characters: CharacterEntity[]): string {
  const dialogue = snapshot.dialogue.map((d) => {
    const name = characters.find((c) => c.id === d.characterId)?.name ?? "UNKNOWN";
    return `${name.toUpperCase()}${d.parenthetical ? ` (${d.parenthetical})` : ""}: ${d.text}`;
  });
  return [`# ${snapshot.sceneName}`, snapshot.summary ? `Summary: ${snapshot.summary}` : "", "", ...snapshot.action.split("\n"), "", ...dialogue, snapshot.sceneNotes ? `\nNotes: ${snapshot.sceneNotes}` : ""]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n").trim();
}
