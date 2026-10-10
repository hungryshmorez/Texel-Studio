"""HTTPX adapter for the official Texel Python SDK production contracts."""
import base64
import io
import ipaddress
import json
import os
import secrets
import socket
from urllib.parse import urlparse, quote

import httpx
from PIL import Image

MAX_BYTES = 16 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16_000_000


class TexelError(RuntimeError):
    pass


def _read(response: httpx.Response) -> bytes:
    chunks, size = [], 0
    for chunk in response.iter_bytes():
        size += len(chunk)
        if size > MAX_BYTES:
            raise TexelError("Texel image response exceeded the 16 MB limit.")
        chunks.append(chunk)
    return b"".join(chunks)


def _public_https(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise TexelError("Texel returned an unsupported image URL.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise TexelError("Texel returned a non-public image URL.")
    except OSError as exc:
        raise TexelError("Could not resolve Texel's image host.") from exc


def _image_value(value):
    """The SDK returns base64 images. Also accept common image envelopes,
    fail visibly for other shapes, and never reinterpret a job ID as an image.
    """
    if isinstance(value, str):
        return value
    if isinstance(value, list) and value:
        return _image_value(value[0])
    if isinstance(value, dict):
        for key in ("b64_json", "image_base64", "image_url", "url", "images", "image", "output", "data", "result"):
            if key in value:
                result = _image_value(value[key])
                if result:
                    return result
    return None


def decode_image(body: bytes, content_type: str, client: httpx.Client) -> bytes:
    if "json" in content_type:
        try:
            value = _image_value(json.loads(body))
        except (ValueError, TypeError) as exc:
            raise TexelError("Texel returned invalid image JSON.") from exc
        if not value:
            raise TexelError("Texel returned no supported image output. Check SDK endpoint access and the account's response format.")
        if value.startswith("https://"):
            # Validate every redirect and never forward our API Authorization header.
            for _ in range(4):
                _public_https(value)
                with client.stream("GET", value) as response:
                    if response.is_redirect:
                        from urllib.parse import urljoin
                        value = urljoin(value, response.headers.get("location", ""))
                        continue
                    if response.status_code != 200:
                        raise TexelError("Could not download the generated image.")
                    body = _read(response)
                    break
            else:
                raise TexelError("Too many redirects downloading the generated image.")
        else:
            if value.startswith("data:image/"):
                if ";base64," not in value:
                    raise TexelError("Texel returned an unsupported image data URL.")
                value = value.split(";base64,", 1)[1]
            try:
                body = base64.b64decode(value, validate=True)
            except (ValueError, TypeError) as exc:
                raise TexelError("Texel returned an unsupported image value.") from exc
    if len(body) > MAX_BYTES:
        raise TexelError("Generated image exceeded the size limit.")
    try:
        with Image.open(io.BytesIO(body)) as image:
            if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                raise TexelError("Generated image exceeded the pixel limit.")
            image.load()
            output = io.BytesIO()
            image.convert("RGB").save(output, format="PNG")
            return output.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise TexelError("Texel output was not a valid supported image.") from exc


API_BASE = "https://api.prod.texel.ai/v1"
VIDEO_MODEL = {"name": "FramePackI2V_HY_fp8_e4m3fn", "type": "FRAMEPACK_VIDEO", "params": {}}


class TexelJobFailed(TexelError):
    pass


class TexelClient:
    def __init__(self):
        self.key = os.environ.get("TEXEL_API_KEY", "")
        self.model = os.environ.get("TEXEL_IMAGE_MODEL", "juggernautXL_v8Rundiffusion.safetensors")

    def _request(self, endpoint, payload=None, method="POST"):
        if not self.key:
            raise TexelError("Set TEXEL_API_KEY on the backend before generating media.")
        try:
            with httpx.Client(timeout=httpx.Timeout(180, connect=20), follow_redirects=False) as client:
                with client.stream(method, API_BASE + endpoint, headers={"Authorization": f"Bearer {self.key}"}, json=payload) as response:
                    if response.status_code >= 400 or response.is_redirect:
                        raise TexelError(f"Texel returned HTTP {response.status_code}. Check access, credits, and the configured model. No generation retry was sent.")
                    body = _read(response)
                    try:
                        value = json.loads(body)
                    except ValueError as exc:
                        raise TexelError("Texel returned invalid result JSON.") from exc
                    if not isinstance(value, dict):
                        raise TexelError("Texel returned an unsupported result format.")
                    return value
        except httpx.HTTPError as exc:
            raise TexelError("Texel request was interrupted or timed out. It may have been billed. Check your Texel dashboard before manually retrying generation.") from exc

    def generate(self, prompt: str) -> bytes:
        payload = {"model": {"name": self.model, "type": "SDXL"},
                   "request": {"prompt": prompt, "negative_prompt": "text, watermark, blurry, malformed anatomy",
                               "cfg_scale": 7.0, "denoising_strength": 0.75, "steps": 20,
                               "width": 768, "height": 432, "seed": secrets.randbelow(2147483646) + 1},
                   "params": {}, "timeout": 120, "callback": {"url": ""}}
        result = self._request("/sd_server/txt2img", payload)
        with httpx.Client(timeout=60, follow_redirects=False) as client:
            return decode_image(json.dumps(result).encode(), "application/json", client)

    def start_video(self, prompt: str, image: bytes, duration: int) -> dict:
        payload = {"model": VIDEO_MODEL,
                   "request": {"prompt": prompt, "cfg_scale": 3.0, "steps": 30, "width": 768, "height": 432,
                               "length": float(duration), "video_codec": "video/h264-mp4",
                               "seed": secrets.randbelow(2147483646) + 1,
                               "init_images": [base64.b64encode(image).decode()]}}
        result = self._request("/sd_server/img2vid", payload)
        job_id = result.get("id")
        if not isinstance(job_id, str) or not job_id or len(job_id) > 200:
            raise TexelError("Texel returned no valid video job ID. Check the dashboard before generating again.")
        return {"job_id": job_id, "model_type": VIDEO_MODEL["type"]}

    def video_status(self, job_id: str, model_type: str) -> dict:
        if model_type != VIDEO_MODEL["type"]:
            raise TexelError("Unsupported saved Texel video model type.")
        result = self._request(f"/sd_server/status/{quote(job_id, safe='')}/{model_type}", method="GET")
        status = result.get("job_status")
        if status in ("failed", "error") or result.get("error_message"):
            raise TexelJobFailed("Texel reported that this video job failed. Review it in the dashboard before generating again.")
        urls = result.get("signed_output_urls", [])
        if status == "success":
            if not isinstance(urls, list) or not urls or not isinstance(urls[0], str):
                raise TexelError("Texel completed the video job but returned no supported download URL. Check the dashboard or resume this job later.")
            return {"completed": True, "url": urls[0], "progress": 100}
        progress = result.get("progress", 0)
        if not isinstance(progress, (int, float)) or not 0 <= progress <= 100:
            progress = 0
        return {"completed": False, "progress": progress}

    def download_video(self, url: str, path, max_bytes: int = 100 * 1024 * 1024, **validation) -> None:
        # Signed media URLs are untrusted and must never receive our API key.
        temporary = path.with_suffix(".part")
        try:
            with httpx.Client(timeout=httpx.Timeout(120, connect=20), follow_redirects=False) as client:
                for _ in range(4):
                    _public_https(url)
                    with client.stream("GET", url) as response:
                        if response.is_redirect:
                            from urllib.parse import urljoin
                            url = urljoin(url, response.headers.get("location", ""))
                            continue
                        if response.status_code != 200:
                            raise TexelError("Could not download the generated video. Resume this saved job to refresh its URL.")
                        size = 0
                        with temporary.open("wb") as output:
                            for chunk in response.iter_bytes():
                                size += len(chunk)
                                if size > max_bytes:
                                    raise TexelError(f"Generated video exceeded the {max_bytes // (1024 * 1024)} MB limit.")
                                output.write(chunk)
                        from trailer_render import validate_video
                        try:
                            validate_video(temporary, **validation)
                        except ValueError as exc:
                            raise TexelError(str(exc)) from exc
                        temporary.replace(path)
                        return
                raise TexelError("Too many redirects downloading the generated video.")
        except httpx.HTTPError as exc:
            raise TexelError("Video download was interrupted. Resume the saved job without generating again.") from exc
        finally:
            temporary.unlink(missing_ok=True)
