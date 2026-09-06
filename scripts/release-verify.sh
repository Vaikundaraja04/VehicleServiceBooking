#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly RELEASE_ROOT="VehicleServiceBooking-dashboard-insights-v1.1.0"
readonly IMPLEMENTATION_PLAN="docs/superpowers/plans/2026-08-30-dashboard-insights-implementation.md"
readonly RESERVED_CORE_BOOKING_V1_ARCHIVE="VehicleServiceBooking-core-booking-v1.0.0.zip"

fail() {
  printf 'RELEASE VERIFY: FAIL — %s\n' "$1" >&2
  exit 1
}

usage() {
  printf 'Usage: %s --check-only | --output /absolute/path/release.zip\n' "$0" >&2
  exit 2
}

mode=""
output=""
case "${1:-}" in
  --check-only)
    [[ $# -eq 1 ]] || usage
    mode="check"
    ;;
  --output)
    [[ $# -eq 2 ]] || usage
    mode="package"
    output="$2"
    ;;
  *) usage ;;
esac

if [[ "$mode" == "package" ]]; then
  [[ "$output" == /* ]] || fail "output path must be absolute"
  [[ "$output" == *.zip ]] || fail "output filename must end in .zip"
  output_basename="${output##*/}"
  [[ "$output_basename" != *$'\r'* && "$output_basename" != *$'\n'* ]] \
    || fail "output filename must not contain CR or LF"
  [[ ! -e "$output" && ! -L "$output" ]] \
    || fail "output already exists as a directory entry or symbolic link"
  [[ ! -e "$output.sha256" && ! -L "$output.sha256" ]] \
    || fail "checksum sidecar already exists as a directory entry or symbolic link"
  output="$(realpath -m -- "$output")"
  case "$output" in
    "$REPO_ROOT"|"$REPO_ROOT"/*) fail "output must be outside the project tree" ;;
  esac
  [[ "${output##*/}" != "$RESERVED_CORE_BOOKING_V1_ARCHIVE" ]] \
    || fail "Core Booking v1 archive filename is reserved"
  [[ ! -e "$output" && ! -L "$output" ]] \
    || fail "output already exists as a directory entry or symbolic link"
  [[ ! -e "$output.sha256" && ! -L "$output.sha256" ]] \
    || fail "checksum sidecar already exists as a directory entry or symbolic link"
  [[ -d "$(dirname -- "$output")" ]] || fail "output parent directory does not exist"
fi

source_mode="archive"
git_top_level=""
if git_top_level="$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null)"; then
  git_top_level="$(cd -- "$git_top_level" && pwd -P)"
fi
if [[ "$git_top_level" == "$REPO_ROOT" ]]; then
  source_mode="git"
fi

if [[ "$source_mode" == "git" ]]; then
  git -C "$REPO_ROOT" ls-files --error-unmatch -- "$IMPLEMENTATION_PLAN" \
    >/dev/null 2>&1 \
    || fail "dashboard implementation plan must be tracked before release"
else
  [[ -f "$REPO_ROOT/$IMPLEMENTATION_PLAN" && ! -L "$REPO_ROOT/$IMPLEMENTATION_PLAN" ]] \
    || fail "dashboard implementation plan must be a regular file in an extracted release"
  [[ -f "$REPO_ROOT/RELEASE-MANIFEST.sha256" && ! -L "$REPO_ROOT/RELEASE-MANIFEST.sha256" ]] \
    || fail "bundled release manifest must be a regular file in an extracted release"
  (
    cd -- "$REPO_ROOT"
    sha256sum --check --strict RELEASE-MANIFEST.sha256 >/dev/null 2>&1
  ) || fail "bundled release manifest verification failed"
fi

publish_dir=""
stage_parent="$(mktemp -d)"
cleanup() {
  rm -rf -- "$stage_parent"
  if [[ -n "$publish_dir" ]]; then
    rm -rf -- "$publish_dir"
  fi
}
trap cleanup EXIT INT TERM
stage="$stage_parent/$RELEASE_ROOT"
mkdir -p -- "$stage"

rsync -a --prune-empty-dirs \
  --include='/server/.env.example' \
  --include='/client/.env.example' \
  --exclude='.[eE][nN][vV]' \
  --exclude='.[eE][nN][vV].*' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='coverage/' \
  --exclude='.git' \
  --exclude='.superpowers/' \
  --exclude='.worktrees/' \
  --exclude='.release-staging/' \
  --exclude='release-staging/' \
  --exclude='docker-data/' \
  --exclude='mongo-data/' \
  --exclude='mongodb-data/' \
  --exclude='*[mM][oO][nN][gG][oO]*[vV][oO][lL][uU][mM][eE]*/' \
  --exclude='[dD][bB]-[dD][aA][tT][aA]/' \
  --exclude='[dD][bB][dD][aA][tT][aA]/' \
  --exclude='[jJ][oO][uU][rR][nN][aA][lL]/' \
  --exclude='[dD][iI][aA][gG][nN][oO][sS][tT][iI][cC].[dD][aA][tT][aA]/' \
  --exclude='[wW][iI][rR][eE][dD][tT][iI][gG][eE][rR]*' \
  --exclude='*.[wW][tT]' \
  --exclude='[mM][oO][nN][gG][oO][dD].[lL][oO][cC][kK]' \
  --exclude='[sS][tT][oO][rR][aA][gG][eE].[bB][sS][oO][nN]' \
  --exclude='*.[bB][sS][oO][nN]' \
  --exclude='*.[bB][sS][oO][nN].*' \
  --exclude='*.[dD][uU][mM][pP]' \
  --exclude='*.[dD][uU][mM][pP].*' \
  --exclude='*.[dD][bB]' \
  --exclude='*.[dD][bB]-*' \
  --exclude='*.[sS][qQ][lL][iI][tT][eE]' \
  --exclude='*.[sS][qQ][lL][iI][tT][eE]-*' \
  --exclude='*.[sS][qQ][lL][iI][tT][eE]3' \
  --exclude='*.[sS][qQ][lL][iI][tT][eE]3-*' \
  --exclude='*.[zZ][iI][pP]' \
  --exclude='*.[zZ][iI][pP].[sS][hH][aA]256' \
  --exclude='*.[sS][hH][aA]256' \
  --exclude='*.[sS][hH][aA]256.*' \
  --exclude='*.[lL][oO][gG]' \
  --exclude='*.[lL][oO][gG].*' \
  --exclude='*.[lL][oO][gG]-*' \
  --exclude='npm-debug.log*' \
  --include='*/' \
  "$REPO_ROOT/" "$stage/"

if ! node - "$stage" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const approvedEnvironmentTemplates = new Set([
  "server/.env.example",
  "client/.env.example",
]);

function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (/[\r\n]/.test(entry.name)) process.exit(1);
    const filename = path.join(directory, entry.name);
    const relative = path.relative(root, filename).split(path.sep).join("/");
    if (
      /^\.env(?:\..*)?$/i.test(entry.name)
      && !approvedEnvironmentTemplates.has(relative)
    ) process.exit(1);
    if (entry.isDirectory()) inspect(filename);
  }
}

