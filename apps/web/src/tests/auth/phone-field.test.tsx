import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PhoneField } from "@/features/auth/phone-field";

describe("PhoneField", () => {
  it("renders with label and input", () => {
    const { container, getByText } = render(
      <PhoneField
        label="Phone number"
        value=""
        onChange={() => {}}
      />
    );

    expect(getByText("Phone number")).toBeTruthy();
    expect(container.querySelector("input")).toBeTruthy();
  });

  it("displays error message and applies invalid styles when error is passed", () => {
    const { getByRole, getByText } = render(
      <PhoneField
        label="Phone number"
        error="Enter a valid mobile number."
        value=""
        onChange={() => {}}
      />
    );

    expect(getByRole("alert")).toBeTruthy();
    expect(getByText("Enter a valid mobile number.")).toBeTruthy();
  });

  it("calls onChange with formatted E.164 value on typing digits", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PhoneField
        label="Phone number"
        value=""
        onChange={onChange}
      />
    );

    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "+92 300 2276502" } });

    expect(onChange).toHaveBeenCalledWith("+923002276502", expect.anything());
  });

  it("cleans accidental leading 0 after dial code 92", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PhoneField
        label="Phone number"
        value=""
        onChange={onChange}
      />
    );

    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "+92 0300 227650" } });

    expect(onChange).toHaveBeenCalledWith("+92300227650", expect.anything());
  });

  it("passes empty string when only dial code is left", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PhoneField
        label="Phone number"
        value="+923001234567"
        onChange={onChange}
      />
    );

    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "+92" } });

    expect(onChange).toHaveBeenCalledWith("", expect.anything());
  });
});
