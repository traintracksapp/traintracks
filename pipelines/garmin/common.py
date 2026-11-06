"""
Shared helpers for the Garmin pipelines.

Auth: the GARMIN_TOKENS secret, in EITHER of the two formats people end up with:
  * a garth ``dumps()`` base64 string blob (what garmin_login.py prints), or
  * a base64 gzipped tarball of a ~/.garth directory (an older setup script).
Falls back to ~/.garminconnect for local use when the variable is unset.

Time zone: the GARMIN_TZ repository variable (IANA name). Every date key the
pipelines write — minute keys, daily rows, "today" — is in this zone, so a
late-evening activity lands on the day you lived it, not the UTC day.
"""
from __future__ import annotations

import base64
import io
import os
import sys
import tarfile
import tempfile
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

DEFAULT_TZ = "America/New_York"


def local_tz() -> ZoneInfo:
    name = os.environ.get("GARMIN_TZ", "").strip() or DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except Exception:  # noqa: BLE001
        print(f"! GARMIN_TZ={name!r} is not a valid IANA zone; using {DEFAULT_TZ}")
        return ZoneInfo(DEFAULT_TZ)


def local_today() -> date:
    return datetime.now(local_tz()).date()


def tokens_format(tokens: str) -> str:
    """'tarball' | 'blob' | 'none' for a GARMIN_TOKENS value."""
    t = (tokens or "").strip()
    if not t:
        return "none"
    # gzip magic bytes (1f 8b) base64-encode to "H4sI"
    return "tarball" if t.startswith("H4sI") else "blob"


def _extract_tarball(tokens: str) -> str:
    buf = io.BytesIO(base64.b64decode(tokens))
    tmp = tempfile.mkdtemp(prefix="garth-")
    with tarfile.open(fileobj=buf, mode="r:gz") as tar:
        if hasattr(tarfile, "data_filter"):
            tar.extractall(tmp, filter="data")
        else:  # pragma: no cover — Python < 3.12
            tar.extractall(tmp)
    token_dir = os.path.join(tmp, ".garth")
    return token_dir if os.path.isdir(token_dir) else tmp


def garmin_client():
    """A logged-in garminconnect.Garmin, whatever token format we were given."""
    from garminconnect import Garmin  # imported lazily so tests need no network libs

    tokens = os.environ.get("GARMIN_TOKENS", "").strip()
    fmt = tokens_format(tokens)
    g = Garmin()
    if fmt == "none":
        g.login(os.path.expanduser("~/.garminconnect"))
    elif fmt == "blob":
        g.login(tokens)
    else:
        g.login(_extract_tarball(tokens))
    dn = os.environ.get("GARMIN_DISPLAY_NAME", "").strip()
    if dn and not getattr(g, "display_name", None):
        g.display_name = dn
    return g


def call(fn, *args, retries: int = 1, pause: float = 10.0, default=None, quiet: bool = False):
    """Call a Garmin endpoint with one retry; `default` on failure."""
    for attempt in range(retries + 1):
        try:
            return fn(*args)
        except Exception as e:  # noqa: BLE001
            if attempt < retries:
                time.sleep(pause)
            elif not quiet:
                print(f"    ! {getattr(fn, '__name__', fn)}: {e}")
    return default


def num(x, digits: int | None = None) -> str:
    """None-safe number -> CSV cell ('' for None/unparsable)."""
    if x is None:
        return ""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return ""
    if digits is None:
        return str(int(v)) if v == int(v) else f"{v}"
    return f"{v:.{digits}f}"


def ensure_garminconnect() -> None:
    """Friendly message instead of a traceback when the dependency is missing."""
    try:
        import garminconnect  # noqa: F401
    except ImportError:
        print("garminconnect is not installed: pip install garminconnect", file=sys.stderr)
        sys.exit(2)
