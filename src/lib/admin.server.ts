import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function adminEnsureAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Profile lookup failed");
  if (!data?.is_admin) throw new Error("Forbidden: admin only");
}

export async function adminListUsers() {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const profiles = await supabaseAdmin.from("profiles").select("*");
  const pmap = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  return data.users.map((u) => {
    const p = pmap.get(u.id) as any;
    return {
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      full_name: p?.full_name ?? null,
      is_admin: !!p?.is_admin,
      approved: !!p?.approved,
    };
  });
}

export async function adminSendReset(email: string, redirectTo?: string) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    ...(redirectTo ? { options: { redirectTo } } : {}),
  });
  if (error) throw error;
  return { link: data.properties?.action_link ?? null };
}
