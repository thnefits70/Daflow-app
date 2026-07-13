import type { SupplierDTO } from "@/components/suppliers/SuppliersPanel";

type SupplierRow = {
  id: string;
  name: string;
  contactName: string | null;
  location: string | null;
  category: string | null;
  notes: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  createdById: string | null;
  approvedById: string | null;
  createdAt: Date;
  contacts: { id: string; label: string; whatsapp: string }[];
  createdBy: { name: string } | null;
  approvedBy: { name: string } | null;
};

// Admin actions aren't linked to a real User row, so a null actor on an
// approved/created record just means "Administrador" did it.
export function toSupplierDTO(s: SupplierRow): SupplierDTO {
  return {
    id: s.id,
    name: s.name,
    contactName: s.contactName,
    location: s.location,
    category: s.category,
    notes: s.notes,
    status: s.status,
    rejectReason: s.rejectReason,
    createdByName: s.createdBy?.name ?? (s.createdById === null ? "Administrador" : null),
    approvedByName: s.approvedBy?.name ?? (s.status === "APPROVED" && s.approvedById === null ? "Administrador" : null),
    createdAt: s.createdAt.toISOString(),
    contacts: s.contacts.map((c) => ({ id: c.id, label: c.label, whatsapp: c.whatsapp })),
  };
}
