import { useEffect, useRef, useState } from "react";
import {
  uploadReportPhoto, deleteReportPhoto, photoSignedUrl, type ReportPhoto,
} from "../lib/portal";
import styles from "./portal.module.css";

interface Props {
  requestId: string;
  photos: ReportPhoto[];
  onChanged: () => Promise<void> | void;
}

export default function ReportPhotos({ requestId, photos, onChanged }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        photos.map(async (p) => [p.id, (await photoSignedUrl(p.path)) ?? ""] as const)
      );
      if (alive) setUrls(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
  }, [photos]);

  const onUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr("Selecione uma imagem.");
      return;
    }
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
      setErr("Envie uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setErr("Imagem muito grande (máx. 20 MB).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await uploadReportPhoto(requestId, file, caption);
      setCaption("");
      if (fileRef.current) fileRef.current.value = "";
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao enviar a foto.");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(true);
    setErr(null);
    try {
      await deleteReportPhoto(id);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao remover a foto.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.photoBox}>
      <div className={styles.sectionTitle}>Relatório fotográfico ({photos.length}/12)</div>
      <p className={styles.subtle}>
        Fotos nítidas da vistoria (exigência de instituições de crédito, NBR 14.653). Entram no PDF
        do laudo. As imagens são reduzidas automaticamente antes do envio.
      </p>

      {photos.length > 0 && (
        <div className={styles.photoGrid}>
          {photos.map((p) => (
            <div key={p.id} className={styles.photoCell}>
              {urls[p.id]
                ? <img src={urls[p.id]} alt={p.caption ?? "Foto da vistoria"} className={styles.photoImg} />
                : <div className={styles.photoImg} />}
              <span className={styles.photoCap}>{p.caption ?? "sem legenda"}</span>
              <button className={styles.photoDel} onClick={() => onDelete(p.id)} disabled={busy} title="Remover">✕</button>
            </div>
          ))}
        </div>
      )}

      {photos.length < 12 && (
        <div className={styles.photoAdd}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className={styles.fileInput} />
          <input
            className={styles.input}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Legenda (ex.: vista frontal da sede)"
            maxLength={80}
          />
          <button className="vt-btn" onClick={onUpload} disabled={busy}>
            {busy ? "Enviando…" : "Adicionar foto"}
          </button>
        </div>
      )}
      {err && <div className={styles.errMsg}>{err}</div>}
    </div>
  );
}
