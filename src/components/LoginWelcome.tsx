"use client";

import { useEffect, useState } from "react";

// The sign-in screen's welcome: a Deccan Dental illustration (a friendly tooth
// waving from the clinic door) beside the PIN card, with a greeting for the
// time of day and a seasonal touch for the time of year.
//
// For a preview, add ?theme=december (or january, february, spring, summer,
// september, october, november) and/or ?time=morning|afternoon|evening|night
// to the address.

type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
type Season = "january" | "february" | "spring" | "summer" | "september" | "october" | "november" | "december";

const ORANGE = "#e8622a";

function timeOfDay(d: Date): TimeOfDay {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

function season(d: Date): Season {
  const m = d.getMonth() + 1;
  if (m === 1) return "january";
  if (m === 2) return "february";
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m === 9) return "september";
  if (m === 10) return "october";
  if (m === 11) return "november";
  return "december";
}

const GREETING: Record<TimeOfDay, { text: string; emoji: string }> = {
  morning: { text: "Good morning", emoji: "☕" },
  afternoon: { text: "Good afternoon", emoji: "🌤️" },
  evening: { text: "Good evening", emoji: "🌙" },
  night: { text: "Working late?", emoji: "🦉" },
};

const SEASON_LINE: Record<Season, string> = {
  january: "New year, fresh smiles 🎉",
  february: "It's Children's Dental Health Month 🦷",
  spring: "Spring has sprung, so keep smiling 🌷",
  summer: "Sunny days and bright smiles ☀️",
  september: "Back to school, back to brushing 🍎",
  october: "Treats today? Floss tonight! 🎃",
  november: "Thankful for this team 🍂",
  december: "Happy holidays from Deccan Dental 🎄",
};

const SKY: Record<TimeOfDay, [string, string]> = {
  morning: ["#ffd9b8", "#fff4ea"],
  afternoon: ["#cfe5ff", "#eef6ff"],
  evening: ["#c9b8f0", "#f3e8ff"],
  night: ["#1f2a44", "#3b4a6b"],
};

function useMoment() {
  const [m, setM] = useState<{ time: TimeOfDay; season: Season } | null>(null);
  useEffect(() => {
    const now = new Date();
    let time = timeOfDay(now);
    let s = season(now);
    try {
      const q = new URLSearchParams(window.location.search);
      const t = q.get("time"); if (t && t in GREETING) time = t as TimeOfDay;
      const th = q.get("theme"); if (th && th in SEASON_LINE) s = th as Season;
    } catch { /* no preview overrides */ }
    setM({ time, season: s });
  }, []);
  return m;
}

/** "Good morning ☕" plus the seasonal line, replacing the old "Who's this?". */
export function LoginHeading() {
  const m = useMoment();
  if (!m) return <div className="h-[60px] mb-1" />;
  const g = GREETING[m.time];
  return (
    <div className="mb-1">
      <h1 className="text-2xl font-bold flex items-center justify-center gap-2" style={{ color: "#5a5a5a" }}>
        {g.text} <span aria-hidden>{g.emoji}</span>
      </h1>
      <p className="text-sm font-semibold mt-1" style={{ color: ORANGE }}>{SEASON_LINE[m.season]}</p>
    </div>
  );
}

/** Lays out the illustration beside the sign-in card (above it on phones). */
export function LoginScene({ children }: { children: React.ReactNode }) {
  const m = useMoment();
  return (
    <div className="w-full max-w-4xl flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-12">
      <div className="w-full max-w-[220px] sm:max-w-[260px] lg:max-w-[400px]" aria-hidden>
        {m && <ClinicDoor time={m.time} season={m.season} />}
      </div>
      <div className="rounded-2xl bg-white p-6 sm:p-10 shadow-lg w-full max-w-sm text-center">{children}</div>
    </div>
  );
}

// ---- the illustration --------------------------------------------------------

