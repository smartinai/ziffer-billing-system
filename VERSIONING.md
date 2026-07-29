# Versioning and releases

Ziffer uses Semantic Versioning: `MAJOR.MINOR.PATCH`.

- **Patch** (`npm run release:patch`): bug fixes and internal improvements with no new user-facing capability.
- **Minor** (`npm run release:minor`): backward-compatible features or meaningful workflow improvements.
- **Major** (`npm run release:major`): breaking API, data, deployment, or user-workflow changes that require coordinated migration.

## Normal workflow

1. Add user-facing changes under `## [Unreleased]` in `CHANGELOG.md` as the work is completed.
2. Choose the release impact using the rules above.
3. Run the matching release command. It updates `package.json`, `package-lock.json`, and moves the Unreleased notes into a dated release section.
4. Review the diff and run `npm run check`.
5. Commit the release as `release: vX.Y.Z`, then create the matching Git tag `vX.Y.Z`.
6. Deploy the exact tagged commit through the approved production workflow.

The release commands prepare files only. They do not commit, tag, push, or deploy.

`package.json` is the canonical version source. The frontend receives it at build time, while the backend reads the same package file at startup. Production builds also carry the deployed Git commit SHA.
