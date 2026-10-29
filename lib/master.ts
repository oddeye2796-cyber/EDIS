// 거래처·품목 기준 정보 동기화. 원본은 이카운트이고 EDIS에서는 추가·수정·삭제하지 않습니다.
// 모의 모드에서는 이카운트 조회 요청만 흉내 내고, 지금 가진 데이터를 그대로 둔 채 동기화 기록을 남깁니다.
import { one, query } from "./db";
import { isMock } from "./ecount";

export type MasterKind = "partners" | "items";

export async function lastSync(kind: MasterKind) {
  return one<{ at: Date; count: number; mock: boolean }>(
    "select at, count, mock from master_sync_logs where kind = $1 order by at desc limit 1",
    [kind],
  );
}

export async function syncMaster(kind: MasterKind) {
  if (!isMock()) {
    // 실연동: 거래처는 /OAPI/V2/AccountBasic/GetBasicCustList, 품목은 /OAPI/V2/InventoryBasic/GetBasicProductsList
    // 를 불러 ecount_code 기준으로 upsert 합니다. 인증키 발급 후 구현합니다.
    throw new Error("이카운트 실연동은 아직 구현되지 않았습니다.");
  }
  const n = await one<{ n: number }>(`select count(*)::int as n from ${kind === "partners" ? "partners" : "items"}`);
  await query("insert into master_sync_logs (kind, count, mock) values ($1, $2, true)", [kind, n?.n ?? 0]);
}