function Tooth({ season }: { season: Season }) {
  // A friendly molar: crown on top, two roots as legs, one arm waving.
  return (
    <g transform="translate(200 236)">
      <path d="M34 -22 C52 -34 60 -52 64 -70" stroke="#3b3b3b" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="65" cy="-74" r="7" fill="#fff" stroke="#3b3b3b" strokeWidth="3" />
      <path d="M-34 -18 C-46 -6 -50 8 -48 20" stroke="#3b3b3b" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path
        d="M-38 -45 C-50 -70 -20 -82 0 -66 C20 -82 50 -70 38 -45 C46 -20 34 5 30 20 C26 40 22 62 12 64 C4 65 4 40 0 30 C-4 40 -4 65 -12 64 C-22 62 -26 40 -30 20 C-34 5 -46 -20 -38 -45 Z"
        fill="#ffffff" stroke="#3b3b3b" strokeWidth="3.5" strokeLinejoin="round"
      />
      <path d="M-24 -58 C-16 -64 -8 -62 -4 -58" stroke="#e5e7eb" strokeWidth="4" fill="none" strokeLinecap="round" />
      {season === "summer" ? (
        <g>
          <rect x="-24" y="-42" width="20" height="12" rx="5" fill="#1f2937" />
          <rect x="4" y="-42" width="20" height="12" rx="5" fill="#1f2937" />
          <path d="M-4 -37 L4 -37" stroke="#1f2937" strokeWidth="3" />
        </g>
      ) : (
        <g fill="#3b3b3b">
          <circle cx="-12" cy="-34" r="4.5" />
          <circle cx="12" cy="-34" r="4.5" />
          <circle cx="-10.5" cy="-35.5" r="1.4" fill="#fff" />
          <circle cx="13.5" cy="-35.5" r="1.4" fill="#fff" />
        </g>
      )}
      <circle cx="-22" cy="-20" r="5" fill="#fbb8a5" opacity="0.8" />
      <circle cx="22" cy="-20" r="5" fill="#fbb8a5" opacity="0.8" />
      <path d="M-11 -20 Q0 -8 11 -20" stroke="#3b3b3b" strokeWidth="3" fill="none" strokeLinecap="round" />
      {season === "december" && (
        <g>
          <path d="M36 -60 C30 -96 -22 -104 -40 -74 L-26 -62 Z" fill="#dc2626" stroke="#3b3b3b" strokeWidth="2.5" strokeLinejoin="round" />
          <rect x="-32" y="-66" width="72" height="12" rx="6" fill="#fff" stroke="#3b3b3b" strokeWidth="2.5" />
          <circle cx="-44" cy="-74" r="7" fill="#fff" stroke="#3b3b3b" strokeWidth="2.5" />
        </g>
      )}
      {season === "january" && (
        <g>
          <path d="M-22 -64 L0 -104 L22 -64 Z" fill="#a78bfa" stroke="#3b3b3b" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="0" cy="-106" r="5" fill="#facc15" stroke="#3b3b3b" strokeWidth="2" />
        </g>
      )}
      {season === "october" && (
        <g>
          <path d="M-34 -64 L0 -112 L34 -64 Z" fill="#1f2937" stroke="#3b3b3b" strokeWidth="2.5" strokeLinejoin="round" />
          <ellipse cx="0" cy="-64" rx="46" ry="7" fill="#1f2937" />
        </g>
      )}
    </g>
  );
}

