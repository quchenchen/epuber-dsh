import * as React from 'react';
import { LogoMark } from 'workdsh-ui';

export function BrandName() {
  return <span data-testid="workdsh-brand">AI融媒中心</span>;
}

export function BrandMark() {
  return <LogoMark size={22} />;
}

export function DiagnosticsMark() {
  return <LogoMark size={18} />;
}
