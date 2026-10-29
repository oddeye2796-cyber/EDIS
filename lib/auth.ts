// 데모용 간이 로그인: 사용자 선택을 쿠키에 저장합니다. 운영 전환 시 Neon Auth로 교체합니다.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one } from "./db";

export type Role = "office_admin" | "factory_manager" | "staff" | "sales" | "executive";
export type User = { id: number; name: string; email: string; role: Role };

export const roleLabel: Record<Role, string> = {
  office_admin: "오피스 관리자",
  factory_manager: "공장 관리자",
  staff: "수발주 담당자",
  sales: "영업 담당자",
  executive: "경영진",
};

export async function currentUser(): Promise<User | undefined> {
  const id = Number((await cookies()).get("edis_user")?.value);
  if (!id) return undefined;
  return one<User>("select id, name, email, role from users where id = $1", [id]);
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
