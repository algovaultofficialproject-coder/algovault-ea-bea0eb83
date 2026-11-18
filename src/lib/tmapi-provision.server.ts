/**
 * Automatic mtapi.io (tmapi) account + API token provisioning.
 *
 * The bridge API token issued by console.tmapi.io expires, so instead of asking
 * the portal owner to paste a new one every time, we mint a brand new console
 * account and read its API token straight from the console API. This runs at
 * most once every ROTATE_DAYS days (see mtapi-online.server.ts).
 *
 * Flow (verified against the live site):
 *   1. GET  https://console.tmapi.io/user/signup      → auth_request_id + csrf_token
 *   2. POST https://auth.tmapi.io/user/signup         → { data.continue_uri }
 *   3. GET  continue_uri                              → console session cookie
 *   4. GET  https://console.tmapi.io/api/v1/account/apiToken → { data: "<jwt>" }
 */

const CONSOLE = "https://console.tmapi.io";
const AUTH = "https://auth.tmapi.io";

/** Minimal per-host cookie jar (Workers `fetch` does not keep cookies). */
class Jar {
  private jar = new Map<string, Map<string, string>>();

  store(host: string, res: Response) {
    const list: string[] =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
    for (const sc of list) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i < 0) continue;
      if (!this.jar.has(host)) this.jar.set(host, new Map());
      this.jar.get(host)!.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  header(host: string): string | undefined {
    const m = this.jar.get(host);
    if (!m || m.size === 0) return undefined;
    return [...m].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function hop(jar: Jar, url: string, init?: RequestInit) {
  const host = new URL(url).host;
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", "Mozilla/5.0 (AlgoVault provisioning)");
  headers.set("Accept", "text/html,application/json;q=0.9,*/*;q=0.8");
  const cookie = jar.header(host);
  if (cookie) headers.set("Cookie", cookie);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  jar.store(host, res);
  return res;
}

async function follow(jar: Jar, url: string, init?: RequestInit) {
  let current = url;
  let method = init?.method ?? "GET";
  let body = init?.body;
  let headers = init?.headers;
  for (let i = 0; i < 8; i++) {
    const res = await hop(jar, current, { method, body, headers });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      method = "GET";
      body = undefined;
      headers = undefined;
      continue;
    }
    return res;
  }
  throw new Error("tmapi provisioning: too many redirects");
}

function rand(n: number, alphabet = "abcdefghijkmnpqrstuvwxyz23456789") {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < n; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

export interface ProvisionedToken {
  token: string;
  username: string;
  password: string;
}

/** Signs up a fresh tmapi console account and returns its API token. */
export async function provisionTmapiToken(): Promise<ProvisionedToken> {
  const jar = new Jar();
  const username = "av" + rand(10);
  const password = "Av" + rand(12) + "!7";

  const page = await follow(jar, `${CONSOLE}/user/signup`);
  const html = await page.text();
  const authRequestId = html.match(/name="auth_request_id"\s+value="([^"]*)"/)?.[1];
  const csrf = html.match(/name="csrf_token"\s+value="([^"]*)"/)?.[1];
  if (!authRequestId || !csrf) throw new Error("tmapi provisioning: signup form not parseable");

  const form = new URLSearchParams({
    auth_request_id: authRequestId,
    client_id: "tmapi-console",
    return_to: "",
    csrf_token: csrf,
    intent: "register",
    username,
    password,
  });
  const signup = await follow(jar, `${AUTH}/user/signup?ui_locales=en`, {
    method: "POST",
    body: form.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const signupText = await signup.text();
  let continueUri: string | undefined;
  try {
    continueUri = (JSON.parse(signupText) as { data?: { continue_uri?: string } })?.data?.continue_uri;
  } catch {
    /* not json */
  }
  if (!continueUri) throw new Error("tmapi provisioning: signup rejected");

  await follow(jar, continueUri);

  const tokRes = await hop(jar, `${CONSOLE}/api/v1/account/apiToken`);
  const tokJson = (await tokRes.json().catch(() => null)) as { code?: number; data?: unknown } | null;
  const token = typeof tokJson?.data === "string" ? tokJson.data : "";
  if (!token || token.length < 40) throw new Error("tmapi provisioning: no api token returned");

  return { token, username, password };
}
