"""Darwin Push Port source — the real Tier-1 rail feed (scaffold).

Darwin (National Rail Enquiries) streams per-service forecasts: predicted and
actual times at every calling point. Positions come from the same
interpolation engine the simulator uses — real timing data in, inferred
positions out.

NOT YET IMPLEMENTED: requires free registration at opendata.nationalrail.co.uk
(Push Port credentials). Once DARWIN_HOST/USER/PASS are set this source should
subscribe (STOMP or the Rail Data Marketplace Kafka topic, per the account
type), track service forecasts by RID, and upsert interpolated Trains exactly
as ``SimRailSource`` does. Until then it idles and reports unconfigured.
"""
from __future__ import annotations

from ..config import Settings
from ..store.train import TrainStore
from .base import Source, log


class DarwinSource(Source):
    name = "darwin"

    def __init__(self, store: TrainStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._host = settings.darwin_host
        self._user = settings.darwin_user
        self._password = settings.darwin_pass

    @property
    def configured(self) -> bool:
        return bool(self._host and self._user and self._password)

    async def _consume(self) -> None:
        if not self.configured:
            await self._stop.wait()  # no credentials → idle (amber in the UI)
            return
        log.warning("[darwin] credentials set but ingest not implemented yet — idling")
        await self._stop.wait()
