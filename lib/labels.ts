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

// 화면 날짜는 한국 시간으로 짧게 씁니다: 올해는 10/29, 다른 해는 2025/10/29. 줄이 바뀌지 않게 시각 앞은 붙는 공백(\u00a0)입니다.
const kst = (d: unknown) => {
  const v = d instanceof Date ? d : new Date(String(d));
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(v)
      .map((x) => [x.type, x.value]),
  );
  const thisYear = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date());
  return { day: `${p.year === thisYear ? "" : `${p.year}/`}${p.month}/${p.day}`, time: `${p.hour}:${p.minute}` };
};

export function date(d: unknown) {
  if (!d) return "-";
  // date 칸(시각 없음)은 DB에서 그 날 0시로 오므로 시간대를 바꾸지 않고 그대로 씁니다.
  if (d instanceof Date && d.getHours() === 0 && d.getMinutes() === 0) {
    const y = d.getFullYear() === new Date().getFullYear() ? "" : `${d.getFullYear()}/`;
    return `${y}${d.getMonth() + 1}/${d.getDate()}`;
  }
  return kst(d).day;
}

export function dateTime(d: unknown) {
  if (!d) return "-";
  const k = kst(d);
  return `${k.day}\u00a0${k.time}`;
}

export function daysUntil(d: unknown) {
  if (!d) return undefined;
  const v = d instanceof Date ? d : new Date(String(d));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((v.getTime() - today.getTime()) / 86400000);
}
