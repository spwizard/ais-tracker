"""Traffic Scotland LEV camera eye — one polite FTP sweep every ten minutes.

Traffic Scotland's terms are strict and enforced by automatic bans: at most one
complete download set per 10-minute interval, everything in a single
authenticated session, always QUIT cleanly, and >6 failed logins in 24 h locks
the account. So this source is deliberately conservative:

* one blocking ``ftplib`` session per sweep (run in a worker thread — the
  event loop never waits on FTP), fetching ``cameraimages.csv`` then every
  listed frame, then QUIT;
* a fixed sleep *after* each sweep finishes, never a tight retry — the base
  Source back-off (1 s → 30 s) must not see an exception here, or a flaky
  network could burn through the login allowance in a minute;
* auth failures back off for an hour and give up after three in a row.

Frames land in ``ScotCameraCatalog`` (land/scot_cameras) which the merged
camera API + vision read from. Health rides the normal source rail with a
``stale_after`` sized to the sweep cadence.
"""
from __future__ import annotations

import asyncio
import ftplib
import logging
import time

from ..config import Settings
from ..land.scot_cameras import ScotCamera, ScotCameraCatalog, parse_catalogue
from .base import Source

log = logging.getLogger("source")

CATALOGUE_FILE = "cameraimages.csv"
FRAME_DIR = "current"
POLL_SEC = 600.0            # T&Cs: one full set per 10-minute interval
AUTH_BACKOFF_SEC = 3600.0   # a bad password must not be retried quickly
MAX_AUTH_FAILURES = 3       # then stop — 6 failures/24 h triggers a ban
FTP_TIMEOUT = 30.0          # per socket op — a stuck data connection, not the whole sweep
MAX_CONSECUTIVE_FAILS = 3   # then assume the session is throttled and stop early
# ftplib.all_errors is itself a tuple; `except` won't accept nested tuples,
# so flatten it together with the decode error we can hit on the CSV.
_SWEEP_ERRORS = (*ftplib.all_errors, UnicodeDecodeError)


class SweepAuthError(Exception):
    """Login rejected — treat differently from a transient network blip."""


def _sweep(
    host: str, user: str, password: str
) -> tuple[list[ScotCamera], dict[str, bytes], int, str | None]:
    """Blocking: one FTP session → (catalogue, {file: jpeg bytes}, failed_count,
    abort_reason). Individual frames can fail (momentarily missing, or a data
    connection that stalls) without losing the sweep; a run of consecutive
    failures means the session is being throttled, so we stop and return what
    we have — a partial refresh beats none, and the next sweep fills the rest."""
    ftp = ftplib.FTP()
    ftp.connect(host, timeout=FTP_TIMEOUT)
    try:
        try:
            ftp.login(user, password)
        except ftplib.error_perm as exc:
            raise SweepAuthError(str(exc)) from exc
        buf = bytearray()
        ftp.retrbinary(f"RETR {CATALOGUE_FILE}", buf.extend)
        cams = parse_catalogue(buf.decode("utf-8", errors="replace"))
        ftp.cwd(FRAME_DIR)
        frames: dict[str, bytes] = {}
        failed = 0
        streak = 0
        abort: str | None = None
        for cam in cams:
            chunk = bytearray()
            try:
                ftp.retrbinary(f"RETR {cam.file}", chunk.extend)
            except ftplib.error_perm:
                failed += 1  # file momentarily missing — keep the previous frame
                continue
            except (TimeoutError, EOFError, ftplib.error_temp, OSError) as exc:
                failed += 1
                streak += 1
                if streak >= MAX_CONSECUTIVE_FAILS:
                    abort = f"{type(exc).__name__}: {exc}"
                    break
                continue
            streak = 0
            if chunk:
                frames[cam.file] = bytes(chunk)
        return cams, frames, failed, abort
    finally:
        # Always log out cleanly — dangling sessions count against us.
        try:
            ftp.quit()
        except ftplib.all_errors:
            ftp.close()


class ScotCameraSource(Source):
    name = "scot-cameras"

    def __init__(self, catalog: ScotCameraCatalog, settings: Settings) -> None:
        super().__init__(catalog)  # type: ignore[arg-type]
        self._catalog = catalog
        self._host = settings.scot_lev_host
        self._user = settings.scot_lev_user
        self._password = settings.scot_lev_password
        self.stale_after = POLL_SEC * 2 + 120.0
        self.live_frames = 0

    @property
    def configured(self) -> bool:
        return bool(self._user and self._password)

    async def _consume(self) -> None:
        if not self.configured:
            # Idle forever (amber in the health panel) rather than spin.
            await self._stop.wait()
            return
        self.connected = True
        auth_failures = 0
        while not self._stop.is_set():
            started = time.time()
            try:
                cams, frames, failed, abort = await asyncio.to_thread(
                    _sweep, self._host, self._user, self._password
                )
            except SweepAuthError as exc:
                auth_failures += 1
                log.error(
                    "[scot-cameras] FTP login rejected (%d/%d): %s",
                    auth_failures, MAX_AUTH_FAILURES, exc,
                )
                if auth_failures >= MAX_AUTH_FAILURES:
                    log.error("[scot-cameras] giving up — check SCOT_LEV_USER/PASSWORD")
                    self.connected = False
                    await self._stop.wait()
                    return
                await self._sleep(AUTH_BACKOFF_SEC)
                continue
            except _SWEEP_ERRORS as exc:
                # Transient — wait out a full interval; NEVER raise into the
                # supervisor's fast back-off.
                log.warning("[scot-cameras] sweep failed: %s", exc)
                await self._sleep(POLL_SEC)
                continue
            except Exception as exc:  # noqa: BLE001 — same rule for anything unexpected
                log.exception("[scot-cameras] sweep crashed: %s", exc)
                await self._sleep(POLL_SEC)
                continue
            auth_failures = 0
            now = time.time()
            if abort:
                log.warning(
                    "[scot-cameras] sweep cut short after %d/%d frames: %s",
                    len(frames), len(cams), abort,
                )
            if cams:
                self.live_frames = self._catalog.apply_sweep(cams, frames, now)
            if frames:
                self.messages_seen += len(frames)
                self.last_msg_ts = now
            log.info(
                "[scot-cameras] sweep: %d cameras, %d frames (%d live, %d missing) in %.0fs",
                len(cams), len(frames), self.live_frames, failed, now - started,
            )
            await self._sleep(POLL_SEC)

    async def _sleep(self, secs: float) -> None:
        try:
            await asyncio.wait_for(self._stop.wait(), timeout=secs)
        except asyncio.TimeoutError:
            pass
