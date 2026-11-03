import * as React from 'react';

export type LogoMarkProps = {
  readonly size?: number;
  readonly title?: string;
};

/**
 * Six-source ring: the six arc gaps stand for six content sources, the centre triangle for a
 * single broadcast outlet. The application tile is deliberately kept outside.
 *
 * Sizes below 32px use the optical compact geometry — same structure, heavier arcs and a larger
 * triangle — so the mark survives native tray and sidebar sizes instead of collapsing into a dot.
 * The switch is a rendering compensation, not a second logo.
 */
const BRAND = '#0B6FE0';

const FULL = {
  arcs:
    'M99.16 39.23A93.33 93.33 0 0 1 156.84 39.23M190.45 58.64A93.33 93.33 0 0 1 219.29 108.59M219.29 147.41A93.33 93.33 0 0 1 190.45 197.36M156.84 216.77A93.33 93.33 0 0 1 99.16 216.77M65.55 197.36A93.33 93.33 0 0 1 36.71 147.41M36.71 108.59A93.33 93.33 0 0 1 65.55 58.64',
  tri: 'M161.33 128L106.26 97.47L106.26 158.53Z',
  arcWidth: 16,
  triStroke: 18.67,
} as const;

const COMPACT = {
  arcs:
    'M96.99 42.8A90.67 90.67 0 0 1 159.01 42.8M186.28 58.55A90.67 90.67 0 0 1 217.29 112.26M217.29 143.74A90.67 90.67 0 0 1 186.28 197.45M159.01 213.2A90.67 90.67 0 0 1 96.99 213.2M69.72 197.45A90.67 90.67 0 0 1 38.71 143.74M38.71 112.26A90.67 90.67 0 0 1 69.72 58.55',
  tri: 'M162.67 128L101.47 94.08L101.47 161.92Z',
  arcWidth: 20,
  triStroke: 21.33,
} as const;

const COMPACT_BELOW = 32;

/** Cross-platform EpuberDSH mark. */
export function LogoMark({ size = 24, title }: LogoMarkProps) {
  const labelled = Boolean(title);
  const geom = size < COMPACT_BELOW ? COMPACT : FULL;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role={labelled ? 'img' : undefined}
      aria-label={title}
      aria-hidden={labelled ? undefined : true}
      focusable={false}
    >
      <path d={geom.arcs} fill="none" stroke={BRAND} strokeWidth={geom.arcWidth} strokeLinecap="round" />
      <path d={geom.tri} fill={BRAND} stroke={BRAND} strokeWidth={geom.triStroke} strokeLinejoin="round" />
    </svg>
  );
}
