import { afterEach, describe, expect, it, vi } from "vitest";
import { workshopScheduleApi } from "./workshopScheduleApi";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(body),
  };
}

function installFetch(body, status = 200) {
  const fetch = vi.fn().mockResolvedValue(jsonResponse(body, status));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const replacement = {
  bayCount: 2,
  weeklyHours: [
    { weekday: 1, isClosed: false, openTime: "09:00", closeTime: "18:00" },
    { weekday: 2, isClosed: false, openTime: "09:00", closeTime: "18:00" },
    { weekday: 3, isClosed: false, openTime: "09:00", closeTime: "18:00" },
    { weekday: 4, isClosed: false, openTime: "09:00", closeTime: "18:00" },
    { weekday: 5, isClosed: false, openTime: "09:00", closeTime: "18:00" },
    { weekday: 6, isClosed: false, openTime: "09:00", closeTime: "18:00" },
    { weekday: 7, isClosed: true },
  ],
  dateOverrides: [{ date: "2026-10-02", isClosed: true }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workshopScheduleApi request contracts", () => {
  it("gets the workshop schedule with one credentialed bodyless GET", async () => {
    const envelope = {
      schedule: {
        ...replacement,
        timeZone: "Asia/Kolkata",
        slotMinutes: 30,
        updatedAt: "2026-08-29T12:00:00.000Z",
      },
    };
    const fetch = installFetch(envelope);

    await expect(workshopScheduleApi.get()).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/admin/workshop-schedule",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("replaces the workshop schedule with the exact full JSON document", async () => {
    const envelope = {
      schedule: {
        ...replacement,
        timeZone: "Asia/Kolkata",
        slotMinutes: 30,
        updatedAt: "2026-08-29T12:05:00.000Z",
      },
    };
    const fetch = installFetch(envelope);

    await expect(workshopScheduleApi.replace(replacement)).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/admin/workshop-schedule",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replacement),
      }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(replacement);
  });
});
