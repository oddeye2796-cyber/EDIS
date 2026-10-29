// 주문 메일함 연동. 전용 메일함(예: order@hurum.co.kr)을 주기적으로 읽어 새 메일을 주문 접수함에 넣습니다.
// MAIL_IMAP_HOST, MAIL_USER, MAIL_PASSWORD 가 없으면 모의 모드로, 준비된 예시 메일을 한 통씩 받아 옵니다.
import { one, query } from "./db";
import { draftInbox } from "./inbox";

export function isMailMock() {
  return !(process.env.MAIL_IMAP_HOST && process.env.MAIL_USER && process.env.MAIL_PASSWORD);
}

export function orderMailbox() {
  return process.env.MAIL_USER ?? "order@hurum.demo";
}

type SampleMail = { from: string; subject: string; body: string; direction: "sales" | "purchase" };

const samples: SampleMail[] = [
  {
    from: "buyer-hurum@costco.demo",
    subject: "[코스트코] 12월 입고분 발주 요청",
    body: "안녕하세요, 코스트코 구매팀입니다.\n12월 첫째 주 입고분으로 아래 수량 요청드립니다.\n메가 비타민C 1000 플러스 D 2,400박스\n리얼슬립 1개월분 600박스\n납기 12/3까지 부탁드립니다.",
    direction: "sales",
  },
  {
    from: "md-hurum@daiso.demo",
    subject: "아이편안 루테인 추가 주문 건",
    body: "휴럼 담당자님, 다이소 MD입니다.\n아이편안 루테인지아잔틴 1,500개 추가 주문합니다.\n매장 재고가 부족해 급하게 부탁드립니다. 다음주 화요일까지 가능할까요?",
    direction: "sales",
  },
  {
    from: "order@hanbit.demo",
    subject: "RE: 비타민C 원료 단가 및 납기 회신",
    body: "한빛원료 최한빛입니다.\n요청하신 비타민C (아스코르빈산) 300kg 11/14 입고 가능합니다.\n단가는 기존과 동일합니다. 발주서 주시면 진행하겠습니다.",
    direction: "purchase",
  },
];

// 아직 가져오지 않은 예시 메일 한 통을 접수함에 넣습니다. 다 가져왔으면 null.
export async function fetchNewMail(): Promise<number | null> {
  if (!isMailMock()) {
    // 실연동: IMAP으로 읽지 않은 메일을 가져와 같은 방식으로 넣습니다. 메일 계정 정보를 받은 뒤 구현합니다.
    throw new Error("메일함 실연동은 아직 구현되지 않았습니다.");
  }
  const done = await query<{ email_subject: string }>("select email_subject from order_inbox where email_subject is not null");
  const next = samples.find((m) => !done.some((d) => d.email_subject === m.subject));
  if (!next) return null;
  const partner = await one<{ id: number }>("select id from partners where email = $1", [next.from]);
  const [row] = await query<{ id: number }>(
    `insert into order_inbox (channel, direction, partner_id, raw_text, email_from, email_subject)
     values ('email', $1, $2, $3, $4, $5) returning id`,
    [next.direction, partner?.id ?? null, `${next.subject}\n\n${next.body}`, next.from, next.subject],
  );
  await draftInbox(row.id);
  await query(
    "insert into notifications (user_role, message, link) values ('staff', $1, '/inbox'), ('office_admin', $1, '/inbox')",
    [`주문 메일이 들어왔습니다: ${next.subject}`],
  );
  return row.id;
}
