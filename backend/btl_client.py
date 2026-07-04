import asyncio
import hashlib
import json
import httpx
from config import settings
from prompts import SYSTEM_INSTRUCTION, build_user_prompt, CONDENSATION_SYSTEM_PROMPT
from models import TokenUsage, CostData

BTL_BASE = "https://api.badtheorylabs.com/v1"
BTL_MODEL = "btl-2"

INPUT_PRICE_PER_1M = 0.15
OUTPUT_PRICE_PER_1M = 0.60


def _headers():
    return {
        "Authorization": f"Bearer {settings.btl_api_key}",
        "Content-Type": "application/json",
    }


def extract_usage(data: dict) -> TokenUsage:
    usage = data.get("usage", {})
    return TokenUsage(
        input_tokens=usage.get("prompt_tokens", 0),
        output_tokens=usage.get("completion_tokens", 0),
        total_tokens=usage.get("total_tokens", 0),
        cached_tokens=0,
    )


def calculate_cost(usage: TokenUsage) -> CostData:
    input_cost = (usage.input_tokens / 1_000_000) * INPUT_PRICE_PER_1M
    output_cost = (usage.output_tokens / 1_000_000) * OUTPUT_PRICE_PER_1M
    return CostData(
        input_cost=input_cost,
        output_cost=output_cost,
        total_cost=input_cost + output_cost,
    )


async def _chat_completion(
    client: httpx.AsyncClient,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 65536,
    temperature: float = 0.0,
) -> dict:
    payload = {
        "model": BTL_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    max_retries = 3
    for attempt in range(max_retries):
        try:
            resp = await client.post(
                f"{BTL_BASE}/chat/completions",
                json=payload,
                headers=_headers(),
                timeout=120.0,
            )
            if resp.status_code == 429:
                if attempt < max_retries - 1:
                    wait = 2**attempt
                    await asyncio.sleep(wait)
                    continue
                else:
                    resp.raise_for_status()
            resp.raise_for_status()
            data = resp.json()
            choice = data["choices"][0]
            finish = choice.get("finish_reason", "stop")
            if finish == "length":
                raise Exception("Output exceeded token limit. Try reducing batch size.")
            return data
        except httpx.HTTPStatusError:
            raise
        except Exception as e:
            if attempt >= max_retries - 1:
                raise
            await asyncio.sleep(2**attempt)


class BTLClient:
    def __init__(self):
        self.client: httpx.AsyncClient | None = None

    async def _ensure_client(self):
        if self.client is None:
            self.client = httpx.AsyncClient()

    # ── Embeddings ───────────────────────────────────────────────

    async def generate_embedding(self, text: str) -> list[float]:
        await self._ensure_client()
        payload = {
            "model": "text-embedding-3-small",
            "input": text,
        }
        resp = await self.client.post(
            f"{BTL_BASE}/embeddings",
            json=payload,
            headers=_headers(),
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["data"][0]["embedding"]

    async def generate_embeddings(self, texts: list[str]) -> list[list[float]]:
        await self._ensure_client()
        payload = {
            "model": "text-embedding-3-small",
            "input": texts,
        }
        resp = await self.client.post(
            f"{BTL_BASE}/embeddings",
            json=payload,
            headers=_headers(),
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return [item["embedding"] for item in data["data"]]

    # ── Workflow Analysis ────────────────────────────────────────

    async def analyze_workflow(
        self,
        code: str,
        metadata: list = None,
        correction_prompt: str = None,
        http_connections: str = None,
    ) -> tuple[str, TokenUsage, CostData]:
        await self._ensure_client()
        user_prompt = build_user_prompt(code, metadata, http_connections)
        if correction_prompt:
            user_prompt = f"{user_prompt}\n\n{correction_prompt}"

        data = await _chat_completion(
            self.client,
            system_prompt=SYSTEM_INSTRUCTION,
            user_prompt=user_prompt,
            max_tokens=65536,
            temperature=0.0,
        )
        text = data["choices"][0]["message"]["content"]
        usage = extract_usage(data)
        cost = calculate_cost(usage)
        return text, usage, cost

    # ── Multi-Model Comparison ───────────────────────────────────

    async def analyze_with_model(
        self,
        code: str,
        metadata: list = None,
        http_connections: str = None,
    ) -> tuple[str, TokenUsage, CostData]:
        await self._ensure_client()
        user_prompt = build_user_prompt(code, metadata, http_connections)
        data = await _chat_completion(
            self.client,
            system_prompt=SYSTEM_INSTRUCTION,
            user_prompt=user_prompt,
            max_tokens=65536,
            temperature=0.0,
        )
        text = data["choices"][0]["message"]["content"]
        usage = extract_usage(data)
        cost = calculate_cost(usage)
        return text, usage, cost

    async def analyze_workflow_compare(
        self,
        code: str,
        metadata: list = None,
        http_connections: str = None,
    ) -> list[tuple[str, str, TokenUsage, CostData, str | None]]:
        """
        Run analysis through BTL Runtime. Returns results with model attribution.
        BTL Runtime may route to different backends — we capture what's used.
        """
        results = []
        try:
            text, usage, cost = await self.analyze_with_model(
                code, metadata, http_connections
            )
            results.append((BTL_MODEL, text, usage, cost, None))
        except Exception as e:
            results.append((BTL_MODEL, "", TokenUsage(input_tokens=0, output_tokens=0, total_tokens=0), CostData(input_cost=0, output_cost=0, total_cost=0), str(e)))

        return results

    # ── Structure Condensation ───────────────────────────────────

    async def condense_repo_structure(
        self, raw_structure: str
    ) -> tuple[str, TokenUsage, CostData]:
        await self._ensure_client()
        user_prompt = f"""Analyze this codebase structure and identify LLM/AI workflows.

<raw_structure>
{raw_structure}
</raw_structure>

Output a condensed workflow structure following the system instructions."""

        data = await _chat_completion(
            self.client,
            system_prompt=CONDENSATION_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            max_tokens=8192,
            temperature=0.0,
        )
        text = data["choices"][0]["message"]["content"]
        usage = extract_usage(data)
        cost = calculate_cost(usage)
        return text, usage, cost

    # ── Metadata Generation ──────────────────────────────────────

    async def generate_metadata(
        self, prompt: str
    ) -> tuple[str, TokenUsage, CostData]:
        await self._ensure_client()
        data = await _chat_completion(
            self.client,
            system_prompt="You are a code analysis assistant. Respond with valid JSON only.",
            user_prompt=prompt,
            max_tokens=8192,
            temperature=0.0,
        )
        text = data["choices"][0]["message"]["content"]
        usage = extract_usage(data)
        cost = calculate_cost(usage)
        return text, usage, cost

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None


btl_client = BTLClient()
