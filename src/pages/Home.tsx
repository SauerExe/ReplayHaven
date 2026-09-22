import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, FolderPlus, Play, Sparkles, Upload } from 'lucide-react';
import { useVault } from '../data/store';
import { games } from '../data/seed';
import { canContinue, filterClips, relativeDate, time } from '../data/repository';
import { Artwork, ClipCard, CollectionCard, EmptyState, Section } from '../components/Cards';
import { useActions } from '../components/Actions';
export default function Home() {
  const { state } = useVault();
  const action = useActions();
  const recent = filterClips(state.clips, {});
  const featured =
    recent.find((c) => c.server && c.status === 'ready') ||
    state.clips.find((c) => c.id === 'elden-1') ||
    recent[0];
  const game = games.find((g) => g.id === featured?.gameId);
  const continuing = recent.filter((c) => {
    const p = state.progress[c.id];
    return p && canContinue(p.seconds, p.duration);
  });
  if (!featured)
    return (
      <div className="page">
        <EmptyState
          title="Dein Vault wartet auf dich."
          description="Füge deinen ersten Clip hinzu und behalte deine besten Momente."
        >
          <button className="button primary" onClick={() => action({ kind: 'upload' })}>
            <Upload size={18} />
            Clip hinzufügen
          </button>
        </EmptyState>
      </div>
    );
  return (
    <>
      <section className="hero">
        <Artwork src={featured.thumbnail} className="hero-art" eager />
        <div className="hero-vignette" />
        <div className="hero-content">
          <div className="hero-kicker">
            <span className="highlight-line" />
            <Sparkles size={14} /> IM RAMPENLICHT
          </div>
          <div className="hero-game">{featured.gameName || game?.name || 'DEIN HIGHLIGHT'}</div>
          <h1>{featured.title}</h1>
          <div className="hero-meta">
            <span>{relativeDate(featured.recordedAt)}</span>
            <span className="meta-dot">·</span>
            <span>{time(featured.duration)}</span>
            <span className="resolution">{featured.resolution}</span>
            <span className="hero-tag">Highlight</span>
          </div>
          <p className="hero-description">
            {featured.description ||
              featured.analysis?.result?.description ||
              'Manche Momente sind zu gut, um sie nur einmal zu erleben.'}
          </p>
          <div className="hero-actions">
            <Link className="button primary large" to={`/clips/${featured.id}`}>
              <Play size={19} fill="currentColor" />
              Abspielen
            </Link>
            <button
              className="button hero-secondary large"
              onClick={() => action({ kind: 'add', ids: [featured.id] })}
            >
              <FolderPlus size={19} />
              Zur Sammlung
            </button>
          </div>
        </div>
        <Link className="hero-details" to={`/clips/${featured.id}`}>
          Den Moment nochmal erleben <ChevronRight size={17} />
        </Link>
        <div className="hero-number">
          <span>01</span>
          <span className="hero-number-line" />
          DEIN HIGHLIGHT
        </div>
      </section>
      <div className="home-content">
        <div className="welcome-line">
          <p>
            Dein Archiv. <span>Deine besten Momente.</span>
          </p>
          <span className="vault-count">
            <span className="tiny-dot" />
            {state.clips.length} Clips sicher im Blick
          </span>
        </div>
        <Section title="Zuletzt hinzugefügt" link="/library">
          {recent.slice(0, 8).map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </Section>
        {continuing.length > 0 && (
          <Section title="Weiterschauen" subtitle="Genau da weitermachen, wo du aufgehört hast.">
            {continuing.map((c) => (
              <ClipCard key={c.id} clip={c} />
            ))}
          </Section>
        )}
        <Section title="Deine Spiele" link="/library" scroll={false}>
          <div className="game-grid">
            {[...new Set(recent.filter((c) => c.server && c.gameName).map((c) => c.gameName!))].map(
              (name) => {
                const recordings = recent.filter((c) => c.server && c.gameName === name);
                return (
                  <Link
                    className="game-card"
                    key={`recording:${name}`}
                    to={`/library?game=${encodeURIComponent(`name:${name}`)}`}
                  >
                    <Artwork src={recordings.find((c) => c.thumbnail)?.thumbnail || ''} />
                    <div className="game-card-shade" />
                    <div className="game-card-bottom">
                      <div>
                        <h3>{name}</h3>
                        <p>{recordings.length} Aufnahmen</p>
                      </div>
                      <span className="game-arrow">
                        <ArrowRight size={17} />
                      </span>
                    </div>
                  </Link>
                );
              },
            )}
            {games.map((g) => (
              <Link className="game-card" key={g.id} to={`/library?game=${g.id}`}>
                <Artwork src={g.cover} />
                <div className="game-card-shade" />
                <div className="game-card-bottom">
                  <div>
                    <h3>{g.name}</h3>
                    <p>{state.clips.filter((c) => c.gameId === g.id).length} Clips</p>
                  </div>
                  <span className="game-arrow">
                    <ArrowRight size={17} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Section>
        {recent.some((c) => c.favorite) && (
          <Section
            title="Immer wieder gut"
            subtitle="Deine Favoriten. Bereit für eine Zugabe."
            link="/library?favorite=1"
          >
            {recent
              .filter((c) => c.favorite)
              .map((c) => (
                <ClipCard key={c.id} clip={c} />
              ))}
          </Section>
        )}
        <Section title="Deine Sammlungen" link="/collections" scroll={false}>
          <div className="collections-grid home-collections">
            {state.collections.slice(0, 4).map((c) => (
              <CollectionCard key={c.id} collection={c} />
            ))}
          </div>
        </Section>
        <div className="archive-note">
          <span className="archive-symbol">
            <FolderPlus size={24} />
          </span>
          <div>
            <h3>Der nächste gute Moment kommt bestimmt.</h3>
            <p>Bring deine Aufnahmen in deinen Vault.</p>
          </div>
          <button className="button secondary" onClick={() => action({ kind: 'upload' })}>
            <Upload size={17} />
            Clips hinzufügen
          </button>
        </div>
      </div>
    </>
  );
}
