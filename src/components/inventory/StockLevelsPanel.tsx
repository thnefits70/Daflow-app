"use client";

import { useEffect, useState } from "react";
import { Search, ArrowUpDown, Info, X, Wrench, Check, Trash2, RefreshCw, ClipboardCheck } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { TabGuide } from "@/components/shared/TabGuide";
import { formatDateTime } from "@/lib/formatDateTime";

type FreightRecomputeRow = { catalogItemId: string; name: string; entriesChanged: number; oldAvgCost: number; newAvgCost: number };
type PersonalPurchaseBackfillRow = { catalogItemId: string; name: string; missingCount: number; missingUnits: number; oldBalance: number; newBalance: number };
type JustCostDeclarationRow = { catalogItemId: string; name: string; justCode: string | null; suggestedCost: number };
type UnregisteredSkeletonRow = { catalogItemId: string; name: string; justCode: string | null };
type CutoverSyncRow = { catalogItemId: string; name: string; justCode: string | null; oldBalance: number; newBalance: number; oldAvgCost: number; newAvgCost: number };
type CutoverDamageRow = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  currentBalance: number;
  currentAvgCost: number;
  restoreBalance: number;
  restoreAvgCost: number;
  realMovementType: "IN" | "OUT";
  realMovementAt: string;
};
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
  costSource?: "proposal" | "kardex" | "just" | null;
};

