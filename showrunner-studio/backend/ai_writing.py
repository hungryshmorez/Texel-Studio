"""Prompt builders and strict output parsers for Showwriter's AI assist.

Three jobs, all writing words that Mago Studio later turns into pictures:
  shot list   one scene -> shot rows (camera, picture, spoken words, storyboard and video prompts)
  prompts     fill the missing storyboard/video prompts of an existing shot list
  continuity  check scenes against the show bible and report contradictions

Everything here is pure: no network, no globals. main.py supplies the model call, so these
functions are tested directly with canned model replies.
"""
import json
import re

from pydantic import BaseModel, Field

MAX_SHOTS = 30
MIN_SECONDS, MAX_SECONDS, DEFAULT_SECONDS = 1.0, 15.0, 3.0


class ShowInfo(BaseModel):
    title: str = Field(default="", max_length=200)
    genre: str = Field(default="", max_length=120)
    premise: str = Field(default="", max_length=6000)
    logline: str = Field(default="", max_length=600)
    visual_style: str = Field(default="", max_length=1500)


class CharacterInfo(BaseModel):
    name: str = Field(max_length=80)
    visual: str = Field(default="", max_length=1500)
    wardrobe: str = Field(default="", max_length=600)
    features: str = Field(default="", max_length=600)
    voice: str = Field(default="", max_length=600)


class SetInfo(BaseModel):
    name: str = Field(max_length=80)
    description: str = Field(default="", max_length=1500)
    look: str = Field(default="", max_length=600)


class DialogueInfo(BaseModel):
    speaker: str = Field(max_length=80)
    parenthetical: str = Field(default="", max_length=200)
    text: str = Field(max_length=2000)


class SceneInfo(BaseModel):
    name: str = Field(max_length=200)
    heading: str = Field(default="", max_length=200)
    action: str = Field(default="", max_length=12000)
    dialogue: list[DialogueInfo] = Field(default_factory=list, max_length=200)
    set_name: str = Field(default="", max_length=80)


class ShotInfo(BaseModel):
    number: int = Field(ge=1, le=MAX_SHOTS * 2)
    duration_seconds: float = Field(default=DEFAULT_SECONDS, gt=0, le=60)
    framing: str = Field(default="", max_length=120)
    movement: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=2000)
    dialogue: str = Field(default="", max_length=2000)
    cast: list[str] = Field(default_factory=list, max_length=12)
    storyboard_prompt: str = Field(default="", max_length=2000)
    video_prompt: str = Field(default="", max_length=3000)


class ShotListRequest(BaseModel):
    show: ShowInfo
    scene: SceneInfo
    characters: list[CharacterInfo] = Field(default_factory=list, max_length=40)
    sets: list[SetInfo] = Field(default_factory=list, max_length=40)
    target_seconds: float | None = Field(default=None, gt=0, le=600)


class ShotPromptsRequest(BaseModel):
    show: ShowInfo
    scene: SceneInfo
    characters: list[CharacterInfo] = Field(default_factory=list, max_length=40)
    sets: list[SetInfo] = Field(default_factory=list, max_length=40)
    shots: list[ShotInfo] = Field(min_length=1, max_length=MAX_SHOTS)


class ContinuityRequest(BaseModel):
    show: ShowInfo
    characters: list[CharacterInfo] = Field(default_factory=list, max_length=60)
    sets: list[SetInfo] = Field(default_factory=list, max_length=60)
    scenes: list[SceneInfo] = Field(min_length=1, max_length=40)


# --- Prompt text ---------------------------------------------------------------

STYLE_RULE = (
    "The show's visual style is applied separately by the video tool, so never describe the art style, "
    "film stock, colour grade or lighting treatment in any prompt. Describe only content: who, where, what "
    "happens, framing and movement."
)

SHOT_LIST_SYSTEM = f"""You are a script supervisor and storyboard writer. Break ONE screenplay scene into a shot list.

Rules:
- Cover everything in the scene's action, in order. Do not add story events that are not there.
- Spoken words are copied VERBATIM from the scene's dialogue. Never invent, reword or merge lines. Every line appears in exactly one shot, in order. Put only the words spoken during that shot in "dialogue", prefixed with the speaker, like: NAME: line.
- Use only the cast names provided. List who is visible in each shot in "cast".
- Each shot is {MIN_SECONDS:g}-{MAX_SECONDS:g} seconds. Allow about 2.5 spoken words per second.
- "framing" is a short shot size (Wide, Medium, Close-up, Over the shoulder, Insert...). "movement" is a short camera move (Static, Slow push-in, Tracking...).
- "description" says what the camera sees, concretely. "storyboard_prompt" is a one or two sentence description for a rough black-marker sketch of the composition. "video_prompt" is the instruction for the video generator: the action, the camera, and the performance.
- {STYLE_RULE}

Reply with JSON only, no commentary and no code fence:
{{"shots": [{{"duration_seconds": 4, "framing": "Wide", "movement": "Slow push-in", "description": "...", "dialogue": "", "cast": ["Name"], "storyboard_prompt": "...", "video_prompt": "..."}}]}}"""

