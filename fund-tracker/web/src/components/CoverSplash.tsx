import { useEffect, useRef, useState } from "react";

const HOLD_MS = 3000;
const FADE_MS = 1200;

type Props = {
  onHiding?: () => void;
  onGone?: () => void;
};

export function CoverSplash({ onHiding, onGone }: Props) {
  const [pct, setPct] = useState(0);
  const [hiding, setHiding] = useState(false);
  const [gone, setGone] = useState(false);
  const onHidingRef = useRef(onHiding);
  const onGoneRef = useRef(onGone);
  onHidingRef.current = onHiding;
  onGoneRef.current = onGone;

  useEffect(() => {
    document.getElementById("boot-cover")?.remove();
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onHidingRef.current?.();
      onGoneRef.current?.();
      setGone(true);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    let fadeTimer = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / HOLD_MS);
      const eased = 1 - (1 - p) * (1 - p);
      setPct(Math.round(eased * 100));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
        return;
      }
      setPct(100);
      setHiding(true);
      onHidingRef.current?.();
      fadeTimer = window.setTimeout(() => {
        setGone(true);
        onGoneRef.current?.();
      }, FADE_MS);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fadeTimer);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      className={`cover-splash${hiding ? " hiding" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={`加载 ${pct}%`}
    >
      <div className="cover-mark">HT</div>
      <p className="cover-progress">
        LOADING {pct.toString().padStart(3, "\u00A0")}%
      </p>
    </div>
  );
}
