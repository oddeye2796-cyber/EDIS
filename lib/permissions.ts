// 역할별 권한표. 화면 버튼과 서버 처리 모두 이 표를 봅니다.
// 원칙: 승인은 오피스 관리자, 실물(입고·출고)은 공장 관리자, 문서 작성·발송은 사무실(수발주 담당자·오피스 관리자).
import { redirect } from "next/navigation";
import { requireUser, type Role, type User } from "./auth";

export const perms = {
  "po.create": ["staff", "office_admin"],
  "po.approve": ["office_admin"],
  "po.reject": ["office_admin", "factory_manager"],
  "po.confirm": ["factory_manager"],
  "po.send": ["staff", "office_admin"],
  "po.receive": ["factory_manager"],
  "po.cancel": ["office_admin"],
  "po.resubmit": ["staff", "office_admin"],
  "so.create": ["staff", "office_admin"],
  "so.confirm": ["staff", "office_admin"],
  "so.shortage": ["staff", "office_admin"],
  "so.prepare": ["factory_manager"],
  "so.ship": ["factory_manager"],
  "so.cancel": ["office_admin"],
  "so.split": ["staff", "office_admin", "sales"],
  "order.submit": ["sales", "staff", "office_admin"],
  "inbox.manage": ["staff", "office_admin"],
  "upload": ["staff", "office_admin"],
  "master.sync": ["staff", "office_admin"],
  "alias.edit": ["staff", "office_admin"],
  "mail.check": ["staff", "office_admin"],
} satisfies Record<string, Role[]>;

export type Perm = keyof typeof perms;

export const permLabel: Record<Role, string> = {
  office_admin: "오피스 관리자",
  factory_manager: "공장 관리자",
  staff: "수발주 담당자",
  sales: "영업 담당자",
  executive: "경영진",
};

export function can(role: Role, perm: Perm) {
  return (perms[perm] as Role[]).includes(role);
}

export function whoCan(perm: Perm) {
  return (perms[perm] as Role[]).map((r) => permLabel[r]).join("·");
}

// 서버 처리용: 권한이 없으면 사용자에게 보일 오류를 던집니다.
export async function requirePerm(perm: Perm): Promise<User> {
  const user = await requireUser();
  if (!can(user.role, perm)) throw new Error(`이 일은 ${whoCan(perm)}만 할 수 있습니다.`);
  return user;
}

// 화면용: 권한이 없으면 홈으로 보냅니다.
export async function requirePermPage(perm: Perm): Promise<User> {
  const user = await requireUser();
  if (!can(user.role, perm)) {
    const home = user.role === "sales" ? "/submit" : user.role === "executive" ? "/exec" : "/";
    redirect(`${home}?err=${encodeURIComponent(`이 화면은 ${whoCan(perm)}만 쓸 수 있습니다.`)}`);
  }
  return user;
}
