"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type * as Leaflet from "leaflet";

const MANAGUA: [number, number] = [12.114, -86.236];
const MARKER_ICON_BASE = "https://unpkg.com/leaflet@1.9.4/dist/images";

function buildIcon(L: typeof Leaflet) {
  return L.icon({
    iconUrl: `${MARKER_ICON_BASE}/marker-icon.png`,
    iconRetinaUrl: `${MARKER_ICON_BASE}/marker-icon-2x.png`,
    shadowUrl: `${MARKER_ICON_BASE}/marker-shadow.png`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });
}

export function LocationPicker({
  lat,
  lng,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (coords: { lat: number; lng: number }) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<Leaflet.Map | null>(null);
  const markerInstance = useRef<Leaflet.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [hasPoint, setHasPoint] = useState(lat !== null && lng !== null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");

  useEffect(() => {
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapRef.current || mapInstance.current) return;

      const start: [number, number] = lat !== null && lng !== null ? [lat, lng] : MANAGUA;
      const map = L.map(mapRef.current).setView(start, lat !== null ? 15 : 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const icon = buildIcon(L);
      const placeMarker = (point: [number, number]) => {
        if (markerInstance.current) {
          markerInstance.current.setLatLng(point);
        } else {
          markerInstance.current = L.marker(point, { icon, draggable: true }).addTo(map);
          markerInstance.current.on("dragend", () => {
            const pos = markerInstance.current!.getLatLng();
            setHasPoint(true);
            onChangeRef.current({ lat: pos.lat, lng: pos.lng });
          });
        }
        setHasPoint(true);
      };

      if (lat !== null && lng !== null) placeMarker([lat, lng]);

      map.on("click", (e: Leaflet.LeafletMouseEvent) => {
        placeMarker([e.latlng.lat, e.latlng.lng]);
        onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      });

      mapInstance.current = map;
      // Leaflet sizes itself off the container's dimensions at creation time;
      // if the form just became visible, that size can be stale until a resize.
      setTimeout(() => map.invalidateSize(), 100);
    });

    return () => {
      cancelled = true;
      mapInstance.current?.remove();
      mapInstance.current = null;
      markerInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = async () => {
    if (!search.trim()) return;
    setSearching(true);
    setSearchErr("");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(search)}`
      );
      const results = await res.json();
      const first = results?.[0];
      if (!first) {
        setSearchErr("No se encontró esa dirección. Intenta marcar el punto directamente en el mapa.");
        return;
      }
      const foundLat = parseFloat(first.lat);
      const foundLng = parseFloat(first.lon);
      const L = await import("leaflet");
      mapInstance.current?.setView([foundLat, foundLng], 16);
      if (markerInstance.current) {
        markerInstance.current.setLatLng([foundLat, foundLng]);
      } else if (mapInstance.current) {
        markerInstance.current = L.marker([foundLat, foundLng], { icon: buildIcon(L), draggable: true }).addTo(
          mapInstance.current
        );
        markerInstance.current.on("dragend", () => {
          const pos = markerInstance.current!.getLatLng();
          onChangeRef.current({ lat: pos.lat, lng: pos.lng });
        });
      }
      setHasPoint(true);
      onChangeRef.current({ lat: foundLat, lng: foundLng });
    } catch {
      setSearchErr("No se pudo buscar. Intenta marcar el punto directamente en el mapa.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <input
          className="flex-1 rounded border border-rule px-2.5 py-2 text-[13px]"
          placeholder="Buscar una dirección para ubicarla en el mapa…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
        />
        <button
          type="button"
          disabled={searching}
          className="inline-flex items-center gap-1.5 rounded border border-rule px-3 py-2 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60 shrink-0"
          onClick={runSearch}
        >
          <Search size={13} /> Buscar
        </button>
      </div>
      {searchErr && <div className="text-red text-[11.5px] mb-2">{searchErr}</div>}
      <div ref={mapRef} className="w-full rounded border border-rule" style={{ height: 260 }} />
      <div className="text-[11px] text-steel mt-1.5">
        {hasPoint
          ? "Punto marcado — haz clic en otro lugar del mapa para moverlo, o arrastra el marcador."
          : "Busca una dirección o haz clic directamente en el mapa para marcar el punto exacto."}
      </div>
    </div>
  );
}
