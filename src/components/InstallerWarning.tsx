import { ShieldAlert } from 'lucide-react';
import { t } from '../i18n';

/**
 * The installer is not code-signed, so SmartScreen stops its first start. Shown next to every
 * download button, so nobody takes the warning for a broken or harmful file.
 */
export function InstallerWarning() {
  return (
    <details className="installer-warning">
      <summary>
        <ShieldAlert size={15} aria-hidden="true" />
        {t('installer.warning.summary')}
      </summary>
      <p>{t('installer.warning.text')}</p>
      <ol>
        <li>{t('installer.warning.step1')}</li>
        <li>{t('installer.warning.step2')}</li>
      </ol>
      <p>
        <a
          href="https://github.com/SauerExe/ReplayHaven/releases/latest"
          target="_blank"
          rel="noreferrer"
        >
          {t('installer.warning.proof')}
        </a>
      </p>
    </details>
  );
}
