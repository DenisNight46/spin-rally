export type Confederation = "Asia" | "Europe" | "Africa" | "Americas";

export interface NationalTeam {
  id: string;
  name: string;
  shortName: string;
  flag: string;
  confederation: Confederation;
  /** Original Spin Rally heraldic identity; not an official federation trademark. */
  crest: {
    initials: string;
    primary: string;
    secondary: string;
    accent: string;
    motif: "star" | "sun" | "wave" | "eagle" | "mountain" | "laurel";
  };
}

export const NATIONAL_TEAMS: readonly NationalTeam[] = [
  { id: "chn", name: "Китай", shortName: "CHN", flag: "🇨🇳", confederation: "Asia", crest: { initials: "中", primary: "#d62828", secondary: "#f5c542", accent: "#fff0bd", motif: "star" } },
  { id: "jpn", name: "Япония", shortName: "JPN", flag: "🇯🇵", confederation: "Asia", crest: { initials: "日", primary: "#bc2d3b", secondary: "#f4f0e8", accent: "#d9a441", motif: "sun" } },
  { id: "kor", name: "Южная Корея", shortName: "KOR", flag: "🇰🇷", confederation: "Asia", crest: { initials: "K", primary: "#174a8b", secondary: "#e8edf5", accent: "#c83c4b", motif: "wave" } },
  { id: "ind", name: "Индия", shortName: "IND", flag: "🇮🇳", confederation: "Asia", crest: { initials: "I", primary: "#e87524", secondary: "#fff5df", accent: "#27875a", motif: "sun" } },
  { id: "sgp", name: "Сингапур", shortName: "SGP", flag: "🇸🇬", confederation: "Asia", crest: { initials: "S", primary: "#c93643", secondary: "#f7f2eb", accent: "#d8b35a", motif: "star" } },
  { id: "swe", name: "Швеция", shortName: "SWE", flag: "🇸🇪", confederation: "Europe", crest: { initials: "S", primary: "#1765a8", secondary: "#f5d34e", accent: "#f7f1df", motif: "mountain" } },
  { id: "ger", name: "Германия", shortName: "GER", flag: "🇩🇪", confederation: "Europe", crest: { initials: "D", primary: "#252525", secondary: "#d5ad42", accent: "#b83a3a", motif: "eagle" } },
  { id: "fra", name: "Франция", shortName: "FRA", flag: "🇫🇷", confederation: "Europe", crest: { initials: "F", primary: "#244b91", secondary: "#f2eee7", accent: "#c83d4b", motif: "laurel" } },
  { id: "por", name: "Португалия", shortName: "POR", flag: "🇵🇹", confederation: "Europe", crest: { initials: "P", primary: "#176b4b", secondary: "#d9b34c", accent: "#c8443b", motif: "wave" } },
  { id: "pol", name: "Польша", shortName: "POL", flag: "🇵🇱", confederation: "Europe", crest: { initials: "P", primary: "#b73546", secondary: "#f7f0e9", accent: "#d4b66b", motif: "eagle" } },
  { id: "rou", name: "Румыния", shortName: "ROU", flag: "🇷🇴", confederation: "Europe", crest: { initials: "R", primary: "#244d91", secondary: "#e5b33e", accent: "#b83d3d", motif: "mountain" } },
  { id: "rus", name: "Россия", shortName: "RUS", flag: "🇷🇺", confederation: "Europe", crest: { initials: "R", primary: "#31558c", secondary: "#f1eee8", accent: "#b9414a", motif: "eagle" } },
  { id: "egy", name: "Египет", shortName: "EGY", flag: "🇪🇬", confederation: "Africa", crest: { initials: "E", primary: "#b63b36", secondary: "#d7b34e", accent: "#263b36", motif: "sun" } },
  { id: "bra", name: "Бразилия", shortName: "BRA", flag: "🇧🇷", confederation: "Americas", crest: { initials: "B", primary: "#24764a", secondary: "#e6c64e", accent: "#28559a", motif: "laurel" } },
  { id: "usa", name: "США", shortName: "USA", flag: "🇺🇸", confederation: "Americas", crest: { initials: "U", primary: "#24477d", secondary: "#f3eee5", accent: "#b84049", motif: "star" } },
  { id: "eng", name: "Англия", shortName: "ENG", flag: "🏴", confederation: "Europe", crest: { initials: "E", primary: "#c83e46", secondary: "#f4f0e9", accent: "#274c7b", motif: "laurel" } },
] as const;

export function getNationalTeam(id: string): NationalTeam | undefined {
  return NATIONAL_TEAMS.find((team) => team.id === id);
}
