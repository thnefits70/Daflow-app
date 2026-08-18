@AGENTS.md

# Git workflow — standing authorization

This app deploys to Vercel automatically whenever `main` is pushed (repo:
thnefits70/Daflow-app). Confirmed with the user 2026-08-18: after
implementing and verifying a change, commit it and push to `main`
immediately, without asking for confirmation each time — this is
pre-authorized as a standing instruction specifically to avoid the failure
mode where finished work sits committed-but-unpushed (or uncommitted) and
silently never deploys, forcing the user to notice and ask.

Still apply judgment before pushing:
- Review `git status`/`git diff` first — no secrets, no unrelated/stray files.
- Only push work that's actually finished and verified (typecheck/build
  passes, feature tested if it's UI-observable) — not half-done experiments.
- If a change is large/risky/architecturally significant, it's fine to
  flag that before pushing, but routine feature work should just go.
