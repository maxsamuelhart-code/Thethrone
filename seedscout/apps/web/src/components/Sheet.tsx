import { useRef, useState, type ReactNode } from "react";

export type SheetState = "peek" | "half" | "full";
const ORDER: SheetState[] = ["peek", "half", "full"];

interface Props {
  state: SheetState;
  onState(s: SheetState): void;
  header: ReactNode;
  children: ReactNode;
}

/**
 * Bottom sheet: the primary mobile surface. Drag the handle (or tap it) to move
 * between peek / half / full; content scrolls independently of the map.
 */
export function Sheet({ state, onState, header, children }: Props) {
  const start = useRef<{ y: number; t: number } | null>(null);
  const [drag, setDrag] = useState(0);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, t: performance.now() };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (start.current) setDrag(e.clientY - start.current.y);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    const fast = Math.abs(dy) / (performance.now() - start.current.t) > 0.5;
    const i = ORDER.indexOf(state);
    start.current = null;
    setDrag(0);
    if (Math.abs(dy) < 8) return onState(ORDER[(i + 1) % ORDER.length]!); // tap cycles
    const steps = fast ? 1 : Math.max(1, Math.round(Math.abs(dy) / 160));
    onState(ORDER[Math.min(ORDER.length - 1, Math.max(0, i + (dy < 0 ? steps : -steps)))]!);
  };

  return (
    <section className={`sheet sheet-${state}`} style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}>
      <div
        className="sheet-handle"
        role="button"
        aria-label="Resize panel"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => e.key === "Enter" && onState(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length]!)}
      >
        <span />
      </div>
      <div className="sheet-header">{header}</div>
      <div className="sheet-body">{children}</div>
    </section>
  );
}
