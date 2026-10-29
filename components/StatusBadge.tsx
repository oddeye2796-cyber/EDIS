import { poStatus, soStatus } from "@/lib/labels";

const tone: Record<string, string> = {
  pending_approval: "warn",
  approved: "warn",
  confirmed: "info",
  sent: "info",
  partially_received: "info",
  received: "ok",
  rejected: "bad",
  cancelled: "bad",
  preparing: "info",
  partially_shipped: "info",
  shipped: "ok",
};

export default function StatusBadge({ kind, status }: { kind: "po" | "so"; status: string }) {
  const label = (kind === "po" ? poStatus : soStatus)[status] ?? status;
  return <span className={`badge ${tone[status] ?? ""}`}>{label}</span>;
}

export function DueBadge({ due, done }: { due: unknown; done: boolean }) {
  if (!due || done) return null;
  const v = due instanceof Date ? due : new Date(String(due));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = Math.round((v.getTime() - today.getTime()) / 86400000);
  if (d < 0) return <span className="badge bad">{-d}일 지연</span>;
  if (d <= 3) return <span className="badge warn">D-{d}</span>;
  return null;
}
