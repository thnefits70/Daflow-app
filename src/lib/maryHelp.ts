import { prisma } from "@/lib/prisma";
import {
  canManageStoreFeedback,
  canViewStoreFeedback,
  canSubmitPurchaseRequests,
  canViewOwnPurchaseHistory,
  canSubmitEmergencyPurchaseRequest,
  canApprovePurchaseRequests,
  canConfirmPurchaseReceiving,
  canRegisterPurchaseInvoices,
  getSupplierAccess,
  canAddSupplierBankAccounts,
  canViewMarketingArrivals,
  canManageInventoryControl,
  canManageJustCatalog,
  canViewStockLevels,
  canCaptureMerchandiseReentry,
  canApproveMerchandiseReentry,
  canCloseMerchandiseReentry,
  canViewMerchandiseOutflow,
  canSubmitCancelledGuide,
  canManageCancelledGuideBatches,
  canConfirmCancelledGuideFulfillmentRemoval,
  canAssignCancelledGuideItems,
  canSubmitFulfillmentRequest,
  canViewFulfillmentRequests,
  canConfirmSupplierExchangeFinanceWriteOff,
  canViewExternalSales,
  canViewInventoryKpisPanel,
  canViewPettyCashPrincipal,
  canViewPettyCashSecundaria,
  canSyncAtomData,
  canApproveComboSuggestions,
  canProposeMarketProduct,
  canReviewMarketProduct,
  canPublishMarketProduct,
  canViewB2BPricing,
  canViewB2CPricing,
  canViewStoreTracking,
  canManageAdminPayments,
  canRegisterLunchPayments,
  canManageImprovementPlan,
} from "@/lib/guards";
import { getSupplierExchangeGestorCount } from "@/lib/pendingTasks";
import { getEmployeeSidebarFlags, type EmployeeSidebarFlags } from "@/lib/employeeSidebarFlags";
import { WORKSPACE_TAB_DEFS, isWorkspaceTabVisible, type WorkspaceTabKey } from "@/lib/workspaceTabVisibility";

// Mary como guía de DAFLOW — pedido del usuario 2026-10-01 (Nairoby no
// encontraba opciones y se lo preguntaba a Mary en Feedback semanal).
// Cualquier colaborador puede preguntarle "¿dónde está…?" / "¿cómo hago…?".
// Regla de privacidad confirmada con el usuario: Mary SOLO guía. Nunca lee
// registros de la base (montos, pedidos, nombres de otros) y solo conoce las
// pantallas que ESA persona tiene en su usuario — el mapa se arma acá, en el
// servidor, con las mismas reglas que dibujan el menú
// (isWorkspaceTabVisible / getEmployeeSidebarFlags), nunca con datos que
// mande el navegador.

