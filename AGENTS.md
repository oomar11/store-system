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
- (اختياري) `WORKSHOP_BRIDGE_SECRET` ← بديل لجدول `workshop_bridge_config`

بعد إضافة المتغيرات: Redeploy، ثم الإعدادات → مساعد جارفس → تفعيل المساعد.  
فحص سريع: `GET https://store-system-rho.vercel.app/api/telegram/webhook` لازم يرجّع `telegram_configured: true`.

### جسر الورش (aa / plisse → store)
- المتجر = مصدر الحقيقة للنقد + العملاء/الموردين + كشف الحساب الموحّد.
- خزنة: `GET /api/workshop/safes` · `POST|GET /api/workshop/safe-movement`
- فواتير للورشة: `GET|POST /api/workshop/invoices` + جدول `workshop_invoice_inbox`
- صرف خامات: `GET /api/workshop/products` · `POST /api/workshop/issue` (`p_for_workshop`)
- أطراف: `GET|POST /api/workshop/parties/customers` · `GET|POST /api/workshop/parties/suppliers`
- أستاذ عبر البرامج: `POST /api/workshop/parties/ledger` → جدول `cross_app_ledger_entries`
- كشف موحّد: `GET /api/workshop/parties/statement?customer_id=`
- توريد خارجي: `POST /api/workshop/purchases` → فاتورة شراء على مورد (بدون مخزون فعلي)
- جداول ربط: `workshop_party_map` · `cross_app_ledger_entries`
- المصادقة: `Authorization: Bearer <secret>` أو `x-workshop-bridge-secret`
- المفتاح: `workshop_bridge_config` أو `WORKSHOP_BRIDGE_SECRET`
- Migrations: `20260805_workshop_*.sql` + `20260810_cross_app_parties_ledger.sql`

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: Composer <noreply@cursor.com>
```

## Cursor Cloud specific instructions

Scope: Next.js 16 + React 19 PWA (`npm run dev`, port 3000) backed by Supabase (Postgres + Auth). There is no separate backend service — the app talks to Supabase directly. The update script only runs `npm install`; everything below (Supabase stack, DB schema, env vars) is **not** persisted across fresh VMs, so recreate it when you need a working backend.

### Local Supabase backend (needed to log in / read/write data)
Fresh VMs have no Docker or Supabase CLI and no `.env.local`. To bring up a full local backend:
- Install/run Docker (no systemd here): Docker 29 needs `fuse-overlayfs` + `/etc/docker/daemon.json` with `"storage-driver":"fuse-overlayfs"` and `"features":{"containerd-snapshotter":false}`, iptables set to legacy, then `sudo dockerd &` and `sudo chmod 666 /var/run/docker.sock`.
- Install the Supabase CLI, `supabase init`, then `supabase start` (pulls images; exposes API `http://127.0.0.1:54321`, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). Local stack keys are the standard Supabase demo anon/service_role JWTs.
- Put `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (gitignored).

### Applying the DB schema — non-obvious gotchas
`supabase db reset` / `supabase start` auto-apply `supabase/migrations/` in filename order, which does **not** work from empty. Apply manually against the local DB instead:
- `supabase/schema.sql` has a forward reference: `invoices` references `safes(id)` but `safes` is defined later. Create the `safes` table (it only needs the uuid extension) **before** `invoices`, or load a reordered copy.
- Migrations are **not** in dependency order by filename. Apply `20260717_rls_roles_and_atomic_ops.sql` first (defines `is_active_user()` and base RLS), then apply the rest in multiple passes — run each file in its own transaction (`psql --single-transaction -v ON_ERROR_STOP=1 -f <file>`) and retry the failures until they all succeed (this resolves cross-file deps like `audit_logs` needing `has_app_permission` from `custom_permissions`, which must run before `rls_roles`).

### First user (owner)
Create an auth user (Admin API or Studio), then `UPDATE profiles SET role='owner' WHERE email=...`. The `on_auth_user_created` trigger inserts the profile but defaults new users to `employee`, so promote it explicitly.

### Lint
`npm run lint` (whole repo) reports ~80 **pre-existing** errors — that is the repo baseline, not your changes. For your edits use file-scoped `npx eslint <file>` and `npx tsc --noEmit`.

### PWA / service worker
The service worker is served and active even in dev at `/serwist/sw.js` and controls the page. Updates are surfaced via the in-app "تحديث جديد" banner and only reload when the user applies them — the app must never force `window.location.reload()` automatically on `controllerchange` (that used to bounce users off the page they were navigating to).
