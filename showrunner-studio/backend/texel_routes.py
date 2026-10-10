"""Persisted, reviewable Texel keyframe → storyboard MP4 workflow."""
import mimetypes
import os
import re
import shutil
import time
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

from texel_client import TexelClient, TexelError, TexelJobFailed
from texel_encoder import TexelEncoderClient, encoder_request
from media_storage import ObjectStorage, StorageError
from trailer_render import assemble, probe, validate_audio
from trailer_store import TrailerStore


class ShotPlan(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    scene_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=160)
    prompt: str = Field(min_length=1, max_length=8000)
    duration_seconds: int = Field(default=6, ge=5, le=10)
    motion_prompt: str = Field(default="", max_length=8000)


class TrailerPlan(BaseModel):
    request_id: str = Field(min_length=1, max_length=120)
    show_id: str = Field(min_length=1, max_length=120)
    show_title: str = Field(min_length=1, max_length=160)
    shots: list[ShotPlan] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def unique_shots(self):
        if len({s.id for s in self.shots}) != len(self.shots):
            raise ValueError("Each shot must have a unique ID.")
        if any(not s.prompt.strip() for s in self.shots):
            raise ValueError("Each shot needs a non-empty prompt.")
        return self


class GenerateShot(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)


class AnimateShot(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)


class RenderTrailer(BaseModel):
    animated: bool = False


class CloudClip(BaseModel):
    shot_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    url: str = Field(min_length=1, max_length=8192)
    start_seconds: float = Field(default=0, ge=0, le=7200, allow_inf_nan=False)
    duration_seconds: float | None = Field(default=None, gt=0, le=300, allow_inf_nan=False)


class CloudRender(BaseModel):
    clips: list[CloudClip] = Field(min_length=1, max_length=3)
    output_upload_url: str = Field(min_length=1, max_length=8192)
    output_read_url: str = Field(min_length=1, max_length=8192)
    audio_url: str | None = Field(default=None, max_length=8192)
    enhance_voice: bool = False
    preserve_audio: bool = False
    normalize_audio: bool = False
    audio_start_seconds: float = Field(default=0, ge=0, le=7200, allow_inf_nan=False)
    fps: int = Field(default=24)

    @model_validator(mode="after")
    def valid_fps(self):
        if self.fps not in (24, 30):
            raise ValueError("Choose 24 or 30 fps.")
        return self


EDIT_PROJECT_SHOW = "media-projects"
MAX_UPLOAD = 1024 * 1024 * 1024
MAX_EDIT_CLIPS = 12
ASSET_ID = r"^[a-zA-Z0-9_-]+$"


class EditProject(BaseModel):
    request_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=160)


class EditClip(BaseModel):
    asset_id: str = Field(min_length=1, max_length=80, pattern=ASSET_ID)
    start_seconds: float = Field(default=0, ge=0, le=7200, allow_inf_nan=False)
    duration_seconds: float | None = Field(default=None, gt=0, le=300, allow_inf_nan=False)


class EditRender(BaseModel):
    clips: list[EditClip] = Field(min_length=1, max_length=MAX_EDIT_CLIPS)
    audio_asset_id: str | None = Field(default=None, max_length=80, pattern=ASSET_ID)
    audio_start_seconds: float = Field(default=0, ge=0, le=7200, allow_inf_nan=False)
    enhance_voice: bool = False
    preserve_audio: bool = True
    normalize_audio: bool = True
    fps: int = Field(default=30)

    @model_validator(mode="after")
    def valid_fps(self):
        if self.fps not in (24, 30):
            raise ValueError("Choose 24 or 30 fps.")
        return self


class CloudResume(BaseModel):
    output_read_url: str | None = Field(default=None, min_length=1, max_length=8192)


class ShotApproval(BaseModel):
    approved: bool


