import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { anzeigeName, farbeFuer, formatWert, gemeindeSchluessel, wertVon, zusammensetzung, type Stufe, type SteuerMass, type SteuerWert } from '../lib/steuerkarte';
import { chf } from '../lib/format';

export interface GemeindeProps { bfs: number; name: string; kanton: string; bezirk: string }
export interface SteuerGeo {
  gemeinden: FeatureCollection<Geometry, GemeindeProps>;
  kantone: FeatureCollection;
  seen: FeatureCollection;
  bounds: [number, number, number, number];
}

interface Props {
  geo: SteuerGeo;
  werte: Map<number, SteuerWert>;
  mass: SteuerMass;
  stufen: Stufe[];
  /** Schlüssel (gemeindeSchluessel) der Gemeinden aus unserer Suche, werden umrandet */
  suche: Set<string>;
  hoehe: number | string;
  markiert: number | null;
  onWaehlen?: (bfs: number) => void;
}

const ATTRIBUTION = '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener">swisstopo</a>, BFS';

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function tooltipHtml(p: GemeindeProps, w: SteuerWert | undefined, mass: SteuerMass): string {
  const name = escape(anzeigeName(p.name));
  if (w === undefined) { return '<b>' + name + '</b>: keine Daten'; }
  let html = '<b>' + name + ':</b> ' + escape(formatWert(w, mass));
  const z = zusammensetzung(w);
  if (z !== '') { html += '<div class="xs">' + escape(z) + '</div>'; }
  if (mass !== 'uns' && w.uns !== null) { html += '<div class="xs">Steuern für uns: ' + escape(chf(w.uns, true)) + ' pro Jahr</div>'; }
  html += '<div class="xs muted">' + escape(p.kanton + ', ' + p.bezirk) + '</div>';
  return html;
}

export default function SteuerKarte({ geo, werte, mass, stufen, suche, hoehe, markiert, onWaehlen }: Props) {
  const box = useRef<HTMLDivElement | null>(null);
  const karte = useRef<L.Map | null>(null);
  const ebene = useRef<L.GeoJSON | null>(null);
  const hover = useRef<number | null>(null);
  const aktuell = useRef({ werte, mass, stufen, suche, markiert });
  const waehlenRef = useRef(onWaehlen);
  useEffect(() => { waehlenRef.current = onWaehlen; });

  const stil = (f: Feature<Geometry, GemeindeProps> | undefined): L.PathOptions => {
    if (f === undefined) { return {}; }
    const a = aktuell.current;
    const w = a.werte.get(f.properties.bfs);
    const wert = w !== undefined ? wertVon(w, a.mass) : null;
    const unsere = a.suche.has(gemeindeSchluessel(f.properties.name));
    const hervor = hover.current === f.properties.bfs || a.markiert === f.properties.bfs;
    return {
      fillColor: farbeFuer(wert, a.stufen),
      fillOpacity: 0.86,
      color: hervor ? '#15181C' : unsere ? '#3E454C' : '#FFFFFF',
      weight: hervor ? 3 : unsere ? 1.6 : 0.8,
      opacity: 1,
    };
  };

  useEffect(() => {
    if (box.current === null) { return; }
    const b = geo.bounds;
    const grenzen = L.latLngBounds([[b[1], b[0]], [b[3], b[2]]]);
    const m = L.map(box.current, { scrollWheelZoom: true, zoomSnap: 0.25, maxBounds: grenzen.pad(0.6) });
    // Eigene Ebenen: Gemeinden unten, Seen und Kantonsgrenzen darüber (bringToFront bleibt in der Ebene)
    m.createPane('steuer-gemeinden').style.zIndex = '410';
    m.createPane('steuer-seen').style.zIndex = '420';
    m.createPane('steuer-kantone').style.zIndex = '430';
    for (const n of ['steuer-seen', 'steuer-kantone']) { (m.getPane(n) as HTMLElement).style.pointerEvents = 'none'; }
    L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg', { attribution: ATTRIBUTION, maxNativeZoom: 18, maxZoom: 18, minZoom: 8, opacity: 0.55 }).addTo(m);

    const g = L.geoJSON(geo.gemeinden as FeatureCollection, {
      pane: 'steuer-gemeinden',
      style: (f) => stil(f as Feature<Geometry, GemeindeProps>),
      onEachFeature: (f, layer) => {
        const p = (f as Feature<Geometry, GemeindeProps>).properties;
        const a = aktuell.current;
        layer.bindTooltip(tooltipHtml(p, a.werte.get(p.bfs), a.mass), { sticky: true, direction: 'auto', offset: [12, 0], className: 'steuer-tip', opacity: 1 });
        layer.on('mouseover', () => {
          hover.current = p.bfs;
          (layer as L.Path).setStyle(stil(f as Feature<Geometry, GemeindeProps>));
          (layer as L.Path).bringToFront();
        });
        layer.on('mouseout', () => {
          hover.current = null;
          (layer as L.Path).setStyle(stil(f as Feature<Geometry, GemeindeProps>));
        });
        layer.on('click', (e: L.LeafletMouseEvent) => {
          layer.openTooltip(e.latlng);
          if (waehlenRef.current !== undefined) { waehlenRef.current(p.bfs); }
        });
      },
    }).addTo(m);
    ebene.current = g;
    L.geoJSON(geo.seen, { pane: 'steuer-seen', interactive: false, style: { fillColor: '#CFE0EC', fillOpacity: 1, color: '#A9C7DC', weight: 0.6 } }).addTo(m);
    L.geoJSON(geo.kantone, { pane: 'steuer-kantone', interactive: false, style: { color: '#FFFFFF', weight: 3.5, opacity: 1, fill: false } }).addTo(m);
    m.fitBounds(grenzen, { padding: [12, 12] });
    karte.current = m;

    const el = box.current;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el);
    return () => { ro.disconnect(); m.remove(); karte.current = null; ebene.current = null; };
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Farben, Umrandung und Tooltips nachführen, wenn Mass, Werte oder Auswahl ändern
  useEffect(() => {
    aktuell.current = { werte, mass, stufen, suche, markiert };
    const g = ebene.current;
    if (g === null) { return; }
    g.eachLayer((layer) => {
      const f = (layer as L.Polygon).feature as Feature<Geometry, GemeindeProps> | undefined;
      if (f === undefined) { return; }
      (layer as L.Path).setStyle(stil(f));
      layer.setTooltipContent(tooltipHtml(f.properties, werte.get(f.properties.bfs), mass));
      const unsere = suche.has(gemeindeSchluessel(f.properties.name));
      if (unsere || markiert === f.properties.bfs) { (layer as L.Path).bringToFront(); }
    });
    if (markiert !== null && karte.current !== null) {
      g.eachLayer((layer) => {
        const f = (layer as L.Polygon).feature as Feature<Geometry, GemeindeProps> | undefined;
        if (f !== undefined && f.properties.bfs === markiert && karte.current !== null) {
          const bb = (layer as L.Polygon).getBounds();
          if (!karte.current.getBounds().contains(bb)) { karte.current.fitBounds(bb, { maxZoom: 12, padding: [40, 40] }); }
          layer.openTooltip(bb.getCenter());
        }
      });
    }
  }, [werte, mass, stufen, suche, markiert]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="karte steuer-karte" style={{ height: hoehe }} />;
}
