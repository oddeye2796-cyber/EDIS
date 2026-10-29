import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 영업 담당자가 올리는 주문 캡처 사진을 받기 위해 서버 액션 본문 크기를 늘립니다.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
