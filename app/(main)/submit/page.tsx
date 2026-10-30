import Link from "next/link";
import { redirect } from "next/navigation";
import { one, query, tx } from "@/lib/db";
import { logStatus, nextDocNo, notify } from "@/lib/workflow";
import { guarded } from "@/lib/action";
import { requirePerm, requirePermPage } from "@/lib/permissions";
import { channelLabel, dateTime } from "@/lib/labels";
import { draftInbox } from "@/lib/inbox";
import type { Draft } from "@/lib/extract";
import FlowSteps from "@/components/FlowSteps";
import VoiceTextarea from "@/components/VoiceTextarea";
import ShipForm from "@/components/ShipForm";
import { inboxFlow, poFlow, soFlow } from "@/lib/flow";
import { contractRemaining } from "@/lib/stock";
import { shipFromOrder } from "../sales/actions";

const MAX_IMAGE = 5 * 1024 * 1024;

async function submitOrder(formData: FormData) {
  "use server";
  return guarded(() => saveOrder(formData));
}

async function saveOrder(formData: FormData) {
  const user = await requirePerm("order.submit");
  const text = String(formData.get("raw_text") ?? "").trim();
  const file = formData.get("image");
  const image = file instanceof File && file.size > 0 ? file : null;
  if (!text && !image) throw new Error("메시지를 붙여 넣거나 사진을 올려 주세요.");
  if (image && image.size > MAX_IMAGE) throw new Error("사진은 5MB 이하로 올려 주세요.");
  const [row] = await query<{ id: number }>(
    `insert into order_inbox (channel, direction, partner_id, raw_text, received_by, image, image_type, sales_note)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      formData.get("channel"),
      formData.get("direction"),
      Number(formData.get("partner_id")) || null,
      text || "(사진으로 접수)",
      user.id,
      image ? Buffer.from(await image.arrayBuffer()) : null,
      image?.type ?? null,
      String(formData.get("sales_note") ?? "").trim() || null,
    ],
  );
  await draftInbox(row.id);
  await query(
    "insert into notifications (user_role, message, link) values ('staff', $1, '/inbox'), ('office_admin', $1, '/inbox')",
    [`${user.name}님이 주문을 올렸습니다.`],
  );
  redirect(`/submit?done=${row.id}`);
}

// 출하 지시: 영업 담당자가 거래처·품목·수량·납기를 직접 골라 보내면 바로 수주(출하 지시)로 등록됩니다.
async function shipRequest(formData: FormData) {
  "use server";
  return guarded(() => saveShipRequest(formData));
}

async function saveShipRequest(formData: FormData) {
  const user = await requirePerm("order.submit");
  // 거래처 칸(block)마다 출하 지시 하나. 칸 번호 n의 값은 c{n}_ 로 시작하는 이름으로 옵니다.
  const blocks = formData.getAll("block").map((k) => {
    const f = (name: string) => formData.get(`c${k}_${name}`);
    const ids = formData.getAll(`c${k}_item_id`).map(Number);
    const qtys = formData.getAll(`c${k}_qty`).map(Number);
    return {
      customerId: Number(f("customer_id")),
      dueDate: String(f("due_date") ?? "") || null,
      memo: String(f("memo") ?? "").trim() || null,
      urgent: f("urgent") === "on",
      lines: ids.map((itemId, i) => ({ itemId, qty: qtys[i] })).filter((l) => l.itemId && l.qty > 0),
    };
  });
  if (blocks.length === 0) throw new Error("납품할 거래처를 고르세요.");
  blocks.forEach((b, i) => {
    const which = blocks.length > 1 ? `거래처 ${i + 1}: ` : "";
    if (!b.customerId) throw new Error(`${which}납품할 거래처를 고르세요.`);
    if (b.lines.length === 0) throw new Error(`${which}품목과 수량을 한 줄 이상 입력하세요.`);
    if (!b.dueDate) throw new Error(`${which}납품일을 입력하세요.`);
  });
  const soNos = await tx(async (c) => {
    const nos: string[] = [];
    for (const b of blocks) {
      const soNo = await nextDocNo(c, "SO");
      const { rows } = await c.query(
        `insert into sales_orders (so_no, customer_id, due_date, memo, created_by, kind, urgent)
         values ($1,$2,$3,$4,$5,'ship_request',$6) returning id`,
        [soNo, b.customerId, b.dueDate, b.memo, user.id, b.urgent],
      );
      const soId = rows[0].id as number;
      for (const l of b.lines) {
        await c.query(
          `insert into sales_order_lines (so_id, item_id, qty, unit_price)
           values ($1,$2,$3,(select default_price from items where id = $2))`,
          [soId, l.itemId, l.qty],
        );
      }
      await logStatus(c, "so", soId, null, "received", user.id, `${user.name}님 출하 지시${b.urgent ? " (긴급)" : ""}`);
      const msg = `${b.urgent ? "[긴급] " : ""}${user.name}님 출하 지시 ${soNo}: 재고 확인 후 확정해 주세요.`;
      await notify(c, "office_admin", msg, `/sales/${soId}`);
      await notify(c, "staff", msg, `/sales/${soId}`);
      nos.push(soNo);
    }
    return nos;
  });
  redirect(`/shipments?sent=${encodeURIComponent(soNos.join(", "))}`);
}

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; mode?: string; copy?: string; from?: string }>;
}) {
  const user = await requirePermPage("order.submit");
  const { done, mode, copy, from } = await searchParams;
  const ship = mode === "ship";
  const partners = await query<{ id: number; name: string }>("select id, name from partners order by name");
  const customers = await query<{ id: number; name: string }>(
    "select id, name from partners where type in ('customer','both') order by name",
  );
  const items = await query<{ id: number; code: string; name: string; unit: string }>("select id, code, name, unit from items order by code");
  // 다시 보내기: 지난 출하 지시 내용을 칸에 미리 채웁니다.
  const base = copy
    ? await one<{ customer_id: number; memo: string | null }>(
        "select customer_id, memo from sales_orders where id = $1 and created_by = $2",
        [Number(copy), user.id],
      )
    : null;
  const baseLines = base
    ? await query<{ item_id: number; qty: string }>("select item_id, qty from sales_order_lines where so_id = $1 order by id", [Number(copy)])
    : [];
  // 나눠 보낼 수 있는 기존 수주(계약): 진행 중이고 남은 수량이 있는 것
  const contracts = ship
    ? await query<{ id: number; so_no: string; customer: string; due_date: Date | null; memo: string | null; summary: string }>(
        `select s.id, s.so_no, p.name as customer, s.due_date, s.memo,
                string_agg(i.name || ' ' || trim_scale(r.remaining)::text || i.unit, ', ' order by l.id) as summary
           from sales_orders s join partners p on p.id = s.customer_id
           join sales_order_lines l on l.so_id = s.id join items i on i.id = l.item_id
           cross join lateral (select l.qty - l.shipped_qty - coalesce((
                 select sum(cl.qty - cl.shipped_qty) from sales_order_lines cl join sales_orders c on c.id = cl.so_id
                  where c.parent_so_id = s.id and cl.item_id = l.item_id and c.status <> 'cancelled'), 0) as remaining) r
          where s.kind = 'order' and s.status in ('received','confirmed','preparing','partially_shipped') and r.remaining > 0
          group by s.id, p.name order by s.due_date nulls last`,
      )
    : [];
  const parent = from ? contracts.find((c) => c.id === Number(from)) : undefined;
  const parentLines = parent ? (await contractRemaining(parent.id)).filter((l) => Number(l.remaining) > 0) : [];
  const shipCount = (await one<{ active: number; late: number }>(
    `select count(*)::int as active, (count(*) filter (where due_date < current_date))::int as late from sales_orders
      where created_by = $1 and kind = 'ship_request' and status not in ('shipped','cancelled')`,
    [user.id],
  ))!;
  const mine = await query(
    `select i.id, i.channel, i.direction, i.raw_text, i.received_at, i.status, i.ai_draft, i.linked_doc_type, i.linked_doc_id,
            coalesce(po.status, so.status) as doc_status, coalesce(po.po_no, so.so_no) as doc_no,
            coalesce(po.ecount_slip_no, so.ecount_slip_no) as slip_no
       from order_inbox i
       left join purchase_orders po on i.linked_doc_type = 'po' and po.id = i.linked_doc_id
       left join sales_orders so on i.linked_doc_type = 'so' and so.id = i.linked_doc_id
      where i.received_by = $1 order by i.received_at desc limit 20`,
    [user.id],
  );

  return (
    <div className="narrow">
      <h1 style={{ marginBottom: 4 }}>주문 올리기</h1>
      <div className="chips" style={{ margin: "8px 0 12px" }}>
        <Link href="/submit" className={`chip ${ship ? "" : "on"}`}>받은 메시지 전달</Link>
        <Link href="/submit?mode=ship" className={`chip ${ship ? "on" : ""}`}>출하 지시</Link>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {ship
          ? "어느 거래처에 어떤 품목을 몇 개 납품할지 직접 골라 보내세요. 바로 출하 지시로 등록되어 재고 확인과 출고로 넘어갑니다."
          : "거래처에게 받은 카톡·문자·메일을 그대로 붙여 넣거나 캡처 사진을 올리세요. 수발주 담당자가 확인 후 처리합니다."}
      </p>
      {ship && (
        <Link href="/shipments" className="panel ship-summary">
          <span>
            <b>내 출하 현황</b>
            <span className="muted"> · 진행 중 {shipCount.active}건</span>
            {shipCount.late > 0 && <span className="badge bad" style={{ marginLeft: 6 }}>지연 {shipCount.late}건</span>}
          </span>
          <span>보기 →</span>
        </Link>
      )}
      {ship && parent && (
        <form action={shipFromOrder} className="panel">
          <input type="hidden" name="parent_id" value={parent.id} />
          <label>기존 수주에서 나눠 보내기</label>
          <div><b>{parent.so_no}</b> {parent.customer}{parent.memo ? ` · ${parent.memo}` : ""}</div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>품목</th><th className="num">남은 수량</th><th>이번에 보낼 수량</th></tr></thead>
            <tbody>
              {parentLines.map((l) => (
                <tr key={l.line_id}>
                  <td>{l.name}<input type="hidden" name="item_id" value={l.item_id} /></td>
                  <td className="num">{Number(l.remaining).toLocaleString("ko-KR")} {l.unit}</td>
                  <td><input name="qty" type="number" step="0.001" min="0" max={Number(l.remaining)} inputMode="decimal" style={{ fontSize: 16 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fields" style={{ marginTop: 12 }}>
            <div><label>납품일</label><input type="date" name="due_date" required style={{ fontSize: 16 }} /></div>
            <div><label>메모</label><input name="memo" placeholder="예) 11월 2차분" style={{ fontSize: 16 }} /></div>
          </div>
          <label className="chip" style={{ marginTop: 8 }}><input type="checkbox" name="urgent" /> 긴급</label>
          <button className="block" style={{ marginTop: 16 }}>출하 지시 보내기</button>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>보낸 수량만큼 원 수주의 남은 수량에서 빠집니다. <Link href="/submit?mode=ship">다른 수주 고르기</Link></p>
        </form>
      )}
      {ship && !parent && contracts.length > 0 && (
        <div className="panel">
          <label>기존 수주에서 나눠 보내기</label>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>계약해 둔 물량을 나눠 내보낼 때 고르세요. 새 주문이면 아래 칸을 쓰세요.</p>
          {contracts.map((c) => (
            <Link key={c.id} href={`/submit?mode=ship&from=${c.id}`} className="contract-row">
              <b>{c.so_no}</b> {c.customer}{c.memo ? ` · ${c.memo}` : ""}
              <div className="muted" style={{ fontSize: 13 }}>남은 수량: {c.summary}</div>
            </Link>
          ))}
        </div>
      )}
      {ship && !parent && (
        <ShipForm
          action={shipRequest}
          customers={customers}
          items={items}
          initial={base ? { customerId: base.customer_id, memo: base.memo, lines: baseLines.map((l) => ({ itemId: l.item_id, qty: Number(l.qty) })) } : undefined}
        />
      )}
      {!ship && (<>

      {done && (
        <div className="panel" style={{ borderColor: "var(--ok)" }}>
          <b>접수되었습니다.</b> 아래 목록에서 진행 상황을 볼 수 있어요.
        </div>
      )}

      <form action={submitOrder} className="panel">
        <label>받은 메시지</label>
        <VoiceTextarea name="raw_text" placeholder="여기에 길게 눌러 붙여넣기, 또는 아래 버튼으로 말하기" />

        <label style={{ marginTop: 12 }}>캡처 사진 (선택)</label>
        <input type="file" name="image" accept="image/*" />
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>손글씨 주문서 사진 자동 읽기는 AI 키를 연결하면 켜집니다.</div>

        <label style={{ marginTop: 12 }}>어디서 받았나요?</label>
        <div className="chips">
          {Object.entries(channelLabel).map(([k, v], i) => (
            <label key={k} className="chip">
              <input type="radio" name="channel" value={k} defaultChecked={i === 1} /> {v}
            </label>
          ))}
        </div>

        <label style={{ marginTop: 12 }}>어떤 주문인가요?</label>
        <div className="chips">
          <label className="chip"><input type="radio" name="direction" value="sales" defaultChecked /> 고객 주문</label>
          <label className="chip"><input type="radio" name="direction" value="purchase" /> 원부재료 구매</label>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="muted">거래처·메모 추가 (선택)</summary>
          <div className="fields" style={{ marginTop: 8 }}>
            <div><label>거래처</label>
              <select name="partner_id" defaultValue="">
                <option value="">AI가 원문에서 찾기</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label>메모</label><input name="sales_note" placeholder="예) 급한 건입니다" /></div>
          </div>
        </details>

        <button className="block" style={{ marginTop: 16 }}>보내기</button>
      </form>

      <h2>내가 올린 주문</h2>
      <div className="cards">
        {mine.map((m) => {
          const draft = m.ai_draft as Draft | null;
          const status = m.status === "converted"
            ? `${m.linked_doc_type === "so" ? "수주" : "발주"} ${m.doc_no}`
            : m.status === "ignored" ? "처리 안 함" : "담당자 확인 대기";
          return (
            <div key={String(m.id)} className="panel">
              <div className="actions" style={{ justifyContent: "space-between" }}>
                <span className="badge info">{channelLabel[String(m.channel)]}</span>
                <span className={`badge ${m.status === "converted" ? "ok" : m.status === "ignored" ? "" : "warn"}`}>{status}</span>
              </div>
              <div style={{ marginTop: 8 }}>{draft?.summary ?? String(m.raw_text).slice(0, 60)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{dateTime(m.received_at)}</div>
              <div style={{ marginTop: 8 }}>
                <FlowSteps
                  compact
                  flow={
                    m.status !== "converted"
                      ? inboxFlow(String(m.direction), String(m.status), Boolean(draft))
                      : m.linked_doc_type === "so"
                        ? soFlow(String(m.doc_status), true, m.slip_no as string | null)
                        : poFlow(String(m.doc_status), true, m.slip_no as string | null)
                  }
                />
              </div>
              {m.status === "converted" && user.role !== "sales" && (
                <Link href={`/${m.linked_doc_type === "so" ? "sales" : "purchase"}/${m.linked_doc_id}`}>문서 보기</Link>
              )}
            </div>
          );
        })}
        {mine.length === 0 && <p className="muted">아직 올린 주문이 없습니다.</p>}
      </div>
      </>)}
    </div>
  );
}
