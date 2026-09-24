import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './links';

/**
 * Seitenweises Blättern in einer waagrechten Leiste. `edges` sagt, ob links oder rechts noch
 * etwas liegt; die Pfeile blenden sich danach ein. `count` meldet geänderte Inhalte.
 */
export function useScrollPager(count: number) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

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

  return { trackRef, edges, page };
}
