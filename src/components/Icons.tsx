import type { CSSProperties } from "react";

type IconName =
  | "arrow"
  | "back"
  | "book"
  | "leaf"
  | "plus"
  | "minus"
  | "close"
  | "check"
  | "clock"
  | "people"
  | "chevron"
  | "pot"
  | "share"
  | "trash"
  | "download";
const paths: Record<IconName, string[]> = {
  arrow: ["M4 12h16", "m14 6 6 6-6 6"],
  back: ["M20 12H4", "m10 6-6 6 6 6"],
  book: [
    "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z",
    "M13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2",
  ],
  leaf: ["M5 19C1 9 9 3 21 3c0 13-6 17-13 13", "M4 22c2-7 7-11 12-15"],
  plus: ["M5 12h14", "M12 5v14"],
  minus: ["M5 12h14"],
  close: ["m6 6 12 12", "M6 18 18 6"],
  check: ["m5 12 4 4L19 6"],
  clock: ["M12 8v5l3 2", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"],
  people: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    "M17 3a4 4 0 0 1 0 8",
    "M22 21v-2a4 4 0 0 0-3-3.87",
  ],
  chevron: ["m6 9 6 6 6-6"],
  pot: [
    "M5 9h14v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z",
    "M2 10h3m14 0h3M4 6h16M12 2v4",
  ],
  share: ["M12 16V2", "m7 7 5-5 5 5", "M5 11H3v11h18V11h-2"],
  trash: ["M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M4 17v4h16v-4"],
};

export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {paths[name].map((d, index) => (
        <path d={d} key={index} />
      ))}
    </svg>
  );
}

export function RaguArt() {
  const noodles = Array.from({ length: 17 }, (_, index) => {
    const y = 108 + index * 7;
    const bend = index % 2 ? 24 : -18;
    return (
      <path
        key={index}
        d={`M${104 + (index % 4) * 5} ${y} C145 ${y + bend}, 197 ${y - bend}, 266 ${y + 5} S319 ${y + 24}, 293 ${y + 31}`}
        fill="none"
        stroke={index % 3 ? "#e7ba6b" : "#f3d194"}
        strokeWidth={index % 2 ? 6 : 5}
        strokeLinecap="round"
      />
    );
  });
  return (
    <svg
      className="ragu-art"
      viewBox="0 0 420 340"
      fill="none"
      role="img"
      aria-label="Illustration of a bowl of rich mushroom ragù with pasta and fresh basil"
    >
      <defs>
        <radialGradient id="plate" cx=".42" cy=".34">
          <stop stopColor="#fffdf4" />
          <stop offset="1" stopColor="#e6deca" />
        </radialGradient>
        <radialGradient id="sauce">
          <stop stopColor="#ad522f" />
          <stop offset="1" stopColor="#763d26" />
        </radialGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <clipPath id="food">
          <ellipse cx="208" cy="170" rx="111" ry="99" />
        </clipPath>
      </defs>
      <path d="m23 26 61 5-30 291-51-7z" fill="#9f9e74" opacity=".17" />
      <path
        d="m30 26-15 292M49 28 30 319M67 29 46 320"
        stroke="#8d9366"
        strokeWidth="2"
        opacity=".25"
      />
      <ellipse
        cx="219"
        cy="188"
        rx="150"
        ry="128"
        fill="#5e492d"
        opacity=".14"
        filter="url(#shadow)"
      />
      <ellipse cx="208" cy="164" rx="150" ry="137" fill="url(#plate)" />
      <ellipse
        cx="208"
        cy="164"
        rx="135"
        ry="124"
        stroke="#d4c9b1"
        strokeWidth="1.5"
      />
      <ellipse cx="208" cy="165" rx="118" ry="106" fill="#e4d7ba" />
      <ellipse cx="208" cy="170" rx="111" ry="99" fill="url(#sauce)" />
      <g clipPath="url(#food)">
        {noodles}
        {Array.from({ length: 42 }, (_, i) => (
          <ellipse
            key={i}
            cx={109 + ((i * 47) % 192)}
            cy={87 + ((i * 29) % 171)}
            rx={4 + (i % 5)}
            ry={3 + (i % 4)}
            fill={["#7d4129", "#9c4a29", "#bb6034", "#cf8d51"][i % 4]}
            transform={`rotate(${i * 39} ${109 + ((i * 47) % 192)} ${87 + ((i * 29) % 171)})`}
          />
        ))}
      </g>
      <g transform="translate(222 105) rotate(-18)">
        <path
          d="M0 24C-28 8-18-14 0 1c19-24 40-10 19 7 21 6 11 23-13 16"
          fill="#436539"
        />
        <path
          d="M0 30 8 0M3 19-12 6M6 15 21 4"
          stroke="#93a267"
          strokeWidth="1.5"
        />
      </g>
      <path
        d="m168 111 8-3m-26 55 10 3m68 31-7 2m-43 29 10 2m84-71-8-4m-65-59 9 3"
        stroke="#ead39f"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <g transform="translate(348 194) rotate(14)">
        <path
          d="M0 0v78M-8 0v24q8 13 16 0V0M-3 0v24M3 0v24"
          stroke="#9a8b70"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <g transform="translate(71 276) rotate(-30)">
        <path d="M0 0c-20-25-37-13-23 3 8 9 21 6 23-3Z" fill="#7a8a4c" />
        <path d="M0 0c18-28 36-14 20 1C11 10 2 5 0 0Z" fill="#5c7640" />
        <path d="M-4 13 0-3" stroke="#526d37" strokeWidth="2" />
      </g>
      <g transform="translate(331 60)">
        <circle r="18" fill="#bc4c2f" />
        <path d="m-10-8 10 3 8-9-3 12 10 3-13 2-6 9-1-13z" fill="#617244" />
      </g>
      <circle cx="92" cy="61" r="2" fill="#7c7047" />
      <circle cx="362" cy="283" r="3" fill="#7c7047" />
      <circle cx="329" cy="305" r="2" fill="#7c7047" />
    </svg>
  );
}
