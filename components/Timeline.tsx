import { query } from "@/lib/db";
import { dateTime, poStatus, soStatus } from "@/lib/labels";

export default async function Timeline({ docType, docId }: { docType: "po" | "so"; docId: number }) {
  const logs = await query(
    `select s.*, u.name as actor from status_logs s left join users u on u.id = s.actor_id
      where doc_type = $1 and doc_id = $2 order by at`,
    [docType, docId],
  );
  const labels = docType === "po" ? poStatus : soStatus;
  return (
    <div className="panel">
      <h2>처리 이력</h2>
      <ul className="timeline">
        {logs.map((l) => (
          <li key={String(l.id)}>
            <span className="muted">{dateTime(l.at)}</span> · <b>{String(l.actor ?? "")}</b> ·{" "}
            {l.from_status && l.from_status !== l.to_status ? `${labels[String(l.from_status)]} → ` : ""}
            {labels[String(l.to_status)]}
            {l.memo ? <span className="muted"> — {String(l.memo)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
