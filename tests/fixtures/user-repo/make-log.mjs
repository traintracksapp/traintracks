// Regenerates the fixture log (made-up data) in format version 2.
import fs from 'node:fs';
import { logToJSON, logToCSV } from '../../../lib/log.js';
const base = { gym_id: 'example-gym', gym: 'Example Gym', room_id: 'weights', room: 'Weight Room', time: '18:00:00', variant: [], notes: '' };
const log = [
  { ...base, id: 'f1', date: '2026-11-04', machine_id: 'r02', machine: 'Seated Row', set: 1, weight_lb: 60, reps: 12 },
  { ...base, id: 'f2', date: '2026-11-04', machine_id: 'r02', machine: 'Seated Row', set: 2, weight_lb: 70, reps: 10 },
  { ...base, id: 'f3', date: '2026-11-02', machine_id: 'assist', machine: 'Assisted Pull-up', set: 1, weight_lb: -100, reps: 8, notes: 'harder than expected' },
  { ...base, id: 'f4', date: '2026-11-01', room_id: 'cardio', room: 'Cardio', machine_id: 'tm', machine: 'Treadmill', set: 1, duration_sec: 1800, speed_mph: 3.3, incline_pct: 4, hr_avg_bpm: 118 },
  { ...base, id: 'f5', date: '2026-10-30', gym_id: 'generic', gym: 'Common Machines', room_id: 'bodyweight-no-equipment', room: 'Bodyweight — No Equipment', machine_id: 'push-ups', machine: 'Push Ups', set: 1, reps: 20, garmin_id: null }
];
const dir = new URL('.', import.meta.url).pathname;
fs.writeFileSync(dir + 'workout-log.json', logToJSON(log));
fs.writeFileSync(dir + 'workout-log.csv', logToCSV(log));
fs.writeFileSync(dir + 'VERSION', '0.2.0-dev\n');