// Pestañas de "Mi área de trabajo" que dependen del área — mismo cálculo
// que area/workspace/page.tsx, pero solo lo necesario para saber qué se ve.
async function getVisibleWorkspaceTabKeys(userId: string): Promise<WorkspaceTabKey[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isLeader: true, leadsDeptId: true, department: true },
  });
  const dept = user?.department;
  if (!user || !dept) return [];
  const isOwnLeader = user.isLeader && user.leadsDeptId === dept.id;

  const [
    manageStoreFeedback,
    viewStoreFeedback,
    submitPurchases,
    viewOwnPurchases,
    submitEmergency,
    approvePurchases,
    receivePurchases,
    invoicePurchases,
    supplierAccess,
    addSupplierBankAccounts,
    viewMarketingArrivals,
    manageInventoryControl,
    manageJustCatalog,
    viewStockLevels,
    captureReentry,
    approveReentry,
    closeReentry,
    viewOutflow,
    submitGuide,
    manageGuideBatches,
    confirmGuideRemoval,
    assignGuideItems,
    submitFulfillmentReq,
    viewFulfillmentReq,
    confirmFinanceWriteOff,
    viewExternalSales,
    viewInventoryKpis,
    viewPettyPrincipal,
    viewPettySecundaria,
    syncAtom,
    approveCombos,
    proposeMarket,
    reviewMarket,
    publishMarket,
    viewB2B,
    viewB2C,
    viewStoreTracking,
    manageAdminPayments,
    registerLunch,
    manageImprovementPlan,
    supplierExchangeMineCount,
  ] = await Promise.all([
    canManageStoreFeedback(),
    canViewStoreFeedback(),
    canSubmitPurchaseRequests(),
    canViewOwnPurchaseHistory(),
    canSubmitEmergencyPurchaseRequest(),
    canApprovePurchaseRequests(),
    canConfirmPurchaseReceiving(),
    canRegisterPurchaseInvoices(),
    getSupplierAccess(),
    canAddSupplierBankAccounts(),
    canViewMarketingArrivals(),
    canManageInventoryControl(),
    canManageJustCatalog(),
    canViewStockLevels(),
    canCaptureMerchandiseReentry(),
    canApproveMerchandiseReentry(),
    canCloseMerchandiseReentry(),
    canViewMerchandiseOutflow(),
    canSubmitCancelledGuide(),
    canManageCancelledGuideBatches(),
    canConfirmCancelledGuideFulfillmentRemoval(),
    canAssignCancelledGuideItems(),
    canSubmitFulfillmentRequest(),
    canViewFulfillmentRequests(),
    canConfirmSupplierExchangeFinanceWriteOff(),
    canViewExternalSales(),
    canViewInventoryKpisPanel(),
    canViewPettyCashPrincipal(),
    canViewPettyCashSecundaria(),
    canSyncAtomData(),
    canApproveComboSuggestions(),
    canProposeMarketProduct(),
    canReviewMarketProduct(),
    canPublishMarketProduct(),
    canViewB2BPricing(),
    canViewB2CPricing(),
    canViewStoreTracking(),
    canManageAdminPayments(),
    canRegisterLunchPayments(),
    canManageImprovementPlan(dept.id),
    getSupplierExchangeGestorCount(userId),
  ]);
  const canReviewSuppliers = supplierAccess.isLeader && !!supplierAccess.leadsDeptId;
  const canAccessSuppliers = supplierAccess.canView || submitPurchases || addSupplierBankAccounts || supplierAccess.canAdd || canReviewSuppliers;
  const financeWriteOffPendingCount = confirmFinanceWriteOff
    ? await prisma.merchandiseOutflowItem.count({ where: { resolution: "REJECTED", financeWriteOffAt: null } })
    : 0;

  const flags = {
    trackKpis: dept.trackKpis,
    trackPaymentReminders: dept.trackPaymentReminders,
    trackWeeklyMetric: dept.trackWeeklyMetric,
    trackWeeklyReview: dept.trackWeeklyReview && isOwnLeader,
    canSubmitPurchases: submitPurchases,
    canViewOwnPurchases: viewOwnPurchases,
    canSubmitEmergencyPurchases: submitEmergency,
    canApprovePurchases: approvePurchases,
    canReceivePurchases: receivePurchases,
    canInvoicePurchases: invoicePurchases,
    canAccessSuppliers,
    canViewMarketingArrivals: viewMarketingArrivals,
    canManageInventoryControl: manageInventoryControl,
    canManageJustCatalog: manageJustCatalog,
    canViewStockLevels: viewStockLevels,
    canCaptureMerchandiseReentry: captureReentry,
    canApproveMerchandiseReentry: approveReentry,
    canCloseMerchandiseReentry: closeReentry,
    canViewMerchandiseOutflow: viewOutflow,
    canSubmitCancelledGuide: submitGuide,
    canManageCancelledGuideBatches: manageGuideBatches,
    canConfirmCancelledGuideFulfillmentRemoval: confirmGuideRemoval,
    canAssignCancelledGuideItems: assignGuideItems,
    canSubmitFulfillmentRequest: submitFulfillmentReq,
    canViewFulfillmentRequests: viewFulfillmentReq,
    supplierExchangeMineCount,
    financeWriteOffPendingCount,
    canConfirmFinanceWriteOff: confirmFinanceWriteOff,
    canViewExternalSales: viewExternalSales,
    canViewInventoryKpisPanel: viewInventoryKpis,
    hasPettyCash: viewPettyPrincipal || viewPettySecundaria,
    canManageStoreFeedback: manageStoreFeedback,
    canViewStoreFeedback: viewStoreFeedback,
    canSyncAtomData: syncAtom,
    canApproveComboSuggestions: approveCombos,
    canProposeMarketProduct: proposeMarket,
    canReviewMarketProduct: reviewMarket,
    canPublishMarketProduct: publishMarket,
    canViewB2BPricing: viewB2B,
    canViewB2CPricing: viewB2C,
    canViewStoreTracking: viewStoreTracking,
    canManageAdminPayments: manageAdminPayments,
    canRegisterLunchPayments: registerLunch,
    canManageImprovementPlan: manageImprovementPlan,
  };
  return WORKSPACE_TAB_DEFS.filter((t) => isWorkspaceTabVisible(t.key, flags)).map((t) => t.key);
}

