# TrainTracks: the optional Cloudflare Worker

The Worker is a small relay that holds your GitHub token, so tools such as
Claude Code, CoWork or a skill only need the Worker's own secret. **The coach
in a claude.ai Project doesn't need it** (it talks to `api.github.com`
directly; `*.workers.dev` addresses aren't reachable from a personal-plan
claude.ai sandbox). Skip this page unless you want it.

## Deploy it (about 10 minutes)

1. Make a **second** fine-grained GitHub token just for the Worker: only your
   TrainTracks repository, **Contents: Read and write** and **Actions: Read and write**.
2. In Cloudflare (free plan): **Workers & Pages** → **Create** → **Worker** →
   name it (e.g. `traintracks`) → **Deploy** → **Edit code**.
3. Replace all the code with the contents of `worker/worker.js` → **Deploy**.
4. **Settings → Variables and Secrets**, add:
   - `SECRET_TOKEN` (Secret): a long random string you make up.
   - `GITHUB_PAT` (Secret): the token from step 1.
   - `GITHUB_USER`: your GitHub username. `GITHUB_REPO`: `traintracks`.
   - `GITHUB_BRANCH` (optional): defaults to `main`.
5. **Deploy** again. Changes to variables and secrets do nothing until you deploy.

Check it:
```
curl -H "Authorization: Bearer YOUR_SECRET_TOKEN" https://traintracks.YOUR-NAME.workers.dev/
```
It answers with its name, version and endpoints. `Hello World!` means the
starter code is still deployed (step 3).

## Endpoints

Send the secret as `Authorization: Bearer <SECRET_TOKEN>` (`?token=` also works).

| Request | Does |
|---|---|
| `GET /` | health check |
| `GET /log` | `workout-log.csv` |
| `GET /log-json` | `{ log_json, head, entries, csv_rows, in_sync }`, read live |
| `POST /log-write` | body `{ log_json, base_head, message?, allow_shrink? }`. Writes the JSON **and** the CSV (built from the JSON) as one commit on top of `base_head` |
| `GET /profile`, `/goals`, `/garmin` | those files |
| `POST /plan` | body = the plan JSON (see [COACH.md](COACH.md)) |
| `POST /trigger-garmin` | body `{ fetch_limit?, max_days? }`: runs the Garmin workflow |

**Editing the log safely:** `GET /log-json`, change that copy, then
`POST /log-write` with the `head` you got as `base_head`. If anything else wrote
to the repo in between (the app, the Garmin workflow), the Worker answers
**409** and writes nothing: read again and redo the change. A write that would
remove entries is refused unless you send `"allow_shrink": true`.

## Errors

- **401** with a JSON body is the Worker's own answer: the secret didn't match.
  (Cloudflare's bot protection answers with an HTML page instead.)
- **502** carrying GitHub's message: usually the Worker's GitHub token is wrong,
  expired, or missing a permission.
