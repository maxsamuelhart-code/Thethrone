import type { Env } from "./env";
import { escapeHtml } from "./html";

export async function sendDethronedEmail(env: Env, to: string, newKing: string): Promise<void> {
  const link = env.SITE_URL;
  const safeName = escapeHtml(newKing);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: `You've been dethroned by ${newKing}`,
      text: `You've been dethroned by ${newKing}. Take it back → ${link}`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:18px;line-height:1.5;color:#1a0b2e">
  <p style="font-size:40px;margin:0">👑</p>
  <p>You've been dethroned by <strong>${safeName}</strong>.</p>
  <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#ffcc00;color:#1a0b2e;padding:12px 20px;border-radius:12px;font-weight:800;text-decoration:none">Take it back →</a></p>
  <p style="font-size:13px;color:#666">You got this email because you held The Throne. No cash prizes.</p>
</div>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
