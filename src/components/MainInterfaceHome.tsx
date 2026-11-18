import { ChartNoAxesCombined, Pause, Play, Plus, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAIN_INTERFACES } from "@/lib/portal-store";
import { COPY_INTERFACE_IDS, EXTRA_INTERFACE_IDS } from "@/lib/interface-ids";
import { CopyInterfaceHome } from "@/components/CopyInterfaceHome";
import { ExtraInterfaceHome } from "@/components/ExtraInterfaceHome";
import { useDoubleTap } from "@/hooks/use-double-tap";

export type MainInterfaceHomeProps = {
  skinId: string;
  activeEA: { id: string; name: string; image?: string | null };
  eas: Array<{ id: string; name: string; image?: string | null }>;
  profileImage: string | null;
  avatar: string;
  initials: string;
  running: boolean;
  onOpenPairs: (id: string) => void;
  openScanner: () => void;
  toggleStart: () => void;
  onRemove: () => void;
  onPickEA: (id: string) => void;
  onAdd: () => void;
  onCycleColour: () => void;
  onOpenLogs: () => void;
  onRemoveEA: (id: string) => void;
};

/** Picks the home design; Crimson (m7) is drawn here, the others by their own components. */
export function MainInterfaceHome(p: MainInterfaceHomeProps) {
  const tapPowered = useDoubleTap(p.onCycleColour);
  const id = MAIN_INTERFACES.some((s) => s.id === p.skinId) ? p.skinId : "m2";
  if (COPY_INTERFACE_IDS.includes(id)) return <CopyInterfaceHome {...p} skinId={id} onPowered={tapPowered} />;
  if (EXTRA_INTERFACE_IDS.includes(id)) return <ExtraInterfaceHome {...p} skinId={id} onPowered={tapPowered} />;
  return (
    <section className="reference-home" data-skin="m7">
      <div className="reference-robot-card">
        <span className={`reference-status ${p.running ? "is-running" : ""}`} />
        <div className="reference-portrait">{p.avatar ? <img src={p.avatar} alt={p.activeEA.name} /> : <span>{p.initials}</span>}</div>
        <h1 className="reference-name">{p.activeEA.name}</h1>
        <div className="reference-controls">
          <Action label={p.running ? "STOP" : "START"} onClick={p.toggleStart}>{p.running ? <Pause fill="currentColor" /> : <Square />}</Action>
          <Action label="QUOTES" onClick={() => p.onOpenPairs(p.activeEA.id)}><ChartNoAxesCombined /></Action>
          <Action label="REMOVE" onClick={p.onRemove}><Trash2 fill="currentColor" /></Action>
        </div>
        <Button variant="ghost" className="reference-powered reference-powered-compact" onClick={tapPowered}>Powered By <span>Algo Vault</span></Button>
      </div>
      <Button variant="ghost" className="reference-add" onClick={p.onAdd}><span className="reference-plus"><Plus /></span><span className="reference-add-copy"><span>ADD ROBOT</span><small>HOST ROBOT KEY</small></span></Button>
    </section>
  );
}

function Action({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <Button variant="ghost" className="reference-action" onClick={onClick}><span className="reference-action-icon">{children}</span><span className="reference-action-label">{label}</span></Button>;
}
