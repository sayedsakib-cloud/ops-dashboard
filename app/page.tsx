import { redirect } from "next/navigation";

// Root URL "/" — immediately send to /dashboard.
// If not logged in, app/dashboard/layout.tsx will catch it and
// redirect to Google sign-in automatically.
export default function RootPage() {
  redirect("/dashboard");
}
