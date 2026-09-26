import { useCallback, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LoaderCircle, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { t } from '../../i18n';

/**
 * Which dialog of a section is open, and the element that opened it: focus returns there when the
 * dialog closes (also when it was opened from an overflow menu that is gone by then).
 */
export function useDialog<T>() {
  const [value, setValue] = useState<T | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((next: T, from?: HTMLElement | null) => {
    opener.current =
      from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setValue(next);
  }, []);
  const close = useCallback(() => setValue(null), []);
  const restoreFocus = useCallback(() => {
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  }, []);
  return { value, open, close, restoreFocus };
}

type DialogControl = { close: () => void; restoreFocus: () => void };

function Shell({
  control,
  title,
  description,
  icon: Icon,
  destructive,
  children,
}: {
  control: DialogControl;
  title: string;
  description?: ReactNode;
  icon: LucideIcon;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) control.close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`dialog action-dialog st-dialog${destructive ? ' destructive-dialog' : ''}`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            control.restoreFocus();
          }}
        >
          <div className="dialog-heading">
            <span className="dialog-symbol" aria-hidden="true">
              <Icon size={22} strokeWidth={1.6} />
            </span>
            <div>
              <Dialog.Title>{title}</Dialog.Title>
            </div>
            <Dialog.Close className="icon-button" aria-label={t('settings.dialog.close')}>
              <X size={20} />
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="dialog-description">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A form in a dialog: fields, then Cancel and one primary button. */
export function FormDialog({
  control,
  title,
  description,
  icon,
  submitLabel,
  onSubmit,
  children,
  disabled,
}: {
  control: DialogControl;
  title: string;
  description?: ReactNode;
  icon: LucideIcon;
  submitLabel: string;
  /** Resolves true when the dialog may close. */
  onSubmit: () => Promise<boolean>;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (await onSubmit()) control.close();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell control={control} title={title} description={description} icon={icon}>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset className="dialog-form-content st-dialog-fields" disabled={busy}>
          {children}
        </fieldset>
        <div className="dialog-footer">
          <button type="button" className="button secondary" onClick={control.close}>
            {t('common.cancel')}
          </button>
          <button className="button primary" disabled={busy || disabled}>
            {busy && <LoaderCircle className="saving-spinner" size={16} aria-hidden="true" />}
            {submitLabel}
          </button>
        </div>
      </form>
    </Shell>
  );
}

/** Confirms a destructive action; the confirm button names the action. */
export function ConfirmDialog({
  control,
  title,
  description,
  icon,
  confirmLabel,
  onConfirm,
}: {
  control: DialogControl;
  title: string;
  description: ReactNode;
  icon: LucideIcon;
  confirmLabel: string;
  /** Resolves true when the dialog may close. */
  onConfirm: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Shell control={control} title={title} description={description} icon={icon} destructive>
      <div className="dialog-footer">
        <button type="button" className="button secondary" onClick={control.close}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (await onConfirm()) control.close();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <LoaderCircle className="saving-spinner" size={16} aria-hidden="true" />}
          {confirmLabel}
        </button>
      </div>
    </Shell>
  );
}

/** A dialog that only shows something (the QR code) and closes with one button. */
export function InfoDialog({
  control,
  title,
  description,
  icon,
  children,
}: {
  control: DialogControl;
  title: string;
  description?: ReactNode;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Shell control={control} title={title} description={description} icon={icon}>
      {children}
      <div className="dialog-footer">
        <button type="button" className="button secondary" onClick={control.close}>
          {t('settings.dialog.done')}
        </button>
      </div>
    </Shell>
  );
}
