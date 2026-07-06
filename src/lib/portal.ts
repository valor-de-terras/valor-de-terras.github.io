// Camada de API do fluxo formal (laudo com ART): acompanhamento do solicitante e
// painel do engenheiro. Tudo passa pelas RPCs SECURITY DEFINER e edge functions;
// este módulo só mapeia entradas/saídas e nunca decide autorização no cliente.
import type { Feature, Geometry } from "geojson";
import { supabase } from "./supabase";

export type AppraisalStatusFull =
  | "DRAFT" | "GEOMETRY_VALIDATING" | "GEOMETRY_REJECTED" | "DATA_ENRICHING"
  | "ENRICHMENT_FAILED" | "ESTIMATING" | "ESTIMATE_DELIVERED" | "CANCELLED_BY_USER"
  | "TECHNICAL_REVIEW_QUEUED" | "TECHNICAL_REVIEW_IN_PROGRESS" | "NEEDS_MORE_INFO"
  | "ART_PENDING" | "REPORT_GENERATING" | "DELIVERED";

export interface ContactInput {
  name?: string;
  email?: string;
  phone?: string;
  purpose?: string;
}

export interface QueueItem {
  request_id: string;
  status: AppraisalStatusFull;
  purpose: string;
  created_at: string;
  municipality: string | null;
  uf: string | null;
  area_ha: number;
  car_code: string | null;
  technician_id: string | null;
  mine: boolean;
  contact_name: string | null;
  total_avg: number | null;
  grade: string | null;
}

export interface RequestBundle {
  request: Record<string, unknown> & { id: string; status: AppraisalStatusFull; purpose: string };
  property: {
    area_ha: number;
    perimeter_km: number;
    municipality: string | null;
    uf: string | null;
    car_code: string | null;
    origin: string | null;
    centroid: [number, number];
    geometry: Geometry;
  };
  estimate: Record<string, unknown> | null;
  comparables: Array<Record<string, unknown>>;
  enrichment: Array<{ key: string; source: string | null; payload: Record<string, unknown> }>;
  report: Record<string, unknown> | null;
  photos?: ReportPhoto[];
  field_visit?: FieldVisitData | null;
  technician: {
    full_name?: string | null;
    email?: string | null;
    crea_number?: string | null;
    uf?: string | null;
    specialty?: string | null;
    crea_valid_until?: string | null;
  } | null;
  audit: Array<{ action: string; from: string | null; to: string | null; at: string }>;
}

export interface SessionUser {
  id: string;
  email: string | null;
  role: "client" | "technician" | "admin";
  full_name: string | null;
}

// ── sessão / papel ───────────────────────────────────────────────────────────
export async function getSessionUser(): Promise<SessionUser | null> {
  const { data } = await supabase.auth.getSession();
  const sess = data.session;
  if (!sess || sess.user.is_anonymous) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", sess.user.id)
    .single();
  return {
    id: sess.user.id,
    email: sess.user.email ?? prof?.email ?? null,
    role: (prof?.role as SessionUser["role"]) ?? "client",
    full_name: prof?.full_name ?? null,
  };
}

export async function signInTech(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Envia o e-mail de recuperação de senha (self-service). Requer e-mail habilitado no Supabase. */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw error;
}

// ── solicitante ──────────────────────────────────────────────────────────────
export async function proceedToReview(requestId: string, c: ContactInput): Promise<void> {
  const { error } = await supabase.rpc("proceed_to_technical_review", {
    p_request_id: requestId,
    p_contact_name: c.name ?? null,
    p_contact_email: c.email ?? null,
    p_contact_phone: c.phone ?? null,
    p_purpose: c.purpose ?? null,
  });
  if (error) throw error;
}

export interface MyRequestItem {
  request_id: string;
  status: AppraisalStatusFull;
  created_at: string;
  municipality: string | null;
  uf: string | null;
  area_ha: number;
  total_avg: number | null;
  has_report: boolean;
  grade: string | null;
  art_number: string | null;
}

export async function getMyRequests(): Promise<MyRequestItem[]> {
  const { data, error } = await supabase.rpc("get_my_requests");
  if (error) throw error;
  return (data as MyRequestItem[]) ?? [];
}

// ── engenheiro ───────────────────────────────────────────────────────────────
export async function getQueue(): Promise<QueueItem[]> {
  const { data, error } = await supabase.rpc("get_technician_queue");
  if (error) throw error;
  return (data as QueueItem[]) ?? [];
}

export async function getBundle(requestId: string): Promise<RequestBundle> {
  const { data, error } = await supabase.rpc("get_request_bundle", { p_request_id: requestId });
  if (error) throw error;
  return data as RequestBundle;
}

export async function assignReview(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("assign_technical_review", { p_request_id: requestId });
  if (error) throw error;
}

export interface ReviewDraft {
  narrative?: string;
  grade?: string;
  finalPricePerHa?: number;
  finalTotal?: number;
}

export async function saveReview(requestId: string, d: ReviewDraft): Promise<void> {
  const { error } = await supabase.rpc("save_technical_review", {
    p_request_id: requestId,
    p_narrative: d.narrative ?? null,
    p_grade: d.grade ?? null,
    p_final_price_per_ha: d.finalPricePerHa ?? null,
    p_final_total: d.finalTotal ?? null,
  });
  if (error) throw error;
}

