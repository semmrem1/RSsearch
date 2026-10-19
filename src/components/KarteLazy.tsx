import { lazy, Suspense, type ComponentProps } from 'react';

// Leaflet erst laden, wenn eine Karte gebraucht wird (schnellerer Start auf dem Handy)
const Karte = lazy(() => import('./Karte'));

export default function KarteLazy(props: ComponentProps<typeof Karte>) {
  return (
    <Suspense fallback={<div className="karte" style={{ height: props.hoehe }} />}>
      <Karte {...props} />
    </Suspense>
  );
}
