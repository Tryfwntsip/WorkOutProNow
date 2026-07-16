# Contributing

Thank you for helping improve WorkOutProNow.

## Before you start

- Open an issue before starting a large architectural or training-rule change.
- Never commit credentials, `.env` files, access tokens, or real health data.
- Keep training decisions deterministic, explainable, and covered by tests.
- Treat exercise and recovery recommendations as informational, not medical advice.

## Development

```sh
pnpm install
cp .env.example .env
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Pull requests should be focused, explain user-visible and data-model changes, include tests, and update relevant documentation. Use Conventional Commit-style titles such as `feat:`, `fix:`, `docs:`, `test:`, or `chore:`.

## Security

Do not open a public issue for a suspected vulnerability or exposed credential. Follow [SECURITY.md](SECURITY.md).