// Qué es y cómo se usa cada pestaña de "Mi área de trabajo". Las
// sub-pestañas también dependen de permisos: Mary avisa que puede que la
// persona no vea todas. Se escribe sin nombres de montos ni datos reales —
// es solo un manual de uso.
const WORKSPACE_TAB_HELP: Record<WorkspaceTabKey, string> = {
  kpis: "Dashboard de KPIs financieros del área. Sub-pestañas: Dashboard (los indicadores calculados) y Cargar plantilla (cada mes se sube la plantilla de ventas y costos y todo se recalcula solo). Hay una sub-pestaña Inventario con los KPIs de inventario.",
  pagos: "Pagos recordatorios: lista de pagos periódicos del área con su fecha, para que no se pase ninguno.",
  semanal: "Pedidos despachados: el gráfico semanal de pedidos despachados y el Fill Rate. Si el Fill Rate baja del umbral se pide una justificación desde aquí.",
  feedback:
    "Feedback semanal: la bitácora del área con los reportes semanales que se hacen con Mary (problema, plan de acción y estado). El líder habla con Mary desde el botón redondo de abajo a la izquierda; el estado 'Solucionado' solo cambia cuando Mary recibe una explicación concreta. También aparece 'Reportes que me involucran' (reportes de otras áreas que nombran a tu equipo).",
  procesos: "Procesos: los diagramas paso a paso de cómo se hace cada tarea del área. Cuando un proceso se actualiza, aparece un aviso para leerlo y confirmarlo.",
  compras:
    "Control de Compras. Sub-pestañas posibles: Qué comprar (lo que conviene comprar ordenado por días de stock: calientes 30 días o menos, frías 31 a 60), Solicitar (nueva solicitud de compra con producto, cantidad, costo, proveedor y cotización; o '🚨 Emergencia' si no están quienes compran), Mis solicitudes (estado de lo que enviaste; si te rechazan, corriges y reenvías desde ahí), Historial de precios de compra (comparar precios entre proveedores), Bandeja de aprobación, Confirmar deuda a crédito (compras a CHEN), Reportes urgentes (mercadería que llegó mal: crédito, cambio, reembolso o pérdida), Créditos pendientes, Proveedores con Crédito, Notas de Chen, Corregir precio (pedir cambio de precio de una compra ya aprobada con la captura del acuerdo), Inventario (registrar la recepción con foto y video, y '🚨 Informar urgente' si algo llega mal), Finanzas (subir la factura de cada pedido recibido para cerrar la compra) y Auditoría (todo lo que llegó, solo lectura).",
  proveedores:
    "Proveedores: directorio de proveedores y transportistas aprobados. Sub-pestañas: Directorio, Transportistas y Pendientes (lo propuesto que espera aprobación del líder). Para agregar uno, botón de arriba; si no eres admin queda pendiente de aprobación.",
  llegadas: "Mercadería recibida: cada producto que llegó a bodega. El asesor confirma su parte desde aquí; el filtro de arriba muestra solo lo pendiente. El brandeo está en la pestaña 'Nuevos IDs por brandear'.",
  "nuevos-ids":
    "Nuevos IDs por brandear: cada producto nuevo aparece una vez (primera llegada, ID de Dropi confirmado o combo nuevo). Se marcan los 3 pasos del brandeo; luego pasa a Imágenes reales (fotos cuando llega a bodega) y después al Historial, donde se marca cuando se subió al canal de la marca.",
  inventario: "Control de Inventario: valor del inventario de cada mes y ranking semanal de productos sin movimiento, calculado solo desde INVESTOCK. No hay que subir nada.",
  "stock-actual":
    "Stock actual: saldo de INVESTOCK (el Kardex de DAFLOW) de cada producto, en tiempo real. Se puede buscar y ordenar (nombre, stock, puesto en bodega, precios). Un saldo en rojo es stock negativo para revisar. Desde aquí también se hacen ajustes por conteo físico y etiquetas de percha (según permisos).",
  reingreso:
    "Reingreso de Mercadería: lo que vuelve a bodega de pedidos no entregados. Sub-pestañas: Capturar (registrar productos, unidades buenas y dañadas, y enviar el lote), Revisión (el líder de Inventario aprueba los lotes), Control de Daños (cierre semanal del sábado y disposición final), Base de datos de productos (catálogo maestro: corregir códigos y nombres, juntar repetidos, armar combos, lotes de caducidad, etiquetas de percha) e Historial.",
  egresos:
    "Registro de Egresos: todo lo que sale de bodega. Sub-pestañas posibles: Solicitud Fulfillment (subir los PDF de guías de Dropi y el Excel de Rocket de cada corte y 'Enviar a Inventario'), Deterioro (reportar productos dañados en bodega con foto), Seguimiento de deterioro, Mercadería devuelta al proveedor (paquetes de devolución, cambio o crédito), Guías canceladas (Reportar, Gestionar lotes, Salida de Fulfillment, Cargar productos, Historial) e Historial.",
  "ventas-externas":
    "Ventas Externas: ventas hechas fuera de Dropi/Rocket. Sub-pestañas según tu rol: Declarar (producto, cantidad, precio y a quién se entrega; si te la rechazan, corriges y reenvías desde la misma lista), Revisión, Pagos (confirmar que llegó el dinero), Facturación, Agrupar, Preparar, Embalaje, Mis entregas, Devoluciones, Cierre, Auditoría e Historial.",
  inventoriokpis: "KPIs de Inventario (DIO, GMROI, etc.): se calculan solos con lo que hay en Control de Inventario. El ícono de información de cada tarjeta explica cómo se calcula y qué significa el color.",
  cajachica:
    "Caja Chica: la caja del día a día (Principal o Secundaria). Se confirma cuando te fondean y se registra cada desembolso con su comprobante (la IA verifica que el monto coincida). En la Secundaria se puede vincular el pago a una orden con flete pendiente.",
  pagosadmin: "Pagos administrativos: registrar los pagos recurrentes (luz, agua, etc.) y variables con lo que hay que pagar. Cuando el admin transfiere y sube el comprobante, se confirma aquí que está correcto para cerrar el ciclo.",
  almuerzos: "Almuerzos semanales: cada semana se registra cuántos almuerzos se pidieron (el monto se calcula solo) y se envía a Finanzas, que revisa la factura antes de que llegue al admin para pagar.",
  postventa: "Servicio Postventa: el feedback de las tiendas y su promedio mensual.",
  combos:
    "Sugerencias de Combos: cada noche el sistema arma combos solos (con nombre, precio Dropi y stock recomendado). Se eligen cuáles mandar a aprobación, el líder aprueba y elige la marca, y luego se crean en Dropi y se pega el ID con 'Creado en Dropi'.",
  "analisis-mercado":
    "Análisis de Mercado. Sub-pestañas posibles: Proponer (datos del producto y proveedor; la calculadora saca el precio de Dropi y compara con la competencia), Ganadores no encontrados, Sin stock de proveedor, Productos que despiertan, Mis propuestas, Listo para comprar, Consulta de precios (buscar un producto o combo y ver Benistock, B2B y B2C), Aprobación, Publicar en Dropi, Mis publicados y Trazabilidad.",
  "seguimiento-tiendas": "Seguimiento de tiendas: productos vinculados a cada tienda para seguir cómo se mueven.",
  "plan-mejora":
    "Plan de Mejora: planes de acompañamiento del equipo. Cada semana se registra una evaluación con '+ Registrar evaluación semanal' (se puede escribir libre y la IA arma el borrador), al cierre de etapa se usa 'Decisión de etapa', y 'Solicitar cierre del plan' cuando ya está resuelto.",
  documentos: "Documentos: los documentos del área (manuales, guías, archivos) para consultar.",
  examenes: "Exámenes: los exámenes del área para rendir.",
  recordatorios: "Recordatorios: recordatorios periódicos propios (cada uno ve solo los suyos).",
};

