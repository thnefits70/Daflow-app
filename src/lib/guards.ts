import { auth } from "@/auth";

export async function requireAdminSession() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return null;
  return session;
}
