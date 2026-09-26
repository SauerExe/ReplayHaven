import { useId } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useRowIds } from './layout';

/** Immediate on/off setting; the row label says what it does, the switch confirms it. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Only outside a settings row; inside, the row label names the switch. */
  label?: string;
}) {
  const row = useRowIds();
  return (
    <button
      type="button"
      role="switch"
      className="st-switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={label ? undefined : row?.labelId}
      aria-describedby={row?.descriptionId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="st-switch-thumb" />
    </button>
  );
}

/** A choice of up to six options, as radio buttons. */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const row = useRowIds();
  const name = useId();
  return (
    <div
      className="st-segmented"
      role="radiogroup"
      aria-labelledby={row?.labelId}
      aria-describedby={row?.descriptionId}
    >
      {options.map((option) => (
        <label className="st-segment" key={String(option.value)}>
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={String(option.value)}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

/** A native select in the settings style, labelled by its row. */
export function Select<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly { value: T; label: string; lang?: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const row = useRowIds();
  return (
    <span className="st-select">
      <select
        value={value}
        disabled={disabled}
        aria-labelledby={row?.labelId}
        aria-describedby={row?.descriptionId}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} lang={option.lang}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={15} aria-hidden="true" />
    </span>
  );
}

export type BadgeTone = 'ok' | 'warning' | 'error' | 'neutral' | 'info' | 'accent';

/** Read-only state. Always carries text; colour is never the only signal. */
export function StatusBadge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="st-badge" data-tone={tone}>
      {dot && <span className="st-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
