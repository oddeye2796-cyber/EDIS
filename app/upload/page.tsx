import { requireUser } from "@/lib/auth";
import UploadForm from "./UploadForm";

export default async function UploadPage() {
  await requireUser();
  return (
    <>
      <h1 style={{ marginBottom: 4 }}>엑셀 일괄 등록</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        거래처가 엑셀로 보낸 주문이나 정기 발주를 한 번에 올립니다. 구분·거래처·납기가 같은 줄은 문서 한 건으로 묶입니다.
        품목 칸에는 품목코드, 품목명, 등록된 별칭을 쓸 수 있습니다.
      </p>
      <div className="panel">
        <label>양식</label>
        <table>
          <thead><tr><th>구분</th><th>거래처</th><th>품목</th><th>수량</th><th>단가</th><th>납기</th><th>메모</th></tr></thead>
          <tbody>
            <tr><td>수주</td><td>건강한생활</td><td>비타민C</td><td>50</td><td></td><td>2026-11-20</td><td>정기 주문</td></tr>
            <tr><td>발주</td><td>대한포장</td><td>SM-003</td><td>5000</td><td>350</td><td>11/25</td><td></td></tr>
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>단가를 비우면 품목 기본단가가 들어갑니다. <a href="/api/upload-template">양식 내려받기 (CSV)</a></p>
      </div>
      <UploadForm />
    </>
  );
}
