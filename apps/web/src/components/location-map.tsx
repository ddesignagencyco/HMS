"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, LocateFixed, MapPin, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { requestDeviceLocation } from "@/features/search/location";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  subtitle?: string;
  badge?: string | null;
};

export type LocationMapProps = {
  center?: { lat: number; lng: number };
  zoom?: number;
  selectedLocation?: { lat: number; lng: number } | null;
  onSelectLocation?: (point: { lat: number; lng: number }) => void;
  markers?: MapMarker[];
  draggable?: boolean;
  readOnly?: boolean;
  className?: string;
  height?: string;
  hint?: string;
};

const DEFAULT_CENTER = { lat: 31.5204, lng: 74.3587 }; // Lahore fallback

export function LocationMap({
  center,
  zoom = 13,
  selectedLocation,
  onSelectLocation,
  markers = [],
  draggable = true,
  readOnly = false,
  className,
  height = "280px",
  hint,
}: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const providerMarkersRef = useRef<any[]>([]);
  const [mounted, setMounted] = useState(false);

  const effectiveCenter = selectedLocation ?? center ?? DEFAULT_CENTER;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    let isDisposed = false;

    async function initMap() {
      // Dynamic import of leaflet so it never runs during Next.js SSR
      const L = await import("leaflet");

      if (isDisposed || !containerRef.current) return;

      // Prevent duplicate initialization on the same container
      if ((containerRef.current as any)._leaflet_id) {
        return;
      }

      const map = L.map(containerRef.current, {
        center: [effectiveCenter.lat, effectiveCenter.lng],
        zoom,
        zoomControl: false,
        attributionControl: false,
      });

      mapInstanceRef.current = map;

      // Standard OSM Tile layer
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      // Compact attribution in corner
      L.control
        .attribution({ position: "bottomright", prefix: false })
        .addAttribution('&copy; <a href="https://osm.org" target="_blank" rel="noopener">OSM</a>')
        .addTo(map);

      // SVG Pin for Selected Location
      const createSelectedPinIcon = () =>
        L.divIcon({
          className: "custom-user-marker",
          html: `
            <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:${!readOnly && draggable ? "grab" : "default"};">
              <div style="width:34px;height:34px;border-radius:9999px;background:#2563eb;border:2.5px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 25px -5px rgba(37,99,235,0.5);color:white;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
              </div>
              <div style="width:8px;height:8px;border-radius:9999px;background:#1d4ed8;margin-top:-2px;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>
            </div>
          `,
          iconSize: [34, 40],
          iconAnchor: [0, 0],
        });

      // Pin on map click
      if (!readOnly && onSelectLocation) {
        map.on("click", (e: any) => {
          const lat = Number(e.latlng.lat.toFixed(5));
          const lng = Number(e.latlng.lng.toFixed(5));
          onSelectLocation({ lat, lng });
        });
      }

      // Add selected marker if exists
      if (selectedLocation) {
        const marker = L.marker([selectedLocation.lat, selectedLocation.lng], {
          icon: createSelectedPinIcon(),
          draggable: !readOnly && draggable,
        }).addTo(map);

        if (!readOnly && draggable && onSelectLocation) {
          marker.on("dragend", (e: any) => {
            const pos = e.target.getLatLng();
            onSelectLocation({
              lat: Number(pos.lat.toFixed(5)),
              lng: Number(pos.lng.toFixed(5)),
            });
          });
        }

        userMarkerRef.current = marker;
      }

      // Add provider markers
      renderProviderMarkers(L, map);

      // Invalidate size once rendered
      setTimeout(() => {
        if (!isDisposed && map) {
          map.invalidateSize();
        }
      }, 250);
    }

    function renderProviderMarkers(L: any, map: any) {
      providerMarkersRef.current.forEach((m) => m.remove());
      providerMarkersRef.current = [];

      const createProviderIcon = (badge: string | null | undefined) =>
        L.divIcon({
          className: "custom-provider-marker",
          html: `
            <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:pointer;">
              <div style="padding:4px 8px;border-radius:9999px;background:#0b1b3f;border:2px solid white;color:white;font-size:11px;font-weight:600;display:flex;align-items:center;gap:4px;box-shadow:0 4px 12px rgba(11,27,63,0.35);white-space:nowrap;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a8.5 8.5 0 0 1 13 0"/></svg>
                ${badge ? `<span>★</span>` : ""}
              </div>
            </div>
          `,
          iconSize: [40, 30],
          iconAnchor: [0, 0],
        });

      markers.forEach((m) => {
        const marker = L.marker([m.lat, m.lng], {
          icon: createProviderIcon(m.badge),
        }).addTo(map);

        if (m.title || m.subtitle) {
          marker.bindPopup(`
            <div style="font-family:sans-serif;padding:2px 0;">
              <strong style="color:#0b1b3f;font-size:13px;display:block;">${m.title ?? "Professional"}</strong>
              ${m.subtitle ? `<span style="color:#64748b;font-size:11px;display:block;margin-top:2px;">${m.subtitle}</span>` : ""}
            </div>
          `);
        }

        providerMarkersRef.current.push(marker);
      });
    }

    void initMap();

    return () => {
      isDisposed = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [mounted]);

  // Synchronize selectedLocation changes
  useEffect(() => {
    if (!mapInstanceRef.current || !mounted) return;
    const map = mapInstanceRef.current;

    async function updatePin() {
      const L = await import("leaflet");

      if (selectedLocation) {
        if (userMarkerRef.current) {
          userMarkerRef.current.setLatLng([selectedLocation.lat, selectedLocation.lng]);
        } else {
          const marker = L.marker([selectedLocation.lat, selectedLocation.lng], {
            icon: L.divIcon({
              className: "custom-user-marker",
              html: `
                <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:${!readOnly && draggable ? "grab" : "default"};">
                  <div style="width:34px;height:34px;border-radius:9999px;background:#2563eb;border:2.5px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 25px -5px rgba(37,99,235,0.5);color:white;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                    </svg>
                  </div>
                  <div style="width:8px;height:8px;border-radius:9999px;background:#1d4ed8;margin-top:-2px;"></div>
                </div>
              `,
              iconSize: [34, 40],
              iconAnchor: [0, 0],
            }),
            draggable: !readOnly && draggable,
          }).addTo(map);

          if (!readOnly && draggable && onSelectLocation) {
            marker.on("dragend", (e: any) => {
              const pos = e.target.getLatLng();
              onSelectLocation({
                lat: Number(pos.lat.toFixed(5)),
                lng: Number(pos.lng.toFixed(5)),
              });
            });
          }

          userMarkerRef.current = marker;
        }
        map.setView([selectedLocation.lat, selectedLocation.lng], map.getZoom() < 13 ? 13 : map.getZoom());
      } else if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
    }

    void updatePin();
  }, [selectedLocation, readOnly, draggable, onSelectLocation, mounted]);

  const [locatingLive, setLocatingLive] = useState(false);

  // Live GPS device location helper (like in Google Maps)
  const handleGetLiveLocation = async () => {
    setLocatingLive(true);
    try {
      const outcome = await requestDeviceLocation();
      if (outcome.status === "granted") {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([outcome.point.lat, outcome.point.lng], 15, { animate: true });
        }
        onSelectLocation?.(outcome.point);
      }
    } finally {
      setLocatingLive(false);
    }
  };

  // Center button helper
  const handleRecenter = () => {
    if (mapInstanceRef.current && selectedLocation) {
      mapInstanceRef.current.setView([selectedLocation.lat, selectedLocation.lng], 14, { animate: true });
    }
  };

  const handleZoomIn = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomIn();
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomOut();
  };

  if (!mounted) {
    return (
      <div
        style={{ height }}
        className={cn(
          "relative flex items-center justify-center rounded-[12px] border border-line bg-surface-2 text-muted animate-pulse",
          className,
        )}
      >
        <div className="flex items-center gap-2 text-xs font-medium">
          <MapPin className="size-4 text-primary animate-bounce" />
          <span>Loading map…</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[12px] border border-line shadow-xs group",
        className,
      )}
      style={{ height }}
    >
      <div ref={containerRef} className="size-full z-0" />

      {/* Floating map controls */}
      <div className="absolute end-3 top-3 z-[400] flex flex-col gap-1.5">
        <button
          type="button"
          onClick={handleZoomIn}
          aria-label="Zoom in"
          className="grid size-8 place-items-center rounded-md border border-line/80 bg-white/95 text-navy shadow-sm backdrop-blur-sm transition-all hover:bg-white active:scale-95"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          aria-label="Zoom out"
          className="grid size-8 place-items-center rounded-md border border-line/80 bg-white/95 text-navy shadow-sm backdrop-blur-sm transition-all hover:bg-white active:scale-95"
        >
          <ZoomOut className="size-4" />
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() => void handleGetLiveLocation()}
            disabled={locatingLive}
            aria-label="My current location"
            title="My current location"
            className="grid size-8 place-items-center rounded-md border border-line/80 bg-white/95 text-primary shadow-sm backdrop-blur-sm transition-all hover:bg-blue-50 active:scale-95 disabled:opacity-50"
          >
            {locatingLive ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : (
              <Crosshair className="size-4 text-primary" />
            )}
          </button>
        )}
        {selectedLocation ? (
          <button
            type="button"
            onClick={handleRecenter}
            aria-label="Recenter on pin"
            className="grid size-8 place-items-center rounded-md border border-line/80 bg-white/95 text-primary shadow-sm backdrop-blur-sm transition-all hover:bg-blue-50 active:scale-95"
          >
            <LocateFixed className="size-4" />
          </button>
        ) : null}
      </div>

      {/* Interactive Helper Banner / Hint */}
      {!readOnly && (
        <div className="pointer-events-none absolute bottom-2.5 inset-x-2.5 z-[400] flex justify-center">
          <div className="rounded-full bg-navy/90 px-3 py-1 text-[11px] font-medium text-white shadow-md backdrop-blur-sm flex items-center gap-1.5">
            <MapPin className="size-3 text-yellow-400" />
            <span>{hint ?? "Click anywhere or drag the pin to set location"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