function Plant({ x, season }: { x: number; season: Season }) {
  const leaf = season === "november" || season === "september" ? "#d97706" : "#3f8f4f";
  const leaf2 = season === "november" || season === "september" ? "#b45309" : "#2f6b3b";
  return (
    <g transform={`translate(${x} 0)`}>
      <path d="M0 292 C-26 262 -24 236 -6 224 C-4 248 0 266 0 292 Z" fill={leaf} stroke="#2b2b2b" strokeWidth="2" />
      <path d="M2 292 C26 258 30 232 14 218 C8 244 4 266 2 292 Z" fill={leaf2} stroke="#2b2b2b" strokeWidth="2" />
      <path d="M0 292 C-10 270 -30 262 -38 252 C-20 250 -6 266 0 292 Z" fill={leaf2} stroke="#2b2b2b" strokeWidth="2" />
      {season === "spring" && (
        <g stroke="#2b2b2b" strokeWidth="1.5">
          <circle cx="-8" cy="226" r="6" fill="#f9a8d4" />
          <circle cx="16" cy="222" r="6" fill="#fde047" />
          <circle cx="-30" cy="252" r="5" fill="#f9a8d4" />
        </g>
      )}
      {season === "december" && (
        <g>
          <circle cx="-8" cy="236" r="3.5" fill="#dc2626" />
          <circle cx="12" cy="232" r="3.5" fill="#facc15" />
          <circle cx="-22" cy="256" r="3.5" fill="#2563eb" />
        </g>
      )}
      <path d="M-34 292 L34 292 L28 330 L-28 330 Z" fill="#6b5b53" stroke="#2b2b2b" strokeWidth="2.5" strokeLinejoin="round" />
    </g>
  );
}

