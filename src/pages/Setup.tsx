import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  KeyRound,
  LifeBuoy,
  Monitor,
  Server,
} from 'lucide-react';
import { useVault } from '../data/store';
import { InstallerWarning } from '../components/InstallerWarning';
import { useActiveSection } from '../components/useActiveSection';
import {
  ListRow,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  StatusBadge,
  useDevicesHref,
} from '../components/settings';
import { t, tx, type MessageKey } from '../i18n';

const guideSections = ['server', 'client', 'first-clip', 'help'] as const;
const steps: { id: (typeof guideSections)[number]; label: MessageKey }[] = [
  { id: 'server', label: 'pages.setup.nav.server' },
  { id: 'client', label: 'pages.setup.nav.client' },
  { id: 'first-clip', label: 'pages.setup.nav.firstClip' },
];

const sourceCommand = `git clone https://github.com/SauerExe/ReplayHaven.git
cd ReplayHaven
bash setup-server.sh`;
// install.sh from the latest release: checks Docker, writes .env and prints the setup link.
const dockerCommand =
  'curl -fsSL https://github.com/SauerExe/ReplayHaven/releases/latest/download/install.sh | bash';

/** A terminal command with a copy button; without clipboard access the text gets selected. */
function Command({ label, children }: { label: string; children: string }) {
  const { toast } = useVault();
  const [lastCopied, setLastCopied] = useState('');
  const copied = lastCopied === children;
  const lines = children.split('\n');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const code = useRef<HTMLElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="sg-command">
      <div className="sg-command-heading">
        <span>{label}</span>
        <button
          type="button"
          className="sg-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(children);
              setLastCopied(children);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setLastCopied(''), 2500);
            } catch {
              if (code.current) {
                const range = document.createRange();
                range.selectNodeContents(code.current);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
              }
              toast(t('pages.setup.copyFallback'));
            }
          }}
          aria-label={t('pages.setup.copyLabel', { label })}
          data-copied={copied || undefined}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span aria-live="polite">{copied ? t('pages.setup.copied') : t('pages.setup.copy')}</span>
        </button>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code ref={code}>
          {lines.map((line, index) => (
            <span
              className="sg-command-line"
              data-line={String(index + 1).padStart(2, '0')}
              key={index}
            >
              {line}
              {index < lines.length - 1 ? '\n' : ''}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

const env = <code>.env</code>;

/** FAQ entries; built on render so they follow the active language. */
function questions(): { key: string; title: string; answer: ReactNode }[] {
  const entry = (key: string, parts: Record<string, ReactNode> = {}) => ({
    key,
    title: t(`pages.setup.faq.${key}.title` as MessageKey),
    answer: tx(`pages.setup.faq.${key}.answer` as MessageKey, parts),
  });
  return [
    entry('unreachable', {
      ps: <code>docker compose ps</code>,
      logs: <code>docker compose logs --tail=80</code>,
    }),
    entry('origin', {
      origin: <code>REPLAYHAVEN_PUBLIC_ORIGIN</code>,
      env,
      up: <code>docker compose up -d</code>,
    }),
    entry('download', {
      release: <code>release/</code>,
      url: <code>REPLAYHAVEN_CLIENT_DOWNLOAD_URL</code>,
      env,
    }),
    entry('noAi'),
    entry('originals'),
  ];
}

/** One numbered step: a heading, then groups. */
function Step({
  id,
  number,
  title,
  description,
  children,
}: {
  id: string;
  number: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="sg-step" id={id} aria-labelledby={`${id}-title`}>
      <header className="sg-step-header">
        <span className="sg-step-number" aria-hidden="true">
          {String(number).padStart(2, '0')}
        </span>
        <div>
          <p className="sg-step-kicker">{t('pages.setup.stepOf', { step: number })}</p>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="st-groups">{children}</div>
    </section>
  );
}

/** The setup guide: server, Windows client, first clip, troubleshooting. */
export default function Setup() {
  const { server } = useVault();
  const devicesHref = useDevicesHref();
  const [method, setMethod] = useState<'docker' | 'source'>('docker');
  const current = useActiveSection(guideSections);
  const download = server.connected && server.clientDownloadAvailable;
  return (
    <div className="page st-info-page">
      <div className="st-shell">
        <aside className="st-sidebar sg-sidebar">
          <p className="st-sidebar-title">{t('pages.setup.title')}</p>
          <nav className="st-nav sg-nav" aria-label={t('pages.setup.nav.label')}>
            <div className="st-nav-group">
              <h2 className="st-nav-heading" id="sg-nav-steps">
                {t('pages.setup.nav.steps')}
              </h2>
              <ul aria-labelledby="sg-nav-steps">
                {steps.map((step, index) => (
                  <li key={step.id}>
                    <a
                      className="st-nav-link"
                      href={`#${step.id}`}
                      aria-current={current === step.id ? 'location' : undefined}
                    >
                      <span className="sg-nav-number">{String(index + 1).padStart(2, '0')}</span>{' '}
                      <span className="st-nav-text">{t(step.label)}</span>
                    </a>
                  </li>
                ))}
                <li className="sg-nav-help">
                  <a
                    className="st-nav-link"
                    href="#help"
                    aria-current={current === 'help' ? 'location' : undefined}
                  >
                    <span className="st-nav-icon" aria-hidden="true">
                      <LifeBuoy size={17} strokeWidth={1.8} />
                    </span>
                    <span className="st-nav-text">{t('pages.setup.nav.help')}</span>
                  </a>
                </li>
              </ul>
            </div>
          </nav>
          <div className="sg-status">
            <StatusBadge tone={server.connected ? 'ok' : 'neutral'} dot>
              {server.connected
                ? t('pages.setup.nav.connected')
                : t('pages.setup.nav.disconnected')}
            </StatusBadge>
          </div>
        </aside>
        <div className="st-content">
          <SettingsPage
            id="setup"
            title={t('pages.setup.title')}
            description={t('pages.setup.description')}
            actions={
              <Link className="button secondary" to={devicesHref}>
                <Monitor size={15} aria-hidden="true" />
                {t('pages.setup.devices')}
              </Link>
            }
          >
            <SettingsGroup title={t('pages.setup.requirements')}>
              <SettingsRow
                label={
                  <span className="sg-label">
                    <Server size={16} aria-hidden="true" />
                    {t('pages.setup.requirement.server')}
                  </span>
                }
                description={t('pages.setup.requirement.serverHint')}
              />
              <SettingsRow
                label={
                  <span className="sg-label">
                    <Monitor size={16} aria-hidden="true" />
                    {t('pages.setup.requirement.pc')}
                  </span>
                }
                description={t('pages.setup.requirement.pcHint')}
              />
              <SettingsRow
                label={
                  <span className="sg-label">
                    <HardDrive size={16} aria-hidden="true" />
                    {t('pages.setup.requirement.storage')}
                  </span>
                }
                description={t('pages.setup.requirement.storageHint')}
              />
            </SettingsGroup>

            <Step
              id="server"
              number={1}
              title={t('pages.setup.server.title')}
              description={t('pages.setup.server.text')}
            >
              <SettingsGroup
                title={t('pages.setup.server.installTitle')}
                description={
                  method === 'docker'
                    ? t('pages.setup.server.dockerInstruction')
                    : t('pages.setup.server.sourceInstruction')
                }
                action={
                  <div
                    className="st-segmented"
                    role="group"
                    aria-label={t('pages.setup.server.methods')}
                  >
                    <button
                      type="button"
                      className="sg-method"
                      aria-pressed={method === 'docker'}
                      onClick={() => setMethod('docker')}
                    >
                      {t('pages.setup.server.docker')}
                      <span className="sr-only"> ({t('pages.setup.server.recommended')})</span>
                    </button>
                    <button
                      type="button"
                      className="sg-method"
                      aria-pressed={method === 'source'}
                      onClick={() => setMethod('source')}
                    >
                      {t('pages.setup.server.source')}
                    </button>
                  </div>
                }
                footer={
                  <>
                    {t('pages.setup.server.next')}{' '}
                    <Link className="st-inline-link" to="/settings/server">
                      {t('pages.setup.server.toSettings')}
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </>
                }
              >
                <div className="sg-block">
                  <Command label={t('pages.setup.server.prepare')}>
                    {method === 'docker' ? dockerCommand : sourceCommand}
                  </Command>
                </div>
                {method === 'docker' ? (
                  <>
                    <SettingsRow
                      label={
                        <span className="sg-label">
                          <KeyRound size={16} aria-hidden="true" />
                          {t('pages.setup.server.configTitle')}
                        </span>
                      }
                      description={tx('pages.setup.server.configText', {
                        env,
                        token: <code>REPLAYHAVEN_ACCESS_TOKEN</code>,
                        origin: <code>REPLAYHAVEN_PUBLIC_ORIGIN</code>,
                      })}
                    />
                  </>
                ) : (
                  <SettingsRow
                    label={
                      <span className="sg-label">
                        <KeyRound size={16} aria-hidden="true" />
                        {t('pages.setup.server.keyTitle')}
                      </span>
                    }
                    description={t('pages.setup.server.keyText')}
                  />
                )}
              </SettingsGroup>
            </Step>

            <Step
              id="client"
              number={2}
              title={t('pages.setup.client.title')}
              description={t('pages.setup.client.text')}
            >
              <SettingsGroup>
                <SettingsRow
                  label={t('pages.setup.client.downloadTitle')}
                  description={
                    download
                      ? t('pages.setup.client.platform')
                      : t('pages.setup.client.downloadHint')
                  }
                >
                  {download ? (
                    <a href="/api/downloads/windows" download className="button secondary">
                      <Download size={15} aria-hidden="true" />
                      {t('pages.setup.client.download')}
                    </a>
                  ) : (
                    <Link to={devicesHref} className="button secondary">
                      {t('pages.setup.client.toDownload')}
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  )}
                </SettingsRow>
                {download && <InstallerWarning />}
              </SettingsGroup>
              <SettingsGroup
                title={t('pages.setup.client.inClient')}
                list
                footer={
                  <>
                    <strong className="sg-note-title">
                      {t('pages.setup.client.existingTitle')}
                    </strong>{' '}
                    {t('pages.setup.client.existingText')}
                  </>
                }
              >
                <ListRow
                  icon={<Monitor size={18} />}
                  title={t('pages.setup.client.installTitle')}
                  meta={t('pages.setup.client.installText')}
                />
                <ListRow
                  icon={<KeyRound size={18} />}
                  title={t('pages.setup.client.pairTitle')}
                  meta={t('pages.setup.client.pairText')}
                />
                <ListRow
                  icon={<FolderOpen size={18} />}
                  title={t('pages.setup.client.folderTitle')}
                  meta={t('pages.setup.client.folderText')}
                />
              </SettingsGroup>
            </Step>

            <Step
              id="first-clip"
              number={3}
              title={t('pages.setup.firstClip.title')}
              description={t('pages.setup.firstClip.text')}
            >
              <SettingsGroup
                title={t('pages.setup.firstClip.flow')}
                list
                footer={t('pages.setup.firstClip.caption')}
              >
                <ListRow
                  icon={<FolderOpen size={18} />}
                  title={t('pages.setup.firstClip.save')}
                  meta={t('pages.setup.firstClip.saveHint')}
                />
                <ListRow
                  icon={<Monitor size={18} />}
                  title={t('pages.setup.firstClip.process')}
                  meta={t('pages.setup.firstClip.processHint')}
                />
                <ListRow
                  icon={<Check size={18} />}
                  title={t('pages.setup.firstClip.view')}
                  meta={t('pages.setup.firstClip.viewHint')}
                />
              </SettingsGroup>
              <SettingsGroup>
                <SettingsRow
                  label={t('pages.setup.firstClip.done')}
                  description={t('pages.setup.firstClip.kept')}
                >
                  <Link className="button secondary" to="/library">
                    {t('pages.setup.firstClip.openLibrary')}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </SettingsRow>
              </SettingsGroup>
            </Step>

            <section className="sg-step" id="help" aria-labelledby="help-title">
              <header className="sg-step-header">
                <span className="sg-step-number" aria-hidden="true">
                  <LifeBuoy size={18} />
                </span>
                <div>
                  <h2 id="help-title">{t('pages.setup.help.title')}</h2>
                  <p>{t('pages.setup.help.text')}</p>
                </div>
              </header>
              <SettingsGroup
                footer={
                  <a
                    className="st-inline-link"
                    href="https://github.com/SauerExe/ReplayHaven/blob/main/docs/SERVER.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('pages.setup.help.docs')}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                }
              >
                {questions().map((question) => (
                  <details className="sg-faq" key={question.key}>
                    <summary>
                      <span>{question.title}</span>
                      <ChevronDown size={17} aria-hidden="true" />
                    </summary>
                    <p>{question.answer}</p>
                  </details>
                ))}
              </SettingsGroup>
            </section>
          </SettingsPage>
        </div>
      </div>
    </div>
  );
}
