// lib/employee-name-match.ts
//
// Resilient employee-name matching for imports (first used by /adp-ytd-import
// through POST /api/employee-ytd-carryover/match). Pure functions only, so the
// whole directory can be matched in memory in one pass: the route loads every
// profile once and matches a whole batch of names against it, instead of one
// HTTP request + DB round trip per name.
//
// Names coming out of ADP reports and paystub PDFs rarely look exactly like
// profiles.official_name. This tolerates:
//   - case, accents (José = Jose), punctuation, hyphens, apostrophes (O'Brien)
//   - "Last, First Middle" ordering and plain "LAST FIRST" ordering
//   - middle names / initials and a second surname present on one side only
//   - suffixes (Jr, Sr, II, III, IV) and particles (de, la, del, van, ...)
//   - spacing differences (De La Cruz = Delacruz, Mc Donald = McDonald)
//   - common nicknames (Bill = William), shortened names (Chris = Christopher)
//     and small typos (Jonh = John)
//
// Only token-exact matches (exact / normalized / partial) are applied
// automatically. Anything relying on a nickname, prefix or typo, or any tie
// between two people, comes back as a suggestion for a human to confirm,
// because a wrong match would put one person's YTD taxes on someone else's
// paystub.

export type DirectoryPerson = {
  userId: string;
  // Every known spelling of this person's name, primary first (official_name,
  // then "first last", ...). Hits on a later spelling score 1% lower, so when
  // one person's official name equals another person's first+last name the
  // official name wins, as it did with the old exact official_name lookup.
  names: string[];
  // Name shown to the reviewer.
  label: string;
  email?: string | null;
  active?: boolean;
};

export type MatchMethod = 'exact' | 'normalized' | 'partial' | 'fuzzy';

export type NameCandidate = {
  userId: string;
  name: string;
  email: string | null;
  active: boolean;
  score: number;
  method: MatchMethod;
};

export type NameMatchResult = {
  query: string;
  // Set only when the match is confident enough to apply automatically.
  userId: string | null;
  matchedName: string | null;
  method: MatchMethod | null;
  score: number;
  // matched   = applied automatically
  // ambiguous = two or more people fit equally well; reviewer must pick
  // suggested = only near matches (nickname / typo / partial order); reviewer must pick
  // none      = nothing close enough
  status: 'matched' | 'ambiguous' | 'suggested' | 'none';
  candidates: NameCandidate[];
};

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'vi', 'phd', 'md', 'esq']);
const PARTICLES = new Set(['de', 'del', 'della', 'la', 'las', 'los', 'da', 'das', 'do', 'dos', 'di', 'du', 'van', 'von', 'der', 'den', 'le', 'y', 'e', 'st']);

