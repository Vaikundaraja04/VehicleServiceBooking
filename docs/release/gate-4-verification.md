# Gate 4 verification record — Core Booking v1.0.0

Date: 2026-08-30 UTC

## Current release decision

**AUTOMATED RELEASE CANDIDATE PASS WITH ENVIRONMENT BLOCKERS.** Application regression, lint, build, dependency, and fail-closed release checks are green. Browser, Docker, and hosted CI runtime checks remain explicitly blocked or pending in this executor and are not represented as PASS.

## Verified locally

| Check | Result |
|---|---|
| Original uploaded ZIP preserved | PASS — recorded SHA-256 `a9813b2cd9b51808ce1a21b9d8e0a9df9baeb6fe61e75a1dbac7c6654c6a1c41` |
| Guarded server full suite | PASS — 577/577, 16 suites, 0 failed/skipped/todo; final snapshot 2026-08-30 07:19 UTC |
| Server lint | PASS — included before the guarded full suite |
| Client full suite | PASS — 874/874, 38 files; final snapshot 2026-08-30 07:02 UTC |
| Client lint | PASS |
| Client production build | PASS — Vite 8.2.2, 72 modules, three generated files; refreshed 2026-08-30 07:19 UTC |
| Gate 3 feature reviews | PASS — S1–S6 and C1/C2/C3-Q/C3-D have zero remaining findings |
| C4 routes/navigation/styles | PASS — independent correction re-review accepted with 0 Critical/Important/Minor findings |

Known non-blocking command warnings: npm reports the existing `http-proxy` configuration deprecation; Mongoose reports the existing deprecated `new` option in tested update calls.

## Blocked runtime evidence

| Check | Status | Reason |
|---|---|---|
| Docker Compose configuration/runtime | BLOCKED | Docker and Compose executables are absent |
| MongoDB container `rs0` primary check | BLOCKED | Docker unavailable |
| `server-test` container matrix twice | BLOCKED | Docker unavailable |
| GitHub Actions execution | PENDING | Workflow can be statically verified only in this workspace |
| Real browser acceptance | BLOCKED/PENDING | No local browser automation/runtime; cloud browser cannot reach localhost |
| Screenshots at 320/768/1440 | PENDING | Requires real browser execution |

See [the browser checklist](../acceptance/core-booking-browser-checklist.md) for the exact manual matrix and sanitized evidence rules.

## Release scan and archive

The following fields are intentionally populated only after the fail-closed scanner, archive creation, independent ZIP integrity check, and manifest verification complete:

| Field | Result |
|---|---|
| Secret/exclusion scan | PASS — fail-closed check staged 264 entries; adversarial verifier suite 8/8 |
| Server dependency audit | PASS — 0 vulnerabilities; production dependency tree valid |
| Client dependency audit | PASS — 0 vulnerabilities; production dependency tree valid |
| Release ZIP absolute path | `/workspace/scratch/29df0a03f478/VehicleServiceBooking-core-booking-v1.0.0.zip` |
| ZIP size | 663,548 bytes |
| Entry count | 264 |
| ZIP SHA-256 | `704cea709b12261ebc91f3ea62a98dcc8edfb04083044a810c1577c2b109437a` |
| `unzip -t` | PASS — independent extraction and archived manifest verification also passed |

The archive cannot contain its own final byte size or SHA-256 without changing that hash. Final archive identity is therefore written to the external `.zip.sha256` sidecar and this post-package workspace record. The copy of this record inside the ZIP accurately shows pre-package status; its included source manifest independently verifies every archived source file.
