import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ObjektBildRow } from '../lib/types';

function url(b: ObjektBildRow): string {
  if (b.pfad) { return supabase.storage.from('objektbilder').getPublicUrl(b.pfad).data.publicUrl; }
  return b.quelle_url;
}

/** Galerie-Streifen mit Vollbild-Ansicht. Zeigt gesicherte Kopien, sonst die Original-URLs. */
export default function Galerie({ objektId, version }: { objektId: string; version?: number }) {
  const [bilder, setBilder] = useState<ObjektBildRow[]>([]);
  const [offen, setOffen] = useState<number | null>(null);

  useEffect(() => {
    supabase.from('objekt_bilder').select('*').eq('objekt_id', objektId).is('fehler', null).order('sort').order('created_at')
      .then(({ data }) => { if (data) { setBilder(data as ObjektBildRow[]); } });
  }, [objektId, version]);

  useEffect(() => {
    if (offen === null) { return; }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOffen(null); }
      if (e.key === 'ArrowRight') { setOffen((i) => (i === null ? null : (i + 1) % bilder.length)); }
      if (e.key === 'ArrowLeft') { setOffen((i) => (i === null ? null : (i - 1 + bilder.length) % bilder.length)); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [offen, bilder.length]);

  if (bilder.length === 0) { return null; }

  return (
    <>
      <div className="galerie" aria-label="Bildergalerie">
        {bilder.map((b, i) => (
          <button key={b.id} type="button" className="galerie-thumb" onClick={() => setOffen(i)} aria-label={'Bild ' + (i + 1) + ' öffnen'}>
            <img src={url(b)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
          </button>
        ))}
      </div>
      {offen !== null ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Bild gross" onClick={() => setOffen(null)}>
          <button type="button" className="lightbox-x" aria-label="Schliessen" onClick={() => setOffen(null)}>×</button>
          <button type="button" className="lightbox-nav links" aria-label="Vorheriges" onClick={(e) => { e.stopPropagation(); setOffen((offen - 1 + bilder.length) % bilder.length); }}>‹</button>
          <img src={url(bilder[offen])} alt="" referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} />
          <button type="button" className="lightbox-nav rechts" aria-label="Nächstes" onClick={(e) => { e.stopPropagation(); setOffen((offen + 1) % bilder.length); }}>›</button>
          <span className="lightbox-zaehler">{offen + 1} / {bilder.length}</span>
        </div>
      ) : null}
    </>
  );
}
