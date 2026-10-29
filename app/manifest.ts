import type { MetadataRoute } from "next";

// 휴대폰 홈 화면에 추가했을 때 앱처럼 열리도록 합니다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "휴럼 EDIS 수발주",
    short_name: "EDIS",
    start_url: "/submit",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#111827",
    lang: "ko",
  };
}
