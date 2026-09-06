import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmAction } from "./ConfirmAction";

describe("ConfirmAction", () => {
  it("focuses the reason input when focus-on-open is requested", () => {
    render(
      <ConfirmAction
        open
        pending={false}
        focusOnOpen
        onConfirm={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByLabelText("Cancellation reason (optional)")).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("renders nothing while closed and resets stale state before reopening", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    const { container, rerender } = render(
      <ConfirmAction open pending={false} onConfirm={onConfirm} onDismiss={onDismiss} />,
    );

    const reason = screen.getByLabelText("Cancellation reason (optional)");
    fireEvent.change(reason, { target: { value: "x".repeat(301) } });
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Reason cannot exceed 300 characters");

    rerender(
      <ConfirmAction open={false} pending={false} onConfirm={onConfirm} onDismiss={onDismiss} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <ConfirmAction open pending={false} onConfirm={onConfirm} onDismiss={onDismiss} />,
    );
    expect(screen.getByLabelText("Cancellation reason (optional)")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is an inline native form that trims a valid optional reason once per submit", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAction open pending={false} onConfirm={onConfirm} onDismiss={() => {}} />,
    );

    expect(screen.getByRole("form", { name: "Cancel booking" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Cancellation reason (optional)"),
      "  Plans changed  ",
    );
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ reason: "Plans changed" });
  });

  it("submits an optional blank reason as an empty string", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAction open pending={false} onConfirm={onConfirm} onDismiss={() => {}} />,
    );

    await user.type(screen.getByLabelText("Cancellation reason (optional)"), "   ");
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ reason: "" });
  });

  it("requires a nonblank reason in required mode", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAction
        open
        pending={false}
        reasonRequired
        onConfirm={onConfirm}
        onDismiss={() => {}}
      />,
    );

    const reason = screen.getByLabelText("Cancellation reason (required)");
    await user.type(reason, "   ");
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Reason is required");
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAttribute("aria-describedby", "cancellation-reason-error");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("accepts 300 trimmed characters and rejects 301 with a linked exact error", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAction open pending={false} onConfirm={onConfirm} onDismiss={() => {}} />,
    );
    const reason = screen.getByLabelText("Cancellation reason (optional)");

    fireEvent.change(reason, { target: { value: `  ${"x".repeat(300)}  ` } });
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(onConfirm).toHaveBeenCalledWith({ reason: "x".repeat(300) });

    fireEvent.change(reason, { target: { value: `  ${"x".repeat(301)}  ` } });
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Reason cannot exceed 300 characters");
    expect(alert).toHaveAttribute("id", "cancellation-reason-error");
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAttribute("aria-describedby", "cancellation-reason-error");
  });

  it("disables both actions while pending and blocks forced duplicate submission", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ConfirmAction open pending onConfirm={onConfirm} onDismiss={onDismiss} />,
    );

    const submit = screen.getByRole("button", { name: "Cancelling…" });
    const dismiss = screen.getByRole("button", { name: "Keep booking" });
    expect(submit).toBeDisabled();
    expect(dismiss).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Cancel booking" }));
    fireEvent.click(dismiss);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses without submitting and clears local input and errors", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ConfirmAction open pending={false} onConfirm={onConfirm} onDismiss={onDismiss} />,
    );
    const reason = screen.getByLabelText("Cancellation reason (optional)");
    fireEvent.change(reason, { target: { value: "x".repeat(301) } });
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep booking" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(reason).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("supports explicit administrator labels while preserving shared reason validation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAction
        open
        pending={false}
        reasonRequired
        formLabel="Reject booking"
        prompt="Reject this booking?"
        reasonLabel="Rejection reason"
        confirmLabel="Confirm rejection"
        pendingLabel="Rejecting…"
        dismissLabel="Keep requested"
        onConfirm={onConfirm}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByRole("form", { name: "Reject booking" })).toBeInTheDocument();
    expect(screen.getByText("Reject this booking?")).toBeInTheDocument();
    const reason = screen.getByLabelText("Rejection reason (required)");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Reason is required");
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(reason, "  Duplicate request  ");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ reason: "Duplicate request" });
    expect(screen.getByRole("button", { name: "Keep requested" })).toBeEnabled();
  });

  it("supports a reason-free administrator control and focuses its primary action", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAction
        open
        pending={false}
        showReason={false}
        focusOnOpen
        formLabel="Confirm booking"
        prompt="Confirm this booking?"
        confirmLabel="Confirm booking"
        pendingLabel="Confirming…"
        dismissLabel="Keep requested"
        onConfirm={onConfirm}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByRole("form", { name: "Confirm booking" })).toBeInTheDocument();
    expect(screen.getByText("Confirm this booking?")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm booking" });
    expect(confirm).toHaveFocus();

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({});
  });

  it("uses explicit administrator pending and dismissal labels", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ConfirmAction
        open
        pending
        showReason={false}
        formLabel="Complete booking"
        prompt="Complete this booking?"
        confirmLabel="Confirm completion"
        pendingLabel="Completing…"
        dismissLabel="Keep in service"
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("button", { name: "Completing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep in service" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Complete booking" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