export async function uploadArtPdf(requestId: string, file: File): Promise<string> {
  const path = `${requestId}/art-${Date.now()}.pdf`;
  const { error } = await supabase.storage.from("art-pdfs").upload(path, file, {
    upsert: true,
    contentType: "application/pdf",
  });
  if (error) throw error;
  return path;
}

export interface ArtSubmit extends ReviewDraft {
  artNumber: string;
  artPdfPath?: string;
}

export async function submitArt(requestId: string, s: ArtSubmit): Promise<void> {
  const { error } = await supabase.rpc("submit_art_and_finish", {
    p_request_id: requestId,
    p_art_number: s.artNumber,
    p_narrative: s.narrative ?? null,
    p_art_pdf_path: s.artPdfPath ?? null,
    p_grade: s.grade ?? null,
    p_final_price_per_ha: s.finalPricePerHa ?? null,
    p_final_total: s.finalTotal ?? null,
  });
  if (error) throw error;
}

export async function generateReport(requestId: string): Promise<{ url: string | null; path: string }> {
  const { data, error } = await supabase.functions.invoke("generate-report", {
    body: { request_id: requestId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return { url: data.url ?? null, path: data.path };
}

export async function reportLink(requestId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("report-link", {
    body: { request_id: requestId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.url as string;
}

export interface ReportPhoto {
  id: string;
  path: string;
  caption: string | null;
  sort: number;
  lat: number | null;
  lon: number | null;
}

export interface Benfeitoria {
  tipo: string;
  descricao: string;
  area_m2: string;
  estado: string;
}
export interface FieldVisitData {
  visited_at?: string | null;
  area_confirmada?: boolean | null;
  area_observacao?: string | null;
  estado_conservacao?: string | null;
  uso_observado?: string | null;
  acesso_observado?: string | null;
  recursos_hidricos?: string | null;
  benfeitorias?: Benfeitoria[];
  ressalvas?: string | null;
}

/** Registra/atualiza a vistoria in loco (Frente F). */
export async function saveFieldVisit(requestId: string, data: FieldVisitData): Promise<void> {
  const { error } = await supabase.rpc("save_field_visit", {
    p_request_id: requestId,
    p_data: data,
  });
  if (error) throw error;
}

/** Reduz a imagem (máx. 1600px, JPEG q~0.82) no cliente antes de subir. */
async function downscaleImage(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível para processar a imagem");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) throw new Error("Falha ao processar a imagem");
  return blob;
}

/** Sobe uma foto do relatório fotográfico: reduz, grava no bucket e registra. */
export async function uploadReportPhoto(requestId: string, file: File, caption?: string): Promise<void> {
  const blob = await downscaleImage(file);
  const path = `${requestId}/${crypto.randomUUID()}.jpg`;
  const upErr = (await supabase.storage.from("report-photos").upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  })).error;
  if (upErr) throw upErr;
  const { error } = await supabase.rpc("register_report_photo", {
    p_request_id: requestId,
    p_storage_path: path,
    p_caption: caption?.trim() || null,
  });
  if (error) throw error;
}

export async function deleteReportPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_report_photo", { p_photo_id: photoId });
  if (error) throw error;
}

export async function photoSignedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("report-photos").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** Envia o PDF do laudo já assinado digitalmente (Gov.br/ICP-Brasil) do RT. */
export async function submitSignedReport(requestId: string, file: File): Promise<void> {
  const b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    r.readAsDataURL(file);
  });
  const { data, error } = await supabase.functions.invoke("submit-signed-report", {
    body: { request_id: requestId, pdf_base64: b64 },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}

export function geometryToFeature(g: Geometry | null): Feature<Geometry> | null {
  if (!g) return null;
  return { type: "Feature", properties: {}, geometry: g };
}

// ── admin: gestão da equipe técnica ──────────────────────────────────────────
export interface TechnicianRow {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  crea_number: string | null;
  uf: string | null;
  specialty: string | null;
  active: boolean;
  crea_active: boolean;
  crea_valid_until: string | null;
}

export interface NewTechnician {
  name: string;
  email: string;
  password: string;
  crea: string;
  uf: string;
  specialty?: string;
  valid_months?: number;
}

export async function adminListTechnicians(): Promise<TechnicianRow[]> {
  const { data, error } = await supabase.rpc("admin_list_technicians");
  if (error) throw error;
  return (data as TechnicianRow[]) ?? [];
}

export async function adminCreateTechnician(t: NewTechnician): Promise<{ created: boolean; email: string }> {
  const { data, error } = await supabase.functions.invoke("admin-create-technician", {
    body: {
      name: t.name, email: t.email, password: t.password,
      crea: t.crea, uf: t.uf, specialty: t.specialty ?? null,
      valid_months: t.valid_months ?? 12,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return { created: !!data.created, email: data.email };
}

export async function adminSetValidity(profileId: string, months: number): Promise<void> {
  const { error } = await supabase.rpc("admin_set_technician_validity", { p_profile_id: profileId, p_months: months });
  if (error) throw error;
}

export async function adminSetActive(profileId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc("admin_set_technician_active", { p_profile_id: profileId, p_active: active });
  if (error) throw error;
}

/** Admin redefine a senha temporária de um engenheiro (recuperação de acesso sem SMTP). */
export async function adminResetPassword(profileId: string, password: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("admin-reset-password", {
    body: { profile_id: profileId, password },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}

/** Troca a senha do usuário logado (útil para o engenheiro trocar a senha temporária). */
export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
