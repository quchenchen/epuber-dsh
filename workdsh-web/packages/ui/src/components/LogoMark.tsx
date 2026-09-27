import * as React from 'react';
import {
  BRAND_COMPACT_BELOW,
  BRAND_COMPACT_CORE_NODES,
  BRAND_COMPACT_CORE_PATH,
  BRAND_COMPACT_CORE_STROKE,
  BRAND_CORE_NODES,
  BRAND_CORE_PATH,
  BRAND_CORE_STROKE,
  BRAND_GRADIENT,
  BRAND_GRADIENT_DEEP,
  BRAND_OUTER_NODES,
  BRAND_TILE_COLOR,
  BRAND_TILE_GLYPH_SCALE,
  BRAND_TILE_INSET_RATIO,
  BRAND_TILE_RX_RATIO,
  BRAND_VIEWBOX,
  type BrandCut,
  type BrandNode,
} from './brand-shape.js';

export type LogoMarkProps = {
  readonly size?: number;
  readonly title?: string;
  /**
   * 图形切分。默认 `auto`：按图形**有效像素**判定 —— 小于 `BRAND_COMPACT_BELOW` 用紧凑版。
   * 带底座时有效像素要扣掉内边距，因此底座版更早切换到紧凑 cut。
   */
  readonly cut?: 'auto' | BrandCut;
  /** `signal` 为原始信号渐变（深底/大尺寸）；`deep` 为同色相加深版（浅底小尺寸对比不足时）。 */
  readonly tone?: 'signal' | 'deep';
  /** 单色覆写。给了就整体单色（反白、墨色、印刷场景），不再使用渐变。 */
  readonly mono?: string;
  /** 是否加深色圆角底座（应用图标 / 头像 / 品牌块）。 */
  readonly tile?: boolean;
};

/**
 * 「AI融媒中心」主标：外层 6 节点代表多路媒资，内层 3 节点与折线构成汇聚内核，
 * 青绿 → 青蓝信号渐变贯穿全图。
 *
 * 几何来自 `brand-shape.ts`（由 scripts/build-brand-assets.mjs 生成），组件与 SVG 资产共用同一份图形。
 */
export function LogoMark({
  size = 22,
  title,
  cut = 'auto',
  tone = 'signal',
  mono,
  tile = false,
}: LogoMarkProps) {
  // 同一页面会渲染多个实例，渐变 id 必须唯一，否则后续实例会引用到第一个实例的定义。
  const rawId = React.useId();
  const gradientId = `aimc-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const inset = tile ? size * BRAND_TILE_INSET_RATIO : 0;
  const glyphPx = size - inset * 2;
  const resolved: BrandCut = cut === 'auto' ? (glyphPx < BRAND_COMPACT_BELOW ? 'compact' : 'full') : cut;

  const paint = mono ?? `url(#${gradientId})`;
  const gradient = mono ? null : tone === 'deep' ? BRAND_GRADIENT_DEEP : BRAND_GRADIENT;
  const labelled = Boolean(title);

  const nodes = resolved === 'compact' ? BRAND_COMPACT_CORE_NODES : BRAND_CORE_NODES;
  const path = resolved === 'compact' ? BRAND_COMPACT_CORE_PATH : BRAND_CORE_PATH;
  const stroke = resolved === 'compact' ? BRAND_COMPACT_CORE_STROKE : BRAND_CORE_STROKE;

  const glyph = (
    <>
      {resolved === 'full' && BRAND_OUTER_NODES.map((node, index) => <Node key={`o${index}`} node={node} fill={paint} />)}
      <path
        d={path}
        fill="none"
        stroke={paint}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {nodes.map((node, index) => <Node key={`c${index}`} node={node} fill={paint} />)}
    </>
  );

  const scale = tile ? BRAND_TILE_GLYPH_SCALE * size : 1;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BRAND_VIEWBOX} ${BRAND_VIEWBOX}`}
      role={labelled ? 'img' : undefined}
      aria-label={title}
      aria-hidden={labelled ? undefined : true}
      focusable={false}
    >
      {gradient ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2={BRAND_VIEWBOX} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={gradient.from} />
            <stop offset="1" stopColor={gradient.to} />
          </linearGradient>
        </defs>
      ) : null}
      {tile ? (
        <>
          <rect
            width={BRAND_VIEWBOX}
            height={BRAND_VIEWBOX}
            rx={BRAND_VIEWBOX * BRAND_TILE_RX_RATIO}
            fill={BRAND_TILE_COLOR}
          />
          <g transform={`translate(${BRAND_VIEWBOX * BRAND_TILE_INSET_RATIO} ${BRAND_VIEWBOX * BRAND_TILE_INSET_RATIO}) scale(${scale})`}>
            {glyph}
          </g>
        </>
      ) : (
        glyph
      )}
    </svg>
  );
}

function Node({ node, fill }: { readonly node: BrandNode; readonly fill: string }) {
  return <circle cx={node.cx} cy={node.cy} r={node.r} fill={fill} />;
}
