"""Gemini (google-genai) helpers shared by the briefing + analyst services.

Two primitives mirror what those services need from Claude, so each can switch
on ``LLM_PROVIDER`` with a small branch rather than a rewrite:

* ``generate_structured`` — one call returning a validated Pydantic object
  (Gemini ``response_schema``), used by the briefing + web synthesis.
* ``stream_turn`` — one streaming turn of a function-calling loop, yielding text
  deltas and returning the model's content + any function calls, used by the
  analyst (which owns the loop and executes the tools).

Gemini 2.5 models "think" by default, which silently eats a small output budget;
we pass ``thinking_budget`` explicitly (0 = off) so latency/cost stay predictable.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, AsyncIterator

from google import genai
from google.genai import types
from pydantic import BaseModel

log = logging.getLogger("gemini")

# USD per 1M tokens (input, output) — Gemini 2.5 standard tier (approx).
PRICING: dict[str, tuple[float, float]] = {
    "gemini-2.5-pro": (1.25, 10.0),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.0-flash": (0.10, 0.40),
}


@lru_cache(maxsize=4)
def get_client(api_key: str) -> genai.Client:
    return genai.Client(api_key=api_key)


def cost(model: str, usage) -> float:
    """Approx USD for one call from Gemini usage metadata."""
    if usage is None:
        return 0.0
    in_price, out_price = PRICING.get(model, (0.30, 2.50))
    pt = getattr(usage, "prompt_token_count", 0) or 0
    ct = getattr(usage, "candidates_token_count", 0) or 0
    tt = getattr(usage, "thoughts_token_count", 0) or 0
    return (pt * in_price + (ct + tt) * out_price) / 1_000_000


def tokens(usage) -> int:
    return getattr(usage, "total_token_count", 0) or 0 if usage else 0


def make_tools(tool_defs: list[dict]) -> list[types.Tool]:
    """Wrap JSON-Schema tool defs (Anthropic-style) as Gemini function decls.
    Gemini accepts the raw JSON Schema via ``parameters_json_schema``."""
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name=t["name"],
                    description=t.get("description", ""),
                    parameters_json_schema=t.get("input_schema") or {"type": "object", "properties": {}},
                )
                for t in tool_defs
            ]
        )
    ]


async def generate_structured(
    api_key: str,
    model: str,
    system: str,
    prompt: str,
    schema: type[BaseModel],
    *,
    max_output_tokens: int = 8000,
    thinking_budget: int = 0,
) -> tuple[BaseModel | None, Any]:
    """One structured-output call → (validated model | None, usage)."""
    client = get_client(api_key)
    resp = await client.aio.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=schema,
            max_output_tokens=max_output_tokens,
            thinking_config=types.ThinkingConfig(thinking_budget=thinking_budget),
        ),
    )
    return resp.parsed, resp.usage_metadata


class TurnResult:
    """Outcome of one streaming turn: the model's content (to append to the
    running conversation), its function calls, and usage."""

    def __init__(self, content, function_calls: list, usage) -> None:
        self.content = content
        self.function_calls = function_calls
        self.usage = usage


async def stream_turn(
    api_key: str,
    model: str,
    system: str,
    contents: list,
    tools: list[types.Tool],
    *,
    max_output_tokens: int = 1500,
    thinking_budget: int = 0,
) -> AsyncIterator:
    """Run one streaming turn. Yields ``{"text": ...}`` for each text delta,
    then a final ``TurnResult``. Reading parts directly avoids the SDK's
    'non-text parts' warning when a turn mixes text and function calls."""
    client = get_client(api_key)
    stream = await client.aio.models.generate_content_stream(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system,
            tools=tools,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(mode="AUTO")
            ),
            max_output_tokens=max_output_tokens,
            thinking_config=types.ThinkingConfig(thinking_budget=thinking_budget),
        ),
    )
    content = None
    usage = None
    calls: list = []
    async for chunk in stream:
        if chunk.usage_metadata:
            usage = chunk.usage_metadata
        if not chunk.candidates:
            continue
        cand = chunk.candidates[0]
        if cand.content:
            content = cand.content
            for part in cand.content.parts or []:
                if getattr(part, "text", None):
                    yield {"text": part.text}
                fc = getattr(part, "function_call", None)
                if fc is not None:
                    calls.append(fc)
    yield TurnResult(content, calls, usage)


def function_response(name: str, result: Any):
    """Build the role='tool' content turn carrying a tool result."""
    return types.Content(
        role="tool",
        parts=[types.Part.from_function_response(name=name, response={"result": result})],
    )


def user_turn(text: str):
    return types.Content(role="user", parts=[types.Part(text=text)])
