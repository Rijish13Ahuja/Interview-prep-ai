"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    api
      .get("/api/auth/me")
      .then(() => router.replace("/dashboard"))
      .catch(() => router.replace("/login"));
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      <p>Loading…</p>
    </div>
  );
}
