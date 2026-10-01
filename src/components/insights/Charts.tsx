import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';

/**
 * Insights' charts, drawn with react-native-svg (no chart library, no new
 * native module). Colours come from the theme: the series palette is the
 * brand's own state colours, in a fixed order so a category keeps its colour.
 */

export const SERIES = [colors.markCore, colors.settledFill, colors.live, colors.focus, colors.markRing, colors.inkFaint];

export type BarDatum = { label: string; value: number; highlight?: boolean };

/** Vertical bars, one per day, with the value above any non-zero bar. */
export function BarChart({ data, width, height = 160 }: { data: BarDatum[]; width: number; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const labelH = 18;
  const topPad = 16;
  const plotH = height - labelH - topPad;
  const slot = width / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(28, slot * 0.6));
  // With a month of days, label every 5th so the axis stays readable.
  const every = data.length > 14 ? 5 : 1;

  return (
    <Svg width={width} height={height}>
      <Path d={`M0 ${topPad + plotH} H${width}`} stroke={colors.line} strokeWidth={1} />
      {data.map((d, i) => {
        const h = d.value === 0 ? 2 : Math.max(4, (d.value / max) * plotH);
        const x = i * slot + (slot - barW) / 2;
        const y = topPad + plotH - h;
        return (
          <G key={`${d.label}-${i}`}>
            <Rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={Math.min(6, barW / 2)}
              fill={d.value === 0 ? colors.line : d.highlight ? colors.markCore : colors.settledFill}
            />
            {d.value > 0 && data.length <= 14 ? (
              <SvgText x={x + barW / 2} y={y - 4} fontSize={11} fill={colors.inkMuted} textAnchor="middle">
                {d.value}
              </SvgText>
            ) : null}
            {i % every === 0 || i === data.length - 1 ? (
              <SvgText x={x + barW / 2} y={height - 4} fontSize={11} fill={colors.inkMuted} textAnchor="middle">
                {d.label}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

export type Slice = { name: string; value: number };

function arc(cx: number, cy: number, r: number, start: number, end: number): string {
  const a = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(a(start));
  const y1 = cy + r * Math.sin(a(start));
  const x2 = cx + r * Math.cos(a(end));
  const y2 = cy + r * Math.sin(a(end));
  const large = end - start > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/** A donut with its total in the middle and a legend beside it. */
export function DonutChart({ slices, centreLabel }: { slices: Slice[]; centreLabel: string }) {
  const size = 132;
  const stroke = 20;
  const r = (size - stroke) / 2;
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let angle = 0;

  return (
    <View style={styles.donutRow}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.line} strokeWidth={stroke} fill="none" />
        {total > 0
          ? slices.map((s, i) => {
              const sweep = (s.value / total) * 360;
              const start = angle;
              angle += sweep;
              // A full circle can't be drawn as one arc: draw it as a circle.
              if (sweep >= 359.99) {
                return (
                  <Circle key={s.name} cx={size / 2} cy={size / 2} r={r} stroke={SERIES[i % SERIES.length]} strokeWidth={stroke} fill="none" />
                );
              }
              return (
                <Path
                  key={s.name}
                  d={arc(size / 2, size / 2, r, start, start + Math.max(0.5, sweep - 1.5))}
                  stroke={SERIES[i % SERIES.length]}
                  strokeWidth={stroke}
                  fill="none"
                />
              );
            })
          : null}
        <SvgText x={size / 2} y={size / 2 + 2} fontSize={22} fontFamily={fontFamily.displaySemiBold} fill={colors.ink} textAnchor="middle">
          {total}
        </SvgText>
        <SvgText x={size / 2} y={size / 2 + 20} fontSize={11} fill={colors.inkMuted} textAnchor="middle">
          {centreLabel}
        </SvgText>
      </Svg>
      <View style={styles.legend}>
        {slices.length === 0 ? <Text style={styles.legendText}>Nothing yet</Text> : null}
        {slices.map((s, i) => (
          <View key={s.name} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: SERIES[i % SERIES.length] }]} />
            <Text style={styles.legendText} numberOfLines={1}>
              {s.name}
            </Text>
            <Text style={styles.legendValue}>{total ? Math.round((s.value / total) * 100) : 0}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** One horizontal bar split into parts (done / missed / upcoming…), with a legend. */
export function SplitBar({ parts }: { parts: { name: string; value: number; color: string }[] }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <View style={{ gap: spacing.space3 }}>
      <View style={styles.split}>
        {total === 0 ? <View style={[styles.splitPart, { flex: 1, backgroundColor: colors.line }]} /> : null}
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <View key={p.name} style={[styles.splitPart, { flex: p.value, backgroundColor: p.color }]} />
          ))}
      </View>
      <View style={styles.splitLegend}>
        {parts.map((p) => (
          <View key={p.name} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: p.color }]} />
            <Text style={styles.legendText}>
              {p.name} <Text style={styles.legendValue}>{p.value}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Ranked horizontal bars: who or where came up most. */
export function RankBars({ items }: { items: Slice[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <Text style={styles.legendText}>Nothing yet</Text>;
  return (
    <View style={{ gap: spacing.space2 }}>
      {items.map((item) => (
        <View key={item.name} style={styles.rankRow}>
          <Text style={styles.rankName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.rankTrack}>
            <View style={[styles.rankFill, { width: `${(item.value / max) * 100}%` }]} />
          </View>
          <Text style={styles.legendValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space4 },
  legend: { flex: 1, gap: spacing.space2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  legendText: { ...text.caption, color: colors.ink, flexShrink: 1 },
  legendValue: { ...text.caption, color: colors.inkMuted },
  split: { flexDirection: 'row', height: 14, borderRadius: radius.full, overflow: 'hidden', gap: 2 },
  splitPart: { height: 14 },
  splitLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space3 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  rankName: { ...text.caption, color: colors.ink, width: 110 },
  rankTrack: { flex: 1, height: 10, borderRadius: radius.full, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  rankFill: { height: 10, borderRadius: radius.full, backgroundColor: colors.settledFill },
});
