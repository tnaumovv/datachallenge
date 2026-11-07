import { useEffect, useId, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type ChartPoint = { count: number; average: number };
const scoreFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** Dotted area direction from the supplied ChartLine; Recharts owns layout and interaction. */
export function ChartLine({ data }: { data: ChartPoint[] }) {
  const id = 'score-dots-' + useId().replace(/:/g, '');
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media?.matches ?? false);
    media?.addEventListener('change', sync);
    return () => media?.removeEventListener('change', sync);
  }, []);
  const last = data.at(-1);
  if (!last)
    return <div className="score-chart-empty">График появится после завершения оценок.</div>;
  return (
    <figure
      className="score-chart"
      aria-label="Средний итоговый балл по мере добавления завершённых оценок"
    >
      <div className="score-chart-plot">
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          initialDimension={{ width: 500, height: 210 }}
        >
          <AreaChart
            data={data}
            margin={{ top: 12, right: 18, left: -24, bottom: 2 }}
            accessibilityLayer
          >
            <defs>
              <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
                <circle cx="1.5" cy="1.5" r="1" fill="var(--green)" fillOpacity=".36" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
            <XAxis
              dataKey="count"
              type="number"
              domain={[1, Math.max(2, last.count)]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              minTickGap={28}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
            />
            <Tooltip
              cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as ChartPoint | undefined;
                if (!active || !point) return null;
                return (
                  <div className="score-chart-tooltip">
                    <span>Завершённых оценок: {point.count}</span>
                    <strong>
                      {scoreFormat.format(point.average)} <small>/100</small>
                    </strong>
                    <span>Средний итоговый балл</span>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="average"
              name="Средний итоговый балл"
              stroke="var(--green)"
              strokeWidth={2.5}
              fill={`url(#${id})`}
              isAnimationActive={!reducedMotion}
              animationDuration={1100}
              animationEasing="ease-out"
              dot={
                data.length === 1
                  ? { r: 4, fill: 'var(--green)', stroke: 'var(--surface)', strokeWidth: 2 }
                  : false
              }
              activeDot={{ r: 5, fill: 'var(--green)', stroke: 'var(--surface)', strokeWidth: 3 }}
            />
            <ReferenceDot
              x={last.count}
              y={last.average}
              r={4}
              fill="var(--green)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        По мере добавления завершённых оценок · по горизонтали — их количество
      </figcaption>
      <details className="chart-data">
        <summary>Данные графика</summary>
        <div className="chart-data-scroll" tabIndex={0}>
          <table>
            <caption className="sr-only">Накопительный средний балл</caption>
            <thead>
              <tr>
                <th>Оценок</th>
                <th>Средний балл</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.count}>
                  <td>{point.count}</td>
                  <td>{scoreFormat.format(point.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
