import { useState } from 'react';
import { Film } from 'lucide-react';

const MEDIA = /^\/media\/([\w-]+)\.webp$/;

/** The sample images under /media also exist as -thumb; tiles do not need 1600 pixels. */
function srcSetFor(src: string) {
  const match = MEDIA.exec(src);
  if (!match || match[1].endsWith('-thumb')) return undefined;
  const cover = match[1].endsWith('-cover');
  return `/media/${match[1]}-thumb.webp ${cover ? 400 : 600}w, ${src} ${cover ? 600 : 1600}w`;
}

export function Picture({
  src,
  className,
  sizes,
  alt = '',
  eager = false,
}: {
  src: string;
  className: string;
  sizes: string;
  alt?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState('');
  if (!src || failed === src)
    return (
      <span
        className={`${className} stream-picture-fallback`}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
      >
        <Film size={28} strokeWidth={1.5} aria-hidden="true" />
      </span>
    );
  return (
    <img
      className={className}
      src={src}
      srcSet={srcSetFor(src)}
      sizes={sizes}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      decoding="async"
      draggable={false}
      onError={() => setFailed(src)}
    />
  );
}
