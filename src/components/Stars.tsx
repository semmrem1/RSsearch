export function StarsText({ n, color }: { n: number; color: string }) {
  if (!n) { return <span className="stars" style={{ color: 'var(--ink-4)' }}>·</span>; }
  let s = '';
  for (let i = 1; i <= 5; i++) { s += i <= n ? '★' : '☆'; }
  return <span className="stars" style={{ color }}>{s}</span>;
}

export function StarsInput({ value, onChange, color }: { value: number; onChange: (n: number) => void; color: string }) {
  const items = [1, 2, 3, 4, 5];
  return (
    <div className="star-btns" role="radiogroup" aria-label="Sterne">
      {items.map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={i + ' Sterne'}
          className={i <= value ? 'on' : ''}
          style={i <= value ? { color } : undefined}
          onClick={() => onChange(value === i ? 0 : i)}
        >★</button>
      ))}
    </div>
  );
}
