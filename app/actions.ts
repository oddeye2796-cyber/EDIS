"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function login(formData: FormData) {
  (await cookies()).set("edis_user", String(formData.get("userId")), { httpOnly: true, path: "/" });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete("edis_user");
  redirect("/login");
}
