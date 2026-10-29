export const poStatus: Record<string, string> = {
  draft: "작성 중",
  pending_approval: "승인 대기",
  approved: "승인됨 (공장 확인 대기)",
  confirmed: "공장 확인 완료",
  sent: "발송됨",
  partially_received: "부분 입고",
  received: "입고 완료",
  rejected: "반려",
  cancelled: "취소",
};

export const soStatus: Record<string, string> = {
  received: "접수",
  confirmed: "확정",
  preparing: "출고 준비",
  partially_shipped: "부분 출고",
  shipped: "출고 완료",
  cancelled: "취소",
};

export const channelLabel: Record<string, string> = {
  email: "이메일",
  kakao: "카톡",
  sms: "문자",
  phone: "전화",
};

export const partnerType: Record<string, string> = {
  supplier: "매입처",
  customer: "매출처",
  both: "매입·매출",
};

export const itemCategory: Record<string, string> = { raw: "원료", sub: "부재료", product: "완제품" };

export function won(n: unknown) {
  return `${Number(n ?? 0).toLocaleString("ko-KR")}원`;
}

export function qty(n: unknown) {
  return Number(n ?? 0).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
}

export function date(d: unknown) {
  if (!d) return "-";
  const v = d instanceof Date ? d : new Date(String(d));
  return v.toLocaleDateString("ko-KR");
}

export function dateTime(d: unknown) {
  if (!d) return "-";
  const v = d instanceof Date ? d : new Date(String(d));
  return v.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export function daysUntil(d: unknown) {
  if (!d) return undefined;
  const v = d instanceof Date ? d : new Date(String(d));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((v.getTime() - today.getTime()) / 86400000);
}
