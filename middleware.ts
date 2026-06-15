export { default } from "next-auth/middleware";

export const config = {
  // Protect every route under /dashboard
  // Unauthenticated users are automatically redirected to the sign-in page
  matcher: ["/dashboard/:path*"],
};
