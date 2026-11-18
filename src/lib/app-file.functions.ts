import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, timingSafeEqual } from "crypto";

const PASSWORD = "t16t85hql9f@gmail.com";
const BUCKET = "app-files";
const KEY = "android_apk_path";

function ok(pw: string) {
  const a = createHash("sha256").update(pw.trim().toLowerCase()).digest();
  const b = createHash("sha256").update(PASSWORD).digest();
  return timingSafeEqual(a, b);
}

/** Step 1: password check, then a one-time upload link straight to storage. */
export const getApkUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200), filename: z.string().max(120) }).parse(d))
  .handler(async ({ data }) => {
    if (!ok(data.password)) return { ok: false as const, error: "Wrong password." };
    const safe = data.filename.replace(/[^A-Za-z0-9._-]/g, "_") || "AlgoVault.apk";
    const path = `android/${Date.now()}-${safe}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !s) return { ok: false as const, error: error?.message ?? "Could not start upload." };
    return { ok: true as const, path, token: s.token };
  });

/** Step 2: after upload, make it the live Android download. */
export const publishApk = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200), path: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    if (!ok(data.password)) return { ok: false as const, error: "Wrong password." };
    if (!data.path.startsWith("android/")) return { ok: false as const, error: "Bad file." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings")
      .upsert({ key: KEY, value: data.path, updated_at: new Date().toISOString() });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

/** Public: a fresh download link for the current Android file. */
export const getApkDownload = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("app_settings").select("value, updated_at").eq("key", KEY).maybeSingle();
  if (!data?.value) return { url: null as string | null, name: null as string | null, updated: null as string | null };
  const name = data.value.split("/").pop()!.replace(/^\d+-/, "");
  const { data: s } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(data.value, 3600, { download: name });
  return { url: s?.signedUrl ?? null, name, updated: data.updated_at as string };
});
