# نظام إدارة المخزون والحسابات
## Store Inventory & Accounting System

نظام متكامل لإدارة المخزون والمبيعات والحسابات - يعمل كـ PWA على جميع الأجهزة.

مستقل عن **workshop-system** (المصنع). لا تخلط جداول/مسارات التصنيع هنا.

## المميزات

- نقطة بيع (POS) مع طباعة فواتير
- إدارة المخزون والأصناف
- العملاء والموردين والمدفوعات
- خزينة، ورديات، مستندات، مرتجعات، جرد
- تقارير وطباعة
- صلاحيات (مالك، مدير، موظف)
- PWA + مزامنة offline
- نسخ احتياطي / تيليجرام / إعادة ضبط المصنع (مسح بيانات المحل)

## التقنيات

- **Frontend:** Next.js 16 + React 19 + TypeScript
- **Backend:** Supabase (Auth + PostgreSQL)
- **Styling:** Tailwind CSS 4
- **Icons:** Lucide React
- **PWA:** Serwist (+ legacy `public/sw.js` fallback)

## التشغيل

```bash
npm install
npm run dev
npm run build
```

## إعداد Supabase

1. أنشئ مشروع Supabase وانسخ المفاتيح إلى `.env.local` (انظر `.env.local.example`).
2. في SQL Editor:
   - شغّل `supabase/schema.sql` (baseline)
   - ثم شغّل **كل** ملفات `supabase/migrations/` بالترتيب الأبجدي
3. التفاصيل: [`supabase/README.md`](supabase/README.md)

### النسخ الاحتياطي وتيليجرام

- من **الإعدادات** (المالك): ضبط بوت تيليجرام، تحميل JSON، استعادة، إعادة ضبط المصنع
- Cron يومي عبر Vercel الساعة `01:00 UTC`

### مساعد جارفس (تيليجرام + Gemini)

أضف اختياريًا على Vercel:

```
GEMINI_API_KEY=...              # أو احفظه من الإعدادات / تيليجرام
TELEGRAM_WEBHOOK_SECRET=...     # اختياري لحماية الـ webhook
```

أو من تيليجرام بعد تفعيل الـ webhook:
`/gemini YOUR_API_KEY`

ثم من الإعدادات → **مساعد جارفس** → تفعيل المساعد (أو احفظ المفتاح من نفس الشاشة).
المساعد يقرأ ويحلّل فقط (مبيعات، مخزون، أرصدة، خزنة، مصروفات، ورديات) عبر نفس بوت التيليجرام و Chat ID المضبوط.

## إنشاء أول مستخدم (المالك)

1. Authentication → Users → Add User
2. Table Editor → `profiles` → عيّن `role = owner`

## هيكل المجلدات

```
src/
├── app/
│   ├── (auth)/login/
│   ├── (dashboard)/          # dashboard, pos, products, customers, suppliers,
│   │                         # sales, purchases, returns, documents, treasury,
│   │                         # shifts, expenses, inventory, reports, settings,
│   │                         # audit, offline-queue
│   ├── (mobile)/m/           # واجهة الموبايل
│   ├── api/                  # backup, shifts, users, health
│   └── serwist/              # PWA service worker
├── components/               # UI حسب المجال (pos, parties, print, …)
├── hooks/
├── lib/                      # supabase clients, offline, backup, reports, …
└── types/
```

## Deploy

```bash
npx vercel --prod --yes
```

**Production (canonical):** https://store-system-iota.vercel.app  
Mobile: https://store-system-iota.vercel.app/m  

Project: `store-system` / `prj_L9xKjfnbcl4hxIaTuz7i0mNcfrZs`  
Do not treat `store-system-rho.vercel.app` or Vercel Preview URLs as the live store.
