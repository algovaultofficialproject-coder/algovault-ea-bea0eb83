import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Upload, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { getApkUploadUrl, publishApk, getApkDownload } from "@/lib/app-file.functions";

export const Route = createFileRoute("/upload-app")({
  head: () => ({
    meta: [
      { title: "Upload Android App — AlgoVault" },
      { name: "description", content: "Upload the Android app file people get when they tap Download Android." },
      { property: "og:title", content: "Upload Android App — AlgoVault" },
      { property: "og:description", content: "Upload the Android app file for the AlgoVault download button." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UploadApp,
});

function UploadApp() {
  const start = useServerFn(getApkUploadUrl);
  const publish = useServerFn(publishApk);
  const current = useServerFn(getApkDownload);
  const [file, setFile] = useState<File | null>(null);
  const [pw, setPw] = useState("");
  const [now, setNow] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { current().then((r) => setNow(r.name)).catch(() => {}); }, [current]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const s = await start({ data: { password: pw, filename: file.name } });
      if (!s.ok) { setMsg({ ok: false, text: s.error }); setBusy(false); return; }
      const up = await supabase.storage.from("app-files").uploadToSignedUrl(s.path, s.token, file, {
        contentType: "application/vnd.android.package-archive",
      });
      if (up.error) throw up.error;
      const p = await publish({ data: { password: pw, path: s.path } });
      if (!p.ok) { setMsg({ ok: false, text: p.error }); setBusy(false); return; }
      setNow(file.name); setFile(null);
      setMsg({ ok: true, text: "Uploaded. Download Android now gives this file." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Upload failed." });
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-border bg-card p-6 space-y-4">
        <h1 className="font-display text-2xl font-bold">Android app file</h1>
        <p className="text-sm text-muted-foreground">Current file: <span className="font-semibold text-foreground">{now ?? "none yet"}</span></p>
        <label className="text-sm font-semibold flex items-center gap-2"><Upload className="size-4 text-primary" /> Choose the .apk file</label>
        <Input type="file" accept=".apk,application/vnd.android.package-archive" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-12 rounded-xl" required />
        <label className="text-sm font-semibold flex items-center gap-2"><Lock className="size-4 text-primary" /> Password</label>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="h-12 rounded-xl" required />
        {msg && <p className={msg.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{msg.text}</p>}
        <Button type="submit" disabled={busy || !file} className="w-full h-12 rounded-xl">{busy ? "Uploading…" : "Upload"}</Button>
        <Link to="/ios" className="block text-center text-sm text-primary">Back to trading app</Link>
      </form>
    </div>
  );
}
