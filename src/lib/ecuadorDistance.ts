// Qué tan lejos queda una ciudad de Guayaquil (km por carretera, aproximado)
// — para elegir qué guías retener cuando falta stock (pedido de Daniel
// 2026-10-15, aprobado por el usuario 2026-10-16): se retienen las de las
// ciudades MÁS CERCANAS; las lejanas tienen prioridad para salir ese día.
// Sin dependencias de servidor (lo usa también la pantalla del corte).

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

// Capital o centro de cada provincia.
const PROVINCE_KM: [string, number][] = [
  ["GUAYAS", 40],
  ["LOS RIOS", 90],
  ["SANTA ELENA", 140],
  ["EL ORO", 190],
  ["MANABI", 190],
  ["AZUAY", 200],
  ["BOLIVAR", 220],
  ["CHIMBORAZO", 230],
  ["CANAR", 250],
  ["SANTO DOMINGO", 270],
  ["TUNGURAHUA", 290],
  ["COTOPAXI", 320],
  ["MORONA SANTIAGO", 340],
  ["PASTAZA", 390],
  ["LOJA", 410],
  ["PICHINCHA", 420],
  ["ESMERALDAS", 440],
  ["NAPO", 470],
  ["ZAMORA CHINCHIPE", 470],
  ["IMBABURA", 530],
  ["ORELLANA", 620],
  ["CARCHI", 650],
  ["SUCUMBIOS", 680],
  ["GALAPAGOS", 1200],
];

// Ciudades frecuentes en las guías (muchas vienen sin provincia).
const CITY_KM: Record<string, number> = {
  GUAYAQUIL: 0, DURAN: 10, SAMBORONDON: 15, "LA PUNTILLA": 15, DAULE: 40, "NOBOL": 35, "NARCISA DE JESUS": 35, MILAGRO: 45, "YAGUACHI": 30, "EL TRIUNFO": 70,
  "NARANJAL": 80, "PLAYAS": 95, "GENERAL VILLAMIL": 95, "BALZAR": 100, "EL EMPALME": 130, "PEDRO CARBO": 55, "LOMAS DE SARGENTILLO": 50, "NARANJITO": 55, "SALITRE": 45,
  BABAHOYO: 70, QUEVEDO: 175, VENTANAS: 110, VINCES: 95, "BUENA FE": 190, "VALENCIA": 200,
  "SANTA ELENA": 140, "LA LIBERTAD": 140, SALINAS: 145, "MONTANITA": 190,
  MACHALA: 190, "PASAJE": 185, "SANTA ROSA": 210, "HUAQUILLAS": 260, "EL GUABO": 170, "ARENILLAS": 230, "PINAS": 250, "ZARUMA": 270,
  PORTOVIEJO: 190, MANTA: 195, CHONE: 230, "JIPIJAPA": 140, "BAHIA DE CARAQUEZ": 260, "EL CARMEN": 280, "PEDERNALES": 330, "MONTECRISTI": 190, "JUNIN": 230, "CALCETA": 225,
  CUENCA: 200, "GUALACEO": 230, AZOGUES: 230, "LA TRONCAL": 120, "CANAR": 240,
  GUARANDA: 220, RIOBAMBA: 230, "ALAUSI": 180, AMBATO: 290, LATACUNGA: 320, "SALCEDO": 310, "BANOS": 330, "PELILEO": 305,
  "SANTO DOMINGO": 270, QUITO: 420, "SANGOLQUI": 430, "CONOCOTO": 425, "CUMBAYA": 435, "TUMBACO": 440, "CAYAMBE": 480, "MACHACHI": 390,
  ESMERALDAS: 440, "QUININDE": 360, IBARRA: 530, OTAVALO: 510, "ATUNTAQUI": 520, TULCAN: 650,
  LOJA: 410, "CATAMAYO": 400, "ZAMORA": 470, MACAS: 340, PUYO: 390, TENA: 470, "EL COCA": 620, COCA: 620, "FRANCISCO DE ORELLANA": 620, "LAGO AGRIO": 680, "NUEVA LOJA": 680, "SHUSHUFINDI": 700,
};
const CITY_KEYS = Object.keys(CITY_KM).map((k) => [norm(k), CITY_KM[k]] as const);

// km aproximados a Guayaquil; sin datos, en el medio (no se adelanta ni se atrasa).
export function kmFromGuayaquil(city: string | null | undefined, province: string | null | undefined): number {
  if (city) {
    const c = norm(city);
    const exact = CITY_KEYS.find(([k]) => k === c);
    if (exact) return exact[1];
  }
  if (province) {
    const p = norm(province);
    const hit = PROVINCE_KM.find(([k]) => p.startsWith(k));
    if (hit) return hit[1];
  }
  if (city) {
    const c = norm(city);
    const partial = CITY_KEYS.find(([k]) => k.length >= 5 && (c.startsWith(k) || c.includes(k)));
    if (partial) return partial[1];
  }
  return 300;
}
