---
status: approved   # proposed | approved | superseded. Approved by the user on 2026-11-09 (stated in session: "approved"). Robots options (sections 3 and 4), user answer "move as recommended" on 2026-11-09: DBnomics is disabled and A02c is to come via the manual inbox (option C, EC AMECO download); FAOSTAT stays fail-closed (option A, source disabled) until the 403 is confirmed from the Actions runner. No robots exception is in force.
---
# ADR-035: Redirect host handling for ECB and EC surveys; robots exceptions for DBnomics and FAOSTAT

## Context

Live fetch results of 2026-11-09 (reported by the caller; not re-run by this author) show four blocked sources. Governing rules: ingestion-interfaces-spec rule 6 (robots gate before the first request to a host) and rule 7 (a redirect to a different host is an error unless the host is listed in the source config); ADR-005 (RobotsGate fail-closed for `web`; log-only for documented APIs and bulk files, a Disallow on a documented endpoint is escalated to the user, `robots_override_reason` can be set by the user, never by an agent); ADR-028 (`allowed_hosts`, bare hostnames, today defined only under a bulk `discover` block); CLAUDE.md (respect robots.txt and terms).

Verification by this author, access date 2026-11-09 (WebFetch from an agent environment; single observations):

| Case | Reported | My check | Status |
|---|---|---|---|
| (a) ECB | redirect refused to `data.ecb.europa.eu`; robots.txt unreadable (301) | `https://data-api.ecb.europa.eu/robots.txt` returns 301 with Location `https://data.ecb.europa.eu/robots.txt`. That target and a data URL on `data-api` both returned HTTP 503 to my fetcher, and `https://data.ecb.europa.eu/help/api/data` also 503. | Robots 301 confirmed. Whether the data requests themselves are redirected is UNVERIFIED (503 is not a redirect evidence). Probable reading: the refused redirect is the robots.txt fetch. |
| (b) EC surveys | redirect refused to `economy-finance.ec.europa.eu` | `https://ec.europa.eu/economy_finance/db_indicators/surveys/documents/main_indicators_nace2.zip` returns 301 to the HTML page `https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys_en`. The EC download page (`https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys/download-business-and-consumer-survey-data/time-series_en`) lists the ZIPs still on host `ec.europa.eu`, under a versioned folder, e.g. `https://ec.europa.eu/economy_finance/db_indicators/surveys/documents/series/nace2_ecfin_2610/main_indicators_sa_nace2.zip` (note `series/nace2_ecfin_2610/` and `_sa_`). | Confirmed. The configured path (marked `[UNVERIFIED] URL shape` in `config/sources.yaml`) is stale; the 301 target is a landing page, not a file. Only the XLSX weights files are on `economy-finance.ec.europa.eu`. |
| (c) DBnomics | robots disallows endpoint | `https://api.db.nomics.world/robots.txt` returned `User-agent: *` / `Disallow: /` (single read; the tool gave no status code). Docs state the Web API is for any HTTP client, public, no key: `https://docs.db.nomics.world/web-api/`, API at `https://api.db.nomics.world/v22/` (WebSearch, 2026-11-09). | Confirmed (robots); API intended for programmatic use is documented. Terms of use not yet read: UNVERIFIED. |
| (d) FAOSTAT | `bulks-faostat.fao.org` robots 403 | Same host returned HTTP 403 to my fetcher for `/robots.txt`. `https://www.fao.org/robots.txt` (a different host) has no rule mentioning bulks-faostat; its Disallows concern TYPO3 paths. | 403 confirmed. A 403 is "unreadable", not "404 = no restrictions" under ADR-005; it may be a bot filter (not verified). |

Consequence for (b): allow-listing `economy-finance.ec.europa.eu` would make the connector follow the redirect and download an HTML page, which the parser would reject. The defect is the URL, not the host list.

## Options considered

### ECB (a)
1. Repoint `base_url` to `data.ecb.europa.eu`. Only valid if the data requests are redirected there; UNVERIFIED, and the ECB-documented API host is `data-api.ecb.europa.eu` (as configured; not re-confirmed because the documentation page returned 503).
2. Allow redirects generally. Rejected: weakens rule 7 for every source.
3. Keep `base_url`; let the RobotsGate (only) follow one redirect for `/robots.txt` to a host explicitly listed in a new source-level `allowed_hosts`, evaluate the final robots file, and record the final URL. Data requests keep rule 7 unchanged.

### EC surveys (b)
1. Allow `economy-finance.ec.europa.eu` as redirect target. Rejected, see Context.
2. Correct `request_template.path` to the versioned file (`series/nace2_ecfin_2610/main_indicators_sa_nace2.zip`) and keep the host. Simple, but the folder code (`2610`, likely year-month; inference) rotates, so it breaks again at the next vintage.
3. Use ADR-028 landing-page discovery: `landing_url` on `economy-finance.ec.europa.eu`, `link_pattern` anchored to `https://ec.europa.eu/economy_finance/db_indicators/surveys/documents/series/nace2_ecfin_[0-9]{4}/main_indicators_sa_nace2\.zip`, `allowed_hosts: [economy-finance.ec.europa.eu, ec.europa.eu]`. Robust to rotation; one extra request per run.