class TrailerService:
    def __init__(self, root: Path):
        self.store = TrailerStore(root)
        self.stopping = threading.Event()
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="texel-studio")

    def create(self, plan: TrailerPlan):
        body = {"id": uuid.uuid4().hex, "request_id": plan.request_id, "show_id": plan.show_id,
                "show_title": plan.show_title, "plan": plan.model_dump(), "status": "draft", "error": None,
                "video_asset": None, "audio_asset": None, "audio_name": None, "created_at": time.time(), "updated_at": time.time(),
                "shots": [{**s.model_dump(), "status": "planned", "asset": None, "error": None, "operation_id": None, "video_status": "planned", "video_asset": None,
                           "video_job": None, "video_error": None, "video_progress": 0} for s in plan.shots]}
        return self.store.create(body)

    @staticmethod
    def shot(body, shot_id):
        shot = next((s for s in body["shots"] if s["id"] == shot_id), None)
        if shot is None:
            raise KeyError(shot_id)
        return shot

    @staticmethod
    def editable(body):
        if body["status"] == "rendering" or body.get("cloud_render", {}).get("status") == "running":
            raise ValueError("Wait for the current export to finish.")

    @staticmethod
    def invalidate(body):
        body["status"] = "draft"
        body["video_asset"] = None
        body["error"] = None

    def generate(self, trailer_id, shot_id, prompt):
        if not os.environ.get("TEXEL_API_KEY"):
            raise ValueError("Set TEXEL_API_KEY on the backend before generating keyframes.")
        if not prompt.strip():
            raise ValueError("Enter a non-empty keyframe prompt.")
        operation = uuid.uuid4().hex
        def start(body):
            self.editable(body)
            shot = self.shot(body, shot_id)
            if shot["status"] == "generating" or shot.get("video_status") == "generating":
                raise ValueError("This shot is already generating; no second request was sent.")
            shot.update(status="generating", prompt=prompt, error=None, asset=None, operation_id=operation, video_status="planned", video_asset=None, video_job=None, video_error=None, video_progress=0)
            self.invalidate(body)
        body = self.store.mutate(trailer_id, start)
        self.executor.submit(self._generate, trailer_id, shot_id, prompt, operation)
        return body

    def _generate(self, trailer_id, shot_id, prompt, operation):
        try:
            image = TexelClient().generate(prompt)
            folder = self.store.root / trailer_id
            folder.mkdir(exist_ok=True)
            filename = f"keyframe-{operation}.png"
            (folder / filename).write_bytes(image)
            def finish(body):
                shot = self.shot(body, shot_id)
                if shot["operation_id"] == operation:
                    shot.update(status="ready", asset=filename, error=None)
            self.store.mutate(trailer_id, finish)
        except Exception as exc:
            # Provider output and secrets are never returned as raw error bodies.
            message = str(exc) if isinstance(exc, TexelError) else "Keyframe generation failed while saving the result. Check Texel before retrying."
            def fail(body):
                shot = self.shot(body, shot_id)
                if shot["operation_id"] == operation:
                    shot.update(status="error", error=message)
            self.store.mutate(trailer_id, fail)

    def animate(self, trailer_id, shot_id, prompt, resume=False):
        if not os.environ.get("TEXEL_API_KEY"):
            raise ValueError("Set TEXEL_API_KEY on the backend before generating media.")
        if not shutil.which("ffprobe"):
            raise ValueError("Install ffprobe on the backend before generating clips.")
        if not prompt.strip() and not resume:
            raise ValueError("Enter a motion prompt before generating a clip.")
        operation = uuid.uuid4().hex
        def start(body):
            self.editable(body)
            shot = self.shot(body, shot_id)
            if shot["status"] != "approved" or not shot["asset"]:
                raise ValueError("Approve this keyframe before animating it.")
            if shot.get("video_status") == "generating":
                raise ValueError("This clip is already generating; no second request was sent.")
            if resume and (not shot.get("video_job") or shot.get("video_status") != "interrupted"):
                raise ValueError("There is no interrupted video job to resume.")
            if not resume:
                shot.update(video_job=None, motion_prompt=prompt, video_progress=0)
            shot.update(video_status="generating", video_asset=None, video_error=None, video_operation_id=operation)
            self.invalidate(body)
        body = self.store.mutate(trailer_id, start)
        self.executor.submit(self._animate, trailer_id, shot_id, operation)
        return body

    def _animate(self, trailer_id, shot_id, operation):
        try:
            client = TexelClient()
            shot = self.shot(self.store.get(trailer_id), shot_id)
            job = shot.get("video_job")
            folder = self.store.root / trailer_id
            if not job:
                job = client.start_video(shot["motion_prompt"], (folder / shot["asset"]).read_bytes(), shot["duration_seconds"])
                # Save the provider ID before polling or downloading. Resume only GETs.
                self.store.mutate(trailer_id, lambda b: self.shot(b, shot_id).update(video_job=job))
            deadline = time.monotonic() + 600
            while not self.stopping.is_set() and time.monotonic() < deadline:
                status = client.video_status(job["job_id"], job["model_type"])
                self.store.mutate(trailer_id, lambda b: self.shot(b, shot_id).update(video_progress=status["progress"]))
                if status["completed"]:
                    filename = f"clip-{operation}.mp4"
                    client.download_video(status["url"], folder / filename)
                    self.store.mutate(trailer_id, lambda b: self.shot(b, shot_id).update(video_status="ready", video_asset=filename, video_error=None))
                    return
                self.stopping.wait(5)
            raise TexelError("Polling paused. Resume the saved job to check it again without another generation charge.")
        except Exception as exc:
            message = str(exc) if isinstance(exc, TexelError) else "Clip processing failed. Resume the saved job before generating again."
            def fail(body):
                shot = self.shot(body, shot_id)
                if shot.get("video_operation_id") == operation:
                    resumable = bool(shot.get("video_job")) and not isinstance(exc, TexelJobFailed)
                    shot.update(video_status="interrupted" if resumable else "error", video_error=message)
            self.store.mutate(trailer_id, fail)

    def approve(self, trailer_id, shot_id, approved):
        def change(body):
            self.editable(body)
            shot = self.shot(body, shot_id)
            if shot.get("video_status") == "generating":
                raise ValueError("Wait for clip generation before changing keyframe approval.")
            if shot["status"] not in ("ready", "approved") or not shot["asset"]:
                raise ValueError("Generate a valid keyframe before approving it.")
            shot["status"] = "approved" if approved else "ready"
            self.invalidate(body)
        return self.store.mutate(trailer_id, change)

    def render(self, trailer_id, animated=False):
        if not shutil.which("ffmpeg"):
            raise ValueError("Install FFmpeg on the backend to export MP4.")
        render_id = uuid.uuid4().hex
        def start(body):
            self.editable(body)
            if body.get("mode") == "edit":
                raise ValueError("Footage-editing projects render through Texel cloud editing.")
            if not all(s["status"] == "approved" and s["asset"] for s in body["shots"]):
                raise ValueError("Approve every keyframe before assembling the trailer.")
            if any(s.get("video_status") == "generating" for s in body["shots"]):
                raise ValueError("Wait for clip generation before assembling the trailer.")
            if animated and not all(s.get("video_status") == "ready" and s.get("video_asset") for s in body["shots"]):
                raise ValueError("Generate every scene clip before assembling an animated trailer.")
            body.update(status="rendering", error=None, video_asset=None, render_id=render_id, animated=animated)
        body = self.store.mutate(trailer_id, start)
        self.executor.submit(self._render, body, render_id)
        return body

    def _render(self, body, render_id):
        try:
            path = assemble(body, self.store.root / body["id"], render_id)
            self.store.mutate(body["id"], lambda b: b.update(status="complete", video_asset=path.name, error=None))
        except Exception:
            self.store.mutate(body["id"], lambda b: b.update(status="error", error="MP4 export failed. Check FFmpeg and the attached audio, then assemble again. Your approved keyframes are saved."))

    @staticmethod
    def storage():
        storage = ObjectStorage.from_env()
        if storage is None:
            raise ValueError("Set TEXEL_S3_ENDPOINT, TEXEL_S3_BUCKET, TEXEL_S3_ACCESS_KEY_ID and TEXEL_S3_SECRET_ACCESS_KEY on the backend to enable media uploads.")
        return storage

    def create_edit(self, req: EditProject):
        body = {"id": uuid.uuid4().hex, "request_id": req.request_id, "show_id": EDIT_PROJECT_SHOW, "show_title": req.title,
                "plan": {"kind": "edit", "title": req.title}, "mode": "edit", "status": "draft", "error": None, "video_asset": None,
                "audio_asset": None, "audio_name": None, "assets": [], "shots": [], "created_at": time.time(), "updated_at": time.time()}
        return self.store.create(body)

    def add_asset(self, trailer_id, source: Path, name):
        body = self.store.get(trailer_id)
        if body.get("mode") != "edit":
            raise ValueError("Media uploads belong to footage-editing projects.")
        self.editable(body)
        storage = self.storage()
        try:
            info = probe(source)
        except (RuntimeError, ValueError, OSError):
            raise ValueError("That file could not be read as video or audio.")
        if not info["has_video"] and not info["has_audio"]:
            raise ValueError("That file contains no video or audio.")
        if info["duration"] <= 0 or info["pixels"] > 16_000_000:
            raise ValueError("Use media with a known length and a resolution up to 16 megapixels.")
        asset_id = uuid.uuid4().hex[:16]
        suffix = re.sub(r"[^a-z0-9]", "", Path(name).suffix.lower())[:6]
        key = storage.key(trailer_id, f"{asset_id}.{suffix or 'bin'}")
        storage.upload_file(source, key, mimetypes.guess_type(name)[0] or "application/octet-stream")
        asset = {"id": asset_id, "name": name, "kind": "video" if info["has_video"] else "audio", "key": key, "size": source.stat().st_size,
                 **{k: info[k] for k in ("duration", "has_audio", "width", "height")}}
        self.store.mutate(trailer_id, lambda b: (b["assets"].append(asset), self.invalidate(b)))
        return self.store.get(trailer_id)

    def remove_asset(self, trailer_id, asset_id):
        def change(body):
            self.editable(body)
            asset = next((a for a in body.get("assets", []) if a["id"] == asset_id), None)
            if asset is None:
                raise KeyError(asset_id)
            body["assets"].remove(asset)
            return asset
        holder = {}
        body = self.store.mutate(trailer_id, lambda b: holder.setdefault("asset", change(b)))
        self.storage().delete(holder["asset"]["key"])
        return body

    def edit_render(self, trailer_id, req: EditRender):
        body = self.store.get(trailer_id)
        if body.get("mode") != "edit":
            raise ValueError("Cloud editing from uploads needs a footage-editing project.")
        storage = self.storage()
        assets = {a["id"]: a for a in body.get("assets", [])}
        clips, shots = [], []
        for index, clip in enumerate(req.clips):
            asset = assets.get(clip.asset_id)
            if asset is None or asset["kind"] != "video":
                raise ValueError(f"Clip {index + 1} needs an uploaded video.")
            remaining = asset["duration"] - clip.start_seconds
            if remaining <= 0.1:
                raise ValueError(f"Clip {index + 1} starts after the end of {asset['name']}.")
            duration = round(min(clip.duration_seconds or remaining, 300), 3)
            if clip.duration_seconds is None and remaining > 300:
                raise ValueError(f"{asset['name']} has more than 300 seconds after the in-point; set a duration.")
            if req.preserve_audio and not req.audio_asset_id and not asset["has_audio"]:
                raise ValueError(f"{asset['name']} has no audio track. Turn off original audio or choose a soundtrack.")
            shots.append({"id": f"c{index}", "duration_seconds": duration})
            clips.append({"shot_id": f"c{index}", "url": storage.read_url(asset["key"]), "start_seconds": clip.start_seconds, "duration_seconds": duration})
        audio_url = None
        if req.audio_asset_id:
            sound = assets.get(req.audio_asset_id)
            if sound is None or not sound["has_audio"]:
                raise ValueError("Choose an uploaded file that contains audio for the soundtrack.")
            audio_url = storage.read_url(sound["key"])
        output_key = storage.key(trailer_id, f"output-{uuid.uuid4().hex}.mp4")
        plan = {"clips": clips, "output_key": output_key, "output_upload_url": storage.write_url(output_key), "output_read_url": storage.read_url(output_key),
                "audio_url": audio_url, "audio_start_seconds": req.audio_start_seconds, "enhance_voice": req.enhance_voice,
                "preserve_audio": req.preserve_audio, "normalize_audio": req.normalize_audio, "fps": req.fps}
        return self.cloud_render(trailer_id, plan, shots=shots)

    def cloud_render(self, trailer_id, plan=None, resume=False, shots=None):
        if not (os.environ.get("TEXEL_EDITING_API_KEY") or os.environ.get("TEXEL_API_KEY")):
            raise ValueError("Set TEXEL_EDITING_API_KEY on the backend before rendering with Texel.")
        if not shutil.which("ffprobe"):
            raise ValueError("Install ffprobe to validate the finished cut.")
        operation = uuid.uuid4().hex
        # Build and validate before storing or submitting any paid job.
        shots = shots if shots is not None else self.store.get(trailer_id)["shots"]
        payload = None if resume else encoder_request(shots, plan, operation)
        expected = None if resume else sum(c.get("duration_seconds") or next(s["duration_seconds"] for s in shots if s["id"] == c["shot_id"]) for c in plan["clips"])
        def start(body):
            self.editable(body)
            if any(s["status"] == "generating" or s.get("video_status") == "generating" for s in body["shots"]):
                raise ValueError("Wait for current shot generation before cloud rendering.")
            if resume:
                if body.get("cloud_render", {}).get("status") != "interrupted":
                    raise ValueError("There is no interrupted cloud render to resume.")
                saved_plan = body["cloud_render"]["plan"]
                if saved_plan.get("output_key"):
                    # Backend-managed output: mint a fresh read link instead of asking for one.
                    saved_plan["output_read_url"] = self.storage().read_url(saved_plan["output_key"])
                elif plan and plan.get("output_read_url"):
                    from texel_client import _public_https
                    try:
                        _public_https(plan["output_read_url"])
                    except TexelError as exc:
                        raise ValueError("Use a public HTTPS read URL for the saved output.") from exc
                    body["cloud_render"]["plan"]["output_read_url"] = plan["output_read_url"]
                body["cloud_render"].update(status="running", error=None)
            else:
                body["cloud_render"] = {"client_id": operation, "job_id": None, "status": "running", "progress": 0, "error": None,
                                        "plan": plan, "payload": payload, "expected_seconds": expected,
                                        "expect_audio": "audio" in payload["outputs"][0]["streams"]}
            self.invalidate(body)
        body = self.store.mutate(trailer_id, start)
        self.executor.submit(self._cloud_render, trailer_id, resume)
        return body

    def _cloud_render(self, trailer_id, resume):
        try:
            client = TexelEncoderClient()
            saved = self.store.get(trailer_id)["cloud_render"]
            job_id = saved["job_id"]
            if not resume:
                job_id = client.submit(saved["payload"])
                self.store.mutate(trailer_id, lambda b: b["cloud_render"].update(job_id=job_id))
            expected = saved.get("expected_seconds")
            deadline = time.monotonic() + max(600, (expected or 0) * 2)
            while not self.stopping.is_set() and time.monotonic() < deadline:
                state = client.status(job_id, saved["client_id"])
                self.store.mutate(trailer_id, lambda b: b["cloud_render"].update(progress=state["progress"]))
                if state["completed"]:
                    folder = self.store.root / trailer_id
                    folder.mkdir(exist_ok=True)
                    filename = f"cloud-{uuid.uuid4().hex}.mp4"
                    # Assembled cuts are bounded by the plan, not the 120 s generated-clip cap.
                    # Allow roughly 3x the requested 4 Mbps video plus audio, with a floor of 100 MiB.
                    limit = min(4 * 1024 ** 3, max(100 * 1024 ** 2, int((expected or 0) * 1_500_000) + 64 * 1024 ** 2))
                    saved = self.store.get(trailer_id)["cloud_render"]
                    client.download_video(saved["plan"]["output_read_url"], folder / filename, max_bytes=limit,
                                          expected_seconds=expected, expect_audio=saved.get("expect_audio", False))
                    if saved["plan"].get("output_key"):
                        self.storage().delete(saved["plan"]["output_key"])
                    def finish(body):
                        body.update(status="complete", animated=True, video_asset=filename, error=None)
                        body["cloud_render"].update(status="complete", progress=100, error=None)
                    self.store.mutate(trailer_id, finish)
                    return
                self.stopping.wait(5)
            raise TexelError("Polling paused. Resume the saved cloud job without submitting again.")
        except Exception as exc:
            message = str(exc) if isinstance(exc, TexelError) else "Cloud rendering could not finish. Resume the saved job before submitting again."
            self.store.mutate(trailer_id, lambda b: b["cloud_render"].update(status="error" if isinstance(exc, TexelJobFailed) else "interrupted", error=message))

    def attach_audio(self, trailer_id, data, name):
        self.editable(self.store.get(trailer_id))
        folder = self.store.root / trailer_id
        folder.mkdir(exist_ok=True)
        filename = f"audio-{uuid.uuid4().hex}.bin"
        path = folder / filename
        path.write_bytes(data)
        try:
            validate_audio(path)
            def change(body):
                self.editable(body)
                self.invalidate(body)
                body.update(audio_asset=filename, audio_name=name)
            return self.store.mutate(trailer_id, change)
        except Exception:
            path.unlink(missing_ok=True)
            raise

    def remove_audio(self, trailer_id):
        def change(body):
            self.editable(body)
            self.invalidate(body)
            body.update(audio_asset=None, audio_name=None)
        return self.store.mutate(trailer_id, change)


