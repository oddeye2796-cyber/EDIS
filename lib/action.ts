// 서버 처리에서 난 오류를 오류 화면 대신, 보던 화면 위쪽 안내로 보여 줍니다.
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

const hangul = /[가-힣]/;

async function backTo(err?: string) {
  const ref = (await headers()).get("referer");
  if (!ref) return null;
  const url = new URL(ref);
  url.searchParams.delete("err");
  if (err) url.searchParams.set("err", err);
  return url.pathname + url.search;
}

export async function guarded(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    unstable_rethrow(e);
    const raw = e instanceof Error ? e.message : String(e);
    // 사람이 읽으라고 쓴 안내(한글)는 그대로, 그 밖의 오류는 일반 문구로 바꿉니다.
    const msg = hangul.test(raw) ? raw : "처리 중 문제가 생겼습니다. 잠시 후 다시 해 주세요.";
    if (!hangul.test(raw)) console.error(e);
    const back = await backTo(msg);
    if (back) redirect(back);
    throw e;
  }
  // 성공하면 남아 있던 오류 안내를 지웁니다.
  const ref = (await headers()).get("referer");
  if (ref && new URL(ref).searchParams.has("err")) {
    const back = await backTo();
    if (back) redirect(back);
  }
}
