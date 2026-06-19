/// <reference types="vite/client" />

declare module "shpjs" {
  const shp: (input: ArrayBuffer | string) => Promise<unknown>;
  export default shp;
}