// Nickname groups: any two names in the same group are treated as a near match.
const NICKNAME_GROUPS: string[][] = [
  ['william', 'will', 'bill', 'billy', 'willy', 'liam'],
  ['robert', 'rob', 'bob', 'bobby', 'robbie', 'bert'],
  ['richard', 'rich', 'rick', 'ricky', 'dick', 'ricardo'],
  ['james', 'jim', 'jimmy', 'jamie', 'jaime'],
  ['john', 'johnny', 'jack', 'jon', 'juan'],
  ['jonathan', 'johnathan', 'jon', 'jonny', 'nathan'],
  ['joseph', 'joe', 'joey', 'jose', 'pepe'],
  ['michael', 'mike', 'mikey', 'mick', 'miguel'],
  ['christopher', 'chris', 'cristopher', 'kris', 'cristobal'],
  ['christian', 'chris', 'cristian'],
  ['christina', 'christine', 'cristina', 'tina', 'chris'],
  ['daniel', 'dan', 'danny'],
  ['anthony', 'tony', 'antonio', 'anton'],
  ['alexander', 'alex', 'alejandro', 'alexis', 'xander', 'sasha'],
  ['alexandra', 'alex', 'alejandra', 'sandra', 'lexi'],
  ['elizabeth', 'liz', 'lizzy', 'beth', 'betty', 'eliza', 'isabel', 'elisabeth'],
  ['katherine', 'catherine', 'kathryn', 'kate', 'katie', 'kathy', 'cathy', 'kat', 'catalina'],
  ['jennifer', 'jen', 'jenny', 'jenn'],
  ['jessica', 'jess', 'jessie'],
  ['francisco', 'frank', 'paco', 'pancho', 'cisco', 'franco'],
  ['francis', 'frank', 'frankie', 'fran'],
  ['guadalupe', 'lupe', 'lupita'],
  ['nicholas', 'nick', 'nicky', 'nicolas'],
  ['matthew', 'matt', 'mateo', 'matias'],
  ['andrew', 'andy', 'drew', 'andres'],
  ['thomas', 'tom', 'tommy', 'tomas'],
  ['edward', 'ed', 'eddie', 'ted', 'eduardo', 'lalo'],
  ['samuel', 'sam', 'sammy'],
  ['samantha', 'sam', 'sammy'],
  ['benjamin', 'ben', 'benny'],
  ['steven', 'stephen', 'steve', 'esteban'],
  ['timothy', 'tim', 'timmy'],
  ['kenneth', 'ken', 'kenny'],
  ['ronald', 'ron', 'ronnie'],
  ['donald', 'don', 'donnie'],
  ['patricia', 'pat', 'patty', 'tricia', 'patti'],
  ['patrick', 'pat', 'paddy', 'patricio'],
  ['margaret', 'maggie', 'meg', 'peggy', 'margarita'],
  ['rebecca', 'becky', 'becca'],
  ['victoria', 'vicky', 'tori'],
  ['gabriel', 'gabe'],
  ['gabriela', 'gabriella', 'gaby', 'gabby'],
  ['roberto', 'beto', 'rob'],
  ['alberto', 'beto', 'al'],
  ['ignacio', 'nacho'],
  ['jesus', 'chuy'],
  ['enrique', 'kike', 'henry'],
  ['rafael', 'rafa'],
  ['manuel', 'manny', 'manolo'],
  ['fernando', 'fer', 'nando'],
  ['gerardo', 'jerry', 'gerry'],
  ['gregory', 'greg'],
  ['zachary', 'zach', 'zack'],
  ['joshua', 'josh'],
  ['jacob', 'jake'],
  ['david', 'dave', 'davey'],
  ['charles', 'charlie', 'chuck', 'carlos'],
  ['jeffrey', 'jeff', 'geoffrey'],
  ['raymond', 'ray', 'ramon'],
  ['vincent', 'vince', 'vicente'],
  ['nathaniel', 'nate', 'nathan'],
  ['abigail', 'abby', 'abbie'],
  ['deborah', 'debbie', 'deb', 'debra'],
  ['susan', 'sue', 'susie', 'suzanne'],
  ['kimberly', 'kim'],
  ['melissa', 'missy', 'mel'],
  ['stephanie', 'steph', 'stefanie'],
  ['valerie', 'val'],
  ['veronica', 'ronnie', 'vero'],
  ['jacqueline', 'jackie'],
  ['dorothy', 'dot', 'dottie'],
  ['josephine', 'jo', 'josie', 'josefina'],
  ['maria', 'mary', 'marie', 'mari'],
  ['ana', 'anna', 'ann', 'anne', 'annie'],
  ['luis', 'louis', 'lou'],
  ['leonardo', 'leo'],
  ['diego', 'jaime'],
  ['eugene', 'gene'],
  ['lawrence', 'larry', 'laurence'],
  ['harold', 'harry', 'hal'],
  ['henry', 'hank', 'harry'],
  ['frederick', 'fred', 'freddy'],
  ['phillip', 'philip', 'phil', 'felipe'],
  ['peter', 'pete', 'pedro'],
  ['dominic', 'dom', 'domingo'],
  ['isaac', 'ike'],
  ['olivia', 'liv'],
  ['sophia', 'sofia', 'sophie'],
  ['natalie', 'natalia', 'nat'],
  ['amanda', 'mandy'],
  ['cynthia', 'cindy'],
  ['teresa', 'theresa', 'terry', 'tere'],
];

