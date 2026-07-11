import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function RootPage() {
  const session = await auth();
  if (!session) redirect("/login");
  redirect(session.user.role === "admin" ? "/admin" : "/area");
}
