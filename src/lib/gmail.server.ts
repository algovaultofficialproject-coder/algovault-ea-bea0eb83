import { renderGmailEmail, type EmailExtras } from "./gmail-template";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

const b64 = (s: string) =>
  btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));
const header = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

const SENDER_NAME = "Algo Vault EA";
let senderAddress: string | null = null;

/** The connected Gmail address, read once so the From line can carry the brand name. */
async function getSenderAddress(lovable: string, gmail: string) {
  if (senderAddress) return senderAddress;
  const res = await fetch(`${GATEWAY_URL}/users/me/profile`, {
    headers: { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": gmail },
  });
  if (!res.ok) {
    console.error(`Gmail profile failed [${res.status}]: ${await res.text()}`);
    return null;
  }
  const body = (await res.json()) as { emailAddress?: string };
  senderAddress = body.emailAddress ?? null;
  return senderAddress;
}

const OUTLOOK_URL = "https://connector-gateway.lovable.dev/microsoft_outlook";

/** Sends through the connected Outlook/Hotmail account. */
async function sendOutlook(lovable: string, outlook: string, to: string, subject: string, html: string) {
  const res = await fetch(`${OUTLOOK_URL}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": outlook, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] },
    }),
  });
  if (!res.ok) {
    console.error(`Outlook send failed [${res.status}]: ${await res.text()}`);
    return { sent: false };
  }
  return { sent: true };
}

/** Sends an AlgoVault email via Outlook when connected, else Gmail. Never throws. */
export async function sendGmail(to: string, subject: string, lines: string[], extras?: EmailExtras) {
  try {
    const lovable = process.env.LOVABLE_API_KEY;
    const outlook = process.env.MICROSOFT_OUTLOOK_API_KEY;
    const gmail = process.env.GOOGLE_MAIL_API_KEY;
    if (!lovable || !to) return { sent: false };
    const html = renderGmailEmail(subject, lines, extras);
    if (outlook) {
      const viaOutlook = await sendOutlook(lovable, outlook, to, subject, html);
      if (viaOutlook.sent || !gmail) return viaOutlook;
    }
    if (!gmail) return { sent: false };
    const from = await getSenderAddress(lovable, gmail);
    const raw = b64(
      [...(from ? [`From: "${SENDER_NAME}" <${from}>`] : []), `To: ${to}`, `Subject: ${header(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", html].join("\r\n"),
    ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = await fetch(`${GATEWAY_URL}/users/me/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": gmail, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      console.error(`Gmail send failed [${res.status}]: ${await res.text()}`);
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    console.error("Gmail send error", e);
    return { sent: false };
  }
}
