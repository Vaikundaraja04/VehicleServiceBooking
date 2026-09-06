const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const repositoryRoot =
  process.env.RELEASE_CONTRACT_ROOT ||
  path.resolve(__dirname, "..", "..", "..");

function readWorkflow() {
  return readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  ).replace(/\r\n/g, "\n");
}

function orderedOffsets(source, snippets) {
  let cursor = -1;
  return snippets.map((snippet) => {
    const offset = source.indexOf(snippet, cursor + 1);
    assert.notEqual(offset, -1, `missing workflow command: ${snippet}`);
    assert.ok(offset > cursor, `workflow command is out of order: ${snippet}`);
    cursor = offset;
    return offset;
  });
}

test("CI has least-privilege push and pull-request triggers on Node 24", () => {
  const workflow = readWorkflow();

  assert.match(workflow, /^name: CI\s*$/m);
  assert.match(workflow, /^on:\s*$/m);
  assert.match(workflow, /^\s{2}push:\s*$/m);
  assert.match(workflow, /^\s{2}pull_request:\s*$/m);
  assert.match(workflow, /^permissions:\n\s{2}contents: read\s*$/m);
  assert.match(workflow, /uses: actions\/checkout@v4/);
  assert.equal((workflow.match(/uses: actions\/setup-node@v4/g) || []).length, 2);
  assert.equal((workflow.match(/node-version: 24/g) || []).length, 2);
  assert.match(
    workflow,
    /cache-dependency-path: server\/package-lock\.json/,
  );
  assert.match(
    workflow,
    /cache-dependency-path: client\/package-lock\.json/,
  );
});

test("CI executes the approved no-secret release command matrix in exact order", () => {
  const workflow = readWorkflow();
  const commands = [
    "- run: docker compose up -d mongo",
    "- run: docker compose run --rm mongo-init",
    "- run: docker compose run --rm server-test npm run test:all:external",
    "- run: npm --prefix client ci",
    "- run: npm --prefix client test -- --run",
    "- run: npm --prefix client run lint",
    "- run: npm --prefix client run build",
    "- run: bash scripts/release-verify.sh --check-only",
  ];

  orderedOffsets(workflow, commands);
  for (const command of commands) {
    assert.equal(
      workflow.split(command).length - 1,
      1,
      `workflow command must occur exactly once: ${command}`,
    );
  }
});

test("CI always cleans Compose state and contains no deploy, secret, Gmail, or external DB wiring", () => {
  const workflow = readWorkflow();

  assert.match(
    workflow,
    /- name: Clean up Compose\n\s+if: always\(\)\n\s+run: docker compose down --volumes --remove-orphans/,
  );
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./i);
  assert.doesNotMatch(workflow, /gmail|deploy|environment:/i);
  assert.doesNotMatch(workflow, /mongodb(?:\+srv)?:\/\/(?!mongo:27017)/i);
  assert.doesNotMatch(workflow, /vehicle_service_booking(?!_test)/);
});
