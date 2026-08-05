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

**Production URL (canonical):** https://store-system-rho.vercel.app  
Mobile: https://store-system-rho.vercel.app/m  
Always verify changes on this host (not `store-system-iota` or Preview URLs).

### مساعد جارفس — متغيرات Vercel (مشروع rho)
لازم تكون موجودة على Production:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`  ← ضروري لقراءة إعدادات تيليجرام وبيانات المحل
- (اختياري) `GEMINI_API_KEY` — أو يُحفظ من تيليجرام `/gemini` / الإعدادات
- (اختياري) `TELEGRAM_WEBHOOK_SECRET`
- (اختياري) `WORKSHOP_BRIDGE_SECRET` ← جسر خزنة الورشة (aa): نفس المفتاح في إعدادات الورشة

بعد إضافة المتغيرات: Redeploy، ثم الإعدادات → مساعد جارفس → تفعيل المساعد.  
فحص سريع: `GET https://store-system-rho.vercel.app/api/telegram/webhook` لازم يرجّع `telegram_configured: true`.

### جسر خزنة الورشة (aa → store)
- المتجر وخزنته = مصدر الحقيقة للنقد؛ الورشة ترسل دفعات (إيداع) ومصروفات (سحب).
- APIs: `GET /api/workshop/safes` · `POST /api/workshop/safe-movement` · `GET /api/workshop/safe-movement` (حالة `configured`)
- المصادقة: `Authorization: Bearer <WORKSHOP_BRIDGE_SECRET>` أو هيدر `x-workshop-bridge-secret`
- Migration: `20260805_workshop_safe_bridge.sql` (`apply_workshop_safe_movement`)

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: Composer <noreply@cursor.com>
```
