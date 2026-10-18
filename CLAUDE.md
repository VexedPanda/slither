# Slitherlink

## Git and GitHub

- **Commit identity:** always commit as `VexedPanda <734992+VexedPanda@users.noreply.github.com>`, not the machine's
  default git identity (a work account). For example:
  `git -c user.name=VexedPanda -c user.email=734992+VexedPanda@users.noreply.github.com commit ...`
- **Repository:** work goes to the fork `VexedPanda/slither` (remote `origin`, base branch `main`). Never push or open
  PRs against upstream `jonathanolson/slither`.
- **GitHub account:** the active `gh` account may be a work account without access to the fork. Don't switch it; use
  the VexedPanda token per command:
  ```bash
  export GH_TOKEN=$(gh auth token -u VexedPanda)
  git -c credential.helper= -c "credential.helper=!f(){ echo username=VexedPanda; echo password=$GH_TOKEN; }; f" push -u origin <branch>
  gh pr create --repo VexedPanda/slither --base main --head <branch> ...
  ```
  Always pass `--repo VexedPanda/slither` to `gh pr` commands; without it `gh` targets the upstream parent.
- **Branches and PRs:** use `claude/*` branches. Merge PRs with a merge commit once CI (build, lint, typecheck, qunit,
  consistency) passes.

## Checks

- `npm run typecheck`, `npm run lint`, and `npx prettier --check <files>` before committing.
