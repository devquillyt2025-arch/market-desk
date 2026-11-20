"use client";

/** An on/off switch. The label is whatever `labelledBy` names, so a row of text and a switch read as one control. */
export default function Switch({
  checked,
  onChange,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelledBy: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      // min-h-0!/min-w-0!: on a touch screen every button is stretched to 44px (globals.css), which turned this into a blob. The pill keeps its
      // shape and the extra reach comes from the invisible before: box instead (a pseudo-element of a button is part of it for taps).
      className={`relative h-5 w-9 min-h-0! min-w-0! shrink-0 rounded-full transition-colors before:absolute before:-inset-x-1 before:-inset-y-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        checked ? "bg-accent-solid" : "bg-border"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