## Decision (proposed)

### 1. ECB: option 3 (robots-only redirect), conditional on one operator probe
Add an optional source-level `allowed_hosts` (bare hostnames, https) that permits only the RobotsGate redirect for `/robots.txt`. For `ecb`: `allowed_hosts: [data.ecb.europa.eu]`. If a probe shows the data requests themselves redirect to `data.ecb.europa.eu`, switch to option 1 (repoint `base_url`, no redirect allowance) instead. This is a spec amendment to source-config-schema and ingestion-interfaces-spec rule 7 (ADR-028 `allowed_hosts` today lives under `discover`; implementation may not reuse it silently).

### 2. EC surveys: option 3 (discovery), fallback option 2
Do not add `economy-finance.ec.europa.eu` as a redirect target for data. Use discovery with `allowed_hosts` as above (landing host plus file host, per ADR-028). If the user prefers no discovery, option 2 with the corrected path. Dataset name changes from `main_indicators_nace2` to `main_indicators_sa_nace2`; the series_map and parser layout must be re-checked against the real file (unverified). The EC page also announces a new BCS data browser with SDMX-CSV/API (unverified detail); a later source swap is out of scope here.

### 3. DBnomics robots Disallow (c): USER DECISION
- A. Accept with documented basis (recommended). The service is a documented public Web API intended for any HTTP client; a blanket `Disallow: /` on the API host reads as a default for HTML crawlers. The user records `robots_override_reason` (cites docs URL, access date, and that use is one request per run, project User-Agent, non-commercial) and the terms page is read first (UNVERIFIED now). Retain log-only mode so the disallow stays visible.
- B. Drop the series. Remove `dbnomics_ameco_gap` (comparison series A02c, not an authoritative source); AMECO has no native API per research U5, so A02c would be lost or move to manual inbox (ADR-005) from the EC AMECO download.
- C. Replace with the EC AMECO bulk download via the manual inbox: compliant, no robots question, but human effort per release.
Recommendation: A only if the terms review is clean, otherwise C; B if the comparison series is judged non-essential. An agent never sets the override.

### 4. FAOSTAT robots 403 (d): USER DECISION
- A. Treat as unreadable and keep fail-closed (current ADR-005 rule): source skipped, alert. Safe, but the series is lost.
- B. Accept with documented basis: the robots file is unreadable (403, probably an edge filter), the host serves published bulk files linked from FAO's own data pages, FAO terms (`https://www.fao.org/contact-us/terms/db-terms-of-use/en/`) permit reuse, and `www.fao.org/robots.txt` has no relevant rule. One request per 5 s, one zip per run. User sets `robots_override_reason`.
- C. Use the manual inbox for `faostat_sofi` (annual data; low cadence makes this cheap).
Recommendation: B, after the user confirms the 403 is reproducible from the Actions runner and the URL is a link on a fao.org page (otherwise C). Note that ADR-005 does not say how a 403 robots response is classified; this ADR proposes it be "unreadable, escalated" in log-only mode, never silently permitted.

## Consequences
- No general redirect following; rule 7 stays intact except one narrowly scoped robots-fetch exception (ECB).
- Spec amendments needed after approval: `allowed_hosts` at source level (robots-only semantics), config test that every entry is https bare hostname, a rule that a redirect target of a data request must be in the list used for data; ADR-005 wording on 403/5xx robots in log-only mode; `robots_override_reason` recorded in `raw_object` (field already exists).
- The EC fix needs an operator probe to capture the landing page and ZIP layout (network marker; at most 3 requests per source); fixtures re-recorded. Stale `[UNVERIFIED]` URL shapes for other bulk sources should be probed the same way.
- Robots and terms exceptions are explicit, dated and attributable to the user; dropping series reduces coverage (A02c, G12) and the corresponding dashboard cells will show missing.
- Open items: confirm whether ECB data requests redirect (probe from the runner); read DBnomics terms; confirm FAO 403 from the runner. My 503/403 results may be fetcher-specific and are not proof of server behaviour.

Sources (accessed 2026-11-09): https://data-api.ecb.europa.eu/robots.txt ; https://ec.europa.eu/economy_finance/db_indicators/surveys/documents/main_indicators_nace2.zip ; https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys/download-business-and-consumer-survey-data/time-series_en ; https://api.db.nomics.world/robots.txt ; https://docs.db.nomics.world/web-api/ ; https://bulks-faostat.fao.org/robots.txt ; https://www.fao.org/robots.txt
