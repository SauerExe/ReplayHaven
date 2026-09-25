import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  KeyRound,
  Monitor,
  Play,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { PageHeading } from '../components/PageHeading';
import { VaultConnection } from '../components/VaultConnection';
import { useVault } from '../data/store';
import { useActiveSection } from '../components/useActiveSection';
import { t, tx, type MessageKey } from '../i18n';

const guideSections = ['server', 'client', 'first-clip', 'help'] as const;

const sourceCommand = `git clone https://github.com/SauerExe/ReplayHaven.git
cd ReplayHaven
bash setup-server.sh`;
const dockerCommand = `mkdir -p replayhaven && cd replayhaven
curl -fsSLO https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/.env.example -o .env
nano .env`;

function Command({ label, children }: { label: string; children: string }) {
  const { toast } = useVault();
  const [lastCopied, setLastCopied] = useState('');
  const copied = lastCopied === children;
  const lines = children.split('\n');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const code = useRef<HTMLElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="setup-command">
      <div className="command-heading">
        <span>
          <span className="terminal-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {label}
        </span>
        <button
          type="button"
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
          className={copied ? 'is-copied' : undefined}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span aria-live="polite">{copied ? t('pages.setup.copied') : t('pages.setup.copy')}</span>
        </button>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code ref={code}>
          {lines.map((line, index) => (
            <span
              className="command-line"
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

export default function Setup() {
  const { server } = useVault();
  const [method, setMethod] = useState<'docker' | 'source'>('docker');
  const current = useActiveSection(guideSections);
  const currentStep = Math.min(
    guideSections.indexOf(current as (typeof guideSections)[number]) + 1,
    3,
  );
  return (
    <div className="page setup-page">
      <PageHeading
        eyebrow={t('pages.setup.eyebrow')}
        title={t('pages.setup.title')}
        description={t('pages.setup.description')}
      >
        <Link className="button secondary" to="/devices">
          <Monitor size={17} />
          {t('pages.setup.devices')}
        </Link>
      </PageHeading>
      <section className="setup-hero">
        <div className="setup-hero-copy">
          <span className="surface-kicker">
            <BookOpen size={15} /> {t('pages.setup.kicker')}
          </span>
          <h2>
            {t('pages.setup.heroTitle')}
            <br />
            <span className="gradient-text">{t('pages.setup.heroAccent')}</span>
          </h2>
          <p>{t('pages.setup.heroText')}</p>
          <a className="button primary" href="#server">
            {t('pages.setup.start')}
            <ArrowRight size={17} />
          </a>
          <span className="hero-footnote">
            <ShieldCheck size={14} /> {t('pages.setup.heroFootnote')}
          </span>
        </div>
        <VaultConnection />
        <div className="setup-requirements">
          <span>
            <Server size={16} />
            <span>
              {t('pages.setup.requirement.server')}
              <small>{t('pages.setup.requirement.serverHint')}</small>
            </span>
          </span>
          <span>
            <Monitor size={16} />
            <span>
              {t('pages.setup.requirement.pc')}
              <small>{t('pages.setup.requirement.pcHint')}</small>
            </span>
          </span>
          <span>
            <HardDrive size={16} />
            <span>
              {t('pages.setup.requirement.storage')}
              <small>{t('pages.setup.requirement.storageHint')}</small>
            </span>
          </span>
        </div>
      </section>
      <div className="setup-layout">
        <nav className="setup-nav" aria-label={t('pages.setup.nav.label')}>
          <div className="guide-position">
            <span>
              {current === 'help'
                ? t('pages.setup.nav.helpPosition')
                : t('pages.setup.nav.pathPosition')}
            </span>
            <strong>
              {String(currentStep).padStart(2, '0')}
              <span> / 03</span>
            </strong>
            <div aria-hidden="true">
              <span style={{ width: `${(currentStep / 3) * 100}%` }} />
            </div>
          </div>
          <a href="#server" aria-current={current === 'server' ? 'location' : undefined}>
            <span>01</span>
            <div>
              {t('pages.setup.nav.server')}
              <small>{t('pages.setup.nav.serverHint')}</small>
            </div>
            <ArrowRight size={14} />
          </a>
          <a href="#client" aria-current={current === 'client' ? 'location' : undefined}>
            <span>02</span>
            <div>
              {t('pages.setup.nav.client')}
              <small>{t('pages.setup.nav.clientHint')}</small>
            </div>
            <ArrowRight size={14} />
          </a>
          <a href="#first-clip" aria-current={current === 'first-clip' ? 'location' : undefined}>
            <span>03</span>
            <div>
              {t('pages.setup.nav.firstClip')}
              <small>{t('pages.setup.nav.firstClipHint')}</small>
            </div>
            <ArrowRight size={14} />
          </a>
          <a
            className="setup-help-link"
            href="#help"
            aria-current={current === 'help' ? 'location' : undefined}
          >
            <BookOpen size={16} />
            {t('pages.setup.nav.help')}
          </a>
          <div className={`setup-server-state${server.connected ? ' online' : ''}`}>
            <span className="server-status-dot" />
            <div>
              {server.connected
                ? t('pages.setup.nav.connected')
                : t('pages.setup.nav.disconnected')}
              <small>{t('pages.setup.nav.statusHint')}</small>
            </div>
          </div>
        </nav>
        <div className="setup-sections">
          <section className="guide-section" id="server" aria-labelledby="server-title">
            <header className="guide-section-heading">
              <span className="guide-number">01</span>
              <div>
                <span className="eyebrow">{t('pages.setup.server.eyebrow')}</span>
                <h2 id="server-title">{t('pages.setup.server.title')}</h2>
              </div>
              <Server size={24} strokeWidth={1.4} />
            </header>
            <p>{t('pages.setup.server.text')}</p>
            <div
              className="setup-methods"
              role="group"
              aria-label={t('pages.setup.server.methods')}
            >
              <button
                type="button"
                aria-pressed={method === 'docker'}
                onClick={() => setMethod('docker')}
              >
                {t('pages.setup.server.docker')}
                <span>{t('pages.setup.server.recommended')}</span>
              </button>
              <button
                type="button"
                aria-pressed={method === 'source'}
                onClick={() => setMethod('source')}
              >
                {t('pages.setup.server.source')}
              </button>
            </div>
            <p className="guide-instruction">
              {method === 'docker'
                ? t('pages.setup.server.dockerInstruction')
                : t('pages.setup.server.sourceInstruction')}
            </p>
            <Command label={t('pages.setup.server.prepare')}>
              {method === 'docker' ? dockerCommand : sourceCommand}
            </Command>
            {method === 'docker' ? (
              <>
                <div className="guide-callout">
                  <KeyRound size={19} />
                  <div>
                    <h3>{t('pages.setup.server.configTitle')}</h3>
                    <p>
                      {tx('pages.setup.server.configText', {
                        env,
                        token: <code>REPLAYHAVEN_ACCESS_TOKEN</code>,
                        origin: <code>REPLAYHAVEN_PUBLIC_ORIGIN</code>,
                        openssl: <code>openssl rand -hex 24</code>,
                      })}
                    </p>
                  </div>
                </div>
                <Command label={t('pages.setup.server.startCommand')}>docker compose up -d</Command>
              </>
            ) : (
              <div className="guide-callout">
                <KeyRound size={19} />
                <div>
                  <h3>{t('pages.setup.server.keyTitle')}</h3>
                  <p>{t('pages.setup.server.keyText')}</p>
                </div>
              </div>
            )}
            <div className="guide-next">
              <p>
                <Check size={16} />
                {t('pages.setup.server.next')}
              </p>
              <Link className="text-link" to="/settings#analysis">
                {t('pages.setup.server.toSettings')}
                <ArrowRight size={15} />
              </Link>
            </div>
          </section>
          <a className="guide-continue" href="#client">
            <span>{t('pages.setup.continue.step2')}</span>
            {t('pages.setup.continue.client')}
            <ArrowRight size={17} />
          </a>
          <section className="guide-section" id="client" aria-labelledby="client-title">
            <header className="guide-section-heading">
              <span className="guide-number">02</span>
              <div>
                <span className="eyebrow">{t('pages.setup.client.eyebrow')}</span>
                <h2 id="client-title">{t('pages.setup.client.title')}</h2>
              </div>
              <Monitor size={25} strokeWidth={1.4} />
            </header>
            <p>{t('pages.setup.client.text')}</p>
            <div className="client-download-card">
              <span className="download-symbol">
                <Download size={23} />
              </span>
              <div>
                <h3>{t('pages.setup.client.downloadTitle')}</h3>
                <p>{t('pages.setup.client.platform')}</p>
              </div>
              {server.connected && server.clientDownloadAvailable ? (
                <a href="/api/downloads/windows" download className="button primary">
                  <Download size={16} />
                  {t('pages.setup.client.download')}
                </a>
              ) : (
                <Link to="/devices" className="button secondary">
                  {t('pages.setup.client.toDownload')}
                  <ArrowRight size={16} />
                </Link>
              )}
            </div>
            {!(server.connected && server.clientDownloadAvailable) && (
              <p className="guide-caption">{t('pages.setup.client.downloadHint')}</p>
            )}
            <ol className="guide-checklist">
              <li>
                <span>
                  <Monitor size={17} />
                </span>
                <div>
                  <h3>{t('pages.setup.client.installTitle')}</h3>
                  <p>{t('pages.setup.client.installText')}</p>
                </div>
              </li>
              <li>
                <span>
                  <KeyRound size={17} />
                </span>
                <div>
                  <h3>{t('pages.setup.client.pairTitle')}</h3>
                  <p>{t('pages.setup.client.pairText')}</p>
                </div>
              </li>
              <li>
                <span>
                  <FolderOpen size={17} />
                </span>
                <div>
                  <h3>{t('pages.setup.client.folderTitle')}</h3>
                  <p>{t('pages.setup.client.folderText')}</p>
                </div>
              </li>
            </ol>
            <div className="guide-callout">
              <FolderOpen size={19} />
              <div>
                <h3>{t('pages.setup.client.existingTitle')}</h3>
                <p>{t('pages.setup.client.existingText')}</p>
              </div>
            </div>
          </section>
          <a className="guide-continue" href="#first-clip">
            <span>{t('pages.setup.continue.step3')}</span>
            {t('pages.setup.continue.firstClip')}
            <ArrowRight size={17} />
          </a>
          <section className="guide-section" id="first-clip" aria-labelledby="first-clip-title">
            <header className="guide-section-heading">
              <span className="guide-number">03</span>
              <div>
                <span className="eyebrow">{t('pages.setup.firstClip.eyebrow')}</span>
                <h2 id="first-clip-title">{t('pages.setup.firstClip.title')}</h2>
              </div>
              <Play size={23} strokeWidth={1.4} />
            </header>
            <p>{t('pages.setup.firstClip.text')}</p>
            <div className="first-clip-flow">
              <span>
                <FolderOpen size={21} />
                <strong>{t('pages.setup.firstClip.save')}</strong>
                <small>{t('pages.setup.firstClip.saveHint')}</small>
              </span>
              <ArrowRight size={17} />
              <span>
                <Monitor size={21} />
                <strong>{t('pages.setup.firstClip.process')}</strong>
                <small>{t('pages.setup.firstClip.processHint')}</small>
              </span>
              <ArrowRight size={17} />
              <span>
                <Check size={21} />
                <strong>{t('pages.setup.firstClip.view')}</strong>
                <small>{t('pages.setup.firstClip.viewHint')}</small>
              </span>
            </div>
            <p className="guide-caption">{t('pages.setup.firstClip.caption')}</p>
            <div className="guide-next">
              <p>
                <ShieldCheck size={16} />
                {t('pages.setup.firstClip.kept')}
              </p>
              <Link className="button primary" to="/library">
                {t('pages.setup.firstClip.openLibrary')}
                <ArrowRight size={16} />
              </Link>
            </div>
          </section>
          <section className="setup-faq" id="help" aria-labelledby="help-title">
            <span className="eyebrow">{t('pages.setup.help.eyebrow')}</span>
            <h2 id="help-title">{t('pages.setup.help.title')}</h2>
            {questions().map((question) => (
              <details key={question.key}>
                <summary>
                  {question.title}
                  <ChevronDown size={17} />
                </summary>
                <p>{question.answer}</p>
              </details>
            ))}
            <a
              className="text-link"
              href="https://github.com/SauerExe/ReplayHaven/blob/main/docs/SERVER.md"
              target="_blank"
              rel="noreferrer"
            >
              {t('pages.setup.help.docs')}
              <ExternalLink size={14} />
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
