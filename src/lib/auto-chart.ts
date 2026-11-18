export type ChartCandle = { time: number; open: number; high: number; low: number; close: number };
export type AutoChart = { symbol: string; source: string; fetchedAt: number; m1: ChartCandle[]; m5: ChartCandle[]; m15: ChartCandle[]; h1: ChartCandle[] };

/** Produce the same inspectable chart input used by the screenshot scanner. */
export function autoChartImage(chart: AutoChart, only?: "M15"): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1400; canvas.height = only ? 520 : 1200;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to prepare the live chart");
  // Canvas is scanner input, not app presentation: fixed high-contrast chart ink.
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111"; ctx.font = "bold 24px Arial";
  ctx.fillText(`${chart.symbol} · Source ${chart.source} · ${new Date(chart.fetchedAt).toISOString()} · UTC`, 24, 32);
  const all = [{ label: "H1", candles: chart.h1 }, { label: "M15", candles: chart.m15 }, { label: "M5", candles: chart.m5 }];
  const frames = only ? all.filter((f) => f.label === only) : all;
  frames.forEach(({ label, candles }, panel) => {
    const top = 75 + panel * 370, bottom = top + 280, left = 24, right = 1240;
    const low = Math.min(...candles.map((c) => c.low)), high = Math.max(...candles.map((c) => c.high));
    const pad = Math.max((high - low) * 0.08, high * 0.00001);
    const min = low - pad, max = high + pad;
    const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
    ctx.fillStyle = "#111"; ctx.font = "bold 22px Arial"; ctx.fillText(label, left, top - 12);
    for (let row = 0; row <= 6; row++) {
      const value = min + (max - min) * row / 6, yy = y(value);
      ctx.strokeStyle = "#ddd"; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
      ctx.fillStyle = "#111"; ctx.font = "16px Arial"; ctx.fillText(value.toFixed(5), right + 12, yy + 5);
    }
    const step = (right - left) / candles.length;
    candles.forEach((c, index) => {
      const x = left + step * (index + 0.5);
      ctx.fillStyle = c.close >= c.open ? "#008055" : "#c52233"; ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath(); ctx.moveTo(x, y(c.high)); ctx.lineTo(x, y(c.low)); ctx.stroke();
      ctx.fillRect(x - step * 0.3, Math.min(y(c.open), y(c.close)), step * 0.6, Math.max(1, Math.abs(y(c.open) - y(c.close))));
    });
    ctx.fillStyle = "#111"; ctx.font = "16px Arial";
    const first = candles[0], last = candles.at(-1);
    if (first && last) ctx.fillText(`${new Date(first.time * 1000).toISOString()} → ${new Date(last.time * 1000).toISOString()}   Last ${last.close.toFixed(5)}`, left, bottom + 28);
  });
  return canvas.toDataURL("image/png");
}