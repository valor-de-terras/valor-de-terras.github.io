// Parser client-side de arquivos geográficos: KML, KMZ, SHP (zip), GeoJSON.
import { kml } from "@tmcw/togeojson";
import JSZip from "jszip";
import shp from "shpjs";
import type { Feature, FeatureCollection, Geometry } from "geojson";

export type ParsedGeo = FeatureCollection | Feature<Geometry>;

function parseKmlString(text: string): FeatureCollection {
  const dom = new DOMParser().parseFromString(text, "text/xml");
  const parserError = dom.querySelector("parsererror");
  if (parserError) throw new Error("KML inválido (XML malformado).");
  return kml(dom) as FeatureCollection;
}

function ensureFeatures(fc: ParsedGeo): ParsedGeo {
  if (fc.type === "FeatureCollection" && fc.features.length === 0)
    throw new Error("Nenhuma geometria encontrada no arquivo.");
  return fc;
}

export async function parseGeoFile(file: File): Promise<ParsedGeo> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    const obj = JSON.parse(await file.text());
    return ensureFeatures(obj as ParsedGeo);
  }

  if (name.endsWith(".kml")) {
    return ensureFeatures(parseKmlString(await file.text()));
  }

  if (name.endsWith(".kmz")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlEntry = Object.values(zip.files).find((f) =>
      f.name.toLowerCase().endsWith(".kml")
    );
    if (!kmlEntry) throw new Error("KMZ sem arquivo .kml interno.");
    return ensureFeatures(parseKmlString(await kmlEntry.async("text")));
  }

  if (name.endsWith(".zip") || name.endsWith(".shp")) {
    // shpjs aceita um zip (shp+dbf+shx) ou um .shp solto como ArrayBuffer
    const result = (await shp(await file.arrayBuffer())) as ParsedGeo;
    return ensureFeatures(result);
  }

  throw new Error(
    "Formato não suportado. Use KML, KMZ, SHP (.zip) ou GeoJSON."
  );
}

export const ACCEPTED_EXT = ".kml,.kmz,.zip,.shp,.geojson,.json";
