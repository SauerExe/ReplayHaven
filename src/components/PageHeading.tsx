import type { ReactNode } from 'react';

export function PageHeading({
  eyebrow,
  title,
  description,
  count,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading gradient-heading">
      <div>
        <span className="eyebrow">
          <span className="heading-line" />
          {eyebrow}
        </span>
        <h1>
          {title}
          {count !== undefined && <span className="count-badge">{count}</span>}
        </h1>
        <p>{description}</p>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}
