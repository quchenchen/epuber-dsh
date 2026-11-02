import * as React from 'react';
import { LogoMark } from 'epuberdsh-ui';

export function BrandName() {
  return <span data-testid="workdsh-brand">AI融媒中心</span>;
}

export function BrandMark() {
  return <LogoMark size={22} />;
}

export function DiagnosticsMark() {
  return <LogoMark size={18} />;
}

/**
 * Hero mark: the conversation hero asks for a mark at a host-supplied size and
 * falls back to the official whale when nothing registers. Size is honoured so
 * the hero keeps its own optical scale; the incoming className is dropped on
 * purpose — it carries the fish hover hitbox styling.
 */
export function HeroMark({ size = 34 }: { size?: number }) {
  return <LogoMark size={size} />;
}
