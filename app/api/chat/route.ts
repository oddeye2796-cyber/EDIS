import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ask, type ChatTurn } from "@/lib/assistant";

// 물어보기 챗봇. 로그인한 사용자의 역할 범위 안에서만 조회합니다.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { messages?: ChatTurn[] } | null;
  const messages = (body?.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    .slice(-10);
  if (!messages.length || messages.at(-1)!.role !== "user") return NextResponse.json({ error: "질문을 입력해 주세요." }, { status: 400 });
  try {
    return NextResponse.json(await ask(user, messages));
  } catch (e) {
    console.error("chat failed", e);
    return NextResponse.json({ error: "답을 만들지 못했어요. 잠시 후 다시 물어봐 주세요." }, { status: 500 });
  }
}
