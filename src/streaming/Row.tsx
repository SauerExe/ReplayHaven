import { Children, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { linkHandler, prefersReducedMotion, type Navigate } from './links';

export function Row({
  title,
  kind,
  href,
  onNavigate,
  action,
  children,
}: {
  title: string;
  kind: 'clips' | 'games' | 'collections';
  href?: string;
  onNavigate?: Navigate;
  /** Ersetzt „Alle anzeigen“, etwa „Neue Sammlung“. */
  action?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  const titleId = useId();
  const trackRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const count = Children.count(children);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      setEdges({ start: track.scrollLeft > 4, end: track.scrollLeft < max - 4 });
    };
    update();
    track.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => {
      track.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [count]);

  function page(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    const gutter = parseFloat(getComputedStyle(track).paddingLeft) || 0;
    track.scrollBy({
      left: direction * Math.max(track.clientWidth - 2 * gutter, 160),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  return (
    <section className={`stream-row stream-row--${kind}`} aria-labelledby={titleId}>
      <div className="stream-row-head">
        <h2 id={titleId} className="stream-row-title">
          {title}
        </h2>
        {action ? (
          <button type="button" className="stream-row-link" onClick={action.onClick}>
            {action.label}
          </button>
        ) : (
          href && (
            <a className="stream-row-link" href={href} onClick={linkHandler(onNavigate, href)}>
              Alle anzeigen
              <ChevronRight size={16} strokeWidth={2.5} aria-hidden="true" />
            </a>
          )
        )}
      </div>
      <div className="stream-row-viewport">
        <ul className="stream-row-track" ref={trackRef}>
          {children}
        </ul>
        {/* Kacheln sind selbst per Tab erreichbar und scrollen dabei ins Bild; die Pfeile sind Mauskomfort. */}
        <button
          type="button"
          className="stream-row-arrow stream-row-arrow--prev"
          tabIndex={-1}
          aria-label={`${title}: zurück`}
          data-visible={edges.start}
          onClick={() => page(-1)}
        >
          <ChevronLeft size={30} strokeWidth={2.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="stream-row-arrow stream-row-arrow--next"
          tabIndex={-1}
          aria-label={`${title}: weiter`}
          data-visible={edges.end}
          onClick={() => page(1)}
        >
          <ChevronRight size={30} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