inspect(root);
NODE
then
  fail "release filename or environment-file policy was violated"
fi

required=(
  README.md
  package.json
  START_HERE_WINDOWS.bat
  docker-compose.yml
  server/package.json
  server/package-lock.json
  server/Dockerfile
  server/.dockerignore
  server/.env.example
  server/app.js
  server/index.js
  server/models/Booking.js
  server/scripts/seed-booking-foundation.js
  server/services/bookingService.js
  server/services/dashboardService.js
  server/controllers/dashboardController.js
  server/routes/dashboardRoutes.js
  server/utils/dashboardResponse.js
  server/scripts/seed-demo.js
  server/tests/scripts/seed-demo.test.js
  server/tests/services/bookingService.test.js
  server/tests/services/dashboardService.test.js
  server/tests/utils/dashboardResponse.test.js
  server/tests/dashboardRoutes.test.js
  server/tests/release/releaseVerifier.test.js
  client/package.json
  client/package-lock.json
  client/.env.example
  client/src/App.jsx
  client/src/pages/BookServicePage.jsx
  client/src/pages/bookServicePage.test.jsx
  client/src/pages/AdminBookingsPage.jsx
  client/src/pages/adminBookingsPage.test.jsx
  client/src/api/authApi.js
  client/src/api/authApi.test.js
  client/src/api/dashboardApi.js
  client/src/api/dashboardApi.test.js
  client/src/components/DashboardStatCard.jsx
  client/src/components/DashboardStatCard.test.jsx
  client/src/components/CustomerDashboard.jsx
  client/src/components/CustomerDashboard.test.jsx
  client/src/components/AdminDashboard.jsx
  client/src/components/AdminDashboard.test.jsx
  client/src/pages/DashboardPage.jsx
  client/src/pages/dashboardPage.test.jsx
  client/src/App.test.jsx
  client/src/auth/bootstrapRecovery.test.jsx
  client/src/pages/accountFlows.test.jsx
  client/src/pages/linkFlows.test.jsx
  client/src/styles/index.css
  client/src/styles/index.css.test.js
  .github/workflows/ci.yml
  docker/mongo-init.sh
  docs/api/core-booking-api.md
  docs/acceptance/core-booking-browser-checklist.md
  docs/acceptance/dashboard-insights-browser-checklist.md
  docs/release/gate-4-verification.md
  docs/release/dashboard-insights-v1.1.0-verification.md
  docs/superpowers/specs/2026-08-30-dashboard-insights-design.md
  docs/superpowers/plans/2026-08-30-dashboard-insights-implementation.md
  scripts/start-local-demo.js
  scripts/start-local-demo.test.js
  scripts/release-verify.sh
)
for path in "${required[@]}"; do
  [[ -f "$stage/$path" && ! -L "$stage/$path" ]] \
    || fail "required release file is missing or is a symbolic link"
