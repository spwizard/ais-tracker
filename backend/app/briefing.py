"""LLM risk briefing.

Assembles a curated, ID'd *evidence pack* from the deterministic signals we
already produce (sanctions, Lloyd's ownership, behavioral risk events, flag /
identity) and asks Claude to synthesize a structured, cited briefing. The model
never detects or invents — it explains and prioritizes the supplied evidence,
and must cite an evidence id for every finding.

Design notes:
  • Static system prompt is sent with `cache_control` so it's cached across
    briefings (the only per-request variation is the evidence in the user turn).
  • Structured output via `messages.parse()` → validated Pydantic model.
  • Results are memoized by a hash of the evidence, so re-opening the same
    vessel with unchanged signals doesn't re-call the API.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import List, Literal

import anthropic
import httpx
from pydantic import BaseModel

from .risk_score import FLAGS_OF_CONVENIENCE, _ownership_mismatch

log = logging.getLogger("briefing")

Severity = Literal["low", "medium", "high", "critical"]


class Finding(BaseModel):
    title: str
    severity: Severity
    confidence: Literal["confirmed", "suspicious"]
    evidence_ids: List[str]


class OpenSourceFinding(BaseModel):
    claim: str
    source_url: str
    as_of: str  # date the source gives, or "unknown"


class OpenSourceList(BaseModel):
    findings: List[OpenSourceFinding]


class Briefing(BaseModel):
    risk_level: Severity
    summary: str
    findings: List[Finding]
    recommended_actions: List[str]
    caveats: List[str]


class BriefingUnavailable(RuntimeError):
    """Raised when the briefing can't be produced (no API key / upstream error)."""


