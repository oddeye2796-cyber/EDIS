// 발주·수주가 지금 어느 단계에 있는지 계산합니다. 화면의 진행 바(FlowSteps)가 사용합니다.

export const poSteps = ["주문 접수", "AI 정리", "발주서 작성", "오피스 승인", "공장 확인", "발주서 발송", "입고", "이카운트 전표"];
export const soSteps = ["주문 접수", "AI 정리", "담당자 확인", "수주 확정", "출고 준비", "출고", "이카운트 전표"];

export type FlowState = { steps: string[]; current: number; tone: "active" | "done" | "stopped"; note?: string };

// 접수함을 거치지 않고 바로 작성한 문서는 앞의 두 단계(주문 접수, AI 정리)를 빼고 보여줍니다.
function trim(state: FlowState, fromInbox: boolean): FlowState {
  if (fromInbox) return state;
  return { ...state, steps: state.steps.slice(2), current: Math.max(0, state.current - 2) };
}

const poIndex: Record<string, number> = {
  pending_approval: 3,
  approved: 4,
  confirmed: 5,
  sent: 6,
  partially_received: 6,
};

export function poFlow(status: string, fromInbox: boolean, slipNo?: string | null): FlowState {
  if (status === "received") return trim({ steps: poSteps, current: slipNo ? poSteps.length : 7, tone: slipNo ? "done" : "active" }, fromInbox);
  if (status === "rejected") return trim({ steps: poSteps, current: 3, tone: "stopped", note: "반려됨" }, fromInbox);
  if (status === "cancelled") return trim({ steps: poSteps, current: 3, tone: "stopped", note: "취소됨" }, fromInbox);
  const note = status === "partially_received" ? "부분 입고" : undefined;
  return trim({ steps: poSteps, current: poIndex[status] ?? 2, tone: "active", note }, fromInbox);
}

const soIndex: Record<string, number> = { received: 3, confirmed: 4, preparing: 5, partially_shipped: 5 };

export function soFlow(status: string, fromInbox: boolean, slipNo?: string | null): FlowState {
  if (status === "shipped") return trim({ steps: soSteps, current: slipNo ? soSteps.length : 6, tone: slipNo ? "done" : "active" }, fromInbox);
  if (status === "cancelled") return trim({ steps: soSteps, current: 3, tone: "stopped", note: "취소됨" }, fromInbox);
  const note = status === "partially_shipped" ? "부분 출고" : undefined;
  return trim({ steps: soSteps, current: soIndex[status] ?? 2, tone: "active", note }, fromInbox);
}

// 아직 문서로 바뀌지 않은 접수 건: AI 정리까지 끝났고 담당자 확인을 기다립니다.
export function inboxFlow(direction: string, status: string, hasDraft: boolean): FlowState {
  const steps = direction === "purchase" ? poSteps : soSteps;
  if (status === "ignored") return { steps, current: 2, tone: "stopped", note: "처리 안 함" };
  return { steps, current: hasDraft ? 2 : 1, tone: "active" };
}
