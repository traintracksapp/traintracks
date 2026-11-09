/**
 * App-wide constants. Pure data, safe to import from tests.
 */
export const APP_NAME = 'TrainTracks';
export const APP_VERSION = '0.2.3';

/** The repo the in-app updater copies app files from. */
export const TEMPLATE = { owner: 'traintracksapp', repo: 'traintracks', branch: 'main' };
/** The public gym catalog (format version 1, converted on import). Read-only. */
export const CATALOG = { owner: 'logtrim', repo: 'gyms', branch: 'main' };

/** localStorage keys (kept from 0.1.0 so devices stay signed in). */
export const STORAGE = {
  cfg: 'tt-cfg',
  celebrated: 'tt-celebrated',
  theme: 'tt-theme',
  outbox: 'tt-outbox'   // + ':user/repo': log changes not sent to GitHub yet
};

/** Files in the user's repo. */
export const FILES = {
  log: 'workout-log.json',
  csv: 'workout-log.csv',
  profile: 'profile.json',
  goals: 'goals.json',
  plan: 'suggested-workout.json',
  generic: 'equipment/generic/gym.json',
  genericLocal: 'equipment/generic.local.json',
  myGyms: 'equipment/my-gyms',
  wellness: 'daily-wellness.csv',
  buckets: 'cardio-buckets.csv',
  garminRecent: 'garmin-recent.json',
  version: 'VERSION'
};

/**
 * Paths the updater may overwrite from the template. Everything else in the
 * user's repo (log, profile, goals, my-gyms, generic.local.json, workflows,
 * Garmin settings) is never touched.
 */
export const SYNC_PREFIXES = [
  'index.html', 'app/', 'lib/', 'docs/', 'equipment/generic/',
  'pipelines/garmin/', 'CHANGELOG.md', 'VERSION', 'CLAUDE.md', '.nojekyll'
];

/**
 * Files under SYNC_PREFIXES that hold each user's own settings and must
 * never be overwritten by an update. The template ships placeholders.
 */
export const SYNC_EXCLUDE = [
  'pipelines/garmin/zones.json',
  'pipelines/garmin/corrections.json',
  'pipelines/garmin/mapping.json'
];

/** Machine log types: what the form shows. Field lists are in lib/log.js (LOG_TYPE_FIELDS). */
export const LOG_TYPES = {
  weight: { label: 'Weight & reps' },
  reps: { label: 'Reps only' },
  time: { label: 'Time (seconds)' },
  mins: { label: 'Time (minutes)' },
  cardio: { label: 'Treadmill (speed & incline)' },
  pace: { label: 'Duration & speed' },
  walk: { label: 'Distance & time' }
};

/** Log types that count as cardio. */
export const CARDIO_TYPES = ['walk', 'pace', 'cardio', 'mins'];
