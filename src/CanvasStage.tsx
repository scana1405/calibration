import { useEffect, useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { drawScene, type Scene } from './draw';
import type { Point, Size } from './geometry';

interface CanvasStageProps {
  /** Null until the first measurement, or while the caller draws directly (gaze playback). */
  scene: Scene | null;
  onResize: (canvas: Size, devicePixelRatio: number) => void;
  draggable: boolean;
  onDrag: (point: Point) => void;
  hideCursor?: boolean;
  /** Receives the canvas element for callers that draw every frame themselves. */
  canvasRef?: RefObject<HTMLCanvasElement | null>;
}

/** Full-screen canvas sized in physical device pixels. */
export function CanvasStage({ scene, onResize, draggable, onDrag, hideCursor, canvasRef: externalRef }: CanvasStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useLayoutEffect(() => {
    const el = canvasRef.current!;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      onResizeRef.current(
        { width: Math.round(el.clientWidth * dpr), height: Math.round(el.clientHeight * dpr) },
        dpr,
      );
    };

    // devicePixelRatio changes (zoom, moving to another screen) do not always fire resize.
    let media: MediaQueryList | null = null;
    const onDprChange = () => {
      measure();
      watchDpr();
    };
    const watchDpr = () => {
      media?.removeEventListener('change', onDprChange);
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener('change', onDprChange);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    watchDpr();
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      media?.removeEventListener('change', onDprChange);
    };
  }, []);

  useEffect(() => {
    const el = canvasRef.current!;
    if (!scene) return;
    if (el.width !== scene.canvas.width) el.width = scene.canvas.width;
    if (el.height !== scene.canvas.height) el.height = scene.canvas.height;
    const ctx = el.getContext('2d');
    if (ctx) drawScene(ctx, scene);
  }, [scene]);

  const toCanvas = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * (el.width / rect.width)),
      y: Math.round((e.clientY - rect.top) * (el.height / rect.height)),
    };
  };

  return (
    <canvas
      ref={(el) => {
        canvasRef.current = el;
        if (externalRef) externalRef.current = el;
      }}
      className="stage"
      style={{ cursor: hideCursor ? 'none' : draggable ? 'crosshair' : 'default' }}
      onPointerDown={(e) => {
        if (!draggable || e.button !== 0) return;
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onDrag(toCanvas(e));
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) onDrag(toCanvas(e));
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
    />
  );
}