_service = None


def service():
    global _service
    if _service is None:
        root = Path(os.environ.get("TEXEL_DATA_DIR", str(Path(__file__).parent / ".texel-data"))).resolve()
        _service = TrailerService(root)
    return _service


@asynccontextmanager
async def lifespan(_app):
    service().store.recover()
    yield
    service().stopping.set()
    service().executor.shutdown(wait=True)


router = APIRouter(prefix="/api/texel", tags=["Texel trailers"], lifespan=lifespan)


def _call(fn, *args):
    try:
        return fn(*args)
    except KeyError:
        raise HTTPException(404, "Trailer or shot not found.")
    except ValueError as exc:
        raise HTTPException(409, str(exc))


def public_body(body):
    def media(asset):
        return f"/api/texel/trailers/{body['id']}/media/{asset}" if asset else None
    # Signed upload/download URLs are stored privately, never echoed in snapshots.
    cloud = body.get("cloud_render")
    public = {k: v for k, v in body.items() if k != "cloud_render"}
    public["assets"] = [{k: v for k, v in a.items() if k != "key"} for a in body.get("assets", [])]
    return {**public, "cloud_render": {k: cloud[k] for k in ("client_id", "job_id", "status", "progress", "error")} if cloud else None,
            "video_url": media(body["video_asset"]),
            "shots": [{**s, "image_url": media(s["asset"]), "clip_url": media(s.get("video_asset"))} for s in body["shots"]]}


