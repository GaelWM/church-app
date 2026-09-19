import type { Bindings } from "../env";

export interface Mailer {
  send(msg: { to: string; subject: string; html: string }): Promise<void>;
}

/** Cloudflare Email Service binding. Swap this one file to move to Resend. */
export function cloudflareMailer(env: Bindings): Mailer {
  return {
    async send(m) {
      await env.EMAIL.send({ from: env.MAIL_FROM, ...m });
    },
  };
}

export function memoryMailer(): Mailer & { sent: Array<{ to: string; subject: string; html: string }> } {
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  return { sent, async send(m) { sent.push(m); } };
}

/** Sends never break the request that triggered them. */
export async function safeSend(mailer: Mailer, msgs: Array<{ to: string; subject: string; html: string }>) {
  await Promise.allSettled(msgs.map((m) => mailer.send(m)));
}