# USD per 1M tokens (input, output) — from the model pricing table.
PRICING = {
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
WEB_SEARCH_USD = 0.01  # ~$10 / 1000 searches


def _call_cost(model: str, usage) -> float:
    """Approx USD for one Messages call (cache reads ~0.1×, writes ~1.25×)."""
    in_price, out_price = PRICING.get(model, (5.0, 25.0))
    it = getattr(usage, "input_tokens", 0) or 0
    ot = getattr(usage, "output_tokens", 0) or 0
    cr = getattr(usage, "cache_read_input_tokens", 0) or 0
    cc = getattr(usage, "cache_creation_input_tokens", 0) or 0
    return ((it + cr * 0.1 + cc * 1.25) * in_price + ot * out_price) / 1_000_000


def _friendly_error(exc: Exception) -> str:
    msg = str(exc).lower()
    if "credit balance" in msg or "billing" in msg:
        return "Claude API is out of credits — add credits in the Anthropic console."
    if "authentication" in msg or "x-api-key" in msg:
        return "Claude API key is invalid — check ANTHROPIC_API_KEY."
    if "rate limit" in msg or "overloaded" in msg:
        return "Claude API is rate-limited or overloaded — try again shortly."
    return "Claude API error — see server logs."


SYSTEM_PROMPT = """\
You are a senior maritime risk analyst. You write briefings on individual \
vessels for a sanctions-compliance and dark-activity monitoring team. Your \
briefing is read by human investigators who decide whether a vessel warrants a \
closer look — you do not make that determination yourself.

You are given an EVIDENCE PACK: a list of discrete, pre-verified evidence items, \
each with an `id`, a `type`, a plain-language `summary`, and a `source`. These \
items were produced by deterministic detectors and authoritative datasets. Your \
job is to SYNTHESIZE them into a clear, prioritized, cited briefing. You never \
introduce facts that are not present in the evidence pack.

RULES OF ENGAGEMENT
1. Ground everything. Every finding MUST cite at least one evidence id from the \
   pack in its `evidence_ids`. Never state, imply, or infer anything that is not \
   supported by a supplied evidence item. If the evidence is thin, say so in the \
   caveats and keep the risk level low.
2. Do not allege criminality. You are flagging risk for human review, not \
   adjudicating guilt. Use calibrated language: "consistent with", "indicative \
   of", "warrants investigation", "unable to exclude". Never write that a party \
   "is" sanctioned-evading, smuggling, or committing a crime.
3. Mark confidence per finding:
   • "confirmed"  — a direct, factual match in an authoritative dataset (e.g. an \
     exact sanctions-list hit on the vessel or a named owner).
   • "suspicious" — a behavioral or structural indicator that is suggestive but \
     not conclusive on its own (e.g. an STS rendezvous, going dark, a flag of \
     convenience, opaque ownership).
4. Weigh the signals appropriately:
   • A sanctions-list match on the vessel or a beneficial owner/operator is the \
     most serious signal and should dominate the risk level.
   • Behavioral indicators — going dark, ship-to-ship (STS) rendezvous away from \
     port, impossible movement / AIS position spoofing — are serious, especially \
     when several co-occur or corroborate a sanctions signal.
   • Structural indicators — flag of convenience, opaque ownership where country \
     of control, domicile and registration diverge — are contributing factors \
     that rarely justify a high rating on their own.
5. Calibrate the overall `risk_level` to the strongest corroborated evidence, \
   not the raw count of findings. One confirmed sanctions hit outranks several \
   weak structural indicators.
6. Recommended actions must be concrete, evidence-driven next steps for an \
   investigator (e.g. "identify and screen the STS counterpart vessel", \
   "re-screen the beneficial owner against the latest OFAC update"), not generic \
   advice.
7. Caveats must surface the real limitations: ownership data is a point-in-time \
   snapshot and may be outdated; MMSI identifiers can be reflagged; the absence \
   of a signal is not evidence of legitimacy; behavioral detections are heuristic.

GLOSSARY
• OFAC SDN — the U.S. Specially Designated Nationals sanctions list.
• STS (ship-to-ship) transfer — two vessels meeting at sea to transfer cargo; \
  legitimate in many contexts, but a known method for disguising the origin of \
  sanctioned cargo when done covertly away from port.
• Going dark — a vessel ceasing AIS transmission, often to conceal a port call \
  or rendezvous.
• AIS spoofing — manipulating broadcast GPS position; surfaces as physically \
  impossible jumps between fixes.
• Flag of convenience — registration in an open registry with light oversight.
• Opaque ownership — the country of control, domicile and registration of an \
  owning entity diverging, obscuring ultimate beneficial ownership.

Keep the summary to one or two sentences. Be precise and factual; no filler."""


WEB_SYNTH_PROMPT = """\
You extract noteworthy, maritime-relevant facts about a vessel from web search \
results. From the provided results, list concrete findings — sanctions \
designations, detentions or seizures, casualties or incidents, ownership/operator \
or flag changes, and dark-fleet or sanctions-evasion reporting. For each finding \
set `source_url` to the EXACT url of the result it came from (never invent one) \
and `as_of` to the date the source gives, or "unknown". Be conservative: include \
only substantive, specific items actually supported by the results; skip generic \
directory listings and anything you can't tie to a result. Return an empty list \
if nothing noteworthy is present. This material is unverified open-source context."""


class BriefingService:
    def __init__(
        self,
        model: str,
        api_key: str = "",
        web_search: bool = True,
        search_model: str = "claude-haiku-4-5",
        tavily_key: str = "",
    ) -> None:
        self._model = model
        self._search_model = search_model
        self._api_key = api_key or None  # None → SDK resolves from env
        self._web = web_search
        self._tavily_key = tavily_key
        self._client: anthropic.AsyncAnthropic | None = None
        self._cache: dict[str, dict] = {}

    def _ensure_client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            try:
                self._client = anthropic.AsyncAnthropic(
                    api_key=self._api_key, max_retries=1
                )
            except Exception as exc:  # missing ANTHROPIC_API_KEY, etc.
                raise BriefingUnavailable(
                    "Claude API not configured — set ANTHROPIC_API_KEY"
                ) from exc
        return self._client

    @staticmethod
    def build_evidence(
        vessel,
        ownership: dict | None,
        sanctioned_vessel: dict | None,
        owner_hits: list[tuple[str, str]],
        recent_events: list[dict],
    ) -> list[dict]:
        ev: list[dict] = []

        def add(type_: str, summary: str, source: str, observed_at=None) -> None:
            item = {"id": f"ev{len(ev) + 1}", "type": type_, "summary": summary, "source": source}
            if observed_at is not None:
                item["observed_at"] = round(observed_at)
            ev.append(item)

        flag = (ownership or {}).get("flag")
        add(
            "identity",
            f"Vessel '{vessel.name or 'unknown'}' — MMSI {vessel.mmsi}, "
            f"IMO {vessel.imo or 'n/a'}, flag {flag or 'n/a'}, AIS type code {vessel.ship_type}",
            "AIS + Lloyd's",
        )
        if sanctioned_vessel:
            add(
                "sanctions",
                f"Vessel matches an OFAC SDN sanctions-list entry: "
                f"{sanctioned_vessel.get('name')} (IMO {sanctioned_vessel.get('imo')})",
                "OFAC SDN via OpenSanctions",
            )
        for role, name in owner_hits:
            add("sanctions", f"{role} '{name}' matches a sanctioned entity", "OFAC SDN via OpenSanctions")

        if ownership:
            bo = ownership.get("beneficial_owner")
            if bo:
                add(
                    "ownership",
                    f"Beneficial owner: {bo} (control {ownership.get('beneficial_owner_control')}, "
                    f"domicile {ownership.get('beneficial_owner_domicile')})",
                    "Lloyd's (2023 snapshot)",
                )
            ro = ownership.get("reg_owner")
            if ro:
                add(
                    "ownership",
                    f"Registered owner: {ro} (domicile {ownership.get('reg_owner_domicile')}, "
                    f"registration {ownership.get('reg_owner_reg')})",
                    "Lloyd's (2023 snapshot)",
                )
            if flag and flag.upper() in FLAGS_OF_CONVENIENCE:
                add("flag", f"Flag of convenience: {flag}", "derived from Lloyd's flag")
            if _ownership_mismatch(ownership):
                add(
                    "ownership",
                    "Country of control, domicile and registration diverge across the "
                    "ownership chain (ownership-opacity indicator)",
                    "derived from Lloyd's",
                )
            ex = ownership.get("ex_name")
            if ex:
                add("identity", f"Vessel previously named '{ex}' (identity change)", "Lloyd's")

        for e in recent_events:
            if e["kind"] == "rendezvous":
                add(
                    "behavior",
                    "Recent sustained close-proximity meeting with another vessel at sea, "
                    "away from port (possible ship-to-ship transfer)",
                    "risk engine (rendezvous detector)",
                    e["ts"],
                )
            elif e["kind"] == "spoof":
                add(
                    "behavior",
                    "Recent position jump implying an impossible speed between fixes "
                    "(consistent with AIS/GPS spoofing)",
                    "risk engine (spoof detector)",
                    e["ts"],
                )

        add(
            "state",
            f"Last reported position {vessel.lat}, {vessel.lon}; speed {vessel.sog} kn; "
            f"nav status {vessel.nav_status}",
            "AIS",
            vessel.ts,
        )
        return ev

    _EMPTY_WEB = {"open_source": [], "sources": [], "cost": 0.0, "searches": 0, "tokens": 0}

    async def _tavily_search(self, vessel) -> list[dict]:
        """Cheap, fast search + content extraction via Tavily (no LLM)."""
        if not self._tavily_key:
            log.warning("web search requested but TAVILY_API_KEY not set")
            return []
        name = vessel.name or f"MMSI {vessel.mmsi}"
        imo = f" IMO {vessel.imo}" if vessel.imo else ""
        query = f"{name}{imo} vessel ship sanctions detention owner flag incident"
        payload = {
            "query": query,
            "max_results": 6,
            "search_depth": "basic",
            "include_answer": False,
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as http:
                r = await http.post(
                    "https://api.tavily.com/search",
                    json=payload,
                    headers={"Authorization": f"Bearer {self._tavily_key}"},
                )
                r.raise_for_status()
                return r.json().get("results", []) or []
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Tavily search failed (continuing without it): %s", exc)
            return []

    async def _web_research(self, vessel, enabled: bool) -> dict:
        """Tavily search/scrape → a single cheap model call turns the results
        into cited open-source findings. No Claude in the search loop."""
        if not enabled:
            return dict(self._EMPTY_WEB)

        results = await self._tavily_search(vessel)
        sources = [{"title": r.get("title") or r["url"], "url": r["url"]} for r in results if r.get("url")]
        if not results:
            return {**self._EMPTY_WEB, "searches": 1}

        formatted = "\n\n".join(
            f"[{r.get('url')}] {r.get('title', '')}"
            + (f" ({r['published_date']})" if r.get("published_date") else "")
            + f"\n{(r.get('content') or '')[:1200]}"
            for r in results
        )
        name = vessel.name or f"MMSI {vessel.mmsi}"
        imo = f", IMO {vessel.imo}" if vessel.imo else ""
        user = (
            f"Vessel: {name}{imo}\n\nWeb search results:\n{formatted}\n\n"
            "Extract the noteworthy maritime findings, citing the source url for each."
        )
        client = self._ensure_client()
        try:
            resp = await client.with_options(timeout=40).messages.parse(
                model=self._search_model,  # cheap model — just structures the results
                max_tokens=1500,
                system=WEB_SYNTH_PROMPT,
                messages=[{"role": "user", "content": user}],
                output_format=OpenSourceList,
            )
        except anthropic.APIError as exc:
            log.warning("web synthesis failed (continuing without it): %s", exc)
            return {**self._EMPTY_WEB, "sources": sources, "searches": 1}

        out = resp.parsed_output
        open_source = [f.model_dump() for f in out.findings] if out else []
        u = resp.usage
        tokens = (getattr(u, "input_tokens", 0) or 0) + (getattr(u, "output_tokens", 0) or 0)
        log.info(
            "web research for %s: %d sources → %d findings (Tavily + %s)",
            vessel.mmsi,
            len(sources),
            len(open_source),
            self._search_model,
        )
        return {
            "open_source": open_source,
            "sources": sources,
            "cost": _call_cost(self._search_model, u),  # Tavily free tier
            "searches": 1,
            "tokens": tokens,
        }

    async def generate(
        self,
        vessel,
        ownership: dict | None,
        sanctioned_vessel: dict | None,
        owner_hits: list[tuple[str, str]],
        recent_events: list[dict],
        web_search: bool | None = None,
    ) -> dict:
        use_web = self._web if web_search is None else web_search
        evidence = self.build_evidence(
            vessel, ownership, sanctioned_vessel, owner_hits, recent_events
        )
        # Cache on the *substantive* signals only — exclude the live position
        # fix and timestamps, which churn every AIS tick and would otherwise
        # defeat the cache for repeat views of the same vessel. The web flag is
        # part of the key so web and non-web briefings cache separately.
        stable = [
            {k: val for k, val in e.items() if k != "observed_at"}
            for e in evidence
            if e["type"] != "state"
        ]
        key = hashlib.sha256(
            json.dumps({"web": use_web, "ev": stable}, sort_keys=True).encode()
        ).hexdigest()
        if key in self._cache:
            return self._cache[key]

        client = self._ensure_client()
        # Web open-source enrichment runs independently of the deterministic
        # briefing (Tavily search + a cheap model), so the Opus call stays focused.
        web = await self._web_research(vessel, use_web)
        user = (
            "Produce a risk briefing for the vessel described by the evidence pack "
            "below. Cite the relevant evidence id(s) in every finding, and ground the "
            "risk level and findings solely on this evidence.\n\n"
            f"<evidence_pack>\n{json.dumps(evidence, indent=2)}\n</evidence_pack>"
        )
        try:
            resp = await client.with_options(timeout=120).messages.parse(
                model=self._model,
                max_tokens=6000,
                thinking={"type": "adaptive"},
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        # Static prefix → cached across briefings (per-request
                        # variation lives entirely in the user turn below).
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user}],
                output_format=Briefing,
            )
        except anthropic.APIError as exc:
            log.warning("briefing API error: %s", exc)
            raise BriefingUnavailable(_friendly_error(exc)) from exc

        briefing = resp.parsed_output
        if briefing is None:
            raise BriefingUnavailable("model did not return a structured briefing")

        u = resp.usage
        log.info(
            "briefing for %s: %d findings · cache_read=%s input=%s output=%s",
            vessel.mmsi,
            len(briefing.findings),
            getattr(u, "cache_read_input_tokens", None),
            getattr(u, "input_tokens", None),
            getattr(u, "output_tokens", None),
        )

        synth_cost = _call_cost(self._model, u)
        synth_tokens = (getattr(u, "input_tokens", 0) or 0) + (
            getattr(u, "output_tokens", 0) or 0
        )
        cost = {
            "usd": round(web["cost"] + synth_cost, 4),
            "tokens": web["tokens"] + synth_tokens,
            "searches": web["searches"],
        }
        log.info("briefing for %s cost ~$%.4f", vessel.mmsi, cost["usd"])

        briefing_dict = briefing.model_dump()
        # Attach the separately-produced open-source findings (Tavily + cheap model).
        briefing_dict["open_source"] = web["open_source"]

        result = {
            "briefing": briefing_dict,
            "evidence": evidence,
            "sources": web["sources"],
            "cost": cost,
        }
        self._cache[key] = result
        return result