@router.get("/capabilities")
def capabilities():
    return {"configured": bool(os.environ.get("TEXEL_API_KEY")), "image_model": os.environ.get("TEXEL_IMAGE_MODEL", "juggernautXL_v8Rundiffusion.safetensors"),
            "cloud_configured": bool(os.environ.get("TEXEL_EDITING_API_KEY") or os.environ.get("TEXEL_API_KEY")),
            "ffmpeg_available": bool(shutil.which("ffmpeg")), "audio_available": bool(shutil.which("ffprobe")),
            "video_model": "FramePack (SDK; access unverified)", "generation_source": "sdk_unverified",
            "cloud_render_available": bool(shutil.which("ffprobe")), "voice_enhancement": True, "mode": "trailer", "max_shots": 3, "storage_configured": ObjectStorage.from_env() is not None, "max_edit_clips": MAX_EDIT_CLIPS, "video_generation": bool(shutil.which("ffprobe")), "audio_generation": False}


@router.post("/trailers", status_code=201)
def create(plan: TrailerPlan):
    return public_body(_call(service().create, plan))


@router.get("/trailers")
def list_trailers(show_id: str):
    return [public_body(b) for b in service().store.list(show_id)]


@router.get("/trailers/{trailer_id}")
def get(trailer_id: str):
    return public_body(_call(service().store.get, trailer_id))


