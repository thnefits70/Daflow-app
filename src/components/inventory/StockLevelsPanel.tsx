"use client";

import { useEffect, useState } from "react";
import { Search, ArrowUpDown, Info, X, Wrench, Check, ClipboardCheck } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { TabGuide } from "@/components/shared/TabGuide";
import { ExpandableName } from "@/components/ui/ExpandableName";
import { formatDateTime } from "@/lib/formatDateTime";

type PendingAdjustmentRow = {
  id: string;
  catalogItemId: string;
  name: string;
  justCode: string | null;
  currentQuantityAtRequest: number;
  currentQuantityNow: number;
  requestedQuantity: number;
  reason: string;
  requestedByName: string | null;
  requestedAt: string;
};

// Confirmado 2026-09-16, pedido explícito del usuario: los combos de Dropi
// (DropiCombo) no son productos reales — no tienen ni deben tener su propio
// stock. Se muestran acá aparte, solo como referencia (código/nombre +
// productos reales que traen), y el stock de CADA producto que lo compone
// se saca cruzando por catalogItemId contra la misma lista de arriba —
// nunca se inventa un stock para el combo en sí.
// Confirmado 2026-09-16, pedido explícito del usuario: a qué marca
// (Provedix/Importadora Damián/Importadora Shanghai) pertenece cada
// producto/combo — llamado "marca" acá en el frontend (no "bodega") para no
// confundirlo con el costo "Puesto en bodega" que ya existe en esta misma
// pantalla; en el backend el campo se llama `bodega` (mismo enum que ya
// usa Análisis de Mercado).
type Marca = "MKT_DAMIAN" | "MKT_PROVEDIX" | "MKT_SHANGHAI" | "MKT_SUMINISTROS";
const MARCA_LABELS: Record<Marca, string> = {
  MKT_PROVEDIX: "Provedix",
  MKT_DAMIAN: "Importadora Damián",
  MKT_SHANGHAI: "Importadora Shanghai",
  MKT_SUMINISTROS: "Suministros",
};

type ComboRow = {
  id: string;
  code: string;
  label: string | null;
  bodega: Marca | null;
  components: { id: string; quantity: number; catalogItem: { id: string; name: string; justCode: string | null } }[];
  providerPrice: number | null;
  bodegaPrice: number | null;
  benistockPrice: number | null;
  b2bPriceDefault: number | null;
  dropiPrice: number | null;
  b2cPrice1Unit: number | null;
  b2cPrice2to11: number | null;
  costSource?: "proposal" | "kardex" | null;
};

type StockRow = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  photos: string[];
  balance: number;
  avgCost: number;
  bodega: Marca | null;
  costSource?: "proposal" | "kardex" | null;
  providerPrice?: number;
  bodegaPrice?: number;
  benistockPrice?: number;
  b2bPriceDefault?: number;
  dropiPrice?: number;
  b2cPrice1Unit?: number;
  b2cPrice2to11?: number;
  pendingAdjustmentQuantity?: number | null;
};
type SortKey = "name" | "balance" | "proveedor" | "bodega" | "benistock" | "b2b" | "dropi" | "b2c1" | "b2c2";
// Confirmado 2026-09-21, pedido explícito del usuario: además de ordenar
// por nombre/stock, poder ordenar de mayor a menor por cualquier columna de
// costo o precio de venta (ej. "puesto en bodega") — se guarda solo el
// valor numérico de cada fila para esa columna, sin marca (los sin marca
// siguen apareciendo arriba, igual que antes).
function priceForSort(r: StockRow, key: SortKey): number {
  switch (key) {
    case "proveedor":
      return r.providerPrice ?? -1;
    case "bodega":
      return r.bodegaPrice ?? -1;
    case "benistock":
      return r.benistockPrice ?? -1;
    case "b2b":
      return r.b2bPriceDefault ?? -1;
    case "dropi":
      return r.dropiPrice ?? -1;
    case "b2c1":
      return r.b2cPrice1Unit ?? -1;
    case "b2c2":
      return r.b2cPrice2to11 ?? -1;
    default:
      return 0;
  }
}
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Nombre (A-Z)" },
  { key: "balance", label: "Stock (menor a mayor)" },
  { key: "bodega", label: "Puesto en bodega (mayor a menor)" },
  { key: "proveedor", label: "Proveedor (mayor a menor)" },
  { key: "benistock", label: "Benistock (mayor a menor)" },
  { key: "b2b", label: "B2B (mayor a menor)" },
  { key: "dropi", label: "Dropi (mayor a menor)" },
  { key: "b2c1", label: "B2C 1 un. (mayor a menor)" },
  { key: "b2c2", label: "B2C 2-11 un. (mayor a menor)" },
];
// Confirmado 2026-09-16, pedido explícito del usuario: poder ver solo los
// productos reales, solo los combos, o ambos juntos, con un clic.
type ViewMode = "all" | "products" | "combos";
type FormulaKey = "stock" | "proveedor" | "bodega" | "benistock" | "b2b" | "dropi" | "b2c1" | "b2c2";

