# Runbook: `discovery_failed` alert (ADR-028, task T64)

Applies to bulk groups with a `request_template.discover` block: `pinksheet_monthly`
(`worldbank_pinksheet`) and `fao_csdb` (`fao`). Both sources are `enabled: false` until the
operator probe and the licence decision.

## What it means
The connector fetched the landing page but could not prove which file to download: zero or more
than one link matched the anchored `link_pattern`, the match was off the `allowed_hosts` list, the
landing response was not HTML 200, the landing page was too large (over 2 MiB; the download is
cut off while streaming), the file request refused a redirect (to a non-TLS URL, an unlisted host
or after too many redirects), or the downloaded file was not an xlsx workbook. Nothing was
stored. The connector never falls back to a remembered or date-guessed URL (ADR-028 Decision 6).
A bot challenge is `blocked` (ADR-005), not `discovery_failed`.

## What to check
1. `ingest.fetch_attempt` (`error_class = 'discovery_failed'`): `error_detail` says which assertion failed.
2. Open the landing page in a browser (`config/sources.yaml`, `discover.landing_url`). Is the file link still there, once, with the expected host and file name? A redesign or a second link (for example an archive list) breaks the pattern.
3. If the link moved or its shape changed, update `link_pattern` in `config/sources.yaml` by a reviewed change; do not loosen the host part or drop the anchors.

## Manual fallback
Download the file by hand and import it through the manual source of the same file:
`worldbank_pinksheet_manual` (group `pinksheet_manual`) or `fao_manual` (group `fao_csdb_manual`).
Put it in `manual_inbox/<source_id>/<YYYY-MM>/` with a `.meta.yaml` sidecar, then run
`macro-monitor ingest-manual --group <group>`. Both fallback groups require these sidecar fields
(`sidecar_required` in `config/sources.yaml`): `source_url`, `downloaded_on`, `downloaded_by`,
`edition_label` (for example `PINKSHEET-2026-11`) and `edition_date` (the publication date of the
edition, ISO `YYYY-MM-DD`). `licence_note` and `import_label` are optional.
Manual rows load under their own source id, with the `fallback` role; they are not merged with the
automated rows. The fallback groups also use their own dataset keys (not the logical dataset of the
discovered group), so the manual series are separate from the automated ones.

## FAO caveat
The cereal-brief page keeps only the newest file. If a month is missed and FAO replaces the file,
that vintage is lost; the freshness alert is the only mitigation.
