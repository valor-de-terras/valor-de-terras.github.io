// Helpers geométricos client-side (sem dependências pesadas).
// Área geodésica pelo algoritmo esférico (mesma fórmula do @turf/area).

import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

const EARTH_R = 6378137; // metros
const toRad = (d: number) => (d * Math.PI) / 180;

function ringAreaM2(ring: Position[]): number {
  const len = ring.length;
  if (len < 3) return 0;
  let area = 0;
  for (let i = 0; i < len; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % len];
    area += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((area * EARTH_R * EARTH_R) / 2);
}

function haversineKm(a: Position, b: Position): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return (2 * EARTH_R * Math.asin(Math.sqrt(h))) / 1000;
}

/** Extrai todos os anéis de polígono de uma geometria. */
function collectPolygons(geom: Geometry): Position[][] {
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  if (geom.type === "GeometryCollection")
    return geom.geometries.flatMap(collectPolygons);
  return [];
}

export function firstGeometry(
  input: Feature<Geometry> | FeatureCollection
): Geometry | null {
  if (input.type === "Feature") return input.geometry;
  if (input.type === "FeatureCollection") {
    const f = input.features.find((x) => x.geometry);
    return f ? f.geometry : null;
  }
  return null;
}

export function areaHa(input: Feature<Geometry> | FeatureCollection): number {
  const geom = firstGeometry(input);
  if (!geom) return 0;
  const rings = collectPolygons(geom);
  if (!rings.length) return 0;
  // anel externo positivo, buracos subtraídos (aproximação: primeiro anel externo)
  let m2 = 0;
  // para Polygon: ring[0] externo, demais buracos
  if (geom.type === "Polygon") {
    m2 = ringAreaM2(geom.coordinates[0]);
    for (let i = 1; i < geom.coordinates.length; i++)
      m2 -= ringAreaM2(geom.coordinates[i]);
  } else {
    m2 = rings.reduce((acc, r) => acc + ringAreaM2(r), 0);
  }
  return Math.max(0, m2 / 10000);
}

export function perimeterKm(input: Feature<Geometry> | FeatureCollection): number {
  const geom = firstGeometry(input);
  if (!geom) return 0;
  const rings = collectPolygons(geom);
  let km = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) km += haversineKm(ring[i], ring[i + 1]);
  }
  return km;
}

export function centroid(
  input: Feature<Geometry> | FeatureCollection
): [number, number] {
  const geom = firstGeometry(input);
  if (!geom) return [-51.5, -24.8];
  const rings = collectPolygons(geom);
  const ring = rings[0];
  if (!ring || ring.length < 3) {
    // fallback: média de todos os vértices
    const pts = rings.flat();
    if (!pts.length) return [-51.5, -24.8];
    const sx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const sy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return [sx, sy];
  }
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    twiceArea += f;
    x += (x0 + x1) * f;
    y += (y0 + y1) * f;
  }
  if (twiceArea === 0) {
    const sx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
    const sy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    return [sx, sy];
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

export function bbox(
  input: Feature<Geometry> | FeatureCollection
): [number, number, number, number] {
  const geom = firstGeometry(input);
  if (!geom) return [-54, -27, -48, -22];
  const pts = collectPolygons(geom).flat();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return [-54, -27, -48, -22];
  return [minX, minY, maxX, maxY];
}
