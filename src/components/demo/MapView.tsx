import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type Map as MlMap,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { bbox } from "../../lib/geo";
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
    parcel: { type: "geojson", data: EMPTY },
    comparables: { type: "geojson", data: EMPTY },
  },
  layers: [
    { id: "carto", type: "raster", source: "carto", layout: { visibility: "visible" } },
    { id: "esri", type: "raster", source: "esri", layout: { visibility: "none" } },
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

export default function MapView({ parcel, comparables, enableClick, onMapClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const clickCbRef = useRef(onMapClick);
  const enableRef = useRef(enableClick);
  const [basemap, setBasemap] = useState<"carto" | "esri">("carto");

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
    map.on("click", (e) => {
      if (enableRef.current && clickCbRef.current)
        clickCbRef.current(e.lngLat.lng, e.lngLat.lat);
    });
    mapRef.current = map;
    return () => {
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
