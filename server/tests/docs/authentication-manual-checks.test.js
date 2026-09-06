const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const checklist = readFileSync(
  path.join(__dirname, "../../docs/authentication-manual-checks.md"),
  "utf8",
).replaceAll("\r\n", "\n");

function powershellBlockStartingWith(marker) {
  const start = checklist.indexOf(marker);
  assert.notEqual(start, -1, `checklist must contain ${marker}`);

  const end = checklist.indexOf("\n```", start);
  assert.notEqual(end, -1, `PowerShell block for ${marker} must close`);
  return checklist.slice(start, end);
}

test("blocked pre-verification login clears its password body in finally", () => {
  const block = powershellBlockStartingWith(
    "$blockedLoginBody = @{ identifier = $customerEmail; password = $customerPassword }",
  );
  const tryIndex = block.indexOf("try {");
  const catchIndex = block.indexOf("} catch {");
  const finallyIndex = block.indexOf("} finally {");

  assert.ok(tryIndex >= 0, "blocked-login block must contain try");
  assert.ok(catchIndex > tryIndex, "blocked-login catch must follow try");
  assert.ok(finallyIndex > catchIndex, "blocked-login finally must follow catch");
  const finallyMatch = block
    .slice(finallyIndex)
    .match(/^} finally \{\n(?<body>(?:  [^\n]*\n)*)\}/);
  assert.ok(finallyMatch, "blocked-login finally must have a bounded body");
  assert.equal(
    finallyMatch.groups.body.includes("$blockedLoginBody = $null"),
    true,
    "blocked-login cleanup must occur inside the finally body",
  );
});
