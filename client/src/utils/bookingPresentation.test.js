import { describe, expect, it } from "vitest";
import {
  bookingStatusTone,
  formatBookingStatus,
  formatDuration,
  formatWorkshopDate,
  formatWorkshopTimeRange,
  isCancellationEligible,
} from "./bookingPresentation";

describe("booking presentation", () => {
  it("formats a canonical workshop-local date with stable en-IN labels", () => {
    expect(formatWorkshopDate("2026-09-01", "Asia/Kolkata")).toBe(
      "Tuesday, 1 September 2026",
    );
    expect(formatWorkshopDate("2026-09-01", "Pacific/Kiritimati")).toBe(
      "Tuesday, 1 September 2026",
    );
  });

  it.each([
    [undefined, "Asia/Kolkata"],
    ["2026-02-30", "Asia/Kolkata"],
    ["2026-09-01", "Not/A_Time_Zone"],
  ])("returns a safe date fallback for %j in %j", (date, timeZone) => {
    expect(() => formatWorkshopDate(date, timeZone)).not.toThrow();
    expect(formatWorkshopDate(date, timeZone)).toBe("Date unavailable");
  });

  it.each([undefined, null, "", "   "])(
    "requires a supplied nonblank timezone for workshop dates: %j",
    (timeZone) => {
      expect(() => formatWorkshopDate("2026-09-01", timeZone)).not.toThrow();
      expect(formatWorkshopDate("2026-09-01", timeZone)).toBe("Date unavailable");
    },
  );

  it("formats a workshop-local start and end range", () => {
    const slot = {
      startsAt: "2026-09-01T03:30:00.000Z",
      endsAt: "2026-09-01T05:00:00.000Z",
    };

    expect(formatWorkshopTimeRange(slot, "Asia/Kolkata")).toBe(
      "9:00 am – 10:30 am",
    );
    expect(formatWorkshopTimeRange(slot, "Europe/London")).toBe(
      "4:30 am – 6:00 am",
    );
  });

  it("accepts ISO instants with explicit numeric offsets", () => {
    expect(
      formatWorkshopTimeRange(
        {
          startsAt: "2026-09-01T09:00:00+05:30",
          endsAt: "2026-09-01T10:30:00+05:30",
        },
        "Asia/Kolkata",
      ),
    ).toBe("9:00 am – 10:30 am");
  });

  it.each([
    {
      label: "date-only strings",
      slot: { startsAt: "2026-09-01", endsAt: "2026-09-02" },
    },
    {
      label: "locale-style strings",
      slot: { startsAt: "09/01/2026", endsAt: "09/02/2026" },
    },
    {
      label: "ISO strings without a timezone",
      slot: {
        startsAt: "2026-09-01T03:30:00.000",
        endsAt: "2026-09-01T05:00:00.000",
      },
    },
    {
      label: "Date objects outside the JSON response contract",
      slot: {
        startsAt: new Date("2026-09-01T03:30:00.000Z"),
        endsAt: new Date("2026-09-01T05:00:00.000Z"),
      },
    },
  ])("rejects $label without throwing", ({ slot }) => {
    expect(() => formatWorkshopTimeRange(slot, "Asia/Kolkata")).not.toThrow();
    expect(formatWorkshopTimeRange(slot, "Asia/Kolkata")).toBe("Time unavailable");
  });

  it.each([
    [undefined, "Asia/Kolkata"],
    [{}, "Asia/Kolkata"],
    [{ startsAt: "bad", endsAt: "also-bad" }, "Asia/Kolkata"],
    [
      {
        startsAt: "2026-09-01T03:30:00.000Z",
        endsAt: "2026-09-01T05:00:00.000Z",
      },
      "Not/A_Time_Zone",
    ],
  ])("returns a safe time fallback for invalid input %#", (slot, timeZone) => {
    expect(() => formatWorkshopTimeRange(slot, timeZone)).not.toThrow();
    expect(formatWorkshopTimeRange(slot, timeZone)).toBe("Time unavailable");
  });

  it.each([undefined, null, "", "   "])(
    "requires a supplied nonblank timezone for workshop times: %j",
    (timeZone) => {
      const slot = {
        startsAt: "2026-09-01T03:30:00.000Z",
        endsAt: "2026-09-01T05:00:00.000Z",
      };

      expect(() => formatWorkshopTimeRange(slot, timeZone)).not.toThrow();
      expect(formatWorkshopTimeRange(slot, timeZone)).toBe("Time unavailable");
    },
  );

  it.each([
    [30, "30 minutes"],
    [60, "1 hour"],
    [90, "1 hour 30 minutes"],
    [240, "4 hours"],
  ])("formats %i minutes as %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });

  it.each([undefined, null, NaN, 0, -30, 60.5, "60"])(
    "returns a safe duration fallback for %j",
    (minutes) => {
      expect(() => formatDuration(minutes)).not.toThrow();
      expect(formatDuration(minutes)).toBe("Duration unavailable");
    },
  );
});

describe("booking statuses", () => {
  it.each([
    ["requested", "Requested", "pending"],
    ["confirmed", "Confirmed", "confirmed"],
    ["in_service", "In service", "active"],
    ["completed", "Completed", "success"],
    ["cancelled", "Cancelled", "neutral"],
    ["rejected", "Rejected", "danger"],
    ["no_show", "No show", "danger"],
  ])("maps %s to its customer label and tone", (status, label, tone) => {
    expect(formatBookingStatus(status)).toBe(label);
    expect(bookingStatusTone(status)).toBe(tone);
  });

  it.each([undefined, null, "", "waiting", { status: "requested" }])(
    "uses safe status fallbacks for %j",
    (status) => {
      expect(() => formatBookingStatus(status)).not.toThrow();
      expect(formatBookingStatus(status)).toBe("Unknown status");
      expect(bookingStatusTone(status)).toBe("neutral");
    },
  );

  it("allows cancellation only for requested and confirmed bookings", () => {
    expect(isCancellationEligible({ status: "requested" })).toBe(true);
    expect(isCancellationEligible(Object.freeze({ status: "confirmed" }))).toBe(true);

    for (const status of ["in_service", "completed", "cancelled", "rejected", "no_show"]) {
      expect(isCancellationEligible({ status })).toBe(false);
    }
    expect(isCancellationEligible()).toBe(false);
  });
});
