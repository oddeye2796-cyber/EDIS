import type { FlowState } from "@/lib/flow";

// 단계 칩을 선으로 이은 진행 바. 끝난 단계는 체크, 현재 단계는 강조, 남은 단계는 흐리게 표시합니다.
export default function FlowSteps({ flow, compact = false, counts }: { flow: FlowState; compact?: boolean; counts?: number[] }) {
  if (compact) return <FlowMini flow={flow} />;
  return (
    <ol className={`flow${counts ? " overview" : ""}`}>
      {flow.steps.map((label, i) => {
        const state = flow.current < 0
          ? (counts?.[i] ? "waiting" : "plain")
          : i < flow.current ? "done" : i === flow.current ? (flow.tone === "stopped" ? "stopped" : "current") : "todo";
        return (
          <li key={label} className={`flow-step ${state}`}>
            <span className="flow-num">{state === "done" ? "✓" : state === "stopped" ? "!" : i + 1}</span>
            <span className="flow-label">
              {label}
              {state === "current" && <span className="flow-now">{flow.note ?? "현재 단계"}</span>}
              {state === "stopped" && <span className="flow-now">{flow.note}</span>}
            </span>
            {counts && counts[i] > 0 && <span className="flow-count">{counts[i]}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// 좁은 카드용: 단계 수만큼의 막대와 현재 단계 이름만 보여줍니다.
function FlowMini({ flow }: { flow: FlowState }) {
  const total = flow.steps.length;
  const done = flow.current >= total;
  const label = done
    ? "모든 단계 완료"
    : `${flow.tone === "stopped" ? flow.note ?? "중단" : "현재 단계"}: ${flow.steps[flow.current]} (${flow.current + 1}/${total})`;
  return (
    <div className="flow-mini">
      <div className="bars">
        {flow.steps.map((s, i) => (
          <span
            key={s}
            title={s}
            className={i < flow.current ? "done" : i === flow.current ? (flow.tone === "stopped" ? "stopped" : "current") : ""}
          />
        ))}
      </div>
      <div className={`flow-mini-label${flow.tone === "stopped" ? " stopped" : done ? " done" : ""}`}>{label}</div>
    </div>
  );
}
