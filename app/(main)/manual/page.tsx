import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { marked } from "marked";
import { requireUser, roleLabel } from "@/lib/auth";

// 역할별 사용 매뉴얼. 원문은 content/manual.md 하나로 관리하고, 챗봇도 이 장 앵커로 출처를 겁니다.
const anchors = ["start", "sales", "staff", "office", "factory", "exec", "alerts"];
const mine: Record<string, string> = { sales: "sales", staff: "staff", office_admin: "office", factory_manager: "factory", executive: "exec" };

export default async function ManualPage() {
  const user = await requireUser();
  const src = await fs.readFile(path.join(process.cwd(), "content/manual.md"), "utf8");
  const toc: { id: string; title: string }[] = [];
  const html = (marked.parse(src, { async: false }) as string).replace(/<h2>(.*?)<\/h2>/g, (_, text: string) => {
    const id = anchors[toc.length] ?? `s${toc.length}`;
    toc.push({ id, title: text.replace(/<[^>]+>/g, "") });
    return `<h2 id="${id}">${text}</h2>`;
  });

  return (
    <div className="narrow manual">
      <h1 style={{ marginBottom: 4 }}>사용 매뉴얼</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        역할별로 하는 일을 업무 순서대로 정리했습니다. 궁금한 건 오른쪽 아래 <b>물어보기</b>에 물어봐도 됩니다.
      </p>
      <div className="panel manual-toc">
        {toc.map((t) => (
          <Link key={t.id} href={`#${t.id}`} className={t.id === mine[user.role] ? "on" : ""}>
            {t.title}
            {t.id === mine[user.role] ? ` · 내 역할(${roleLabel[user.role]})` : ""}
          </Link>
        ))}
      </div>
      <article className="panel manual-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