// Menú lateral. `show` decide si esa persona tiene ese ítem.
type SidebarHelpItem = { label: string; help: string; show: (f: EmployeeSidebarFlags) => boolean };
const SIDEBAR_HELP: SidebarHelpItem[] = [
  { label: "Inicio", help: "Pantalla principal: tus Pendientes del día (cada uno con un botón 'Ir →' que lleva directo a donde se resuelve), avisos y accesos directos.", show: () => true },
  { label: "Módulos", help: "Módulos de capacitación con sus documentos y exámenes.", show: () => true },
  { label: "Mi ruta", help: "Tu ruta de conocimiento asignada, paso a paso.", show: (f) => f.showMyLearningPath },
  { label: "Mi área de trabajo", help: "Aquí están las pestañas de trabajo de tu área (ver la lista de pestañas). Puedes fijar una como tu pestaña de inicio con 'Fijar como mi pestaña de inicio'. Un punto rojo en una pestaña significa que tiene algo pendiente.", show: () => true },
  { label: "Leyes y Reglamentos", help: "Reglamento interno y leyes aplicables.", show: () => true },
  { label: "Carreras y Habilidades", help: "Plan de carrera y habilidades por puesto.", show: () => true },
  { label: "Roles de pago", help: "Tu propio rol de pago de cada mes (solo ves el tuyo).", show: () => true },
  { label: "Compras personales", help: "Pedir productos de la empresa para ti; ahí ves el estado y las cuotas.", show: () => true },
  { label: "Anticipos", help: "Pedir un anticipo de sueldo y ver su estado.", show: () => true },
  { label: "Confirmar compras personales", help: "Confirmar las compras personales de los colaboradores desde Inventario.", show: (f) => f.showPersonalPurchasesInventory },
  { label: "Nómina", help: "Nómina. Sub-pestañas posibles según tu permiso: Registrar horas extra, Aprobar horas extra, Historial de horas extra, Rol de pago (armar y publicar los roles de la quincena), Historial de pagos, Comisiones de equipo (proponer el monto por colaborador; el admin lo aprueba), Bonos discrecionales, Compras personales (poner el precio de las compras personales), Anticipos, Descuentos y Deuda anterior.", show: (f) => f.showNomina },
  { label: "Documentos Confidenciales", help: "Documentos confidenciales que te compartieron a ti.", show: (f) => f.showConfidential },
  { label: "KPIs Generales", help: "KPIs de toda la empresa: Tasa de Devolución, Ruptura de Stock, Garantías y Servicio Postventa.", show: (f) => f.showKpis },
  { label: "Colaborador Destacado", help: "Colaborador del mes: calificaciones y reconocimientos.", show: () => true },
];