function ClinicDoor({ time, season }: { time: TimeOfDay; season: Season }) {
  const [sky1, sky2] = SKY[time];
  const night = time === "night";
  return (
    <svg viewBox="0 0 400 360" className="w-full h-auto" role="img" aria-label="Deccan Dental">
      <defs>
        <linearGradient id="dd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky1} />
          <stop offset="1" stopColor={sky2} />
        </linearGradient>
        <linearGradient id="dd-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff7ed" />
          <stop offset="1" stopColor="#ffedd5" />
        </linearGradient>
      </defs>
      <rect x="10" y="10" width="380" height="330" rx="28" fill="url(#dd-sky)" />
      {night && (
        <g fill="#fef9c3">
          <circle cx="60" cy="40" r="2" /><circle cx="110" cy="28" r="1.5" /><circle cx="330" cy="36" r="2" />
          <circle cx="360" cy="60" r="1.5" /><circle cx="300" cy="24" r="1.2" />
        </g>
      )}
      {time === "morning" && <circle cx="345" cy="42" r="16" fill="#fdba74" />}
      {time === "afternoon" && <circle cx="345" cy="40" r="15" fill="#fde68a" />}
      {time === "evening" && <circle cx="345" cy="44" r="13" fill="#fde68a" opacity="0.9" />}
      {night && <path d="M352 30 a16 16 0 1 0 6 26 a12 12 0 1 1 -6 -26 Z" fill="#fef3c7" />}

      {/* building */}
      <rect x="56" y="86" width="288" height="210" fill="#f6e7d7" stroke="#2b2b2b" strokeWidth="3" />
      {[70, 84, 98, 112, 126].map((x) => <line key={x} x1={x} y1="128" x2={x} y2="294" stroke="#d48a5c" strokeWidth="9" />)}
      {[274, 288, 302, 316, 330].map((x) => <line key={x} x1={x} y1="128" x2={x} y2="294" stroke="#d48a5c" strokeWidth="9" />)}
      {/* sign */}
      <rect x="46" y="64" width="308" height="46" rx="6" fill={ORANGE} stroke="#2b2b2b" strokeWidth="3" />
      <text x="200" y="95" textAnchor="middle" fontFamily="system-ui, -apple-system, Segoe UI, sans-serif" fontWeight="800" fontSize="22" letterSpacing="3" fill="#fff">DECCAN DENTAL</text>
      {season === "december" && (
        <g>
          <path d="M46 112 Q90 128 134 112 Q178 128 222 112 Q266 128 310 112 Q332 120 354 112" stroke="#2f6b3b" strokeWidth="6" fill="none" strokeLinecap="round" />
          {[70, 112, 156, 200, 244, 288, 330].map((x, i) => <circle key={x} cx={x} cy={118 + (i % 2) * 4} r="4" fill={["#dc2626", "#facc15", "#2563eb"][i % 3]} />)}
        </g>
      )}
      {/* lights by the door */}
      <rect x="132" y="150" width="8" height="20" rx="2" fill="#2b2b2b" />
      <rect x="260" y="150" width="8" height="20" rx="2" fill="#2b2b2b" />
      <ellipse cx="136" cy="170" rx="12" ry="20" fill="#fde68a" opacity={night || time === "evening" ? 0.55 : 0.25} />
      <ellipse cx="264" cy="170" rx="12" ry="20" fill="#fde68a" opacity={night || time === "evening" ? 0.55 : 0.25} />
      {/* doorway */}
      <rect x="148" y="128" width="104" height="168" fill="url(#dd-glow)" stroke="#2b2b2b" strokeWidth="3" />
      <path d="M148 128 L116 138 L116 300 L148 296 Z" fill="#8fb5ad" stroke="#2b2b2b" strokeWidth="3" strokeLinejoin="round" />
      <rect x="124" y="160" width="10" height="70" rx="3" fill="#cfe8f3" stroke="#2b2b2b" strokeWidth="2" />
      <rect x="138" y="216" width="4" height="30" rx="2" fill="#2b2b2b" />
      <Tooth season={season} />
      {/* step, plants */}
      <rect x="40" y="296" width="320" height="10" fill="#9fc0b8" stroke="#2b2b2b" strokeWidth="2.5" />
      <Plant x={78} season={season} />
      <Plant x={322} season={season} />

      {season === "december" && (
        <g fill="#fff" opacity="0.95">
          {[[40, 60], [90, 44], [300, 30], [370, 110], [24, 160], [380, 200], [150, 40], [250, 46]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3" />)}
        </g>
      )}
      {season === "october" && (
        <g transform="translate(262 300)">
          <ellipse cx="0" cy="0" rx="20" ry="15" fill="#f97316" stroke="#2b2b2b" strokeWidth="2.5" />
          <path d="M-7 0 L-3 -5 L1 0 Z M5 0 L9 -5 L13 0 Z" fill="#2b2b2b" transform="translate(-3 -2)" />
          <path d="M-8 6 Q0 11 8 6" stroke="#2b2b2b" strokeWidth="2" fill="none" />
          <rect x="-2" y="-21" width="4" height="8" fill="#3f8f4f" />
        </g>
      )}
      {(season === "november" || season === "september") && (
        <g>
          {[[48, 140, "#d97706"], [356, 170, "#b45309"], [30, 230, "#ea580c"], [370, 250, "#d97706"]].map(([x, y, c]) => (
            <path key={`${x}`} d={`M${x} ${y} q8 -10 16 0 q-8 10 -16 0 Z`} fill={String(c)} stroke="#2b2b2b" strokeWidth="1.5" />
          ))}
        </g>
      )}
      {season === "february" && (
        <g fill="#f472b6" stroke="#2b2b2b" strokeWidth="1.5">
          {[[46, 150], [354, 150], [36, 220]].map(([x, y]) => (
            <path key={`${x}-${y}`} d={`M${x} ${y} c-6 -8 -18 -2 -10 8 l10 10 l10 -10 c8 -10 -4 -16 -10 -8 Z`} />
          ))}
        </g>
      )}
      {season === "january" && (
        <g>
          {[[40, 140, "#f472b6"], [360, 140, "#60a5fa"], [30, 210, "#facc15"], [372, 220, "#34d399"], [60, 60, "#a78bfa"], [330, 120, "#f97316"]].map(([x, y, c]) => (
            <rect key={`${x}-${y}`} x={Number(x)} y={Number(y)} width="7" height="12" rx="2" fill={String(c)} transform={`rotate(25 ${x} ${y})`} />
          ))}
        </g>
      )}
    </svg>
  );
}
