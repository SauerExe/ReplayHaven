import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Download,
  Folder,
  HardDrive,
  Monitor,
  Server,
  Upload,
  RefreshCw,
  BookOpen,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { useActions } from '../components/Actions';
import { useIsAdmin } from '../components/AuthGate';
import { useVault } from '../data/store';
import { PageHeading } from '../components/PageHeading';
import { VaultConnection } from '../components/VaultConnection';
import { DeviceAccess } from '../components/DeviceAccess';
import { locale, t, tp } from '../i18n';

export default function Devices() {
  const action = useActions();
  const { server, refreshServer } = useVault();
  // Uploading needs an admin account; plain accounts only watch.
  const admin = useIsAdmin();
  return (
    <div className="page devices-page">
      <PageHeading
        eyebrow={t('pages.devices.eyebrow')}
        title={t('pages.devices.title')}
        description={t('pages.devices.description')}
      >
        <button className="button secondary" onClick={() => void refreshServer()}>
          <RefreshCw size={16} />
          {t('pages.devices.refresh')}
        </button>
      </PageHeading>
      <DeviceAccess />
      <div className="device-intro">
        <div className="device-intro-copy">
          <span className="surface-kicker">
            <ShieldCheck size={15} /> {t('pages.devices.kicker')}
          </span>
          <h2>
            {t('pages.devices.heroTitle')}
            <br />
            <span className="gradient-text">{t('pages.devices.heroAccent')}</span>
          </h2>
          <p>{t('pages.devices.heroText')}</p>
          <div className="device-downloads">
            {server.connected && server.clientDownloadAvailable ? (
              <a className="button primary" href="/api/downloads/windows" download>
                <Download size={17} />
                {t('pages.devices.download')}
              </a>
            ) : (
              <div className="notice">
                <p>
                  {server.connected
                    ? t('pages.devices.noInstaller')
                    : t('pages.devices.connectFirst')}
                </p>
              </div>
            )}
            <Link
              className={
                server.connected && server.clientDownloadAvailable ? 'text-link' : 'button primary'
              }
              to="/setup"
            >
              <BookOpen size={16} />
              {t('pages.devices.toSetup')}
              <ArrowRight size={15} />
            </Link>
            {admin && (
              <button className="button secondary" onClick={() => action({ kind: 'upload' })}>
                <Upload size={17} />
                {t('pages.devices.upload')}
              </button>
            )}
          </div>
          <p className="small-text muted">{t('pages.devices.platformNote')}</p>
        </div>
        <VaultConnection />
      </div>
      <section className="device-flow">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t('pages.devices.flow.eyebrow')}</span>
            <h2>{t('pages.devices.flow.title')}</h2>
          </div>
          <Link className="text-link" to="/setup">
            {t('pages.devices.flow.guide')}
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="steps">
          <Link to="/setup#server">
            <span>01</span>
            <Server size={23} />
            <h3>{t('pages.devices.flow.serverTitle')}</h3>
            <p>{t('pages.devices.flow.serverText')}</p>
            <span className="step-link">
              {t('pages.devices.flow.serverLink')}
              <ChevronRight size={15} />
            </span>
          </Link>
          <Link to="/setup#client">
            <span>02</span>
            <Monitor size={23} />
            <h3>{t('pages.devices.flow.clientTitle')}</h3>
            <p>{t('pages.devices.flow.clientText')}</p>
            <span className="step-link">
              {t('pages.devices.flow.clientLink')}
              <ChevronRight size={15} />
            </span>
          </Link>
          <Link to="/setup#first-clip">
            <span>03</span>
            <Folder size={23} />
            <h3>{t('pages.devices.flow.firstClipTitle')}</h3>
            <p>{t('pages.devices.flow.firstClipText')}</p>
            <span className="step-link">
              {t('pages.devices.flow.firstClipLink')}
              <ChevronRight size={15} />
            </span>
          </Link>
        </div>
      </section>
      <section className="device-example">
        <div className="section-heading">
          <h2>{t('pages.devices.list.title')}</h2>
          <span className={`connection-status${server.connected ? ' online' : ''}`}>
            <span />
            {server.connected
              ? t('pages.devices.list.serverOnline')
              : t('pages.devices.list.serverOffline')}
          </span>
        </div>
        {server.devices.length ? (
          server.devices.map((device) => {
            const online = Date.now() - Date.parse(device.lastSeen) < 90000;
            return (
              <div className="device-card" key={device.id}>
                <div className="device-card-heading">
                  <span className="device-icon">
                    <Monitor size={29} />
                  </span>
                  <div>
                    <h3>{device.name}</h3>
                    <p>
                      {t('pages.devices.lastSeen', {
                        date: new Date(device.lastSeen).toLocaleString(locale()),
                      })}
                    </p>
                  </div>
                  <span className={`connection-status${online && !device.paused ? ' online' : ''}`}>
                    <span />
                    {online
                      ? device.paused
                        ? t('pages.devices.paused')
                        : t('pages.devices.online')
                      : t('pages.devices.offline')}
                  </span>
                </div>
                <div className="folder-list">
                  <div>
                    <Folder size={18} />
                    <code>{device.folder}</code>
                  </div>
                  <div>
                    {tp('pages.devices.uploads', device.uploaded)} ·{' '}
                    {device.analysisLocation === 'client'
                      ? t('pages.devices.analysisClient')
                      : t('pages.devices.analysisServer')}
                  </div>
                  {device.error && <p className="error small-text">{device.error}</p>}
                </div>
              </div>
            );
          })
        ) : (
          <div className="device-empty">
            <span className="device-empty-icon">
              <Monitor size={25} strokeWidth={1.5} />
            </span>
            <div>
              <h3>{t('pages.devices.empty.title')}</h3>
              <p>{t('pages.devices.empty.text')}</p>
            </div>
            <Link className="button secondary" to="/setup">
              {t('pages.devices.empty.connect')}
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
      <div className="device-card-footer">
        <HardDrive size={17} />
        <p>{t('pages.devices.footer')}</p>
      </div>
      <Link className="text-link" to="/settings#analysis">
        {t('pages.devices.settingsLink')} <ArrowRight size={15} />
      </Link>
    </div>
  );
}
