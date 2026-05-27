import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import DashboardOverview from "@/components/dashboard/DashboardOverview";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl shadow-slate-950/30">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Operations Dashboard</p>
              <h1 className="mt-3 text-4xl font-semibold text-white">Welcome, {session.user?.name ?? "Team Member"}</h1>
            </div>
            <div className="rounded-3xl bg-slate-950/80 px-5 py-4 text-slate-300 ring-1 ring-slate-800">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Signed in</p>
              <p className="mt-1 font-medium text-white">{session.user?.email}</p>
            </div>
          </div>
        </header>

        <DashboardOverview />
      </div>
    </div>
  );
}
