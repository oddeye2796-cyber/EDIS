"use client";
import { useActionState } from "react";
import { uploadOrders, type UploadResult } from "./actions";

export default function UploadForm() {
  const [result, action, pending] = useActionState<UploadResult, FormData>(uploadOrders, null);
  return (
    <>
      <form action={action} className="panel">
        <label>주문 파일 (.xlsx, .csv)</label>
        <input type="file" name="file" accept=".xlsx,.csv" required />
        <div style={{ marginTop: 12 }}>
          <button disabled={pending}>{pending ? "읽는 중..." : "읽고 등록하기"}</button>
        </div>
      </form>
      {result && !result.ok && (
        <div className="panel" style={{ borderColor: "var(--bad)" }}>
          <b>등록하지 않았습니다.</b> 아래 줄을 고쳐서 다시 올려 주세요.
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--bad)" }}>
            {result.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
      {result?.ok && (
        <div className="panel" style={{ borderColor: "var(--ok)" }}>
          <b>{result.created.length}건을 등록했습니다.</b>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>문서</th><th>구분</th><th>거래처</th><th className="num">품목 수</th></tr></thead>
            <tbody>
              {result.created.map((c) => (
                <tr key={`${c.kind}${c.id}`}>
                  <td><a href={`/${c.kind === "po" ? "purchase" : "sales"}/${c.id}`}>{c.no}</a></td>
                  <td>{c.kind === "po" ? "발주 (승인 대기)" : "수주 (재고 확인)"}</td>
                  <td>{c.partner}</td>
                  <td className="num">{c.lines}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
