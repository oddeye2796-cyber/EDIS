"use server";
import ExcelJS from "exceljs";
import { query, tx } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { logStatus, nextDocNo, notify } from "@/lib/workflow";

export type UploadResult = { ok: boolean; created: { kind: "po" | "so"; id: number; no: string; partner: string; lines: number }[]; errors: string[] } | null;

const HEADERS: Record<string, string> = { 구분: "kind", 거래처: "partner", 품목: "item", 수량: "qty", 단가: "price", 납기: "due", 메모: "memo" };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws?.eachRow((row) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value;
      if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
      else if (v && typeof v === "object" && "text" in v) cells.push(String(v.text));
      else if (v && typeof v === "object" && "result" in v) cells.push(String(v.result));
      else cells.push(v == null ? "" : String(v).trim());
    }
    rows.push(cells);
  });
  return rows;
}

function toDate(s: string, year: number): string | null {
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\s*[\/월.-]\s*(\d{1,2})/);
  if (m) return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

// 엑셀(.xlsx)이나 CSV의 주문 줄을 읽어 구분·거래처·납기가 같은 줄끼리 발주서/수주 한 건으로 묶어 등록합니다.
// 한 줄이라도 틀리면 아무것도 만들지 않고 틀린 줄을 알려 줍니다.
export async function uploadOrders(_prev: UploadResult, formData: FormData): Promise<UploadResult> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, created: [], errors: ["파일을 골라 주세요."] };
  if (file.size > 2 * 1024 * 1024) return { ok: false, created: [], errors: ["파일은 2MB 이하로 올려 주세요."] };
  let table: string[][];
  try {
    table = file.name.toLowerCase().endsWith(".csv") ? parseCsv(await file.text()) : await parseXlsx(await file.arrayBuffer());
  } catch {
    return { ok: false, created: [], errors: ["파일을 읽지 못했습니다. 양식(.xlsx 또는 .csv)을 확인해 주세요."] };
  }
  const [header, ...body] = table;
  const col: Record<string, number> = {};
  (header ?? []).forEach((h, i) => { if (HEADERS[h.trim()]) col[HEADERS[h.trim()]] = i; });
  const missing = ["kind", "partner", "item", "qty", "due"].filter((k) => col[k] === undefined);
  if (missing.length) {
    const names = Object.entries(HEADERS).filter(([, v]) => missing.includes(v)).map(([k]) => k);
    return { ok: false, created: [], errors: [`첫 줄에 ${names.join(", ")} 칸 제목이 없습니다. 양식을 내려받아 쓰세요.`] };
  }

  const partners = await query<{ id: number; name: string; type: string }>("select id, name, type from partners");
  const items = await query<{ id: number; code: string; name: string }>("select id, code, name from items");
  const aliases = await query<{ item_id: number; alias: string }>("select item_id, alias from item_aliases");
  const findItem = (t: string) =>
    items.find((i) => i.code === t || i.name === t || i.name.replace(/\s*\(.*\)\s*/, "") === t)?.id ??
    aliases.find((a) => a.alias === t)?.item_id;

  const year = new Date().getFullYear();
  const errors: string[] = [];
  const groups = new Map<string, { kind: "po" | "so"; partnerId: number; partner: string; due: string; memo: string; lines: { itemId: number; qty: number; price: number | null }[] }>();
  body.forEach((r, idx) => {
    const n = idx + 2;
    const get = (k: string) => (col[k] === undefined ? "" : (r[col[k]] ?? "").trim());
    if (!r.some((c) => c)) return;
    const kindText = get("kind");
    const kind = kindText.includes("수주") || kindText.includes("출하") ? "so" : kindText.includes("발주") ? "po" : null;
    const partner = partners.find((p) => p.name === get("partner"));
    const itemId = findItem(get("item"));
    const qty = Number(get("qty").replaceAll(",", ""));
    const priceText = get("price").replaceAll(",", "");
    const due = toDate(get("due"), year);
    const problems: string[] = [];
    if (!kind) problems.push("구분은 '수주' 또는 '발주'");
    if (!partner) problems.push(`거래처 '${get("partner")}' 없음`);
    if (!itemId) problems.push(`품목 '${get("item")}' 없음`);
    if (!(qty > 0)) problems.push("수량 확인");
    if (!due) problems.push("납기 날짜 확인");
    if (problems.length) {
      errors.push(`${n}번째 줄: ${problems.join(", ")}`);
      return;
    }
    const key = `${kind}|${partner!.id}|${due}`;
    const g = groups.get(key) ?? { kind: kind!, partnerId: partner!.id, partner: partner!.name, due: due!, memo: get("memo"), lines: [] };
    g.lines.push({ itemId: itemId!, qty, price: priceText ? Number(priceText) : null });
    groups.set(key, g);
  });
  if (errors.length) return { ok: false, created: [], errors };
  if (groups.size === 0) return { ok: false, created: [], errors: ["등록할 줄이 없습니다."] };

  const created = await tx(async (c) => {
    const out: NonNullable<UploadResult>["created"] = [];
    for (const g of groups.values()) {
      const no = await nextDocNo(c, g.kind === "po" ? "PO" : "SO");
      const memo = `엑셀 일괄 등록${g.memo ? ` · ${g.memo}` : ""}`;
      const { rows } = g.kind === "po"
        ? await c.query(
            `insert into purchase_orders (po_no, supplier_id, status, due_date, memo, created_by) values ($1,$2,'pending_approval',$3,$4,$5) returning id`,
            [no, g.partnerId, g.due, memo, user.id],
          )
        : await c.query(
            `insert into sales_orders (so_no, customer_id, due_date, memo, created_by) values ($1,$2,$3,$4,$5) returning id`,
            [no, g.partnerId, g.due, memo, user.id],
          );
      const id = rows[0].id as number;
      for (const l of g.lines) {
        await c.query(
          `insert into ${g.kind === "po" ? "purchase_order_lines (po_id" : "sales_order_lines (so_id"}, item_id, qty, unit_price)
           values ($1,$2,$3, coalesce($4, (select default_price from items where id = $2)))`,
          [id, l.itemId, l.qty, l.price],
        );
      }
      await logStatus(c, g.kind, id, null, g.kind === "po" ? "pending_approval" : "received", user.id, "엑셀 일괄 등록");
      out.push({ kind: g.kind, id, no, partner: g.partner, lines: g.lines.length });
    }
    await notify(c, "office_admin", `엑셀로 주문 ${out.length}건이 등록되었습니다.`, "/upload");
    return out;
  });
  return { ok: true, created, errors: [] };
}
