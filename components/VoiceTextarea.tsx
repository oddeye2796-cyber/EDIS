"use client";
import { useEffect, useRef, useState } from "react";

// 받은 메시지 칸 + 음성 입력. 브라우저 내장 음성 인식(Web Speech API, 한국어)으로 받아 적어서 AI 키 없이도 됩니다.
// 받아 적은 글은 다른 원문과 똑같이 접수함으로 가서 정리됩니다.

// 브라우저마다 이름이 달라 최소한의 모양만 정의합니다.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const errorText: Record<string, string> = {
  "not-allowed": "마이크 사용이 막혀 있어요. 주소창의 자물쇠 아이콘에서 마이크를 허용해 주세요.",
  "service-not-allowed": "마이크 사용이 막혀 있어요. 주소창의 자물쇠 아이콘에서 마이크를 허용해 주세요.",
  "no-speech": "말소리가 들리지 않았어요. 다시 눌러서 말해 주세요.",
  "audio-capture": "마이크를 찾지 못했어요.",
  network: "음성 인식 서버에 연결하지 못했어요. 잠시 후 다시 해 주세요.",
};

export default function VoiceTextarea({ name, placeholder }: { name: string; placeholder?: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<Recognition | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    setSupported(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    return () => rec.current?.stop();
  }, []);

  function append(text: string) {
    const el = box.current;
    if (!el || !text.trim()) return;
    el.value = el.value ? `${el.value.replace(/\s+$/, "")}\n${text.trim()}` : text.trim();
  }

  function start() {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ko-KR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) append(res[0].transcript);
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => setError(errorText[e.error] ?? "음성 인식이 멈췄어요. 다시 눌러 주세요.");
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    setError("");
    rec.current = r;
    r.start();
    setListening(true);
    // 음성으로 남긴 주문은 받은 곳을 '전화'로 미리 골라 둡니다.
    const phone = box.current?.form?.querySelector<HTMLInputElement>('input[name="channel"][value="phone"]');
    if (phone) phone.checked = true;
  }

  return (
    <>
      <textarea ref={box} name={name} placeholder={placeholder} style={{ minHeight: 140, fontSize: 16 }} />
      {listening && (
        <div className="voice-live">
          <span className="voice-dot" /> 듣는 중… {interim && <span className="muted">{interim}</span>}
        </div>
      )}
      {supported === false ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          이 브라우저는 음성 입력을 지원하지 않아요. 크롬이나 사파리를 쓰거나, 휴대폰 키보드의 마이크 버튼을 눌러 말해도 됩니다.
        </div>
      ) : (
        <button
          type="button"
          className={`${listening ? "danger" : "secondary"} block`}
          style={{ marginTop: 8 }}
          disabled={supported === null}
          onClick={() => (listening ? rec.current?.stop() : start())}
        >
          {listening ? "■ 다 말했어요 (멈추기)" : "🎤 음성으로 주문 남기기"}
        </button>
      )}
      {error && <div className="voice-error">{error}</div>}
      {!listening && supported && !error && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          누르고 거래처, 품목, 수량, 납기를 말해 주세요. 받아 적은 글은 위 칸에 들어가고 고칠 수 있어요.
        </div>
      )}
    </>
  );
}
