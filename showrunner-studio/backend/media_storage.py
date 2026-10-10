"""Backend-managed object storage for Texel editing.

Texel's encoder needs HTTPS-readable inputs and a writable output location, so
the backend uploads user media to an S3-compatible bucket (AWS S3, Cloudflare R2,
MinIO, GCS interoperability) and hands Texel short-lived presigned URLs. Storage
credentials stay server-side and presigned URLs are never returned to the browser.
"""
import datetime
import hashlib
import hmac
import os
from pathlib import Path
from urllib.parse import quote

import httpx

READ_TTL = 6 * 3600
WRITE_TTL = 6 * 3600
UPLOAD_CHUNK = 1024 * 1024


class StorageError(RuntimeError):
    pass


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


def presign(method, host, path, access_key, secret_key, region, expires, now=None, scheme="https"):
    """AWS Signature V4 query-string presign for S3-style requests."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    scope = f"{day}/{region}/s3/aws4_request"
    query = {"X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": f"{access_key}/{scope}",
             "X-Amz-Date": stamp, "X-Amz-Expires": str(expires), "X-Amz-SignedHeaders": "host"}
    canonical_query = "&".join(f"{quote(k, safe='')}={quote(v, safe='')}" for k, v in sorted(query.items()))
    encoded_path = quote(path, safe="/-_.~")
    canonical = "\n".join([method, encoded_path, canonical_query, f"host:{host}\n", "host", "UNSIGNED-PAYLOAD"])
    to_sign = "\n".join(["AWS4-HMAC-SHA256", stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    signing = _sign(_sign(_sign(_sign(("AWS4" + secret_key).encode(), day), region), "s3"), "aws4_request")
    signature = hmac.new(signing, to_sign.encode(), hashlib.sha256).hexdigest()
    return f"{scheme}://{host}{encoded_path}?{canonical_query}&X-Amz-Signature={signature}"


class ObjectStorage:
    def __init__(self, endpoint, bucket, access_key, secret_key, region="auto", prefix="texel-studio"):
        self.endpoint = endpoint.rstrip("/")
        self.bucket, self.access_key, self.secret_key = bucket, access_key, secret_key
        self.region, self.prefix = region, prefix.strip("/")

    @classmethod
    def from_env(cls):
        values = {name: os.environ.get(name, "").strip() for name in
                  ("TEXEL_S3_ENDPOINT", "TEXEL_S3_BUCKET", "TEXEL_S3_ACCESS_KEY_ID", "TEXEL_S3_SECRET_ACCESS_KEY")}
        if not all(values.values()):
            return None
        return cls(values["TEXEL_S3_ENDPOINT"], values["TEXEL_S3_BUCKET"], values["TEXEL_S3_ACCESS_KEY_ID"],
                   values["TEXEL_S3_SECRET_ACCESS_KEY"], os.environ.get("TEXEL_S3_REGION", "auto"))

    def key(self, trailer_id, name):
        return f"{self.prefix}/{trailer_id}/{name}"

    def _url(self, method, key, ttl):
        scheme, _, host = self.endpoint.partition("://")
        if not host:
            raise StorageError("TEXEL_S3_ENDPOINT must start with https://")
        # Path-style addressing works for S3, R2 and MinIO alike.
        return presign(method, host, f"/{self.bucket}/{key}", self.access_key, self.secret_key, self.region, ttl, scheme=scheme)

    def read_url(self, key, ttl=READ_TTL):
        return self._url("GET", key, ttl)

    def write_url(self, key, ttl=WRITE_TTL):
        return self._url("PUT", key, ttl)

    def upload_file(self, path: Path, key: str, content_type="application/octet-stream"):
        def chunks():
            with path.open("rb") as source:
                while block := source.read(UPLOAD_CHUNK):
                    yield block
        try:
            response = httpx.put(self.write_url(key, 3600), content=chunks(), headers={"Content-Length": str(path.stat().st_size), "Content-Type": content_type},
                                 timeout=httpx.Timeout(600, connect=20))
        except httpx.HTTPError as exc:
            raise StorageError("Could not upload the file to storage. Check the storage endpoint and try again.") from exc
        if response.status_code >= 300:
            raise StorageError(f"Storage rejected the upload (HTTP {response.status_code}). Check the bucket, credentials and CORS/permissions.")

    def delete(self, key):
        try:
            httpx.delete(self._url("DELETE", key, 300), timeout=30)
        except httpx.HTTPError:
            pass  # Best-effort cleanup; bucket lifecycle rules are the backstop.
