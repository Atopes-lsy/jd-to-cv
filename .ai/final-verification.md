# Local MVP verification — 2026-11-25

Environment: Windows11, Python3.12.4, Node24.13.0, Chromium157 via Playwright CLI, PyInstaller6.16.0. All images and profiles used for testing are fictional.

## Final results

- Python suite: 12/12 passed (8 existing CLI archive,4 desktop).
- Worker build, syntax and tests: 13/13 passed, using real SQLite for D1 SQL. Hosted D1 has not been exercised.
- Browser main workflow passed: screenshot drop, extraction/archive, saved profile, resume generation, edit/reopen persistence, search, consent/feedback, key cleared on refresh, desktop/mobile layouts and print entry.
- Recovery workflow passed: mobile file picker, disabled/loading state, injected provider failure and recovery, downloaded backup restored. The recorded network502 console entry was the deliberate injection, not an uncaught application exception.
- Archive regression exercised101 legacy JD versions, new-revision cap, >30MB rejection without mutation, stale-resume clearing and independent two-tab writes. Keyboard picker was observed and handled separately through CLI upload, because the script pauses on native file choosers.
- Independent parsing of exported backup verified original_text, location, direction and source_quote in all101 versions.
- Resume-history regression restored101 drafts, edited/blurred and exported; independent parsing retained101 (not102), first/last evidence and latest edited HTML.
- Personal-image workflow passed: selecting does not send; explicit recognition appends text; uncertainty shown; explicit save persists text; original private image is not archived.
- Screenshots inspected at1440x1000 and390x844: empty/generated desktop, mobile workspace/settings/profile-image. No primary-action overlap or horizontal overflow; reopened resume spacing corrected.
- PDF rendered with Poppler and text extracted: one white A4 page with selectable Chinese text. Arbitrary-length content and actual phone print UI remain unverified.
- Packaged Windows smoke test exited0, serving bundled UI without a model call. ZIP13,298,811 bytes; app.js exactly matches source; Python/Tcl and Tk notices included; no database,.env or unused Qt libraries bundled. Clean Windows is untested.

## Real provider checks

An existing environment-provided DeepSeek key was used transiently without displaying/storing it. Four real requests passed: an8-output-token connection check, fictional JD screenshot extraction, fictional profile-image transcription and resume generation. Results were inspected: technical terms/dates transcribed, participation boundaries retained and missing availability/quantitative results flagged. Local evidence is ignored under `.ai/evidence/real-provider-*.json`.

Four calls reserved CNY1.00 within the user-approved CNY5 daily application policy. This is reserved allowance, not reported supplier charges. No further real calls are required for this turn. One synthetic example does not prove broad OCR/resume quality.

## Corrections and independent review

Initial Python cleanup failures exposed unclosed SQLite connections; corrected and retested. Independent R1–R5 covered stale resume association, provenance loss, inconsistent recovery bounds, keyboard imports and resume truncation/blur amplification. All fixed with corresponding regressions. Final independent local review87.75/100; no remaining source-level blocker.

## Remaining boundaries

Human MVP acceptance/public release remain pending. No Site registered/deployed, publicURL, QR or GitHub binary release created. Deployed D1 migrations, hosted budget/origin behavior, physical mobile/WeChat browsers, clean Windows, storage exhaustion/denial, broader extraction quality and full accessibility need further verification. The launcher is unsigned. Hosted feedback retention must be decided before public collection; automatic expiry is not implemented.

Budget is a fixed20-attempt/day conservative reservation policy at CNY0.25 each, based on checked peak pricing and bounded input/output. It cannot constrain supplier price changes, external use of the same key or billing-date differences. Personal browser data is separate from unchanged CLI SQLite. Desktop counters/feedback stay local; hosted opt-in aggregates/feedback would reside in D1. Infrastructure may process network metadata.
