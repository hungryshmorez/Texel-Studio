# Showwriter Studio

**Write the show, the shots and every prompt here. Let [Mago Studio](https://github.com/MagoStudio/MagoStudio) draw the storyboards and render the video.**

Showwriter Studio is a local-first writers' room for AI video. You build the show bible, outline episodes as beats, write scenes, and turn each scene into a shot list with the words for every storyboard and video prompt. Then it packages everything for Mago Studio's Director, which does the pictures. Your writing stays in your browser.

> **Honest status.** The writing tools, exports and AI assist are tested (see [Verification](#verification)). Two things have **not** been tried: a real Gemini key (the AI features were tested against a fake model), and the exported package inside a real Mago Studio (Mago has no script importer, so you paste the package by hand, and I could not run its desktop app).

## Contents

1. [How it fits with Mago Studio](#how-it-fits-with-mago-studio)
2. [What it does](#what-it-does)
3. [Workflow](#workflow)
4. [The Mago package](#the-mago-package)
5. [Quick start](#quick-start)
6. [Configuration](#configuration)
7. [Your data](#your-data)
8. [Verification](#verification)
9. [Limitations](#limitations)
10. [License](#license)
11. [Hosting](#hosting)
12. [Development and tests](#development-and-tests)
13. [Troubleshooting](#troubleshooting)
14. [Repository layout](#repository-layout)

## How it fits with Mago Studio

Mago Studio is a separate, local-first AI video editor (Electron + Next.js, [AGPL-3.0](https://github.com/MagoStudio/MagoStudio/blob/main/LICENSE)). Its **Mago Director** turns a script into cast, storyboards and consistent video scenes, rendering on your own GPU through ComfyUI or in Mago Cloud.

The two programs split the job:

| Showwriter Studio writes | Mago Studio makes |
|---|---|
| Show bible, characters, sets, visual style | Cast and reference sheets |
| Scenes, dialogue, beats | The Director script project |
| The shot list: framing, movement, timing, spoken words | Storyboards (one panel per shot) |
| Storyboard prompts and video prompts, in words | Rendered video |

They connect through a **file package**. Mago has no script import, so you paste the package into Mago Director by hand. Showwriter also **contains Mago's writing code**: the casting, shot-breakdown, video-prompt and storyboard-prompt pipelines are ported into `showrunner-studio/frontend/src/mago/` so the prompts you write here come from the same engine that will read them. Because of that, **Showwriter Studio is licensed AGPL-3.0**, like Mago. See [License](#license).

## What it does

### Writing tools
- **Show bible:** logline, genre, world, and a shared **visual style** that Mago applies to every scene.
- **Beat board:** plan an episode from a structure (five beats, three acts, sitcom A/B/C, Save the Cat, Hero's Journey), reorder beats, and create a scene from any beat.
- **Scenes:** status (idea, draft, revised, locked), screenplay heading (INT/EXT and time of day), one-line summary, action, dialogue with parentheticals, and `@Character` / `#Set` tags.
- **History:** save named versions, compare any version with the current scene line by line, and restore. A restore keeps your current text as a "Before restore" copy.
- **Checks:** instant, offline checks against the bible: missing sets, speakers who are not in the cast, unknown `@`/`#` tags, shots whose cast is not in the scene, dialogue too long for its shots, characters without a look. Click a result to jump to the scene.

### Visual bible
- Characters: visual description, wardrobe, distinctive features, voice, and reference images.
- Sets: description, look (lighting, palette), and reference images.
- Images are shrunk in your browser (1024 px long edge) and stored inside the project, so a backup is one file.

### Shot list and prompts
- Per scene: shot number, duration, framing, camera movement, what the camera sees, the words spoken in that shot, who is in it, a **storyboard prompt**, a **video prompt**, and notes.
- Copy the shot table in Mago's `[Shot n] (start-end s) …` line format, or download a CSV.

### AI assist (needs a Gemini key)
- **Write shot list:** breaks a scene into shots. Dialogue is copied word for word, cast is limited to names you registered, and the visual style is never written into prompts (Mago applies it separately). Replacing existing shots asks first and offers **Undo**.
- **Fill missing prompts:** writes only prompts that are empty. Your own words are never overwritten.
- **Continuity check:** reads scenes against the bible and reports contradictions (looks, wardrobe, locations, things that appear or vanish). It does not judge quality.
- **Locked scenes** are never overwritten by AI. The AI Scene panel saves a "Before AI scene" version before it applies a draft.
- Older tools remain: AI scene drafting, the Script Lab (critique, write, rewrite) and the Showrunner/Seedance prompt exporters.

### Mago's writing engine (ported code)
These four features run Mago Studio's own code and prompts in your browser. The model calls go through the studio server to Gemini (Mago's cloud pipeline uses Gemini too; the local one uses Qwen). They need a Gemini key.
- **Cast from script** (Mago tab): reads the written scenes the way Mago's casting step does and proposes characters (look, distinctive features, voice) and locations. You tick what to add; anything the show already has is shown but never changed.
- **Break down with Mago's engine** (Shots tab): Mago's atomic-shot pass in *sequence mode*, so you get cut-sized shots (about 1.5–6 s), with framing, movement, lens, dialogue and beat type. It replaces the scene's shots after asking, with **Undo**.
- **Build storyboard prompt** (Shots tab, Scene prompts): Mago's storyboard-sheet prompt for the whole scene, one panel per shot, naming the cast and place. No model call.
- **Compose video prompt** (Shots tab, Scene prompts): Mago's six-section video-prompt composer over the scene's shot list (spoken lines are passed as dialogue turns, never typed into the picture). If the model's answer fails Mago's own validation twice, you get Mago's deterministic skeleton and a message saying so.
- **Save to scene** keeps both prompts with the scene, and they go into the Mago package.

Mago renders a scene as one clip of at most 15 seconds, so Scene prompts warns when the shot list is longer. Shots are composed for a 16:9 frame; Showwriter has no aspect setting yet.

### Exports
- **Mago package** (zip): see below.
- **Fountain** screenplay for Final Draft, Highland, Fade In and others.
- **Project JSON** for backup and moving between browsers (includes images, shots, beats and history).

## Workflow

1. Create a show. Open **Show Bible** and write the logline and the visual style.
2. Add **Characters** and **Sets** with descriptions and reference images.
3. Open an episode, switch to **Beat board**, add a structure, and create scenes from the beats.
4. Write each scene. Mark it **Revised** as you go and **Locked** when it is done.
5. In the **Shots** tab, write the shot list (by hand or with AI) and the storyboard and video prompts.
6. In the **Mago** tab, review the checks, then **Download package**.
7. In Mago Studio, create a **Mago Director** project and follow the package's `README.txt`.

## The Mago package

| File | Use |
|---|---|
| `README.txt` | The steps for pasting this into Mago Director |
| `director-script.txt` | Paste into the Director script box: title, logline, visual style, cast, environments, then the script with standard scene headings (which Mago's casting reads) |
| `shots/E01-S01-<scene>.txt` | The shot table for each scene, in `[Shot n] (start-end s) …` lines, plus one video prompt per shot |
| `storyboard-prompts.md` | The written storyboard direction for each shot |
| `cast/`, `environments/` | A description and your reference images for each; attach them when casting |
| `script.fountain` | The same script for screenwriting tools |
| `showwriter-project.json` | Everything in a structured form (schema `showwriter-mago-bridge` v1) for a future importer |

Rules: only the cast and sets used by the exported scenes are described; scenes with no action and no dialogue are left out (the notes say so); writer's notes never go to the video tool. You can export the whole show or one episode.

## Quick start

### GitHub Codespaces (works from a tablet)
1. Open https://codespaces.new/hungryshmorez/Texel-Studio and choose **Create codespace**. Setup installs Node 24, Python and uv, then starts both servers.
2. Open the **Ports** tab, find port **3001**, and open it in the browser. Keep it **Private**: the development build has no login.
3. For AI features, add your key (see [Configuration](#configuration)) and restart:
   ```bash
   cd /workspaces/Texel-Studio/showrunner-studio
   cp .env.example .env      # then edit .env
   pkill -f uvicorn; pkill -f vite
   cd /workspaces/Texel-Studio && bash .devcontainer/start.sh
   ```

Everything except the AI buttons works without a key.

### On your computer
Requirements: Node 22.12+ (or 24+), Python 3.12+, [uv](https://docs.astral.sh/uv/).

```bash
cp showrunner-studio/.env.example showrunner-studio/.env   # optional: add the Gemini key
./start.sh
```
Open http://localhost:3001. The backend listens on 3101 and Vite proxies `/api` to it.

## Configuration

Settings are server-side environment variables in `showrunner-studio/.env` (gitignored). Never put them in `VITE_*` variables or commit them.

| Variable | Needed for | Notes |
|---|---|---|
| `PROJEC_GOOGLE_API_KEY` | All AI buttons | A Gemini API key. Without it, AI buttons explain what to add; nothing else is affected. The model name `gemini-3.8-flash` is set in `backend/main.py` and has not been verified against a live key. |
| `APP_PASSWORD` | Public hosting | Turns on a login prompt (HTTP Basic, any username). |
| `REQUIRE_PASSWORD=1` | Public hosting | Refuse to start without `APP_PASSWORD`. Set in the Dockerfile. |

## Your data

- Scripts, bible, shots, history and images live in your **browser** (IndexedDB database `showrunner-studio`, the same name as before the rename, so older projects still open). The server stores nothing.
- Clearing site data deletes them. **Export JSON** (top bar) regularly. The export is version 2; version 1 files from older builds still import.
- Only text from the scene you are working on (and its bible entries) is sent to Gemini when you press an AI button. Reference images are never sent.

## Verification

| Area | Evidence | Status |
|---|---|---|
| Data layer (cascades, history restore, reordering, import of v1 files) | 13 tests against a fake IndexedDB | Pass |
| Fountain, shot-table formatting, Mago package (unzipped and read back), consistency checks | 27 tests | Pass |
| AI request building, result application, job polling | 10 tests, including "never overwrite the writer's prompts" | Pass |
| AI prompts, strict output parsers, endpoints | 15 backend tests with a fake model | Pass |
| Whole app in a real browser (Playwright): bible, image upload and downscaling, scene, history diff and restore, beat board, shots, package download, reload persistence, project export | Scripted run, zero console errors | Pass |
| AI buttons in a real browser | Same, against a **fake** model; plus the no-key message | Pass with a fake model |
| Gemini with a real key | No key was available | **Not tested** |
| Package pasted into a real Mago Studio | Mago's desktop app could not be run; the format follows Mago's published docs and prompts | **Not tested** |
| Ported Mago code: casting, video-prompt, storyboard-prompt, dialogue | Mago's own parity suites, copied with their fixtures (204 tests, generated by Mago's cloud backend), run against the port under vitest | Pass |
| Showwriter's use of the port (cast proposals, shot mapping, storyboard prompt, composer) and the `/api/mago/complete/start` endpoint | 11 frontend tests with canned model replies, 2 backend tests; browser run of all four features with Gemini mocked | Pass with a fake model |
| Codespaces setup, Docker image, Render deployment | Config written, not built | **Not tested** |

## Limitations

- Single user, no accounts. Use `APP_PASSWORD` if you expose it.
- No import for Mago's own projects, and Mago has no script importer, so the last step is a manual paste.
- AI quality depends on the model. Always read generated shots; the dialogue-verbatim rule is requested in the prompt and the structure is validated, but wording is not machine-verified.
- Storyboards and video are made in Mago. Showwriter writes the words only.
- No real-time collaboration. Backups are manual.
- The ported Mago modules were written for Mago's own models. Gemini is asked for the same JSON schemas and the answers are validated the same way (one retry), but quality and the validators' strictness against a real Gemini have not been seen.
- The composed video prompt is built without image references, because Showwriter does not render images. Mago will attach them when you paste the prompt into a scene, so expect to adjust the reference tags there.

## License

Showwriter Studio is licensed under the **GNU Affero General Public License v3.0 only** ([LICENSE](LICENSE)), because it includes code from [Mago Studio](https://github.com/MagoStudio/MagoStudio) (AGPL-3.0-only). In practice:

- If you run a modified copy as a network service, you must offer its source to the people using it. The app's top bar links to this repository for that.
- Keep the notices. Every ported file has a header saying where it came from and what changed; [NOTICE.md](NOTICE.md) lists them all.
- Anything you build on this code is also AGPL-3.0.

## Hosting

GitHub stores the code but cannot run it: GitHub Pages is static, and the AI endpoints need the Python backend.

- **Codespaces:** free for development; it sleeps when idle and Public port visibility resets on restart.
- **Docker / Render:** `showrunner-studio/Dockerfile` builds the frontend and backend into one container (single origin, password gate); `render.yaml` is a Render Blueprint. The backend is stateless, so no disk is needed. Set `APP_PASSWORD` and `PROJEC_GOOGLE_API_KEY` as secrets. The image build and a real deployment have not been tested.

## Development and tests

```bash
cd showrunner-studio/backend
uv sync --locked
uv run python -m unittest discover -s tests -v     # 17 tests, no network, no Gemini key

cd ../frontend
npm ci
npm test            # 64 tests (Node test runner, fake IndexedDB) then Mago's 204 parity tests (vitest)
npm run build       # type-check + production bundle
npm run lint
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| AI buttons say "AI writing is not set up" | Add `PROJEC_GOOGLE_API_KEY` to `showrunner-studio/.env` and restart the server. |
| An AI job fails with "did not return valid JSON" | The model replied in the wrong shape. Press the button again. |
| "The AI model is temporarily overloaded" | Gemini was busy. Wait a few seconds and retry. |
| The package is missing a scene | Scenes with no action or dialogue are left out on purpose; the export notes say how many. |
| A scene's heading shows `.SCENE NAME` in Fountain | The scene has no set, so it uses a forced heading. Choose a set. |
| Everything is gone after switching browsers | Projects live in each browser. Use **Export JSON** and **Import JSON**. |
| Page shows 502 in Codespaces | The server stopped or the Codespace slept. Restart it from the terminal (Quick start step 3). |

## Repository layout

```
showrunner-studio/
  backend/           FastAPI: AI endpoints (ai_writing.py has prompts and parsers), hosting gate, tests
  frontend/          React + TypeScript
    src/lib/         Data layer, Fountain, shot list, Mago package, consistency checks, AI request builders, magoWriting.ts (glue to the port)
    src/mago/        Code ported from Mago Studio (AGPL-3.0): casting, video prompt, storyboard prompt, dialogue, parity tests
    src/components/  Beat board, scene editor, history, shot list, Mago panel, bible forms
    tests/           Unit and data-layer tests
  Dockerfile         One-container build
.devcontainer/       Codespaces setup (stock image + uv)
render.yaml          Render Blueprint
LICENSE NOTICE.md    AGPL-3.0 text and the list of ported files
public/ source/      Legacy static Script Studio prototype, served at /legacy/public/
```

The older static Script Studio prototype remains in `public/` and `source/`, reachable through the backend at `/legacy/public/`. The documentation below describes that prototype, not the current app.

---

# Legacy Script Studio

Script Studio is a local-first, browser-based application designed for writers to create, manage, and outline their movie and television series projects. It provides a clean, distraction-free interface for developing core concepts, characters, and narrative structures, with all data saved directly in your browser's `localStorage`.

This project is built with vanilla HTML, CSS, and JavaScript, using modern ES modules to create a clean, maintainable, and dependency-free codebase.

## Features

*   **Project Management**: Create, delete, and switch between multiple projects.
*   **Persistent Storage**: All your work is automatically saved to your browser's `localStorage`, so your projects are available every time you open the application.
*   **Tabbed Editor**: Organize your project details with a clean, tabbed interface for:
    *   **Overview**: Edit the project title, logline, and synopsis.
    *   **Episodes**: Add, remove, and outline individual episodes for a series.
    *   **Characters**: Create and manage a list of characters with their bios and goals.
    *   **Settings**: Manage project-level settings.
*   **Data Portability**:
    *   **Export to JSON**: Download a complete JSON file of your active project for backup or collaboration.
    *   **Import from JSON**: Import a previously exported project file to restore your work or share it between browsers.
*   **Mock AI Integration**: Includes a placeholder AI service that can generate a sample story outline based on your project's title and logline. This is designed to be easily swappable with a real backend service.
*   **Lightweight & Fast**: No build step, no external dependencies. The application runs directly in any modern browser.

## Getting Started

Because this application uses ES modules, it must be served over a proper HTTP server to function correctly due to browser security policies (CORS). You cannot simply open the `public/index.html` file from your local filesystem.

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2.  **Run a local web server:**
    The easiest way to do this is with Python's built-in HTTP server. Run this command from the **root of the project directory**:
    ```bash
    python -m http.server 8000
    ```
    If you have Node.js installed, you can also use a simple package like `http-server`:
    ```bash
    npx http-server . -p 8000
    ```

3.  **Open the application:**
    Once the server is running, open your web browser and navigate to:
    [http://localhost:8000/public/](http://localhost:8000/public/)

## Project Structure

The project is organized with a clear separation of public-facing files and source code.

```
.
├── public/
│   └── index.html         # The main entry point and application shell.
└── source/
    ├── css/
    │   └── styles.css     # All application styles.
    └── js/
        ├── main.js        # Bootstrapper: loads data and initializes the UI.
        ├── data.js        # State management: single source of truth.
        ├── ui.js          # DOM manipulation and event handling.
        ├── api.js         # Mock AI service.
        └── utils.js       # Shared utility functions (debounce, event bus, etc.).
```

*   `public/`: Contains assets that are directly served to the browser.
*   `source/`: Contains the core application logic and styles.

## Architecture Deep Dive

The application is designed around a few core principles to ensure it is maintainable, scalable, and easy to understand.

### 1. Separation of Concerns

The JavaScript code is split into modules, each with a distinct responsibility:

*   **`data.js` (The "Brain")**: This is the most critical module. It manages the application's entire state, including the list of projects and the active project ID. It is the *only* module allowed to mutate the state. All data persistence to `localStorage` happens here. It knows nothing about the DOM or UI.
*   **`ui.js` (The "Hands and Eyes")**: This module is responsible for everything the user sees and interacts with. It reads data provided by `data.js` and renders the corresponding HTML. It listens for user events (clicks, input) and communicates the user's intent back to the `data.js` module for state updates. It is completely stateless.
*   **`api.js` (The "Messenger")**: This module handles all external communication. Currently, it contains a mock `AISession` class that simulates a network request. This can be easily swapped with a real `fetch` call to a backend service without affecting any other part of the application.
*   **`utils.js` (The "Toolbox")**: Contains shared, reusable functions like `debounce`, `uid` for generating unique IDs, and the event bus.
*   **`main.js` (The "Conductor")**: This tiny file kicks everything off. It simply calls `load()` from `data.js` and then `initUI()` from `ui.js`.

### 2. Unidirectional Data Flow & Reactivity

The application uses a simple but effective reactive model based on a custom event bus (`emit`/`on` in `utils.js`).

The flow is as follows:

1.  **User Action**: A user clicks a button or types in a field.
2.  **Event Listener (UI)**: An event listener in `ui.js` captures the action.
3.  **Data Mutation**: The event listener calls a function in `data.js` (e.g., `addCharacter()`, `updateProject()`).
4.  **State Change & Persistence**: `data.js` updates the internal `state` object and saves it to `localStorage`.
5.  **Event Emission**: After successfully changing the state, `data.js` fires a global event: `emit("data:changed", ...)`.
6.  **UI Re-rendering**: `ui.js` listens for the `data:changed` event. When it hears it, it calls its `renderAll()` function, which re-renders the entire UI based on the new state.

This unidirectional flow ensures that the UI is always a direct reflection of the application state, making the application predictable and easy to debug.

## How to Extend the Project

This scaffold is designed to be easily extended. Here are some examples:

*   **Adding a New Field (e.g., "Genre")**:
    1.  **`data.js`**: Add `genre: ""` to the `defaultProject` schema.
    2.  **`public/index.html`**: Add a new `<label>` and `<input id="project-genre">` to the editor section.
    3.  **`ui.js`**:
        *   Cache the new element in `initUI()`: `els.genre = $("#project-genre");`.
        *   Add an event listener in `bindEvents()` to call `updateProject({ genre: e.target.value })`.
        *   Update the input's value in `renderEditor()`: `els.genre.value = p.genre || "";`.

*   **Swapping the Mock AI Service**:
    1.  **`api.js`**: Modify the `AISession.generateOutline` method to use `fetch` to call your real backend API. Use an `AbortController` to handle cancellation, just as the mock `AISession` does.
    2.  No other files need to change. The `ui.js` module will continue to work seamlessly with the new implementation.
