import { useCallback, useEffect, useRef, useState } from "react";
import MapView from "./MapView";
import EnrichmentTimeline from "./EnrichmentTimeline";
import EstimateCard from "./EstimateCard";
import ReportPreview from "./ReportPreview";
import { ACCEPTED_EXT, parseGeoFile, type ParsedGeo } from "../../lib/parseGeo";
import { areaHa } from "../../lib/geo";
import { fetchCarAtPoint, municipioBasePrice } from "../../lib/sicar";
import {
  ENRICHMENT_LAYERS,
  SAMPLE_PARCELS,
  computeEstimate,
  type SampleParcel,
} from "../../data/demo";
import type { Comparable, EstimateResult } from "../../types";
import { fmtArea } from "../../lib/format";
import styles from "./MapDemo.module.css";

type Mode = "sample" | "car" | "upload";
type Status = "empty" | "ready" | "enriching" | "done";

interface Meta {
  name: string;
  municipality: string;
  uf: string;
  carCode: string;
  basePricePerHa: number;
}

const STEP_MS = 540;

export default function MapDemo() {
  const [mode, setMode] = useState<Mode>("sample");
  const [parcel, setParcel] = useState<ParsedGeo | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [status, setStatus] = useState<Status>("empty");
  const [activeLayers, setActiveLayers] = useState(0);
  const [result, setResult] = useState<{
    area: number;
    centroid: [number, number];
    estimate: EstimateResult;
    comparables: Comparable[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [carLoading, setCarLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const carAbortRef = useRef<AbortController | null>(null);

  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  const reset = useCallback(() => {
    clearTimers();
    carAbortRef.current?.abort();
    carAbortRef.current = null;
    setCarLoading(false);
    setParcel(null);
    setMeta(null);
    setStatus("empty");
    setActiveLayers(0);
    setResult(null);
    setError(null);
  }, []);

  const adoptParcel = useCallback((feature: ParsedGeo, m: Meta) => {
    clearTimers();
    setError(null);
    setResult(null);
    setActiveLayers(0);
    setParcel(feature);
    setMeta(m);
    setStatus("ready");
  }, []);

  const pickSample = (s: SampleParcel) => {
    adoptParcel(s.feature, {
      name: s.name,
      municipality: s.municipality,
      uf: s.uf,
      carCode: s.carCode,
      basePricePerHa: s.basePricePerHa,
    });
  };

  const onMapClick = useCallback(
    async (lng: number, lat: number) => {
      if (mode !== "car") return;
      carAbortRef.current?.abort();
      const ctrl = new AbortController();
      carAbortRef.current = ctrl;
      setError(null);
      setCarLoading(true);
      try {
        const hit = await fetchCarAtPoint(lng, lat, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (!hit) {
          setError(
            "Nenhum imóvel CAR neste ponto. Aproxime o zoom e clique sobre um imóvel (polígono cinza)."
          );
          return;
        }
        adoptParcel(hit.feature, {
          name:
            hit.municipio && hit.municipio !== "—"
              ? `Imóvel CAR em ${hit.municipio}`
              : "Imóvel CAR selecionado",
          municipality: hit.municipio,
          uf: hit.uf,
          carCode: hit.codImovel,
          basePricePerHa: municipioBasePrice(hit.municipio, hit.uf),
        });
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          setError("Falha ao consultar o SICAR. Verifique a conexão e tente novamente.");
        }
      } finally {
        if (carAbortRef.current === ctrl) {
          setCarLoading(false);
          carAbortRef.current = null;
        }
      }
    },
    [mode, adoptParcel]
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      try {
        const geo = await parseGeoFile(file);
        const ha = areaHa(geo);
        if (ha <= 0) {
          setError("Não foi possível medir a área — verifique se o arquivo contém polígonos.");
          return;
        }
        adoptParcel(geo, {
          name: file.name.replace(/\.[^.]+$/, ""),
          municipality: "Importado do arquivo",
          uf: "—",
          carCode: "—",
          basePricePerHa: 74000,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao ler o arquivo.");
      }
    },
    [adoptParcel]
  );

  const runPipeline = () => {
    if (!parcel || !meta || status === "enriching") return;
    clearTimers();
    setStatus("enriching");
    setActiveLayers(0);
    ENRICHMENT_LAYERS.forEach((_, i) => {
      const t = window.setTimeout(() => setActiveLayers(i + 1), STEP_MS * (i + 1));
      timersRef.current.push(t);
    });
    const finalT = window.setTimeout(() => {
      const r = computeEstimate(parcel, meta.basePricePerHa, ENRICHMENT_LAYERS);
      setResult(r);
      setStatus("done");
    }, STEP_MS * (ENRICHMENT_LAYERS.length + 1));
    timersRef.current.push(finalT);
  };

  useEffect(() => () => clearTimers(), []);

  const compMarkers =
    result && status === "done"
      ? result.comparables.map((c, i) => {
          const ang = (i / result.comparables.length) * Math.PI * 2;
          const dDeg = c.distanceKm / 111;
          return {
            lng: result.centroid[0] + Math.cos(ang) * dDeg,
            lat: result.centroid[1] + Math.sin(ang) * dDeg,
          };
        })
      : [];

  return (
    <div className={styles.shell}>
      <div className={styles.grid}>
        {/* Coluna esquerda: controles */}
        <div className={styles.panel}>
          <div className={styles.modeTabs} role="tablist" aria-label="Como informar o imóvel">
            <button
              role="tab"
              aria-selected={mode === "sample"}
              className={mode === "sample" ? styles.tabActive : styles.tab}
              onClick={() => setMode("sample")}
            >
              Imóvel exemplo
            </button>
            <button
              role="tab"
              aria-selected={mode === "car"}
              className={mode === "car" ? styles.tabActive : styles.tab}
              onClick={() => setMode("car")}
            >
              Selecionar CAR
            </button>
            <button
              role="tab"
              aria-selected={mode === "upload"}
              className={mode === "upload" ? styles.tabActive : styles.tab}
              onClick={() => setMode("upload")}
            >
              Enviar arquivo
            </button>
          </div>

          <div className={styles.modeBody}>
            {mode === "sample" && (
              <div className={styles.samples}>
                <p className={styles.hint}>
                  Selecione um imóvel de exemplo no Paraná para simular a avaliação.
                </p>
                {SAMPLE_PARCELS.map((s) => (
                  <button
                    key={s.id}
                    className={
                      meta?.carCode === s.carCode ? styles.sampleActive : styles.sample
                    }
                    onClick={() => pickSample(s)}
                  >
                    <span className={styles.sampleName}>{s.name}</span>
                    <span className={styles.sampleMeta}>
                      {s.municipality}/{s.uf} · {fmtArea(areaHa(s.feature))}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {mode === "car" && (
              <div className={styles.hint}>
                <p>
                  <strong>Clique sobre um imóvel no mapa.</strong> O sistema consulta o
                  SICAR e seleciona o <strong>CAR real</strong> sobreposto ao ponto, com
                  geometria e atributos oficiais (município, área, código do imóvel).
                </p>
                <p className={styles.carNote}>
                  Aproxime o zoom até ver os imóveis (polígonos cinza) e clique em um deles.
                  Fonte: SICAR / Serviço Florestal Brasileiro.
                </p>
                {carLoading && (
                  <p className={styles.carLoading}>
                    <span className={styles.carSpin} /> consultando o SICAR…
                  </p>
                )}
              </div>
            )}

            {mode === "upload" && (
              <div
                className={dragOver ? styles.dropActive : styles.drop}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void handleFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_EXT}
                  className={styles.fileInput}
                  onChange={(e) => void handleFiles(e.target.files)}
                />
                <div className={styles.dropGlyph}>⬆</div>
                <p className={styles.dropTitle}>Arraste ou clique para enviar</p>
                <p className={styles.dropSub}>KML · KMZ · SHP (.zip) · GeoJSON</p>
              </div>
            )}

            {error && <p className={styles.error}>{error}</p>}
          </div>

          {meta && (
            <div className={styles.summary}>
              <div className={styles.summaryRow}>
                <span>Imóvel</span>
                <strong>{meta.name}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Localização</span>
                <strong>
                  {meta.municipality}
                  {meta.uf !== "—" ? `/${meta.uf}` : ""}
                </strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Área medida</span>
                <strong>{parcel ? fmtArea(areaHa(parcel)) : "—"}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>CAR</span>
                <strong className={styles.mono}>{meta.carCode}</strong>
              </div>
            </div>
          )}

          {status === "ready" && (
            <button className={`vt-btn vt-btn-primary ${styles.cta}`} onClick={runPipeline}>
              Rodar enriquecimento e estimar →
            </button>
          )}
          {(status === "enriching" || status === "done") && (
            <button className={`vt-btn vt-btn-ghost ${styles.cta}`} onClick={reset}>
              Recomeçar
            </button>
          )}
        </div>

        {/* Coluna direita: mapa + resultados */}
        <div className={styles.stage}>
          <div className={styles.mapBox}>
            <MapView
              parcel={parcel}
              comparables={compMarkers}
              enableClick={mode === "car"}
              carOverlay={mode === "car"}
              onMapClick={onMapClick}
            />
            {!parcel && (
              <div className={styles.mapHint}>
                {mode === "car"
                  ? carLoading
                    ? "Consultando o SICAR…"
                    : "Clique sobre um imóvel (CAR) no mapa"
                  : "Escolha um imóvel para visualizar"}
              </div>
            )}
          </div>

          {(status === "enriching" || status === "done") && (
            <EnrichmentTimeline
              layers={ENRICHMENT_LAYERS}
              activeCount={activeLayers}
              done={status === "done"}
            />
          )}

          {status === "done" && result && meta && (
            <EstimateCard
              result={result.estimate}
              comparables={result.comparables}
              area={result.area}
              onOpenReport={() => setReportOpen(true)}
            />
          )}
        </div>
      </div>

      {reportOpen && result && meta && (
        <ReportPreview
          onClose={() => setReportOpen(false)}
          meta={meta}
          area={result.area}
          centroid={result.centroid}
          estimate={result.estimate}
          comparables={result.comparables}
          layers={ENRICHMENT_LAYERS}
        />
      )}
    </div>
  );
}
