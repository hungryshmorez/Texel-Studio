"""Run: uv run python -m unittest discover -s tests -v. No network, no Gemini key."""
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import ai_writing as ai
import main

SHOW = {"title": "Couch Pirates", "genre": "Comedy", "premise": "A talk show on a pirate ship.", "logline": "Two pirates host a show.", "visual_style": "Grainy 1990s public access video"}
AL = {"name": "Al", "visual": "A weathered pirate in a red coat", "wardrobe": "Red coat", "features": "eyepatch", "voice": "gravelly"}
SLOPPY = {"name": "Sloppy", "visual": "A short cook"}
SCENE = {"name": "Opening", "heading": "EXT. CROW'S NEST - DAY", "action": "Al climbs the mast.\n\nThe wind howls.",
         "dialogue": [{"speaker": "Al", "parenthetical": "to camera", "text": "Welcome back, folks."}], "set_name": "Crow's Nest"}


def reply(payload) -> str:
    return payload if isinstance(payload, str) else json.dumps(payload)


class FakeClient:
    """Stands in for the Gemini client: returns one canned text for every call."""

    def __init__(self, text):
        self.calls = []
        self.models = SimpleNamespace(generate_content=self._generate)
        self.text = text

    def _generate(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(text=self.text)


class PromptTests(unittest.TestCase):
    def test_shot_list_prompt_carries_the_scene_verbatim_and_the_style_rule(self):
        req = ai.ShotListRequest(show=SHOW, scene=SCENE, characters=[AL, SLOPPY], target_seconds=12)
        system, body = ai.build_shot_list_prompt(req)
        self.assertIn("VERBATIM", system)
        self.assertIn("never describe the art style", system)
        self.assertIn("1. AL (to camera): Welcome back, folks.", body)
        self.assertIn("- Al: A weathered pirate in a red coat Wardrobe: Red coat Distinctive: eyepatch Voice: gravelly", body)
        self.assertIn("VISUAL STYLE (applied separately): Grainy 1990s public access video", body)
        self.assertIn("TARGET LENGTH: about 12 seconds", body)

    def test_continuity_prompt_names_every_scene_and_location(self):
        other = {**SCENE, "name": "Kitchen", "set_name": "Galley"}
        _, body = ai.build_continuity_prompt(ai.ContinuityRequest(show=SHOW, characters=[AL], scenes=[SCENE, other]))
        self.assertIn("SCENE: Opening", body)
        self.assertIn("SCENE: Kitchen", body)
        self.assertIn("LOCATION: Galley", body)

    def test_prompts_request_marks_missing_fields(self):
        shot = {"number": 1, "duration_seconds": 4, "framing": "Wide", "description": "Al on the mast", "cast": ["Al"]}
        _, body = ai.build_shot_prompts_prompt(ai.ShotPromptsRequest(show=SHOW, scene=SCENE, characters=[AL], shots=[shot]))
        self.assertIn("SHOT 1 (4s) framing=Wide", body)
        self.assertIn("storyboard_prompt: (missing)", body)

    def test_oversized_input_is_rejected_by_the_request_models(self):
        with self.assertRaises(ValueError):
            ai.ShotListRequest(show=SHOW, scene={**SCENE, "action": "x" * 12001})
        with self.assertRaises(ValueError):
            ai.ShotPromptsRequest(show=SHOW, scene=SCENE, shots=[])


class ParserTests(unittest.TestCase):
    GOOD = {"shots": [{"duration_seconds": 4, "framing": "Wide", "movement": "Slow push-in", "description": "Al on the mast", "dialogue": "", "cast": ["al"], "storyboard_prompt": "sketch", "video_prompt": "video"}]}

    def test_accepts_clean_json_and_json_in_a_code_fence(self):
        for text in (reply(self.GOOD), "```json\n" + reply(self.GOOD) + "\n```", "```\n" + reply(self.GOOD) + "\n```"):
            shots = ai.parse_shot_list(text, ["Al"])
            self.assertEqual(shots[0]["cast"], ["Al"], "cast is mapped back to the registered spelling")
            self.assertEqual(shots[0]["duration_seconds"], 4)

    def test_rejects_garbage_with_a_readable_message(self):
        for text in ("not json at all", reply({"shots": []}), reply({"other": 1}), reply([1, 2]), ""):
            with self.assertRaises(ai.AiOutputError, msg=text):
                ai.parse_shot_list(text, ["Al"])

    def test_clamps_durations_and_drops_invented_cast_unknown_fields_and_empty_shots(self):
        payload = {"shots": [
            {"duration_seconds": 500, "description": "long", "cast": ["Al", "Nobody", "Al"], "secret": "x"},
            {"duration_seconds": -3, "description": "negative"},
            {"duration_seconds": "soon", "description": "text duration"},
            {"duration_seconds": float("nan"), "description": "nan"},
            {"description": "", "dialogue": ""},
            "not an object",
        ]}
        shots = ai.parse_shot_list(reply(payload), ["Al"])  # json.dumps writes a bare NaN, which json.loads accepts
        self.assertEqual([s["duration_seconds"] for s in shots], [15.0, 1.0, 3.0, 3.0])
        self.assertEqual(shots[0]["cast"], ["Al"], "an invented name is dropped and duplicates collapse")
        self.assertNotIn("secret", shots[0])

    def test_caps_the_number_of_shots(self):
        many = {"shots": [{"description": f"shot {i}"} for i in range(80)]}
        self.assertEqual(len(ai.parse_shot_list(reply(many), [])), ai.MAX_SHOTS)

    def test_prompts_only_for_requested_numbers_once_each(self):
        payload = {"prompts": [
            {"number": 1, "storyboard_prompt": "a", "video_prompt": "b"},
            {"number": 1, "storyboard_prompt": "duplicate", "video_prompt": ""},
            {"number": 9, "storyboard_prompt": "not asked", "video_prompt": ""},
            {"number": True, "storyboard_prompt": "bool", "video_prompt": ""},
            {"number": 2, "storyboard_prompt": "", "video_prompt": ""},
            {"number": 2, "storyboard_prompt": "second", "video_prompt": ""},
        ]}
        out = ai.parse_shot_prompts(reply(payload), [1, 2])
        self.assertEqual([(p["number"], p["storyboard_prompt"]) for p in out], [(1, "a"), (2, "second")])

    def test_continuity_allows_no_problems_and_cleans_up_notes(self):
        self.assertEqual(ai.parse_continuity(reply({"notes": []}), ["Opening"]), [])
        payload = {"notes": [
            {"severity": "error", "scene": "opening", "message": "Al has two eyes here."},
            {"severity": "catastrophe", "scene": "Nowhere", "message": "odd severity"},
            {"severity": "warn", "scene": "Opening", "message": "  "},
        ]}
        notes = ai.parse_continuity(reply(payload), ["Opening"])
        self.assertEqual(notes, [
            {"severity": "error", "scene": "Opening", "message": "Al has two eyes here."},
            {"severity": "warn", "scene": "", "message": "odd severity"},
        ])
        with self.assertRaises(ai.AiOutputError):
            ai.parse_continuity("nope", ["Opening"])


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.http = TestClient(main.app)

    def run_job(self, path, body, text):
        fake = FakeClient(text)
        with patch.object(main, "get_client", return_value=fake):
            started = self.http.post(path, json=body)
            self.assertEqual(started.status_code, 200, started.text)
            job = started.json()["job_id"]
            for _ in range(100):
                status = self.http.get(f"/api/ai/status/{job}").json()
                if status["status"] != "pending":
                    return status, fake
                time.sleep(0.02)
        self.fail("job did not finish")

    def test_shot_list_job_returns_validated_shots(self):
        good = {"shots": [{"duration_seconds": 3, "framing": "Wide", "description": "Al climbs", "cast": ["Al"]}]}
        status, fake = self.run_job("/api/shots/generate/start", {"show": SHOW, "scene": SCENE, "characters": [AL]}, reply(good))
        self.assertEqual(status["status"], "done", status)
        self.assertEqual(status["result"]["data"][0]["cast"], ["Al"])
        self.assertEqual(len(fake.calls), 1)
        self.assertTrue(any("Welcome back, folks." in part for part in fake.calls[0]["contents"]))

    def test_a_bad_model_reply_becomes_a_readable_job_error(self):
        status, _ = self.run_job("/api/shots/generate/start", {"show": SHOW, "scene": SCENE}, "I am sorry, I cannot do that.")
        self.assertEqual(status["status"], "error")
        self.assertIn("did not return valid JSON", status["error"])

    def test_prompts_and_continuity_jobs(self):
        shot = {"number": 1, "duration_seconds": 3, "description": "Al"}
        status, _ = self.run_job("/api/shots/prompts/start", {"show": SHOW, "scene": SCENE, "shots": [shot]}, reply({"prompts": [{"number": 1, "storyboard_prompt": "s", "video_prompt": "v"}]}))
        self.assertEqual(status["result"]["data"], [{"number": 1, "storyboard_prompt": "s", "video_prompt": "v"}])
        status, _ = self.run_job("/api/continuity/start", {"show": SHOW, "scenes": [SCENE]}, reply({"notes": []}))
        self.assertEqual((status["status"], status["result"]["data"]), ("done", []))

    def test_empty_scene_and_unknown_job_are_refused(self):
        empty = {**SCENE, "action": " ", "dialogue": []}
        for path, body in (("/api/shots/generate/start", {"show": SHOW, "scene": empty}), ("/api/continuity/start", {"show": SHOW, "scenes": [empty]})):
            self.assertEqual(self.http.post(path, json=body).status_code, 400, path)
        self.assertEqual(self.http.get("/api/ai/status/nope").status_code, 404)
        self.assertEqual(self.http.post("/api/shots/prompts/start", json={"show": SHOW, "scene": SCENE, "shots": []}).status_code, 422)

    def test_model_outage_and_missing_key_are_reported_not_raised(self):
        with patch.object(main, "get_client", return_value=object()), patch.object(main, "generate_with_retry", side_effect=HTTPException(503, "The AI model is temporarily overloaded.")):
            job = self.http.post("/api/continuity/start", json={"show": SHOW, "scenes": [SCENE]}).json()["job_id"]
            for _ in range(100):
                status = self.http.get(f"/api/ai/status/{job}").json()
                if status["status"] != "pending":
                    break
                time.sleep(0.02)
        self.assertEqual(status["status"], "error")
        self.assertIn("overloaded", status["error"])


if __name__ == "__main__":
    unittest.main()