const NICKNAMES = new Map<string, Set<number>>();
NICKNAME_GROUPS.forEach((group, i) => {
  for (const n of group) {
    if (!NICKNAMES.has(n)) NICKNAMES.set(n, new Set());
    NICKNAMES.get(n)!.add(i);
  }
});

function areNicknames(a: string, b: string): boolean {
  const ga = NICKNAMES.get(a);
  const gb = NICKNAMES.get(b);
  if (!ga || !gb) return false;
  for (const g of ga) if (gb.has(g)) return true;
  return false;
}

// Lowercase ASCII, punctuation removed, "Last, First" flipped to "First Last".
export function normalizeName(raw: string): string {
  let s = String(raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const comma = s.indexOf(',');
  if (comma > 0) {
    const last = s.slice(0, comma).trim();
    const rest = s.slice(comma + 1).trim();
    // "Smith, Jr." is a suffix, not a reordering.
    const restIsSuffix = rest.split(/\s+/).every((t) => SUFFIXES.has(t.toLowerCase().replace(/[^a-z]/g, '')));
    if (rest && !restIsSuffix) s = `${rest} ${last}`;
  }
  return s
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type PreparedName = {
  full: string; // normalized, suffixes removed
  all: string[]; // every token except suffixes
  core: string[]; // no initials, no particles
  initials: string[]; // single-letter tokens
  compactAll: string;
  compactCore: string;
  sortedCore: string;
  suffix: string; // "jr", "sr", "iii", ... or '' (kept apart so father/son can be told apart)
};

export function prepareName(raw: string): PreparedName | null {
  const tokens = normalizeName(raw).split(' ').filter(Boolean);
  // A lone "v" stays as an initial; every other suffix is set aside.
  const isSuffix = (t: string) => SUFFIXES.has(t) && t.length > 1;
  const all = tokens.filter((t) => !isSuffix(t));
  const suffix = Array.from(new Set(tokens.filter(isSuffix))).join(' ');
  if (all.length === 0) return null;
  const initials = all.filter((t) => t.length === 1);
  let core = all.filter((t) => t.length > 1 && !PARTICLES.has(t));
  if (core.length === 0) core = all.filter((t) => t.length > 1);
  if (core.length === 0) return null;
  return {
    full: all.join(' '),
    all,
    core,
    initials,
    compactAll: all.join(''),
    compactCore: core.join(''),
    sortedCore: [...core].sort().join(' '),
    suffix,
  };
}

// Standard Jaro-Winkler similarity in [0, 1].
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatch = new Array<boolean>(la).fill(false);
  const bMatch = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, lb);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < la && prefix < lb && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const NEAR = 0.85; // minimum token similarity that counts as "the same token, nearly"

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (areNicknames(a, b)) return 0.93;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return 0.9;
  // Typos: short tokens need to be nearly identical to count.
  const jw = jaroWinkler(a, b);
  if (Math.min(a.length, b.length) <= 3) return jw >= 0.95 ? jw : 0;
  return jw >= NEAR ? Math.min(jw, 0.96) : 0;
}

type PairScore = { score: number; method: MatchMethod; auto: boolean };

// Middle initials that contradict the other name ("John A Smith" vs
// "John B Smith", or "John B Smith" vs "John Andrew Smith"). A middle initial
// missing on one side ("John B Smith" vs "John Smith") is not a conflict.
function initialsConflict(q: PreparedName, c: PreparedName): boolean {
  const oneWay = (from: PreparedName, other: PreparedName) => {
    if (from.initials.length === 0) return false;
    if (other.initials.length > 0) return !from.initials.some((i) => other.initials.includes(i));
    // Only tokens the other name has and this one lacks can be the middle
    // name the initial stands for (a hyphenated surname is not a middle name).
    const extras = other.core.filter((t) => !from.core.includes(t));
    if (extras.length === 0) return false;
    return !from.initials.some((i) => extras.some((t) => t[0] === i));
  };
  return oneWay(q, c) || oneWay(c, q);
}