SHOT_PROMPTS_SYSTEM = f"""You are a storyboard writer. Below is a scene's shot list. For each shot, write the missing storyboard and video prompts.

Rules:
- Stay faithful to the shot's description, framing, movement, cast and dialogue. Do not change them or invent new events.
- "storyboard_prompt": one or two sentences describing the composition for a rough black-marker sketch.
- "video_prompt": the instruction for the video generator: action, camera and performance, including who is speaking.
- Use each character's described appearance when they are in the shot.
- {STYLE_RULE}

Reply with JSON only, no commentary and no code fence:
{{"prompts": [{{"number": 1, "storyboard_prompt": "...", "video_prompt": "..."}}]}}"""

CONTINUITY_SYSTEM = """You are a continuity supervisor. Compare the scenes with the show bible and report real contradictions only.

Look for: a character's looks, wardrobe or voice that contradicts their description; a location that contradicts its description; a character present without being introduced or acting after they could not; objects or injuries that appear or vanish; timeline mistakes; dialogue that breaks a character's described voice.

Do not give opinions about quality, style or pacing. If you are unsure, leave it out. Report at most 15 notes, most serious first.

Reply with JSON only, no commentary and no code fence:
{"notes": [{"severity": "error" | "warn" | "info", "scene": "scene name", "message": "what contradicts what"}]}"""


def _show_block(show: ShowInfo) -> str:
    lines = [f"SHOW: {show.title or 'Untitled'}"]
    for label, value in (("GENRE", show.genre), ("LOGLINE", show.logline), ("WORLD", show.premise), ("VISUAL STYLE (applied separately)", show.visual_style)):
        if value.strip():
            lines.append(f"{label}: {value.strip()}")
    return "\n".join(lines)


def _character_block(characters: list[CharacterInfo]) -> str:
    if not characters:
        return "CAST: none registered."
    rows = []
    for c in characters:
        parts = [p for p in (c.visual.strip(), f"Wardrobe: {c.wardrobe.strip()}" if c.wardrobe.strip() else "", f"Distinctive: {c.features.strip()}" if c.features.strip() else "", f"Voice: {c.voice.strip()}" if c.voice.strip() else "") if p]
        rows.append(f"- {c.name}: {' '.join(parts) or '(no description)'}")
    return "CAST\n" + "\n".join(rows)


def _set_block(sets: list[SetInfo]) -> str:
    if not sets:
        return ""
    rows = [f"- {s.name}: {' '.join(p for p in (s.description.strip(), f'Look: {s.look.strip()}' if s.look.strip() else '') if p) or '(no description)'}" for s in sets]
    return "LOCATIONS\n" + "\n".join(rows)


def _scene_block(scene: SceneInfo) -> str:
    lines = [f"SCENE: {scene.name}"]
    if scene.heading.strip():
        lines.append(f"HEADING: {scene.heading.strip()}")
    lines += ["ACTION:", scene.action.strip() or "(none)", "DIALOGUE:"]
    if scene.dialogue:
        for index, d in enumerate(scene.dialogue, 1):
            paren = f" ({d.parenthetical.strip()})" if d.parenthetical.strip() else ""
            lines.append(f"{index}. {d.speaker.upper()}{paren}: {d.text.strip()}")
    else:
        lines.append("(none)")
    return "\n".join(lines)


def build_shot_list_prompt(req: ShotListRequest) -> list[str]:
    target = f"\nTARGET LENGTH: about {req.target_seconds:g} seconds in total." if req.target_seconds else ""
    body = "\n\n".join(part for part in (_show_block(req.show), _character_block(req.characters), _set_block(req.sets), _scene_block(req.scene)) if part)
    return [SHOT_LIST_SYSTEM, body + target]


