# Texel Studio — Outline to Trailer

The studio now includes two media paths. The SDK generation path compiles one to three scenes into editable keyframe prompts, expands the registered character and set descriptions, saves a shot plan, generates images through Texel, animates approved images through FramePack, and assembles saved clips into a downloadable 720p MP4. An optional uploaded score or voiceover loops to the cut length. Exports include opening and closing title cards. A separate still-image storyboard export remains available.

The current production API path trims and reorders remotely hosted scene clips into a **720p/30 fps cut**, preserves and normalizes their audio, or replaces it with an external soundtrack or Texel Studio Voice enhanced voiceover. It accepts clips from any source, so it does not depend on access to the SDK generation routes. It requires readable input URLs, a signed writable output URL, and a read URL for that same output. The cloud cut contains scene clips only; title cards remain part of local assembly.

The SDK path implements **image and animated clip generation**. Image generation succeeded with the supplied account on October 10, 2026. FramePack animation returned a provider failure without a specific cause; animation is not verified. These endpoints are absent from the current production documentation. FramePack is conditioned on each approved keyframe. It does not generate voice or music, train character identities, or perform visual QC. The existing Script Lab remains available for script critique and revision; it is not an automated rendering gate.

## Run locally

Requirements: Node 22.12+ (or 24+), Python 3.12+, [uv](https://docs.astral.sh/uv/), FFmpeg and ffprobe on PATH.

```bash
cp showrunner-studio/.env.example showrunner-studio/.env
# Set TEXEL_API_KEY for generation and TEXEL_EDITING_API_KEY for cloud editing.
# Leave them unset to prepare plans without spending.
./start.sh
```

Open http://localhost:3001. Import or create a show with scenes, open the Texel tab, choose scenes, prepare and edit prompts, and save a trailer plan. Each **Generate keyframe** sends one image request. Approve each image, review its motion prompt, and use **Animate keyframe** to send one video request. Review the saved clips, optionally attach audio, then assemble an animated trailer and download. You can also export a still-image storyboard before generating video. Generation and export status survive reloads. Saved trailers appear again when their show is selected.

The `.env` file is loaded by the launcher into the backend only. Neither Texel key reaches the browser. `TEXEL_EDITING_API_KEY` is preferred for production encoder requests; `TEXEL_API_KEY` is a compatibility fallback when no separate editing credential is set. Generation always uses `TEXEL_API_KEY`. Keep `.env` private and outside Git. Codespaces loads these names from repository-scoped Codespaces secrets; the local `.env` is not published. This is a private, single-user development studio: keep the backend private. Public hosting must add access control and per-user storage/usage limits before exposing paid generation endpoints. Deploy media jobs in a long-running process with a persistent `TEXEL_DATA_DIR`; the current implementation uses a two-worker thread pool and is not a serverless job queue.

## Production API contract (current documentation)

Authoritative reference: https://api.prod.texel.ai/docs#description/introduction. Its Scalar page loads https://api.prod.texel.ai/docs/openapi.json (checked October 9, 2026). The current public schema documents video encoding/editing, Maxine eye-contact correction, Studio Voice enhancement, lip sync, and usage reporting. It does **not** list text-to-image, image-to-video, music generation, or text-to-speech endpoints. Absence from this schema is not proof the SDK endpoints have been removed, but it is not confirmation of account access either.

In a saved trailer, open **Render clips with Texel’s production API**. Provide one readable HTTPS video URL per selected scene. Use Move up/down to set the cut order, source start to trim the in-point, and length to choose up to 300 seconds per clip. Enable Keep original clip audio only when every clip has an audio stream. Normalize audio targets −16 LUFS with a −2 dBTP ceiling (single-pass FFmpeg loudnorm). A hosted soundtrack replaces clip audio; its source start can skip a silent intro. Provide a signed upload URL and read URL for the same MP4 object. These need to remain valid through queueing, processing, and download. Optional audio must also be hosted; the locally uploaded audio is not automatically published. Enable Studio Voice only for recorded speech. Short cloud audio is padded with silence, not looped.

The backend sends one `POST /v1/video_encoder/encode` with labeled `inputs`, a writable `outputs[0].url`, H.264 NVENC, 30 fps from the UI (24 fps remains available through the API), 4 Mbps, and an FFmpeg filter graph. Each clip is source-trimmed, scaled/padded to 1280×720, normalized to square pixels and the chosen frame rate, held if short, trimmed to its selected duration, reset to time zero, and concatenated in the submitted order. Original audio is trimmed, optionally normalized, padded, and joined in the same order. Optional external audio is source-trimmed and can use `nvafx` with `effect=studio_voice_high_quality`, then loudness normalization, padding/trimming and a final fade. The payload follows the docs’ resize, concat, and voice examples. The standard graph is also executed locally by a test with real mixed-resolution clips and short audio; A live production GPU render has now passed: a 191.6-second, 720p/30 fps cut with reordered sections, two-pass audio normalization, H.264 NVENC and AAC. The AAC request supplies quality=2: omitting it produced an empty -aq option in the provider encoder.

The encoder response uses `job_id` (different from the SDK generator's `id`). Poll `GET /v1/video_encoder/status/{job_id}` until `job_status=success`. The result is at the supplied output location, not an assumed generated download URL. `download_error`, `encode_error`, `upload_error`, and `unknown_error` are terminal failures. A `client_job_id` is persisted before submission; interrupted requests can resume with `GET /v1/video_encoder/status_client_id/{client_job_id}` without another POST, even when the submit response was lost. Finished MP4s are downloaded and validated locally. Signed storage URLs remain in backend storage and are omitted from API snapshots. If the output read link expires, enter a fresh read URL for the same object before resuming; this refreshes download access without another encoding submission.

The docs also provide `/v1/lipsync/run_lipsync` and `/v1/billing/usage`. They are documented capabilities, not currently exposed app features. Usage reporting is not a jam-credit balance check. Live image and animation smoke tests have sent billable requests. Editing-key authentication was accepted (a nonexistent job returned Job not found rather than invalid API key). Production editing job 254c23d1-8f4b-468a-b1da-41f04d814acd completed successfully on October 10, 2026. The downloaded MP4 decoded without errors, contained 5,748 video frames, and matched trailer → music video → episode source frames. Each section measured within 0.04 LUFS of −16. The preceding job failed at encoding because the optional AAC quality field was omitted; the payload now includes the working value. Public readable inputs and a signed writable/readable output location remain required for cloud editing. The live cut used premeasured two-pass loudness parameters; the app’s default normalization remains single pass.

## SDK generation contract

Generation implementation reference: [Texel's official Python SDK](https://github.com/TexelSoftware/texel-sdks/blob/42676c8d42a44cc79463ce4c8f789fd3f8054150/python/texel_api.py), pinned for reference to commit `42676c8`. Its production base URL is `https://api.prod.texel.ai/v1`. The generic Scalar/OpenAPI docs at https://texel.ai/api_docs/ describe a different API surface, including DreamBooth training and inference. A DreamBooth result endpoint is not a video-job result endpoint; this workflow follows the SDK's SD server routes instead.

- Images: `POST /sd_server/txt2img` with Bearer authentication, a model object (`name=juggernautXL_v8Rundiffusion.safetensors`, `type=SDXL`), the SDK's nested request properties, one image, 20 steps, cfg scale 7, and 768×432 dimensions. `TEXEL_IMAGE_MODEL` overrides the model name. The SDK returns `images` as base64 image strings; the adapter validates and saves PNGs.
- Animation: `POST /sd_server/img2vid`, model `FramePackI2V_HY_fp8_e4m3fn` / `FRAMEPACK_VIDEO`, approved PNG as base64 `init_images`, editable motion prompt, planned duration as `length`, 30 steps, cfg scale 3, 768×432, H.264 MP4. The SDK demonstrates the `length` field at one second; the application requests its planned 5–10-second cut. Account support for these lengths must be confirmed by a live smoke test.
- Job results: save the returned `id`, then `GET /sd_server/status/{id}/FRAMEPACK_VIDEO`. `job_status=success` plus `signed_output_urls` completes the job. Processing jobs expose `progress`; failure states are reported without exposing raw provider errors.
- Downloads: signed URLs are fetched without credentials, limited to 100 MB, checked with ffprobe, and saved locally. Assembly normalizes video to 720p/24 fps, trims long outputs, holds the last frame for shorter outputs, removes clip audio, and adds an optional uploaded score/voiceover.

The adapter implements these contracts with HTTPX rather than vendoring the sample SDK. Requests have timeouts and no automatic generation retries; downloads do not inherit the SDK's authenticated session. The image smoke test validated the real base64 response and saved a PNG. Two five-second animation smoke tests failed at the provider, using 768×432 and the SDK default 640×480 dimensions; do not treat the full bible-to-animated-trailer path as verified. Further account/model support and credit availability must be checked with Texel. Automated tests never call Texel or consume credits. Audio generation is not established by the SDK or current public docs; score/voiceover currently comes from an upload or hosted media URL.

## Persistence and retries

SQLite snapshots and generated assets live in `backend/.texel-data/` by default, outside git. A request ID prevents duplicate plan creation, and concurrent generation of the same shot is rejected. Generation calls are never automatically retried. If image generation times out or restarts, inspect Texel billing before explicitly retrying. Video job IDs are persisted before polling; interrupted jobs offer **Resume saved job**, which only checks status and downloads the result. Polling pauses after ten minutes or on a network error. A restart retains the saved ID and allows resuming. If submission is interrupted before the ID is saved, check billing before generating again. Successfully saved images and clips need no new provider calls for reassembly. Regenerating a keyframe clears its clip and approval and invalidates the previous export.

JSON project exports still back up the editor database only. Trailer media and SQLite records are backend-owned; back up the configured data directory separately. Text descriptions are expanded into prompts, not a guarantee of character consistency. One keyframe depicts each selected scene's opening action paragraph. The motion prompt includes scene action and director notes; revise it to keep the intended action within the short clip.

## Checks

```bash
cd showrunner-studio/frontend
npm ci
npm run build
npm run lint
npm run test:texel
cd ../backend
uv sync
uv run python -m unittest discover -s tests -v
```

Tests cover production encoder payloads and statuses, client-ID recovery after an ambiguous submission, signed URL redaction, execution of the standard encoder filter graph, SDK image/video payloads, authenticated job polling, safe downloads, resume without resubmission, clip-based exports, response decoding, approval and retry gates, idempotent plans, restart recovery, protected media paths, optional audio validation, real FFmpeg assembly, MP4 duration/resolution, downloading, and reassembly without another provider call.

## Footage editing with backend-managed storage

`Edit footage` (top bar) creates a media project (`POST /api/texel/edits`). Files are uploaded to the
backend (`POST /trailers/{id}/assets`, up to 1 GB each), probed with ffprobe (duration, audio
presence, resolution), stored in the S3-compatible bucket configured by `TEXEL_S3_*`, and referenced by
asset ID. `POST /trailers/{id}/edit-render` builds the encoder payload server-side: it mints presigned
read URLs for inputs and a presigned write/read pair for the output, then reuses the verified encoder
contract (AAC `quality: "2"`, source in-points, per-clip lengths, single-pass `loudnorm`). Storage
keys and signed URLs stay in the backend store; snapshots contain neither. Resume mints a fresh
output read link, so expired links need no user action. After the cut is downloaded and validated,
the transient output object is deleted; uploaded sources remain until deleted from the project.

Validation policies are separate. Generated FramePack clips keep the 120 s / 100 MiB limits. Assembled
cloud cuts are validated against the submitted plan: duration within max(1.5 s, 2%) of the sum of clip
lengths, an audio stream when audio was requested, and a size cap scaled to the planned duration
(100 MiB floor, 4 GiB ceiling).

Clips up to 12 per edit project (the 3-clip limit applies only to scene-based trailers). Every source
must contain audio when "keep original audio" is on and no soundtrack is chosen; the backend rejects
silent sources before any paid job.

### Bring-your-own hosting (no bucket)

`POST /trailers/{id}/url-render` (UI: "I already host my files" in Edit footage) takes caller-supplied
signed input URLs, an output upload (PUT) URL and an output read URL, and reuses the same encoder
contract and bounded download validation. Lengths are required per clip because remote files cannot be
probed. This mirrors how the verified job `254c23d1-8f4b-468a-b1da-41f04d814acd` (191.6 s, trailer →
music video → episode) was run. The app does not implement storage.to: its share links are HTML pages
and its player URLs are an undocumented implementation detail.

### Verification status

- Automated: 29 backend tests (`uv run python -m unittest discover -s tests`) including AWS's published
  SigV4 presign vector, a 191.6 s cut that the old validator rejected, and an upload → render →
  download service flow with fake storage and a fake encoder.
- Browser (Playwright, real UI + real backend): upload of four files, trailer → music video → episode
  timeline with an 8.9 s song in-point (205 s cut), reload mid-render, completion, preview and
  download, no console errors. **This used a local S3 stand-in and a simulated encoder, not live Texel
  or a real bucket.** A live Texel run through the app still needs bucket credentials reachable by Texel.
- Browser (Playwright): the "I already host my files" panel, with two HTTPS URL clips and a song at 8.9 s, rendered a 135 s cut through the real backend; same caveat — a local HTTPS stand-in and a simulated encoder, not live Texel.
- Not implemented: authentication and per-user quotas (single-user dev service), an account-wide cap
  of two concurrent Texel requests across replicas, multi-track audio mixing.

## Hosting it on a public URL

The backend serves the built frontend (`frontend/dist`) from the same origin and, when `APP_PASSWORD` is
set, requires it (browser login prompt, any username) for everything except `/api/health`.
`TEXEL_REQUIRE_PASSWORD=1` (set in the Dockerfile) refuses to start without it. This is a shared
password, not user accounts or per-user quotas.

`showrunner-studio/Dockerfile` builds both halves into one container; `render.yaml` is a Render Blueprint
(always-on instance plus a persistent disk at `/data`, required because jobs are in SQLite and media is on disk).
Run exactly one instance. Set `APP_PASSWORD`, `TEXEL_EDITING_API_KEY`, `TEXEL_API_KEY` and the `TEXEL_S3_*` values
as secrets in the host's dashboard, never in the repo. Large uploads pass through the host's proxy, so check its request-size limit;
a bucket plus the paste-URL panel avoids that. Verified: password gate and static serving run locally. Not verified: the Docker image build
and any real deployment (no Docker daemon or hosting account in the authoring environment).
