import { useState } from 'react';
import { Film } from 'lucide-react';

export function Artwork({
  src,
  alt = '',
  className = '',
  eager = false,
  sizes,
}: {
  src: string;
  alt?: string;
  className?: string;
  eager?: boolean;
  sizes?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const responsive = src.startsWith('/media/') && src.endsWith('.webp');
  return src && failedSource !== src ? (
    <img
      className={className}
      src={src}
      srcSet={
        responsive
          ? `${src.replace('.webp', '-thumb.webp')} ${src.includes('cover') ? 400 : 600}w, ${src} ${src.includes('cover') ? 600 : 1600}w`
          : undefined
      }
      sizes={sizes || (eager ? '100vw' : '(max-width:600px) 76vw, (max-width:1100px) 34vw, 25vw')}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      onError={() => setFailedSource(src)}
    />
  ) : (
    <div className={`art-fallback ${className}`}>
      <Film size={32} />
      <span>Keine Vorschau</span>
    </div>
  );
}
