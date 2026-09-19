import type { Bindings } from "../env";
import type { Mailer } from "./mailer";

/** Dev auth is honoured only when explicitly enabled AND the app is served from localhost. */
export const devAuthEnabled = (env: Bindings) => env.DEV_AUTH === "1" && /^https?:\/\/localhost(:\d+)?/.test(env.APP_URL ?? "");

export const consoleMailer: Mailer = {
  async send(m) { console.log(`[mail] to=${m.to} subject="${m.subject}"`); },
};
