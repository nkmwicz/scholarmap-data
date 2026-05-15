import { useRef, useState, useCallback } from "react";

interface Props {
  children: React.ReactNode;
  /** min/max scale clamps */
  minScale?: number;
  maxScale?: number;
}

/**
 * Wraps children in a pan + pinch-zoom container.
 * - Mouse wheel → zoom (centred on cursor)
 * - Mouse drag / single-finger drag → pan
 * - Two-finger pinch → zoom
 * - Double-click / Reset button → reset to default
 */
export function PanZoom({ children, minScale = 0.25, maxScale = 10 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  // Mutable refs so pointer handlers don't close over stale state
  const stateRef = useRef({ tx: 0, ty: 0, scale: 1 });
  const sync = (tx: number, ty: number, scale: number) => {
    stateRef.current = { tx, ty, scale };
    setTx(tx);
    setTy(ty);
    setScale(scale);
  };

  const activePointers = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  const lastPinchDist = useRef<number | null>(null);
  const lastPinchMid = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const lastDrag = useRef({ x: 0, y: 0 });

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

  // Zoom centred on a point in container-local coords
  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      const { tx, ty, scale } = stateRef.current;
      const newScale = clamp(scale * factor, minScale, maxScale);
      const ratio = newScale / scale;
      const newTx = cx - ratio * (cx - tx);
      const newTy = cy - ratio * (cy - ty);
      sync(newTx, newTy, newScale);
    },
    [minScale, maxScale],
  );

  const toLocal = (e: { x: number; y: number }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.x - rect.left, y: e.y - rect.top };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const { x, y } = toLocal({ x: e.clientX, y: e.clientY });
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(x, y, factor);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const pos = { x: e.clientX, y: e.clientY };
    activePointers.current.set(e.pointerId, pos);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (activePointers.current.size === 1) {
      dragging.current = true;
      setIsDragging(true);
      lastDrag.current = pos;
    }
    if (activePointers.current.size === 2) {
      dragging.current = false;
      const pts = Array.from(activePointers.current.values());
      lastPinchDist.current = Math.hypot(
        pts[0].x - pts[1].x,
        pts[0].y - pts[1].y,
      );
      lastPinchMid.current = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      if (lastPinchDist.current !== null && lastPinchMid.current !== null) {
        const factor = dist / lastPinchDist.current;
        const local = toLocal(mid);
        zoomAt(local.x, local.y, factor);
        // also pan by mid-point movement
        const { tx, ty, scale: s } = stateRef.current;
        const dx = mid.x - lastPinchMid.current.x;
        const dy = mid.y - lastPinchMid.current.y;
        sync(tx + dx, ty + dy, s);
      }
      lastPinchDist.current = dist;
      lastPinchMid.current = mid;
    } else if (dragging.current && activePointers.current.size === 1) {
      const dx = e.clientX - lastDrag.current.x;
      const dy = e.clientY - lastDrag.current.y;
      const { tx, ty, scale: s } = stateRef.current;
      sync(tx + dx, ty + dy, s);
      lastDrag.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      lastPinchDist.current = null;
      lastPinchMid.current = null;
    }
    if (activePointers.current.size === 0) {
      dragging.current = false;
      setIsDragging(false);
    }
    if (activePointers.current.size === 1) {
      // resumed single-finger after pinch
      dragging.current = true;
      const [pos] = Array.from(activePointers.current.values());
      lastDrag.current = pos;
    }
  };

  const onDblClick = () => sync(0, 0, 1);

  const isDefault = tx === 0 && ty === 0 && scale === 1;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        overflow: "hidden",
        flex: 1,
        minHeight: 0,
        touchAction: "none",
      }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDblClick}
    >
      <div
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: "top left",
          willChange: "transform",
          userSelect: "none",
          cursor: isDragging ? "grabbing" : "grab",
        }}
      >
        {children}
      </div>
      {!isDefault && (
        <button
          onClick={() => sync(0, 0, 1)}
          style={{
            position: "absolute",
            bottom: 10,
            right: 10,
            padding: "0.2rem 0.5rem",
            fontSize: "0.7rem",
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Reset view
        </button>
      )}
    </div>
  );
}
