"""The one definition of the published indicator set (export-real-data-amendment.md, P2-A).

An indicator is published only if ``kind = 'indicator'``, it is not a comparison series and it
is a member of at least one domain. Every export producer and the checks use this single SQL,
so they cannot drift.
"""

from __future__ import annotations

PUBLISHED_INDICATOR_IDS_SQL = (
    "SELECT i.indicator_id FROM ref.indicator i "
    "WHERE i.kind = 'indicator' AND NOT i.is_comparison "
    "AND EXISTS (SELECT 1 FROM ref.indicator_domain d WHERE d.indicator_id = i.indicator_id)"
)
