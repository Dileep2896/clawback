const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Two digit drums. Moving the strip lets CSS roll the drum when the value changes, and reduced motion turns that off. */
export function MeterRegister({ value }: { value: number }) {
  const digits = String(value).padStart(2, "0").slice(-2).split("");
  return (
    <span className="flex gap-1" aria-hidden="true">
      {digits.map((digit, place) => (
        <span key={place} className="drum">
          <span className="drum-strip" style={{ transform: `translateY(-${Number(digit) * 10}%)` }}>
            {DIGITS.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
