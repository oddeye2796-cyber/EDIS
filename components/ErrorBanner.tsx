"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function ErrorBanner() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const err = sp.get("err");
  if (!err) return null;
  const close = () => {
    const next = new URLSearchParams(sp);
    next.delete("err");
    router.replace(next.size ? `${pathname}?${next}` : pathname);
  };
  return (
    <div className="err-banner" role="alert">
      <span>{err}</span>
      <button className="link" onClick={close} aria-label="닫기">닫기</button>
    </div>
  );
}
