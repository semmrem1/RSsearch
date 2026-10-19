import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface KartenPunkt {
  id: string;
  lat: number;
  lng: number;
  /** false: nur Ort bekannt, Marker gestrichelt */
  genau: boolean;
  label: string;
  farbe: string;
  popupHtml?: string;
}

interface Props {
  punkte: KartenPunkt[];
  hoehe: number | string;
  /** Detailansicht: Marker verschiebbar, Rückgabe der neuen Position */
  onVerschoben?: (id: string, lat: number, lng: number) => void;
  onNavigieren?: (id: string) => void;
  zoom?: number;
}

const ATTRIBUTION = '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener">swisstopo</a>';
const SEE_ZENTRUM: L.LatLngExpression = [47.25, 8.65];

function wmts(layer: string, ext: string, maxNative: number): L.TileLayer {
  return L.tileLayer('https://wmts.geo.admin.ch/1.0.0/' + layer + '/default/current/3857/{z}/{x}/{y}.' + ext, {
    attribution: ATTRIBUTION,
    maxNativeZoom: maxNative,
    maxZoom: 20,
  });
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function icon(p: KartenPunkt): L.DivIcon {
  return L.divIcon({
    className: 'pin-wrap',
    html: '<span class="pin' + (p.genau ? '' : ' ungenau') + '" style="--pin:' + p.farbe + '">' + escape(p.label) + '</span>',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

export default function Karte({ punkte, hoehe, onVerschoben, onNavigieren, zoom }: Props) {
  const box = useRef<HTMLDivElement | null>(null);
  const karte = useRef<L.Map | null>(null);
  const ebene = useRef<L.LayerGroup | null>(null);
  const bewegt = useRef(false);
  const navRef = useRef(onNavigieren);
  const verschobenRef = useRef(onVerschoben);
  useEffect(() => { navRef.current = onNavigieren; verschobenRef.current = onVerschoben; });

  useEffect(() => {
    if (box.current === null) { return; }
    const m = L.map(box.current, { center: SEE_ZENTRUM, zoom: 11, scrollWheelZoom: true });
    const karteLayer = wmts('ch.swisstopo.pixelkarte-farbe', 'jpeg', 18);
    const luftbild = wmts('ch.swisstopo.swissimage', 'jpeg', 19);
    karteLayer.addTo(m);
    L.control.layers({ Karte: karteLayer, Luftbild: luftbild }, undefined, { position: 'topright' }).addTo(m);
    ebene.current = L.layerGroup().addTo(m);
    karte.current = m;

    // Links im Popup, die innerhalb der App navigieren
    const klick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t === null) { return; }
      const a = t.closest('[data-nav]');
      if (a !== null && navRef.current !== undefined) {
        e.preventDefault();
        navRef.current(a.getAttribute('data-nav') as string);
      }
    };
    box.current.addEventListener('click', klick);
    const el = box.current;
    // Sobald der Benutzer selbst zoomt oder verschiebt, nicht mehr automatisch einpassen
    const benutzer = () => { bewegt.current = true; };
    el.addEventListener('pointerdown', benutzer);
    el.addEventListener('wheel', benutzer, { passive: true });
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el);
    return () => { el.removeEventListener('click', klick); el.removeEventListener('pointerdown', benutzer); el.removeEventListener('wheel', benutzer); ro.disconnect(); m.remove(); karte.current = null; };
  }, []);

  const schluessel = punkte.map((p) => p.id + ':' + p.lat.toFixed(5) + ':' + p.lng.toFixed(5) + ':' + p.label + ':' + p.farbe + ':' + (p.popupHtml || '').length).join('|');

  useEffect(() => {
    const m = karte.current;
    const g = ebene.current;
    if (m === null || g === null) { return; }
    g.clearLayers();
    const grenzen: L.LatLngExpression[] = [];
    punkte.forEach((p) => {
      const marker = L.marker([p.lat, p.lng], { icon: icon(p), draggable: onVerschoben !== undefined, riseOnHover: true, title: p.label });
      if (p.popupHtml) { marker.bindPopup(p.popupHtml, { maxWidth: 280, minWidth: 240 }); }
      if (onVerschoben !== undefined) {
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
          if (verschobenRef.current !== undefined) { verschobenRef.current(p.id, ll.lat, ll.lng); }
        });
      }
      marker.addTo(g);
      grenzen.push([p.lat, p.lng]);
    });
    if (bewegt.current) { return; }
    if (grenzen.length === 1) {
      m.setView(grenzen[0], zoom !== undefined ? zoom : 16);
    } else if (grenzen.length > 1) {
      m.fitBounds(L.latLngBounds(grenzen), { padding: [40, 40], maxZoom: 15 });
    }
  }, [schluessel]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="karte" style={{ height: hoehe }} />;
}
