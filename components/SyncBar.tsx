import { dateTime } from "@/lib/labels";
import { lastSync, type MasterKind } from "@/lib/master";

// 기준 정보 화면 위쪽: 이카운트가 원본이라는 안내와 마지막 동기화 시각, 동기화 버튼
export default async function SyncBar({ kind, action }: { kind: MasterKind; action: (f: FormData) => Promise<void> }) {
  const last = await lastSync(kind);
  return (
    <div className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div>
        <b>이카운트 기준 정보</b>
        <span className="muted"> · 추가·수정은 이카운트에서 하고, 여기서는 조회만 합니다.</span>
        <div className="muted">
          마지막 동기화: {last ? `${dateTime(last.at)} (${last.count}건${last.mock ? ", 모의" : ""})` : "아직 없음"}
        </div>
      </div>
      <form action={action}>
        <button className="secondary">이카운트에서 다시 받기</button>
      </form>
    </div>
  );
}
