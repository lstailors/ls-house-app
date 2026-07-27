# alts.lstailors.com

FOH alterations app. **API stays on app.lstailors.com.**

## Dev
```bash
cd ~/ls-house-app && bun install
# terminal A
cd backend && bun run --hot src/index.ts
# terminal B
cd apps/alts && bun run dev   # :8010
```

## Prod
`VITE_BACKEND_URL=https://app.lstailors.com`  
Vercel project: **ls-alts** · domain alts.lstailors.com

```bash
cd apps/alts && vercel --prod --force --yes
```

## Notes
- Shared FOH pages import from `webapp/src` via `@/` until full extract.
- Tile home: Lucia 007.
- Decisions: `DECISIONS_2026-07-26.md`