export function compareNames(q: PreparedName, c: PreparedName): PairScore | null {
  // Different suffixes on both sides (Jr vs Sr) are different people.
  const suffixConflict = !!q.suffix && !!c.suffix && q.suffix !== c.suffix;
  if (q.full === c.full) {
    if (q.suffix === c.suffix) return { score: 1, method: 'exact', auto: true };
    // Suffix on one side only: still the same written name, so it counts as
    // exact, just below a person whose suffix also matches (father vs son).
    return suffixConflict ? { score: 0.84, method: 'normalized', auto: false } : { score: 0.98, method: 'exact', auto: true };
  }

  const conflict = initialsConflict(q, c) || suffixConflict;

  if (q.sortedCore === c.sortedCore || q.compactAll === c.compactAll || q.compactCore === c.compactCore) {
    return conflict ? { score: 0.84, method: 'normalized', auto: false } : { score: 0.97, method: 'normalized', auto: true };
  }

  // Token assignment between the shorter and the longer name.
  const [S, L] = q.core.length <= c.core.length ? [q.core, c.core] : [c.core, q.core];
  if (S.length < 2) return null; // one-word names only match exactly

  const pairs: { i: number; j: number; sim: number }[] = [];
  for (let i = 0; i < S.length; i++) {
    for (let j = 0; j < L.length; j++) {
      const sim = tokenSimilarity(S[i], L[j]);
      if (sim > 0) pairs.push({ i, j, sim });
    }
  }
  if (pairs.length < 2) return null;
  pairs.sort((x, y) => y.sim - x.sim);
  const usedS = new Set<number>();
  const usedL = new Set<number>();
  const chosen: { i: number; j: number; sim: number }[] = [];
  for (const p of pairs) {
    if (usedS.has(p.i) || usedL.has(p.j)) continue;
    usedS.add(p.i);
    usedL.add(p.j);
    chosen.push(p);
  }
  const exactPairs = chosen.filter((p) => p.sim === 1).length;
  if (chosen.length < 2) return null;

  // Does the shorter name's first token line up with the longer name's first
  // token? Given names come first in both normalized forms.
  const firstAligned = chosen.some((p) => p.i === 0 && p.j === 0);
  const extra = L.length - S.length;
  const avg = chosen.reduce((s, p) => s + p.sim, 0) / S.length;

  if (chosen.length === S.length) {
    if (exactPairs === S.length) {
      // Every token of the shorter name is in the longer one (missing middle
      // name / second surname). Automatic only when the given name lines up.
      const score = 0.93 - 0.01 * Math.min(extra, 3);
      const auto = firstAligned && !conflict;
      return { score: auto ? score : Math.min(score, 0.86), method: 'partial', auto };
    }
    // Nickname, shortened name or typo involved: suggestion only.
    const score = 0.9 * avg - 0.01 * Math.min(extra, 3) - (conflict ? 0.05 : 0);
    return { score, method: 'fuzzy', auto: false };
  }

  // Some tokens of the shorter name have no counterpart (e.g. "Maria Elena
  // Garcia" vs "Maria Garcia Lopez"). Worth suggesting only when at least two
  // tokens match exactly and the given name lines up.
  if (exactPairs >= 2 && firstAligned) {
    const unmatched = S.length - chosen.length;
    return { score: 0.78 - 0.04 * unmatched - (conflict ? 0.05 : 0), method: 'fuzzy', auto: false };
  }
  return { score: 0.5 * avg, method: 'fuzzy', auto: false };
}

export type PreparedDirectory = {
  people: (DirectoryPerson & { prepared: PreparedName[] })[];
  // token -> indexes of people having that token; used to skip people who
  // share nothing with the query.
  byToken: Map<string, number[]>;
  byPrefix: Map<string, number[]>;
};

export function prepareDirectory(people: DirectoryPerson[]): PreparedDirectory {
  const prepared = people.map((p) => {
    const seen = new Set<string>();
    const names: PreparedName[] = [];
    for (const n of p.names) {
      const pn = prepareName(n);
      if (pn && !seen.has(`${pn.full}|${pn.suffix}`)) {
        seen.add(`${pn.full}|${pn.suffix}`);
        names.push(pn);
      }
    }
    return { ...p, prepared: names };
  });
  const byToken = new Map<string, number[]>();
  const byPrefix = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, idx: number) => {
    const list = map.get(key);
    if (!list) map.set(key, [idx]);
    else if (list[list.length - 1] !== idx) list.push(idx);
  };
  prepared.forEach((p, idx) => {
    for (const pn of p.prepared) {
      for (const t of pn.core) {
        add(byToken, t, idx);
        add(byPrefix, t.slice(0, 2), idx);
      }
      add(byToken, `#${pn.compactAll}`, idx);
      add(byToken, `#${pn.compactCore}`, idx);
    }
  });
  return { people: prepared, byToken, byPrefix };
}

