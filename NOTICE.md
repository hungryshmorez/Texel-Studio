# Notices

## Showwriter Studio

Showwriter Studio is licensed under the **GNU Affero General Public License, version 3 only**
([LICENSE](LICENSE)). If you run a modified copy as a network service, section 13 requires you
to offer its source to the people using it. The app links to this repository for that reason.

## Code ported from Mago Studio

`showrunner-studio/frontend/src/mago/` is code from
[Mago Studio](https://github.com/MagoStudio/MagoStudio), Copyright (C) 2026 Mago Studio,
licensed under the GNU Affero General Public License, version 3 only. It was copied from the
`desktop/main` tree of the Mago Studio repository (commit `b35f9d3`) and is modified only as far as
running in a browser needs. Every file carries a header saying so.

| Ported from (`desktop/main/…`) | Here (`src/mago/…`) | What changed |
|---|---|---|
| `scriptProjects/casting/{scriptCasting,castingModels,castingTokens,scenarioShots,sequenceGeneration,qwenStructuredCall,castingPrompts.generated}.ts` | `casting/` | SHA-1 now comes from `hash.ts`; two error classes spell out their constructor fields; imports adjusted |
| `scriptProjects/videoPrompt/{videoPrompt,videoPromptPayload,dialogueCompose,shotVideoPromptBody,pythonText,qwenVideoPromptCall,videoPromptTemplate.generated}.ts` | `videoPrompt/` | one error class spells out its constructor fields; type-only imports; imports adjusted |
| `scriptProjects/storyboards/{prompts,buildStoryboardPrompt,composer,storyboard,template}.ts` | `storyboards/` | `template.ts` builds the template PNG with fflate and `Uint8Array` instead of node:zlib and `Buffer` |
| `scriptProjects/{renderSpec,stripQwenReasoning}.ts`, `scriptProjects/shots/sequentialContinuation.ts` | `renderSpec.ts`, `stripQwenReasoning.ts`, `shots/` | SHA-256 now comes from `hash.ts` |
| `vlm/dialogue.ts`, `vlm/prompts/adaptPromptI2vMinimaxH3.ts` | `vlm/` | imports adjusted |
| `scriptProjects/{casting,videoPrompt}/*Parity.*` test files and fixtures | `__tests__/` | imports adjusted; fixtures unchanged |

The prompts and response schemas inside those files are Mago's. Showwriter's own code that calls
them is in `showrunner-studio/frontend/src/lib/magoWriting.ts`, and a generic Gemini completion
endpoint in `showrunner-studio/backend/main.py` (`/api/mago/complete/start`) stands in for the model
Mago would have used.

The package format Showwriter exports for Mago Studio (`src/lib/magoExport.ts`) is Showwriter's own.

## Dependencies

Third-party packages keep their own licenses; see `package-lock.json` and `uv.lock`.
