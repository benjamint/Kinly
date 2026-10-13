import type { ActivityResult, Game, Household, Language } from "./types.js";

// Content and rules for Kinly's free activities. Everything here is plain
// data and pure functions (tested in tests/activities.test.ts); the screens
// in src/elder/activities only draw it.

export type Rng = () => number;

const pick = <T,>(xs: readonly T[], rng: Rng): T => xs[Math.floor(rng() * xs.length)];

export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- difficulty ----------

/** Level 1–3 for a game, from its last three results: step up after doing well, down after a struggle. */
export function levelFor(game: Game, log: ActivityResult[] = []): number {
  const recent = log.filter((r) => r.game === game).slice(-3);
  if (!recent.length) return 1;
  const last = recent[recent.length - 1].level;
  const avg = recent.reduce((s, r) => s + r.score, 0) / recent.length;
  const next = avg >= 0.8 && recent.length >= 2 ? last + 1 : avg < 0.4 ? last - 1 : last;
  return Math.max(1, Math.min(3, next));
}

// ---------- matching pairs ----------

export interface PairItem {
  id: string;
  emoji: string;
  en: string;
  sw: string;
}

export const PAIR_ITEMS: PairItem[] = [
  { id: "mango", emoji: "🥭", en: "mango", sw: "embe" },
  { id: "plantain", emoji: "🍌", en: "plantain", sw: "ndizi" },
  { id: "pineapple", emoji: "🍍", en: "pineapple", sw: "nanasi" },
  { id: "tomato", emoji: "🍅", en: "tomato", sw: "nyanya" },
  { id: "fish", emoji: "🐟", en: "fish", sw: "samaki" },
  { id: "coconut", emoji: "🥥", en: "coconut", sw: "nazi" },
  { id: "corn", emoji: "🌽", en: "corn", sw: "mahindi" },
  { id: "groundnuts", emoji: "🥜", en: "groundnuts", sw: "karanga" },
  { id: "onion", emoji: "🧅", en: "onion", sw: "kitunguu" },
  { id: "egg", emoji: "🥚", en: "egg", sw: "yai" },
  { id: "chicken", emoji: "🐔", en: "chicken", sw: "kuku" },
  { id: "pepper", emoji: "🌶️", en: "pepper", sw: "pilipili" },
];

export interface PairCard {
  key: number;
  item: PairItem;
}

/** 3, 4 or 6 pairs depending on level, shuffled. */
export function pairsDeck(level: number, rng: Rng = Math.random): PairCard[] {
  const pairs = level >= 3 ? 6 : level === 2 ? 4 : 3;
  const items = shuffle(PAIR_ITEMS, rng).slice(0, pairs);
  return shuffle([...items, ...items], rng).map((item, key) => ({ key, item }));
}

/** Score for a finished game: perfect play (one try per pair) is 1. */
export function pairsScore(pairs: number, attempts: number): number {
  return Math.max(0, Math.min(1, pairs / Math.max(pairs, attempts)));
}

// ---------- proverbs ----------

export interface Proverb {
  start: string;
  end: string;
  /** Where it's from, if well known. */
  origin?: string;
  lang: Language;
}

