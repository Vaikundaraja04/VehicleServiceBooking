import { describe, expect, it } from "vitest";
import { normalizeRegistrationNumber } from "./vehicleValidation";

describe("normalizeRegistrationNumber", () => {
  it.each([
    ["TN 01 AB-1234", "TN01AB1234"],
    ["  ka-03-mn-9999 ", "KA03MN9999"],
    ["", ""],
    [undefined, ""],
  ])("normalizes %j to %s", (input, expected) => {
    expect(normalizeRegistrationNumber(input)).toBe(expected);
  });
});