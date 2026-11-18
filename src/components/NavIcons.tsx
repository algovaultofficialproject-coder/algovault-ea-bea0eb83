/** Solid, screenshot-matched icons for the trading bottom navigator (24px grid). */
type IconProps = { className?: string; fill?: string };

export function NavHomeIcon({ className }: IconProps) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg>;
}

export function NavChartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M3.5 3.5v17h17" strokeWidth="1.9" />
      <path d="M6.5 15.5l3.8-5 3.4 3.2 4.3-6.2 1.8 1.6" strokeWidth="1.9" />
    </svg>
  );
}

export function NavWaveIcon({ className }: IconProps) {
  const bars = [2, 4, 7, 10, 15, 9, 18, 12, 16, 8, 11, 6, 4, 2];
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round">
      {bars.map((h, i) => { const x = 3 + i * (18 / (bars.length - 1)); return <line key={i} x1={x} x2={x} y1={12 - h / 2} y2={12 + h / 2} />; })}
    </svg>
  );
}

export function NavGearIcon({ className }: IconProps) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z" /></svg>;
}

export function NavCalendarIcon({ className }: IconProps) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path fill="currentColor" d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5a2 2 0 0 0-1.99 2L3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1h-2zm3 18H5V8h14v11z" /></svg>;
}
