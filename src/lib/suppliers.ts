import type { SupplierDTO, ChannelPlatform } from "@/components/suppliers/SuppliersPanel";

type BankAccountRow = {
  id: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  holderIdType: string | null;
  holderIdNumber: string | null;
  createdAt: Date;
  createdById: string | null;
  createdBy: { name: string } | null;
};

type SupplierRow = {
  id: string;
  type: "SUPPLIER" | "CARRIER";
  name: string;
  location: string | null;
  locationLat: number | null;
  locationLng: number | null;
  category: string | null;
  notes: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  createdById: string | null;
  approvedById: string | null;
  createdAt: Date;
  contacts: { id: string; label: string; whatsapp: string }[];
  channels: { id: string; platform: string; url: string }[];
  createdBy: { name: string } | null;
  approvedBy: { name: string } | null;
  bankAccounts?: BankAccountRow[];
  _count?: { bankAccounts: number };
};

// Admin actions aren't linked to a real User row, so a null actor on an
// approved/created record just means "Administrador" did it.
//
// includeBankAccounts está separado de si `s.bankAccounts` viene cargado en
// la query — confirmado 2026-08-17: los datos bancarios son exclusivos del
// admin (ver canViewSupplierBankAccounts en guards.ts), así que el campo se
// omite del DTO por completo cuando este flag es false, en vez de solo
// ocultarlo en la UI. Como esta página es un Server Component, lo que no
// entra al DTO nunca viaja en las props serializadas al cliente.
// Confirmado 2026-08-18: pedido explícito del usuario — Jariel y Bryan
// pueden AGREGAR una cuenta bancaria sin poder VER las ya registradas de
// otros proveedores. Para que sepan si hace falta una sin exponer los
// datos, includeHasBankAccount expone solo un booleano (de un `_count`
// liviano, nunca de la fila completa) — separado de includeBankAccounts,
// que sigue siendo exclusivo de admin.
export function toSupplierDTO(s: SupplierRow, includeBankAccounts = false, includeHasBankAccount = false): SupplierDTO {
  const bankAccountsCount = s._count?.bankAccounts ?? s.bankAccounts?.length;
  return {
    id: s.id,
    type: s.type,
    name: s.name,
    location: s.location,
    locationLat: s.locationLat,
    locationLng: s.locationLng,
    category: s.category,
    notes: s.notes,
    status: s.status,
    rejectReason: s.rejectReason,
    createdByName: s.createdBy?.name ?? (s.createdById === null ? "Administrador" : null),
    approvedByName: s.approvedBy?.name ?? (s.status === "APPROVED" && s.approvedById === null ? "Administrador" : null),
    createdAt: s.createdAt.toISOString(),
    contacts: s.contacts.map((c) => ({ id: c.id, label: c.label, whatsapp: c.whatsapp })),
    channels: s.channels.map((c) => ({ id: c.id, platform: c.platform as ChannelPlatform, url: c.url })),
    bankAccounts:
      includeBankAccounts && s.bankAccounts
        ? s.bankAccounts.map((b) => ({
            id: b.id,
            bankName: b.bankName,
            bankAccountType: b.bankAccountType,
            bankAccountNumber: b.bankAccountNumber,
            bankAccountHolder: b.bankAccountHolder,
            holderIdType: (b.holderIdType as "RUC" | "CEDULA" | null) ?? null,
            holderIdNumber: b.holderIdNumber,
            createdByName: b.createdBy?.name ?? (b.createdById === null ? "Administrador" : null),
            createdAt: b.createdAt.toISOString(),
          }))
        : undefined,
    hasBankAccount: (includeBankAccounts || includeHasBankAccount) && bankAccountsCount !== undefined ? bankAccountsCount > 0 : undefined,
  };
}