def build_shot_prompts_prompt(req: ShotPromptsRequest) -> list[str]:
    shots = []
    for s in req.shots:
        shots.append(
            f"SHOT {s.number} ({s.duration_seconds:g}s) framing={s.framing or '-'}; movement={s.movement or '-'}; "
            f"cast={', '.join(s.cast) or '-'}\n  sees: {s.description or '-'}\n  dialogue: {s.dialogue or '-'}\n"
            f"  storyboard_prompt: {s.storyboard_prompt or '(missing)'}\n  video_prompt: {s.video_prompt or '(missing)'}"
        )
    body = "\n\n".join(part for part in (_show_block(req.show), _character_block(req.characters), _set_block(req.sets), _scene_block(req.scene), "SHOT LIST\n" + "\n".join(shots)) if part)
    return [SHOT_PROMPTS_SYSTEM, body]


def build_continuity_prompt(req: ContinuityRequest) -> list[str]:
    scenes = "\n\n".join(_scene_block(scene) + (f"\nLOCATION: {scene.set_name}" if scene.set_name else "") for scene in req.scenes)
    body = "\n\n".join(part for part in (_show_block(req.show), _character_block(req.characters), _set_block(req.sets), "SCENES\n\n" + scenes) if part)
    return [CONTINUITY_SYSTEM, body]


# --- Output parsing --------------------------------------------------------------


class AiOutputError(ValueError):
    """The model's reply was not the JSON we asked for."""


def strip_json_fences(text: str) -> str:
    text = (text or "").strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, flags=re.DOTALL | re.IGNORECASE)
    return fenced.group(1).strip() if fenced else text


def _load(text: str, key: str, allow_empty: bool = False) -> list:
    try:
        data = json.loads(strip_json_fences(text))
    except json.JSONDecodeError as exc:
        raise AiOutputError(f"The model did not return valid JSON ({exc.msg}). Try again.") from exc
    items = data.get(key) if isinstance(data, dict) else None
    if not isinstance(items, list) or (not items and not allow_empty):
        raise AiOutputError(f'The model reply had no "{key}" list. Try again.')
    return items


def _text(value: object, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _seconds(value: object) -> float:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return DEFAULT_SECONDS
    if number != number:  # NaN
        return DEFAULT_SECONDS
    return round(min(MAX_SECONDS, max(MIN_SECONDS, number)), 2)


def parse_shot_list(text: str, allowed_cast: list[str]) -> list[dict]:
    """Validates and normalises a shot list. Unknown fields are dropped and cast limited to known names."""
    allowed = {name.lower(): name for name in allowed_cast}
    shots = []
    for item in _load(text, "shots")[:MAX_SHOTS]:
        if not isinstance(item, dict):
            continue
        cast = [allowed[c.strip().lower()] for c in item.get("cast", []) if isinstance(c, str) and c.strip().lower() in allowed]
        shot = {
            "duration_seconds": _seconds(item.get("duration_seconds")),
            "framing": _text(item.get("framing"), 120),
            "movement": _text(item.get("movement"), 120),
            "description": _text(item.get("description"), 2000),
            "dialogue": _text(item.get("dialogue"), 2000),
            "cast": list(dict.fromkeys(cast)),
            "storyboard_prompt": _text(item.get("storyboard_prompt"), 2000),
            "video_prompt": _text(item.get("video_prompt"), 3000),
        }
        if shot["description"] or shot["dialogue"]:
            shots.append(shot)
    if not shots:
        raise AiOutputError("The model returned no usable shots. Try again.")
    return shots


def parse_shot_prompts(text: str, shot_numbers: list[int]) -> list[dict]:
    """Keeps only prompts for shot numbers that were asked about, one per shot."""
    wanted = set(shot_numbers)
    seen: set[int] = set()
    prompts = []
    for item in _load(text, "prompts"):
        if not isinstance(item, dict):
            continue
        number = item.get("number")
        if isinstance(number, bool) or not isinstance(number, int) or number not in wanted or number in seen:
            continue
        storyboard, video = _text(item.get("storyboard_prompt"), 2000), _text(item.get("video_prompt"), 3000)
        if storyboard or video:
            seen.add(number)
            prompts.append({"number": number, "storyboard_prompt": storyboard, "video_prompt": video})
    if not prompts:
        raise AiOutputError("The model returned no usable prompts. Try again.")
    return prompts


def parse_continuity(text: str, scene_names: list[str]) -> list[dict]:
    names = {n.lower(): n for n in scene_names}
    notes = []
    # An empty list is a valid answer here: it means no contradictions were found.
    for item in _load(text, "notes", allow_empty=True)[:15]:
        if not isinstance(item, dict):
            continue
        message = _text(item.get("message"), 800)
        if not message:
            continue
        severity = item.get("severity")
        scene = _text(item.get("scene"), 200)
        notes.append({"severity": severity if severity in ("error", "warn", "info") else "warn", "scene": names.get(scene.lower(), ""), "message": message})
    return notes
