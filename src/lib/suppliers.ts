import type { SupplierDTO, ChannelPlatform } from "@/components/suppliers/SuppliersPanel";

type SupplierRow = {
  id: string;
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
};

// Admin actions aren't linked to a real User row, so a null actor on an
// approved/created record just means "Administrador" did it.
export function toSupplierDTO(s: SupplierRow): SupplierDTO {
  return {
    id: s.id,
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
  };
}
