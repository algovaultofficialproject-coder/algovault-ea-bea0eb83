import { ArrowLeftRight, ChartNoAxesCombined, DollarSign, History, Info, Mic, Pause, Play, Plus, Trash2, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MainInterfaceHomeProps } from "@/components/MainInterfaceHome";

type Props = MainInterfaceHomeProps & { onPowered: () => void };

/**
 * Screenshot copies of the reference phone homes (Default m2, Matrix m4, Phoenix m6, New School m8,
 * Showcase m9, Nova m16) on a plain dark screen. Presentation only: every button uses the shared callbacks.
 */
export function CopyInterfaceHome(p: Props) {
  const id = p.skinId;
  const name = p.activeEA.name;
  const running = p.running;
  const RunIcon = running ? Pause : Play;
  const openPairs = () => p.onOpenPairs(p.activeEA.id);
  const img = (src?: string | null) => src || p.profileImage || p.avatar;

  const portrait = <div className="cp-portrait">{p.avatar ? <img src={p.avatar} alt={name} draggable={false} /> : <span>{p.initials}</span>}</div>;
  const caption = <p className="cp-caption">Your Trading With</p>;
  const title = <h1 className="cp-name">{name}</h1>;
  const powered = (label = "Powered By") => <Button variant="ghost" className="cp-powered" onClick={p.onPowered}>{label} <span>Algo Vault</span></Button>;
  const circle = (label: string, onClick: () => void, icon: React.ReactNode, main = false) =>
    <Button variant="ghost" className={`cp-circle ${main ? "is-main" : ""}`} onClick={onClick}><span className="cp-circle-icon">{icon}</span><span className="cp-circle-label">{label}</span></Button>;
  const del = (label: string) => circle(label, p.onRemove, <Trash2 fill="currentColor" />);
  const start = circle(running ? "STOP" : "START", p.toggleStart, <RunIcon fill="currentColor" />, true);
  const symbols = circle("SYMBOLS", openPairs, <ChartNoAxesCombined />);

  return (
    <section className="cp-home" data-skin={id}>
      {id === "m2" && <>
        {portrait}{caption}{title}{powered()}
        <div className="cp-bar">{del("DELETE")}{start}{symbols}</div>
        <p className="cp-label">Connected Robots:</p>
        {p.eas.map((ea) => <Button key={ea.id} variant="ghost" className="cp-row" onClick={() => p.onPickEA(ea.id)}><img src={img(ea.image)} alt="" /><span className="cp-row-name">{ea.name}</span></Button>)}
        <Button variant="ghost" className="cp-row cp-add" onClick={p.onAdd}><span className="cp-plus"><Plus /></span><span className="cp-row-name">Add License Key</span></Button>
      </>}

      {id === "m4" && <>
        {portrait}{caption}{title}{powered()}
        <div className="cp-trio">{del("DELETE")}<span className="cp-halo">{start}</span>{symbols}</div>
        <Button variant="ghost" className="cp-selected" onClick={() => p.onPickEA(p.activeEA.id)}>{name}</Button>
        <Button variant="ghost" className="cp-row cp-add" onClick={p.onAdd}><span className="cp-plus"><Plus /></span><span className="cp-add-copy"><span>Connect EA</span><small>Connect New License Key</small></span></Button>
      </>}

      {id === "m6" && <>
        {portrait}{caption}{title}{powered()}
        <div className="cp-bar">{del("DELETE")}{start}{symbols}</div>
        <p className="cp-label">Connected Robots:</p>
        {p.eas.map((ea) => <Button key={ea.id} variant="ghost" className="cp-row" onClick={() => p.onPickEA(ea.id)}><img src={img(ea.image)} alt="" /><span className="cp-dot">•</span><span className="cp-row-name">{ea.name}</span></Button>)}
        <Button variant="ghost" className="cp-row cp-add" onClick={p.onAdd}><span className="cp-plus"><Plus /></span><span className="cp-add-copy"><span>CONNECT YOUR EDGE EA</span><small>USE LICENSE KEY</small></span></Button>
      </>}

      {id === "m8" && <>
        <div className="cp-top"><span className="cp-brand">ALGO VAULT</span><span className="cp-info" aria-hidden><Info /></span></div>
        {portrait}{title}
        <p className="cp-mission">No Emotions Just Money And Mission</p>
        <div className="cp-panel">
          {circle("PAIRS", openPairs, <TrendingUp />)}
          {circle(running ? "STOP" : "START", p.toggleStart, <RunIcon fill="currentColor" />, true)}
          {circle("LOGS", p.onOpenLogs, <History />)}
        </div>
        {powered("Powered by")}
        <p className="cp-label">Robot List</p>
        {p.eas.map((ea) => <div key={ea.id} className="cp-row">
          <Button variant="ghost" className="cp-row-pick" onClick={() => p.onPickEA(ea.id)}><img src={img(ea.image)} alt="" /><span className="cp-row-name">{ea.name}</span></Button>
          <Button variant="ghost" size="icon" className="cp-x" aria-label={`Remove ${ea.name}`} onClick={() => p.onRemoveEA(ea.id)}><X /></Button>
        </div>)}
      </>}

      {id === "m9" && <>
        {portrait}{caption}{title}{powered()}
        <div className="cp-trio">{circle("Remove", p.onRemove, <Trash2 fill="currentColor" />)}{circle(running ? "Stop" : "Start", p.toggleStart, <RunIcon fill="currentColor" />, true)}{circle("Quotes", openPairs, <DollarSign />)}</div>
        <div className="cp-art">{p.avatar ? <img src={p.avatar} alt={name} draggable={false} /> : <span>{p.initials}</span>}</div>
      </>}

      {id === "m16" && <>
        {portrait}{title}
        <p className="cp-caption">Scalping and swing trade</p>
        {powered()}
        <div className="cp-stack">
          <Button variant="ghost" className="cp-pill" onClick={openPairs}><ArrowLeftRight />Pairs</Button>
          <div className="cp-pill-row">
            <Button variant="ghost" className="cp-pill" onClick={p.toggleStart}><RunIcon fill="currentColor" />{running ? "Stop" : "Start"}</Button>
            <span className={`cp-mic ${running ? "is-running" : ""}`} aria-hidden><Mic /></span>
          </div>
          <Button variant="ghost" className="cp-pill" onClick={p.onOpenLogs}><History />Logs</Button>
          <Button variant="ghost" className="cp-pill is-muted" onClick={p.onRemove}><Trash2 fill="currentColor" />Remove EA</Button>
        </div>
        <p className="cp-label">Robots List:</p>
        {p.eas.map((ea) => <Button key={ea.id} variant="ghost" className="cp-row" onClick={() => p.onPickEA(ea.id)}><img src={img(ea.image)} alt="" /><span className="cp-row-name">{ea.name}</span></Button>)}
        <Button variant="ghost" className="cp-row cp-add" onClick={p.onAdd}><Plus />Add Another License</Button>
      </>}
    </section>
  );
}
