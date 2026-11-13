---
status: approved   # approved by the user on 2026-11-12 (stated in session: "схвали та дозволь дизайн з imf weo"); note: licence reading rests on a page summary, not the full IMF text (Finding 1); full read / copyright@imf.org confirmation remains the user's action
topic: IMF WEO database licence for republishing values (including projections) on a public static dashboard with attribution
date: 2026-11-07
---
# IMF WEO licence: public republication of values and projections

Access date for every URL: 2026-11-07. Labels: [PAGE-SUMMARY] = read on the primary IMF page through the fetch tool, which returns a model-written summary with short quotes, not the full page text; the quoted fragments are the page's words, the rest is paraphrase. [REPO] = read in this repository today. [UNVERIFIED] = not confirmed. No full verbatim read of any IMF page was possible in this session, so the user should read the section named in Finding 1 before relying on this note (ADR-032 decision 2b already requires that).

## Question / scope
(1) Is the WEO database "Statistical Data" under the IMF terms, and what attribution, non-commercial and redistribution conditions apply? (2) Effective date of the terms. (3) May WEO values, including projections, be republished on a public static non-commercial site with attribution? (4) Which `publish_site` value in `config/sources.yaml` is consistent? Context: ADR-032 decision 2 and the Context licence bullet. Search limited to the IMF pages; no data endpoint was called.

