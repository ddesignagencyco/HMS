"use client";

import Select from "react-select";

export type SelectOption = { value: string; label: string };

export function SelectField({
  id,
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  isDisabled = false,
  isClearable = false,
  className,
  size = "md",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  ariaLabel?: string;
  isDisabled?: boolean;
  isClearable?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const isSm = size === "sm";

  return (
    <Select
      inputId={id}
      instanceId={id}
      aria-label={ariaLabel}
      isDisabled={isDisabled}
      isClearable={isClearable}
      className={className}
      options={options}
      value={options.find((option) => option.value === value) ?? null}
      onChange={(option) => onChange(option ? (option as SelectOption).value : "")}
      placeholder={placeholder}
      isSearchable={false}
      unstyled={false}
      styles={{
        control: (base, state) => ({
          ...base,
          minHeight: isSm ? 38 : 42,
          height: isSm ? 38 : 42,
          width: "100%",
          borderRadius: 10,
          borderColor: state.isFocused ? "#94a3b8" : "#e2e8f0",
          backgroundColor: isDisabled ? "#f8fafc" : "#ffffff",
          boxShadow: "none",
          outline: "none",
          transition: "all 0.15s ease",
          "&:hover": {
            borderColor: state.isFocused ? "#94a3b8" : "#cbd5e1",
          },
        }),
        valueContainer: (base) => ({
          ...base,
          padding: isSm ? "0 10px" : "0 12px",
          fontSize: isSm ? 13 : 14,
          fontWeight: 500,
          color: "#0f172a",
        }),
        input: (base) => ({
          ...base,
          margin: 0,
          padding: 0,
          color: "#0f172a",
          outline: "none",
          boxShadow: "none",
        }),
        singleValue: (base) => ({
          ...base,
          color: "#0f172a",
          fontWeight: 500,
        }),
        placeholder: (base) => ({
          ...base,
          color: "#94a3b8",
          fontWeight: 400,
        }),
        indicatorSeparator: () => ({ display: "none" }),
        dropdownIndicator: (base, state) => ({
          ...base,
          padding: isSm ? 6 : 8,
          color: state.isFocused ? "#0f172a" : "#94a3b8",
          transition: "all 0.15s ease",
          "&:hover": { color: "#0f172a" },
        }),
        clearIndicator: (base) => ({
          ...base,
          padding: isSm ? 4 : 6,
          color: "#94a3b8",
          "&:hover": { color: "#ef4444" },
        }),
        menu: (base) => ({
          ...base,
          marginTop: 6,
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)",
          zIndex: 50,
          maxHeight: 280,
          overflow: "hidden",
        }),
        menuPortal: (base) => ({ ...base, zIndex: 60 }),
        menuList: (base) => ({
          ...base,
          padding: 4,
          maxHeight: 280,
        }),
        option: (base, state) => ({
          ...base,
          padding: isSm ? "8px 10px" : "9px 12px",
          borderRadius: 8,
          fontSize: isSm ? 13 : 14,
          fontWeight: state.isSelected ? 600 : 450,
          color: state.isSelected ? "#0f172a" : "#334155",
          backgroundColor: state.isSelected
            ? "#f1f5f9"
            : state.isFocused
              ? "#f8fafc"
              : "transparent",
          cursor: "pointer",
          transition: "background-color 0.1s ease",
          "&:active": {
            backgroundColor: "#e2e8f0",
          },
        }),
      }}
    />
  );
}
