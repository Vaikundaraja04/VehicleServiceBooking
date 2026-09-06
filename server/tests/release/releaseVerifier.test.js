const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readlinkSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..", "..", "..");
const verifierSource = readFileSync(
  path.join(repositoryRoot, "scripts", "release-verify.sh"),
  "utf8",
);
const releaseRoot = "VehicleServiceBooking-dashboard-insights-v1.1.0";
const implementationPlanPath =
  "docs/superpowers/plans/2026-08-30-dashboard-insights-implementation.md";
const dashboardContractFiles = [
  "server/index.js",
  "server/scripts/seed-booking-foundation.js",
  "server/controllers/dashboardController.js",
  "server/routes/dashboardRoutes.js",
  "server/services/dashboardService.js",
  "server/utils/dashboardResponse.js",
  "server/tests/dashboardRoutes.test.js",
  "server/tests/services/dashboardService.test.js",
  "server/tests/utils/dashboardResponse.test.js",
  "client/src/api/dashboardApi.js",
  "client/src/api/dashboardApi.test.js",
  "client/src/api/authApi.js",
  "client/src/api/authApi.test.js",
  "client/src/components/DashboardStatCard.jsx",
  "client/src/components/DashboardStatCard.test.jsx",
  "client/src/components/CustomerDashboard.jsx",
  "client/src/components/CustomerDashboard.test.jsx",
  "client/src/components/AdminDashboard.jsx",
  "client/src/components/AdminDashboard.test.jsx",
  "client/src/pages/DashboardPage.jsx",
  "client/src/pages/dashboardPage.test.jsx",
  "client/src/App.test.jsx",
  "client/src/auth/bootstrapRecovery.test.jsx",
  "client/src/pages/accountFlows.test.jsx",
  "client/src/pages/linkFlows.test.jsx",
  "client/src/styles/index.css",
  "client/src/styles/index.css.test.js",
  "docs/superpowers/specs/2026-08-30-dashboard-insights-design.md",
  implementationPlanPath,
  "docs/acceptance/dashboard-insights-browser-checklist.md",
  "docs/release/dashboard-insights-v1.1.0-verification.md",
  "server/tests/release/releaseVerifier.test.js",
];

const serverTemplate = [
  "PORT=5000",
  "MONGO_URI=mongodb://mongo:27017/vehicle_service_booking?replicaSet=rs0",
  "CLIENT_URL=http://localhost:5173",
  "JWT_SECRET=change-me",
  "JWT_EXPIRES_IN=8h",
  "GMAIL_USER=not-configured@example.invalid",
  "GMAIL_APP_PASSWORD=change-me",
  "NODE_ENV=development",
  "TRUSTED_PROXY_IPS=",
  "WORKSHOP_NAME=Vehicle Service Booking",
  "WORKSHOP_EMAIL=",
  "WORKSHOP_PHONE=",
  "WORKSHOP_ADDRESS=",
  "",
].join("\n");

const clientTemplate = [
  "# VITE_ values are public and included in browser bundles. Never put secrets here.",
  "VITE_API_URL=http://localhost:5000/api",
  "",
].join("\n");

function write(root, relativePath, content = "\n") {
  const filename = path.join(root, relativePath);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, content);
}

function createFixture({
  includeApplication = true,
  includeDashboard = true,
  trackImplementationPlan = true,
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "vsb-release-contract-"));
  for (const required of [
    "README.md",
    "package.json",
    "START_HERE_WINDOWS.bat",
    "docker-compose.yml",
    "server/package.json",
    "server/package-lock.json",
    "server/Dockerfile",
    "server/.dockerignore",
    "client/package.json",
    "client/package-lock.json",
    ".github/workflows/ci.yml",
    "docker/mongo-init.sh",
    "server/scripts/seed-demo.js",
    "server/tests/scripts/seed-demo.test.js",
    "scripts/start-local-demo.js",
    "scripts/start-local-demo.test.js",
    "docs/api/core-booking-api.md",
    "docs/acceptance/core-booking-browser-checklist.md",
    "docs/release/gate-4-verification.md",
  ]) {
    write(root, required);
  }
  write(root, "server/.env.example", serverTemplate);
  write(root, "client/.env.example", clientTemplate);
  write(root, "scripts/release-verify.sh", verifierSource);
  if (includeApplication) {
    for (const applicationFile of [
      "server/app.js",
      "server/models/Booking.js",
      "server/services/bookingService.js",
      "server/tests/services/bookingService.test.js",
      "client/src/App.jsx",
      "client/src/pages/BookServicePage.jsx",
      "client/src/pages/bookServicePage.test.jsx",
      "client/src/pages/AdminBookingsPage.jsx",
      "client/src/pages/adminBookingsPage.test.jsx",
    ]) {
      write(root, applicationFile, "export-safe fixture\n");
    }
  }
  if (includeDashboard) {
    for (const dashboardFile of dashboardContractFiles) {
      write(root, dashboardFile, "export-safe dashboard fixture\n");
    }
  }
  write(root, "server/node_modules/forbidden.js", "dependency output\n");
  write(root, "client/dist/forbidden.js", "build output\n");
  write(root, ".superpowers/private-evidence.md", "internal evidence\n");
  const initialized = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  if (includeDashboard && trackImplementationPlan) {
    const tracked = spawnSync("git", ["add", "--", implementationPlanPath], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(tracked.status, 0, tracked.stderr);
  }
  return root;
}

