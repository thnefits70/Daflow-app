// Fotos del equipo en provedix.com (pedido del usuario 2026-10-16). El equipo
// sube fotos a la carpeta de Drive "FOTOS BODEGA PARA PAGINA"
// (1cYyiLK6aQF_mRENmWkqRsk1v-akCbY_R). Se revisan una por una y solo las
// mejores entran a TEAM_PHOTOS. La página muestra 6 (2 retratos + 4 del
// trabajo) y las cambia cada semana para que se vea viva.
//
// Nunca usar: guías con datos de clientes, etiquetas de proveedores o
// "MADE IN CHINA", nada que muestre la ubicación exacta (solo "Guayaquil,
// Ecuador"). Las fotos van en public/pvx/team/ a 720×960 webp y sin datos de
// la cámara (sharp los quita). Si el grupo crece mucho (más de ~14), se sacan
// las más flojas o repetidas.

export type TeamPhoto = { src: string; title: string; alt: string; kind: "portrait" | "work"; driveId: string };

export const TEAM_PHOTOS: TeamPhoto[] = [
  // Retratos
  { kind: "portrait", driveId: "1369ZcoHn8mqLWfeTCy9CCGWuPIX_V3hD", src: "/pvx/team/equipo-1.webp", title: "Gente real detrás de cada pedido", alt: "Colaborador de Provedix sonriendo en la bodega" },
  { kind: "portrait", driveId: "1PTMMlppolfr7s2HE6Pa741EePXrWVy8X", src: "/pvx/team/equipo-2.webp", title: "Listos para despachar contigo", alt: "Colaborador de Provedix con los brazos cruzados frente a las perchas" },
  { kind: "portrait", driveId: "1ve2sKkNa_uQ8a-olL_7L2DASq1saPOMu", src: "/pvx/team/equipo-3.webp", title: "Un equipo que te responde", alt: "Colaborador de Provedix frente a las perchas de la bodega" },
  { kind: "portrait", driveId: "11OzHoiA3sqHC2yVtGQcroHmemAjPk8y9", src: "/pvx/team/equipo-4.webp", title: "Cuidamos cada producto", alt: "Colaborador de Provedix en un pasillo de la bodega" },
  // Trabajo
  { kind: "work", driveId: "1ZcBtgg-ZMd5emLWjpD1v1toKz1Tk_8D2", src: "/pvx/team/preparando-pedido.webp", title: "Cada producto con su percha y su código", alt: "Colaborador tomando un producto de una percha con etiquetas QR" },
  { kind: "work", driveId: "1Enxp03Baf9dECHhmzRS8d9sZDseZAJMB", src: "/pvx/team/revisando-producto.webp", title: "Revisamos antes de empacar", alt: "Colaborador revisando la caja de un producto" },
  { kind: "work", driveId: "1GrgJilxPIlQEim2tPtM3tVOVr-5kQZXY", src: "/pvx/team/acomodando-cajas.webp", title: "Mercadería ordenada al llegar", alt: "Colaborador acomodando cajas de producto en la bodega" },
  { kind: "work", driveId: "1dWcz7dxAp9PKgs0UF9FnJIhpnk5o6yJr", src: "/pvx/team/buscando-en-percha.webp", title: "Pedidos listos para el corte", alt: "Colaborador buscando un producto en la percha" },
  { kind: "work", driveId: "1bCvTXY15QlkPbJtnUMi1-UjID6jOErlh", src: "/pvx/team/tomando-de-percha.webp", title: "Stock ubicado y a la mano", alt: "Colaborador tomando una caja de la percha" },
  { kind: "work", driveId: "13mqPgXrORdc_kPVP-D6zRBPxQ5WIWO8_", src: "/pvx/team/ordenando-percha.webp", title: "Perchas ordenadas todos los días", alt: "Colaborador ordenando productos en una percha alta" },
];

// Fotos de la carpeta ya revisadas que NO se usan (para no volver a revisarlas).
export const TEAM_PHOTOS_REJECTED: { driveId: string; reason: string }[] = [
  { driveId: "1jEUqL4nG1TybdGPr4YbrG4zVC49h_sPh", reason: "guía con datos de un cliente" },
  { driveId: "1QVSGLbDrkKM8Hl-ySd9rcMv4YwdcXhz3", reason: "caja MADE IN CHINA y etiqueta de proveedor" },
  { driveId: "10wGi8IuRV6pH_1vDFIB40hfnqP_JidHf", reason: "etiquetas de proveedor en los sacos" },
  { driveId: "105piXal3v9fyiW6vR1mxUNwM10fE92rh", reason: "casi igual a equipo-2" },
  { driveId: "1NB6r6oHg5yDlRRABI55gw4K8oSwyMQan", reason: "paquetes con guías de clientes" },
];

const SHOW_PORTRAITS = 2;
const SHOW_WORK = 4;

// Semana (Ecuador, UTC−5) contada desde un lunes fijo: cambia cada lunes.
function weekIndex(now: Date): number {
  const ec = now.getTime() - 5 * 3_600_000;
  return Math.floor((ec - Date.UTC(2026, 9, 12)) / (7 * 86_400_000));
}

function rotate<T>(list: T[], n: number, week: number): T[] {
  if (list.length <= n) return list;
  const start = (((week * n) % list.length) + list.length) % list.length;
  return Array.from({ length: n }, (_, i) => list[(start + i) % list.length]);
}

// Las 6 de esta semana: retrato, 4 del trabajo, retrato.
export function pickTeamPhotos(now: Date = new Date()): TeamPhoto[] {
  const week = weekIndex(now);
  const portraits = rotate(TEAM_PHOTOS.filter((p) => p.kind === "portrait"), SHOW_PORTRAITS, week);
  const work = rotate(TEAM_PHOTOS.filter((p) => p.kind === "work"), SHOW_WORK, week);
  return [portraits[0], ...work, portraits[1]].filter(Boolean);
}