function money(v: number) {
  return "$" + v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Confirmado 2026-09-16, pedido explícito del usuario: poder copiar
// cualquier precio con un clic, sin agregar íconos ni botones nuevos que
// ensucien la tabla — clic sobre el número mismo, y por un instante se
// convierte en un "✓" antes de volver a mostrar el precio.
function CopyableAmount({ value, className, title }: { value: number | null | undefined; className: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  if (value == null) return <span className={className}>—</span>;
  return (
    <span
      className={`${className} cursor-pointer hover:underline`}
      title={title ? `${title} · Clic para copiar` : "Clic para copiar"}
      onClick={() => {
        navigator.clipboard?.writeText(money(value)).catch(() => null);
        setCopied(true);
        setTimeout(() => setCopied(false), 900);
      }}
    >
      {copied ? "✓" : money(value)}
    </span>
  );
}

// Confirmado 2026-09-21, pedido explícito del usuario (admin): desbloqueo
// rápido para un producto que ya se movió en INVESTOCK pero cuyo costo
// sigue en $0 (sale "Sin precio") — declara a mano el costo real para
// poder cotizar hoy mismo. Exclusivo del admin, a propósito: es una decisión
// financiera, no un dato operativo del día a día. Queda registrado en el
// Kardex como su propio tipo de línea (COST_DECLARATION, ver
// declareManualCost en stockKardex.ts), nunca se confunde con una compra
// real — el botón desaparece solo cuando entre la compra real de verdad.
function DeclareCostButton({ catalogItemId, onDeclared }: { catalogItemId: string; onDeclared: () => void }) {
  const [editing, setEditing] = useState(false);
  // Confirmado 2026-09-21, pedido explícito del usuario: el costo del
  // proveedor NUNCA trae el flete, así que se separan los dos campos para
  // que quede claro qué es cada uno, y el total (lo que de verdad se
  // declara) sale de sumarlos.
  const [productCost, setProductCost] = useState("");
  const [freightCost, setFreightCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const total = (Number(productCost) || 0) + (Number(freightCost) || 0);

  async function save() {
    if (!total || total <= 0) {
      setError("Ingresa un costo de producto mayor a 0.");
      return;
    }
    const breakdown = freightCost.trim() ? `\n\nCosto producto: $${(Number(productCost) || 0).toFixed(2)} + flete estimado: $${(Number(freightCost) || 0).toFixed(2)}` : "";
    if (!window.confirm(`¿Declarar $${total.toFixed(2)} como costo estimado puesto en bodega de este producto?${breakdown}\n\nNo es una compra real — queda marcado así en el historial, y se reemplaza solo cuando se cargue la compra real en Control de Compras.`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/inventory-control/catalog-items/${catalogItemId}/declare-cost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declaredCost: total }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo declarar el costo.");
      setEditing(false);
      onDeclared();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo declarar el costo.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        title="Declarar costo estimado — no es una compra real, se reemplaza cuando entre la compra real."
        className="text-[9.5px] font-bold uppercase text-gold hover:underline cursor-pointer shrink-0"
        onClick={() => setEditing(true)}
      >
        Declarar costo
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="number"
          step="0.01"
          min="0.01"
          disabled={busy}
          title="Costo del producto (sin flete) — el del proveedor"
          placeholder="Producto"
          className="w-16 rounded border border-teal bg-cloud px-1 py-0.5 text-[11px] font-mono disabled:opacity-60"
          value={productCost}
          onChange={(e) => setProductCost(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <span className="text-steel text-[10px]">+</span>
        <input
          type="number"
          step="0.01"
          min="0"
          disabled={busy}
          title="Flete estimado por unidad (opcional) — para que el total se acerque al costo real puesto en bodega"
          placeholder="Flete"
          className="w-14 rounded border border-rule bg-cloud px-1 py-0.5 text-[11px] font-mono disabled:opacity-60"
          value={freightCost}
          onChange={(e) => setFreightCost(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button type="button" disabled={busy} title="Guardar" className="text-teal cursor-pointer disabled:opacity-50" onClick={save}>
          <Check size={12} />
        </button>
        <button type="button" disabled={busy} title="Cancelar" className="text-steel hover:text-red cursor-pointer disabled:opacity-50" onClick={() => setEditing(false)}>
          <X size={12} />
        </button>
      </div>
      <span className="text-[9.5px] text-steel">Total puesto en bodega: <span className="font-mono font-bold text-ink">${total.toFixed(2)}</span></span>
      {error && <span className="text-red text-[9.5px]">{error}</span>}
    </div>
  );
}

// Confirmado 2026-09-22, pedido explícito del usuario (admin): única forma
// de "escribir" el stock a mano en INVESTOCK, a propósito muy controlada —
// nace de un conteo físico real. El admin aplica el ajuste directo; Daniel
// (canEdit sin ser admin) solo deja una solicitud pendiente que el admin
// tiene que aprobar aparte (bandeja arriba de la tabla) — nunca mueve el
// stock él mismo, para que esto no se vuelva un botón de uso diario.
function StockAdjustmentTrigger({
  catalogItemId,
  currentBalance,
  isAdmin,
  pendingQuantity,
  onChanged,
}: {
  catalogItemId: string;
  currentBalance: number;
  isAdmin: boolean;
  pendingQuantity: number | null | undefined;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(String(currentBalance));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (pendingQuantity != null) {
    return (
      <span className="text-[9.5px] font-bold uppercase text-gold shrink-0" title="Esperando que el admin apruebe o rechace este ajuste.">
        Pendiente: {pendingQuantity}
      </span>
    );
  }

  async function submit() {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      setError("La cantidad debe ser un número entero, 0 o mayor.");
      return;
    }
    if (!reason.trim()) {
      setError("Escribe el motivo.");
      return;
    }
    const confirmMsg = isAdmin
      ? `¿Aplicar de una vez el ajuste? Stock pasa de ${currentBalance} a ${qty}.`
      : `¿Enviar la solicitud a Andrés? Stock actual: ${currentBalance}, contaste: ${qty}. No se aplica hasta que la apruebe.`;
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/inventory-control/catalog-items/${catalogItemId}/physical-count-adjustment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedQuantity: qty, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo procesar el ajuste.");
      setOpen(false);
      setReason("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar el ajuste.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        title="Ajustar el stock por un conteo físico real"
        className="text-[9.5px] font-bold uppercase text-steel hover:text-ink cursor-pointer shrink-0"
        onClick={() => {
          setQuantity(String(currentBalance));
          setOpen(true);
        }}
      >
        Ajustar (conteo)
      </button>
    );
  }

  // Apilado verticalmente (no en fila) a propósito — la columna de Stock
  // solo tiene 90px, y dos inputs uno al lado del otro no caben ahí sin
  // desbordarse encima de la columna vecina (mismo ancho que ya usa
  // "Declarar costo" en la columna de Proveedor, 100px).
  return (
    <div className="flex flex-col items-end gap-1 shrink-0 w-full">
      <input
        autoFocus
        type="number"
        step="1"
        min="0"
        disabled={busy}
        title="Cantidad real que contaste"
        placeholder="Cantidad"
        className="w-full rounded border border-teal bg-cloud px-1 py-0.5 text-[11px] font-mono disabled:opacity-60"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <input
        type="text"
        disabled={busy}
        placeholder="Motivo"
        className="w-full rounded border border-rule bg-cloud px-1 py-0.5 text-[10px]"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={busy} title="Confirmar" className="text-teal cursor-pointer disabled:opacity-50" onClick={submit}>
          <Check size={12} />
        </button>
        <button type="button" disabled={busy} title="Cancelar" className="text-steel hover:text-red cursor-pointer disabled:opacity-50" onClick={() => setOpen(false)}>
          <X size={12} />
        </button>
      </div>
      {error && <span className="text-red text-[9px] text-right">{error}</span>}
    </div>
  );
}

// Confirmado 2026-09-16, pedido explícito del usuario: elegir/corregir la
// marca de cada producto o combo directamente acá — editable solo en esta
// pantalla, que ya es exclusiva de Daniel/admin (canManageJustCatalog), no
// desde "Base de datos de productos".
// Ampliado 2026-09-22, pedido explícito del usuario: Bryan (Análisis de
// Mercado) ve esta misma pantalla en modo solo lectura — la marca se
// muestra como texto plano en vez de un select editable.
function MarcaSelect({ value, onChange, readOnly = false }: { value: Marca | null; onChange: (v: Marca | null) => void; readOnly?: boolean }) {
  if (readOnly) {
    return <span className="w-full text-[11px] text-steel truncate">{value ? MARCA_LABELS[value] : "— Sin marca —"}</span>;
  }
  return (
    <select
      className="w-full text-[11px] rounded border border-rule bg-transparent px-1 py-1 cursor-pointer text-steel"
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as Marca | null)}
    >
      <option value="">— Sin marca —</option>
      {(Object.keys(MARCA_LABELS) as Marca[]).map((k) => (
        <option key={k} value={k}>
          {MARCA_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

// Confirmado 2026-09-16, bug real reportado por el usuario: buscar "Máquina
// Anti Ronquidos" (con tilde) no encontraba nada porque el nombre real en el
// catálogo está sin tilde ("Maquina") — la búsqueda comparaba texto exacto,
// sin ignorar acentos. Mismo criterio ya usado en otras búsquedas de la app
// (ej. PurchasePriceExplorer.tsx).
function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Confirmado 2026-09-16, pedido explícito del usuario: buscar "Afeitadora
// Snar 3 en 1" no encontraba "Afeitadora 2 en 1" porque exigía el texto
// completo tal cual, incluyendo palabras que el usuario recordaba mal. Mismo
// criterio de "palabras significativas" ya usado en justCatalog.ts
// (findSimilarUnlinkedItem) — se ignoran palabras de relleno/números
// sueltos, y basta con que UNA palabra clave real coincida para aparecer en
// la lista (ordenado por cuántas palabras coinciden, para que el mejor
// resultado salga primero).
const SEARCH_STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "con", "para", "por", "en", "a", "al", "tipo"]);
function significantWords(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !SEARCH_STOPWORDS.has(w));
}

// Confirmado 2026-09-15, pedido explícito del usuario: quiere ver, con un
// clic, exactamente qué fórmula se está calculando en cada columna de
// precio — mismas fórmulas ya usadas en src/lib/marketProduct.ts
// (computeBenistockPrice/computeB2BPrice/computeB2CPrice), explicadas en
// palabras simples, no en código.
const FORMULA_EXPLANATIONS: Record<FormulaKey, { title: string; text: string }> = {
  stock: {
    title: "Stock",
    text: "El saldo real de INVESTOCK (el Kardex propio de DAFLOW) en este momento — se calcula solo, sumando lo que ha entrado en Compras y restando lo que ha salido en Egresos. Se actualiza automáticamente, sin que nadie tenga que subir ningún archivo.",
  },
  proveedor: {
    title: "Precio proveedor",
    text: "Lo que cobra el proveedor por una unidad, tal cual — sin sumarle flete ni nada más. Es el mismo costo real que ya usa el Kardex de INVESTOCK (el promedio ponderado de todas las compras).",
  },
  bodega: {
    title: "Puesto en bodega",
    text: "Precio proveedor + la parte del flete del lote que le toca a esa unidad. Para productos que nunca pasaron por la calculadora de Análisis de Mercado no se conoce el flete por separado todavía, así que este número sale igual al precio proveedor.",
  },
  benistock: {
    title: "Benistock",
    text: "Costo puesto en bodega (proveedor + flete por unidad) × 1.06 (6% de seguro) + fulfillment ($0.75 para productos normales, $0.50 para productos pequeños — el valor que Jariel le puso a cada producto en Análisis de Mercado; si un producto todavía no pasó por ahí, se asume $0.75). Es el costo real, sin ninguna ganancia — solo de referencia.",
  },
  b2b: {
    title: "B2B",
    text: "Costo puesto en bodega × 1.06 (6% de seguro) ÷ (1 − 20%). El 20% es el margen de ganancia por defecto para venta al por mayor.",
  },
  dropi: {
    title: "Precio Dropi",
    text: "Puesto en bodega × 1.06 (6% de seguro) + fulfillment, ÷ (1 − margen). Es el precio que usa Jariel para decidir si le conviene comprar un producto — 20% de margen por defecto, salvo que el producto ya tenga uno propio calculado en Análisis de Mercado.",
  },
  b2c1: {
    title: "B2C · 1 unidad",
    text: "Costo puesto en bodega × 1.06 (6% de seguro) + fulfillment ($0.75 para productos normales, $0.50 para productos pequeños — el valor que Jariel le puso a cada producto en Análisis de Mercado; si un producto todavía no pasó por ahí, se asume $0.75), ÷ (1 − 40%) + $7.50 (flete promedio), redondeado hacia arriba a .99. El 40% es el margen cuando se vende 1 sola unidad. El fulfillment lleva margen encima (igual que el resto del costo); el flete promedio no.",
  },
  b2c2: {
    title: "B2C · 2 a 11 unidades",
    text: "Igual que B2C de 1 unidad, pero con 30% de margen en vez de 40% — el margen baja cuando se venden de 2 a 11 unidades en la misma venta. De 12 en adelante ya no es B2C.",
  },
};

function FormulaInfoButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="inline-flex items-center cursor-pointer text-steel hover:text-ink" title="Ver cómo se calcula" onClick={onToggle}>
      <Info size={11} className={open ? "text-blue" : undefined} />
    </button>
  );
}

// Confirmado 2026-09-10 (pedido explícito del usuario): pantalla propia
// dentro de Inventario para que Daniel y el admin vean, en cualquier
// momento, el stock de INVESTOCK de todos los productos — no solo los
// negativos (ya cubiertos en KPIs financieros) ni solo lo de la última
// semana subida (Control de Inventario).
export function StockLevelsPanel({ isAdmin = false, canEdit = true }: { isAdmin?: boolean; canEdit?: boolean }) {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  // Confirmado 2026-09-21, pedido explícito del usuario: filtro de un clic
  // para ver solo los productos/combos de una marca de bodega en concreto
  // (Provedix, Importadora Damián o Importadora Shanghai) — clic de nuevo
  // sobre la misma marca lo quita y vuelve a mostrar todas.
  const [marcaFilter, setMarcaFilter] = useState<Marca | null>(null);
  const [openFormula, setOpenFormula] = useState<FormulaKey | null>(null);
  // Confirmado 2026-09-21, pedido explícito del usuario: ver de un clic qué
  // productos del catálogo (todo lo que ya está registrado en INVESTOCK) se
  // quedaron sin ningún precio real (ni propuesta de Jariel, ni costo de
  // Kardex) o sin stock — mismo patrón de chip que
  // el filtro de marca, independiente y combinable con él.
  const [sinPrecioFilter, setSinPrecioFilter] = useState(false);
  const [sinStockFilter, setSinStockFilter] = useState(false);

  // Confirmado 2026-09-22, pedido explícito del usuario (admin): bandeja
  // para aprobar/rechazar las solicitudes de ajuste de stock que Daniel
  // dejó pendientes (StockAdjustmentTrigger, por fila) — exclusiva del
  // admin, cada solicitud se decide una por una, no hay "aprobar todas".
  const [pendingAdjustmentsOpen, setPendingAdjustmentsOpen] = useState(false);
  const [pendingAdjustmentsLoading, setPendingAdjustmentsLoading] = useState(false);
  const [pendingAdjustments, setPendingAdjustments] = useState<PendingAdjustmentRow[] | null>(null);
  const [pendingAdjustmentsError, setPendingAdjustmentsError] = useState("");
  const [reviewingAdjustmentId, setReviewingAdjustmentId] = useState<string | null>(null);

  const [combos, setCombos] = useState<ComboRow[]>([]);
  function loadRows() {
    fetch("/api/inventory-control/stock-levels")
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data) => setRows(data.rows))
      .catch(() => setRows([]));
  }

  async function updateProductMarca(catalogItemId: string, bodega: Marca | null) {
    const prevRows = rows;
    setRows((r) => (r ? r.map((row) => (row.catalogItemId === catalogItemId ? { ...row, bodega } : row)) : r));
    const res = await fetch(`/api/merchandise-reentry/catalog-items/${catalogItemId}/bodega`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodega }),
    });
    if (!res.ok) setRows(prevRows);
  }

  async function updateComboMarca(comboId: string, bodega: Marca | null) {
    const prevCombos = combos;
    setCombos((c) => c.map((combo) => (combo.id === comboId ? { ...combo, bodega } : combo)));
    const res = await fetch(`/api/dropi-combos/${comboId}/bodega`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodega }),
    });
    if (!res.ok) setCombos(prevCombos);
  }

  useEffect(() => {
    loadRows();
    fetch("/api/dropi-combos")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCombos)
      .catch(() => setCombos([]));
    // Confirmado 2026-09-22: carga el conteo de solicitudes pendientes en
    // segundo plano para que el número aparezca en el título del bloque
    // sin que el admin tenga que abrirlo primero.
    if (isAdmin) loadPendingAdjustments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadPendingAdjustments() {
    setPendingAdjustmentsLoading(true);
    setPendingAdjustmentsError("");
    fetch("/api/inventory-control/physical-count-adjustments")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPendingAdjustments)
      .catch(() => setPendingAdjustmentsError("No se pudo cargar la lista."))
      .finally(() => setPendingAdjustmentsLoading(false));
  }

  async function reviewAdjustment(id: string, action: "approve" | "reject") {
    setReviewingAdjustmentId(id);
    const res = await fetch(`/api/inventory-control/physical-count-adjustments/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setReviewingAdjustmentId(null);
    if (!res.ok) {
      setPendingAdjustmentsError("No se pudo procesar la solicitud.");
      return;
    }
    loadPendingAdjustments();
    loadRows();
  }

  if (rows === null) return <div className="text-steel text-[13px]">Cargando…</div>;

  const marcaFilteredRows = rows
    .filter((r) => !marcaFilter || r.bodega === marcaFilter)
    .filter((r) => !sinPrecioFilter || r.providerPrice === undefined)
    .filter((r) => !sinStockFilter || r.balance === 0);
  const marcaFilteredCombosBase = marcaFilter ? combos.filter((c) => c.bodega === marcaFilter) : combos;

  const queryTrimmed = query.trim();
  const queryWords = queryTrimmed ? significantWords(queryTrimmed) : [];
  const filtered = !queryTrimmed
    ? marcaFilteredRows
    : marcaFilteredRows
        .map((r) => {
          const nameNorm = normalize(r.name);
          const directMatch = nameNorm.includes(normalize(queryTrimmed)) || (r.justCode ?? "").toLowerCase().includes(queryTrimmed.toLowerCase());
          const matchCount = queryWords.filter((w) => nameNorm.includes(w)).length;
          return { row: r, directMatch, matchCount };
        })
        .filter((x) => x.directMatch || x.matchCount > 0)
        .sort((a, b) => Number(b.directMatch) - Number(a.directMatch) || b.matchCount - a.matchCount)
        .map((x) => x.row);

  // Mientras hay una búsqueda activa, se ordena por qué tan buena es la
  // coincidencia (arriba) — el toggle de orden manual solo aplica sin buscar.
  // Confirmado 2026-09-16, pedido explícito de Daniel: para etiquetar la
  // marca rápido, lo sin etiquetar (bodega=null) siempre queda arriba y lo
  // ya etiquetado se va para abajo — así un producto nuevo que se registre
  // (sin marca todavía por defecto) también aparece arriba solo, sin tener
  // que acordarse de buscarlo.
  // Confirmado 2026-09-16, pedido explícito del usuario: el mismo
  // buscador (código o nombre, palabras clave) también filtra los combos —
  // y debe encontrar un combo tanto por su propio código/nombre COMO por
  // cualquier producto real que trae adentro (ej. buscar "138397" debe
  // encontrar el combo que tiene ese producto como componente, no solo
  // combos cuyo propio código empiece con eso).
  const filteredCombos = !queryTrimmed
    ? marcaFilteredCombosBase
    : marcaFilteredCombosBase
        .map((c) => {
          const ownNameNorm = normalize(c.label ?? "");
          const ownDirectMatch = ownNameNorm.includes(normalize(queryTrimmed)) || c.code.toLowerCase().includes(queryTrimmed.toLowerCase());
          const ownMatchCount = queryWords.filter((w) => ownNameNorm.includes(w)).length;

          const componentHits = c.components.map((comp) => {
            const compNameNorm = normalize(comp.catalogItem.name);
            const compDirectMatch =
              compNameNorm.includes(normalize(queryTrimmed)) || (comp.catalogItem.justCode ?? "").toLowerCase().includes(queryTrimmed.toLowerCase());
            const compMatchCount = queryWords.filter((w) => compNameNorm.includes(w)).length;
            return { directMatch: compDirectMatch, matchCount: compMatchCount };
          });

          const directMatch = ownDirectMatch || componentHits.some((h) => h.directMatch);
          const matchCount = ownMatchCount + componentHits.reduce((acc, h) => acc + h.matchCount, 0);
          return { combo: c, directMatch, matchCount };
        })
        .filter((x) => x.directMatch || x.matchCount > 0)
        .sort((a, b) => Number(b.directMatch) - Number(a.directMatch) || b.matchCount - a.matchCount)
        .map((x) => x.combo);

  const sorted = queryTrimmed
    ? filtered
    : [...filtered].sort((a, b) => {
        const untaggedDiff = Number(a.bodega != null) - Number(b.bodega != null);
        if (untaggedDiff !== 0) return untaggedDiff;
        if (sortKey === "name") return a.name.localeCompare(b.name);
        if (sortKey === "balance") return a.balance - b.balance;
        return priceForSort(b, sortKey) - priceForSort(a, sortKey);
      });

  // Confirmado 2026-09-16, pedido explícito del usuario: avisar cuántos
  // productos (IDs sueltos, no combos) siguen sin marca — sobre el total
  // real (`rows`), no sobre `sorted`, para que el número no cambie solo por
  // estar buscando.
  const unmarkedCount = rows.filter((r) => r.bodega == null).length;
  // Confirmado 2026-09-21: mismos totales para los chips de abajo — sobre el
  // catálogo completo (`rows`), no sobre `sorted`, mismo criterio que
  // unmarkedCount de arriba.
  const sinPrecioCount = rows.filter((r) => r.providerPrice === undefined).length;
  const sinStockCount = rows.filter((r) => r.balance === 0).length;

  // Confirmado 2026-09-16, bug real reportado por el usuario: este
  // encabezado solo vivía en la sección de productos — al elegir "Solo
  // combos" (que oculta esa sección) el encabezado desaparecía con ella.
  // Se extrae acá para reusarlo también arriba de los combos.
  const columnsHeader = (
    <>
      <div className="grid grid-cols-[auto_minmax(200px,1fr)_110px_90px_100px_110px_110px_100px_100px_110px_110px] gap-3 px-3 pt-2 min-w-[1380px]">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
        <span className="col-span-3 text-center text-[10px] font-bold uppercase tracking-wide text-steel border-b border-rule pb-1">Costo</span>
        <span className="col-span-4 text-center text-[10px] font-bold uppercase tracking-wide text-blue border-b border-rule pb-1">Precios de venta</span>
      </div>
      <div className="grid grid-cols-[auto_minmax(200px,1fr)_110px_90px_100px_110px_110px_100px_100px_110px_110px] gap-3 px-3 py-2 bg-cloud text-[11px] font-semibold uppercase tracking-wide text-steel min-w-[1380px]">
        <span></span>
        <span>Producto</span>
        <span>Marca</span>
        <span className="flex items-center justify-end gap-1">
          Stock INVESTOCK <FormulaInfoButton open={openFormula === "stock"} onToggle={() => setOpenFormula((k) => (k === "stock" ? null : "stock"))} />
        </span>
        <span className="flex items-center justify-end gap-1 border-l border-rule pl-3">
          Proveedor <FormulaInfoButton open={openFormula === "proveedor"} onToggle={() => setOpenFormula((k) => (k === "proveedor" ? null : "proveedor"))} />
        </span>
        <span className="flex items-center justify-end gap-1">
          Puesto en bodega <FormulaInfoButton open={openFormula === "bodega"} onToggle={() => setOpenFormula((k) => (k === "bodega" ? null : "bodega"))} />
        </span>
        <span className="flex items-center justify-end gap-1">
          Benistock <FormulaInfoButton open={openFormula === "benistock"} onToggle={() => setOpenFormula((k) => (k === "benistock" ? null : "benistock"))} />
        </span>
        <span className="flex items-center justify-end gap-1 border-l border-rule pl-3 text-teal">
          B2B <FormulaInfoButton open={openFormula === "b2b"} onToggle={() => setOpenFormula((k) => (k === "b2b" ? null : "b2b"))} />
        </span>
        <span className="flex items-center justify-end gap-1">
          Dropi <FormulaInfoButton open={openFormula === "dropi"} onToggle={() => setOpenFormula((k) => (k === "dropi" ? null : "dropi"))} />
        </span>
        <span className="flex items-center justify-end gap-1 text-blue">
          B2C 1 un. <FormulaInfoButton open={openFormula === "b2c1"} onToggle={() => setOpenFormula((k) => (k === "b2c1" ? null : "b2c1"))} />
        </span>
        <span className="flex items-center justify-end gap-1 text-blue">
          B2C 2-11 un. <FormulaInfoButton open={openFormula === "b2c2"} onToggle={() => setOpenFormula((k) => (k === "b2c2" ? null : "b2c2"))} />
        </span>
      </div>
      {openFormula && (
        <div className="flex items-start justify-between gap-3 bg-inset border-b border-rule px-3 py-2.5 min-w-[1380px]">
          <div className="text-[12px]">
            <span className="font-bold text-ink">{FORMULA_EXPLANATIONS[openFormula].title}: </span>
            <span className="text-steel">{FORMULA_EXPLANATIONS[openFormula].text}</span>
          </div>
          <button type="button" className="shrink-0 text-steel hover:text-ink cursor-pointer" onClick={() => setOpenFormula(null)}>
            <X size={13} />
          </button>
        </div>
      )}
    </>
  );

  return (
    <div>
      <TabGuide storageKey="stock-actual">
        Acá ves el saldo de INVESTOCK (el Kardex propio de DAFLOW) de cada producto del catálogo, calculado en tiempo real a partir de lo recibido en Compras y lo despachado en Egresos — sin depender de que alguien suba un archivo. Un saldo en rojo significa stock negativo (algo salió sin haber entrado, o hay un error de conteo por revisar).
      </TabGuide>

      {isAdmin && (
        <div className="border border-gold rounded-md mb-3">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-gold hover:text-gold cursor-pointer"
            onClick={() => {
              setPendingAdjustmentsOpen((v) => !v);
              if (!pendingAdjustmentsOpen && pendingAdjustments === null) loadPendingAdjustments();
            }}
          >
            <ClipboardCheck size={13} /> Solicitudes de ajuste de stock por conteo físico
            {pendingAdjustments && pendingAdjustments.length > 0 && ` (${pendingAdjustments.length})`}
          </button>
          {pendingAdjustmentsOpen && (
            <div className="px-3 pb-3 text-[12px]">
              <p className="text-steel mb-2">
                Daniel encontró un conteo físico que no coincide con INVESTOCK y pidió ajustarlo — revisa cada uno y decide. Nada se mueve hasta que apruebes.
              </p>
              {pendingAdjustmentsError && <div className="text-red mb-2">{pendingAdjustmentsError}</div>}
              {pendingAdjustmentsLoading && <div className="text-steel">Cargando…</div>}
              {!pendingAdjustmentsLoading && pendingAdjustments && (
                <>
                  {pendingAdjustments.length === 0 ? (
                    <div className="text-steel">No hay solicitudes pendientes.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {pendingAdjustments.map((a) => (
                        <div key={a.id} className="border border-rule rounded-md p-2.5">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[12.5px] font-semibold flex items-center gap-1.5">
                              <CatalogCode code={a.justCode} size="text-[10px]" /> {a.name}
                            </span>
                            <span className="font-mono text-[12px] text-steel shrink-0">
                              {a.currentQuantityNow} → <span className="font-bold text-gold">{a.requestedQuantity}</span>
                            </span>
                          </div>
                          <div className="text-[11px] text-steel mb-1.5">
                            &quot;{a.reason}&quot; — pedido por {a.requestedByName ?? "—"} el {formatDateTime(a.requestedAt)}
                            {a.currentQuantityNow !== a.currentQuantityAtRequest && (
                              <span className="text-gold"> (el saldo cambió desde que pidió: tenía {a.currentQuantityAtRequest} en ese momento)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={reviewingAdjustmentId === a.id}
                              className="rounded border border-teal bg-teal px-2.5 py-1 text-[11px] font-bold text-navy cursor-pointer disabled:opacity-50"
                              onClick={() => reviewAdjustment(a.id, "approve")}
                            >
                              {reviewingAdjustmentId === a.id ? "…" : "Aprobar"}
                            </button>
                            <button
                              type="button"
                              disabled={reviewingAdjustmentId === a.id}
                              className="rounded border border-red px-2.5 py-1 text-[11px] font-bold text-red cursor-pointer disabled:opacity-50"
                              onClick={() => reviewAdjustment(a.id, "reject")}
                            >
                              Rechazar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 mb-3">
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer border ${viewMode === "all" ? "bg-teal border-teal text-navy" : "border-rule text-steel hover:text-ink"}`}
          onClick={() => setViewMode("all")}
        >
          Todo
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer border ${viewMode === "products" ? "bg-teal border-teal text-navy" : "border-rule text-steel hover:text-ink"}`}
          onClick={() => setViewMode("products")}
        >
          Solo productos
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer border ${viewMode === "combos" ? "bg-teal border-teal text-navy" : "border-rule text-steel hover:text-ink"}`}
          onClick={() => setViewMode("combos")}
        >
          Solo combos
        </button>
      </div>

      {/* Confirmado 2026-09-21, pedido explícito del usuario: filtro de un
          clic por marca de bodega (Provedix / Importadora Damián /
          Importadora Shanghai), separado de los botones de Todo/productos/
          combos de arriba porque son dos filtros independientes que se
          pueden combinar entre sí. */}
      <div className="flex items-center gap-1.5 mb-3">
        {(Object.keys(MARCA_LABELS) as Marca[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer border ${marcaFilter === m ? "bg-blue border-blue text-navy" : "border-rule text-steel hover:text-ink"}`}
            onClick={() => setMarcaFilter((v) => (v === m ? null : m))}
          >
            {MARCA_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Confirmado 2026-09-21, pedido explícito del usuario: chips de alerta
          para ver de un clic qué productos del catálogo (todo lo que ya está
          registrado en INVESTOCK) se quedaron sin precio o sin stock —
          combinables entre sí y con marca/búsqueda, mismo patrón que los
          chips de marca de arriba. */}
      {viewMode !== "combos" && (sinPrecioCount > 0 || sinStockCount > 0) && (
        <div className="flex items-center gap-1.5 mb-3">
          {sinPrecioCount > 0 && (
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer border ${sinPrecioFilter ? "bg-red border-red text-navy" : "border-rule text-red hover:text-red"}`}
              onClick={() => setSinPrecioFilter((v) => !v)}
              title="Productos sin ninguna base de costo real: ni propuesta de Análisis de Mercado, ni compra en INVESTOCK."
            >
              Sin precio · {sinPrecioCount}
            </button>
          )}
          {sinStockCount > 0 && (
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer border ${sinStockFilter ? "bg-gold border-gold text-navy" : "border-rule text-gold hover:text-gold"}`}
              onClick={() => setSinStockFilter((v) => !v)}
              title="Productos con 0 de stock en INVESTOCK ahora mismo."
            >
              Sin stock · {sinStockCount}
            </button>
          )}
        </div>
      )}

      {/* Confirmado 2026-09-16, pedido explícito del usuario: el buscador
          debe funcionar igual en "Solo combos" (por código o nombre del
          combo) — antes vivía solo dentro del bloque de productos, así que
          desaparecía junto con la tabla al elegir esa vista. */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-1 rounded border border-rule px-2.5 py-1.5">
          <Search size={13} className="text-steel" />
          <input
            className="flex-1 text-[13px] outline-none bg-transparent"
            placeholder="Buscar producto o código…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {viewMode !== "combos" && (
          <label className="flex items-center gap-1.5 rounded border border-rule px-2.5 py-1.5 text-[12px] font-semibold cursor-pointer whitespace-nowrap">
            <ArrowUpDown size={13} className="shrink-0" />
            <select
              className="bg-transparent outline-none cursor-pointer"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {viewMode !== "combos" && (
        <>
          <div className="text-[12px] text-steel mb-2">
            {sorted.length} producto(s)
            {unmarkedCount > 0 && (
              <span className="ml-2 text-gold font-semibold">· {unmarkedCount} sin marca todavía</span>
            )}
          </div>

      {/* Confirmado 2026-09-15, pedido explícito del usuario: la primera
          versión (8 columnas parejas, todas del mismo tamaño y color) se
          veía chica y confundía cuál precio era cuál. Ahora se agrupan
          visualmente en dos bloques con su propio encabezado y separador:
          "Costo" (lo que ya cuesta tenerlo) vs. "Precios de venta" (a qué
          venderlo en cada canal) — y cada precio de venta lleva su color
          fijo (B2B teal, B2C azul) en todas las pantallas de la app. */}
      {/* Confirmado 2026-09-15, pedido explícito del usuario: con columnas de
          ancho "auto" (se ajustan a su contenido), Producto (1fr) se comía
          todo el espacio libre y el resto quedaba apiñado a la derecha,
          dejando un vacío enorme en el medio. Ahora cada columna de número
          tiene un ancho fijo — se reparten parejo por toda la fila. */}
      <div className="border border-rule rounded-md overflow-x-auto">
        {columnsHeader}
        <div className="max-h-[70vh] overflow-y-auto min-w-[1380px]">
          {sorted.length === 0 ? (
            <div className="px-3 py-4 text-[12.5px] text-steel">Sin resultados.</div>
          ) : (
            // Confirmado 2026-09-10 (pedido explícito del usuario): con
            // nombres cortos y las columnas de número lejos a la derecha, se
            // perdía de vista qué fila conectaba con qué — franjas alternas
            // (zebra) le dan a cada fila un fondo propio que el ojo puede
            // seguir de punta a punta sin saltar a la fila de al lado.
            sorted.map((r, i) => (
              <div
                key={r.catalogItemId}
                className={`grid grid-cols-[auto_minmax(200px,1fr)_110px_90px_100px_110px_110px_100px_100px_110px_110px] gap-3 px-3 py-2.5 border-t border-rule items-center ${i % 2 === 1 ? "bg-cloud/40" : ""}`}
              >
                {r.photos[0] ? (
                  // Confirmado 2026-09-15 (pedido de Daniel): foto real del
                  // catálogo junto al stock, para verificar que el producto
                  // contado es el mismo que corresponde al código — doble
                  // clic la amplía (GlobalImageZoom).
                  <img src={r.photos[0]} alt="" className="w-8 h-8 rounded object-cover border border-rule shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded border border-dashed border-rule shrink-0" />
                )}
                <span className="text-[12.5px] flex items-center gap-1.5 min-w-0">
                  <CatalogCode code={r.justCode} />
                  <ExpandableName text={r.name} />
                </span>
                <MarcaSelect value={r.bodega} onChange={(v) => updateProductMarca(r.catalogItemId, v)} readOnly={!canEdit} />
                <span className="flex flex-col items-end gap-0.5">
                  <span className={`text-right font-mono text-[12.5px] font-bold ${r.balance < 0 ? "text-red" : "text-ink"}`}>{r.balance}</span>
                  {canEdit && (
                    <StockAdjustmentTrigger
                      catalogItemId={r.catalogItemId}
                      currentBalance={r.balance}
                      isAdmin={isAdmin}
                      pendingQuantity={r.pendingAdjustmentQuantity}
                      onChanged={loadRows}
                    />
                  )}
                </span>
                <span className="flex flex-col items-end gap-0.5 border-l border-rule pl-3">
                  <CopyableAmount
                    value={r.providerPrice}
                    className={"text-right font-mono text-[13px] text-steel"}
                  />
                  {isAdmin && r.costSource !== "proposal" && r.costSource !== "kardex" && (
                    <DeclareCostButton catalogItemId={r.catalogItemId} onDeclared={loadRows} />
                  )}
                </span>
                <CopyableAmount
                  value={r.bodegaPrice}
                  className={"text-right font-mono text-[13px] text-steel"}
                />
                <CopyableAmount
                  value={r.benistockPrice}
                  className={"text-right font-mono text-[13px] text-steel"}
                />
                <CopyableAmount
                  value={r.b2bPriceDefault}
                  className={"text-right font-mono text-[13px] font-bold text-teal border-l border-rule pl-3"}
                />
                <CopyableAmount
                  value={r.dropiPrice}
                  className={"text-right font-mono text-[13px] font-bold text-ink"}
                />
                <CopyableAmount
                  value={r.b2cPrice1Unit}
                  className={"text-right font-mono text-[13px] font-bold text-blue"}
                />
                <CopyableAmount
                  value={r.b2cPrice2to11}
                  className={"text-right font-mono text-[13px] font-bold text-blue"}
                />
              </div>
            ))
          )}
        </div>
      </div>
        </>
      )}

      {viewMode === "combos" && combos.length === 0 && (
        <div className="px-3 py-4 text-[12.5px] text-steel">Todavía no hay combos registrados.</div>
      )}

      {viewMode === "combos" && combos.length > 0 && filteredCombos.length === 0 && (
        <div className="px-3 py-4 text-[12.5px] text-steel">Ningún combo coincide con esa búsqueda.</div>
      )}

      {viewMode !== "products" && filteredCombos.length > 0 && (
        <div className="mt-5">
          <div className="text-[13px] font-bold text-ink mb-1">Combos registrados</div>
          <div className="text-[11.5px] text-steel mb-2.5">
            Un combo no es un producto real — nunca tiene stock propio (por eso la columna Stock dice &quot;combo&quot;, nunca un número). Mismas columnas de costo y precio que los productos, calculadas sumando cada producto real que trae. Debajo de cada fila ves qué trae y cuánto stock real le queda a cada uno, para saber si alcanza para seguir armándolo.
          </div>
          <div className="border border-rule rounded-md overflow-x-auto">
            {columnsHeader}
            <div className="min-w-[1380px]">
              {[...filteredCombos]
                .sort((a, b) => Number(a.bodega != null) - Number(b.bodega != null) || a.code.localeCompare(b.code))
                .map((combo, i) => (
                  <div key={combo.id} className={`border-t first:border-t-0 border-rule ${i % 2 === 1 ? "bg-cloud/40" : ""}`}>
                    <div className="grid grid-cols-[auto_minmax(200px,1fr)_110px_90px_100px_110px_110px_100px_100px_110px_110px] gap-3 px-3 py-2.5 items-center">
                      <div className="w-8 h-8 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel-dim">
                        <Wrench size={12} />
                      </div>
                      <span className="text-[12.5px] flex items-center gap-1.5 min-w-0">
                        <span className="font-mono font-bold text-teal shrink-0">{combo.code}</span>
                        {combo.label && <ExpandableName text={combo.label} className="text-steel" />}
                      </span>
                      <MarcaSelect value={combo.bodega} onChange={(v) => updateComboMarca(combo.id, v)} readOnly={!canEdit} />
                      <span className="text-right font-mono text-[11px] italic text-steel-dim">combo</span>
                      <CopyableAmount
                        value={combo.providerPrice}
                        className={"text-right font-mono text-[13px] text-steel border-l border-rule pl-3"}
                      />
                      <CopyableAmount
                        value={combo.bodegaPrice}
                        className={"text-right font-mono text-[13px] text-steel"}
                      />
                      <CopyableAmount
                        value={combo.benistockPrice}
                        className={"text-right font-mono text-[13px] text-steel"}
                      />
                      <CopyableAmount
                        value={combo.b2bPriceDefault}
                        className={"text-right font-mono text-[13px] font-bold text-teal border-l border-rule pl-3"}
                      />
                      <CopyableAmount
                        value={combo.dropiPrice}
                        className={"text-right font-mono text-[13px] font-bold text-ink"}
                      />
                      <CopyableAmount
                        value={combo.b2cPrice1Unit}
                        className={"text-right font-mono text-[13px] font-bold text-blue"}
                      />
                      <CopyableAmount
                        value={combo.b2cPrice2to11}
                        className={"text-right font-mono text-[13px] font-bold text-blue"}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pl-[52px]">
                      {combo.components.map((c) => {
                        const stockRow = rows?.find((r) => r.catalogItemId === c.catalogItem.id);
                        const stock = stockRow?.balance ?? null;
                        return (
                          <span key={c.id} className="inline-flex items-center gap-1.5 text-[11.5px] bg-cloud border border-rule rounded-full px-2.5 py-1">
                            <CatalogCode code={c.catalogItem.justCode} />
                            <span>{c.quantity}× {c.catalogItem.name}</span>
                            <span className={`font-mono font-bold ${stock != null && stock < 0 ? "text-red" : "text-steel"}`}>
                              ({stock != null ? `stock: ${stock}` : "sin dato"})
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