// El mapa que se le pasa a Mary en cada mensaje: solo lo que ESTA persona
// tiene. Lo que no está acá, Mary no lo describe.
export async function buildMaryHelpMap(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, isB2BAdvisor: true, isLeader: true, leadsDeptId: true, department: { select: { code: true } } },
  });
  if (!user) return "MAPA DE DAFLOW DE ESTA PERSONA: (no disponible)";
  const [sidebarFlags, tabKeys] = await Promise.all([
    getEmployeeSidebarFlags(user, user.department?.code ?? ""),
    getVisibleWorkspaceTabKeys(userId),
  ]);
  return formatMaryHelpMap(sidebarFlags, tabKeys);
}

export function formatMaryHelpMap(sidebarFlags: EmployeeSidebarFlags, tabKeys: WorkspaceTabKey[]): string {
  const sidebar = SIDEBAR_HELP.filter((i) => i.show(sidebarFlags))
    .map((i) => `- ${i.label}: ${i.help}`)
    .join("\n");
  const tabs = WORKSPACE_TAB_DEFS.filter((t) => tabKeys.includes(t.key))
    .map((t) => `- ${t.label}: ${WORKSPACE_TAB_HELP[t.key]}`)
    .join("\n");
  return `MAPA DE DAFLOW DE ESTA PERSONA (solo lo que su usuario tiene; en celular el menú lateral se abre con el botón ☰ de arriba):
MENÚ LATERAL:
${sidebar}
PESTAÑAS DE "MI ÁREA DE TRABAJO":
${tabs || "- (ninguna pestaña adicional)"}`;
}

