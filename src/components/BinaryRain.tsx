const BINARY_RAIN_COLUMNS = Array.from({ length: 20 }, (_, column) =>
  Array.from({ length: 32 }, (_, row) =>
    (row * 17 + column * 31 + row * column * 3) % 11 < 5 ? '1' : '0',
  ).join('\n'),
);

export default function BinaryRain() {
  return (
    <div className="binary-rain" aria-hidden="true">
      {BINARY_RAIN_COLUMNS.map((bits, index) => (
        <span
          className="binary-rain-column"
          key={index}
          style={{
            left: `${((index + 0.5) / BINARY_RAIN_COLUMNS.length) * 100}%`,
            animationDelay: `${-((index * 1.7) % 20)}s`,
            animationDuration: `${16 + ((index * 3) % 10)}s`,
          }}
        >
          {bits}
        </span>
      ))}
    </div>
  );
}