## Sources assessed
| Source | Access (API/bulk) | Coverage | Frequency | Revisions | License | Rate limits | Notes |
|---|---|---|---|---|---|---|---|
| IMF WEO database (manual file download, D23) | Manual download only in this project; IMF prohibits automated bulk download without permission | Not assessed here | April and September/October, with July/January updates [PAGE-SUMMARY, disclaimer] | Historical data "updated continually"; each edition republishes values | IMF Copyright and Usage, Statistical Data section | n/a (manual) | Latest edition seen: WEO Update July 2026 (published 2026-07-08) [PAGE-SUMMARY, https://www.imf.org/en/Publications/WEO]; an October 2026 dataset is listed in search results at https://www.imf.org/external/datamapper/datasets/WEO [not opened] |

## Findings (each with citation: URL, access date)

F1. WEO is named as Statistical Data. The Copyright and Usage page has a section "Statistical Data (Data)" that covers IMF statistics, with the World Economic Outlook database named in the list (alongside IFS, BOP, DOT, GFS, commodity prices, exchange rates) [PAGE-SUMMARY]. The WEO database disclaimer sends users to that page for "the terms and conditions for usage of the WEO database" [PAGE-SUMMARY]. The WEO FAQ links to both pages (last updated 2025-04-22 per the FAQ) [PAGE-SUMMARY].
- https://www.imf.org/en/About/copyright-and-terms (2026-11-07)
- https://www.imf.org/en/publications/weo/weo-database/disclaimer (2026-11-07)
- https://www.imf.org/en/Publications/WEO/frequently-asked-questions (2026-11-07)

F2. Conditions for Statistical Data (quoted fragments from the page) [PAGE-SUMMARY]:
- Permitted: "Users may download, extract, copy, create derivative works, publish, distribute, and use Data".
- Attribution: "Distributed or reproduced Data must appear accurately with attribution to the IMF as the source"; example form "Source: International Monetary Fund, Database Name".
- Integrity: "Users shall not infringe upon the integrity of the Data"; "If material transformation occurs, it must be stated explicitly along with the required source citation."
- Standalone sale: sellers must tell purchasers the Data is free from the IMF. Data is provided "as is", no warranty.
- Download environments: "Users who make IMF Data available to other Users through any type of distribution or download environment" must make reasonable efforts to communicate and promote compliance with these terms (second-hand paraphrase from a search summary, wording [UNVERIFIED]). A public site that serves JSON files is arguably such an environment; this sentence is the one to read in full.
- Commercial reuse: "For any potential commercial reuse of IMF Data, email copyright@imf.org to request permission."
- Not covered: no right to confidential or unpublished data.
- Third-party content: material not attributed to the IMF needs the third party's permission [search summary, UNVERIFIED in full]. Whether any WEO series carries third-party attribution was not checked.
- Source: https://www.imf.org/en/About/copyright-and-terms (2026-11-07)

F3. Stricter general clauses sit on the same page and apply to IMF "Content" (publications, text), not the Data section, as far as the summary shows: "Free non-systematic downloading and/or printing of Content for personal, noncommercial usage only is permitted"; "without any right to resell, redistribute, compile, or create derivative works"; written permission for systematic copying or "a substantial amount beyond 'Fair Use'"; fair use capped at 1,000 words or one quarter [PAGE-SUMMARY]. The page also prohibits "bulk download of information by automated technology without explicit permission" and use of Content for LLM training without permission [PAGE-SUMMARY]. The WEO FAQ search snippet says the content carries "All Rights Reserved" [search summary, UNVERIFIED]. Tension to flag: a reader could apply F3 to the database as well; the reading in F2 (Data section governs data) rests on the Data section naming WEO, which is the better textual fit but is an interpretation.

F4. Effective date. The Copyright and Usage page states no effective, updated or last-modified date [PAGE-SUMMARY, two separate reads, same result]; the WEO disclaimer states no publication date (it mentions the October 2024 edition) [PAGE-SUMMARY]. Answer: no effective date is published; record "terms as read on 2026-11-07" and re-check periodically. Archival copy (Wayback) not checked [UNVERIFIED]. The older URL https://www.imf.org/external/terms.htm was seen in a search summary and not opened [UNVERIFIED].

F5. Republishing projections. The Data section makes no distinction between historical values and projections; WEO projections are part of the WEO database. On the F2 reading, publishing and distributing them on a public non-commercial site with accurate IMF attribution is permitted, provided values are shown unchanged (or any material transformation, such as rebasing or unit conversion, is stated) and the integrity of the Data is kept. This is the reading in ADR-032 Context; this note supports it textually but does not confirm it beyond the fetch tool's summary. Not stated on the page: whether a static site's own machine-readable copies (JSON export) count as "distribution", beyond the download-environment sentence; whether showing the latest edition only is needed (not required by any clause seen); whether the manual, non-automated download route is acceptable (it avoids the bulk-automation clause by construction). Written confirmation would come only from copyright@imf.org (the user's action, not an agent's).

F6. Repository state. `config/sources.yaml` contains no IMF or WEO source entry (grep for "imf" and "weo" returns nothing); the only WEO manual source is the example in `docs/specs/source-config-schema.md` section 2 (`id: imf_weo_manual`, `kind: manual`, `non_commercial_ok: true`, `redistribution_of_raw: allowed`, `archive: public`, `publish_site: public # user to confirm`, `terms_review.decision: permitted`, `clause: "[to be quoted from the page at implementation]"`, checked 2026-10-17) [REPO]. ADR-032 Context says the current value "was not checked"; the answer is that no entry exists yet, so ADR-032 precondition 2b ("if it is `withheld` today") does not apply as worded. Source-config rule 15 forbids `publish_site: public` with `redistribution_of_raw: forbidden` [REPO, schema AC-CFG-7].

F7. Consistent `publish_site` value. If the user accepts the F2 reading: `publish_site: public`, `redistribution_of_raw: allowed`, `non_commercial_ok: true`, attribution string of the form "Source: International Monetary Fund, World Economic Outlook database, <edition>", consistent with the schema example and ADR-032 decision 7b. If the user does not accept it or wants certainty first: `withheld` (and `redistribution_of_raw: unclear`, which also constrains `archive`; note the example sets `archive: public`, which the same uncertainty would put in question). Nothing in the IMF pages seen supports `forbidden`. This note does not change config.

## Risks / unknowns
- No verbatim full-page read: the fetch tool summarises; exact wording of the Data section, the download-environment sentence and any third-party carve-out need a human read.
- Interpretation risk between the Data section (permissive) and the general Content clauses (non-redistribution) for a database that is also summarised in WEO publications.
- No effective date; terms may change without notice; two IMF URLs for the terms page exist in the wild.
- Non-commercial status of the site is the project's own statement (ADR-010 decision 7), not an IMF category: the Data section as summarised does not condition publication on non-commercial use, but commercial reuse needs permission.
- Mirrors (FRED/DBnomics) of IMF data do not change the terms (earlier notes).
- Whether the IMF's new data portal (data.imf.org WEO dataset) has separate terms: its FAQ appeared in search results, not read [UNVERIFIED].

## Open questions for design
1. Does the user accept the F2 reading, or send the permission request to copyright@imf.org (user's action)? ADR-032 Q2.
2. Should the schema example's `clause` field be filled with a quote after the user's full read, and `terms_review` re-dated?
3. Is the public raw archive (`archive: public`) of WEO files acceptable under the same reading, or should it be `hash_only` until confirmed?
4. How is the "download environment" duty to promote compliance met on the site (a terms/attribution line on the About page and in `manifest`)?
5. Since no WEO source entry exists in `config/sources.yaml`, which step creates it, and with which `publish_site` default until the user confirms?
