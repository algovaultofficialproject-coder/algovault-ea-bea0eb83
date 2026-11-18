const palette = {
  bg: "#05070d", card: "#0b111c", panel: "#0f1828", ink: "#eaf6ff", muted: "#8aa3b8",
  neon: "#22d3ee", neon2: "#3b82f6", line: "#1c2a3d", keyBg: "#061a24",
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export interface EmailExtras {
  /** Highlighted code shown in a glowing pill box (e.g. a licence key). */
  key?: string;
  keyLabel?: string;
  /** Label/value pairs shown as neon pills. */
  pills?: [string, string][];
}

/** Dark neon, table-based, inline-styled email for Gmail/Outlook and mobile clients. */
export function renderGmailEmail(subject: string, lines: string[], extras: EmailExtras = {}) {
  const p = palette;
  const content = lines.map((line, i) => `<tr><td style="padding:${i === 0 ? "0 0 14px" : "8px 0"};font-size:${i === 0 ? 18 : 15}px;line-height:25px;color:${i === 0 ? p.ink : p.muted};font-weight:${i === 0 ? "bold" : "normal"};overflow-wrap:anywhere">${escapeHtml(line)}</td></tr>`).join("");
  const keyBlock = extras.key
    ? `<tr><td style="padding:18px 0 6px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${p.keyBg};border:2px solid ${p.neon};border-radius:22px;box-shadow:0 0 22px ${p.neon}66,inset 0 0 18px ${p.neon}22"><tr><td align="center" style="padding:22px 14px"><p style="margin:0 0 10px"><span style="display:inline-block;padding:5px 14px;border-radius:999px;background:${p.neon}22;border:1px solid ${p.neon}88;color:${p.neon};font-size:11px;letter-spacing:3px;font-weight:bold">${escapeHtml(extras.keyLabel ?? "LICENCE KEY")}</span></p><p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:26px;line-height:34px;letter-spacing:3px;font-weight:bold;color:${p.neon};text-shadow:0 0 12px ${p.neon};overflow-wrap:anywhere">${escapeHtml(extras.key)}</p></td></tr></table></td></tr>`
    : "";
  const pills = (extras.pills ?? []).map(([label, value]) => `<tr><td style="padding:6px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${p.panel};border:1px solid ${p.neon}55;border-radius:999px"><tr><td style="padding:12px 20px;font-size:13px;color:${p.muted};letter-spacing:1px">${escapeHtml(label.toUpperCase())}</td><td align="right" style="padding:12px 20px;font-size:15px;font-weight:bold;color:${p.neon};text-shadow:0 0 8px ${p.neon}88;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr></table></td></tr>`).join("");
  const orb = `<table role="presentation" cellspacing="0" cellpadding="0" align="center"><tr><td align="center" valign="middle" width="68" height="68" style="width:68px;height:68px;border-radius:50%;background:${p.bg};border:2px solid ${p.neon};box-shadow:0 0 24px ${p.neon};font-size:30px;line-height:68px;color:${p.neon}">&#9889;</td></tr></table>`;
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"></head><body style="margin:0;background:${p.bg};font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(lines[0] ?? subject)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${p.bg}"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:${p.card};border:1px solid ${p.neon}66;border-radius:28px;overflow:hidden;box-shadow:0 0 40px ${p.neon}33"><tr><td align="center" style="padding:30px 24px 26px;background:linear-gradient(135deg,${p.neon2},${p.neon});background-color:${p.neon2}">${orb}<p style="margin:16px 0 0;font-size:25px;line-height:32px;font-weight:bold;color:#ffffff">${escapeHtml(subject)}</p><p style="margin:10px 0 0"><span style="display:inline-block;padding:5px 16px;border-radius:999px;background:#ffffff26;border:1px solid #ffffff66;color:#ffffff;font-size:12px;letter-spacing:2px">ALGO VAULT EA</span></p></td></tr><tr><td style="padding:28px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${content}${keyBlock}${pills}</table></td></tr><tr><td align="center" style="padding:20px 26px;border-top:1px solid ${p.line};font-size:12px;line-height:20px;color:${p.muted}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.neon};box-shadow:0 0 8px ${p.neon}"></span>&nbsp; Algo Vault EA · Your account and bot activity<br>Keep licence keys private. Trading involves risk.</td></tr></table></td></tr></table></body></html>`;
}