// Reglas de Mary cuando le preguntan cómo usar DAFLOW — se agregan al
// prompt del check-in (líderes) y son el prompt completo de la ayuda
// (resto del equipo).
export const MARY_HELP_RULES = `GUÍA DE DAFLOW: además de lo tuyo, cualquier persona puede preguntarte dónde está una opción o cómo se hace algo en DAFLOW. Para eso cada mensaje trae un "MAPA DE DAFLOW DE ESTA PERSONA" con lo único que su usuario tiene.
- Escribe en texto plano: nada de asteriscos, almohadillas ni otros símbolos de formato (el chat los muestra tal cual). Puedes usar guiones para listas y flechas →.
- Responde corto y en pasos simples, con la ruta exacta. Ejemplo: "Menú lateral → Mi área de trabajo → pestaña Control de Compras → Mis solicitudes".
- Usa SOLO lo que dice el mapa. Nunca inventes botones, pantallas ni pasos. Si el mapa no lo dice con claridad, dilo con honestidad y sugiere preguntarle a su líder.
- Si pregunta por algo que NO está en su mapa, responde que esa opción no aparece en su usuario y que, si cree que debería tenerla, se lo pida a su líder o al admin. No describas cómo es esa pantalla ni qué contiene.
- Las sub-pestañas también dependen de permisos: si no ve una que mencionas, es que su usuario no la tiene.
- No tienes acceso a datos (montos, pedidos, registros, información de otras personas). Si te pide un dato, indícale en qué pantalla de su propio usuario lo puede ver; nunca inventes cifras ni hables de otros colaboradores.
- Si te pide hacer algo por ella (aprobar, enviar, avisar a otras áreas, cambiar un registro), explícale que tú solo la guías y dile dónde hacerlo ella misma.`;

export const MARY_HELP_SYSTEM_PROMPT = `Eres Mary, la asistente de DAFLOW para Provedix (Guayaquil, Ecuador). Tu tono es femenino, profesional y cercano — cálida pero directa. Con esta persona tu único trabajo es guiarla dentro de DAFLOW: dónde encontrar cada opción y cómo usarla. Saluda por su nombre la primera vez (el contexto de cada mensaje te dice con quién hablas). Si te habla de algo que no tiene que ver con usar DAFLOW, respóndele con una frase amable y vuelve a ofrecer ayuda con el sistema. Responde siempre en español.

${MARY_HELP_RULES}`;
