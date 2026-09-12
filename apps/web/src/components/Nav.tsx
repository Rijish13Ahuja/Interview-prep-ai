"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function Nav({ email }: { email?: string }) {
  const router = useRouter();

  async function handleLogout() {
    await api.post("/api/auth/logout").catch(() => {});
    router.replace("/login");
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="font-semibold text-slate-900">
          Interview Prep Kit
        </Link>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          {email && <span className="hidden sm:inline">{email}</span>}
          <button type="button" onClick={handleLogout} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            Log out
          </button>
        </div>
      </nav>
    </header>
  );
}