export const PROVERBS: Proverb[] = [
  { start: "When the music changes,", end: "so does the dance.", origin: "Hausa", lang: "en" },
  { start: "However long the night,", end: "the dawn will break.", lang: "en" },
  { start: "If you want to go fast, go alone;", end: "if you want to go far, go together.", lang: "en" },
  { start: "A single bracelet", end: "does not jingle.", origin: "Congo", lang: "en" },
  { start: "Rain does not fall", end: "on one roof alone.", origin: "Cameroon", lang: "en" },
  { start: "Wisdom is like a baobab tree:", end: "no one person can embrace it.", origin: "Akan", lang: "en" },
  { start: "It takes a village", end: "to raise a child.", lang: "en" },
  { start: "Do not look where you fell,", end: "but where you slipped.", lang: "en" },
  { start: "When the roots are deep,", end: "there is no reason to fear the wind.", lang: "en" },
  { start: "Sticks in a bundle", end: "are unbreakable.", origin: "Kenya", lang: "en" },
  { start: "An old person sitting", end: "sees farther than a young person standing.", origin: "Wolof", lang: "en" },
  { start: "Hold a true friend", end: "with both hands.", lang: "en" },
  { start: "Where there is love,", end: "there is no darkness.", origin: "Burundi", lang: "en" },
  { start: "The sun does not forget a village", end: "just because it is small.", lang: "en" },
  { start: "Smooth seas", end: "do not make skilful sailors.", lang: "en" },
  { start: "The one who asks the way", end: "does not get lost.", lang: "en" },
  { start: "Knowledge is like a garden:", end: "if it is not tended, it cannot be harvested.", origin: "Guinea", lang: "en" },
  { start: "Until the lion learns to write,", end: "every story will glorify the hunter.", lang: "en" },
  { start: "Haba na haba", end: "hujaza kibaba.", lang: "sw" },
  { start: "Pole pole", end: "ndio mwendo.", lang: "sw" },
  { start: "Usipoziba ufa", end: "utajenga ukuta.", lang: "sw" },
  { start: "Mgeni siku mbili,", end: "siku ya tatu mpe jembe.", lang: "sw" },
  { start: "Bandu bandu", end: "huisha gogo.", lang: "sw" },
  { start: "Mtaka cha mvunguni", end: "sharti ainame.", lang: "sw" },
  { start: "Akili ni nywele,", end: "kila mtu ana zake.", lang: "sw" },
];

export interface ProverbRound {
  proverb: Proverb;
  choices: string[];
}

/** A proverb in the elder's language with the right ending and two others. Avoids the recently used ones. */
export function proverbRound(lang: Language, rng: Rng = Math.random, avoid: string[] = []): ProverbRound {
  const pool = PROVERBS.filter((p) => p.lang === lang);
  const fresh = pool.filter((p) => !avoid.includes(p.start));
  const proverb = pick(fresh.length ? fresh : pool, rng);
  const others = shuffle(pool.filter((p) => p !== proverb), rng).slice(0, 2).map((p) => p.end);
  return { proverb, choices: shuffle([proverb.end, ...others], rng) };
}

// ---------- market maths ----------

const CURRENCY_BY_ZONE: Record<string, string> = {
  "Africa/Accra": "cedis",
  "Africa/Lagos": "naira",
  "Africa/Nairobi": "shillings",
  "Africa/Dar_es_Salaam": "shillings",
  "Africa/Kampala": "shillings",
  "Africa/Kigali": "francs",
  "Africa/Johannesburg": "rand",
  "Africa/Addis_Ababa": "birr",
};

export function currencyFor(household: Household): string {
  return household.elder.currency?.trim() || CURRENCY_BY_ZONE[household.elder.timezone] || "cedis";
}

export interface MathsRound {
  question: string;
  answer: number;
  choices: number[];
}

const GOODS = ["tomatoes", "onions", "bread", "eggs", "rice", "fish", "plantain", "oranges"];

