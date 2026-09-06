import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectField } from "./SelectField";

const options = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
];

describe("SelectField", () => {
  it("associates its label and error description", () => {
    render(
      <SelectField
        id="fuelType"
        label="Fuel type"
        value="petrol"
        onChange={() => {}}
        options={options}
        error="Choose a fuel type"
      />,
    );

    const select = screen.getByLabelText("Fuel type");
    expect(select).toHaveAttribute("id", "fuelType");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAttribute("aria-describedby", "fuelType-error");
    expect(screen.getByText("Choose a fuel type")).toHaveAttribute("id", "fuelType-error");
  });

  it("does not expose error attributes without an error", () => {
    render(
      <SelectField
        id="fuelType"
        label="Fuel type"
        value="petrol"
        onChange={() => {}}
        options={options}
      />,
    );

    const select = screen.getByLabelText("Fuel type");
    expect(select).not.toHaveAttribute("aria-invalid");
    expect(select).not.toHaveAttribute("aria-describedby");
  });

  it("is keyboard focusable and forwards native key events", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    render(
      <SelectField
        id="fuelType"
        label="Fuel type"
        value="petrol"
        onChange={() => {}}
        onKeyDown={onKeyDown}
        options={options}
      />,
    );

    await user.tab();
    expect(screen.getByLabelText("Fuel type")).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onKeyDown.mock.calls.map(([event]) => event.key)).toEqual(
      expect.arrayContaining(["ArrowDown", "Enter"]),
    );
  });

  it("changes value through the native select interaction", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        id="fuelType"
        label="Fuel type"
        value="petrol"
        onChange={(event) => onChange(event.target.value)}
        options={options}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Fuel type"), "diesel");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("diesel");
  });
});