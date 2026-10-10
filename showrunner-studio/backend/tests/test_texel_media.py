"""Backend-managed uploads, signed storage and long-cut validation. No live calls."""
import datetime
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

import texel_routes
from media_storage import ObjectStorage, presign
from texel_client import TexelClient, TexelError
from trailer_render import validate_video


def make_media(path: Path, seconds: float, audio=True, size="64x36"):
    args = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=teal:s={size}:r=5:d={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "aac"]
    subprocess.run([*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", str(path)], check=True)
    return path


def make_wav(path: Path, seconds=4):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency=220:duration={seconds}", str(path)], check=True)
    return path


class PresignTests(unittest.TestCase):
    def test_matches_aws_documented_presigned_get_example(self):
        url = presign("GET", "examplebucket.s3.amazonaws.com", "/test.txt", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                      "us-east-1", 86400, now=datetime.datetime(2013, 5, 24, tzinfo=datetime.timezone.utc))
        self.assertIn("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404", url)

    def test_storage_is_disabled_until_fully_configured(self):
        with patch.dict(os.environ, {"TEXEL_S3_ENDPOINT": "https://s3.example.com"}, clear=False):
            for name in ("TEXEL_S3_BUCKET", "TEXEL_S3_ACCESS_KEY_ID", "TEXEL_S3_SECRET_ACCESS_KEY"):
                os.environ.pop(name, None)
            self.assertIsNone(ObjectStorage.from_env())

    def test_urls_are_path_style_and_signed_per_method(self):
        storage = ObjectStorage("https://acct.r2.example.com", "bucket", "id", "secret")
        read, write = storage.read_url("texel-studio/t/a.mp4"), storage.write_url("texel-studio/t/a.mp4")
        self.assertTrue(read.startswith("https://acct.r2.example.com/bucket/texel-studio/t/a.mp4?"))
        self.assertNotEqual(read.split("X-Amz-Signature=")[1], write.split("X-Amz-Signature=")[1])


class LongCutValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.long = make_media(self.tmp / "long.mp4", 191.6)

    def test_reproduces_and_fixes_the_120_second_rejection(self):
        with self.assertRaises(ValueError):
            validate_video(self.long)  # the short-clip policy still rejects long generated clips
        validate_video(self.long, expected_seconds=191.6, expect_audio=True)

    def test_assembled_cut_must_match_the_planned_length_and_audio(self):
        with self.assertRaises(ValueError):
            validate_video(self.long, expected_seconds=150)
        silent = make_media(self.tmp / "silent.mp4", 20, audio=False)
        with self.assertRaises(ValueError):
            validate_video(silent, expected_seconds=20, expect_audio=True)

    def test_real_download_path_accepts_a_long_cut_and_rejects_oversize(self):
        data = self.long.read_bytes()
        real_client = httpx.Client
        def client_factory(**kwargs):
            return real_client(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=data)), **kwargs)
        target = self.tmp / "out.mp4"
        with patch("texel_client.httpx.Client", side_effect=client_factory), patch("texel_client._public_https"):
            TexelClient().download_video("https://cdn.example.com/out.mp4", target, max_bytes=len(data) + 10, expected_seconds=191.6, expect_audio=True)
            self.assertTrue(target.is_file())
            with self.assertRaises(TexelError):
                TexelClient().download_video("https://cdn.example.com/out.mp4", self.tmp / "big.mp4", max_bytes=1000, expected_seconds=191.6)
            with self.assertRaises(TexelError):
                TexelClient().download_video("https://cdn.example.com/out.mp4", self.tmp / "wrong.mp4", expected_seconds=60)
        self.assertFalse(list(self.tmp.glob("*.part")))


class FakeStorage:
    uploads, deleted = {}, []

    def key(self, trailer_id, name):
        return f"studio/{trailer_id}/{name}"

    def read_url(self, key, ttl=0):
        return f"https://storage.example.com/read/{key}?sig=r"

    def write_url(self, key, ttl=0):
        return f"https://storage.example.com/write/{key}?sig=w"

    def upload_file(self, path, key, content_type="x"):
        FakeStorage.uploads[key] = Path(path).stat().st_size

    def delete(self, key):
        FakeStorage.deleted.append(key)


class FakeEncoder:
    payloads, source = [], None

    def submit(self, payload):
        FakeEncoder.payloads.append(payload)
        return "job-1"

    def status(self, job_id, client_id):
        return {"completed": True, "progress": 100}

    def download_video(self, url, path, max_bytes=None, **validation):
        shutil.copy(FakeEncoder.source, path)
        from trailer_render import validate_video as check
        try:
            check(path, **validation)
        except ValueError as exc:
            raise TexelError(str(exc)) from exc


class EditFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        FakeStorage.uploads, FakeStorage.deleted, FakeEncoder.payloads = {}, [], []
        env = patch.dict(os.environ, {"TEXEL_DATA_DIR": str(self.tmp / "data"), "TEXEL_EDITING_API_KEY": "edit-key"})
        env.start()
        self.addCleanup(env.stop)
        texel_routes._service = None
        for target, value in (("texel_routes.ObjectStorage.from_env", lambda: FakeStorage()), ("texel_routes.TexelEncoderClient", FakeEncoder),
                              ("texel_encoder._public_https", lambda url: None)):
            patcher = patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(texel_routes.router)
        self.http = TestClient(app)
        self.addCleanup(lambda: setattr(texel_routes, "_service", None))
        self.clip_a = make_media(self.tmp / "a.mp4", 30)
        self.clip_b = make_media(self.tmp / "b.mp4", 20, audio=False)
        self.song = make_wav(self.tmp / "song.wav", 40)

    def upload(self, project, path):
        with path.open("rb") as handle:
            return self.http.post(f"/api/texel/trailers/{project}/assets", files={"file": (path.name, handle)})

    def project(self):
        response = self.http.post("/api/texel/edits", json={"request_id": "edit-1", "title": "Music video"})
        self.assertEqual(response.status_code, 201)
        return response.json()["id"]

    def test_upload_probe_render_download_and_cleanup(self):
        project = self.project()
        for path in (self.clip_a, self.song):
            self.assertEqual(self.upload(project, path).status_code, 201)
        body = self.http.get(f"/api/texel/trailers/{project}").json()
        a, song = body["assets"]
        self.assertEqual((a["kind"], a["has_audio"], round(a["duration"])), ("video", True, 30))
        self.assertEqual((song["kind"], song["has_audio"]), ("audio", True))
        self.assertNotIn("studio/", json.dumps(body))  # storage keys never reach the browser
        self.assertEqual(len(FakeStorage.uploads), 2)

        FakeEncoder.source = make_media(self.tmp / "cut.mp4", 25, size="1280x720")
        response = self.http.post(f"/api/texel/trailers/{project}/edit-render", json={
            "clips": [{"asset_id": a["id"], "start_seconds": 2, "duration_seconds": 25}], "audio_asset_id": song["id"], "audio_start_seconds": 8.9})
        self.assertEqual(response.status_code, 202)
        for _ in range(100):
            body = self.http.get(f"/api/texel/trailers/{project}").json()
            if body["cloud_render"]["status"] != "running":
                break
            time.sleep(0.1)
        self.assertEqual(body["cloud_render"]["status"], "complete", body["cloud_render"])
        self.assertTrue(body["video_url"])
        self.assertEqual(self.http.get(body["video_url"]).status_code, 200)
        payload = FakeEncoder.payloads[0]
        self.assertEqual([i["url"].split("?")[0] for i in payload["inputs"]], [f"https://storage.example.com/read/studio/{project}/{a['id']}.mp4", f"https://storage.example.com/read/studio/{project}/{song['id']}.wav"])
        self.assertTrue(payload["outputs"][0]["url"].startswith("https://storage.example.com/write/"))
        self.assertEqual(payload["audio_properties"]["quality"], "2")
        self.assertNotIn("sig=", json.dumps(body))
        self.assertEqual(len(FakeStorage.deleted), 1)  # transient output object removed after the local copy was saved

    def test_audioless_source_is_rejected_when_original_audio_is_required(self):
        project = self.project()
        self.upload(project, self.clip_b)
        asset = self.http.get(f"/api/texel/trailers/{project}").json()["assets"][0]
        self.assertFalse(asset["has_audio"])
        response = self.http.post(f"/api/texel/trailers/{project}/edit-render", json={"clips": [{"asset_id": asset["id"]}], "preserve_audio": True})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(FakeEncoder.payloads, [])

    def test_bad_inputs_and_missing_storage_fail_before_any_paid_call(self):
        project = self.project()
        garbage = self.tmp / "notes.txt"
        garbage.write_text("not media")
        self.assertEqual(self.upload(project, garbage).status_code, 409)
        self.upload(project, self.clip_a)
        asset = self.http.get(f"/api/texel/trailers/{project}").json()["assets"][0]
        late = self.http.post(f"/api/texel/trailers/{project}/edit-render", json={"clips": [{"asset_id": asset["id"], "start_seconds": 99}]})
        self.assertEqual(late.status_code, 409)
        with patch("texel_routes.ObjectStorage.from_env", return_value=None):
            self.assertEqual(self.upload(project, self.clip_a).status_code, 409)
        self.assertEqual(FakeEncoder.payloads, [])

    def test_cut_longer_than_two_minutes_completes_through_the_service(self):
        project = self.project()
        source = make_media(self.tmp / "long-source.mp4", 150, size="640x360")
        self.assertEqual(self.upload(project, source).status_code, 201)
        asset = self.http.get(f"/api/texel/trailers/{project}").json()["assets"][0]
        FakeEncoder.source = make_media(self.tmp / "long-cut.mp4", 130, size="1280x720")
        response = self.http.post(f"/api/texel/trailers/{project}/edit-render", json={"clips": [{"asset_id": asset["id"], "duration_seconds": 130}]})
        self.assertEqual(response.status_code, 202)
        for _ in range(150):
            body = self.http.get(f"/api/texel/trailers/{project}").json()
            if body["cloud_render"]["status"] != "running":
                break
            time.sleep(0.1)
        self.assertEqual(body["cloud_render"]["status"], "complete", body["cloud_render"])
        self.assertEqual(self.http.get(body["video_url"]).status_code, 200)


if __name__ == "__main__":
    unittest.main()
