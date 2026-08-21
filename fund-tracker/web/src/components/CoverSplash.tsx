import { useEffect, useRef, useState } from "react";

const INTRO_MS = 700;
const HOLD_MS = 3000;
const FADE_MS = 1200;

type Props = {
  onHiding?: () => void;
  onGone?: () => void;
};

export function HtMark() {
  return (
    <svg
      className="cover-ht"
      viewBox="0 0 360 176"
      shapeRendering="geometricPrecision"
      aria-hidden="true"
    >
      <g fill="currentColor">
        <polygon points="16,16 50,16 50,71 99.3,71 58.1,105 50,105 50,160 16,160" />
        <polygon points="120,16 154,16 154,160 120,160 120,105 70.7,105 111.9,71 120,71" />
        <polygon points="204,16 342,16 342,49 295.3,49 295.3,160 248.5,160 248.5,82 293,49 204,49" />
      </g>
    </svg>
  );
}

export function CoverSplash({ onHiding, onGone }: Props) {
  const [pct, setPct] = useState(0);
  const [hiding, setHiding] = useState(false);
  const [gone, setGone] = useState(false);
  const onHidingRef = useRef(onHiding);
  const onGoneRef = useRef(onGone);
  onHidingRef.current = onHiding;
  onGoneRef.current = onGone;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onHidingRef.current?.();
      onGoneRef.current?.();
      setGone(true);
      document.getElementById("boot-cover")?.remove();
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    let fadeTimer = 0;
    const progress = document.querySelector("#boot-cover .cover-progress");
    const tick = (now: number) => {
      const elapsed = now - t0;
      const p = Math.min(1, Math.max(0, (elapsed - INTRO_MS) / HOLD_MS));
      const eased = 1 - (1 - p) * (1 - p);
      const next = Math.round(eased * 100);
      setPct(next);
      if (progress) {
        progress.textContent = `LOADING ${String(next).padStart(3, "\u00A0")}%`;
      }
      if (elapsed < INTRO_MS + HOLD_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      setPct(100);
      setHiding(true);
      document.getElementById("boot-cover")?.classList.add("hiding");
      onHidingRef.current?.();
      fadeTimer = window.setTimeout(() => {
        document.getElementById("boot-cover")?.remove();
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

  const boot = typeof document !== "undefined" && document.getElementById("boot-cover");
  if (gone || boot) return null;

  return (
    <div
      className={`cover-splash${hiding ? " hiding" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={`加载 ${pct}%`}
    >
      <div className="cover-mark">
        <HtMark />
      </div>
      <p className="cover-progress">
        LOADING {pct.toString().padStart(3, "\u00A0")}%
      </p>
    </div>
  );
}
