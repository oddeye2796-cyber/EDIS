// 이카운트 ERP 연동.
// ECOUNT_COM_CODE, ECOUNT_USER_ID, ECOUNT_API_CERT_KEY 가 없으면 모의(mock) 모드로 동작해
// 실제로 보낼 요청 내용만 기록하고 가짜 전표번호를 돌려줍니다.
import type { PoolClient } from "pg";

type Line = { item_code: string; qty: number; unit_price: number };

export function isMock() {
  return !(process.env.ECOUNT_COM_CODE && process.env.ECOUNT_USER_ID && process.env.ECOUNT_API_CERT_KEY);
}

function buildRequest(kind: "purchase" | "sale", partnerCode: string, ioDate: Date, lines: Line[]) {
  const ymd = ioDate.toISOString().slice(0, 10).replaceAll("-", "");
  const listKey = kind === "purchase" ? "PurchasesList" : "SaleList";
  return {
    endpoint: kind === "purchase" ? "/OAPI/V2/Purchases/SavePurchases" : "/OAPI/V2/Sale/SaveSale",
    body: {
      [listKey]: lines.map((l, i) => ({
        BulkDatas: {
          IO_DATE: ymd,
          UPLOAD_SER_NO: String(i + 1),
          CUST: partnerCode,
          PROD_CD: l.item_code,
          QTY: String(l.qty),
          PRICE: String(l.unit_price),
          SUPPLY_AMT: String(Math.round(l.qty * l.unit_price)),
        },
      })),
    },
  };
}

export async function pushSlip(
  c: PoolClient,
  kind: "purchase" | "sale",
  docId: number,
  partnerCode: string,
  lines: Line[],
): Promise<string> {
  const request = buildRequest(kind, partnerCode, new Date(), lines);
  if (!isMock()) {
    // 실연동은 이카운트 오픈API 인증키 발급 후 구현합니다 (Zone 조회 → 로그인 → 세션으로 저장 호출).
    throw new Error("이카운트 실연동은 아직 구현되지 않았습니다.");
  }
  const slipNo = `MOCK-${kind === "purchase" ? "P" : "S"}-${Date.now().toString().slice(-8)}`;
  await c.query(
    "insert into ecount_sync_logs (doc_type, doc_id, request, response, success, mock) values ($1,$2,$3,$4,true,true)",
    [kind === "purchase" ? "po" : "so", docId, request, { Status: "200", SlipNos: [slipNo] }],
  );
  return slipNo;
}
