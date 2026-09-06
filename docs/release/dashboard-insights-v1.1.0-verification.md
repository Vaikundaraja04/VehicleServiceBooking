# Dashboard Insights v1.1.0 — verification record

Record prepared: 2026-08-30T20:29:58Z

## Current release decision

**AUTOMATED EXECUTABLE GATES PASS; RUNTIME EVIDENCE REMAINS BLOCKED/PENDING.** Every executable Task 10 release gate available in this workspace completed successfully against the tested parent below. Docker/Compose and hosted CI have no executable evidence in this checkout, and the real-browser checklist remains PENDING. Those states are not promoted to PASS. The final archive is created only after this record is committed, so its identity belongs exclusively in the external checksum sidecar and handoff.

## Candidate identity

| Field | Result |
| --- | --- |
| Release | Dashboard Insights v1.1.0 |
| Tested parent commit | `8e0b2d7acde8c97118aeae2c8b23b8c5d4966c0f` |
| Tested parent tree | `1446ab22c2c5fd968807c2190655c9ed5ce75e72` |
| Tested parent subject | `fix: strengthen dashboard rendering and recovery` |
| Runtime versions | Node `v24.19.0`; npm `11.9.0` |
| Final packaging/evidence commit | External handoff only — a tracked file cannot truthfully contain its own commit identifier |
| Intended ZIP filename | `VehicleServiceBooking-dashboard-insights-v1.1.0.zip` |
| Required internal root | `VehicleServiceBooking-dashboard-insights-v1.1.0/` |
| External checksum sidecar | `VehicleServiceBooking-dashboard-insights-v1.1.0.zip.sha256` |
| Final ZIP identity | External only — byte size, entry count, SHA-256, and post-package checks are not tracked here |

## Fresh automated verification

All results in this section came from fresh Task 10 commands against the tested parent commit and tree above.

| Area | Exact command | Fresh result |
| --- | --- | --- |
| Guarded server suite and server lint | `(cd server && npm run test:all)` | **PASS**, exit `0`. The script ran `npm run lint && npm test`; ESLint completed with no diagnostics. Node reported `18` suites, `619` tests, `619` passed, `0` failed, `0` cancelled, `0` skipped, `0` todo; duration `157334.754794 ms`. |
| Server dependency audit | `(cd server && npm audit --audit-level=high)` | **PASS**, exit `0`; `found 0 vulnerabilities`. |
| Client full suite | `(cd client && npm test -- --run)` | **PASS**, exit `0`; Vitest `v4.1.11`; `43` of `43` test files passed; `977` of `977` tests passed; duration `20.31s` (transform `5.34s`, setup `4.69s`, import `11.59s`, tests `74.64s`, environment `38.35s`). |
| Client lint | `(cd client && npm run lint)` | **PASS**, exit `0`; `eslint .` completed with no diagnostics. |
| Client production build | `(cd client && npm run build)` | **PASS**, exit `0`; Vite `v8.2.2`; `76` modules transformed; build duration `474ms`. Assets: `dist/index.html` `0.48 kB` (gzip `0.29 kB`), `dist/assets/index-B2RggHXh.css` `24.18 kB` (gzip `4.33 kB`), and `dist/assets/index-BiA6kPRi.js` `393.17 kB` (gzip `112.07 kB`). |
| Client dependency audit | `(cd client && npm audit --audit-level=high)` | **PASS**, exit `0`; `found 0 vulnerabilities`. |
| Fail-closed release check | `bash scripts/release-verify.sh --check-only` | **PASS**, exit `0`; exact output `RELEASE CHECK: PASS` and `STAGED ENTRIES: 284`. |
| Working-tree state | `git status --short` | **PASS**, exit `0`; output empty. |
| Branch whitespace/diff check | `git diff --check main...HEAD` | **PASS**, exit `0`; output empty. |
| Tracked/untracked hygiene | Git path/status inspection plus the verifier's staged path/content scan | **PASS**. `283` tracked files; `0` non-ignored untracked files; `0` porcelain entries; `0` tracked forbidden/sensitive/excluded paths. The only tracked environment-pattern paths are the two approved templates, `client/.env.example` and `server/.env.example`, which passed the verifier's exact-content checks. Generated `client/dist/` and the process report under `.superpowers/` are ignored and excluded from release staging. The staged scan found no forbidden local environment file, credentials/protected assignment, secret-like public `VITE_*` name, dependency/build/coverage output, log, database content, nested archive, source checksum, symlink, or Git metadata. |

## Verification warnings

