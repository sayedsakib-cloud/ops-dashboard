import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/auth";
import { redirect }         from "next/navigation";

// This runs SERVER-SIDE before any dashboard page or component loads.
// If there is no session, the user is sent to Google sign-in immediately.
// This is the standard Next.js App Router auth protection pattern.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    // Redirect to NextAuth sign-in, then return here after login
    redirect("/api/auth/signin?callbackUrl=/dashboard");
  }

  return <>{children}</>;
}
