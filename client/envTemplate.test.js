import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(projectDirectory, ".env.example");

describe("public client environment template", () => {
  it("contains only the documented non-secret API origin", () => {
    const source = readFileSync(templatePath, "utf8");

    expect(source).toBe(
      [
        "# VITE_ values are public and included in browser bundles. Never put secrets here.",
        "VITE_API_URL=http://localhost:5000/api",
        "",
      ].join("\n"),
    );

    const configuredLines = source
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));
    const configuredNames = configuredLines.map((line) =>
      line.slice(0, line.indexOf("=")),
    );

    expect(configuredNames).toEqual(["VITE_API_URL"]);
    expect(configuredNames.join("\n")).not.toMatch(
      /password|secret|token|private[_-]?key/i,
    );
  });
});
