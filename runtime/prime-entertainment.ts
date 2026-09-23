/**
 * Prime Entertainment is deliberately data-first.  The local catalogue is a
 * small editorial bootstrap, not a replacement for a licensed metadata
 * provider.  Providers can implement EntertainmentProvider without changing
 * the conversational or recommendation layer.
 */
export type EntertainmentKind = 'MUSIC' | 'FILM';
export type PreferenceSignal =
  | 'explicit_like'
  | 'explicit_dislike'
  | 'search'
  | 'save'
  | 'conversation_preference';

export interface EntertainmentItem {
  id: string;
  kind: EntertainmentKind;
  title: string;
  creators: string[];
  year: number;
  genres: string[];
  moods: string[];
  themes: string[];
  source: 'EDITORIAL_BOOTSTRAP' | 'PROVIDER';
}

export interface EntertainmentProvider {
  search(query: string, kind?: EntertainmentKind): Promise<EntertainmentItem[]>;
  get(id: string): Promise<EntertainmentItem | null>;
}

export type TasteProfile = {
  likedGenres: string[];
  likedMoods: string[];
  discoveryTolerance: 'FAMILIAR' | 'BALANCED' | 'ADVENTUROUS';
  signals: Array<{ type: PreferenceSignal; value: string }>;
};

export type EntertainmentAnswer = {
  status: 'ENTERTAINMENT_ANSWER';
  reply: string;
  facts: string[];
  interpretation: string[];
  recommendations: Array<{
    item: EntertainmentItem;
    why: string;
    confidence: 'HIGH' | 'MEDIUM';
  }>;
  profile: TasteProfile;
};

const CATALOGUE: EntertainmentItem[] = [
  { id: 'music-untrue', kind: 'MUSIC', title: 'Untrue', creators: ['Burial'], year: 2007, genres: ['electronic', 'uk garage'], moods: ['dark', 'late-night', 'atmospheric'], themes: ['urban solitude'], source: 'EDITORIAL_BOOTSTRAP' },
  { id: 'music-moon-safari', kind: 'MUSIC', title: 'Moon Safari', creators: ['Air'], year: 1998, genres: ['electronic', 'downtempo'], moods: ['night-drive', 'cinematic', 'warm'], themes: ['space-age romance'], source: 'EDITORIAL_BOOTSTRAP' },
  { id: 'music-immunity', kind: 'MUSIC', title: 'Immunity', creators: ['Jon Hopkins'], year: 2013, genres: ['electronic', 'ambient techno'], moods: ['late-night', 'immersive', 'kinetic'], themes: ['transformation'], source: 'EDITORIAL_BOOTSTRAP' },
  { id: 'music-kid-a', kind: 'MUSIC', title: 'Kid A', creators: ['Radiohead'], year: 2000, genres: ['alternative', 'electronic'], moods: ['alienated', 'atmospheric', 'restless'], themes: ['modern anxiety'], source: 'EDITORIAL_BOOTSTRAP' },
  { id: 'music-vespertine', kind: 'MUSIC', title: 'Vespertine', creators: ['Björk'], year: 2001, genres: ['electronic', 'art pop'], moods: ['intimate', 'immersive', 'wintery'], themes: ['interior life'], source: 'EDITORIAL_BOOTSTRAP' },
  { id: 'film-blade-runner-2049', kind: 'FILM', title: 'Blade Runner 2049', creators: ['Denis Villeneuve'], year: 2017, genres: ['science fiction', 'neo-noir'], moods: ['atmospheric', 'melancholic', 'dystopian'], themes: ['identity', 'memory'], source: 'EDITORIAL_BOOTSTRAP' },
  { id: 'film-her', kind: 'FILM', title: 'Her', creators: ['Spike Jonze'], year: 2013, genres: ['science fiction', 'romance'], moods: ['intimate', 'melancholic', 'visually beautiful'], themes: ['connection', 'technology'], source: 'EDITORIAL_BOOTSTRAP' },
  { id: 'film-in-the-mood-for-love', kind: 'FILM', title: 'In the Mood for Love', creators: ['Wong Kar-wai'], year: 2000, genres: ['romance', 'drama'], moods: ['visually beautiful', 'emotionally devastating', 'melancholic'], themes: ['longing', 'missed connection'], source: 'EDITORIAL_BOOTSTRAP' },
  { id: 'film-arrival', kind: 'FILM', title: 'Arrival', creators: ['Denis Villeneuve'], year: 2016, genres: ['science fiction', 'drama'], moods: ['contemplative', 'emotionally devastating', 'atmospheric'], themes: ['language', 'time'], source: 'EDITORIAL_BOOTSTRAP' },
  { id: 'film-drive', kind: 'FILM', title: 'Drive', creators: ['Nicolas Winding Refn'], year: 2011, genres: ['neo-noir', 'crime'], moods: ['night-drive', 'stylized', 'melancholic'], themes: ['isolation', 'violence'], source: 'EDITORIAL_BOOTSTRAP' }
];

