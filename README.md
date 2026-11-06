# TrainTracks 🚂

A free, self-hosted workout logger and planner. The app is a single static web page served by GitHub Pages from **your own repository**, and every workout you log is a file in that same repository — no accounts, no servers, no one else's database.

- Log sets on the machines at your gyms (with photos), from your phone's home screen.
- Set weekly goals and watch them on a track.
- Let Claude be your coach: it reads your history and writes **Today's Route** into your repo.
- Optional Garmin pipelines bring in heart-rate minutes, steps, sleep and HRV.

**Setting up:** read [docs/SETUP.md](docs/SETUP.md) (about 20 minutes). To add the coach, see [docs/COACH.md](docs/COACH.md).

**Developing:** read [CLAUDE.md](CLAUDE.md) and [docs/DECISIONS.md](docs/DECISIONS.md). `npm test` runs the test suites.

TrainTracks is the successor to LogTrim; `scripts/migrate-from-logtrim.mjs` moves a LogTrim repo's data across.
