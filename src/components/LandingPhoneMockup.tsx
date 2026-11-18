import { useLayoutEffect, useRef, useState } from "react";
import { BatteryFull, Signal, Wifi } from "lucide-react";
import { MainInterfaceHome } from "@/components/MainInterfaceHome";
import { PREVIEW_NAV_TOTAL, PREVIEW_NAV_WIDTH, PreviewTradingNav } from "@/components/PreviewTradingNav";
import robot from "@/assets/algo-vault-robot.jpg";

const previewBot = { id: "landing-preview", name: "Algo Vault EA", image: robot };
const noop = () => {};

/** Presentation only: a trading-app home screen for decorative phone mockups (no broker, execution or settings). */
export function TradingHomePreview({ skinId, name, image }: { skinId: string; name: string; image?: string | null }) {
  const pic = image || robot;
  const bot = { id: "promo-preview", name, image: pic };
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0, height: 0 });
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const w = o.clientWidth, h = o.clientHeight - PREVIEW_NAV_TOTAL * (w / PREVIEW_NAV_WIDTH);
      const natural = i.scrollHeight || 1;
      const scale = Math.min(w / PREVIEW_WIDTH, h / natural);
      setFit({ scale, height: natural });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o); ro.observe(i);
    return () => ro.disconnect();
  }, [skinId]);
  return <div ref={outer} className="vault-phone-screen promo-fit-screen reference-trading-app h-full" data-trading-colour="blue" inert>
    <div className="promo-fit-stage" style={{ width: PREVIEW_WIDTH * fit.scale, height: fit.height * fit.scale, visibility: fit.scale ? "visible" : "hidden" }}>
      <div ref={inner} className="promo-fit-inner" style={{ width: PREVIEW_WIDTH, transform: `scale(${fit.scale || 1})` }}>
    <MainInterfaceHome skinId={skinId} activeEA={bot} eas={[bot]} profileImage={pic} avatar={pic} initials={name.slice(0, 2).toUpperCase()} running onOpenPairs={noop} openScanner={noop} toggleStart={noop} onRemove={noop} onPickEA={noop} onAdd={noop} onCycleColour={noop} onOpenLogs={noop} onRemoveEA={noop} />
      </div>
    </div>
    <PreviewTradingNav />
  </div>;
}

/** Native phone width the interface is laid out at before being scaled to fit the mockup screen. */
const PREVIEW_WIDTH = 390;

/** Presentation only: the preview has no broker, execution or persisted settings. */
export function LandingPhoneMockup({ secondary = false }: { secondary?: boolean }) {
  return <div className={`vault-phone ${secondary ? "vault-phone-secondary" : ""}`} aria-hidden={secondary || undefined}>
    <div className="vault-phone-camera" />
    <div className="vault-phone-screen reference-trading-app" data-trading-colour="blue" inert>
      <div className="vault-phone-status"><span>9:41</span><span><Signal /><Wifi /><BatteryFull /></span></div>
      <MainInterfaceHome skinId="m8" activeEA={previewBot} eas={[previewBot]} profileImage={robot} avatar={robot} initials="AV" running={false} onOpenPairs={noop} openScanner={noop} toggleStart={noop} onRemove={noop} onPickEA={noop} onAdd={noop} onCycleColour={noop} onOpenLogs={noop} onRemoveEA={noop} />
      <PreviewTradingNav />
      <div className="vault-phone-home-indicator" />
    </div>
  </div>;
}