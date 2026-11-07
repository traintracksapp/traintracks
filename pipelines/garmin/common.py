"""
Shared helpers for the Garmin pipelines.

Auth: the GARMIN_TOKENS secret — the JSON session string that garmin_login.py
prints (garminconnect >= 0.3.20). Older base64 garth blobs and tarballs are
detected and rejected with instructions, since the library can no longer
resume them. Falls back to ~/.garminconnect for local use when unset.

Time zone: the GARMIN_TZ repository variable (IANA name). Every date key the
pipelines write — minute keys, daily rows, "today" — is in this zone, so a
late-evening activity lands on the day you lived it, not the UTC day.
"""
from __future__ import annotations

import os
import sys
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
    """'json' | 'tarball' | 'blob' | 'none' for a GARMIN_TOKENS value.

    garminconnect >= 0.3.20 only accepts the JSON session string that
    garmin_login.py prints. 'blob' (a base64 garth dump) and 'tarball' are the
    two older formats; they can no longer be resumed and need a fresh login.
    """
    t = (tokens or "").strip()
    if not t:
        return "none"
    if t.startswith(("{", "[")):
        return "json"
    # gzip magic bytes (1f 8b) base64-encode to "H4sI"
    return "tarball" if t.startswith("H4sI") else "blob"


def garmin_client():
    """A logged-in garminconnect.Garmin, whatever token format we were given."""
    from garminconnect import Garmin  # imported lazily so tests need no network libs

    tokens = os.environ.get("GARMIN_TOKENS", "").strip()
    fmt = tokens_format(tokens)
    if fmt in ("blob", "tarball"):
        print("GARMIN_TOKENS is in the old garth format, which garminconnect no longer accepts.\n"
              "Run `pip install -U garminconnect && python pipelines/garmin/garmin_login.py` once and\n"
              "paste the JSON it prints into the GARMIN_TOKENS secret.", file=sys.stderr)
        sys.exit(3)
    g = Garmin()
    try:
        g.login(tokens if fmt == "json" else os.path.expanduser("~/.garminconnect"))
    except Exception as e:  # noqa: BLE001
        print(f"Garmin login failed ({e}). If the tokens are more than a year old, run garmin_login.py again.", file=sys.stderr)
        sys.exit(3)
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
    """None-safe number -> CSV cell ('' for None/unparsable). Whole numbers are written without ".0"."""
    if x is None:
        return ""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return ""
    if digits is not None:
        v = round(v, digits)
    return str(int(v)) if v == int(v) else repr(v)


def ensure_garminconnect() -> None:
    """Friendly message instead of a traceback when the dependency is missing."""
    try:
        import garminconnect  # noqa: F401
    except ImportError:
        print("garminconnect is not installed: pip install garminconnect", file=sys.stderr)
        sys.exit(2)
