import { useEffect, useState } from "react";
import {
  adminListTechnicians, adminCreateTechnician, adminSetValidity, adminSetActive,
  adminResetPassword, type TechnicianRow,
} from "../lib/portal";
import styles from "./portal.module.css";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

function genPassword(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ", b = "abcdefghijkmnpqrstuvwxyz", n = "23456789", s = "!@#$%&*";
  const pick = (set: string, k: number) => Array.from({ length: k }, () => set[Math.floor(Math.random() * set.length)]).join("");
  return pick(a, 2) + pick(b, 4) + pick(n, 3) + pick(s, 1);
}

function isExpired(d: string | null): boolean {
  if (!d) return true;
  return new Date(d + "T00:00:00") < new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
}

export default function AdminTeam() {
  const [rows, setRows] = useState<TechnicianRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(genPassword());
  const [crea, setCrea] = useState("");
  const [uf, setUf] = useState("PR");
  const [specialty, setSpecialty] = useState("Eng. Florestal");
  const [months, setMonths] = useState(12);

  const load = async () => {
    setErr(null);
    try { setRows(await adminListTechnicians()); }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha ao carregar a equipe."); }
  };
  useEffect(() => { void load(); }, []);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); if (ok) setMsg(ok); }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha na operação."); }
    finally { setBusy(false); }
  };

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setErr("A senha temporária precisa de ao menos 8 caracteres."); return; }
    void run(async () => {
      const r = await adminCreateTechnician({ name, email, password, crea, uf, specialty, valid_months: months });
      setMsg(`${r.created ? "Conta criada" : "Conta já existia, promovida"}: ${r.email}. Senha temporária: ${password} (compartilhe com segurança e peça a troca no primeiro acesso).`);
      setName(""); setEmail(""); setCrea(""); setPassword(genPassword());
      await load();
    });
  };

  const onRenew = (id: string) => run(async () => { await adminSetValidity(id, 12); await load(); }, "Validade do CREA renovada por 12 meses.");
  const onToggle = (id: string, active: boolean) => run(async () => { await adminSetActive(id, !active); await load(); });
  const onReset = (id: string, name: string | null) => run(async () => {
    const temp = genPassword();
    await adminResetPassword(id, temp);
    setMsg(`Senha de ${name ?? "engenheiro"} redefinida. Nova senha temporária: ${temp} (compartilhe com segurança; peça a troca no primeiro acesso).`);
  });

  return (
    <div>
      <div className={styles.head}>
        <div>
          <h1 className={styles.h1}>Equipe técnica</h1>
          <p className={styles.subtle}>Cadastre engenheiros habilitados e mantenha a validade do CREA em dia.</p>
        </div>
      </div>

      {/* Cadastro */}
      <div className={styles.card2}>
        <div className={styles.sectionTitle}>Cadastrar engenheiro</div>
        <form onSubmit={onCreate}>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label}>Nome completo</label>
              <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>E-mail</label>
              <input className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </div>

          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label}>Senha temporária</label>
              <div className={styles.fileRow}>
                <input className={styles.input} value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="vt-btn vt-btn-ghost" onClick={() => setPassword(genPassword())}>Gerar</button>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Modalidade</label>
              <select className={styles.select} value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
                <option>Eng. Florestal</option>
                <option>Eng. Agrônomo</option>
                <option>Outra (agrária)</option>
              </select>
            </div>
          </div>

          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label}>CREA</label>
              <input className={styles.input} value={crea} onChange={(e) => setCrea(e.target.value)} placeholder="Ex.: PR-12345/D" required />
            </div>
            <div className={styles.row2}>
              <div className={styles.field}>
                <label className={styles.label}>UF</label>
                <select className={styles.select} value={uf} onChange={(e) => setUf(e.target.value)}>
                  {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Validade (meses)</label>
                <input className={styles.input} type="number" min="1" max="24" value={months} onChange={(e) => setMonths(Number(e.target.value))} />
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            <button type="submit" className="vt-btn vt-btn-primary" disabled={busy}>
              {busy ? "Cadastrando…" : "Cadastrar engenheiro"}
            </button>
          </div>
          <p className={styles.hint}>
            A conta é criada já confirmada; o engenheiro entra em /#/portal com o e-mail e a senha
            temporária e pode trocá-la em "Trocar senha". A ART só é emitida com CREA dentro da validade.
          </p>
        </form>
        {msg && <div className={styles.okMsg}>{msg}</div>}
        {err && <div className={styles.errMsg}>{err}</div>}
      </div>

      {/* Lista */}
      <div className={styles.card2}>
        <div className={styles.sectionTitle}>Engenheiros cadastrados ({rows?.length ?? 0})</div>
        {rows && rows.length === 0 && <p className={styles.subtle}>Nenhum engenheiro cadastrado ainda.</p>}
        {rows && rows.length > 0 && (
          <table className={styles.miniTable}>
            <thead>
              <tr><th>Nome</th><th>CREA</th><th>Validade</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const expired = isExpired(t.crea_valid_until);
                const emitOk = t.active && t.crea_active && !expired;
                return (
                  <tr key={t.profile_id}>
                    <td>
                      <div><strong>{t.full_name ?? "—"}</strong></div>
                      <div className={styles.subtle}>{t.email} · {t.specialty ?? "—"}</div>
                    </td>
                    <td className={styles.mono}>{t.crea_number}{t.uf ? `/${t.uf}` : ""}</td>
                    <td>
                      <span className={`${styles.badge} ${expired ? styles.stQueued : styles.stProgress}`}>
                        {t.crea_valid_until ?? "—"}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${emitOk ? styles.stDelivered : styles.stOther}`}>
                        {emitOk ? "Apto" : t.active ? "CREA vencido" : "Inativo"}
                      </span>
                    </td>
                    <td className={styles.num}>
                      <div className={styles.fileRow} style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="vt-btn vt-btn-ghost" onClick={() => onRenew(t.profile_id)} disabled={busy}>Renovar 12m</button>
                        <button className="vt-btn vt-btn-ghost" onClick={() => onReset(t.profile_id, t.full_name)} disabled={busy}>Resetar senha</button>
                        <button className="vt-btn vt-btn-ghost" onClick={() => onToggle(t.profile_id, t.active)} disabled={busy}>
                          {t.active ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