done

if find "$stage" -type l -print -quit | grep -q .; then
  fail "symbolic links are not allowed in the release"
fi

if find "$stage" -name .git -print -quit | grep -q .; then
  fail "Git metadata entered release staging"
fi

if find "$stage" -type d \( \
  -name node_modules -o -name dist -o -name coverage -o -name .git -o \
  -name .superpowers -o -name .worktrees -o -name docker-data -o \
  -name mongo-data -o -name mongodb-data \
\) -print -quit | grep -q .; then
  fail "forbidden directory entered release staging"
fi

if find "$stage" -type f \( \
  \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' -o \
  -iname '*.zip' -o -iname '*.zip.sha256' -o -iname 'WiredTiger*' -o \
  -iname '*.wt' -o -iname '*.log' -o -iname '*.log.*' -o \
  -iname '*.log-*' -o -iname '*.sha256' -o -iname '*.sha256.*' -o \
  -iname '*.bson' -o -iname '*.bson.*' -o -iname '*.dump' -o \
  -iname '*.dump.*' -o -iname '*.db' -o -iname '*.db-*' -o \
  -iname '*.sqlite' -o -iname '*.sqlite-*' -o -iname '*.sqlite3' -o \
  -iname '*.sqlite3-*' -o -iname 'mongod.lock' -o -iname 'storage.bson' \
\) -print -quit | grep -q .; then
  fail "forbidden file entered release staging"
fi

expected_server_template="$stage_parent/expected-server.env"
expected_client_template="$stage_parent/expected-client.env"
printf '%s\n' \
  'PORT=5000' \
  'MONGO_URI=mongodb://mongo:27017/vehicle_service_booking?replicaSet=rs0' \
  'CLIENT_URL=http://localhost:5173' \
  'JWT_SECRET=change-me' \
  'JWT_EXPIRES_IN=8h' \
  'GMAIL_USER=not-configured@example.invalid' \
  'GMAIL_APP_PASSWORD=change-me' \
  'NODE_ENV=development' \
  'TRUSTED_PROXY_IPS=' > "$expected_server_template"
printf '%s\n' \
  '# VITE_ values are public and included in browser bundles. Never put secrets here.' \
  'VITE_API_URL=http://localhost:5000/api' > "$expected_client_template"
cmp -s "$expected_server_template" "$stage/server/.env.example" \
  || fail "server environment template is not the approved safe template"
cmp -s "$expected_client_template" "$stage/client/.env.example" \
  || fail "client environment template is not the approved public template"

if ! node - "$stage" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const scanRoots = [
  "README.md",
  "INSTALL_AUTH_CLIENT.md",
  "client",
  "server",
  "docs",
  ".github",
  "docker",
  "docker-compose.yml",
  "scripts",
];
const allowedValues = new Map([
  ["JWT_SECRET", new Set([
    "change-me",
    "short",
    "test-secret-with-more-than-32-characters",
    "test-only-secret-with-more-than-32-characters",
    "development-only-change-this-to-at-least-32-random-characters",
    "<private-random-value-at-least-32-characters>",
  ])],
  ["GMAIL_APP_PASSWORD", new Set([
    "change-me",
    "test-app-password",
    "your-16-character-app-password",
    "the-16-character-google-app-password",
    "<your-gmail-app-password>",
  ])],
  ["MONGO_URI", new Set([
    "mongodb://mongo:27017/vehicle_service_booking?replicaSet=rs0",
    "mongodb://mongo:27017/vehicle_service_booking_test?replicaSet=rs0",
    "mongodb://127.0.0.1:27017/vehicle_service_booking",
    "mongodb://127.0.0.1:27017/vehicle_service_booking?replicaSet=rs0",
    "mongodb://127.0.0.1:27017/vehicle_service_booking_test?replicaSet=rs0",
    "invalid://database",
    "uri",
    "process.env.MONGO_URI_TEST",
    "mismatchedUri",
    "${developmentUri.replace(/[?",
    "COMPOSE_URI",
    "COMPOSE_URI.replace(",
  ])],
]);
const approvedValuesByPath = new Map([
  ["scripts/start-local-demo.js", new Map([
    ["MONGO_URI", new Set(["options.MONGO_URI", "replset.getUri("])],
    ["JWT_SECRET", new Set(["options.JWT_SECRET", "randomBytes(48"])],
    ["GMAIL_APP_PASSWORD", new Set(["not-used-in-local-demo"])],
  ])],
  ["scripts/start-local-demo.test.js", new Map([
    ["MONGO_URI", new Set(["mongodb://127.0.0.1:27017/local-demo?replicaSet=rs0"])],
    ["JWT_SECRET", new Set(["x"])],
  ])],
  ["server/tests/scripts/seed-demo.test.js", new Map([
    ["MONGO_URI", new Set(["mongodb://127.0.0.1:27017/demo", "mongoUri"])],
  ])],
]);
const assignment = /(?<![A-Z0-9_])(?:process\.env(?:\.|\[[ \t]*["'])|["']?)(JWT_SECRET|GMAIL_APP_PASSWORD|MONGO_URI)(?:["'](?:[ \t]*\])?)?[ \t]*(?::=|\|\|=|\?\?=|&&=|\+=|-=|\*=|\/=|%=|=|:)[ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`|\r?\n[ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`)|([^\s,;)\]}"'`]+))/g;
const unsafeViteName = /\bVITE_[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY)[A-Z0-9_]*/i;

function filesAt(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) =>
    filesAt(path.join(target, entry.name)),
  );
}

