'use client';

// Small dependency-free SVG charts for the venue dashboard.
// Specs follow the house dataviz rules: one hue for one measure, 2px lines,
// <=24px bars with a 4px rounded data end, hairline solid grid, values at the
// tips, hover/keyboard tooltips, and a table twin for every chart.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { niceTicks } from './format';

// Colour tokens (light theme, matching the rest of the app). Slot 1 blue is the
// accent for every single-series chart; hover is the next darker blue step.
export const VD_TOKENS = {
  '--vd-surface': '#fcfcfb',
  '--vd-ink': '#0b0b0b',
  '--vd-ink-2': '#52514e',
  '--vd-grid': '#e1e0d9',
  '--vd-axis': '#c3c2b7',
  '--vd-border': 'rgba(11, 11, 11, 0.10)',
  '--vd-wash': 'rgba(11, 11, 11, 0.04)',
  '--vd-s1': '#2a78d6',
  '--vd-s1-hover': '#1c5cab',
} as CSSProperties;

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const tooltipStyle: CSSProperties = {
  background: 'var(--vd-surface)',
  border: '1px solid var(--vd-border)',
};

// ---------------------------------------------------------------------------
// Line chart (trend over time, single measure)
// ---------------------------------------------------------------------------

export type LinePoint = {
  label: string; // tooltip heading, e.g. "Sep 2026"
  axisLabel: string; // x axis, e.g. "Sep 26"
  value: number;
  detail?: string; // secondary tooltip line, e.g. "3 events"
};

