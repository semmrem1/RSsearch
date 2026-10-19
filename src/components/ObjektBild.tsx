import { useState } from 'react';
import { bildKandidaten, type BildObjekt } from '../lib/bild';

/** Erstes ladbares Bild: gesichertes Foto, Original-Foto, sonst Luftbild an der Adresse. */
export default function ObjektBild(props: { o: BildObjekt; className?: string; label?: boolean }) {
  const schluessel = bildKandidaten(props.o).map((k) => k.src).join('|');
  return <BildMitFallback key={schluessel} {...props} />;
}

function BildMitFallback({ o, className, label }: { o: BildObjekt; className?: string; label?: boolean }) {
  const kandidaten = bildKandidaten(o);
  const [i, setI] = useState(0);

  const cls = 'objbild' + (className ? ' ' + className : '');
  if (i >= kandidaten.length) {
    return (
      <div className={cls + ' leer'} aria-label="Kein Bild">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
      </div>
    );
  }
  const k = kandidaten[i];
  return (
    <div className={cls}>
      <img src={k.src} alt={'Bild ' + o.ort} loading="lazy" referrerPolicy="no-referrer" onError={() => setI(i + 1)} />
      {label && k.art === 'luftbild' ? <span className="objbild-tag">Luftbild</span> : null}
    </div>
  );
}