@router.post("/trailers/{trailer_id}/shots/{shot_id}/generate", status_code=202)
def generate(trailer_id: str, shot_id: str, req: GenerateShot):
    return public_body(_call(service().generate, trailer_id, shot_id, req.prompt))


@router.post("/trailers/{trailer_id}/shots/{shot_id}/animate", status_code=202)
def animate(trailer_id: str, shot_id: str, req: AnimateShot):
    return public_body(_call(service().animate, trailer_id, shot_id, req.prompt))


@router.post("/trailers/{trailer_id}/shots/{shot_id}/resume", status_code=202)
def resume(trailer_id: str, shot_id: str):
    return public_body(_call(service().animate, trailer_id, shot_id, "", True))


@router.post("/trailers/{trailer_id}/shots/{shot_id}/approval")
def approve(trailer_id: str, shot_id: str, req: ShotApproval):
    return public_body(_call(service().approve, trailer_id, shot_id, req.approved))


@router.post("/trailers/{trailer_id}/render", status_code=202)
def render(trailer_id: str, req: RenderTrailer = RenderTrailer()):
    return public_body(_call(service().render, trailer_id, req.animated))


@router.post("/trailers/{trailer_id}/cloud-render", status_code=202)
def cloud_render(trailer_id: str, req: CloudRender):
    return public_body(_call(service().cloud_render, trailer_id, req.model_dump()))