for (const filename of scanRoots.flatMap((entry) => filesAt(path.join(root, entry)))) {
  const relative = path.relative(root, filename).split(path.sep).join("/");
  if (
    relative === "server/.env.example"
    || relative === "client/.env.example"
  ) {
    continue;
  }

  const source = fs.readFileSync(filename, "utf8");
  const scanSource = source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\r\n]/g, " "),
  );
  if (unsafeViteName.test(scanSource)) process.exit(1);

  assignment.lastIndex = 0;
  let match;
  while ((match = assignment.exec(scanSource)) !== null) {
    if (match[4] !== undefined && scanSource[match.index - 1] === "`") continue;
    const value = match[2] ?? match[3] ?? match[4]
      ?? match[5] ?? match[6] ?? match[7] ?? match[8];
    const approvedForFile = approvedValuesByPath.get(relative)?.get(match[1]);
    if (!allowedValues.get(match[1]).has(value) && !approvedForFile?.has(value)) {
      process.exit(1);
    }
  }
}
NODE
then
  fail "a protected configuration or secret-like public name has an unsafe assignment"
fi

find "$stage" -type d -exec chmod 0755 {} +
find "$stage" -type f -exec chmod 0644 {} +
if [[ "$source_mode" == "git" ]]; then
  while IFS= read -r -d '' tracked_entry; do
    tracked_metadata="${tracked_entry%%$'\t'*}"
    tracked_path="${tracked_entry#*$'\t'}"
    tracked_mode="${tracked_metadata%% *}"
    if [[ "$tracked_mode" == "100755" && -e "$stage/$tracked_path" ]]; then
      [[ -f "$stage/$tracked_path" && ! -L "$stage/$tracked_path" ]] \
        || fail "tracked executable is not a staged regular file"
      chmod 0755 -- "$stage/$tracked_path"
    fi
  done < <(git -C "$REPO_ROOT" ls-files --stage -z)
