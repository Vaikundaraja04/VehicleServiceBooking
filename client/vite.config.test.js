import { describe, expect, it } from "vitest";
import config from "./vite.config.js";

describe("Vite development server configuration", () => {
  it("uses the fixed credentialed-browser origin and refuses another port", () => {
    expect(config.server).toEqual({ port: 5173, strictPort: true });
  });
});
