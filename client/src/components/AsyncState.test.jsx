import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AsyncState } from "./AsyncState";

describe("AsyncState", () => {
  it("renders only the default polite loading message while loading", () => {
    render(
      <AsyncState status="loading" error="Private failure detail" onRetry={() => {}}>
        <p>Ready content</p>
      </AsyncState>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByText("Ready content")).not.toBeInTheDocument();
    expect(screen.queryByText("Private failure detail")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses a supplied loading message", () => {
    render(<AsyncState status="loading" loadingMessage="Loading bookings…" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading bookings…");
  });

  it("renders an alert and invokes an optional Retry control", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <AsyncState status="error" error="Network failed" onRetry={onRetry}>
        <p>Ready content</p>
      </AsyncState>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Network failed");
    expect(screen.queryByText("Ready content")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits Retry when no retry function is supplied", () => {
    render(<AsyncState status="error" error="Network failed" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Network failed");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders children for ready and other non-error states", () => {
    const { rerender } = render(
      <AsyncState status="ready"><p>Ready content</p></AsyncState>,
    );

    expect(screen.getByText("Ready content")).toBeInTheDocument();
    rerender(<AsyncState status="idle"><p>Idle content</p></AsyncState>);
    expect(screen.getByText("Idle content")).toBeInTheDocument();
  });
});
