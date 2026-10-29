// 역할별 사이드 메뉴. 각 역할이 실제로 하는 일 순서대로 묶습니다.
import type { Role } from "./auth";

export type NavGroup = { title: string; links: [label: string, href: string][] };

export const navByRole: Record<Role, NavGroup[]> = {
  sales: [
    { title: "영업", links: [["주문 올리기", "/submit"], ["출하 지시", "/submit?mode=ship"]] },
  ],
  executive: [
    { title: "경영", links: [["경영 현황", "/exec"], ["리포트", "/report"]] },
  ],
  staff: [
    { title: "홈", links: [["대시보드", "/"], ["알림", "/notifications"]] },
    { title: "주문 접수", links: [["주문 접수함", "/inbox"], ["엑셀 일괄 등록", "/upload"]] },
    {
      title: "발주 (매입)",
      links: [["발주 목록", "/purchase"], ["발주서 작성", "/purchase/new"], ["공급사 발송 대기", "/purchase?status=confirmed"]],
    },
    {
      title: "수주 (매출)",
      links: [["수주 목록", "/sales"], ["수주 등록", "/sales/new"], ["확정 대기", "/sales?status=received"]],
    },
    { title: "재고", links: [["로트·유통기한", "/lots"]] },
    { title: "기준 정보 (이카운트)", links: [["거래처", "/partners"], ["품목", "/items"]] },
    { title: "연동", links: [["이카운트", "/ecount"], ["이메일", "/email"]] },
    { title: "분석", links: [["리포트", "/report"]] },
  ],
  office_admin: [
    { title: "홈", links: [["대시보드", "/"], ["경영 현황", "/exec"], ["알림", "/notifications"]] },
    { title: "승인", links: [["발주 승인 대기", "/purchase?status=pending_approval"]] },
    { title: "현황", links: [["발주", "/purchase"], ["수주", "/sales"], ["주문 접수함", "/inbox"]] },
    { title: "분석", links: [["리포트", "/report"]] },
    { title: "연동", links: [["이카운트", "/ecount"], ["이메일", "/email"]] },
    { title: "기준 정보 (이카운트)", links: [["거래처", "/partners"], ["품목", "/items"]] },
  ],
  factory_manager: [
    { title: "홈", links: [["대시보드", "/"], ["알림", "/notifications"]] },
    {
      title: "공장 업무",
      links: [
        ["발주 확인 대기", "/purchase?status=approved"],
        ["입고 대기", "/purchase?status=sent,partially_received"],
        ["출고 대기", "/sales?status=confirmed,preparing,partially_shipped"],
      ],
    },
    { title: "재고", links: [["로트·유통기한", "/lots"], ["품목", "/items"]] },
    { title: "현황", links: [["발주", "/purchase"], ["수주", "/sales"]] },
  ],
};
