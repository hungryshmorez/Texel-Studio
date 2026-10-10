"""Normalize saved Texel clips or approved stills into a title-card trailer."""
import json
import shutil
import subprocess
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

WIDTH, HEIGHT, FPS = 1280, 720, 24


def _run(args, timeout=90):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("Media processing failed. Check FFmpeg codec support and the supplied media.")
    return result.stdout


def validate_audio(path: Path):
    if not shutil.which("ffprobe"):
        raise RuntimeError("Install FFmpeg and ffprobe to attach audio.")
    result = json.loads(_run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", str(path)], timeout=15))
    if not any(s.get("codec_type") == "audio" for s in result.get("streams", [])):
        raise ValueError("The uploaded file contains no audio stream.")
    duration = float(result.get("format", {}).get("duration", 0))
    if duration <= 0 or duration > 600:
        raise ValueError("Use an audio file between 1 second and 10 minutes long.")


def probe(path: Path) -> dict:
    """ffprobe summary used to validate both generated and user-uploaded media."""
    result = json.loads(_run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", str(path)], timeout=30))
    streams = result.get("streams", [])
    video = [s for s in streams if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic") != 1]
    return {"duration": float(result.get("format", {}).get("duration", 0) or 0), "has_video": bool(video),
            "has_audio": any(s.get("codec_type") == "audio" for s in streams),
            "width": max((int(s.get("width", 0)) for s in video), default=0), "height": max((int(s.get("height", 0)) for s in video), default=0),
            "pixels": max((int(s.get("width", 0)) * int(s.get("height", 0)) for s in video), default=0)}


def validate_video(path: Path, max_seconds: float = 120, expected_seconds: float | None = None, expect_audio: bool = False):
    """Short generated clips keep the 120 s cap. Assembled cloud cuts pass the
    plan's expected duration instead, which bounds the result to that length
    (plus encoder padding tolerance) rather than to an arbitrary constant.
    """
    info = probe(path)
    if expected_seconds is not None:
        tolerance = max(1.5, expected_seconds * 0.02)
        if not info["has_video"] or abs(info["duration"] - expected_seconds) > tolerance:
            raise ValueError("The rendered video does not match the planned length.")
    elif not info["has_video"] or not 0 < info["duration"] <= max_seconds:
        raise ValueError("Generated media is not a supported short video.")
    if info["pixels"] > 16_000_000:
        raise ValueError("Generated video exceeds the pixel limit.")
    if expect_audio and not info["has_audio"]:
        raise ValueError("The rendered video is missing its audio track.")


def _font(size):
    for name in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/Library/Fonts/Arial.ttf", "C:/Windows/Fonts/arial.ttf"):
        if Path(name).is_file():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default(size=size)


def _text(draw, text, xy, size, color, max_width):
    font = _font(size)
    lines = []
    for paragraph in text.splitlines()[:6]:
        current = ""
        for word in textwrap.wrap(paragraph, width=45, break_long_words=True):
            if current and draw.textlength(current + " " + word, font=font) > max_width:
                lines.append(current)
                current = word
            else:
                current = (current + " " + word).strip()
        if current:
            lines.append(current)
    # Also wrap at actual pixel width, including exceptionally long strings.
    fitted = []
    for line in lines:
        current = ""
        for character in line:
            if current and draw.textlength(current + character, font=font) > max_width:
                fitted.append(current)
                current = character
            else:
                current += character
        fitted.append(current)
    draw.multiline_text(xy, "\n".join(fitted[:4]), font=font, fill=color, spacing=12)


def assemble(body, folder: Path, render_id: str) -> Path:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("Install FFmpeg on the backend to export MP4.")
    work = folder / render_id
    work.mkdir()
    frames = []
    animated = body.get("animated", False)
    title = Image.new("RGB", (WIDTH, HEIGHT), "#101014")
    draw = ImageDraw.Draw(title)
    _text(draw, "TEXEL STUDIO", (70, 80), 24, "#f6b84a", 1100)
    _text(draw, body["show_title"], (70, 220), 54, "#ffffff", 1100)
    _text(draw, "TRAILER • TEXEL IMAGE + VIDEO" if animated else "STORYBOARD TRAILER • TEXEL KEYFRAMES", (70, 620), 22, "#b9b9c2", 1100)
    title.save(work / "title.png")
    frames.append((work / "title.png", 2))
    for index, shot in enumerate(body["shots"]):
        if animated:
            frames.append((folder / shot["video_asset"], shot["duration_seconds"]))
            continue
        with Image.open(folder / shot["asset"]) as source:
            frame = ImageOps.fit(source.convert("RGB"), (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS)
        draw = ImageDraw.Draw(frame)
        draw.rectangle((0, HEIGHT - 115, WIDTH, HEIGHT), fill="#101014")
        _text(draw, shot["title"], (45, HEIGHT - 98), 26, "#ffffff", 1180)
        _text(draw, "TEXEL KEYFRAME • STORYBOARD", (45, HEIGHT - 42), 16, "#f6b84a", 1180)
        frame_path = work / f"shot-{index}.png"
        frame.save(frame_path)
        frames.append((frame_path, shot["duration_seconds"]))
    end = Image.new("RGB", (WIDTH, HEIGHT), "#101014")
    _text(ImageDraw.Draw(end), "Directed in Texel Studio\nImages and video generated with Texel" if animated else "Directed in Texel Studio\nKeyframes generated with Texel", (70, 260), 36, "#ffffff", 1100)
    end.save(work / "end.png")
    frames.append((work / "end.png", 2))
    segments = []
    for index, (frame_path, duration) in enumerate(frames):
        segment = work / f"segment-{index}.mp4"
        image = frame_path.suffix == ".png"
        inputs = ["-loop", "1", "-framerate", str(FPS)] if image else ["-protocol_whitelist", "file,pipe"]
        # Rescale mixed provider outputs, normalize timestamps/FPS, and hold the
        # last frame if the provider returned a clip shorter than the planned cut.
        filters = f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FPS},setpts=PTS-STARTPTS"
        if not image:
            filters += f",tpad=stop_mode=clone:stop_duration={duration}"
        _run(["ffmpeg", "-v", "error", "-nostdin", "-y", *inputs, "-i", str(frame_path), "-t", str(duration),
              "-map", "0:v:0", "-vf", filters, "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-threads", "2", str(segment)])
        segments.append(segment)
    manifest = work / "concat.txt"
    # Generated filenames only; no user strings enter FFmpeg filter expressions.
    manifest.write_text("\n".join(f"file '{p.name}'" for p in segments))
    silent = work / "silent.mp4"
    _run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "concat", "-safe", "1", "-i", str(manifest), "-c", "copy", "-movflags", "+faststart", str(silent)])
    output = folder / f"{render_id}.mp4"
    if body.get("audio_asset"):
        duration = sum(d for _, d in frames)
        _run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(silent), "-stream_loop", "-1", "-protocol_whitelist", "file,pipe", "-i", str(folder / body["audio_asset"]),
              "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-af", f"afade=t=out:st={duration-1}:d=1", "-t", str(duration), "-movflags", "+faststart", str(output)])
    else:
        silent.replace(output)
    shutil.rmtree(work)
    return output