type StockRow = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  photos: string[];
  balance: number;
  avgCost: number;
  bodega: Marca | null;
  justAvgCost?: number | null;
  justStock?: number | null;
  justStockUploadedAt?: string | null;
  costSource?: "proposal" | "kardex" | "just" | null;
  providerPrice?: number;
  bodegaPrice?: number;
  benistockPrice?: number;
  b2bPriceDefault?: number;
  dropiPrice?: number;
  b2cPrice1Unit?: number;
  b2cPrice2to11?: number;
  pendingAdjustmentQuantity?: number | null;
};
type SortKey = "name" | "balance" | "proveedor" | "just" | "bodega" | "benistock" | "b2b" | "dropi" | "b2c1" | "b2c2";
// Confirmado 2026-09-21, pedido explícito del usuario: además de ordenar
// por nombre/stock, poder ordenar de mayor a menor por cualquier columna de
// costo o precio de venta (ej. "puesto en bodega") — se guarda solo el
// valor numérico de cada fila para esa columna, sin marca (los sin marca
// siguen apareciendo arriba, igual que antes).
function priceForSort(r: StockRow, key: SortKey): number {
  switch (key) {
    case "proveedor":
      return r.providerPrice ?? -1;
    case "just":
      return r.justAvgCost ?? -1;
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
  { key: "just", label: "Just (mayor a menor)" },
  { key: "benistock", label: "Benistock (mayor a menor)" },
  { key: "b2b", label: "B2B (mayor a menor)" },
  { key: "dropi", label: "Dropi (mayor a menor)" },
  { key: "b2c1", label: "B2C 1 un. (mayor a menor)" },
  { key: "b2c2", label: "B2C 2-11 un. (mayor a menor)" },
];
// Confirmado 2026-09-16, pedido explícito del usuario: poder ver solo los
// productos reales, solo los combos, o ambos juntos, con un clic.
type ViewMode = "all" | "products" | "combos";
type FormulaKey = "stock" | "stockJust" | "proveedor" | "just" | "bodega" | "benistock" | "b2b" | "dropi" | "b2c1" | "b2c2";

function money(v: number) {
  return "$" + v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Confirmado 2026-09-17, pedido explícito del usuario: el stock de Just
// queda "congelado" desde la subida que lo trajo hasta la siguiente — y
// mientras Just siga siendo una referencia manual (hasta que INVESTOCK sea
// la única fuente real, sin depender de subir archivos), quiere ver el
// día/mes/año y la hora exacta en que Daniel subió ese archivo, no solo la
// semana. Esta es la versión compacta que cabe en cada fila; la fecha
// completa (con año) se muestra una sola vez arriba de la tabla
// (lastJustUploadAt) y también en el title (tooltip) de cada número.
function compactDateTime(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
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

// Confirmado 2026-09-17, pedido explícito del usuario: mientras se termina
// de cargar INVESTOCK para todos los productos, un producto sin propuesta
// de Jariel ni costo real de Kardex usa el costo promedio de Just como
// respaldo TEMPORAL (ver resolveCostBasisForCatalogItems en
// lib/marketProduct.ts) — estas columnas de costo/precio se resaltan en
// gold para dejar claro que ese número no viene de INVESTOCK todavía.
const JUST_ESTIMATE_TITLE = "Estimado con el costo promedio de Just (temporal) — este producto todavía no tiene costo real en INVESTOCK.";
function withCostSourceColor(base: string, costSource?: "proposal" | "kardex" | "just" | null) {
  if (costSource !== "just") return base;
  return base.replace(/text-(teal|ink|blue|steel)\b/g, "text-gold");
}

// Confirmado 2026-09-21, pedido explícito del usuario (admin): desbloqueo
// rápido para un producto que ya se movió en INVESTOCK pero cuyo costo
// sigue en $0 (por eso aparece con el respaldo de Just, costSource="just")
// — declara a mano el costo real (normalmente el mismo de Just) para poder
// cotizar hoy mismo. Exclusivo del admin, a propósito: es una decisión
// financiera, no un dato operativo del día a día. Queda registrado en el
// Kardex como su propio tipo de línea (COST_DECLARATION, ver
// declareManualCost en stockKardex.ts), nunca se confunde con una compra
// real — el botón desaparece solo cuando entre la compra real de verdad.
function DeclareCostButton({ catalogItemId, suggestedCost, onDeclared }: { catalogItemId: string; suggestedCost: number; onDeclared: () => void }) {
  const [editing, setEditing] = useState(false);
  // Confirmado 2026-09-21, pedido explícito del usuario: el precio de Just
  // NUNCA trae el flete (es solo el costo del proveedor), así que declarar
  // ese número tal cual deja el costo corto — se separan los dos campos
  // para que quede claro qué es cada uno, y el total (lo que de verdad se
  // declara) sale de sumarlos.
  const [productCost, setProductCost] = useState(suggestedCost > 0 ? String(suggestedCost) : "");
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
          title="Costo del producto (sin flete) — el que trae Just"
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
  stockJust: {
    title: "Stock Just",
    text: "El stock tal cual venía en el último archivo semanal que subió Daniel — a diferencia de \"Stock\" (que se actualiza solo, en tiempo real), este número se queda igual (\"congelado\") hasta que Daniel suba un archivo nuevo, por eso también se ve la fecha y hora de esa subida. Es solo para comparar los dos a simple vista, nunca reemplaza al stock real de INVESTOCK.",
  },
  proveedor: {
    title: "Precio proveedor",
    text: "Lo que cobra el proveedor por una unidad, tal cual — sin sumarle flete ni nada más. Es el mismo costo real que ya usa el Kardex de INVESTOCK (el promedio ponderado de todas las compras).",
  },
  just: {
    title: "Just",
    text: "El costo promedio tal cual viene del último archivo semanal que subió Daniel en Control de Inventario — un dato externo, de referencia, nunca se calcula ni se guarda en ningún otro lado. No afecta ni reemplaza el costo real de INVESTOCK.",
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
    text: "Costo puesto en bodega × 1.06 (6% de seguro) ÷ (1 − 40%) + $7.50 (flete promedio), redondeado hacia arriba a .99. El 40% es el margen cuando se vende 1 sola unidad.",
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
  // Kardex, ni siquiera el de Just) o sin stock — mismo patrón de chip que
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

  // Confirmado 2026-09-22, bug real reportado por el usuario (caso 172320):
  // el corte con Just de abajo pisó 59 productos que ya tenían una compra
  // o salida real más nueva que el archivo usado (Daniel/Bryan habían
  // confirmado esas compras el 21/09, el archivo de Just era del 19/09).
  // Restaura el saldo/costo real de esos 59 — ver findCutoverDamageCandidates
  // en stockKardex.ts. El bug de origen ya está arreglado, esto solo repara
  // el daño que ya se había hecho.
  const [damageOpen, setDamageOpen] = useState(false);
  const [damageLoading, setDamageLoading] = useState(false);
  const [damagePreview, setDamagePreview] = useState<CutoverDamageRow[] | null>(null);
  const [damageConfirming, setDamageConfirming] = useState(false);
  const [damageApplying, setDamageApplying] = useState(false);
  const [damageResult, setDamageResult] = useState<{ restoredCount: number } | null>(null);
  const [damageError, setDamageError] = useState("");

  // Confirmado 2026-09-22, pedido explícito del usuario (admin): corte único
  // — "de ahora en adelante ya solo trabajaremos con INVESTOCK". Pone el
  // stock y costo del último archivo de Just como nuevo punto de partida,
  // incluso en productos con historial real (a diferencia de "Cargar saldo
  // inicial" en Control de Inventario, que solo toca productos sin ningún
  // movimiento) — decisión explícita del usuario después de ver que 230 de
  // 400 productos con movimiento real no coincidían con Just.
  const [cutoverOpen, setCutoverOpen] = useState(false);
  const [cutoverLoading, setCutoverLoading] = useState(false);
  const [cutoverPreview, setCutoverPreview] = useState<CutoverSyncRow[] | null>(null);
  const [cutoverConfirming, setCutoverConfirming] = useState(false);
  const [cutoverApplying, setCutoverApplying] = useState(false);
  const [cutoverResult, setCutoverResult] = useState<{ syncedCount: number } | null>(null);
  const [cutoverError, setCutoverError] = useState("");

  // Confirmado 2026-09-16, pedido explícito del usuario: corrección única del
  // historial de Kardex para que "Costo Prom." incluya el flete real de
  // compras viejas, no solo de las nuevas (ver applyKardexFreightRecompute
  // en stockKardex.ts) — exclusivo admin, primero vista previa (solo
  // lectura), después aplicar de verdad con confirmación explícita.
  const [freightOpen, setFreightOpen] = useState(false);
  const [freightLoading, setFreightLoading] = useState(false);
  const [freightPreview, setFreightPreview] = useState<FreightRecomputeRow[] | null>(null);
  const [freightConfirming, setFreightConfirming] = useState(false);
  const [freightApplying, setFreightApplying] = useState(false);
  const [freightResult, setFreightResult] = useState<{ itemsChanged: number; entriesUpdated: number } | null>(null);
  const [freightError, setFreightError] = useState("");

  // Confirmado 2026-09-17, pedido explícito del usuario (admin): botón
  // exclusivo suyo, una sola vez, para descontar de INVESTOCK las Compras
  // Personales que salieron de bodega antes de que se arreglara el bug de
  // createOutflowForPersonalPurchaseItem — mismo patrón de vista previa +
  // confirmación explícita que la corrección de flete de arriba.
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillPreview, setBackfillPreview] = useState<PersonalPurchaseBackfillRow[] | null>(null);
  const [backfillConfirming, setBackfillConfirming] = useState(false);
  const [backfillApplying, setBackfillApplying] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ itemsChanged: number; entriesInserted: number } | null>(null);
  const [backfillError, setBackfillError] = useState("");
  // Confirmado 2026-09-21, pedido explícito del usuario (admin): versión
  // masiva del botón "Declarar costo" — declara de una vez el precio de
  // Just (sin flete, no se conoce por producto) para todos los que siguen
  // en $0 real, en vez de entrar uno por uno. Mismo patrón de vista previa
  // + confirmación explícita que los dos botones de arriba.
  const [bulkDeclareOpen, setBulkDeclareOpen] = useState(false);
  const [bulkDeclareLoading, setBulkDeclareLoading] = useState(false);
  const [bulkDeclarePreview, setBulkDeclarePreview] = useState<JustCostDeclarationRow[] | null>(null);
  const [bulkDeclareConfirming, setBulkDeclareConfirming] = useState(false);
  const [bulkDeclareApplying, setBulkDeclareApplying] = useState(false);
  const [bulkDeclareResult, setBulkDeclareResult] = useState<{ declaredCount: number; totalCandidates: number } | null>(null);
  const [bulkDeclareError, setBulkDeclareError] = useState("");
  // Confirmado 2026-09-21, pedido explícito del usuario (admin): borrar de
  // verdad los productos "esqueleto" que crea la importación de Just
  // (código+nombre nada más, nunca matriculados, nunca comprados) — mismo
  // patrón de vista previa + confirmación explícita que los 3 botones de
  // arriba, pero este SÍ borra filas reales (irreversible), por eso lleva
  // su propia advertencia.
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<UnregisteredSkeletonRow[] | null>(null);
  // Confirmado 2026-09-21, corrección pedida por el usuario: el filtro
  // automático (nunca matriculado + nunca comprado por Control de Compras)
  // encontró productos que SÍ existen de verdad en la lista — no alcanza
  // para decidir solo, así que ahora es un checklist: el admin marca a mano
  // cuáles borrar en vez de "todos o ninguno". Arranca con todo
  // seleccionado (la mayoría sí son basura real) pero cualquiera se puede
  // destildar antes de confirmar.
  const [cleanupSelected, setCleanupSelected] = useState<Set<string>>(new Set());
  const [cleanupConfirming, setCleanupConfirming] = useState(false);
  const [cleanupApplying, setCleanupApplying] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ deletedCount: number; totalRequested: number } | null>(null);
  const [cleanupError, setCleanupError] = useState("");
  const [combos, setCombos] = useState<ComboRow[]>([]);
  // Confirmado 2026-09-17, pedido explícito del usuario: fecha/hora exacta
  // del último archivo de Just que subió Daniel en general, para mostrarla
  // una sola vez arriba de la tabla (referencia mientras Just siga siendo
  // manual, antes de depender solo de INVESTOCK en tiempo real).
  const [lastJustUploadAt, setLastJustUploadAt] = useState<string | null>(null);

  function loadRows() {
    fetch("/api/inventory-control/stock-levels")
      .then((r) => (r.ok ? r.json() : { rows: [], lastJustUploadAt: null }))
      .then((data) => {
        setRows(data.rows);
        setLastJustUploadAt(data.lastJustUploadAt);
      })
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

  function loadDamagePreview() {
    setDamageLoading(true);
    setDamageError("");
    setDamageResult(null);
    fetch("/api/inventory-control/cutover-damage-correction")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDamagePreview)
      .catch(() => setDamageError("No se pudo cargar la vista previa."))
      .finally(() => setDamageLoading(false));
  }

  async function applyDamageCorrection() {
    setDamageApplying(true);
    setDamageError("");
    const res = await fetch("/api/inventory-control/cutover-damage-correction", { method: "POST" });
    setDamageApplying(false);
    setDamageConfirming(false);
    if (!res.ok) {
      setDamageError("No se pudo restaurar.");
      return;
    }
    const data = await res.json();
    setDamageResult(data);
    setDamagePreview(null);
    loadRows();
  }

  function loadCutoverPreview() {
    setCutoverLoading(true);
    setCutoverError("");
    setCutoverResult(null);
    fetch("/api/inventory-control/just-cutover-sync")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setCutoverPreview)
      .catch(() => setCutoverError("No se pudo cargar la vista previa."))
      .finally(() => setCutoverLoading(false));
  }

  async function applyCutover() {
    setCutoverApplying(true);
    setCutoverError("");
    const res = await fetch("/api/inventory-control/just-cutover-sync", { method: "POST" });
    setCutoverApplying(false);
    setCutoverConfirming(false);
    if (!res.ok) {
      setCutoverError("No se pudo sincronizar.");
      return;
    }
    const data = await res.json();
    setCutoverResult(data);
    setCutoverPreview(null);
    loadRows();
  }

  function loadFreightPreview() {
    setFreightLoading(true);
    setFreightError("");
    setFreightResult(null);
    fetch("/api/inventory-control/kardex-recompute-freight")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setFreightPreview)
      .catch(() => setFreightError("No se pudo cargar la vista previa."))
      .finally(() => setFreightLoading(false));
  }

  async function applyFreightRecompute() {
    setFreightApplying(true);
    setFreightError("");
    const res = await fetch("/api/inventory-control/kardex-recompute-freight", { method: "POST" });
    setFreightApplying(false);
    setFreightConfirming(false);
    if (!res.ok) {
      setFreightError("No se pudo aplicar la corrección.");
      return;
    }
    const data = await res.json();
    setFreightResult(data);
    setFreightPreview(null);
    loadRows();
  }

  function loadBackfillPreview() {
    setBackfillLoading(true);
    setBackfillError("");
    setBackfillResult(null);
    fetch("/api/inventory-control/kardex-backfill-personal-purchases")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setBackfillPreview)
      .catch(() => setBackfillError("No se pudo cargar la vista previa."))
      .finally(() => setBackfillLoading(false));
  }

  async function applyBackfill() {
    setBackfillApplying(true);
    setBackfillError("");
    const res = await fetch("/api/inventory-control/kardex-backfill-personal-purchases", { method: "POST" });
    setBackfillApplying(false);
    setBackfillConfirming(false);
    if (!res.ok) {
      setBackfillError("No se pudo aplicar la corrección.");
      return;
    }
    const data = await res.json();
    setBackfillResult(data);
    setBackfillPreview(null);
    loadRows();
  }

  function loadBulkDeclarePreview() {
    setBulkDeclareLoading(true);
    setBulkDeclareError("");
    setBulkDeclareResult(null);
    fetch("/api/inventory-control/declare-just-costs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setBulkDeclarePreview)
      .catch(() => setBulkDeclareError("No se pudo cargar la vista previa."))
      .finally(() => setBulkDeclareLoading(false));
  }

  async function applyBulkDeclare() {
    setBulkDeclareApplying(true);
    setBulkDeclareError("");
    const res = await fetch("/api/inventory-control/declare-just-costs", { method: "POST" });
    setBulkDeclareApplying(false);
    setBulkDeclareConfirming(false);
    if (!res.ok) {
      setBulkDeclareError("No se pudo declarar el costo.");
      return;
    }
    const data = await res.json();
    setBulkDeclareResult(data);
    setBulkDeclarePreview(null);
    loadRows();
  }

  function loadCleanupPreview() {
    setCleanupLoading(true);
    setCleanupError("");
    setCleanupResult(null);
    fetch("/api/inventory-control/cleanup-unregistered-products")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((rows: UnregisteredSkeletonRow[]) => {
        setCleanupPreview(rows);
        setCleanupSelected(new Set(rows.map((r) => r.catalogItemId)));
      })
      .catch(() => setCleanupError("No se pudo cargar la vista previa."))
      .finally(() => setCleanupLoading(false));
  }

  function toggleCleanupSelected(catalogItemId: string) {
    setCleanupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(catalogItemId)) next.delete(catalogItemId);
      else next.add(catalogItemId);
      return next;
    });
  }

  async function applyCleanup() {
    setCleanupApplying(true);
    setCleanupError("");
    const res = await fetch("/api/inventory-control/cleanup-unregistered-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemIds: Array.from(cleanupSelected) }),
    });
    setCleanupApplying(false);
    setCleanupConfirming(false);
    if (!res.ok) {
      setCleanupError("No se pudo eliminar.");
      return;
    }
    const data = await res.json();
    setCleanupResult(data);
    setCleanupPreview(null);
    setCleanupSelected(new Set());
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
      <div className="grid grid-cols-[auto_minmax(200px,1fr)_110px_90px_90px_100px_90px_110px_110px_100px_100px_110px_110px] gap-3 px-3 pt-2 min-w-[1560px]">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
        <span className="col-span-4 text-center text-[10px] font-bold uppercase tracking-wide text-steel border-b border-rule pb-1">Costo</span>
        <span className="col-span-4 text-center text-[10px] font-bold uppercase tracking-wide text-blue border-b border-rule pb-1">Precios de venta</span>
      </div>
      <div className="grid grid-cols-[auto_minmax(200px,1fr)_110px_90px_90px_100px_90px_110px_110px_100px_100px_110px_110px] gap-3 px-3 py-2 bg-cloud text-[11px] font-semibold uppercase tracking-wide text-steel min-w-[1560px]">
        <span></span>
        <span>Producto</span>
        <span>Marca</span>
        <span className="flex items-center justify-end gap-1">
          Stock INVESTOCK <FormulaInfoButton open={openFormula === "stock"} onToggle={() => setOpenFormula((k) => (k === "stock" ? null : "stock"))} />
        </span>
        <span className="flex flex-col items-end text-right text-gold leading-tight">
          <span className="flex items-center gap-1">
            Stock Just <FormulaInfoButton open={openFormula === "stockJust"} onToggle={() => setOpenFormula((k) => (k === "stockJust" ? null : "stockJust"))} />
          </span>
          {lastJustUploadAt && (
            <span className="text-[9px] font-normal normal-case text-steel-dim">
              últ. subida: {formatDateTime(lastJustUploadAt)}
            </span>
          )}
        </span>
        <span className="flex items-center justify-end gap-1 border-l border-rule pl-3">
          Proveedor <FormulaInfoButton open={openFormula === "proveedor"} onToggle={() => setOpenFormula((k) => (k === "proveedor" ? null : "proveedor"))} />
        </span>
        <span className="flex items-center justify-end gap-1">
          Just <FormulaInfoButton open={openFormula === "just"} onToggle={() => setOpenFormula((k) => (k === "just" ? null : "just"))} />
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
        <div className="flex items-start justify-between gap-3 bg-navy border-b border-rule px-3 py-2.5 min-w-[1560px]">
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

      {isAdmin && (
        <div className="border border-red rounded-md mb-3">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-red hover:text-red cursor-pointer"
            onClick={() => {
              setDamageOpen((v) => !v);
              if (!damageOpen && damagePreview === null && !damageResult) loadDamagePreview();
            }}
          >
            <RefreshCw size={13} /> Restaurar compras/salidas reales que el corte con Just pisó por error
          </button>
          {damageOpen && (
            <div className="px-3 pb-3 text-[12px]">
              <p className="text-steel mb-2">
                El corte con Just de abajo usó el archivo del 19/9 sin revisar si algún producto ya tenía una compra o salida real MÁS NUEVA que ese archivo — en 59 productos sí la tenía (ej. una compra que Daniel y Bryan ya habían confirmado el 21/9), y el corte la pisó con el número viejo de Just. <span className="text-red font-semibold">Esto restaura el saldo y costo real que tenía cada producto justo antes de ese error.</span> El bug de origen ya está arreglado — esto solo repara lo que ya se pisó.
              </p>
              {damageError && <div className="text-red mb-2">{damageError}</div>}
              {damageLoading && <div className="text-steel">Calculando vista previa…</div>}
              {damageResult && (
                <div className="text-teal font-semibold mb-2">
                  ✓ Restaurados: {damageResult.restoredCount} producto{damageResult.restoredCount === 1 ? "" : "s"}.
                </div>
              )}
              {!damageLoading && damagePreview && (
                <>
                  {damagePreview.length === 0 ? (
                    <div className="text-steel">Nada por restaurar — no hay daño pendiente del corte con Just.</div>
                  ) : (
                    <>
                      <div className="text-steel mb-1.5">{damagePreview.length} producto(s) se restaurarían:</div>
                      <div className="max-h-64 overflow-y-auto flex flex-col gap-1 mb-2.5 border border-rule rounded-md p-1.5">
                        {damagePreview.map((r) => (
                          <div key={r.catalogItemId} className="flex items-center justify-between gap-2 text-[11.5px] px-1.5 py-1">
                            <span className="truncate flex-1 flex items-center gap-1.5">
                              <CatalogCode code={r.justCode} size="text-[10px]" /> {r.name}
                            </span>
                            <span className="font-mono text-steel shrink-0">
                              stock {r.currentBalance}→<span className="font-bold text-teal">{r.restoreBalance}</span> · costo {money(r.currentAvgCost)}→<span className="font-bold text-teal">{money(r.restoreAvgCost)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                      {damageConfirming ? (
                        <div className="flex items-center gap-2">
                          <span className="text-steel">¿Restaurar estos {damagePreview.length} productos a su número real?</span>
                          <button
                            type="button"
                            disabled={damageApplying}
                            className="font-bold text-teal cursor-pointer disabled:opacity-50"
                            onClick={applyDamageCorrection}
                          >
                            {damageApplying ? "Restaurando…" : "Sí, restaurar"}
                          </button>
                          <button type="button" className="text-steel cursor-pointer" onClick={() => setDamageConfirming(false)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer"
                          onClick={() => setDamageConfirming(true)}
                        >
                          Restaurar todos
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="border border-gold/40 rounded-md mb-3">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-gold hover:text-gold cursor-pointer"
            onClick={() => {
              setCutoverOpen((v) => !v);
              if (!cutoverOpen && cutoverPreview === null && !cutoverResult) loadCutoverPreview();
            }}
          >
            <RefreshCw size={13} /> Sincronizar INVESTOCK con el último archivo de Just (corte único)
          </button>
          {cutoverOpen && (
            <div className="px-3 pb-3 text-[12px]">
              <p className="text-steel mb-2">
                Pone el stock y costo del último archivo que subió Daniel como el nuevo punto de partida de cada producto — incluso en los que ya tienen compras/salidas reales registradas. <span className="text-gold font-semibold">De ahora en adelante, INVESTOCK deja de compararse con Just</span>: todo lo que pase después de esto son movimientos reales (compras/egresos), no más archivos de Just. Seguro de correr más de una vez — solo lista productos donde el número realmente cambiaría.
              </p>
              {cutoverError && <div className="text-red mb-2">{cutoverError}</div>}
              {cutoverLoading && <div className="text-steel">Calculando vista previa…</div>}
              {cutoverResult && (
                <div className="text-teal font-semibold mb-2">
                  ✓ Sincronizados: {cutoverResult.syncedCount} producto{cutoverResult.syncedCount === 1 ? "" : "s"}.
                </div>
              )}
              {!cutoverLoading && cutoverPreview && (
                <>
                  {cutoverPreview.length === 0 ? (
                    <div className="text-steel">Nada por sincronizar — INVESTOCK ya coincide con el último archivo de Just en todo.</div>
                  ) : (
                    <>
                      <div className="text-steel mb-1.5">{cutoverPreview.length} producto(s) cambiarían:</div>
                      <div className="max-h-64 overflow-y-auto flex flex-col gap-1 mb-2.5 border border-rule rounded-md p-1.5">
                        {cutoverPreview.map((r) => (
                          <div key={r.catalogItemId} className="flex items-center justify-between gap-2 text-[11.5px] px-1.5 py-1">
                            <span className="truncate flex-1 flex items-center gap-1.5">
                              <CatalogCode code={r.justCode} size="text-[10px]" /> {r.name}
                            </span>
                            <span className="font-mono text-steel shrink-0">
                              stock {r.oldBalance}→<span className="font-bold text-ink">{r.newBalance}</span> · costo {money(r.oldAvgCost)}→<span className="font-bold text-ink">{money(r.newAvgCost)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                      {cutoverConfirming ? (
                        <div className="flex items-center gap-2">
                          <span className="text-steel">¿Sincronizar estos {cutoverPreview.length} productos con Just ahora?</span>
                          <button
                            type="button"
                            disabled={cutoverApplying}
                            className="font-bold text-red cursor-pointer disabled:opacity-50"
                            onClick={applyCutover}
                          >
                            {cutoverApplying ? "Sincronizando…" : "Sí, sincronizar"}
                          </button>
                          <button type="button" className="text-steel cursor-pointer" onClick={() => setCutoverConfirming(false)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-gold bg-gold px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer"
                          onClick={() => setCutoverConfirming(true)}
                        >
                          Sincronizar todos
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="border border-rule rounded-md mb-3">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-steel hover:text-ink cursor-pointer"
            onClick={() => {
              setFreightOpen((v) => !v);
              if (!freightOpen && freightPreview === null && !freightResult) loadFreightPreview();
            }}
          >
            <Wrench size={13} /> Corregir Costo Prom. con el flete real de compras viejas
          </button>
          {freightOpen && (
            <div className="px-3 pb-3 text-[12px]">
              <p className="text-steel mb-2">
                Recalcula el &quot;Costo Prom.&quot; de todos los productos para que las compras de antes de hoy también sumen el flete real que ya pagaste (donde aplicó — un proveedor que nunca cobra flete aparte no cambia). Las ventas/salidas ya hechas se quedan tal como están anotadas, no se tocan. Es seguro correr esto más de una vez.
              </p>
              {freightError && <div className="text-red mb-2">{freightError}</div>}
              {freightLoading && <div className="text-steel">Calculando vista previa…</div>}
              {freightResult && (
                <div className="text-teal font-semibold mb-2">
                  ✓ Corregido: {freightResult.itemsChanged} producto{freightResult.itemsChanged === 1 ? "" : "s"} actualizado{freightResult.itemsChanged === 1 ? "" : "s"} ({freightResult.entriesUpdated} línea{freightResult.entriesUpdated === 1 ? "" : "s"} de Kardex).
                </div>
              )}
              {!freightLoading && freightPreview && (
                <>
                  {freightPreview.length === 0 ? (
                    <div className="text-steel">Ningún producto cambiaría — el historial ya está al día.</div>
                  ) : (
                    <>
                      <div className="text-steel mb-1.5">{freightPreview.length} producto(s) cambiarían:</div>
                      <div className="max-h-52 overflow-y-auto flex flex-col gap-1 mb-2.5 border border-rule rounded-md p-1.5">
                        {freightPreview.map((r) => (
                          <div key={r.catalogItemId} className="flex items-center justify-between gap-2 text-[11.5px] px-1.5 py-1">
                            <span className="truncate flex-1">{r.name}</span>
                            <span className="font-mono text-steel shrink-0">
                              {money(r.oldAvgCost)} → <span className="font-bold text-ink">{money(r.newAvgCost)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                      {freightConfirming ? (
                        <div className="flex items-center gap-2">
                          <span className="text-steel">¿Aplicar esta corrección a la base real?</span>
                          <button
                            type="button"
                            disabled={freightApplying}
                            className="font-bold text-red cursor-pointer disabled:opacity-50"
                            onClick={applyFreightRecompute}
                          >
                            {freightApplying ? "Aplicando…" : "Sí, aplicar"}
                          </button>
                          <button type="button" className="text-steel cursor-pointer" onClick={() => setFreightConfirming(false)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer"
                          onClick={() => setFreightConfirming(true)}
                        >
                          Aplicar corrección
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="border border-rule rounded-md mb-3">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-steel hover:text-ink cursor-pointer"
            onClick={() => {
              setBackfillOpen((v) => !v);
              if (!backfillOpen && backfillPreview === null && !backfillResult) loadBackfillPreview();
            }}
          >
            <Wrench size={13} /> Descontar de INVESTOCK las Compras Personales de antes del arreglo
          </button>
          {backfillOpen && (
            <div className="px-3 pb-3 text-[12px]">
              <p className="text-steel mb-2">
                Antes de hoy, las Compras Personales nunca restaban su stock de INVESTOCK (bug ya corregido para las nuevas). Esto descuenta, de una sola vez, las que ya pasaron y siguen pendientes — insertando la salida en la fecha real en que pasó, no hoy. Es seguro correr esto más de una vez.
              </p>
              {backfillError && <div className="text-red mb-2">{backfillError}</div>}
              {backfillLoading && <div className="text-steel">Calculando vista previa…</div>}
              {backfillResult && (
                <div className="text-teal font-semibold mb-2">
                  ✓ Corregido: {backfillResult.itemsChanged} producto{backfillResult.itemsChanged === 1 ? "" : "s"} actualizado{backfillResult.itemsChanged === 1 ? "" : "s"} ({backfillResult.entriesInserted} salida{backfillResult.entriesInserted === 1 ? "" : "s"} insertada{backfillResult.entriesInserted === 1 ? "" : "s"}).
                </div>
              )}
              {!backfillLoading && backfillPreview && (
                <>
                  {backfillPreview.length === 0 ? (
                    <div className="text-steel">Nada pendiente — todas las Compras Personales ya están descontadas.</div>
                  ) : (
                    <>
                      <div className="text-steel mb-1.5">{backfillPreview.length} producto(s) cambiarían:</div>
                      <div className="max-h-52 overflow-y-auto flex flex-col gap-1 mb-2.5 border border-rule rounded-md p-1.5">
                        {backfillPreview.map((r) => (
                          <div key={r.catalogItemId} className="flex items-center justify-between gap-2 text-[11.5px] px-1.5 py-1">
                            <span className="truncate flex-1">{r.name} <span className="text-steel">({r.missingCount} compra{r.missingCount === 1 ? "" : "s"}, {r.missingUnits} unidad{r.missingUnits === 1 ? "" : "es"})</span></span>
                            <span className="font-mono text-steel shrink-0">
                              {r.oldBalance} → <span className="font-bold text-ink">{r.newBalance}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                      {backfillConfirming ? (
                        <div className="flex items-center gap-2">
                          <span className="text-steel">¿Aplicar esta corrección a la base real?</span>
                          <button
                            type="button"
                            disabled={backfillApplying}
                            className="font-bold text-red cursor-pointer disabled:opacity-50"
                            onClick={applyBackfill}
                          >
                            {backfillApplying ? "Aplicando…" : "Sí, aplicar"}
                          </button>
                          <button type="button" className="text-steel cursor-pointer" onClick={() => setBackfillConfirming(false)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer"
                          onClick={() => setBackfillConfirming(true)}
                        >
                          Aplicar corrección
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="border border-rule rounded-md mb-3">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-steel hover:text-ink cursor-pointer"
            onClick={() => {
              setBulkDeclareOpen((v) => !v);
              if (!bulkDeclareOpen && bulkDeclarePreview === null && !bulkDeclareResult) loadBulkDeclarePreview();
            }}
          >
            <Wrench size={13} /> Declarar costo estimado (precio de Just) para todos los que siguen en $0
          </button>
          {bulkDeclareOpen && (
            <div className="px-3 pb-3 text-[12px]">
              <p className="text-steel mb-2">
                Declara de una sola vez el precio de Just como costo estimado de todo producto que ya se movió pero sigue en $0 en INVESTOCK — mismo criterio que el botón &quot;Declarar costo&quot; de cada fila, pero para todos a la vez. <span className="text-gold font-semibold">Ojo: acá NO se suma flete</span> (no se conoce por producto en un lote) — si sabes el flete de alguno en particular, mejor decláralo aparte con su propio botón en la fila. Nunca pisa un producto que ya tenga costo real. Es seguro correr esto más de una vez.
              </p>
              {bulkDeclareError && <div className="text-red mb-2">{bulkDeclareError}</div>}
              {bulkDeclareLoading && <div className="text-steel">Calculando vista previa…</div>}
              {bulkDeclareResult && (
                <div className="text-teal font-semibold mb-2">
                  ✓ Declarado: {bulkDeclareResult.declaredCount} de {bulkDeclareResult.totalCandidates} producto{bulkDeclareResult.totalCandidates === 1 ? "" : "s"}.
                </div>
              )}
              {!bulkDeclareLoading && bulkDeclarePreview && (
                <>
                  {bulkDeclarePreview.length === 0 ? (
                    <div className="text-steel">Nada pendiente — ningún producto sigue en $0 con precio de Just disponible.</div>
                  ) : (
                    <>
                      <div className="text-steel mb-1.5">{bulkDeclarePreview.length} producto(s) recibirían un costo declarado:</div>
                      <div className="max-h-52 overflow-y-auto flex flex-col gap-1 mb-2.5 border border-rule rounded-md p-1.5">
                        {bulkDeclarePreview.map((r) => (
                          <div key={r.catalogItemId} className="flex items-center justify-between gap-2 text-[11.5px] px-1.5 py-1">
                            <span className="truncate flex-1">
                              <CatalogCode code={r.justCode} size="text-[10px]" /> {r.name}
                            </span>
                            <span className="font-mono font-bold text-gold shrink-0">{money(r.suggestedCost)}</span>
                          </div>
                        ))}
                      </div>
                      {bulkDeclareConfirming ? (
                        <div className="flex items-center gap-2">
                          <span className="text-steel">¿Declarar el costo de estos {bulkDeclarePreview.length} productos?</span>
                          <button
                            type="button"
                            disabled={bulkDeclareApplying}
                            className="font-bold text-red cursor-pointer disabled:opacity-50"
                            onClick={applyBulkDeclare}
                          >
                            {bulkDeclareApplying ? "Declarando…" : "Sí, declarar"}
                          </button>
                          <button type="button" className="text-steel cursor-pointer" onClick={() => setBulkDeclareConfirming(false)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer"
                          onClick={() => setBulkDeclareConfirming(true)}
                        >
                          Declarar todos
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="border border-red/40 rounded-md mb-3">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-red hover:text-red cursor-pointer"
            onClick={() => {
              setCleanupOpen((v) => !v);
              if (!cleanupOpen && cleanupPreview === null && !cleanupResult) loadCleanupPreview();
            }}
          >
            <Trash2 size={13} /> Eliminar productos esqueleto nunca comprados (código de Just sin matricular)
          </button>
          {cleanupOpen && (
            <div className="px-3 pb-3 text-[12px]">
              <p className="text-steel mb-2">
                Productos que la importación de Just creó solo con código y nombre (sin fotos, nunca matriculados en &quot;Base de datos de productos&quot;) y que nunca se compraron por Control de Compras — son la razón real detrás de buena parte de &quot;Sin precio&quot;/&quot;Sin stock&quot; de arriba. <span className="text-gold font-semibold">Ojo: esto NO garantiza que el producto no exista de verdad</span> — solo que nadie terminó de registrarlo en la app (puede haberse comprado antes de usar DAFLOW, por ejemplo). Revisa la lista y destilda los que sepas que sí existen. <span className="text-red font-semibold">Lo que quede marcado se borra para siempre, no se puede deshacer.</span>
              </p>
              {cleanupError && <div className="text-red mb-2">{cleanupError}</div>}
              {cleanupLoading && <div className="text-steel">Calculando vista previa…</div>}
              {cleanupResult && (
                <div className="text-teal font-semibold mb-2">
                  ✓ Eliminados: {cleanupResult.deletedCount} de {cleanupResult.totalRequested} seleccionado{cleanupResult.totalRequested === 1 ? "" : "s"}.
                </div>
              )}
              {!cleanupLoading && cleanupPreview && (
                <>
                  {cleanupPreview.length === 0 ? (
                    <div className="text-steel">Ningún producto esqueleto sin usar por ahora.</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-steel">
                          {cleanupPreview.length} producto(s) candidato(s) · {cleanupSelected.size} seleccionado(s)
                        </span>
                        <div className="flex items-center gap-2">
                          <button type="button" className="text-teal cursor-pointer font-semibold" onClick={() => setCleanupSelected(new Set(cleanupPreview.map((r) => r.catalogItemId)))}>
                            Marcar todos
                          </button>
                          <button type="button" className="text-steel cursor-pointer font-semibold" onClick={() => setCleanupSelected(new Set())}>
                            Desmarcar todos
                          </button>
                        </div>
                      </div>
                      <div className="max-h-64 overflow-y-auto flex flex-col gap-1 mb-2.5 border border-rule rounded-md p-1.5">
                        {cleanupPreview.map((r) => (
                          <label key={r.catalogItemId} className="flex items-center gap-2 text-[11.5px] px-1.5 py-1 cursor-pointer hover:bg-cloud rounded">
                            <input
                              type="checkbox"
                              className="cursor-pointer shrink-0"
                              checked={cleanupSelected.has(r.catalogItemId)}
                              onChange={() => toggleCleanupSelected(r.catalogItemId)}
                            />
                            <CatalogCode code={r.justCode} size="text-[10px]" /> <span className="truncate">{r.name}</span>
                          </label>
                        ))}
                      </div>
                      {cleanupConfirming ? (
                        <div className="flex items-center gap-2">
                          <span className="text-steel">¿Eliminar estos {cleanupSelected.size} productos para siempre?</span>
                          <button
                            type="button"
                            disabled={cleanupApplying}
                            className="font-bold text-red cursor-pointer disabled:opacity-50"
                            onClick={applyCleanup}
                          >
                            {cleanupApplying ? "Eliminando…" : "Sí, eliminar"}
                          </button>
                          <button type="button" className="text-steel cursor-pointer" onClick={() => setCleanupConfirming(false)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={cleanupSelected.size === 0}
                          className="rounded border border-red bg-red px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          onClick={() => setCleanupConfirming(true)}
                        >
                          Eliminar seleccionados ({cleanupSelected.size})
                        </button>
                      )}
                    </>
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
              title="Productos sin ninguna base de costo real: ni propuesta de Análisis de Mercado, ni compra en INVESTOCK, ni Just."
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
        <div className="max-h-[70vh] overflow-y-auto min-w-[1560px]">
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
                className={`grid grid-cols-[auto_minmax(200px,1fr)_110px_90px_90px_100px_90px_110px_110px_100px_100px_110px_110px] gap-3 px-3 py-2.5 border-t border-rule items-center ${i % 2 === 1 ? "bg-cloud/40" : ""}`}
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
                  <span className="truncate">{r.name}</span>
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
                {/* Confirmado 2026-09-17, pedido explícito del usuario: stock
                    de referencia según el último archivo de Just, junto al
                    stock real de INVESTOCK — resaltado en gold cuando no
                    coinciden, para que el desfase salte a la vista sin tener
                    que restar los dos números a mano. La fecha/hora debajo es
                    de qué subida salió ese número (día/mes/hora, el tooltip
                    trae el año completo) — se queda "congelado" tal cual
                    hasta que Daniel suba el siguiente archivo. */}
                <span className="flex flex-col items-end leading-tight">
                  <span
                    className={`font-mono text-[12.5px] ${
                      r.justStock == null ? "text-steel-dim" : r.justStock !== r.balance ? "font-bold text-gold" : "text-steel"
                    }`}
                    title={r.justStockUploadedAt ? `Archivo de Just subido: ${formatDateTime(r.justStockUploadedAt)}` : "Stock del último archivo de Just — solo referencia."}
                  >
                    {r.justStock == null ? "—" : r.justStock}
                  </span>
                  {r.justStockUploadedAt && (
                    <span className="text-[9px] text-steel-dim" title={`Archivo de Just subido: ${formatDateTime(r.justStockUploadedAt)}`}>
                      {compactDateTime(r.justStockUploadedAt)}
                    </span>
                  )}
                </span>
                <span className="flex flex-col items-end gap-0.5 border-l border-rule pl-3">
                  <CopyableAmount
                    value={r.providerPrice}
                    className={withCostSourceColor("text-right font-mono text-[13px] text-steel", r.costSource)}
                    title={r.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                  />
                  {isAdmin && r.costSource !== "proposal" && r.costSource !== "kardex" && (
                    <DeclareCostButton catalogItemId={r.catalogItemId} suggestedCost={r.justAvgCost ?? 0} onDeclared={loadRows} />
                  )}
                </span>
                <CopyableAmount value={r.justAvgCost} className="text-right font-mono text-[13px] text-gold" />
                <CopyableAmount
                  value={r.bodegaPrice}
                  className={withCostSourceColor("text-right font-mono text-[13px] text-steel", r.costSource)}
                  title={r.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                />
                <CopyableAmount
                  value={r.benistockPrice}
                  className={withCostSourceColor("text-right font-mono text-[13px] text-steel", r.costSource)}
                  title={r.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                />
                <CopyableAmount
                  value={r.b2bPriceDefault}
                  className={withCostSourceColor("text-right font-mono text-[13px] font-bold text-teal border-l border-rule pl-3", r.costSource)}
                  title={r.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                />
                <CopyableAmount
                  value={r.dropiPrice}
                  className={withCostSourceColor("text-right font-mono text-[13px] font-bold text-ink", r.costSource)}
                  title={r.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                />
                <CopyableAmount
                  value={r.b2cPrice1Unit}
                  className={withCostSourceColor("text-right font-mono text-[13px] font-bold text-blue", r.costSource)}
                  title={r.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                />
                <CopyableAmount
                  value={r.b2cPrice2to11}
                  className={withCostSourceColor("text-right font-mono text-[13px] font-bold text-blue", r.costSource)}
                  title={r.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
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
            <div className="min-w-[1560px]">
              {[...filteredCombos]
                .sort((a, b) => Number(a.bodega != null) - Number(b.bodega != null) || a.code.localeCompare(b.code))
                .map((combo, i) => (
                  <div key={combo.id} className={`border-t first:border-t-0 border-rule ${i % 2 === 1 ? "bg-cloud/40" : ""}`}>
                    <div className="grid grid-cols-[auto_minmax(200px,1fr)_110px_90px_90px_100px_90px_110px_110px_100px_100px_110px_110px] gap-3 px-3 py-2.5 items-center">
                      <div className="w-8 h-8 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel-dim">
                        <Wrench size={12} />
                      </div>
                      <span className="text-[12.5px] flex items-center gap-1.5 min-w-0">
                        <span className="font-mono font-bold text-teal shrink-0">{combo.code}</span>
                        {combo.label && <span className="truncate text-steel">{combo.label}</span>}
                      </span>
                      <MarcaSelect value={combo.bodega} onChange={(v) => updateComboMarca(combo.id, v)} readOnly={!canEdit} />
                      <span className="text-right font-mono text-[11px] italic text-steel-dim">combo</span>
                      <span className="text-right font-mono text-[13px] text-steel-dim" title="Just no rastrea combos, solo productos individuales">
                        —
                      </span>
                      <CopyableAmount
                        value={combo.providerPrice}
                        className={withCostSourceColor("text-right font-mono text-[13px] text-steel border-l border-rule pl-3", combo.costSource)}
                        title={combo.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                      />
                      <span className="text-right font-mono text-[13px] text-steel-dim" title="Just no rastrea combos, solo productos individuales">
                        —
                      </span>
                      <CopyableAmount
                        value={combo.bodegaPrice}
                        className={withCostSourceColor("text-right font-mono text-[13px] text-steel", combo.costSource)}
                        title={combo.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                      />
                      <CopyableAmount
                        value={combo.benistockPrice}
                        className={withCostSourceColor("text-right font-mono text-[13px] text-steel", combo.costSource)}
                        title={combo.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                      />
                      <CopyableAmount
                        value={combo.b2bPriceDefault}
                        className={withCostSourceColor("text-right font-mono text-[13px] font-bold text-teal border-l border-rule pl-3", combo.costSource)}
                        title={combo.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                      />
                      <CopyableAmount
                        value={combo.dropiPrice}
                        className={withCostSourceColor("text-right font-mono text-[13px] font-bold text-ink", combo.costSource)}
                        title={combo.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                      />
                      <CopyableAmount
                        value={combo.b2cPrice1Unit}
                        className={withCostSourceColor("text-right font-mono text-[13px] font-bold text-blue", combo.costSource)}
                        title={combo.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
                      />
                      <CopyableAmount
                        value={combo.b2cPrice2to11}
                        className={withCostSourceColor("text-right font-mono text-[13px] font-bold text-blue", combo.costSource)}
                        title={combo.costSource === "just" ? JUST_ESTIMATE_TITLE : undefined}
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
