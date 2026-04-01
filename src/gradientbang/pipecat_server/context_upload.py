"""Upload LLM context snapshots to S3 for debugging.

Uploads are fire-and-forget via daemon threads. The feature is opt-in:
set CONTEXT_S3_BUCKET to enable. Uses the same AWS credentials as
s3_smart_turn (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION).

A metadata row is upserted into the ``context_snapshots`` table via
PostgREST (using SUPABASE_SERVICE_ROLE_KEY) after each successful upload.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger


def _get_config() -> Optional[Dict[str, str]]:
    """Return S3/DB config from env, or None if the feature is disabled."""
    bucket = os.getenv("CONTEXT_S3_BUCKET", "")
    if not bucket:
        return None
    supabase_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "bucket": bucket,
        "aws_access_key_id": os.getenv("AWS_ACCESS_KEY_ID", ""),
        "aws_secret_access_key": os.getenv("AWS_SECRET_ACCESS_KEY", ""),
        "aws_region": os.getenv("AWS_REGION", "us-east-1"),
        "supabase_rest_url": f"{supabase_url}/rest/v1" if supabase_url else "",
        "supabase_service_key": service_key,
    }


def upload_context(
    *,
    s3_key: str,
    messages: List[Dict[str, Any]],
    db_row: Dict[str, Any],
) -> None:
    """Fire-and-forget upload of context messages to S3 + DB upsert.

    Parameters
    ----------
    s3_key:
        Full S3 object key (e.g. ``contexts/{char}/{session}/tasks/{task}.json``).
    messages:
        Raw LLM context messages list — serialised as-is to JSON.
    db_row:
        Column values for the ``context_snapshots`` upsert. Must include at
        least ``character_id``, ``session_id``, ``snapshot_type``,
        ``s3_key``, ``message_count``, ``snapshot_reason``.
    """
    config = _get_config()
    if config is None:
        return
    # Snapshot everything needed for the thread — avoid referencing mutable state later.
    payload_bytes = json.dumps(messages, ensure_ascii=False, default=str).encode("utf-8")
    thread = threading.Thread(
        target=_upload_thread,
        args=(config, s3_key, payload_bytes, db_row),
        daemon=True,
    )
    thread.start()


def _upload_thread(
    config: Dict[str, str],
    s3_key: str,
    payload_bytes: bytes,
    db_row: Dict[str, Any],
) -> None:
    try:
        _upload_to_s3(config, s3_key, payload_bytes)
        logger.debug(f"context_upload: uploaded s3://{config['bucket']}/{s3_key}")
    except Exception as exc:
        logger.error(f"context_upload: S3 upload failed for {s3_key}: {exc}")
        return  # Skip DB upsert if S3 failed

    try:
        _upsert_db_row(config, db_row)
    except Exception as exc:
        logger.error(f"context_upload: DB upsert failed for {s3_key}: {exc}")


def _upload_to_s3(config: Dict[str, str], s3_key: str, payload_bytes: bytes) -> None:
    import io
    import boto3

    client = boto3.client(
        "s3",
        region_name=config["aws_region"],
        aws_access_key_id=config["aws_access_key_id"],
        aws_secret_access_key=config["aws_secret_access_key"],
    )
    client.upload_fileobj(
        io.BytesIO(payload_bytes),
        config["bucket"],
        s3_key,
        ExtraArgs={"ContentType": "application/json"},
    )


def _upsert_db_row(config: Dict[str, str], db_row: Dict[str, Any]) -> None:
    rest_url = config.get("supabase_rest_url", "")
    service_key = config.get("supabase_service_key", "")
    if not rest_url or not service_key:
        return

    import httpx

    now_iso = datetime.now(timezone.utc).isoformat()
    row = {**db_row, "updated_at": now_iso}
    row.setdefault("created_at", now_iso)

    # Determine upsert conflict target based on snapshot type.
    # - task snapshots: unique on (session_id, task_id)
    # - voice snapshots: unique on (s3_key)
    if row.get("task_id"):
        on_conflict = "session_id,task_id"
    else:
        on_conflict = "s3_key"

    url = f"{rest_url}/context_snapshots"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": f"resolution=merge-duplicates,return=minimal",
    }
    params = {"on_conflict": on_conflict}

    with httpx.Client(timeout=10.0) as client:
        resp = client.post(url, headers=headers, params=params, json=row)
        resp.raise_for_status()
