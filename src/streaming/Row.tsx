import { Children, useId } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { linkHandler, type Navigate } from './links';
import { useScrollPager } from './useScrollPager';

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
  const { trackRef, edges, page } = useScrollPager(Children.count(children));

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
