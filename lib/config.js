/**
 * App-wide constants. Pure data, safe to import from tests.
 *
 * TEMPLATE is the repo the in-app updater syncs app files from.
 * CATALOG is the public gym catalog the app imports gyms from.
 */
export const APP_NAME = 'TrainTracks';
export const APP_VERSION = '0.1.0';

export const TEMPLATE = { owner: 'traintracksapp', repo: 'traintracks', branch: 'main' };
export const CATALOG = { owner: 'logtrim', repo: 'gyms', branch: 'main' };

/** localStorage / sessionStorage keys. One origin = one app instance. */
export const STORAGE = {
  cfg: 'tt-cfg',
  remember: 'tt-remember',
  celebrated: 'tt-celebrated',
  theme: 'tt-theme'
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
 * user's repo — log, profile, goals, my-gyms, generic.local.json, workflows,
 * secrets — is never touched.
 */
export const SYNC_PREFIXES = [
  'index.html',
  'app/',
  'lib/',
  'docs/',
  'pipelines/',
  'equipment/generic/',
  'CHANGELOG.md',
  'VERSION',
  'CLAUDE.md'
];

/** Log types and how each one uses the numeric fields. */
export const LOG_TYPES = {
  weight: { label: 'Weight & Reps', fields: ['weight', 'reps'] },
  reps:   { label: 'Reps only',     fields: ['reps'] },
  cardio: { label: 'Incline Training', fields: ['duration', 'level', 'incline', 'hr'] },
  pace:   { label: 'Duration & Level', fields: ['duration', 'level'] },
  walk:   { label: 'Distance & Time',  fields: ['level', 'duration'] },
  time:   { label: 'Time (secs)',      fields: ['duration'] },
  mins:   { label: 'Time (mins)',      fields: ['duration'] }
};

export const AEROBIC_TYPES = ['walk', 'pace', 'cardio', 'mins'];
