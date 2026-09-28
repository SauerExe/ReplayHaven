import { useEffect, useState } from 'react';
import { Heart, X } from 'lucide-react';
import { t } from '../i18n';
import { useVault } from '../data/store';
import { useIsAdmin } from './AuthGate';
import {
  SUPPORT_URL,
  readSupport,
  snoozed,
  supportDue,
  writeSupport,
  type SupportState,
} from './support-banner';

const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * A small request to tip the developer, at most every four days (support-banner.ts). Only admins
 * of a connected server see it: they run the instance, family and friends on it are not asked.
 * REPLAYHAVEN_SUPPORT_BANNER=false on the server switches it off.
 */
export function SupportBanner() {
  const admin = useIsAdmin();
  const { server } = useVault();
  const [state, setState] = useState<SupportState | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const now = Date.now();
    let saved = readSupport(storage());
    if (!saved) {
      saved = { firstSeen: now };
      writeSupport(storage(), saved);
    }
    setState(saved);
    setVisible(supportDue(saved, now));
  }, []);
  if (!visible || !state || !admin || !server.connected || server.supportBanner === false)
    return null;
  const answer = (next: SupportState) => {
    writeSupport(storage(), next);
    setState(next);
    setVisible(false);
  };
  return (
    <aside className="support-banner" aria-label={t('app.support.label')}>
      <Heart size={18} aria-hidden="true" className="support-heart" />
      <p>
        <strong>{t('app.support.title')}</strong> {t('app.support.text')}
      </p>
      <div className="support-actions">
        <a
          className="button primary"
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => answer(snoozed(state, Date.now()))}
        >
          {t('app.support.tip')}
        </a>
        <button
          type="button"
          className="button secondary"
          onClick={() => answer({ ...state, donated: true })}
        >
          {t('app.support.donated')}
        </button>
      </div>
      <button
        type="button"
        className="icon-button support-close"
        aria-label={t('app.support.later')}
        title={t('app.support.later')}
        onClick={() => answer(snoozed(state, Date.now()))}
      >
        <X size={18} />
      </button>
    </aside>
  );
}