/** A friendly market sum. Level 1: small additions; 2: bigger additions; 3: change from a note. */
export function mathsRound(level: number, currency: string, rng: Rng = Math.random): MathsRound {
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const [a, b] = shuffle(GOODS, rng);
  let question: string;
  let answer: number;
  if (level <= 1) {
    const x = int(1, 9);
    const y = int(1, 9);
    question = `${cap(a)}: ${x} ${currency}. ${cap(b)}: ${y} ${currency}. How much altogether?`;
    answer = x + y;
  } else if (level === 2) {
    const x = int(5, 25);
    const y = int(5, 25);
    question = `${cap(a)}: ${x} ${currency}. ${cap(b)}: ${y} ${currency}. How much altogether?`;
    answer = x + y;
  } else {
    const note = pick([20, 50, 100], rng);
    const price = int(Math.floor(note / 5), note - 1);
    question = `You buy ${a} for ${price} ${currency} and pay with ${note} ${currency}. How much change?`;
    answer = note - price;
  }
  const wrong = new Set<number>();
  for (const d of shuffle([1, 2, 3, 5, 10, -1, -2, -3, -5, -10], rng)) {
    if (wrong.size === 2) break;
    if (answer + d > 0) wrong.add(answer + d);
  }
  return { question, answer, choices: shuffle([answer, ...wrong], rng) };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---------- drum memory ----------

export const DRUMS = 4;

/** Starting length grows with level; each successful round adds one beat. */
export function drumStart(level: number, rng: Rng = Math.random): number[] {
  return Array.from({ length: level + 1 }, () => Math.floor(rng() * DRUMS));
}

export function drumNext(seq: number[], rng: Rng = Math.random): number[] {
  return [...seq, Math.floor(rng() * DRUMS)];
}

// ---------- chair exercises ----------

export interface Exercise {
  id: string;
  emoji: string;
  title: { en: string; sw: string };
  how: { en: string; sw: string };
  reps: number;
  /** Seconds per repetition (slow and steady). */
  secondsEach: number;
}

export const EXERCISES: Exercise[] = [
  {
    id: "breathe",
    emoji: "🌬️",
    title: { en: "Deep breaths", sw: "Pumua kwa kina" },
    how: { en: "Breathe in slowly through your nose, then out through your mouth.", sw: "Vuta pumzi polepole kwa pua, kisha toa kwa mdomo." },
    reps: 4,
    secondsEach: 6,
  },
  {
    id: "shoulders",
    emoji: "🔄",
    title: { en: "Shoulder rolls", sw: "Zungusha mabega" },
    how: { en: "Sit tall. Roll both shoulders up, back and down.", sw: "Kaa wima. Zungusha mabega juu, nyuma na chini." },
    reps: 6,
    secondsEach: 4,
  },
  {
    id: "arms",
    emoji: "🙌",
    title: { en: "Arm raises", sw: "Inua mikono" },
    how: { en: "Lift both arms slowly in front of you, as high as is comfortable, then lower them.", sw: "Inua mikono yote polepole mbele yako, kisha ishushe." },
    reps: 6,
    secondsEach: 5,
  },
  {
    id: "march",
    emoji: "🚶",
    title: { en: "March while seated", sw: "Tembea ukiwa umekaa" },
    how: { en: "Hold the chair. Lift one knee, then the other, like walking.", sw: "Shika kiti. Inua goti moja, kisha lingine, kama unatembea." },
    reps: 10,
    secondsEach: 2,
  },
  {
    id: "ankles",
    emoji: "🦶",
    title: { en: "Ankle circles", sw: "Zungusha vifundo" },
    how: { en: "Lift one foot a little and turn it in slow circles. Then the other foot.", sw: "Inua mguu kidogo na uuzungushe polepole. Kisha mguu mwingine." },
    reps: 6,
    secondsEach: 4,
  },
  {
    id: "hands",
    emoji: "✊",
    title: { en: "Open and close hands", sw: "Fungua na funga mikono" },
    how: { en: "Make a gentle fist, then spread your fingers wide.", sw: "Kunja ngumi taratibu, kisha nyoosha vidole." },
    reps: 8,
    secondsEach: 3,
  },
  {
    id: "neck",
    emoji: "🙂",
    title: { en: "Look left and right", sw: "Angalia kushoto na kulia" },
    how: { en: "Slowly turn your head to look left, back to the middle, then right.", sw: "Geuza kichwa polepole kushoto, katikati, kisha kulia." },
    reps: 4,
    secondsEach: 5,
  },
  {
    id: "stretch",
    emoji: "🌅",
    title: { en: "Big stretch", sw: "Jinyooshe" },
    how: { en: "Reach both arms up high and stretch, then relax. Well done!", sw: "Nyoosha mikono juu sana, kisha pumzika. Hongera!" },
    reps: 3,
    secondsEach: 5,
  },
];

// ---------- praise ----------

const PRAISE = {
  en: ["Wonderful!", "Well done!", "Very good!", "You remembered!", "Excellent!", "Lovely!"],
  sw: ["Hongera!", "Vizuri sana!", "Safi sana!", "Umekumbuka!", "Bora kabisa!"],
};
const ENCOURAGE = {
  en: ["Nearly! Let's look again.", "Good try. Here it is.", "That's all right, let's keep going."],
  sw: ["Karibu! Tuangalie tena.", "Jaribio zuri. Hii hapa.", "Si neno, tuendelee."],
};

export const praise = (lang: Language, rng: Rng = Math.random) => pick(PRAISE[lang], rng);
export const encourage = (lang: Language, rng: Rng = Math.random) => pick(ENCOURAGE[lang], rng);
