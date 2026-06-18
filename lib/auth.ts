import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

declare module "next-auth" {
  interface User {
    id?: string;
  }
  interface Session {
    user?: User & {
      id?: string;
    };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
     async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
        const p = profile as { email?: string; email_verified?: boolean; hd?: string };
        return (
          p.email_verified === true &&
          (p.email?.endsWith(`@${process.env.ALLOWED_DOMAIN}`) ?? false)
        );
     },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
