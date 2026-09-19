import { expect, spyOn, test } from "bun:test";
import { cloudflareMailer, htmlToText, safeSend } from "./mailer";
import { invitation, rejected } from "@church/emails";

test("htmlToText keeps links and text readable", () => {
  const t = htmlToText(invitation({ fullName: "Marie <b>", link: "https://x.test/set?a=1&b=2", appUrl: "https://app.test" }).html);
  expect(t).toContain("Bienvenue");
  expect(t).toContain("Définir mon mot de passe (https://x.test/set?a=1&b=2)");
  expect(t).toContain("Marie <b>"); // escaped in the HTML, decoded in the text part
  expect(t.replace("Marie <b>", "")).not.toMatch(/<[a-z]/i); // no leftover markup
  expect(t).not.toContain("https://app.test (https://app.test)"); // no duplicated bare links
});

test("cloudflareMailer sends html + text from the configured sender", async () => {
  const calls: any[] = [];
  const env: any = { MAIL_FROM: "no-reply@church.test", EMAIL: { send: async (m: any) => { calls.push(m); return { messageId: "1" }; } } };
  const msg = rejected({ reference: "KIN01-2026-000001", reason: "Montant erroné", appUrl: "https://app.test" });
  await cloudflareMailer(env).send({ to: "a@b.test", ...msg });
  expect(calls[0]).toMatchObject({ from: "no-reply@church.test", to: "a@b.test", subject: msg.subject });
  expect(calls[0].text).toContain("Montant erroné");
});

test("safeSend never throws and logs the Cloudflare error code", async () => {
  const err = spyOn(console, "error").mockImplementation(() => {});
  const boom = Object.assign(new Error("sender not verified"), { code: "E_SENDER_NOT_VERIFIED" });
  await safeSend({ send: async () => { throw boom; } }, [{ to: "a@b.test", subject: "S", html: "<p>x</p>" }]);
  expect(err).toHaveBeenCalledTimes(1);
  expect(String(err.mock.calls[0]![0])).toContain("E_SENDER_NOT_VERIFIED");
  err.mockRestore();
});
