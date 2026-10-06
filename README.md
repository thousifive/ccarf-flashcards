# CCAR-F Flashcards

Spaced-repetition flashcards for the **Claude Certified Architect – Foundations (CCAR-F)** exam, built from the 30 lessons and 5 quick-reference sheets at [claudecertificationguide.com/learn](https://claudecertificationguide.com/learn).

**391 cards** across all 5 domains:

| Type | Count | Front → back |
|---|---|---|
| Key takeaway | 223 | Question → the takeaway |
| Exam trap | 117 | The tempting wrong answer → why it's wrong and what's right |
| Decision rule | 51 | Exam signal ("guaranteed", "independent subtasks"…) → what to pick |

Every card links back to its source lesson.

## Features

- **Spaced repetition** — Again / Hard / Good / Easy (keys `1`–`4`, `Space` to flip, `S` to star). Missed cards come back later in the same session.
- **Modes** — Due, All, Struggling (missed or low-box cards), Starred.
- **Deck filters** — by domain, card type, and a *weak-spot lessons* preset.
- **Progress** — per-domain new / learning / solid bars and your most-missed cards.
- **Offline + installable** — add to your phone's home screen; works without a connection.
- **Local storage** — progress is always saved in the browser.
- **Cross-device sync** — via a private GitHub Gist (below).

## Deploy to GitHub Pages

1. Create a new repo (e.g. `ccarf-flashcards`) and push these files to `main`.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Open `https://<your-username>.github.io/ccarf-flashcards/`.

```bash
git remote add origin https://github.com/<your-username>/ccarf-flashcards.git
git push -u origin main
```

## Sync between desktop and phone

GitHub Pages is static, so sync goes through a **private Gist** on your own account — no server, no third party.

1. Create a **classic** token at <https://github.com/settings/tokens/new> with **only the `gist` scope** (fine-grained tokens can't access gists). Give it an expiry you're comfortable with.
2. On desktop: **Sync → paste token → Save & sync now**. A private gist named `ccarf-flashcards-progress.json` is found or created automatically.
3. Still in Sync: **Copy setup link**, send it to yourself, and open it on your phone once. The phone saves the token + gist ID and strips them from the address bar.

After that, each device syncs on load, a few seconds after you rate cards, when you return to the tab, and when you come back online. Merging is per card — the most recent review of each card wins — so reviewing on both devices offline and syncing later is safe. *Reset progress* propagates to every device.

The token is stored only in that browser's localStorage and is sent only to `api.github.com`. Anyone with the setup link can edit your gists, so keep it to yourself; revoke the token on GitHub any time.

## Rebuilding the deck

Raw extracts live in `data/raw/` (one file per domain + `rules.json`).

```bash
python3 scripts/build_cards.py   # writes cards.json
```

Card IDs are positional (`1.3-k2`, `2.2-x4`, `r3-7`), so append new items at the end of a lesson's lists to keep existing progress attached.

Content summarised from claudecertificationguide.com for personal study; it is not affiliated with Anthropic.
