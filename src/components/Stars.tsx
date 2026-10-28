export function StarsText({ n, color }: { n: number; color: string }) {
  if (!n) { return <span className="stars" style={{ color: 'var(--ink-4)' }}>·</span>; }
  let s = '';
  for (let i = 1; i <= 5; i++) { s += i <= n ? '★' : '☆'; }
  return <span className="stars" style={{ color }}>{s}</span>;
}

/**
 * Sterne setzen (1 bis 5, erneuter Klick auf den gesetzten Stern = 0).
 * `kompakt` für Tabellen und Karten in Listen: kleinere Sterne, Vorschau beim Überfahren.
 */
export function StarsInput({ value, onChange, color, kompakt, label }: { value: number; onChange: (n: number) => void; color: string; kompakt?: boolean; label?: string }) {
  const items = [1, 2, 3, 4, 5];
  return (
    <div className={'star-btns' + (kompakt ? ' kompakt' : '')} role="radiogroup" aria-label={label !== undefined ? label : 'Sterne'} style={{ ['--stern' as string]: color }}>
      {items.map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={i + ' Sterne'}
          title={value === i ? 'Sterne entfernen' : i + (i === 1 ? ' Stern' : ' Sterne')}
          className={i <= value ? 'on' : ''}
          style={i <= value ? { color } : undefined}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(value === i ? 0 : i); }}
        >★</button>
      ))}
    </div>
  );
}
