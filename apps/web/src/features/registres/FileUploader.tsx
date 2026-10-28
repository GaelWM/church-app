import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/common";
import { useApi } from "../../core/api";
import { useScopedKey } from "../../core/queries";

export interface RecordFile { id: string; filename: string; contentType: string | null; createdAt: string }
export const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
export const MAX_MB = 8;
export const checkFile = (f: File) =>
  !ACCEPT.split(",").includes(f.type) ? "Type non autorisé (JPEG, PNG, WebP ou PDF)" : f.size > MAX_MB * 1024 * 1024 ? `Fichier trop volumineux (${MAX_MB} Mo max)` : null;

/**
 * Files attached to one record: upload (photo / scan), view, download, delete. Defaults to a register entry;
 * `listPath` / `filePath` point it at another module's endpoints (e.g. the files of a fixed asset).
 * `canDelete` (default `canWrite`): a submitted baptême / mariage still takes new files but keeps the ones it has.
 */
export function FileUploader({ type, recordId, label, canWrite, canDelete = canWrite, listPath, filePath }: {
  type: string; recordId: string; label: string; canWrite: boolean; canDelete?: boolean; listPath?: string; filePath?: string;
}) {
  const list = listPath ?? `/registres/${type}/${recordId}/files`;
  const item = filePath ?? "/registres/files";
  const api = useApi();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const key = useScopedKey("registre-files", type, recordId);
  const files = useQuery({ queryKey: key, queryFn: () => api.get<RecordFile[]>(list) });
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: [key[0], "registre", type] }); };
  const up = useMutation({
    mutationFn: async (f: File) => { const e = checkFile(f); if (e) throw new Error(e); return api.upload(list, f); },
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`${item}/${id}`), onSuccess: refresh });
  const open = async (f: RecordFile, download: boolean) => {
    const url = await api.fileUrl(`${item}/${f.id}${download ? "?download=1" : ""}`);
    if (!download) { window.open(url, "_blank"); return; }
    const a = document.createElement("a"); a.href = url; a.download = f.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <div className="col-span-full space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {canWrite && (
          <>
            <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} />
            <Button type="button" size="sm" variant="outline" disabled={up.isPending} onClick={() => input.current?.click()}><Upload />{up.isPending ? "Envoi…" : "Téléverser"}</Button>
          </>
        )}
      </div>
      <ErrorNote error={up.error ?? del.error} />
      {files.data?.length ? (
        <ul className="space-y-1 text-sm">
          {files.data.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{f.filename}</span>
              <span className="actions shrink-0">
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Voir" onClick={() => open(f, false)}><Eye /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Télécharger" onClick={() => open(f, true)}><Download /></Button>
                {canDelete && <Button type="button" size="icon-sm" variant="ghost" aria-label="Supprimer le fichier" onClick={() => confirm(`Supprimer « ${f.filename} » ?`) && del.mutate(f.id)}><Trash2 /></Button>}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="muted text-sm">{files.isLoading ? "Chargement…" : "Aucun fichier"}</p>}
      <p className="muted text-xs">JPEG, PNG, WebP ou PDF, {MAX_MB} Mo max.</p>
    </div>
  );
}