@router.post("/trailers/{trailer_id}/cloud-render/resume", status_code=202)
def cloud_resume(trailer_id: str, req: CloudResume = CloudResume()):
    return public_body(_call(service().cloud_render, trailer_id, req.model_dump(exclude_none=True), True))


@router.post("/edits", status_code=201)
def create_edit(req: EditProject):
    return public_body(_call(service().create_edit, req))


@router.post("/trailers/{trailer_id}/assets", status_code=201)
def upload_asset(trailer_id: str, file: UploadFile = File(...)):
    _call(service().store.get, trailer_id)
    folder = service().store.root / trailer_id
    folder.mkdir(exist_ok=True)
    temporary = folder / f"upload-{uuid.uuid4().hex}.part"
    try:
        size = 0
        with temporary.open("wb") as output:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, "Use a file under 1 GB.")
                output.write(chunk)
        if size == 0:
            raise HTTPException(413, "That file is empty.")
        try:
            return public_body(_call(service().add_asset, trailer_id, temporary, (file.filename or "Media")[:160]))
        except StorageError as exc:
            raise HTTPException(502, str(exc))
    finally:
        file.file.close()
        temporary.unlink(missing_ok=True)


@router.delete("/trailers/{trailer_id}/assets/{asset_id}")
def delete_asset(trailer_id: str, asset_id: str):
    return public_body(_call(service().remove_asset, trailer_id, asset_id))


