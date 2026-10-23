"""Cliente HTTP compartilhado: limite de taxa por provider, retentativas e User-Agent identificável."""

import asyncio
import email.utils
import logging
import time

import httpx
from aiolimiter import AsyncLimiter
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_random_exponential

from app.integrations.base import ProviderError

log = logging.getLogger(__name__)

USER_AGENT = "GamerHub/1.0 (self-hosted game backlog)"
RETRY_STATUSES = {429, 500, 502, 503, 504}


class RetryableStatus(Exception):
    def __init__(self, response: httpx.Response):
        super().__init__(f"HTTP {response.status_code}")
        self.response = response


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if not value:
        return None
    if value.isdigit():
        return float(value)
    parsed = email.utils.parsedate_to_datetime(value)
    return max(0.0, parsed.timestamp() - time.time()) if parsed else None


def _is_retryable(exc: BaseException) -> bool:
    return isinstance(exc, (RetryableStatus, httpx.TimeoutException, httpx.TransportError))


class RateLimitedClient:
    def __init__(
        self,
        provider: str,
        *,
        rate: float,
        per: float = 1.0,
        concurrency: int = 4,
        base_url: str = "",
        headers: dict[str, str] | None = None,
        attempts: int = 3,
    ):
        self.provider = provider
        self._limiter = AsyncLimiter(rate, per)
        self._sem = asyncio.Semaphore(concurrency)
        self._attempts = attempts
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"User-Agent": USER_AGENT, **(headers or {})},
            timeout=httpx.Timeout(15.0, connect=10.0),
            follow_redirects=True,
        )

    async def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self._attempts),
                wait=wait_random_exponential(multiplier=0.5, max=8),
                retry=retry_if_exception(_is_retryable),
                reraise=True,
            ):
                with attempt:
                    async with self._sem, self._limiter:
                        response = await self._client.request(method, url, **kwargs)
                    if response.status_code in RETRY_STATUSES:
                        wait = _retry_after(response)
                        if wait:
                            await asyncio.sleep(min(wait, 30))
                        raise RetryableStatus(response)
                    return response
        except RetryableStatus as e:
            raise ProviderError(f"{self.provider}: HTTP {e.response.status_code} após {self._attempts} tentativas") from e
        except httpx.HTTPError as e:
            raise ProviderError(f"{self.provider}: falha de rede ({type(e).__name__})") from e
        raise AssertionError("unreachable")

    async def get_json(self, url: str, **kwargs) -> dict | list:
        response = await self.request("GET", url, **kwargs)
        return self._json(response)

    async def post_json(self, url: str, **kwargs) -> dict | list:
        response = await self.request("POST", url, **kwargs)
        return self._json(response)

    def _json(self, response: httpx.Response) -> dict | list:
        if response.status_code == 404:
            raise ProviderError(f"{self.provider}: não encontrado (404)")
        if response.status_code >= 400:
            raise ProviderError(f"{self.provider}: HTTP {response.status_code}: {response.text[:200]}")
        try:
            return response.json()
        except ValueError as e:
            raise ProviderError(f"{self.provider}: resposta não é JSON") from e

    async def aclose(self) -> None:
        await self._client.aclose()
