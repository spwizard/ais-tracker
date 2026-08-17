"""Claude-vision scene analysis for a traffic camera snapshot.

Deliberately *aggregate and anonymous*: the model counts road users by type and
rates congestion from a single low-res (352×288) still. It is explicitly told
NOT to read plates or identify specific vehicles/people — that's neither possible
at this resolution nor appropriate. This reuses the same Anthropic SDK pattern as
the vessel briefing (`messages.parse` → validated Pydantic model).
"""
from __future__ import annotations

import base64
import logging
from typing import Literal

import anthropic
import httpx
from pydantic import BaseModel, Field

log = logging.getLogger("land.vision")

SYSTEM = (
    "You are a traffic-camera scene analyst. You are shown ONE low-resolution "
    "(about 352x288) still frame from a London TfL traffic camera. Report only "
    "aggregate, anonymous observations. Count the visible road users by type as "
    "best you can — the image is small and may be blurry or dark, so estimate, "
    "and use 0 when you genuinely can't tell. Rate congestion from how much of "
    "the traffic is queuing or stopped: clear, light, moderate, heavy, or jam. "
    "NEVER attempt to read number plates or identify specific vehicles or people "
    "— it is neither possible at this resolution nor appropriate. Keep 'summary' "
    "to one plain, factual sentence about the scene."
)

USER = "Analyze this traffic-camera frame."


class CameraAnalysis(BaseModel):
    congestion: Literal["clear", "light", "moderate", "heavy", "jam"]
    cars: int = Field(ge=0)
    buses: int = Field(ge=0)
    trucks: int = Field(ge=0)  # lorries / vans / HGVs
    motorcycles: int = Field(ge=0)
    cyclists: int = Field(ge=0)
    pedestrians: int = Field(ge=0)
    summary: str


class IncidentVerdict(BaseModel):
    """Camera check of a reported incident, near the scene."""
    verdict: Literal["confirmed", "unclear", "nothing"]
    note: str  # one short line of what the camera actually shows


VERIFY_SYSTEM = (
    "You are verifying a reported incident by looking at a nearby traffic "
    "camera. Report only what is visibly true in the image. Stay aggregate and "
    "anonymous — never identify a vehicle, plate or person. 'confirmed' only if "
    "the scene visibly supports the report (e.g. stopped traffic, emergency "
    "vehicles, a collision, a crowd, hazards); 'nothing' if it looks normal/"
    "clear; 'unclear' if the view can't tell. Keep the note under 16 words."
)


class VisionUnavailable(RuntimeError):
    pass


class CameraAnalyst:
    def __init__(self, model: str, api_key: str) -> None:
        self._model = model
        self._api_key = api_key
        self._client: anthropic.AsyncAnthropic | None = None
        self._http = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0),
            headers={"User-Agent": "ais-tracker/1.0"},
        )

    def _ensure_client(self) -> anthropic.AsyncAnthropic:
        if not self._api_key:
            raise VisionUnavailable("Claude API not configured — set ANTHROPIC_API_KEY")
        if self._client is None:
            # 529 "overloaded" comes in short bursts; give the SDK's exponential
            # backoff enough attempts to ride one out instead of failing the scene.
            self._client = anthropic.AsyncAnthropic(api_key=self._api_key, max_retries=4)
        return self._client

    async def close(self) -> None:
        await self._http.aclose()

    async def _load(self, image: str | bytes) -> tuple[str, str]:
        """(media_type, base64) for a snapshot given as a URL or raw bytes —
        providers we proxy (Traffic Scotland) hand us the frame directly."""
        if isinstance(image, bytes):
            return "image/jpeg", base64.standard_b64encode(image).decode()
        img = await self._http.get(image)
        img.raise_for_status()
        media_type = img.headers.get("content-type", "image/jpeg").split(";")[0]
        return media_type, base64.standard_b64encode(img.content).decode()

    async def analyze(self, image: str | bytes) -> CameraAnalysis:
        client = self._ensure_client()  # raises VisionUnavailable if no key
        media_type, b64 = await self._load(image)

        resp = await client.with_options(timeout=30).messages.parse(
            model=self._model,
            max_tokens=500,
            system=SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": USER},
                    ],
                }
            ],
            output_format=CameraAnalysis,
        )
        out = resp.parsed_output
        if out is None:
            raise VisionUnavailable("model returned no analysis")
        return out

    async def verify(self, image: str | bytes, incident_desc: str) -> IncidentVerdict:
        """Look through a camera and judge whether it supports a reported incident."""
        client = self._ensure_client()
        media_type, b64 = await self._load(image)
        resp = await client.with_options(timeout=30).messages.parse(
            model=self._model,
            max_tokens=200,
            system=VERIFY_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                        {"type": "text", "text": f"Reported incident: {incident_desc}\nWhat does this camera show?"},
                    ],
                }
            ],
            output_format=IncidentVerdict,
        )
        out = resp.parsed_output
        if out is None:
            raise VisionUnavailable("model returned no verdict")
        return out
