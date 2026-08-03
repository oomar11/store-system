"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Shield, Trash2, UserCog } from "lucide-react";
import type { Profile, UserRole } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SettingsCard } from "@/components/settings/SettingsCard";
import {
  effectivePermissions,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_TEMPLATES,
  templatePermissions,
  type AppPermission,
} from "@/lib/permissions";

const ROLE_LABELS: Record<UserRole, string> = {
  owner: "مالك",
  manager: "مدير",
  employee: "موظف",
};

function usernameFromEmail(email: string) {
  return email.replace(/@store\.local$/i, "");
}

function mapCreateUserError(message: string): string {
  const m = message.toLowerCase();
  if (
    /service_role|service role|supabase_service|مفتاح خدمة|غير مضبوط على السيرفر/.test(
      m
    )
  ) {
    return message;
  }
  if (
    /already|exists|registered|duplicate|unique|23505|users_email/.test(m)
  ) {
    if (/email|بريد/.test(m)) return "البريد الإلكتروني مستخدم بالفعل";
    return "اسم المستخدم مستخدم بالفعل";
  }
  if (/invalid.*email|email.*invalid/.test(m)) {
    return "البريد الإلكتروني غير صالح";
  }
  if (/password.*short|at least 6|6 characters/.test(m)) {
    return "كلمة المرور يجب ألا تقل عن 6 أحرف";
  }
  return message;
}