function candidateIndexes(dir: PreparedDirectory, q: PreparedName): number[] {
  const out = new Set<number>();
  const take = (list?: number[]) => list?.forEach((i) => out.add(i));
  take(dir.byToken.get(`#${q.compactAll}`));
  take(dir.byToken.get(`#${q.compactCore}`));
  for (const t of q.core) {
    take(dir.byToken.get(t));
    take(dir.byPrefix.get(t.slice(0, 2)));
    const groups = NICKNAMES.get(t);
    if (groups) {
      for (const g of groups) for (const nick of NICKNAME_GROUPS[g]) take(dir.byToken.get(nick));
    }
  }
  return Array.from(out);
}

const SECONDARY_NAME_FACTOR = 0.99;
const AUTO_MIN = 0.9;
const AUTO_MARGIN = 0.05;
const SUGGEST_MIN = 0.6;
const MAX_CANDIDATES = 5;

export function matchName(query: string, dir: PreparedDirectory): NameMatchResult {
  const base: NameMatchResult = {
    query,
    userId: null,
    matchedName: null,
    method: null,
    score: 0,
    status: 'none',
    candidates: [],
  };
  const q = prepareName(query);
  if (!q) return base;

  const scored: (NameCandidate & { auto: boolean })[] = [];
  for (const idx of candidateIndexes(dir, q)) {
    const person = dir.people[idx];
    let best: PairScore | null = null;
    for (let nameIndex = 0; nameIndex < person.prepared.length; nameIndex++) {
      const raw = compareNames(q, person.prepared[nameIndex]);
      if (!raw) continue;
      const s = nameIndex === 0 ? raw : { ...raw, score: raw.score * SECONDARY_NAME_FACTOR };
      if (!best || s.score > best.score || (s.score === best.score && s.auto && !best.auto)) best = s;
    }
    if (!best || best.score < SUGGEST_MIN) continue;
    scored.push({
      userId: person.userId,
      name: person.label,
      email: person.email ?? null,
      active: person.active !== false,
      score: Math.round(best.score * 1000) / 1000,
      method: best.method,
      auto: best.auto,
    });
  }
  // Highest score first; on a tie prefer an auto-level match, then active users.
  scored.sort((a, b) => b.score - a.score || Number(b.auto) - Number(a.auto) || Number(b.active) - Number(a.active));
  const candidates = scored.slice(0, MAX_CANDIDATES).map(({ auto, ...c }) => c);
  if (scored.length === 0) return base;

  const top = scored[0];
  const second = scored[1];
  // Exact name: confident unless a second person has the exact same name in
  // the same position (official vs official). Anything else also needs a
  // clear lead over the next person.
  const clearLead =
    top.method === 'exact'
      ? !second || second.score < top.score
      : !second || top.score - second.score >= AUTO_MARGIN;

  if (top.auto && top.score >= AUTO_MIN && clearLead) {
    return {
      ...base,
      userId: top.userId,
      matchedName: top.name,
      method: top.method,
      score: top.score,
      status: 'matched',
      candidates,
    };
  }
  const tiedAuto = top.auto && top.score >= AUTO_MIN && !clearLead;
  return {
    ...base,
    method: top.method,
    score: top.score,
    status: tiedAuto ? 'ambiguous' : 'suggested',
    candidates,
  };
}

export function matchNames(queries: string[], dir: PreparedDirectory): NameMatchResult[] {
  const cache = new Map<string, NameMatchResult>();
  return queries.map((query) => {
    const key = normalizeName(query);
    const hit = cache.get(key);
    if (hit) return { ...hit, query };
    const result = matchName(query, dir);
    cache.set(key, result);
    return result;
  });
}