else
  chmod 0755 -- \
    "$stage/scripts/release-verify.sh" \
    "$stage/docker/mongo-init.sh"
fi

manifest="$stage/RELEASE-MANIFEST.sha256"
(
  cd -- "$stage"
  find . -type f ! -name RELEASE-MANIFEST.sha256 -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum > "$manifest"
  chmod 0644 -- "$manifest"
  sha256sum --check --strict RELEASE-MANIFEST.sha256 >/dev/null
)
if find "$stage" -type f -iname '*.sha256' ! -path "$manifest" -print -quit \
  | grep -q .; then
  fail "source checksum file entered release staging"
fi

if [[ "$mode" == "check" ]]; then
  entry_count="$(find "$stage" -type f | wc -l | tr -d ' ')"
  printf 'RELEASE CHECK: PASS\n'
  printf 'STAGED ENTRIES: %s\n' "$entry_count"
  exit 0
fi

find "$stage" -exec touch -h -t 198001010000.00 {} +
publish_dir="$(mktemp -d \
  --tmpdir="$(dirname -- "$output")" \
  ".${output##*/}.publish.XXXXXX")" \
  || fail "could not create the atomic publication directory"
archive_work="$publish_dir/archive.zip"
sidecar_work="$publish_dir/archive.zip.sha256"
(
  cd -- "$stage_parent"
  find "$(basename -- "$stage")" -type f -print \
    | LC_ALL=C sort \
    | zip -X -q "$archive_work" -@
)

unzip -t "$archive_work" >/dev/null || fail "ZIP integrity test failed"
archive_listing="$stage_parent/archive-listing.txt"
unzip -Z1 "$archive_work" > "$archive_listing" \
  || fail "ZIP entry listing failed"
archive_root="$(basename -- "$stage")"
for path in "${required[@]}" RELEASE-MANIFEST.sha256; do
  grep -Fqx -- "$archive_root/$path" "$archive_listing" \
    || fail "required release file is absent from the ZIP"
done
if ! node - "$archive_listing" "$archive_root" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const listing = fs.readFileSync(process.argv[2], "utf8")
  .split("\n")
  .filter(Boolean);
const root = `${process.argv[3]}/`;

for (const entry of listing) {
  if (!entry.startsWith(root)) process.exit(1);
  const relative = entry.slice(root.length);
  const segments = relative.split("/");
  const basename = segments.at(-1);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const lowerBasename = basename.toLowerCase();

  if (lowerSegments.some((segment) => [
    "node_modules",
    "dist",
    "coverage",
    ".git",
    ".superpowers",
    ".worktrees",
    "docker-data",
    "mongo-data",
    "mongodb-data",
    "db-data",
    "dbdata",
    "journal",
    "diagnostic.data",
  ].includes(segment))) process.exit(1);
  if (lowerSegments.some((segment) => segment.includes("mongo") && segment.includes("volume"))) {
    process.exit(1);
  }
  const approvedEnvironmentTemplate = [
    "server/.env.example",
    "client/.env.example",
  ].includes(relative);
  const generatedManifest = relative === "RELEASE-MANIFEST.sha256";
  if (
    (/^\.env(?:\..*)?$/i.test(basename) && !approvedEnvironmentTemplate)
    || /\.zip(?:\.sha256)?$/i.test(basename)
    || (/\.sha256(?:\..*)?$/i.test(basename) && !generatedManifest)
    || /\.log(?:$|[.-])/i.test(basename)
    || /\.bson(?:$|\.)/i.test(basename)
    || /\.dump(?:$|\.)/i.test(basename)
    || /\.(?:db|sqlite|sqlite3)(?:$|-)/i.test(basename)
    || /^wiredtiger/i.test(basename)
    || /\.wt$/i.test(basename)
    || ["mongod.lock", "storage.bson"].includes(lowerBasename)
  ) process.exit(1);
}
NODE
then
  fail "ZIP content verification failed"
fi
archive_extract="$stage_parent/archive-extract"
mkdir -p -- "$archive_extract"
unzip -q "$archive_work" -d "$archive_extract" \
  || fail "ZIP extraction verification failed"
(
  cd -- "$archive_extract/$archive_root"
  sha256sum --check --strict RELEASE-MANIFEST.sha256 >/dev/null
) || fail "archived manifest verification failed"
zip_hash="$(sha256sum "$archive_work" | awk '{print $1}')"
zip_size="$(stat -c '%s' "$archive_work")"
zip_entries="$(wc -l < "$archive_listing" | tr -d ' ')"
printf '%s  %s\n' "$zip_hash" "$(basename -- "$output")" > "$sidecar_work"
chmod 0644 "$archive_work" "$sidecar_work"
ln -T -- "$archive_work" "$output" \
  || fail "output path acquired a directory entry before atomic publication"
ln -T -- "$sidecar_work" "$output.sha256" \
  || fail "checksum sidecar acquired a directory entry before atomic publication"
[[ -f "$output" && ! -L "$output" && "$output" -ef "$archive_work" ]] \
  || fail "exact output path is not the verifier archive"
[[ -f "$output.sha256" && ! -L "$output.sha256" && "$output.sha256" -ef "$sidecar_work" ]] \
  || fail "exact checksum path is not the verifier sidecar"
unzip -t "$output" >/dev/null || fail "published ZIP integrity test failed"
(
  cd -- "$(dirname -- "$output")"
  sha256sum --check --strict "$(basename -- "$output.sha256")" >/dev/null
) || fail "published checksum sidecar verification failed"

printf 'RELEASE ZIP: PASS\n'
printf 'PATH: %s\n' "$output"
printf 'SIZE: %s bytes\n' "$zip_size"
printf 'ENTRIES: %s\n' "$zip_entries"
printf 'SHA256: %s\n' "$zip_hash"
printf 'CHECKSUM: %s\n' "$output.sha256"
