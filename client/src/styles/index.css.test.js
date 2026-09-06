import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function relativeLuminance(hex) {
  const channels = hex.match(/[a-f0-9]{2}/gi).map((channel) => Number.parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));

  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

describe("focus-ring contrast", () => {
  it("uses a declared focus color with at least 3:1 contrast on shipped light surfaces", async () => {
    const css = await readFile("src/styles/index.css", "utf8");
    const focusColor = css.match(/--focus-ring:\s*(#[a-f0-9]{6})/i)?.[1];

    expect(focusColor).toBeDefined();
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\)/s);
    expect(contrastRatio(focusColor, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(focusColor, "#eef7ff")).toBeGreaterThanOrEqual(3);
  });
});

describe("administrator operation layouts", () => {
  it("applies scoped grid, control, and long-content protections through stable page hooks", async () => {
    const style = document.createElement("style");
    style.textContent = await readFile("src/styles/index.css", "utf8");
    document.head.append(style);
    document.body.innerHTML = `
      <section class="admin-services-page">
        <form class="admin-services-filters">
          <label for="admin-service-search">Search</label>
          <input id="admin-service-search">
          <button>Search</button>
          <label for="admin-service-status">Status</label>
          <select id="admin-service-status"><option>All</option></select>
        </form>
        <ul class="service-list"><li><article class="service-card"><dl><dt>Name</dt><dd>Long value</dd></dl></article></li></ul>
      </section>
      <section class="admin-schedule-page">
        <form class="schedule-form">
          <fieldset class="schedule-weekday-grid"><fieldset><input></fieldset></fieldset>
          <fieldset class="schedule-override-list"><fieldset><input></fieldset></fieldset>
        </form>
      </section>
      <section class="bookings-page">
        <form aria-label="Filter administrator bookings">
          <fieldset class="booking-filters"><input><button>Search</button></fieldset>
        </form>
      </section>
      <section class="booking-detail-page admin-booking-detail-page">
        <section class="booking-detail">
          <section class="admin-booking-detail-page__customer"><dl><dd>Long value</dd></dl></section>
          <section class="admin-booking-detail-page__actions"><div class="admin-booking-detail-page__action-list"><button>Act</button></div></section>
        </section>
      </section>
    `;

    try {
      expect(getComputedStyle(document.querySelector(".admin-services-page")).display).toBe("grid");
      expect(getComputedStyle(document.querySelector(".admin-services-filters")).display).toBe("grid");
      expect(getComputedStyle(document.querySelector(".admin-services-filters input")).width).toBe("100%");
      expect(getComputedStyle(document.querySelector(".service-list")).display).toBe("grid");
      expect(getComputedStyle(document.querySelector(".service-card")).minWidth).toBe("0px");
      expect(getComputedStyle(document.querySelector(".admin-schedule-page")).minWidth).toBe("0px");
      expect(getComputedStyle(document.querySelector(".schedule-weekday-grid")).display).toBe("grid");
      expect(getComputedStyle(document.querySelector(".schedule-override-list > fieldset")).minWidth)
        .toBe("0px");
      expect(getComputedStyle(document.querySelector(".bookings-page .booking-filters input")).width)
        .toBe("100%");
      expect(getComputedStyle(document.querySelector(".admin-booking-detail-page__customer")).minWidth)
        .toBe("0px");
      expect(getComputedStyle(document.querySelector(".admin-booking-detail-page__action-list")).display)
        .toBe("flex");
    } finally {
      document.body.replaceChildren();
      style.remove();
    }
  });

  it("ships narrow-screen single-column and full-width action rules for every admin page", async () => {
    const style = document.createElement("style");
    style.textContent = await readFile("src/styles/index.css", "utf8");
    document.head.append(style);

    try {
      const narrowRules = Array.from(style.sheet.cssRules)
        .filter((rule) => rule.conditionText?.includes("max-width: 45rem"))
        .flatMap((rule) => Array.from(rule.cssRules));
      const ruleFor = (selector) => narrowRules.find((rule) => (
        rule.selectorText?.split(",").map((value) => value.trim()).includes(selector)
      ));

      for (const selector of [
        ".admin-services-filters",
        ".admin-services-form",
        ".service-list",
        ".admin-schedule-page .schedule-weekday-grid",
        ".admin-schedule-page .schedule-override-list",
      ]) {
        expect(ruleFor(selector)?.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
      }

      for (const selector of [
        ".admin-services-page button",
        ".admin-schedule-page button",
        ".bookings-page .booking-filters button",
        ".admin-booking-detail-page__action-list button",
      ]) {
        expect(ruleFor(selector)?.style.width).toBe("100%");
      }
    } finally {
      style.remove();
    }
  });
});

describe("dashboard insight layouts", () => {
  it("ships bounded dashboard grids and safe wrapping for dashboard cards and workload items", async () => {
    const style = document.createElement("style");
    style.textContent = await readFile("src/styles/index.css", "utf8");
    document.head.append(style);

    try {
      const rules = Array.from(style.sheet.cssRules);
      const rulesFor = (selector) => rules.filter((rule) => (
        rule.selectorText?.split(",").map((value) => value.trim()).includes(selector)
      ));
      const ruleFor = (selector) => rulesFor(selector).at(-1);

      expect(ruleFor(".dashboard-page")?.style.width).toBe("min(100%, 70rem)");
      expect(
        ruleFor('.dashboard-page [aria-label="Booking summary"]')?.style.gridTemplateColumns,
      ).toBe("repeat(3, minmax(0, 1fr))");
      expect(
        ruleFor('.dashboard-page [aria-label="Administrator booking summary"]')?.style.gridTemplateColumns,
      ).toBe("repeat(2, minmax(0, 1fr))");
      expect(
        ruleFor(".dashboard-page > div > section:nth-of-type(2) > ol")?.style.gridTemplateColumns,
      ).toBe("repeat(2, minmax(0, 1fr))");
      expect(rulesFor('.dashboard-page [aria-label="Booking summary"] > article').some((rule) => (
        rule.style.minWidth === "0px"
      ))).toBe(true);
      expect(rulesFor(".dashboard-page > div > section li").some((rule) => (
        rule.style.minWidth === "0px" && rule.style.overflowWrap === "anywhere"
      ))).toBe(true);
    } finally {
      style.remove();
    }
  });

  it("ships narrow-screen one-column dashboard grids and full-width dashboard actions", async () => {
    const style = document.createElement("style");
    style.textContent = await readFile("src/styles/index.css", "utf8");
    document.head.append(style);

    try {
      const narrowRules = Array.from(style.sheet.cssRules)
        .filter((rule) => rule.conditionText?.includes("max-width: 45rem"))
        .flatMap((rule) => Array.from(rule.cssRules));
      const ruleFor = (selector) => narrowRules.find((rule) => (
        rule.selectorText?.split(",").map((value) => value.trim()).includes(selector)
      ));

      for (const selector of [
        '.dashboard-page [aria-label="Booking summary"]',
        '.dashboard-page [aria-label="Administrator booking summary"]',
        ".dashboard-page > div > section:nth-of-type(2) > ol",
        ".dashboard-page .action-links",
      ]) {
        expect(ruleFor(selector)?.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
      }

      for (const selector of [
        ".dashboard-page > div > section a",
        ".dashboard-page > button",
      ]) {
        expect(ruleFor(selector)?.style.width).toBe("100%");
      }
    } finally {
      style.remove();
    }
  });

  it("preserves dashboard card, status, and progress boundaries in forced colors", async () => {
    const style = document.createElement("style");
    style.textContent = await readFile("src/styles/index.css", "utf8");
    document.head.append(style);

    try {
      const forcedColorRules = Array.from(style.sheet.cssRules)
        .filter((rule) => rule.conditionText?.includes("forced-colors: active"))
        .flatMap((rule) => Array.from(rule.cssRules));
      const ruleFor = (selector) => forcedColorRules.find((rule) => (
        rule.selectorText?.split(",").map((value) => value.trim()).includes(selector)
      ));

      expect(ruleFor(".dashboard-page > div > section")?.style.borderStyle).toBe("solid");
      expect(ruleFor(".dashboard-page .booking-status")?.style.borderStyle).toBe("solid");
      expect(ruleFor(".dashboard-page progress")?.style.borderStyle).toBe("solid");
      expect(ruleFor(".dashboard-page progress")?.style.width).toBe("100%");
    } finally {
      style.remove();
    }
  });
});