function packageRelease(root, output, { env = process.env, umask } = {}) {
  const verifier = path.join(root, "scripts", "release-verify.sh");
  const command = umask === undefined
    ? [verifier, "--output", output]
    : [
      "-c",
      'umask "$1"; shift; exec bash "$@"',
      "release-verifier-test",
      umask,
      verifier,
      "--output",
      output,
    ];
  return spawnSync("bash", command, { cwd: root, encoding: "utf8", env });
}

function verify(root) {
  return spawnSync("bash", [path.join(root, "scripts", "release-verify.sh"), "--check-only"], {
    cwd: root,
    encoding: "utf8",
  });
}

function stagedEntryCount(result) {
  const match = result.stdout.match(/^STAGED ENTRIES: (\d+)$/m);
  assert.ok(match, `${result.stdout}${result.stderr}`);
  return Number(match[1]);
}

function useGitPointerFile(root) {
  const gitStorage = mkdtempSync(path.join(os.tmpdir(), "vsb-linked-git-state-"));
  const gitDirectory = path.join(gitStorage, "repository.git");
  renameSync(path.join(root, ".git"), gitDirectory);
  writeFileSync(path.join(root, ".git"), `gitdir: ${gitDirectory}\n`);

  const tracked = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", "--", implementationPlanPath],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(tracked.status, 0, tracked.stderr);
  return gitStorage;
}

