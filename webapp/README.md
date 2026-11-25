# JD to CV web interface

See the repository README and `docs/PILOT-DEPLOY.md` for architecture, privacy, budget and deployment instructions.

- `npm run build`: embed the shared static UI and prompts into a standalone Worker.
- `npm test`: run the Worker contract, budget and privacy tests (Node 24).
- `npm run validate`: check the built artifact exports `default.fetch`.
- `python -m desktop.server` from the repository root: local browser preview.

No external JavaScript dependencies are needed. The hosting manifest's DB binding stores operational pilot data only. Personal records are device-local.
