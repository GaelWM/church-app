import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../../env";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export type Files = AppEnv["Bindings"]["FILES"];

/** Reads the multipart "file" field and enforces presence, size and mime type. */
export async function readUploadedFile(c: Context<AppEnv>): Promise<File> {
  const form = await c.req.formData();
  const file = form.get("file") as unknown as File | string | null;
  if (!file || typeof file === "string") throw new HTTPException(400, { message: "Fichier manquant" });
  if (file.size > MAX_BYTES) throw new HTTPException(413, { message: "Fichier trop volumineux (8 Mo max)" });
  if (!ALLOWED.includes(file.type)) throw new HTTPException(415, { message: "Type de fichier non autorisé" });
  return file;
}

/** Streams an R2 object back as a private, cacheable file response (404 when missing). */
export async function fileResponse(files: Files, key: string): Promise<Response> {
  const obj = await files.get(key);
  if (!obj) throw new HTTPException(404);
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, max-age=3600" } });
}
