import { Activity, Bell, ChartNoAxesCombined, History, Pause, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MainInterfaceHomeProps } from "@/components/MainInterfaceHome";

type Props = MainInterfaceHomeProps & { onPowered: () => void };

/** Extra home layouts (Neon Pulse m10, Arc Reactor m13, Cipher m14, Hologram m15) in the same neon language as the originals. Presentation only. */
export function ExtraInterfaceHome(p: Props) {
  const id = p.skinId;
  const name = p.activeEA.name;
  const run = p.running ? "STOP" : "START";
  const RunIcon = p.running ? Pause : Play;
  const openPairs = () => p.onOpenPairs(p.activeEA.id);

  const portrait = (cls = "") => <div className={`reference-portrait ${cls}`}>{p.avatar ? <img src={p.avatar} alt={name} draggable={false} /> : <span>{p.initials}</span>}</div>;
  const powered = <Button variant="ghost" className="reference-powered nx-powered" onClick={p.onPowered}>Powered By <span>Algo Vault</span></Button>;
  const dot = <span className={`nx-dot ${p.running ? "is-running" : ""}`} aria-label={p.running ? "Running" : "Stopped"} />;
  const startOrb = <Button variant="ghost" className="nx-orb" onClick={p.toggleStart}><RunIcon fill="currentColor" /><span>{run}</span></Button>;
  const btn = (label: string, onClick: () => void, icon: React.ReactNode, danger = false) =>
    <Button variant="ghost" className={`nx-btn ${danger ? "is-danger" : ""}`} onClick={onClick}><span className="nx-btn-icon">{icon}</span><span className="nx-btn-label">{label}</span></Button>;
  const del = btn("DELETE", p.onRemove, <Trash2 fill="currentColor" />, true);
  const sym = btn("SYMBOLS", openPairs, <ChartNoAxesCombined />);
  const logs = btn("LOGS", p.onOpenLogs, <History />);

  return (
    <section className="reference-home nx-home" data-skin={id}>
      {id === "m10" && <>
        <div className="nx-rings">{portrait()}{dot}</div>
        <p className="reference-caption">Your Trading With</p>
        <h1 className="reference-name">{name}</h1>
        {powered}
        <div className="nx-capsule">{sym}{startOrb}{logs}</div>
        <div className="nx-center">{del}</div>
        <Fleet p={p} />
      </>}
      {id === "m13" && <>
        <div className="nx-reactor">{portrait()}</div>
        <h1 className="reference-name">{name}</h1>
        <p className="reference-caption nx-status-text">{dot}{p.running ? "Robot is trading" : "Robot is ready"}</p>
        <Button variant="ghost" className="nx-wide" onClick={p.toggleStart}><RunIcon fill="currentColor" />{run} ROBOT</Button>
        <div className="nx-trio">{del}{sym}{logs}</div>
        {powered}
        <Fleet p={p} />
      </>}
      {id === "m14" && <>
        <div className="cx-card">
          {p.avatar ? <img className="cx-art" src={p.avatar} alt={name} draggable={false} /> : <span className="cx-initials">{p.initials}</span>}
          <Button variant="ghost" size="icon" className="cx-bell" aria-label="Logs" onClick={p.onOpenLogs}><Bell /></Button>
          <div className="cx-bottom">
            <h1 className="cx-name">{name}{dot}</h1>
            <div className="cx-acts">
              <Button variant="ghost" className="cx-act" onClick={p.toggleStart}><RunIcon fill="currentColor" /><span>{run}</span></Button>
              <Button variant="ghost" className="cx-act" onClick={openPairs}><Activity /><span>QUOTES</span></Button>
              <Button variant="ghost" className="cx-act" onClick={p.onRemove}><Trash2 /><span>REMOVE</span></Button>
            </div>
          </div>
        </div>
        <Button variant="ghost" className="reference-powered cx-powered" onClick={p.onPowered}>Powered By <span>Algo Vault</span></Button>
        <Button variant="ghost" className="cx-add" onClick={p.onAdd}>
          <Plus className="cx-add-plus" />
          <span className="cx-add-copy"><strong>ADD ROBOT</strong><small>HOST ROBOT KEY</small></span>
        </Button>
        {p.eas.length > 1 && <Fleet p={p} />}
      </>}
      {id === "m15" && <>
        <div className="hx-frame">{portrait()}<span className="hx-scan" aria-hidden /></div>
        <h1 className="reference-name">{name}</h1>
        <p className="reference-caption nx-status-text">{dot}{p.running ? "Hologram live · trading" : "Hologram standby"}</p>
        <div className="hx-bar">
          <Button variant="ghost" className="hx-seg" onClick={openPairs}><ChartNoAxesCombined />SYMBOLS</Button>
          <Button variant="ghost" className="hx-seg is-main" onClick={p.toggleStart}><RunIcon fill="currentColor" />{run}</Button>
          <Button variant="ghost" className="hx-seg" onClick={p.onOpenLogs}><History />LOGS</Button>
        </div>
        <div className="nx-center">{del}</div>
        {powered}
        <Fleet p={p} />
      </>}
    </section>
  );
}

function Fleet({ p }: { p: Props }) {
  const img = (src?: string | null) => src || p.profileImage || p.avatar;
  return (
    <div className="reference-fleet nx-fleet">
      <p className="reference-fleet-label">Connected Robots:</p>
      <div className="nx-fleet-items">
        {p.eas.map((ea) => (
          <div key={ea.id} className={`reference-robot-row nx-robot ${ea.id === p.activeEA.id ? "is-active" : ""}`}>
            <Button variant="ghost" className="nx-robot-pick" onClick={() => p.onPickEA(ea.id)}><img src={img(ea.image)} alt="" /><span className="reference-row-name">{ea.name}</span></Button>
          </div>
        ))}
        <Button variant="ghost" className="reference-add nx-add" onClick={p.onAdd}><span className="reference-plus"><Plus /></span><span className="reference-add-copy"><span>ADD ROBOT</span></span></Button>
      </div>
    </div>
  );
}
