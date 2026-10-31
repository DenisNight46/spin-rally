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
  { id: "aut", name: "Австрия", shortName: "AUT", flag: "🇦🇹", confederation: "Europe", crest: { initials: "A", primary: "#c83e46", secondary: "#f4f0e9", accent: "#274c7b", motif: "laurel" } },
  { id: "hkg", name: "Гонконг", shortName: "HKG", flag: "🇭🇰", confederation: "Asia", crest: { initials: "H", primary: "#bd2638", secondary: "#f5f0e9", accent: "#d6b45a", motif: "wave" } },
  { id: "tpe", name: "Китайский Тайбэй", shortName: "TPE", flag: "🇹🇼", confederation: "Asia", crest: { initials: "T", primary: "#234b88", secondary: "#e9edf3", accent: "#c43d47", motif: "sun" } },
  { id: "prk", name: "КНДР", shortName: "PRK", flag: "🇰🇵", confederation: "Asia", crest: { initials: "K", primary: "#1f4c83", secondary: "#f1eee8", accent: "#c93b45", motif: "star" } },
  { id: "kaz", name: "Казахстан", shortName: "KAZ", flag: "🇰🇿", confederation: "Asia", crest: { initials: "K", primary: "#2b82ad", secondary: "#f0cf5b", accent: "#f4efe4", motif: "sun" } },
  { id: "tha", name: "Таиланд", shortName: "THA", flag: "🇹🇭", confederation: "Asia", crest: { initials: "T", primary: "#a93246", secondary: "#f2eee8", accent: "#294c7d", motif: "wave" } },
  { id: "mas", name: "Малайзия", shortName: "MAS", flag: "🇲🇾", confederation: "Asia", crest: { initials: "M", primary: "#24477d", secondary: "#f2eee8", accent: "#c83d45", motif: "star" } },
  { id: "iri", name: "Иран", shortName: "IRI", flag: "🇮🇷", confederation: "Asia", crest: { initials: "I", primary: "#26704c", secondary: "#f3eee7", accent: "#c83d43", motif: "laurel" } },
  { id: "den", name: "Дания", shortName: "DEN", flag: "🇩🇰", confederation: "Europe", crest: { initials: "D", primary: "#b93643", secondary: "#f4eee8", accent: "#d7b45b", motif: "star" } },
  { id: "ita", name: "Италия", shortName: "ITA", flag: "🇮🇹", confederation: "Europe", crest: { initials: "I", primary: "#24704e", secondary: "#f2eee8", accent: "#c83d43", motif: "laurel" } },
  { id: "esp", name: "Испания", shortName: "ESP", flag: "🇪🇸", confederation: "Europe", crest: { initials: "E", primary: "#bd3b3d", secondary: "#e7bd4e", accent: "#f3eee6", motif: "sun" } },
  { id: "bel", name: "Бельгия", shortName: "BEL", flag: "🇧🇪", confederation: "Europe", crest: { initials: "B", primary: "#24282b", secondary: "#e5b642", accent: "#bd3d42", motif: "eagle" } },
  { id: "cro", name: "Хорватия", shortName: "CRO", flag: "🇭🇷", confederation: "Europe", crest: { initials: "C", primary: "#bd3e48", secondary: "#f1eee8", accent: "#31578d", motif: "wave" } },
  { id: "srb", name: "Сербия", shortName: "SRB", flag: "🇷🇸", confederation: "Europe", crest: { initials: "S", primary: "#bd3945", secondary: "#f2eee8", accent: "#31558c", motif: "eagle" } },
  { id: "hun", name: "Венгрия", shortName: "HUN", flag: "🇭🇺", confederation: "Europe", crest: { initials: "H", primary: "#26704e", secondary: "#f2eee8", accent: "#bd3d45", motif: "mountain" } },
  { id: "svk", name: "Словакия", shortName: "SVK", flag: "🇸🇰", confederation: "Europe", crest: { initials: "S", primary: "#31558c", secondary: "#f2eee8", accent: "#bd3d45", motif: "mountain" } },
  { id: "slo", name: "Словения", shortName: "SLO", flag: "🇸🇮", confederation: "Europe", crest: { initials: "S", primary: "#31558c", secondary: "#f2eee8", accent: "#bd3d45", motif: "mountain" } },
] as const;

export function getNationalTeam(id: string): NationalTeam | undefined {
  return NATIONAL_TEAMS.find((team) => team.id === id);
}

/** Returns a stable, read-only catalogue view for the selected confederation. */
export function getTeamsByConfederation(confederation: Confederation | "All"): readonly NationalTeam[] {
  return confederation === "All"
    ? NATIONAL_TEAMS
    : NATIONAL_TEAMS.filter((team) => team.confederation === confederation);
}

/** ISO 3166-1 alpha-2 codes used by FlagCDN for the national team flag assets. */
export const NATIONAL_TEAM_FLAG_CODES: Readonly<Record<string, string>> = {
  chn: "cn", jpn: "jp", kor: "kr", ind: "in", sgp: "sg", swe: "se", ger: "de", fra: "fr",
  por: "pt", pol: "pl", rou: "ro", rus: "ru", egy: "eg", bra: "br", usa: "us", aut: "at",
  hkg: "hk", tpe: "tw", prk: "kp", kaz: "kz", tha: "th", mas: "my", iri: "ir", den: "dk",
  ita: "it", esp: "es", bel: "be", cro: "hr", srb: "rs", hun: "hu", svk: "sk", slo: "si",
};
