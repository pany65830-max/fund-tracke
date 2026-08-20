import { formatPct, pctClass } from "../lib/format";

function Digit({ digit, delay }: { digit: number; delay: number }) {
  return (
    <span className="digit" aria-hidden="true">
      <span
        className="digit-col"
        style={{ ["--to" as string]: digit, animationDelay: `${delay}s` }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </span>
  );
}

/** 涨跌幅老虎机滚轮；尊重系统「减少动效」。 */
export function SlotPct({ value }: { value: number }) {
  const text = formatPct(value);
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduce) {
    return <span className={pctClass(value)}>{text}</span>;
  }

  let di = 0;
  return (
    <span className={`slots ${pctClass(value)}`} title={text}>
      <span className="sr-only">{text}</span>
      {text.split("").map((ch, i) => {
        if (ch >= "0" && ch <= "9") {
          const delay = di * 0.07;
          di += 1;
          return <Digit key={`${i}-${ch}`} digit={Number(ch)} delay={delay} />;
        }
        return (
          <span key={i} className="digit-ch">
            {ch}
          </span>
        );
      })}
    </span>
  );
}
