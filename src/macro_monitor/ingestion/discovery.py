"""Landing-page link discovery for ``kind: bulk`` groups (ADR-028), pure over page bytes.

The network step stays in ``BulkConnector.fetch``. :func:`resolve_link` reads the ``<a href>``
values of an HTML page, resolves them against the page URL, keeps those that match the anchored
``link_pattern`` and demands exactly ``expect_matches`` distinct URLs (fail closed, no guessing).
Only anchors count: links in comments, scripts or text are ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urldefrag, urljoin, urlsplit

from lxml import html

from macro_monitor.models.types import ResolveSpec

#: hrefs longer than this are skipped (no legitimate file link is that long)
MAX_HREF_LEN = 2048


class DiscoveryFailed(Exception):
    """Discovery could not prove which file to fetch; the group's fetch stops (ADR-028 Decision 5).

    ``error_class`` is the classification stored in ``ingest.fetch_attempt``."""

    error_class = "discovery_failed"


@dataclass(frozen=True)
class LinkMatch:
    matched_href: str  # as found, before resolution
    resolved_url: str


def host_allowed(url: str, allowed_hosts: tuple[str, ...]) -> bool:
    """https only, and the exact host (no suffix or prefix matching) is on the list."""
    parts = urlsplit(url)
    return (
        parts.scheme == "https"
        and parts.hostname is not None
        and (parts.hostname.lower() in {h.lower() for h in allowed_hosts})
    )


def resolve_link(page: bytes, page_url: str, spec: ResolveSpec) -> LinkMatch:
    """Return the single matching link or raise :class:`DiscoveryFailed`."""
    if not page.strip():
        raise DiscoveryFailed("landing page is empty")
    try:
        doc = html.fromstring(page)
    except Exception as exc:  # lxml raises several error types for unparseable input
        raise DiscoveryFailed(f"landing page is not parseable HTML: {type(exc).__name__}") from exc
    try:
        pattern = re.compile(spec.link_pattern, re.ASCII)
        found: dict[str, str] = {}  # resolved url -> first href as found
        for href in doc.xpath("//a/@href"):
            raw = str(href).strip()
            if len(raw) > MAX_HREF_LEN:
                continue
            try:
                url = urldefrag(urljoin(page_url, raw))[0]
            except ValueError:  # e.g. 'http://[' : not a URL, so not a candidate
                continue
            if pattern.fullmatch(url):
                found.setdefault(url, raw)
    except DiscoveryFailed:
        raise
    except Exception as exc:
        raise DiscoveryFailed(f"link resolution failed: {type(exc).__name__}") from exc
    if len(found) != spec.expect_matches:
        raise DiscoveryFailed(
            f"expected {spec.expect_matches} distinct link(s) matching the pattern, "
            f"found {len(found)}"
        )
    (url, raw), *_ = found.items()
    if not host_allowed(url, spec.allowed_hosts):
        raise DiscoveryFailed(
            f"matched link is not https on an allowed host: {urlsplit(url).netloc}"
        )
    return LinkMatch(matched_href=raw, resolved_url=url)