- Every npm invocation emitted `Unknown env config "http-proxy". This will stop working in the next major version of npm.`
- Server test processes repeatedly emitted the Mongoose deprecation warning that the `new` option for `findOneAndUpdate()` and `findOneAndReplace()` is deprecated and `returnDocument: 'after'` should be used instead.
- Neither warning changed an exit code or test/lint/audit/build result.

## Whole-branch independent review

The whole-branch review of `git diff main...HEAD` found `0` Critical and `2` Important findings, plus `5` minor findings. One consolidated correction wave resolved all seven findings:

- `6cd5b4e3278a24a802fc19dcfd712632ce04426a` (`fix: make dashboard release publication deterministic`) corrected exact-destination publication, umask-independent archive modes/identity, output-name and external-sidecar defenses, and their adversarial release-verifier coverage.
- `8e0b2d7acde8c97118aeae2c8b23b8c5d4966c0f` (`fix: strengthen dashboard rendering and recovery`) corrected/strengthened customer activity separation, raw-response reconstruction evidence, exact invalid-response messaging, and repeated current-session `401` single-flight behavior.

Scoped re-review found all `7` findings addressed and no Critical or Important breakage. A separate minor observation about the ignored process-report narrative is parked; it is not a production-code or tracked-evidence defect and does not alter the release ruling.

## Runtime evidence

| Check | Status | Fresh reason / required evidence |
| --- | --- | --- |
| Docker Compose configuration/runtime | **BLOCKED** | `command -v docker` returned no path; `docker --version` and `docker compose version` each exited `127` with `docker: command not found`. No Docker runtime was executed. |
| MongoDB container `rs0` primary check | **BLOCKED** | Depends on Docker/Compose, which is unavailable in this environment. No container primary check was executed. |
| `server-test` container matrix | **BLOCKED** | Depends on Docker/Compose, which is unavailable in this environment. No container matrix was executed. |
| Hosted CI | **BLOCKED — no execution evidence** | `git remote -v` and the remote-tracking-ref inspection were empty. The tracked workflow is statically covered by tests, but no hosted run URL, identifier, or execution log exists in this checkout; static configuration is not hosted CI PASS. |
| Real-browser dashboard acceptance | **PENDING** | No executable among Chromium, Chrome, or Firefox was found, and the client has no direct Playwright, Puppeteer, WebdriverIO, or Selenium dependency. No real-browser run was executed. |
| Sanitized 320/768/1440 evidence | **PENDING** | The browser checklist still records every scenario and evidence field as PENDING. JSDOM tests, static CSS assertions, and the production build are not substituted for browser execution. |

See [the Dashboard Insights browser checklist](../acceptance/dashboard-insights-browser-checklist.md). Its interactive, role/privacy, responsive, accessibility, display-mode, and sanitized-evidence checks remain PENDING until executed in a recorded real browser.

## Required release contents and exclusions

The fresh fail-closed check staged `284` entries, including the generated internal manifest. It requires the existing application/container/CI contracts, lockfiles, approved environment templates, dashboard server/client units and tests, API/design/plan/acceptance/release documentation, and the release verifier/tests.

The verifier rejects or excludes local environment files other than the two exact templates, dependencies, builds, coverage, Git/internal worktree metadata, symbolic links, logs, database/MongoDB content, nested ZIPs/source checksums, unsafe protected assignments, and secret-like public `VITE_*` names. Package mode additionally requires an absolute output outside the project, rejects overwrite/symlink/directory collisions and the reserved v1 filename, normalizes modes and timestamps, creates a deterministic sorted `zip -X` archive, and checks its internal manifest. No package-mode result or final archive identity is claimed in this tracked record.

## Core Booking v1.0.0 preservation

The original Core Booking v1.0.0 ZIP and checksum sidecar are **absent from this workspace**. They were not recreated. Its historical recorded SHA-256 remains:

```text
704cea709b12261ebc91f3ea62a98dcc8edfb04083044a810c1577c2b109437a
```

`VehicleServiceBooking-core-booking-v1.0.0.zip` and its checksum filename remain reserved and must never be used or overwritten by the v1.1.0 packager.

## Final archive identity — external handoff only

The final archive is generated only from the committed evidence tree. Its absolute paths, byte size, entry count, SHA-256, external `sha256sum -c`, `unzip -t`, extracted internal-manifest verification, sorted path comparison, archived modes, and extracted exclusion/sensitivity scan are post-commit observations. They intentionally remain outside this tracked file so the verified source cannot diverge from the packaged source through a post-package documentation edit.
