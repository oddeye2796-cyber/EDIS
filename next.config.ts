import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 영업 담당자가 올리는 주문 캡처 사진을 받기 위해 서버 액션 본문 크기를 늘립니다.
  // 매뉴얼 원문(content/manual.md)을 서버 함수에 같이 싣습니다.
  outputFileTracingIncludes: { "/manual": ["./content/manual.md"] },
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