const MUSIC_WORDS = /\b(music|listen|album|albums|artist|artists|song|songs|playlist|radiohead|electronic|aphex|tempo)\b/i;
const FILM_WORDS = /\b(film|films|movie|movies|cinema|watch|watchlist|director|directors|blade runner|soundtrack)\b/i;

export function looksLikeEntertainmentRequest(message: string): boolean {
  return MUSIC_WORDS.test(message) || FILM_WORDS.test(message);
}

export function entertainmentCatalogueSnapshot(): {
  source: 'EDITORIAL_BOOTSTRAP';
  item_count: number;
  music_count: number;
  film_count: number;
  persisted_taste_profile: false;
  items: Array<{
    id: string;
    kind: EntertainmentKind;
    title: string;
    creators: string[];
    year: number;
    genres: string[];
  }>;
} {
  return {
    source: 'EDITORIAL_BOOTSTRAP',
    item_count: CATALOGUE.length,
    music_count: CATALOGUE.filter(item => item.kind === 'MUSIC').length,
    film_count: CATALOGUE.filter(item => item.kind === 'FILM').length,
    persisted_taste_profile: false,
    items: CATALOGUE.map(item => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      creators: [...item.creators],
      year: item.year,
      genres: [...item.genres]
    }))
  };
}

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function profileFrom(message: string): TasteProfile {
  const input = message.toLowerCase();
  const likedMoods = ['dark', 'late-night', 'atmospheric', 'cinematic', 'visually beautiful', 'emotionally devastating', 'melancholic']
    .filter(mood => input.includes(mood));
  const likedGenres = ['electronic', 'science fiction', 'neo-noir', 'ambient', 'romance']
    .filter(genre => input.includes(genre));
  return {
    likedGenres,
    likedMoods,
    discoveryTolerance: /something new|surprise|unexpected|deep cut/i.test(message) ? 'ADVENTUROUS' : 'BALANCED',
    signals: [...likedGenres, ...likedMoods].map(value => ({ type: 'conversation_preference' as const, value }))
  };
}

function intendedKind(message: string): EntertainmentKind | undefined {
  const music = MUSIC_WORDS.test(message);
  const film = FILM_WORDS.test(message);
  return music === film ? undefined : music ? 'MUSIC' : 'FILM';
}

function score(item: EntertainmentItem, query: string, profile: TasteProfile): number {
  const haystack = tokens([item.title, ...item.creators, ...item.genres, ...item.moods, ...item.themes].join(' '));
  const queryMatches = tokens(query).filter(token => haystack.includes(token)).length;
  const preferenceMatches = [...profile.likedGenres, ...profile.likedMoods]
    .filter(value => haystack.includes(value)).length;
  const lessDystopianBonus = /less dystopian/i.test(query) && !item.moods.includes('dystopian') ? 3 : 0;
  return queryMatches + preferenceMatches * 2 + lessDystopianBonus;
}

function describeWhy(item: EntertainmentItem, profile: TasteProfile, query: string): string {
  const overlaps = [...item.genres, ...item.moods]
    .filter(value => [...profile.likedGenres, ...profile.likedMoods].includes(value));
  if (overlaps.length) return `Matches the ${overlaps.slice(0, 2).join(' and ')} qualities you asked for.`;
  if (/radiohead/i.test(query) && item.kind === 'MUSIC') return 'A strong next step from Radiohead: adventurous, textural, and emotionally precise.';
  if (/blade runner/i.test(query) && item.kind === 'FILM') return 'Keeps the reflective science-fiction atmosphere while moving away from full dystopia.';
  return `Selected for its ${item.moods.slice(0, 2).join(' and ')} character.`;
}

export function answerEntertainment(message: string): EntertainmentAnswer {
  const profile = profileFrom(message);
  const kind = intendedKind(message);
  const ranked = CATALOGUE
    .filter(item => !kind || item.kind === kind)
    .map(item => ({ item, score: score(item, message, profile) }))
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, 4);
  const recommendations = ranked.map(({ item, score: itemScore }) => ({
    item,
    why: describeWhy(item, profile, message),
    confidence: itemScore >= 3 ? 'HIGH' as const : 'MEDIUM' as const
  }));
  const names = recommendations.map(result => `${result.item.title} — ${result.item.creators.join(', ')}`);
  return {
    status: 'ENTERTAINMENT_ANSWER',
    reply: `Start with ${names.slice(0, 3).join('; ')}. These are editorial discovery suggestions, not retrieved provider results.`,
    facts: recommendations.map(result => `${result.item.title} is an editorial bootstrap entry; source: ${result.item.source}.`),
    interpretation: profile.likedMoods.length || profile.likedGenres.length
      ? [`I interpreted your request as a preference for ${[...profile.likedMoods, ...profile.likedGenres].slice(0, 3).join(', ')}.`]
      : ['I used the cultural intent in your request and a small local editorial catalogue.'],
    recommendations,
    profile
  };
}