export function LineChart({
  points,
  formatValue,
  formatAxis,
  ariaLabel,
}: {
  points: LinePoint[];
  formatValue: (n: number) => string;
  formatAxis: (n: number) => string;
  ariaLabel: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const height = 240;
  const m = { top: 22, right: 28, bottom: 32, left: 56 };
  const n = points.length;
  const plotW = Math.max(width - m.left - m.right, 10);
  const plotH = height - m.top - m.bottom;
  const ticks = niceTicks(Math.max(0, ...points.map((p) => p.value)));
  const yMax = ticks[ticks.length - 1];

  const x = (i: number) => (n <= 1 ? m.left + plotW / 2 : m.left + (i / (n - 1)) * plotW);
  const y = (v: number) => m.top + plotH - (v / yMax) * plotH;

  if (width === 0 || n === 0) {
    return <div ref={ref} style={{ height }} />;
  }

  const clamp = (i: number) => Math.min(Math.max(i, 0), n - 1);
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    setActive(n === 1 ? 0 : clamp(Math.round(((px - m.left) / plotW) * (n - 1))));
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') {
      setActive(null);
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    setActive((current) => clamp((current ?? (dir === 1 ? -1 : n)) + dir));
  };

  const maxLabels = Math.max(2, Math.floor(plotW / 56));
  const labelStep = Math.ceil(n / maxLabels);
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  const areaPath = `${linePath} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const last = points[n - 1];
  const lastY = y(last.value);
  const activePoint = active === null ? null : points[active];
  const tipX = active === null ? 0 : x(active);
  const tipOnLeft = tipX > width / 2;

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? n - 1)}
        onBlur={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.left}
              x2={m.left + plotW}
              y1={y(t)}
              y2={y(t)}
              strokeWidth={1}
              style={{ stroke: t === 0 ? 'var(--vd-axis)' : 'var(--vd-grid)' }}
            />
            <text
              x={m.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={11}
              style={{ fill: 'var(--vd-ink-2)' }}
            >
              {formatAxis(t)}
            </text>
          </g>
        ))}

        {points.map((p, i) =>
          i % labelStep === 0 ? (
            <text
              key={p.label}
              x={x(i)}
              y={height - 10}
              textAnchor="middle"
              fontSize={11}
              style={{ fill: 'var(--vd-ink-2)' }}
            >
              {p.axisLabel}
            </text>
          ) : null
        )}

        {n > 1 && (
          <>
            <path d={areaPath} style={{ fill: 'var(--vd-s1)', fillOpacity: 0.1 }} />
            <path
              d={linePath}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ stroke: 'var(--vd-s1)' }}
            />
          </>
        )}

        {active !== null && (
          <line
            x1={tipX}
            x2={tipX}
            y1={m.top}
            y2={y(0)}
            strokeWidth={1}
            style={{ stroke: 'var(--vd-axis)' }}
          />
        )}

        {/* End-dot with its direct label; the active dot follows the pointer. */}
        <circle
          cx={x(n - 1)}
          cy={lastY}
          r={4}
          strokeWidth={2}
          style={{ fill: 'var(--vd-s1)', stroke: 'var(--vd-surface)' }}
        />
        {active === null && (
          <text
            x={x(n - 1)}
            y={Math.max(lastY - 10, 11)}
            textAnchor="end"
            fontSize={12}
            fontWeight={600}
            style={{ fill: 'var(--vd-ink)' }}
          >
            {formatValue(last.value)}
          </text>
        )}
        {active !== null && (
          <circle
            cx={tipX}
            cy={y(points[active].value)}
            r={5}
            strokeWidth={2}
            style={{ fill: 'var(--vd-s1)', stroke: 'var(--vd-surface)' }}
          />
        )}
      </svg>

      {activePoint && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-xs shadow-md"
          style={{
            ...tooltipStyle,
            top: 6,
            ...(tipOnLeft ? { right: width - tipX + 12 } : { left: tipX + 12 }),
          }}
        >
          <div style={{ color: 'var(--vd-ink-2)' }}>{activePoint.label}</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-3 rounded"
              style={{ background: 'var(--vd-s1)' }}
            />
            <span className="text-sm font-semibold" style={{ color: 'var(--vd-ink)' }}>
              {formatValue(activePoint.value)}
            </span>
          </div>
          {activePoint.detail && (
            <div className="mt-0.5" style={{ color: 'var(--vd-ink-2)' }}>
              {activePoint.detail}
            </div>
          )}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {activePoint ? `${activePoint.label}: ${formatValue(activePoint.value)}` : ''}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar chart (magnitude by category)
// ---------------------------------------------------------------------------

export type BarRow = {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
  details: { label: string; value: string }[];
};

function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  // Square at the baseline (left), rounded data end (right).
  if (w <= r * 2) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`;
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(maxChars - 1, 1))}…`;
}

export function HBarChart({ rows, ariaLabel }: { rows: BarRow[]; ariaLabel: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ id: string; x: number; y: number } | null>(null);

  const rowH = 34;
  const barH = 18;
  const height = rows.length * rowH + 4;
  const labelW = Math.min(Math.max(width * 0.34, 96), 190);
  const valueW = 84;
  const barMax = Math.max(width - labelW - valueW - 8, 10);
  const max = Math.max(0, ...rows.map((r) => r.value));

  if (width === 0 || rows.length === 0) {
    return <div ref={ref} style={{ height: Math.max(height, 40) }} />;
  }

  const activeRow = active ? rows.find((r) => r.id === active.id) ?? null : null;
  const setFromPointer = (id: string, e: PointerEvent<SVGRectElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setActive({ id, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        className="block"
        onPointerLeave={() => setActive(null)}
      >
        <line
          x1={labelW}
          x2={labelW}
          y1={0}
          y2={height}
          strokeWidth={1}
          style={{ stroke: 'var(--vd-axis)' }}
        />
        {rows.map((row, i) => {
          const rowY = i * rowH + 2;
          const barY = rowY + (rowH - barH) / 2;
          const w = max > 0 ? Math.max((row.value / max) * barMax, row.value > 0 ? 2 : 0) : 0;
          const isActive = active?.id === row.id;
          return (
            <g key={row.id}>
              {isActive && (
                <rect x={0} y={rowY} width={width} height={rowH} style={{ fill: 'var(--vd-wash)' }} />
              )}
              <text
                x={labelW - 10}
                y={rowY + rowH / 2 + 4}
                textAnchor="end"
                fontSize={12}
                style={{ fill: 'var(--vd-ink)' }}
              >
                {truncate(row.label, Math.floor((labelW - 10) / 6.4))}
              </text>
              <path
                d={barPath(labelW, barY, w, barH)}
                style={{ fill: isActive ? 'var(--vd-s1-hover)' : 'var(--vd-s1)' }}
              />
              <text
                x={labelW + w + 8}
                y={rowY + rowH / 2 + 4}
                fontSize={12}
                fontWeight={600}
                style={{ fill: 'var(--vd-ink-2)' }}
              >
                {row.valueLabel}
              </text>
              <rect
                x={0}
                y={rowY}
                width={width}
                height={rowH}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${row.label}: ${row.valueLabel}`}
                className="outline-none focus-visible:stroke-blue-500"
                strokeWidth={2}
                onPointerEnter={(e) => setFromPointer(row.id, e)}
                onPointerMove={(e) => setFromPointer(row.id, e)}
                onFocus={() => setActive({ id: row.id, x: labelW + w, y: barY })}
                onBlur={() => setActive(null)}
              />
            </g>
          );
        })}
      </svg>

      {activeRow && active && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-xs shadow-md"
          style={{
            ...tooltipStyle,
            top: active.y + 12,
            left: Math.max(Math.min(active.x + 12, width - 210), 0),
            minWidth: 160,
          }}
        >
          <div className="text-sm font-semibold" style={{ color: 'var(--vd-ink)' }}>
            {activeRow.valueLabel}
          </div>
          <div style={{ color: 'var(--vd-ink-2)' }}>{activeRow.label}</div>
          {activeRow.details.map((d) => (
            <div key={d.label} className="mt-0.5 flex justify-between gap-4">
              <span style={{ color: 'var(--vd-ink-2)' }}>{d.label}</span>
              <span style={{ color: 'var(--vd-ink)' }}>{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card with a chart / table toggle (every chart has a table twin)
// ---------------------------------------------------------------------------

export function ChartCard({
  title,
  subtitle,
  chart,
  table,
}: {
  title: string;
  subtitle?: string;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section
      className="rounded-2xl p-5 sm:p-6"
      style={{ background: 'var(--vd-surface)', border: '1px solid var(--vd-border)' }}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--vd-ink)' }}>
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-sm" style={{ color: 'var(--vd-ink-2)' }}>
              {subtitle}
            </p>
          )}
        </div>
        <div
          className="inline-flex rounded-lg p-0.5 text-xs font-medium"
          style={{ background: 'var(--vd-wash)' }}
          role="group"
          aria-label={`${title} view`}
        >
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className="rounded-md px-3 py-1 capitalize transition-colors"
              style={
                view === v
                  ? { background: 'var(--vd-surface)', color: 'var(--vd-ink)', boxShadow: '0 0 0 1px var(--vd-border)' }
                  : { color: 'var(--vd-ink-2)' }
              }
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === 'chart' ? chart : <div className="max-h-72 overflow-auto">{table}</div>}
    </section>
  );
}

