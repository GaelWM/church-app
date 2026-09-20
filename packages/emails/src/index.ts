const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const layout = (title: string, body: string) =>
  `<!doctype html><html lang="fr"><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#222">
<h2 style="color:#1f3a5f">${esc(title)}</h2>${body}
<hr style="margin-top:32px;border:none;border-top:1px solid #ddd"><p style="color:#888;font-size:12px">Comptabilité de l'église</p></body></html>`;

export const invitation = (p: { fullName: string; link: string; appUrl: string }) => ({
  subject: "Votre accès à la comptabilité de l'église",
  html: layout("Bienvenue", `<p>Bonjour ${esc(p.fullName)},</p><p>Un compte a été créé pour vous. Définissez votre mot de passe :</p>
<p><a href="${esc(p.link)}">Définir mon mot de passe</a></p><p>Ensuite, connectez-vous sur <a href="${esc(p.appUrl)}">${esc(p.appUrl)}</a>.</p>`),
});

export const pendingDigest = (p: { parish: string; step: 1 | 2; count: number; appUrl: string }) => ({
  subject: `${p.count} écriture(s) en attente de ${p.step === 1 ? "première" : "seconde"} validation — ${p.parish}`,
  html: layout("Écritures à valider", `<p>${p.count} écriture(s) de <b>${esc(p.parish)}</b> attendent votre validation.</p><p><a href="${esc(p.appUrl)}">Ouvrir la boîte « À valider »</a></p>`),
});

export const rejected = (p: { reference: string; reason: string; appUrl: string }) => ({
  subject: `Écriture rejetée : ${p.reference}`,
  html: layout("Écriture rejetée", `<p>L'écriture <b>${esc(p.reference)}</b> a été rejetée.</p><p><i>Motif :</i> ${esc(p.reason)}</p><p><a href="${esc(p.appUrl)}">Corriger et soumettre à nouveau</a></p>`),
});

export const rateChanged = (p: { rate: string; effectiveFrom: string }) => ({
  subject: "Nouveau taux de change",
  html: layout("Taux de change modifié", `<p>1 USD = <b>${esc(p.rate)} CDF</b> à partir du ${esc(p.effectiveFrom)}.</p>`),
});

export const securityAlert = (p: { message: string }) => ({
  subject: "Alerte de sécurité",
  html: layout("Alerte de sécurité", `<p>${esc(p.message)}</p>`),
});

export const monthlyReport = (p: { parish: string; period: string; lines: Array<{ label: string; value: string }>; appUrl: string }) => ({
  subject: `Rapport mensuel ${p.period} — ${p.parish}`,
  html: layout(`Rapport ${p.period} — ${p.parish}`,
    `<table cellpadding="6" style="border-collapse:collapse">${p.lines.map((l) => `<tr><td>${esc(l.label)}</td><td style="text-align:right"><b>${esc(l.value)}</b></td></tr>`).join("")}</table>
<p><a href="${esc(p.appUrl)}">Ouvrir le tableau de bord</a></p>`),
});

export const negativeBalanceEmail = (p: { parish: string; accounts: Array<{ name: string; balance: string }>; threshold: string; appUrl: string }) => ({
  subject: `Alerte solde bas — ${p.parish}`,
  html: layout("Alerte solde bas", `<p>Des comptes de <b>${esc(p.parish)}</b> sont sous le seuil d'alerte (${esc(p.threshold)}) :</p>
<table cellpadding="6" style="border-collapse:collapse">${p.accounts.map((a) => `<tr><td>${esc(a.name)}</td><td style="text-align:right"><b>${esc(a.balance)}</b></td></tr>`).join("")}</table>
<p><a href="${esc(p.appUrl)}">Ouvrir la comptabilité</a></p>`),
});
