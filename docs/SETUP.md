# TrainTracks — Setup Guide

TrainTracks is a free, self-hosted workout tracker. Your data lives in **your own GitHub repository** — no accounts beyond GitHub, no subscriptions, no one else's servers. The app is a web page hosted free on GitHub Pages and works on desktop and phone.

Optionally, Claude can be your coach: it reads your history and pushes a plan into the app (see [COACH.md](COACH.md)). A Garmin watch can feed in heart-rate minutes, steps, sleep and HRV (see [GARMIN.md](GARMIN.md)).

Setup takes about 20 minutes.

---

## 1. Create a GitHub account

Go to [github.com](https://github.com) → **Sign up**. The free plan is all you need. Verify your email.

## 2. Create your repository from the template

1. Open **github.com/traintracksapp/traintracks**.
2. Click the green **Use this template** button → **Create a new repository**.
   (Not "Fork". A fork of a public repo can never be made private; a template copy can.)
3. Repository name: `traintracks`. Owner: you.
4. **Public or private?** Your workout log, profile (birth year, injuries…) and any Garmin data will live in this repo.
   - **Private** keeps all of that to yourself, but GitHub Pages on a private repo needs a paid GitHub plan (Pro, about $4/month).
   - **Public** is free, and anyone who finds the repo can read your files.
   Choose what you are comfortable with. Most people choose public and keep the profile light.
5. Click **Create repository**.

## 3. Turn on GitHub Pages

1. In your new repo: **Settings** (the tab in the repo) → **Pages** (left sidebar).
2. Build and deployment → Source: **Deploy from a branch**.
3. Branch: **main**, folder **/ (root)** → **Save**.
4. Wait a minute, refresh, and GitHub shows your app's address: `https://YOUR-USERNAME.github.io/traintracks/`. Open it — you should see TrainTracks asking to be connected.

## 4. Create an access token

The app needs permission to save workouts into your repository. A *fine-grained token* grants access to only this one repo.

1. GitHub → your profile photo (top right) → **Settings** → bottom of the left sidebar → **Developer settings**.
2. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. Fill in:
   - Token name: `traintracks`
   - Expiration: 1 year (you can make a new one later)
   - Repository access: **Only select repositories** → `YOUR-USERNAME/traintracks`
   - Permissions → Repository permissions → **Contents: Read and write**
   - (Optional, only if you will use Garmin and want the "Run sync now" button: **Actions: Read and write**)
4. **Generate token** and **copy it now** — GitHub shows it once. It starts with `github_pat_`.

The same token is used by the Claude coach, if you set that up.

## 5. Connect the app

1. Open your app URL. Tap ⚙️ (Settings).
2. Enter your GitHub **username**, the repository name (`traintracks`) and the **token**. Leave "Remember the token on this device" on unless you are on a shared computer.
3. **Connect & load data**. You will see the "Common exercises" gym.

Each phone or computer you use needs this once. The token is stored only in that browser and only ever sent to `api.github.com`.

## 6. Put it on your phone's home screen

- **iPhone:** open the URL in Safari (not a private tab) → Share → **Add to Home Screen**.
- **Android:** Chrome → ⋮ menu → **Add to Home screen** / **Install app**.

## 7. Add your gym

Settings → **Manage equipment** → **Add gym**, then add rooms and machines (take a photo of each machine with your phone — it is stored in your repo). Or **Import from the gym catalog** if your gym is listed.

The "Common exercises" gym comes with the app (push-ups, walks, runs, classes…). You can hide what you don't use and add your own; your changes survive app updates.

## 8. Set weekly goals (optional)

Settings → **Weekly goals** → pick targets. The home screen shows how the week is going; 📊 opens the full report.

---

## Keeping the app up to date

Settings → **Update app from template** compares your repo with the template and, after showing you what changed, copies updated app files into your repo using your token. Your log, profile, goals, gyms and workflows are never touched. Reload the page about a minute afterwards.

## Trust model — please read

- **The token can only touch this one repository.** If it ever leaks, revoke it on GitHub (Developer settings → Fine-grained tokens) and make a new one.
- **The template owner can change the app code you run** when you click Update — the same way any app update works. Updates show their changelog first, and the whole app is open source.
- **The coach holds your token** (it is in your Claude Project instructions). Keep that Project private.
- **Public repo = public data.** Nothing in the app prevents the world from reading a public repo.

## Custom domain (optional)

If you own a domain, Settings → Pages → Custom domain in your repo, plus a DNS record at your registrar (GitHub's docs explain the `A`/`CNAME` records). Note: the app's saved settings are per-origin, so after switching to a custom domain you enter the token once more on each device.

## Troubleshooting

- **"Repository not found"** when connecting: check the spelling of username and repo, and that the token's repository access includes this repo.
- **"GitHub 403"** on save: the token lacks **Contents: Read and write**, or has expired.
- **Pages shows a 404**: the branch/folder setting in step 3 is wrong, or the first deploy has not finished yet (it can take a couple of minutes).
- **Saved a session on one device, don't see it on another**: pull down for a fresh load (Settings → Reload data). The app reloads by itself when it has been in the background for more than ten minutes.
