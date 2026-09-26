import { useEffect, useState } from 'react';

/** Follow reading position without moving focus or rewriting browser history. */
export function useActiveSection(ids: readonly string[]) {
  const [current, setCurrent] = useState(ids[0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = ids
        .map((id) => document.getElementById(id))
        .filter((section): section is HTMLElement => Boolean(section));
      if (!sections.length) return;
      const offset = window.innerWidth <= 850 ? 210 : 165;
      const atEnd =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      const active = atEnd
        ? sections[sections.length - 1]
        : sections.filter((section) => section.getBoundingClientRect().top <= offset).pop() ||
          sections[0];
      setCurrent(active.id);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(document.getElementById('main') || document.body);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ids]);
  return current;
}
