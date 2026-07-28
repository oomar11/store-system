export function DashboardSkeleton() {
  return (
    <div className="dashboard-page space-y-5" aria-busy="true" aria-label="جارٍ تحميل لوحة التحكم">
      <div className="dashboard-skeleton h-[300px] rounded-[28px] sm:h-[320px]" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="dashboard-skeleton h-[168px] rounded-[20px]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.65fr)]">
        <div className="dashboard-skeleton h-[370px] rounded-[22px]" />
        <div className="dashboard-skeleton h-[370px] rounded-[22px]" />
      </div>
      <span className="sr-only">جارٍ تحميل بيانات المتجر</span>
    </div>
  );
}

export function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="dashboard-card mx-auto flex min-h-[360px] max-w-xl flex-col items-center justify-center p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-xl font-black text-red-500">
        !
      </span>
      <h1 className="mt-5 text-lg font-black text-[#142033]">تعذّر تحميل لوحة التحكم</h1>
      <p className="mt-2 max-w-sm text-xs leading-6 text-[#66758a]">
        لم نتمكن من الوصول إلى بيانات المتجر الآن. تحقق من الاتصال ثم حاول مرة أخرى.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded-xl bg-[#1473e6] px-5 py-2.5 text-xs font-black text-white shadow-[0_8px_20px_rgba(20,115,230,0.2)] hover:-translate-y-0.5 hover:bg-[#0b65d1]"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
