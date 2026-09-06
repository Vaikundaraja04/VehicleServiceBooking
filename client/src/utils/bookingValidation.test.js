import { describe, expect, it } from "vitest";
import {
  toBookingCreatePayload,
  validateBookingDraft,
  validateCancelReason,
  validateNotes,
} from "./bookingValidation";

describe("booking validation", () => {
  it("returns stable field keys for an empty draft", () => {
    expect(validateBookingDraft()).toEqual({
      vehicleId: "Select a vehicle",
      serviceId: "Select a service",
      date: "Select an appointment date",
      slot: "Select an appointment time",
      notes: "",
    });
  });

  it.each([
    ["2026-09-01", ""],
    ["2026-02-29", "Enter a valid date in YYYY-MM-DD format"],
    ["2028-02-29", ""],
    ["2026-02-30", "Enter a valid date in YYYY-MM-DD format"],
    ["2026-2-03", "Enter a valid date in YYYY-MM-DD format"],
    [" 2026-09-01 ", "Enter a valid date in YYYY-MM-DD format"],
  ])("validates canonical workshop date %j", (date, expectedDateError) => {
    const errors = validateBookingDraft({
      vehicleId: "vehicle-1",
      serviceId: "service-1",
      date,
      slot: { startsAt: "2026-09-01T03:30:00.000Z" },
      notes: "",
    });

    expect(errors).toEqual({
      vehicleId: "",
      serviceId: "",
      date: expectedDateError,
      slot: "",
      notes: "",
    });
  });

  it("requires a usable selected slot without validating server timing policy", () => {
    const baseDraft = {
      vehicleId: "vehicle-1",
      serviceId: "service-1",
      date: "2026-09-01",
    };

    expect(validateBookingDraft({ ...baseDraft, slot: {} }).slot).toBe(
      "Select an appointment time",
    );
    expect(
      validateBookingDraft({
        ...baseDraft,
        slot: { startsAt: "2026-08-29T00:00:00.000Z" },
      }).slot,
    ).toBe("");
  });

  it("allows optional notes through the trimmed 500-character boundary", () => {
    expect(validateNotes()).toBe("");
    expect(validateNotes("   ")).toBe("");
    expect(validateNotes(`  ${"x".repeat(500)}  `)).toBe("");
    expect(validateNotes(`  ${"x".repeat(501)}  `)).toBe(
      "Notes cannot exceed 500 characters",
    );
  });

  it("allows an optional cancellation reason through the trimmed 300-character boundary", () => {
    expect(validateCancelReason()).toBe("");
    expect(validateCancelReason("   ")).toBe("");
    expect(validateCancelReason(`  ${"x".repeat(300)}  `)).toBe("");
    expect(validateCancelReason(`  ${"x".repeat(301)}  `)).toBe(
      "Reason cannot exceed 300 characters",
    );
  });

  it("includes the notes boundary error in the stable draft error shape", () => {
    expect(
      validateBookingDraft({
        vehicleId: "vehicle-1",
        serviceId: "service-1",
        date: "2026-09-01",
        slot: { startsAt: "2026-09-01T03:30:00.000Z" },
        notes: "x".repeat(501),
      }),
    ).toEqual({
      vehicleId: "",
      serviceId: "",
      date: "",
      slot: "",
      notes: "Notes cannot exceed 500 characters",
    });
  });
});

describe("toBookingCreatePayload", () => {
  it("returns only server-accepted fields and trims nonblank notes", () => {
    const slot = Object.freeze({
      startsAt: "2026-09-01T03:30:00.000Z",
      endsAt: "2026-09-01T05:00:00.000Z",
      remainingCapacity: 2,
    });
    const draft = Object.freeze({
      vehicleId: "vehicle-1",
      serviceId: "service-1",
      date: "2026-09-01",
      slot,
      notes: "  check battery  ",
      bayNumber: 4,
      durationMinutes: 90,
      status: "confirmed",
      reservedSlotKeys: ["internal"],
    });

    expect(toBookingCreatePayload(draft)).toEqual({
      vehicleId: "vehicle-1",
      serviceId: "service-1",
      startsAt: "2026-09-01T03:30:00.000Z",
      notes: "check battery",
    });
    expect(draft.notes).toBe("  check battery  ");
    expect(draft.slot).toBe(slot);
  });

  it("omits blank optional notes", () => {
    expect(
      toBookingCreatePayload({
        vehicleId: "vehicle-1",
        serviceId: "service-1",
        slot: { startsAt: "2026-09-01T03:30:00.000Z" },
        notes: "   ",
      }),
    ).toEqual({
      vehicleId: "vehicle-1",
      serviceId: "service-1",
      startsAt: "2026-09-01T03:30:00.000Z",
    });
  });
});
