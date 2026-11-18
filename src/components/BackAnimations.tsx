import { useMemo } from "react";
import type { TradingPrefs } from "@/lib/trading-prefs";

/** Seeded so every render keeps the same layout (no hydration or re-render jumps). */
function seeded(n: number) {
  let x = n * 9301 + 49297;
  return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
}

/** Decorative layers behind the trading app; never interactive. */
export function BackAnimations({ anim }: { anim: TradingPrefs["anim"] }) {
  const rain = useMemo(() => { const r = seeded(7); return Array.from({ length: 26 }, (_, i) => ({ i, left: r() * 100, delay: r() * 8, dur: 5 + r() * 6, size: 14 + r() * 18, glyph: ["$", "€", "£", "¥", "$", "₿"][i % 6] })); }, []);
  const streams = useMemo(() => { const r = seeded(11); return Array.from({ length: 16 }, (_, i) => ({ i, left: (i / 16) * 100 + r() * 3, delay: r() * 6, dur: 7 + r() * 8, bits: Array.from({ length: 40 }, () => (r() > 0.5 ? "1" : "0")).join("\n") })); }, []);
  const candles = useMemo(() => {
    const r = seeded(3); let price = 50;
    return Array.from({ length: 48 }, (_, i) => {
      const open = price; price = Math.max(10, Math.min(90, price + (r() - 0.48) * 12));
      const hi = Math.max(open, price) + r() * 5, lo = Math.min(open, price) - r() * 5;
      return { i, open, close: price, hi, lo };
    });
  }, []);
  const any = Object.entries(anim).some(([k, v]) => v && k !== "robotVideo" && k !== "colourMatrix");
  if (!any) return null;
  return (
    <div className="back-anim-layer" aria-hidden="true">
      {anim.candleChart && (
        <div className="back-anim-candles">
          {[0, 1].map((copy) => (
            <svg key={copy} viewBox="0 0 480 100" preserveAspectRatio="none">
              {candles.map((c) => {
                const x = c.i * 10 + 5, up = c.close >= c.open;
                return <g key={c.i} className={up ? "is-up" : "is-down"}>
                  <line x1={x} x2={x} y1={100 - c.hi} y2={100 - c.lo} />
                  <rect x={x - 3} width={6} y={100 - Math.max(c.open, c.close)} height={Math.max(1.5, Math.abs(c.close - c.open))} />
                </g>;
              })}
            </svg>
          ))}
        </div>
      )}
      {anim.hackers && streams.map((s) => <span key={s.i} className="back-anim-binary" style={{ left: `${s.left}%`, animationDelay: `-${s.delay}s`, animationDuration: `${s.dur}s` }}>{s.bits}</span>)}
      {anim.profitRain && rain.map((d) => <span key={d.i} className="back-anim-rain" style={{ left: `${d.left}%`, animationDelay: `-${d.delay}s`, animationDuration: `${d.dur}s`, fontSize: `${d.size}px` }}>{d.glyph}</span>)}
      {anim.lightning && <><span className="back-anim-flash" /><svg className="back-anim-bolt" viewBox="0 0 60 200"><path d="M38 0 L10 92 L30 92 L14 200 L52 76 L30 76 L46 0 Z" /></svg></>}
    </div>
  );
}
