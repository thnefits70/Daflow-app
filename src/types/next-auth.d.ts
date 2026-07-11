import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: "admin" | "employee";
    deptId?: string | null;
    username?: string | null;
  }

  interface Session {
    user: {
      id: string;
      role: "admin" | "employee";
      deptId: string | null;
      username: string | null;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: "admin" | "employee";
    deptId?: string | null;
    username?: string | null;
  }
}