@router.post("/trailers/{trailer_id}/edit-render", status_code=202)
def edit_render(trailer_id: str, req: EditRender):
    try:
        return public_body(_call(service().edit_render, trailer_id, req))
    except StorageError as exc:
        raise HTTPException(502, str(exc))


@router.post("/trailers/{trailer_id}/audio")
async def audio(trailer_id: str, file: UploadFile = File(...)):
    try:
        data = await file.read(20 * 1024 * 1024 + 1)
    finally:
        await file.close()
    if not data or len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "Use a non-empty audio file under 20 MB.")
    try:
        return public_body(_call(service().attach_audio, trailer_id, data, (file.filename or "Audio")[:160]))
    except RuntimeError as exc:
        raise HTTPException(422, str(exc))


@router.delete("/trailers/{trailer_id}/audio")
def remove_audio(trailer_id: str):
    return public_body(_call(service().remove_audio, trailer_id))


@router.get("/trailers/{trailer_id}/media/{filename}")
def media(trailer_id: str, filename: str, download: bool = False):
    body = _call(service().store.get, trailer_id)
    allowed = {s["asset"] for s in body["shots"]} | {s.get("video_asset") for s in body["shots"]} | {body["video_asset"]}
    if filename not in allowed or not (service().store.root / trailer_id / filename).is_file():
        raise HTTPException(404, "Media not found.")
    return FileResponse(service().store.root / trailer_id / filename,
                        media_type="video/mp4" if filename.endswith(".mp4") else "image/png",
                        filename="trailer.mp4" if body.get("animated") and download and filename.endswith(".mp4") else "storyboard-trailer.mp4" if download and filename.endswith(".mp4") else None)
