import React from "react";
import type { DropdownProps } from "../../components/ui/Dropdown";

/** Domain SSR tests inspect every supplied option even while the real popup is
 * closed. Interaction, focus and popup rendering remain covered by UI/E2E tests.
 * This double forwards the domain's opaque values and constraints unchanged. */
export function StaticParameterDropdown(props: DropdownProps) {
  return React.createElement(React.Fragment, null,
    React.createElement("select", { id: props.id, "aria-label": props.label, value: props.value,
      disabled: props.disabled, required: props.required, "aria-invalid": props.ariaInvalid,
      title: props.title, "data-value": props.value,
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => props.onChange(event.currentTarget.value) },
    props.options.map((option, index) => React.createElement("option", { key: `${option.value}:${index}`,
      value: option.value, disabled: option.disabled, title: option.disabledReason },
    option.label))),
    // Preserve the details passed for each candidate separately from its label.
    React.createElement("div", { "data-dropdown-option-details": props.label },
    props.options.map((option, index) => option.detail == null ? null : React.createElement("span", {
      key: `${option.value}:${index}`, "data-option-value": option.value,
    }, option.label, " · ", option.detail))),
    props.description ? React.createElement("small", null, props.description) : null,
  );
}
