"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { Search, MapPin } from "lucide-react";
import type * as Leaflet from "leaflet";

// Business is based in Guayaquil, Ecuador — center the map there and bias
// (not restrict) address search toward that area so results elsewhere in
// the world don't outrank the right one.
const GUAYAQUIL: [number, number] = [-2.1709, -79.9224];
const GUAYAQUIL_VIEWBOX = "-80.2,-1.8,-79.5,-2.5"; // lonMin,latMax,lonMax,latMin
const MARKER_ICON_BASE = "https://unpkg.com/leaflet@1.9.4/dist/images";

type SearchResult = { label: string; lat: number; lng: number };

function buildIcon(L: typeof Leaflet) {
  return L.icon({
    iconUrl: `${MARKER_ICON_BASE}/marker-icon.png`,
    iconRetinaUrl: `${MARKER_ICON_BASE}/marker-icon-2x.png`,
    shadowUrl: `${MARKER_ICON_BASE}/marker-shadow.png`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });
}

function isShortGoogleMapsLink(input: string) {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(input);
}

// Handles the common full-URL formats Google Maps produces when you copy a
// link from the address bar or "compartir" a pinned point. Shortened
// maps.app.goo.gl links get resolved server-side first (see
// isShortGoogleMapsLink below) since a browser can't follow that redirect
// itself across origins — this only runs on the resulting long URL.
function parseGoogleMapsUrl(input: string): { lat: number; lng: number } | null {
  const atMatch = input.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };

  const dataMatch = input.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (dataMatch) return { lat: parseFloat(dataMatch[1]), lng: parseFloat(dataMatch[2]) };

  try {
    const url = new URL(input);
    const q = url.searchParams.get("q") ?? url.searchParams.get("query");
    const qMatch = q?.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
    if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
  } catch {
    // not a valid absolute URL
  }
  return null;
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
  const [results, setResults] = useState<SearchResult[]>([]);

  const applyPoint = async (point: [number, number], zoom: number) => {
    const L = await import("leaflet");
    if (!mapInstance.current) return;
    mapInstance.current.setView(point, zoom);
    if (markerInstance.current) {
      markerInstance.current.setLatLng(point);
    } else {
      markerInstance.current = L.marker(point, { icon: buildIcon(L), draggable: true }).addTo(mapInstance.current);
      markerInstance.current.on("dragend", () => {
        const pos = markerInstance.current!.getLatLng();
        onChangeRef.current({ lat: pos.lat, lng: pos.lng });
      });
    }
    setHasPoint(true);
    onChangeRef.current({ lat: point[0], lng: point[1] });
  };

  useEffect(() => {
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapRef.current || mapInstance.current) return;

      const start: [number, number] = lat !== null && lng !== null ? [lat, lng] : GUAYAQUIL;
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
    const trimmed = search.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchErr("");
    setResults([]);

    if (isShortGoogleMapsLink(trimmed)) {
      try {
        const res = await fetch(`/api/resolve-maps-link?url=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        const coords = data?.resolvedUrl ? parseGoogleMapsUrl(data.resolvedUrl) : null;
        if (coords) {
          await applyPoint([coords.lat, coords.lng], 17);
        } else {
          setSearchErr(
            "No se pudo ubicar el punto exacto desde ese enlace. Ábrelo y, en la barra de direcciones, " +
              "copia la URL completa (la que tiene @-2.17,-79.92...) y pégala aquí, o marca el punto en el mapa."
          );
        }
      } catch {
        setSearchErr("No se pudo leer ese enlace. Prueba marcando el punto directamente en el mapa.");
      }
      setSearching(false);
      return;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      const coords = parseGoogleMapsUrl(trimmed);
      if (coords) {
        await applyPoint([coords.lat, coords.lng], 17);
      } else {
        setSearchErr("No se pudo leer ese enlace. Prueba marcando el punto directamente en el mapa.");
      }
      setSearching(false);
      return;
    }

    try {
      const searchOnce = async (query: string) => {
        const params = new URLSearchParams({
          format: "json",
          limit: "5",
          q: query,
          viewbox: GUAYAQUIL_VIEWBOX,
          bounded: "0",
        });
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
        return res.json();
      };

      let found = await searchOnce(trimmed);
      if (!found?.length && !/guayaquil|ecuador/i.test(trimmed)) {
        found = await searchOnce(`${trimmed}, Guayaquil, Ecuador`);
      }
      if (!found?.length) {
        setSearchErr(
          "No se encontró nada con ese nombre — muchos negocios pequeños no están mapeados. La forma más " +
            "confiable es abrir el lugar en la app de Google Maps, tocar «Compartir» y pegar aquí el enlace, " +
            "o marcar el punto directamente en el mapa."
        );
        return;
      }
      setResults(
        found.map((r: { display_name: string; lat: string; lon: string }) => ({
          label: r.display_name,
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
        }))
      );
    } catch {
      setSearchErr("No se pudo buscar. Intenta marcar el punto directamente en el mapa.");
    } finally {
      setSearching(false);
    }
  };

  const pickResult = async (r: SearchResult) => {
    setResults([]);
    setSearch(r.label);
    await applyPoint([r.lat, r.lng], 17);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <input
          className="flex-1 min-w-0 rounded border border-rule px-2.5 py-2 text-[13px]"
          placeholder="Buscar nombre del negocio, dirección, o pegar un enlace de Google Maps…"
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
      {results.length > 0 && (
        <div className="border border-rule rounded-md mb-2 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left flex items-start gap-1.5 px-2.5 py-2 text-[12px] hover:bg-cloud cursor-pointer border-b border-rule last:border-b-0"
              onClick={() => pickResult(r)}
            >
              <MapPin size={12} className="shrink-0 mt-0.5 text-steel" />
              <span>{r.label}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={mapRef} className="w-full rounded border border-rule" style={{ height: 260 }} />
      <div className="text-[11px] text-steel mt-1.5">
        {hasPoint
          ? "Punto marcado — haz clic en otro lugar del mapa para moverlo, o arrastra el marcador."
          : "Busca el negocio o la dirección, pega un enlace de Google Maps, o haz clic directamente en el mapa."}
      </div>
    </div>
  );
}
