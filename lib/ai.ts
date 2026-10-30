// Claude API 사용 여부와 장애 대응. 키가 없거나, 크레딧 소진·키 오류·과부하로 호출이 실패하면
// 각 기능(주문 정리, 물어보기)이 규칙 기반으로 바로 넘어가도록 이유를 알려줍니다.
import Anthropic from "@anthropic-ai/sdk";

// 크레딧 소진이나 키 오류는 금방 풀리지 않으므로 잠시 호출을 쉬어 화면이 느려지지 않게 합니다.
const PAUSE_MS = 10 * 60 * 1000;
let pausedUntil = 0;
let pauseReason = "";

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY) && Date.now() >= pausedUntil;
}

export function aiPauseReason() {
  return Date.now() < pausedUntil ? pauseReason : "";
}

// 실패 이유를 사람이 읽을 말로 바꾸고, 오래 갈 오류면 잠시 호출을 멈춥니다.
export function aiFailed(e: unknown): string {
  let reason = "AI 호출 실패";
  let pause = false;
  if (e instanceof Anthropic.APIError) {
    const msg = String(e.message ?? "").toLowerCase();
    if (msg.includes("credit") || e.status === 402) {
      reason = "API 크레딧 소진";
      pause = true;
    } else if (e.status === 401 || e.status === 403) {
      reason = "API 키 오류";
      pause = true;
    } else if (e.status === 429) reason = "API 사용량 한도 초과";
    else if (e.status === 529 || (e.status ?? 0) >= 500) reason = "AI 서버 혼잡";
  }
  if (pause) {
    pausedUntil = Date.now() + PAUSE_MS;
    pauseReason = reason;
  }
  console.error(`ai: ${reason}`, e);
  return reason;
}
