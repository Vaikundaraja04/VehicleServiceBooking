import { describe, expect, it } from "vitest";
import { bookingErrorMessage, isSlotConflict } from "./bookingErrors";

describe("isSlotConflict", () => {
  it("recognizes only the exact slot-conflict status and message", () => {
    expect(
      isSlotConflict({ status: 409, message: "That time is no longer available" }),
    ).toBe(true);

    for (const error of [
      { status: 400, message: "That time is no longer available" },
      { status: "409", message: "That time is no longer available" },
      { status: 409, message: "That time is no longer available " },
      { status: 409, message: "Booking status no longer permits this action" },
      null,
    ]) {
      expect(isSlotConflict(error)).toBe(false);
    }
  });
});

describe("bookingErrorMessage", () => {
  it("prefers a trimmed nonblank direct server message", () => {
    expect(
      bookingErrorMessage(
        { status: 409, message: "  Booking action is not allowed at this time  " },
        "Unable to cancel booking",
      ),
    ).toBe("Booking action is not allowed at this time");
  });

  it.each([
    [undefined, "Unable to load bookings"],
    [null, "Unable to load bookings"],
    [{ message: "   " }, "Unable to load bookings"],
    [{ message: { private: "do not expose" } }, "Unable to load bookings"],
    [
      { response: { data: { message: "internal response detail" } } },
      "Unable to load bookings",
    ],
  ])("uses the fallback without exposing response internals for %#", (error, fallback) => {
    expect(bookingErrorMessage(error, fallback)).toBe(fallback);
  });

  it("never stringifies a non-string fallback", () => {
    expect(bookingErrorMessage({}, { private: "do not expose" })).toBe(
      "Something went wrong",
    );
  });

  it("returns a controlled string fallback exactly as supplied", () => {
    expect(bookingErrorMessage({}, "  Unable to load bookings  ")).toBe(
      "  Unable to load bookings  ",
    );
  });
});
