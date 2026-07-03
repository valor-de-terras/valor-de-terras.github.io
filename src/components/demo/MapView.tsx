import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type Map as MlMap,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { bbox } from "../../lib/geo";
import { wmsTiles, ufForCenter } from "../../lib/sicar";
import styles from "./MapView.module.css";

type ParsedGeo = FeatureCollection | Feature<Geometry>;

export interface CompMarker {
  lng: number;
  lat: number;
}

interface Props {
  parcel: ParsedGeo | null;
  comparables?: CompMarker[];
  enableClick?: boolean;
  carOverlay?: boolean;
  /** centro [lon, lat] do município escolhido, para dar zoom na região */
  carTarget?: [number, number] | null;
  onMapClick?: (lng: number, lat: number) => void;
}

const PARANA_CENTER: [number, number] = [-51.5, -24.9];
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    },
    esri: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    sicar: {
      type: "raster",
      tiles: [wmsTiles("pr")],
      tileSize: 512, // 512px = ~4x menos requisições ao GeoServer lento do SICAR
      attribution:
        'Imóveis CAR © <a href="https://www.car.gov.br/">SICAR</a> / SFB',
    },
    parcel: { type: "geojson", data: EMPTY },
    comparables: { type: "geojson", data: EMPTY },
  },
  layers: [
    { id: "carto", type: "raster", source: "carto", layout: { visibility: "visible" } },
    { id: "esri", type: "raster", source: "esri", layout: { visibility: "none" } },
    {
      id: "sicar",
      type: "raster",
      source: "sicar",
      minzoom: 9,
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.7, "raster-fade-duration": 0 },
    },
    {
      id: "parcel-fill",
      type: "fill",
      source: "parcel",
      paint: { "fill-color": "#1f7551", "fill-opacity": 0.22 },
    },
    {
      id: "parcel-line",
      type: "line",
      source: "parcel",
      paint: { "line-color": "#0b2e23", "line-width": 2.4, "line-opacity": 0.95 },
    },
    {
      id: "comp-circles",
      type: "circle",
      source: "comparables",
      paint: {
        "circle-radius": 6,
        "circle-color": "#c79a2e",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.6,
        "circle-opacity": 0.92,
      },
    },
  ],
};

export default function MapView({
  parcel,
  comparables,
  enableClick,
  carOverlay,
  carTarget,
  onMapClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const clickCbRef = useRef(onMapClick);
  const enableRef = useRef(enableClick);
  const ufRef = useRef("pr");
  const [basemap, setBasemap] = useState<"carto" | "esri">("carto");
  const [tilesLoading, setTilesLoading] = useState(false);

  clickCbRef.current = onMapClick;
  enableRef.current = enableClick;

  // init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: PARANA_CENTER,
      zoom: 6.2,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      readyRef.current = true;
    });
    // indicador de carregamento (tiles do SICAR são lentos): mostra enquanto há tiles pendentes
    const syncLoading = () => setTilesLoading(!map.areTilesLoaded());
    map.on("dataloading", syncLoading);
    map.on("data", syncLoading);
    map.on("idle", () => setTilesLoading(false));
    map.on("click", (e) => {
      if (enableRef.current && clickCbRef.current)
        clickCbRef.current(e.lngLat.lng, e.lngLat.lat);
    });
    // troca a camada CAR conforme a UF do centro do mapa
    map.on("moveend", () => {
      const c = map.getCenter();
      const uf = ufForCenter(c.lng, c.lat);
      if (uf !== ufRef.current) {
        ufRef.current = uf;
        const src = map.getSource("sicar") as { setTiles?: (t: string[]) => void } | undefined;
        src?.setTiles?.([wmsTiles(uf)]);
      }
    });
    mapRef.current = map;
    // Em mount lazy/Suspense (ex.: rota #/avaliar) o mapa pode ser criado antes do
    // container ter o tamanho final, e o MapLibre não pede os tiles até um resize.
    // ResizeObserver + resize no próximo frame garantem que os tiles pintem.
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    const raf = requestAnimationFrame(() => map.resize());
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // cursor por modo
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = enableClick ? "crosshair" : "";
  }, [enableClick]);

  // overlay CAR: mostra/esconde a camada do SICAR e aterrissa numa área com imóveis
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getLayer("sicar")) return;
      map.setLayoutProperty("sicar", "visibility", carOverlay ? "visible" : "none");
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [carOverlay]);

  // modo CAR: voa até o centro do município num zoom fixo e fechado. Evitar fitBounds na
  // bbox inteira (municípios grandes zoomam demais para fora e o WMS do SICAR fica lento).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !carTarget) return;
    const apply = () => map.flyTo({ center: carTarget, zoom: 12, duration: 1400, essential: true });
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [carTarget]);

  // basemap toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getLayer("carto")) return;
      map.setLayoutProperty("carto", "visibility", basemap === "carto" ? "visible" : "none");
      map.setLayoutProperty("esri", "visibility", basemap === "esri" ? "visible" : "none");
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [basemap]);

  // parcel
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("parcel") as GeoJSONSource | undefined;
      if (!src) return;
      src.setData((parcel ?? EMPTY) as FeatureCollection);
      if (parcel) {
        const [minX, minY, maxX, maxY] = bbox(parcel);
        map.fitBounds([[minX, minY], [maxX, maxY]], {
          padding: 70,
          maxZoom: 14.5,
          duration: 900,
        });
      }
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [parcel]);

  // comparables
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: (comparables ?? []).map((c) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      })),
    };
    const apply = () => {
      const src = map.getSource("comparables") as GeoJSONSource | undefined;
      if (src) src.setData(data);
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [comparables]);

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} aria-label="Mapa interativo do imóvel" />
      {carOverlay && tilesLoading && (
        <div className={styles.tilesBadge} role="status">
          <span className={styles.tilesSpin} /> carregando imóveis CAR…
        </div>
      )}
      <div className={styles.basemapToggle} role="group" aria-label="Tipo de mapa">
        <button
          type="button"
          className={basemap === "carto" ? styles.active : ""}
          onClick={() => setBasemap("carto")}
        >
          Mapa
        </button>
        <button
          type="button"
          className={basemap === "esri" ? styles.active : ""}
          onClick={() => setBasemap("esri")}
        >
          Satélite
        </button>
      </div>
    </div>
  );
}
