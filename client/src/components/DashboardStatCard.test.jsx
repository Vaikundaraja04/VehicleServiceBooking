import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardStatCard } from "./DashboardStatCard";

describe("DashboardStatCard", () => {
  it("renders a labelled statistic with its literal value and description", () => {
    render(
      <DashboardStatCard
        description="Appointments scheduled for the workshop today"
        label="Today's appointments"
        value={0}
      />,
    );

    const statistic = screen.getByRole("article", { name: "Today's appointments" });
    expect(statistic).toContainElement(
      screen.getByRole("heading", { name: "Today's appointments" }),
    );
    expect(statistic).toHaveTextContent("0");
    expect(statistic).toHaveTextContent("Appointments scheduled for the workshop today");
  });

  it("omits the optional description without losing its accessible label", () => {
    render(<DashboardStatCard label="Active vehicles" value={3} />);

    const statistic = screen.getByRole("article", { name: "Active vehicles" });
    expect(statistic).toHaveTextContent("3");
    expect(statistic.querySelectorAll("p")).toHaveLength(1);
  });
});
