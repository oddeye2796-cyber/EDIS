"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// 모든 화면 오른쪽 아래의 물어보기 창. 대화는 이 탭에서만 기억합니다.
type Msg = { role: "user" | "assistant"; content: string; sources?: { title: string; href: string }[]; notice?: string };

// **굵게** 와 줄바꿈만 그려 줍니다.
function Text({ s }: { s: string }) {
  return (
    <>
      {s.split("\n").map((line, i) => (
        <div key={i}>{line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith("**") ? <b key={j}>{p.slice(2, -2)}</b> : p))}</div>
      ))}
    </>
  );
}

export default function ChatWidget({ name, suggestions, llm }: { name: string; suggestions: string[]; llm: boolean }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("edis-chat");
      if (saved) setMsgs(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem("edis-chat", JSON.stringify(msgs.slice(-20)));
    } catch {}
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs, open]);

  async function send(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await res.json();
      setMsgs([...next, data.error ? { role: "assistant", content: data.error } : { role: "assistant", content: data.answer, sources: data.sources, notice: data.notice }]);
    } catch {
      setMsgs([...next, { role: "assistant", content: "연결이 끊겼어요. 잠시 후 다시 물어봐 주세요." }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="물어보기 열기">
        💬 물어보기
      </button>
    );
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="물어보기">
      <div className="chat-head">
        <div>
          <b>물어보기</b>
          <div className="muted" style={{ fontSize: 12 }}>사용법, 문서 진행 상황, 재고를 물어보세요{llm ? "" : " (간단 모드)"}</div>
        </div>
        <div className="actions">
          {msgs.length > 0 && (
            <button className="link-btn" onClick={() => setMsgs([])}>새 대화</button>
          )}
          <button className="link-btn" onClick={() => setOpen(false)} aria-label="닫기">닫기</button>
        </div>
      </div>
      <div className="chat-body">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <p>{name}님, 무엇이든 물어보세요.</p>
            {suggestions.map((s) => (
              <button key={s} className="chat-suggest" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <Text s={m.content} />
            {m.notice && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{m.notice}</div>}
            {m.sources && m.sources.length > 0 && (
              <div className="chat-sources">
                {m.sources.map((s) => (
                  <Link key={s.href} href={s.href} prefetch={false}>{s.title}</Link>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="chat-msg assistant muted">찾아보는 중…</div>}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="예) SO-DEMO-002 어디까지 왔어?" maxLength={500} />
        <button disabled={busy || !input.trim()}>보내기</button>
      </form>
    </div>
  );
}
