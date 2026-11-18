import { useLayoutEffect, useRef, useState } from "react";
import { NavChartIcon, NavGearIcon, NavHomeIcon } from "@/components/NavIcons";

/** Native width/height the trading bottom navigator is laid out at before scaling into a phone mockup. */
export const PREVIEW_NAV_WIDTH = 390;
/** Nav bar height plus the raised Home button overhang, in native pixels. */
export const PREVIEW_NAV_TOTAL = 84;

/** Presentation only: a scaled copy of the trading app's bottom navigator (no clicks, no navigation). */
export function PreviewTradingNav() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / PREVIEW_NAV_WIDTH);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className="vault-phone-tabbar" style={{ height: PREVIEW_NAV_TOTAL * scale }} aria-hidden="true">
    <nav className="reference-nav slim-nav" data-nav-style="classic" style={{ width: PREVIEW_NAV_WIDTH, transform: `scale(${scale || 1})`, visibility: scale ? "visible" : "hidden" }}>
      <div className="flex items-end justify-around">
        <span className="reference-tab"><span className="reference-tab-icon"><NavChartIcon /></span><span>Metatrader</span></span>
        <span className="reference-tab reference-home-tab is-active"><span className="reference-tab-icon"><NavHomeIcon /></span><span>Home</span></span>
        <span className="reference-tab"><span className="reference-tab-icon"><NavGearIcon /></span><span>Settings</span></span>
      </div>
    </nav>
  </div>;
}