test("release verifier scans documentation without echoing a protected value", () => {
  const root = createFixture();
  const privateValue = "never-print-this-private-value";
  const protectedName = ["JWT", "SECRET"].join("_");

  try {
    const baseline = verify(root);
    assert.equal(baseline.status, 0, baseline.stderr);

    write(
      root,
      "docs/api/core-booking-api.md",
      `Unsafe example: ${protectedName}=${privateValue}\n`,
    );
    const result = verify(root);
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(output, /protected configuration/i);
    assert.doesNotMatch(output, new RegExp(privateValue));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release verifier requires representative application source and tests", () => {
  const root = createFixture({ includeApplication: false });

  try {
    const result = verify(root);
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /required release file/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release verifier requires every dashboard implementation, test, design, and evidence file", () => {
  const root = createFixture();

  try {
    for (const requiredFile of dashboardContractFiles) {
      const filename = path.join(root, requiredFile);
      const content = readFileSync(filename, "utf8");
      rmSync(filename);

      const result = verify(root);
      assert.equal(result.status, 1, `accepted missing ${requiredFile}`);
      assert.match(
        `${result.stdout}${result.stderr}`,
        /required release file/i,
        requiredFile,
      );
      write(root, requiredFile, content);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release verifier refuses an untracked dashboard implementation plan", () => {
  const root = createFixture({ trackImplementationPlan: false });

  try {
    const result = verify(root);
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /implementation plan.*tracked/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release verifier scans tests, computed assignments, and every secret-like Vite name", () => {
  const protectedReference = `process.env.${["JWT", "SECRET"].join("_")}`;
  const probes = [
    {
      path: "server/tests/security/unsafe.test.js",
      source: `process.env[${JSON.stringify("JWT_SECRET")}] ||= ${JSON.stringify("private-runtime-value")};\n`,
    },
    {
      path: "client/src/unsafe-config.js",
      source: `const unsafe = import.meta.env.${["VITE", "PRIVATE", "TOKEN"].join("_")};\n`,
    },
    {
      path: "server/config/unsafe-plus.js",
      source: `${protectedReference} += ${JSON.stringify("private-runtime-value")};\n`,
    },
    {
      path: "server/config/unsafe-newline.js",
      source: `${protectedReference} =\n  ${JSON.stringify("private-runtime-value")};\n`,
    },
    {
      path: "server/config/unsafe-comment.js",
      source: `${protectedReference} /* gap */ = ${JSON.stringify("private-runtime-value")};\n`,
    },
    {
      path: "server/config/unsafe-indirection.js",
      source: `const FIXED = ${JSON.stringify("private-runtime-value")};\n${protectedReference} = FIXED;\n`,
    },
  ];

  for (const probe of probes) {
    const root = createFixture();
    try {
      write(root, probe.path, probe.source);
      const result = verify(root);
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.status, 1, probe.path);
      assert.match(output, /protected configuration|secret-like public/i);
      assert.doesNotMatch(output, /private-runtime-value/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("release package uses the dashboard root, verifies its manifest, and excludes unsafe artifacts", () => {
  const root = createFixture();
  const extraction = mkdtempSync(path.join(os.tmpdir(), "vsb-release-extract-"));
  const output = path.join(
    path.dirname(root),
    `${path.basename(root)}-release.zip`,
  );

  try {
    write(root, "nested/forbidden.ZIP", "nested archive\n");
    write(root, "runtime/forbidden.LOG", "runtime log\n");
    write(root, "runtime/app.log.1", "rotated runtime log\n");
    write(root, "runtime/app.log.gz", "compressed runtime log\n");
    write(root, "coverage/forbidden.json", "coverage output\n");
    write(root, "client/.env.local", "VITE_API_URL=https://private.invalid\n");
    write(root, "backup/users.bson", "database dump\n");
    write(root, "nested/artifact.sha256", "source checksum\n");
    write(root, "local-mongo-volume/WiredTiger", "database metadata\n");
    write(root, "local-mongo-volume/collection-0.wt", "database pages\n");
    const result = packageRelease(root, output);
    assert.equal(result.status, 0, result.stderr);

    const listing = spawnSync("unzip", ["-Z1", output], {
      encoding: "utf8",
    });
    assert.equal(listing.status, 0, listing.stderr);
    const entries = listing.stdout.trim().split("\n");
    assert.equal(entries.every((entry) => entry.startsWith(`${releaseRoot}/`)), true);
    assert.equal(entries.some((entry) => /\.zip$/i.test(entry)), false);
    assert.equal(
      entries.some((entry) => (
        /WiredTiger|\.wt$|mongo-volume|node_modules|\/dist\/|\/coverage\/|\.log$/i
          .test(entry)
      )),
      false,
    );
    assert.equal(
      entries.some((entry) => (
        /backup\/users\.bson|runtime\/app\.log\.(?:1|gz)|nested\/artifact\.sha256/i
          .test(entry)
      )),
      false,
    );
    assert.equal(
      entries.some((entry) => /\/(?:\.git|\.superpowers)\//i.test(entry)),
      false,
    );
    assert.equal(
      entries.some((entry) => /^\.env(?:\..*)?$/i.test(path.basename(entry))
        && !/\/(?:server|client)\/\.env\.example$/.test(entry)),
      false,
    );

    const extracted = spawnSync("unzip", ["-q", output, "-d", extraction], {
      encoding: "utf8",
    });
    assert.equal(extracted.status, 0, extracted.stderr);
    const manifest = spawnSync(
      "sha256sum",
      ["--check", "--strict", "RELEASE-MANIFEST.sha256"],
      {
        cwd: path.join(extraction, releaseRoot),
        encoding: "utf8",
      },
    );
    assert.equal(manifest.status, 0, manifest.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(output, { force: true });
    rmSync(`${output}.sha256`, { force: true });
    rmSync(extraction, { recursive: true, force: true });
  }
});

test("release verifier accepts an extracted archive only with its regular plan and valid bundled manifest", () => {
  const root = createFixture();
  const extraction = mkdtempSync(path.join(os.tmpdir(), "vsb-release-archive-check-"));
  const output = path.join(
    path.dirname(root),
    `${path.basename(root)}-archive-check.zip`,
  );

  try {
    const packaged = packageRelease(root, output);
    assert.equal(packaged.status, 0, packaged.stderr);
    const extracted = spawnSync("unzip", ["-q", output, "-d", extraction], {
      encoding: "utf8",
    });
    assert.equal(extracted.status, 0, extracted.stderr);
    const archiveRoot = path.join(extraction, releaseRoot);

    const verified = verify(archiveRoot);
    assert.equal(verified.status, 0, verified.stderr);

    const repackagedOutput = path.join(
      path.dirname(root),
      `${path.basename(root)}-archive-repack.zip`,
    );
    const repackaged = packageRelease(archiveRoot, repackagedOutput);
    assert.equal(repackaged.status, 0, repackaged.stderr);
    const repackagedExtraction = mkdtempSync(
      path.join(os.tmpdir(), "vsb-release-archive-repack-"),
    );
    const repackagedExtracted = spawnSync(
      "unzip",
      ["-q", repackagedOutput, "-d", repackagedExtraction],
      { encoding: "utf8" },
    );
    assert.equal(repackagedExtracted.status, 0, repackagedExtracted.stderr);
    const repackagedRoot = path.join(repackagedExtraction, releaseRoot);
    assert.equal(
      lstatSync(path.join(repackagedRoot, "scripts/release-verify.sh")).mode & 0o111,
      0o111,
    );
    assert.equal(
      lstatSync(path.join(repackagedRoot, "docker/mongo-init.sh")).mode & 0o111,
      0o111,
    );
    rmSync(repackagedOutput, { force: true });
    rmSync(`${repackagedOutput}.sha256`, { force: true });
    rmSync(repackagedExtraction, { recursive: true, force: true });

    rmSync(path.join(archiveRoot, implementationPlanPath));
    const missingPlan = verify(archiveRoot);
    assert.equal(missingPlan.status, 1);
    assert.match(
      `${missingPlan.stdout}${missingPlan.stderr}`,
      /implementation plan.*regular file/i,
    );

    write(archiveRoot, implementationPlanPath, "tampered plan\n");
    const invalidManifest = verify(archiveRoot);
    assert.equal(invalidManifest.status, 1);
    assert.match(
      `${invalidManifest.stdout}${invalidManifest.stderr}`,
      /bundled release manifest/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(output, { force: true });
    rmSync(`${output}.sha256`, { force: true });
    rmSync(extraction, { recursive: true, force: true });
  }
});

test("release verifier treats an extracted release below an unrelated Git repository as an archive", () => {
  const root = createFixture();
  const parent = mkdtempSync(path.join(os.tmpdir(), "vsb-release-parent-git-"));
  const output = path.join(parent, "dashboard-release.zip");

  try {
    const initialized = spawnSync("git", ["init", "-q"], {
      cwd: parent,
      encoding: "utf8",
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    const packaged = packageRelease(root, output);
    assert.equal(packaged.status, 0, packaged.stderr);
    const extracted = spawnSync("unzip", ["-q", output, "-d", parent], {
      encoding: "utf8",
    });
    assert.equal(extracted.status, 0, extracted.stderr);

    const result = verify(path.join(parent, releaseRoot));
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test("release retains only the two approved environment templates", () => {
  const root = createFixture();
  const output = path.join(
    path.dirname(root),
    `${path.basename(root)}-environment-policy.zip`,
  );
  const protectedName = ["JWT", "SECRET"].join("_");
  const unsafePublicName = ["VITE", "PRIVATE", "TOKEN"].join("_");

  try {
    write(root, ".env.example", `${protectedName}=private-root-probe\n`);
    write(root, ".ENV", `${protectedName}=private-uppercase-probe\n`);
    write(root, "client/.Env.local", `${unsafePublicName}=private-client-probe\n`);
    const result = packageRelease(root, output);
    assert.equal(result.status, 0, result.stderr);

    const listing = spawnSync("unzip", ["-Z1", output], { encoding: "utf8" });
    assert.equal(listing.status, 0, listing.stderr);
    const environmentEntries = listing.stdout
      .trim()
      .split("\n")
      .filter((entry) => /^\.env(?:\..*)?$/i.test(path.basename(entry)));
    assert.deepEqual(environmentEntries.sort(), [
      `${releaseRoot}/client/.env.example`,
      `${releaseRoot}/server/.env.example`,
    ]);
    assert.doesNotMatch(listing.stdout, /private-(?:root|uppercase|client)-probe/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(output, { force: true });
    rmSync(`${output}.sha256`, { force: true });
  }
});

test("release packaging rejects line-breaking filenames before publication", () => {
  const root = createFixture();
  const output = path.join(
    path.dirname(root),
    `${path.basename(root)}-line-break.zip`,
  );

  try {
    write(root, "client/src/unsafe\nfilename.js", "unsafe filename\n");
    const result = packageRelease(root, output);
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /filename|release/i);
    assert.equal(existsSync(output), false);
    assert.equal(existsSync(`${output}.sha256`), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(output, { force: true });
    rmSync(`${output}.sha256`, { force: true });
  }
});

for (const lineBreak of ["\r", "\n"]) {
  const label = lineBreak === "\r" ? "carriage return" : "line feed";
  test(`release packaging rejects an output basename containing a ${label}`, () => {
    const root = createFixture();
    const outputParent = mkdtempSync(path.join(os.tmpdir(), "vsb-release-output-name-"));
    const output = path.join(outputParent, `dashboard${lineBreak}release.zip`);

    try {
      const result = packageRelease(root, output);
      assert.equal(result.status, 1);
      assert.match(`${result.stdout}${result.stderr}`, /output filename|CR|LF/i);
      assert.equal(existsSync(output), false);
      assert.equal(existsSync(`${output}.sha256`), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outputParent, { recursive: true, force: true });
    }
  });
}

test("release ZIP content and modes are deterministic across restrictive umasks", () => {
  const root = createFixture();
  const outputParent = mkdtempSync(path.join(os.tmpdir(), "vsb-release-umask-"));
  const permissiveOutput = path.join(outputParent, "umask-022.zip");
  const restrictiveOutput = path.join(outputParent, "umask-077.zip");

  try {
    chmodSync(path.join(root, "scripts", "release-verify.sh"), 0o755);
    chmodSync(path.join(root, "docker", "mongo-init.sh"), 0o755);
    write(root, "tools/untracked-executable.sh", "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(path.join(root, "tools", "untracked-executable.sh"), 0o755);
    const tracked = spawnSync(
      "git",
      ["add", "--", "scripts/release-verify.sh", "docker/mongo-init.sh"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(tracked.status, 0, tracked.stderr);

    const permissive = packageRelease(root, permissiveOutput, { umask: "022" });
    const restrictive = packageRelease(root, restrictiveOutput, { umask: "077" });
    assert.equal(permissive.status, 0, permissive.stderr);
    assert.equal(restrictive.status, 0, restrictive.stderr);

    const hash = (filename) => spawnSync("sha256sum", [filename], { encoding: "utf8" })
      .stdout.split(/\s+/, 1)[0];
    assert.equal(hash(permissiveOutput), hash(restrictiveOutput));

    const archivedModes = (filename) => {
      const listing = spawnSync("zipinfo", ["-l", filename], { encoding: "utf8" });
      assert.equal(listing.status, 0, listing.stderr);
      return Object.fromEntries(listing.stdout
        .split("\n")
        .map((line) => line.match(/^(-[rwx-]{9})\s+.*\s(\S+)$/))
        .filter(Boolean)
        .map((match) => [match[2], match[1]]));
    };
    const permissiveModes = archivedModes(permissiveOutput);
    const restrictiveModes = archivedModes(restrictiveOutput);
    assert.deepEqual(permissiveModes, restrictiveModes);
    assert.equal(permissiveModes[`${releaseRoot}/scripts/release-verify.sh`], "-rwxr-xr-x");
    assert.equal(permissiveModes[`${releaseRoot}/docker/mongo-init.sh`], "-rwxr-xr-x");
    assert.equal(permissiveModes[`${releaseRoot}/tools/untracked-executable.sh`], "-rw-r--r--");
    assert.equal(permissiveModes[`${releaseRoot}/RELEASE-MANIFEST.sha256`], "-rw-r--r--");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputParent, { recursive: true, force: true });
  }
});

test("release verifier rejects a required file implemented as a symlink", () => {
  const root = createFixture();

  try {
    rmSync(path.join(root, "README.md"));
    symlinkSync("docs/api/core-booking-api.md", path.join(root, "README.md"));
    const result = verify(root);
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /required release file|symbolic link/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release packaging rejects project-tree output, overwrite, sidecar collision, and the reserved v1 filename", () => {
  const root = createFixture();
  const outputParent = mkdtempSync(path.join(os.tmpdir(), "vsb-release-output-policy-"));
  const insideParent = path.join(root, "release-output");
  mkdirSync(insideParent);

  try {
    const inside = packageRelease(root, path.join(insideParent, "dashboard.zip"));
    assert.equal(inside.status, 1);
    assert.match(`${inside.stdout}${inside.stderr}`, /outside the project tree/i);

    const existingOutput = path.join(outputParent, "existing-dashboard.zip");
    writeFileSync(existingOutput, "preserve-existing-output\n");
    const overwrite = packageRelease(root, existingOutput);
    assert.equal(overwrite.status, 1);
    assert.match(`${overwrite.stdout}${overwrite.stderr}`, /already exists/i);
    assert.equal(readFileSync(existingOutput, "utf8"), "preserve-existing-output\n");

    const sidecarOutput = path.join(outputParent, "sidecar-collision.zip");
    writeFileSync(`${sidecarOutput}.sha256`, "preserve-existing-sidecar\n");
    const sidecarCollision = packageRelease(root, sidecarOutput);
    assert.equal(sidecarCollision.status, 1);
    assert.match(`${sidecarCollision.stdout}${sidecarCollision.stderr}`, /sidecar already exists/i);
    assert.equal(
      readFileSync(`${sidecarOutput}.sha256`, "utf8"),
      "preserve-existing-sidecar\n",
    );

    const reservedV1Output = path.join(
      outputParent,
      "VehicleServiceBooking-core-booking-v1.0.0.zip",
    );
    const reserved = packageRelease(root, reservedV1Output);
    assert.equal(reserved.status, 1);
    assert.match(`${reserved.stdout}${reserved.stderr}`, /Core Booking v1.*reserved/i);
    assert.equal(existsSync(reservedV1Output), false);
    assert.equal(existsSync(`${reservedV1Output}.sha256`), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputParent, { recursive: true, force: true });
  }
});

test("release packaging rejects dangling sidecar and output redirects without corrupting their targets", () => {
  const root = createFixture();
  const outputParent = mkdtempSync(path.join(os.tmpdir(), "vsb-release-symlink-policy-"));

  try {
    const output = path.join(outputParent, "dashboard.zip");
    const sidecar = `${output}.sha256`;
    symlinkSync(output, sidecar);

    const sidecarRedirect = packageRelease(root, output);
    assert.equal(sidecarRedirect.status, 1);
    assert.match(`${sidecarRedirect.stdout}${sidecarRedirect.stderr}`, /sidecar|symbolic link/i);
    assert.equal(existsSync(output), false);
    assert.equal(lstatSync(sidecar).isSymbolicLink(), true);
    assert.equal(readlinkSync(sidecar), output);

    rmSync(sidecar);
    const reservedV1Output = path.join(
      outputParent,
      "VehicleServiceBooking-core-booking-v1.0.0.zip",
    );
    const redirectedOutput = path.join(outputParent, "redirected-dashboard.zip");
    symlinkSync(reservedV1Output, redirectedOutput);

    const outputRedirect = packageRelease(root, redirectedOutput);
    assert.equal(outputRedirect.status, 1);
    assert.match(`${outputRedirect.stdout}${outputRedirect.stderr}`, /output|symbolic link/i);
    assert.equal(existsSync(reservedV1Output), false);
    assert.equal(lstatSync(redirectedOutput).isSymbolicLink(), true);
    assert.equal(readlinkSync(redirectedOutput), reservedV1Output);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputParent, { recursive: true, force: true });
  }
});

test("partial publication failure preserves foreign final replacements", () => {
  const root = createFixture();
  const outputParent = mkdtempSync(path.join(os.tmpdir(), "vsb-release-cleanup-race-"));
  const output = path.join(outputParent, "dashboard.zip");
  const shimDirectory = path.join(outputParent, "command-shims");
  const raceCounter = path.join(outputParent, "ln-race-triggered");
  const replacement = "raced replacement must survive cleanup";
  const racedSidecar = "raced sidecar must survive cleanup";

  try {
    write(
      shimDirectory,
      "ln",
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [[ ! -e "$RACE_COUNTER_FILE" ]]; then',
        '  command -p ln "$@"',
        '  destination="${@: -1}"',
        '  rm -f -- "$destination"',
        `  printf '%s' ${JSON.stringify(replacement)} > "$destination"`,
        `  printf '%s' ${JSON.stringify(racedSidecar)} > "$destination.sha256"`,
        '  printf "triggered\\n" > "$RACE_COUNTER_FILE"',
        "  exit 0",
        "fi",
        'command -p ln "$@"',
        "",
      ].join("\n"),
    );
    chmodSync(path.join(shimDirectory, "ln"), 0o755);

    const result = packageRelease(root, output, {
      env: {
        ...process.env,
        PATH: `${shimDirectory}${path.delimiter}${process.env.PATH}`,
        RACE_COUNTER_FILE: raceCounter,
      },
    });
    const commandOutput = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1);
    assert.doesNotMatch(commandOutput, /RELEASE ZIP: PASS|CHECKSUM:/);
    assert.equal(existsSync(output), true, "cleanup deleted the raced replacement");
    assert.equal(readFileSync(output, "utf8"), replacement);
    assert.equal(readFileSync(`${output}.sha256`, "utf8"), racedSidecar);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputParent, { recursive: true, force: true });
  }
});

test("partial publication failure preserves the verifier-owned published ZIP", () => {
  const root = createFixture();
  const outputParent = mkdtempSync(path.join(os.tmpdir(), "vsb-release-partial-publication-"));
  const output = path.join(outputParent, "dashboard.zip");
  const shimDirectory = path.join(outputParent, "command-shims");
  const raceCounter = path.join(outputParent, "ln-race-triggered");
  const racedSidecar = "raced sidecar must survive cleanup";

  try {
    write(
      shimDirectory,
      "ln",
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [[ ! -e "$RACE_COUNTER_FILE" ]]; then',
        '  command -p ln "$@"',
        '  destination="${@: -1}"',
        `  printf '%s' ${JSON.stringify(racedSidecar)} > "$destination.sha256"`,
        '  printf "triggered\\n" > "$RACE_COUNTER_FILE"',
        "  exit 0",
        "fi",
        'command -p ln "$@"',
        "",
      ].join("\n"),
    );
    chmodSync(path.join(shimDirectory, "ln"), 0o755);

    const result = packageRelease(root, output, {
      env: {
        ...process.env,
        PATH: `${shimDirectory}${path.delimiter}${process.env.PATH}`,
        RACE_COUNTER_FILE: raceCounter,
      },
    });
    const commandOutput = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1);
    assert.doesNotMatch(commandOutput, /RELEASE ZIP: PASS|CHECKSUM:/);
    assert.equal(existsSync(output), true, "cleanup deleted the published ZIP");
    const integrity = spawnSync("unzip", ["-t", output], { encoding: "utf8" });
    assert.equal(integrity.status, 0, integrity.stderr);
    assert.equal(readFileSync(`${output}.sha256`, "utf8"), racedSidecar);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputParent, { recursive: true, force: true });
  }
});

test("published external sidecar is independently verified before PASS", () => {
  const root = createFixture();
  const outputParent = mkdtempSync(path.join(os.tmpdir(), "vsb-release-sidecar-check-"));
  const output = path.join(outputParent, "dashboard.zip");
  const shimDirectory = path.join(outputParent, "command-shims");
  const callCounter = path.join(outputParent, "ln-call-count");

  try {
    write(
      shimDirectory,
      "ln",
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "count=0",
        'if [[ -f "$CALL_COUNTER_FILE" ]]; then read -r count < "$CALL_COUNTER_FILE"; fi',
        "count=$((count + 1))",
        'printf "%s\\n" "$count" > "$CALL_COUNTER_FILE"',
        'command -p ln "$@"',
        'if [[ "$count" == "2" ]]; then',
        '  destination="${@: -1}"',
        '  printf "corrupted external sidecar\\n" > "$destination"',
        "fi",
        "",
      ].join("\n"),
    );
    chmodSync(path.join(shimDirectory, "ln"), 0o755);

    const result = packageRelease(root, output, {
      env: {
        ...process.env,
        CALL_COUNTER_FILE: callCounter,
        PATH: `${shimDirectory}${path.delimiter}${process.env.PATH}`,
      },
    });
    const commandOutput = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(commandOutput, /published checksum sidecar verification failed/i);
    assert.doesNotMatch(commandOutput, /RELEASE ZIP: PASS|CHECKSUM:/);
    assert.equal(lstatSync(output).isFile(), true);
    assert.equal(readFileSync(`${output}.sha256`, "utf8"), "corrupted external sidecar\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputParent, { recursive: true, force: true });
  }
});

for (const destination of ["ZIP", "sidecar"]) {
  for (const replacementKind of ["directory", "symlink to a directory"]) {
    test(`release packaging rejects a raced ${replacementKind} at the exact ${destination} destination`, () => {
      const root = createFixture();
      const outputParent = mkdtempSync(path.join(os.tmpdir(), "vsb-release-directory-race-"));
      const output = path.join(outputParent, "dashboard.zip");
      const shimDirectory = path.join(outputParent, "command-shims");
      const raceCounter = path.join(outputParent, "ln-call-count");
      const raceDirectory = path.join(outputParent, "race-directory");
      const raceOnCall = destination === "ZIP" ? "1" : "2";

      try {
        mkdirSync(raceDirectory);
        write(
          shimDirectory,
          "ln",
          [
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            "count=0",
            'if [[ -f "$RACE_COUNTER_FILE" ]]; then read -r count < "$RACE_COUNTER_FILE"; fi',
            "count=$((count + 1))",
            'printf "%s\\n" "$count" > "$RACE_COUNTER_FILE"',
            'if [[ "$count" == "$RACE_ON_CALL" ]]; then',
            '  destination="${@: -1}"',
            '  if [[ "$RACE_REPLACEMENT_KIND" == "directory" ]]; then',
            '    mkdir -- "$destination"',
            "  else",
            '    command -p ln -s -- "$RACE_DIRECTORY" "$destination"',
            "  fi",
            "fi",
            'command -p ln "$@"',
            "",
          ].join("\n"),
        );
        chmodSync(path.join(shimDirectory, "ln"), 0o755);

        const result = packageRelease(root, output, {
          env: {
            ...process.env,
            PATH: `${shimDirectory}${path.delimiter}${process.env.PATH}`,
            RACE_COUNTER_FILE: raceCounter,
            RACE_DIRECTORY: raceDirectory,
            RACE_ON_CALL: raceOnCall,
            RACE_REPLACEMENT_KIND: replacementKind === "directory" ? "directory" : "symlink",
          },
        });
        const commandOutput = `${result.stdout}${result.stderr}`;

        assert.equal(result.status, 1);
        assert.doesNotMatch(commandOutput, /RELEASE ZIP: PASS|CHECKSUM:/);
        if (destination === "ZIP") {
          const racedDestination = lstatSync(output);
          assert.equal(
            replacementKind === "directory"
              ? racedDestination.isDirectory()
              : racedDestination.isSymbolicLink(),
            true,
            "raced ZIP destination was removed",
          );
          const nestedArchive = replacementKind === "directory"
            ? path.join(output, "archive.zip")
            : path.join(raceDirectory, "archive.zip");
          assert.equal(existsSync(nestedArchive), false);
          assert.equal(existsSync(`${output}.sha256`), false);
        } else {
          assert.equal(lstatSync(output).isFile(), true, "published ZIP was removed");
          const racedDestination = lstatSync(`${output}.sha256`);
          assert.equal(
            replacementKind === "directory"
              ? racedDestination.isDirectory()
              : racedDestination.isSymbolicLink(),
            true,
            "raced sidecar destination was removed",
          );
          const nestedSidecar = replacementKind === "directory"
            ? path.join(`${output}.sha256`, "archive.zip.sha256")
            : path.join(raceDirectory, "archive.zip.sha256");
          assert.equal(existsSync(nestedSidecar), false);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(outputParent, { recursive: true, force: true });
      }
    });
  }
}

test("check-only excludes a linked-worktree Git pointer before counting staging", () => {
  const root = createFixture();
  let gitStorage;

  try {
    const baseline = verify(root);
    assert.equal(baseline.status, 0, baseline.stderr);
    gitStorage = useGitPointerFile(root);

    const result = verify(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      stagedEntryCount(result),
      stagedEntryCount(baseline),
      "linked-worktree .git pointer entered staging",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (gitStorage) rmSync(gitStorage, { recursive: true, force: true });
  }
});

test("release packaging excludes a linked-worktree Git pointer before ZIP creation", () => {
  const root = createFixture();
  const output = path.join(path.dirname(root), `${path.basename(root)}-linked-worktree.zip`);
  let gitStorage;

  try {
    gitStorage = useGitPointerFile(root);
    const result = packageRelease(root, output);
    assert.equal(result.status, 0, result.stderr);

    const listing = spawnSync("unzip", ["-Z1", output], { encoding: "utf8" });
    assert.equal(listing.status, 0, listing.stderr);
    assert.equal(listing.stdout.split("\n").some((entry) => /\/(?:\.git)(?:\/|$)/.test(entry)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (gitStorage) rmSync(gitStorage, { recursive: true, force: true });
    rmSync(output, { force: true });
    rmSync(`${output}.sha256`, { force: true });
  }
});

test("root ignore contract excludes secrets, dependencies, builds, coverage, and archives", () => {
  const entries = readFileSync(path.join(repositoryRoot, ".gitignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const required of [
    ".env",
    ".env.*",
    "!.env.example",
    "node_modules/",
    "dist/",
    "coverage/",
    "*.zip",
  ]) {
    assert.ok(entries.includes(required), `missing root ignore rule ${required}`);
  }
});

test('release verifier accepts the current public workshop template', () => {
  const root = createFixture();
  try {
    write(root, 'server/.env.example', readFileSync(path.join(repositoryRoot, 'server/.env.example'), 'utf8'));
    const result = verify(root);
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('release verifier rejects private HTTPS email credentials without printing them', () => {
  const root = createFixture();
  const field = ['BREVO', 'API', 'KEY'].join('_');
  const privateValue = 'synthetic-secret-that-must-be-rejected';
  try {
    write(root, 'server/config/email-provider.js', `const config = { ${field}: '${privateValue}' };\n`);
    const result = verify(root);
    assert.notEqual(result.status, 0);
    assert.ok(!(result.stdout + result.stderr).includes(privateValue));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
