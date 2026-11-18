# Repo rules

## Git and GitHub: read-only

Never write to GitHub or any remote. The user pushes, tags and releases.

- Never run `git push` (any form, including `--tags` and `--force`), `git remote`
  changes, or anything else that sends data to a remote.
- Never run `just publish` without `--dry-run`, and never run `gh release`
  create, edit, upload or delete, `gh pr` or `gh issue` create, edit, comment or
  close, `gh repo` changes, or `gh api` with a method other than GET.
- Reading is fine: `git fetch`, `git log`, `git diff`, `git status`, `git show`,
  `gh release list` and `view`, `gh pr view`, and `gh api` GET requests.
- Local history is the user's too: do not commit, tag, amend, rebase, reset or
  stash unless asked. When asked to commit, commit locally only and say it has
  not been pushed.
- When a task ends in a push or a release (for example `just publish`), stop and
  tell the user the exact command to run.
