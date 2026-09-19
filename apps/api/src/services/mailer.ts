import type { Bindings } from "../env";

export interface Mailer {
  send(msg: { to: string; subject: string; html: string }): Promise<void>;
}

/** Plain-text alternative derived from our simple HTML templates (better deliverability than HTML only). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => (label.trim() === href ? href : `${label} (${href})`))
    .replace(/<\/(p|h\d|tr|li|table)>|<br\s*\/?>|<hr[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cloudflare Email Service `send_email` binding (docs: developers.cloudflare.com/email-service/api/send-emails/workers-api).
 * The sender domain must be onboarded/verified, otherwise send() throws E_SENDER_NOT_VERIFIED.
 * Swap this one function to move to Resend; nothing else depends on it.
 */
export function cloudflareMailer(env: Bindings): Mailer {
  return {
    async send(m) {
      await env.EMAIL.send({ from: env.MAIL_FROM, to: m.to, subject: m.subject, html: m.html, text: htmlToText(m.html) });
    },
  };
}

export function memoryMailer(): Mailer & { sent: Array<{ to: string; subject: string; html: string }> } {
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  return { sent, async send(m) { sent.push(m); } };
}

/**
 * Sends never break the request that triggered them, but failures are logged (with the Cloudflare error code,
 * e.g. E_SENDER_NOT_VERIFIED / E_RATE_LIMIT_EXCEEDED) so they show up in Workers logs.
 */
export async function safeSend(mailer: Mailer, msgs: Array<{ to: string; subject: string; html: string }>) {
  const results = await Promise.allSettled(msgs.map((m) => mailer.send(m)));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[mail] failed to=${msgs[i]!.to} subject="${msgs[i]!.subject}" code=${(r.reason as any)?.code ?? "?"} ${(r.reason as any)?.message ?? r.reason}`);
  });
}
