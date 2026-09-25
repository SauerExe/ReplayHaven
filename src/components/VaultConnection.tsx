import { ArrowRight, Monitor, Play, Server } from 'lucide-react';
import { t } from '../i18n';

export function VaultConnection() {
  return (
    <div className="vault-connection" role="img" aria-label={t('app.vault.label')}>
      <div className="connection-orbit orbit-outer" />
      <div className="connection-orbit orbit-inner" />
      <div className="connection-topline">
        <span /> {t('app.vault.topline')}
      </div>
      <div className="connection-map">
        <div className="connection-node pc-node">
          <Monitor size={34} strokeWidth={1.3} />
          <span>{t('app.vault.pc')}</span>
          <small>{t('app.vault.record')}</small>
        </div>
        <div className="connection-path">
          <ArrowRight size={16} />
        </div>
        <div className="connection-core">
          <Play size={24} fill="currentColor" />
        </div>
        <div className="connection-path">
          <ArrowRight size={16} />
        </div>
        <div className="connection-node vault-node">
          <Server size={34} strokeWidth={1.3} />
          <span>{t('app.vault.vault')}</span>
          <small>{t('app.vault.keep')}</small>
        </div>
      </div>
      <div className="connection-bottomline">
        {t('app.vault.recordings')}
        <span />
        {t('app.vault.server')}
      </div>
    </div>
  );
}
