<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# store-system

Arabic inventory/accounting PWA. Manufacturing belongs in `../workshop-system` only — do **not** reintroduce `mfg_*` tables, routes, or offline entity types.

## Package Manager
Use **npm**: `npm install`, `npm run dev`, `npm run build`

## File-Scoped Commands
| Task | Command |
|------|---------|
| Typecheck | `npx tsc --noEmit` |
| Lint | `npx eslint path/to/file.ts` |

## Layout
- Routes: `src/app/(dashboard)/`, mobile `src/app/(mobile)/m/`, APIs `src/app/api/`
- Domain UI: `src/components/{pos,parties,print,documents,returns,…}`
- Logic: `src/lib/` (`offline/`, `backup/`, `reports/`, `excel/`)
- Supabase clients: `supabase.ts` (browser), `supabase-server.ts`, `supabase-service.ts`

## SQL
- Baseline: `supabase/schema.sql` then **all** `supabase/migrations/` in name order
- Policy: see `supabase/README.md`
- Never edit applied migrations; add a new dated file

## Conventions
- Client search → `smartSearchMatch` from `@/lib/utils`
- Shared party UI lives under `components/parties/` (not empty customers/suppliers folders)
- Fat pages (`pos/page.tsx`, etc.) are intentional for now — prefer extract helpers over drive-by rewrites
- Identical UI clones with workshop are intentional copies, not a shared package

## Deploy
```bash
npx vercel --prod --yes
```

**Production URL (canonical):** https://store-system-iota.vercel.app  
Mobile: https://store-system-iota.vercel.app/m  
Always verify changes on this host (not `store-system-rho` or Preview URLs).

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: Composer <noreply@cursor.com>
```
