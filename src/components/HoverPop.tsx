import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Zeigt beim Überfahren (Maus, Tastaturfokus) oder Antippen (Touch) eine Box mit beliebigem Inhalt.
 * Wird in document.body gerendert, damit Tabellen mit overflow-x die Box nicht abschneiden.
 */
export default function HoverPop({ inhalt, label, children, className, style, breite }: { inhalt: ReactNode; label: string; children: ReactNode; className?: string; style?: CSSProperties; breite?: number }) {
  const [offen, setOffen] = useState(false);
  const [pos, setPos] = useState<{ top: number | null; bottom: number | null; left: number; breite: number; maxHoehe: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const klickIgnorieren = useRef(false);

  const zeigen = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    const el = ref.current;
    if (el === null) { return; }
    const r = el.getBoundingClientRect();
    const b = Math.min(breite !== undefined ? breite : 440, window.innerWidth - 24);
    let left = r.left;
    if (left + b > window.innerWidth - 12) { left = window.innerWidth - 12 - b; }
    if (left < 12) { left = 12; }
    const unten = window.innerHeight - r.bottom - 18;
    const oben = r.top - 18;
    if (unten >= 260 || unten >= oben) { setPos({ top: r.bottom + 6, bottom: null, left, breite: b, maxHoehe: Math.max(160, unten) }); }
    else { setPos({ top: null, bottom: window.innerHeight - r.top + 6, left, breite: b, maxHoehe: Math.max(160, oben) }); }
    setOffen(true);
  };
  const verstecken = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); }
    timer.current = window.setTimeout(() => { setOffen(false); timer.current = null; }, 120);
  };

  useEffect(() => {
    if (!offen) { return; }
    const schliessen = (e: PointerEvent) => {
      if (ref.current !== null && e.target instanceof Node && ref.current.contains(e.target)) {
        if (e.pointerType !== 'mouse') { klickIgnorieren.current = true; setOffen(false); }
        return;
      }
      setOffen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOffen(false); } };
    document.addEventListener('pointerdown', schliessen);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', zeigen, true);
    return () => { document.removeEventListener('pointerdown', schliessen); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', zeigen, true); };
  }, [offen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <span
        ref={ref} className={className} style={style} tabIndex={0} role="button" aria-haspopup="dialog" aria-expanded={offen} aria-label={label}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { zeigen(); } }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') { verstecken(); } }} onFocus={zeigen} onBlur={verstecken}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (klickIgnorieren.current) { klickIgnorieren.current = false; return; } zeigen(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (offen) { setOffen(false); } else { zeigen(); } } }}
      >
        {children}
      </span>
      {offen && pos !== null ? createPortal(
        <div className="ampel-pop" role="dialog" aria-label={label} style={{ top: pos.top !== null ? pos.top : undefined, bottom: pos.bottom !== null ? pos.bottom : undefined, left: pos.left, width: pos.breite, maxHeight: pos.maxHoehe, overflowY: 'auto' }} onMouseEnter={zeigen} onMouseLeave={verstecken}>
          {inhalt}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
