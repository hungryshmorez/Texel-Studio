# Texel Studio

**Edit existing footage with Texel's cloud GPU editing API.** Upload clips and a theme song, trim and reorder them, normalize loudness, and render a 720p cut on Texel. Built for the AAIFF Global GenJam, Engineering track (Texel API).

Texel Studio is a React + TypeScript app with a FastAPI backend. Alongside the footage editor it keeps the original writers' room: show bible, characters, sets, scenes, AI script critique, and an "Outline to Trailer" keyframe workflow.

> **Honest status.** A real Texel cloud edit (reorder, trim, loudness normalization, GPU encode) was run successfully through a standalone script (job `254c23d1-8f4b-468a-b1da-41f04d814acd`: 191.6 s, trailer → music video → episode). The browser app's upload → Texel → download flow is verified only against a local storage stand-in and a **simulated** encoder, not yet against live Texel. See [Verification status](#verification-status).

## Contents

1. [What it does](#what-it-does)
2. [Quick start](#quick-start)
3. [Configuration](#configuration)
4. [Making a video with Edit footage](#making-a-video-with-edit-footage)
5. [How it works](#how-it-works)
6. [Verification status](#verification-status)
7. [Limitations](#limitations)
8. [Hosting it](#hosting-it)
9. [Development and tests](#development-and-tests)
10. [Troubleshooting](#troubleshooting)
11. [Repository layout](#repository-layout)

## What it does

### Edit footage (the main feature)
- **Media library:** upload video and audio (up to 1 GB each). Files are probed with ffprobe for duration, resolution and audio presence.
- **Timeline:** up to 12 clips, each with a source in-point and length (up to 300 s per clip). Reorder or remove clips freely.
- **Audio:** keep each clip's own audio, or replace it with a theme song starting at a chosen offset (for example 8.9 s to skip a silent intro). Optional loudness normalization (−16 LUFS) and Texel Studio Voice enhancement for speech.
- **Render:** the backend builds a Texel `video_encoder` filter graph and submits one job. Progress survives page reloads, and an interrupted render can be resumed without submitting (or paying) again.
- **Result:** preview in the page and download an MP4 (1280×720, 30 fps, H.264 + AAC).
- **Two ways to give Texel your media:**
  - *Managed storage:* the backend uploads to an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) and mints presigned URLs itself. You paste nothing.
  - *Bring your own URLs:* "I already host my files" accepts signed input URLs plus an output upload (PUT) URL and its read URL. No bucket needed.

### Writers' room and trailer tools (existing)
- Show bible, characters, sets, episodes and scenes with `@Character` / `#Set` tagging. Stored in your browser (IndexedDB). JSON import/export; document import (`.txt`, `.md`, `.pdf`, `.docx`).
- AI scene drafting and Script Lab (critique, write, rewrite) using Gemini. Needs `PROJEC_GOOGLE_API_KEY`.
- Showrunner and Seedance prompt exports.
- Outline to Trailer: scenes become editable keyframe prompts, Texel generates images, you approve them, and approved stills assemble into a storyboard trailer. FramePack animation exists in the code but is **not verified** (see below).

## Quick start

### GitHub Codespaces (works from a browser or tablet)
1. Open https://codespaces.new/hungryshmorez/filmtemplate/tree/ccr-86d77b34-m487zb and choose **Create codespace**. Setup installs Node 24, Python, uv, ffmpeg and the locked dependencies, then starts both servers.
2. In the terminal, add your keys (see [Configuration](#configuration)):
   ```bash
   cd /workspaces/filmtemplate/showrunner-studio
   cp .env.example .env      # then edit .env
   ```
3. Restart the app so it reads `.env`:
   ```bash
   pkill -f uvicorn; pkill -f vite
   cd /workspaces/filmtemplate && bash .devcontainer/start.sh
   ```
4. Open the **Ports** tab, find port **3001**, and open it in the browser. Keep the port **Private** unless someone else must use it: the dev build has no login, and a render spends Texel credits.

Logs are in `.devcontainer/.runtime/studio.log`. Export project JSON before deleting a Codespace; scripts live in your browser and media/jobs live in the Codespace.

### On your computer
Requirements: Node 22.12+ (or 24+), Python 3.12+, [uv](https://docs.astral.sh/uv/), ffmpeg and ffprobe on your PATH.

```bash
cp showrunner-studio/.env.example showrunner-studio/.env   # edit it
./start.sh
```
Open http://localhost:3001. The backend listens on 3101 and Vite proxies `/api` to it.

## Configuration

All settings are server-side environment variables in `showrunner-studio/.env` (gitignored). Never put them in `VITE_*` variables, commit them, or paste them into the browser.

| Variable | Needed for | Notes |
|---|---|---|
| `TEXEL_EDITING_API_KEY` | Rendering with Texel | Production editing key (`txl_…`). Check it with a read-only call: `GET https://api.prod.texel.ai/v1/billing/usage` returns 404 if the key is valid and 403 "invalid api key" if not. |
| `TEXEL_API_KEY` | Image/video generation | Used by the keyframe workflow. Editing falls back to it if no editing key is set. |
| `TEXEL_S3_ENDPOINT`, `TEXEL_S3_BUCKET`, `TEXEL_S3_ACCESS_KEY_ID`, `TEXEL_S3_SECRET_ACCESS_KEY`, `TEXEL_S3_REGION` | Managed uploads | Optional. Any S3-compatible bucket reachable by Texel over HTTPS. Without these, use "I already host my files". |
| `PROJEC_GOOGLE_API_KEY` | AI drafting and Script Lab | Gemini. Independent of Texel. |
| `TEXEL_DATA_DIR` | Persistent media and job state | Defaults to `backend/.texel-data`. |
| `APP_PASSWORD` | Public hosting | Turns on a login prompt (HTTP Basic, any username). |
| `TEXEL_REQUIRE_PASSWORD=1` | Public hosting | Refuse to start without `APP_PASSWORD`. Set in the Dockerfile. |

The Texel keys never reach the browser. Signed URLs and storage keys stay in the backend store and are never returned by the API.

## Making a video with Edit footage

1. Click **Edit footage** in the top bar and create a project.
2. **With a bucket:** upload your files, then **Add to timeline** for each clip. **Without a bucket:** open "I already host my files" and paste signed URLs (see below).
3. Set each clip's start and length, and order them top to bottom.
4. Pick the soundtrack and its start offset, or keep original audio. Leave normalization on.
5. Click **Render with Texel** and confirm. Watch progress, then preview and download.

### Bring-your-own URLs
Texel's encoder needs HTTPS URLs it can read, and a writable location for the result. Provide:
- a readable signed URL for each source clip (and the song, if used);
- an **output upload URL** (a signed PUT) and the matching **output read URL**, so the app can download the finished file.

Every clip length must be typed in, since remote files can't be probed. Every source needs an audio track unless you choose a soundtrack. Share pages that return HTML (for example a "download" page) are not valid inputs. If the host blocks the server's download of the finished file, the render still completes on Texel; use Resume once you have a working read URL, or fetch the file in a browser.

### Reproducing the verified job
The verified render used one pre-built montage (episode → music video → trailer) as the single source, three clips from it, in this output order:

| Order | Start in source (s) | Length (s) |
|---|---:|---:|
| 1. Trailer | 134.266667 | 57.333333 |
| 2. Music video | 75.233333 | 59.033333 |
| 3. Episode | 0 | 75.233333 |

Keep original audio, no soundtrack, normalize on. The song's 8.9 s in-point was already applied when the montage was built; do not apply it again. Expected result: 191.6 s, 1280×720, 30 fps, H.264/AAC, about −16 LUFS per section.

## How it works

```
Browser (React, Vite)  ──/api──►  FastAPI backend ──► Texel production API (api.prod.texel.ai/v1)
 IndexedDB: scripts                │  uploads, ffprobe checks, job store (SQLite + disk)
                                   └► S3-compatible bucket (optional) ◄── Texel reads inputs / writes output
```

- **Encoder contract:** `POST /video_encoder/encode` with labeled inputs, a trim/scale/pad/fps/tpad filter chain per clip, `concat`, optional `loudnorm`, and a writable output URL; then poll `/video_encoder/status/{job_id}`. H.264 NVENC at 4M, AAC 48 kHz stereo 192k. **AAC `quality: "2"` is required**: if omitted Texel emits an empty `-aq` option and the job fails.
- **No duplicate paid jobs:** a client job ID is saved before submit and the Texel job ID right after. Interrupted jobs are resumed by polling, never resubmitted.
- **Validation:** generated FramePack clips keep a strict 120 s / 100 MiB policy. Assembled cuts are validated against the submitted plan: duration within max(1.5 s, 2%) of planned, audio present when requested, and a size cap scaled to length (100 MiB floor, 4 GiB ceiling).
- **Safety:** SSRF checks on every downloaded URL (public HTTPS only, redirects validated, API key never forwarded). Silent sources are rejected before any paid job when original audio is required.
- **State:** one backend process. Jobs and snapshots are in SQLite plus files under `TEXEL_DATA_DIR`; interrupted work is marked on restart.

More detail, including the Texel SDK generation contract, is in [`showrunner-studio/TEXEL.md`](showrunner-studio/TEXEL.md).

## Verification status

| Area | Evidence | Status |
|---|---|---|
| Texel cloud edit (reorder, trim, loudness, GPU encode) | Real job `254c23d1-8f4b-468a-b1da-41f04d814acd`, 191.6 s, fully decoded and measured | **Verified live**, via a standalone script |
| Editing key authentication | Read-only call returns the expected 404 (403 for a bad key) | Verified live |
| Image generation (keyframes) | One real SDK call returned a valid PNG | Verified live |
| FramePack animation | Two attempts failed at the provider | **Not verified** |
| Upload → Texel → download in this app | Playwright against real UI + backend, with a local S3 stand-in and a simulated encoder; 205 s and 135 s cuts | Verified against stand-ins only |
| Backend tests | 29 pass (`uv run python -m unittest discover -s tests`) | Pass |
| Frontend | Build passes; 3 compiler tests pass; lint has pre-existing warnings | Pass |
| Studio Voice, eye-contact, lip sync | Present in Texel docs | Not tested or exposed |

## Limitations

- Single-user development service: no accounts, no per-user quotas, CORS open. Use `APP_PASSWORD` if you expose it.
- Texel advises at most two concurrent requests; the app has a two-worker pool per process but no account-wide cap across processes.
- A soundtrack **replaces** all clip audio. There is no multi-track mix, ducking or beat alignment.
- No visual timeline scrubber; clips are edited as rows.
- The app does not generate footage, music or voice. Text/music generation isn't in Texel's public production docs.
- Large uploads pass through the host's proxy and may hit its request-size limit.
- Your Texel credit balance can't be read (the billing endpoint is unavailable for this account).

## Hosting it

GitHub stores the code but cannot run it: GitHub Pages serves static files only, and this app needs the Python backend, ffmpeg and a persistent disk.

- **Codespaces:** free for development; a Codespace sleeps when idle and Public port visibility resets on restart.
- **Docker / Render:** `showrunner-studio/Dockerfile` builds the frontend and backend into one container (single origin, password gate); `render.yaml` is a Render Blueprint with a persistent disk. Set `APP_PASSWORD`, the Texel keys and any `TEXEL_S3_*` values as secrets in the host dashboard. Run exactly one instance. The Docker image build and a real deployment have **not** been tested.

## Development and tests

```bash
cd showrunner-studio/backend
uv sync --locked
uv run python -m unittest discover -s tests -v     # 29 tests, no network, no Texel credits

cd ../frontend
npm ci
npm run test:texel      # compiler tests
npm run build           # type-check + production bundle
npm run lint
```

Automated tests never call Texel. The test suite includes AWS's published SigV4 presign vector, a 191.6 s cut that the old validator rejected, and an upload → render → download flow with fake storage and a fake encoder.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `invalid api key` (403) | Re-check the key. In the screenshot-transcribed editing key, a letter **O** and a zero look alike. |
| "Backend setup needed" chip in Edit footage | `TEXEL_EDITING_API_KEY` missing (render won't work) or `TEXEL_S3_*` missing (uploads unavailable; use "I already host my files"). Restart the app after editing `.env`. |
| Page shows 502 in Codespaces | The server stopped or the Codespace slept. Restart it from the terminal (Quick start step 3) and re-check port visibility. |
| Codespace opens in "recovery mode" | The container build failed. Run **Codespaces: View Creation Log**. The setup script is now tolerant of apt/tool install failures. |
| Render finishes on Texel but the app shows "interrupted" | The app couldn't download the result (blocked host, expired or non-video read URL). Provide a working output read URL and use **Resume**. |
| "No audio track" before rendering | A source clip is silent. Turn off original audio or choose a soundtrack. |

## Repository layout

```
showrunner-studio/
  backend/           FastAPI app: Texel client and encoder, uploads, storage, job store, tests
  frontend/          React + TypeScript app (Footage Editor, writers' room, Texel panels)
  TEXEL.md           Detailed integration contracts, hosting and verification notes
  Dockerfile         One-container build (frontend + backend)
.devcontainer/       Codespaces setup (stock image + ffmpeg/uv)
render.yaml          Render Blueprint
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