function PermissionsChecklist({
  role,
  value,
  onChange,
}: {
  role: UserRole;
  value: AppPermission[];
  onChange: (next: AppPermission[]) => void;
}) {
  const selected = useMemo(() => new Set(value), [value]);

  function toggle(perm: AppPermission) {
    const next = new Set(selected);
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    onChange(Array.from(next) as AppPermission[]);
  }

  function applyTemplate(r: UserRole) {
    onChange(templatePermissions(r));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-[11px] font-semibold text-[#687386]">
          قالب جاهز:
        </span>
        {(Object.keys(ROLE_TEMPLATES) as UserRole[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => applyTemplate(r)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
              r === role
                ? "border-[#1473e6] bg-[#eef6ff] text-[#1473e6]"
                : "border-[#e5eaf1] text-[#526176] hover:bg-[#f7f9fc]"
            }`}
          >
            {ROLE_TEMPLATES[r].label}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-5 text-[#98a2b3]">
        {ROLE_TEMPLATES[role].description} — عدّل الصلاحيات يدويًا كما تريد.
      </p>
      <div className="max-h-[320px] space-y-4 overflow-y-auto rounded-xl border border-[#eef1f6] bg-[#fafbfc] p-3">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.id}>
            <p className="mb-2 text-[11px] font-bold text-[#344054]">{group.label}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {group.permissions.map((perm) => (
                <label
                  key={perm}
                  className="flex cursor-pointer items-start gap-2 rounded-lg bg-white px-2.5 py-2 text-xs text-[#172033] hover:bg-[#f7f9fc]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(perm)}
                    onChange={() => toggle(perm)}
                    className="mt-0.5"
                  />
                  <span>{PERMISSION_LABELS[perm]}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UsersAdminPanel() {
  const { profile: me } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    username: "",
    full_name: "",
    password: "",
    role: "employee" as UserRole,
    permissions: templatePermissions("employee") as AppPermission[],
  });

  const [permsUser, setPermsUser] = useState<Profile | null>(null);
  const [editPerms, setEditPerms] = useState<AppPermission[]>([]);
  const [editRole, setEditRole] = useState<UserRole>("employee");

  const [passwordUser, setPasswordUser] = useState<Profile | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const flash = useCallback(
    (type: "ok" | "err", text: string) => {
      if (type === "ok") toastSuccess(text);
      else toastError(text);
    },
    [toastSuccess, toastError]
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تعذر التحميل");
      setUsers(data.users || []);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "تعذر تحميل المستخدمين");
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل الإنشاء");
      flash("ok", `تم إنشاء المستخدم ${form.username}`);
      setCreateOpen(false);
      setForm({
        username: "",
        full_name: "",
        password: "",
        role: "employee",
        permissions: templatePermissions("employee"),
      });
      await loadUsers();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "فشل الإنشاء";
      flash("err", mapCreateUserError(raw));
    } finally {
      setBusy(null);
    }
  }

  async function patchUser(
    id: string,
    body: Record<string, unknown>,
    busyKey: string
  ) {
    setBusy(busyKey);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل التحديث");
      flash("ok", "تم التحديث");
      await loadUsers();
      return true;
    } catch (err) {
      flash("err", err instanceof Error ? err.message : "فشل التحديث");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteUser(user: Profile) {
    const username = usernameFromEmail(user.email);
    if (
      !(await confirm({
        message: `حذف المستخدم «${user.full_name}» (${username}) نهائيًا؟\nلن يستطيع تسجيل الدخول بعد الحذف.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }

    setBusy(`delete-${user.id}`);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل الحذف");
      flash("ok", "تم حذف المستخدم");
      await loadUsers();
    } catch (err) {
      flash("err", err instanceof Error ? err.message : "فشل الحذف");
    } finally {
      setBusy(null);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordUser) return;
    const ok = await patchUser(
      passwordUser.id,
      { password: newPassword },
      `pass-${passwordUser.id}`
    );
    if (ok) {
      setPasswordUser(null);
      setNewPassword("");
    }
  }

  async function handleSavePermissions(e: React.FormEvent) {
    e.preventDefault();
    if (!permsUser) return;
    const ok = await patchUser(
      permsUser.id,
      { role: editRole, permissions: editPerms },
      `perms-${permsUser.id}`
    );
    if (ok) setPermsUser(null);
  }

  function openPermissions(user: Profile) {
    setPermsUser(user);
    setEditRole(user.role);
    setEditPerms(effectivePermissions(user));
  }

  return (
    <SettingsCard
      title="إدارة المستخدمين والصلاحيات"
      description="قوالب جاهزة (مالك / مدير / موظف) مع تخصيص كل صلاحية"
      icon={UserCog}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface-subtle)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            تحديث
          </button>
          <button
            type="button"
            onClick={() => {
              setForm({
                username: "",
                full_name: "",
                password: "",
                role: "employee",
                permissions: templatePermissions("employee"),
              });
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
          >
            <Plus className="h-3.5 w-3.5" />
            مستخدم جديد
          </button>
        </div>
      }
    >
      <div className="space-y-4">
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" />
        </div>
      ) : users.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">لا يوجد مستخدمون</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-right text-sm">
            <thead>
              <tr className="border-b border-[color-mix(in_srgb,var(--border)_55%,transparent)] text-[11px] text-[var(--muted-soft)]">
                <th className="px-2 py-2 font-semibold">الاسم</th>
                <th className="px-2 py-2 font-semibold">اسم الدخول</th>
                <th className="px-2 py-2 font-semibold">القالب</th>
                <th className="px-2 py-2 font-semibold">الحالة</th>
                <th className="px-2 py-2 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isMe = user.id === me?.id;
                const custom = Array.isArray(user.permissions);
                return (
                  <tr key={user.id} className="border-b border-[#f3f5f8]">
                    <td className="px-2 py-3 font-medium text-[#172033]">
                      {user.full_name}
                      {isMe && (
                        <span className="mr-2 text-[10px] text-[#1473e6]">(أنت)</span>
                      )}
                    </td>
                    <td className="px-2 py-3 font-mono text-xs text-[#526176]" dir="ltr">
                      {usernameFromEmail(user.email)}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-[#172033]">
                          {ROLE_LABELS[user.role]}
                        </span>
                        <span className="text-[10px] text-[#98a2b3]">
                          {custom
                            ? `${effectivePermissions(user).length} صلاحية مخصصة`
                            : "قالب افتراضي"}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          user.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {user.is_active ? "نشط" : "معطّل"}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => openPermissions(user)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#cfe0f8] bg-[#eef6ff] px-2 py-1 text-[11px] font-semibold text-[#1473e6]"
                        >
                          <Shield className="h-3 w-3" />
                          صلاحيات
                        </button>
                        <button
                          type="button"
                          disabled={isMe || !!busy}
                          onClick={() =>
                            void patchUser(
                              user.id,
                              { is_active: !user.is_active },
                              `active-${user.id}`
                            )
                          }
                          className="rounded-lg border border-[#e5eaf1] px-2 py-1 text-[11px] font-semibold text-[#526176] hover:bg-[#f7f9fc] disabled:opacity-40"
                        >
                          {user.is_active ? "تعطيل" : "تفعيل"}
                        </button>
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => {
                            setPasswordUser(user);
                            setNewPassword("");
                          }}
                          className="rounded-lg border border-[#e5eaf1] px-2 py-1 text-[11px] font-semibold text-[#526176] hover:bg-[#f7f9fc]"
                        >
                          كلمة مرور
                        </button>
                        <button
                          type="button"
                          disabled={isMe || !!busy}
                          onClick={() => void handleDeleteUser(user)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
                        >
                          <Trash2 className="h-3 w-3" />
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="مستخدم جديد"
        wide
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#526176]">
                اسم المستخدم (للدخول)
              </label>
              <input
                required
                dir="ltr"
                value={form.username}
                onChange={(e) =>
                  setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))
                }
                placeholder="ahmed"
                className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#526176]">
                الاسم الظاهر
              </label>
              <input
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="أحمد محمد"
                className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#526176]">
                كلمة المرور
              </label>
              <input
                required
                type="password"
                dir="ltr"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                minLength={6}
                className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#526176]">
                قالب الدور
              </label>
              <select
                value={form.role}
                onChange={(e) => {
                  const role = e.target.value as UserRole;
                  setForm((f) => ({
                    ...f,
                    role,
                    permissions: templatePermissions(role),
                  }));
                }}
                className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
              >
                <option value="employee">موظف</option>
                <option value="manager">مدير</option>
                <option value="owner">مالك</option>
              </select>
            </div>
          </div>

          <PermissionsChecklist
            role={form.role}
            value={form.permissions}
            onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
          />

          <button
            type="submit"
            disabled={busy === "create"}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1473e6] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === "create" && <Loader2 className="h-4 w-4 animate-spin" />}
            إنشاء الحساب
          </button>
        </form>
      </Modal>

      <Modal
        open={!!permsUser}
        onClose={() => setPermsUser(null)}
        title={
          permsUser
            ? `صلاحيات — ${permsUser.full_name}`
            : "تعديل الصلاحيات"
        }
        wide
      >
        <form onSubmit={handleSavePermissions} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[#526176]">
              قالب الدور
            </label>
            <select
              value={editRole}
              onChange={(e) => {
                const role = e.target.value as UserRole;
                setEditRole(role);
                setEditPerms(templatePermissions(role));
              }}
              className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
            >
              <option value="employee">موظف</option>
              <option value="manager">مدير</option>
              <option value="owner">مالك</option>
            </select>
          </div>
          <PermissionsChecklist
            role={editRole}
            value={editPerms}
            onChange={setEditPerms}
          />
          <button
            type="submit"
            disabled={!!busy}
            className="w-full rounded-lg bg-[#1473e6] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            حفظ الصلاحيات
          </button>
        </form>
      </Modal>

      <Modal
        open={!!passwordUser}
        onClose={() => setPasswordUser(null)}
        title={
          passwordUser
            ? `تغيير كلمة مرور — ${usernameFromEmail(passwordUser.email)}`
            : "تغيير كلمة المرور"
        }
      >
        <form onSubmit={handlePasswordSubmit} className="space-y-3">
          <input
            required
            type="password"
            dir="ltr"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={6}
            placeholder="كلمة المرور الجديدة"
            className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!!busy}
            className="w-full rounded-lg bg-[#1473e6] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            حفظ كلمة المرور
          </button>
        </form>
      </Modal>
      </div>
    </SettingsCard>
  );
}
