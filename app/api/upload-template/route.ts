import { requireUser } from "@/lib/auth";

export async function GET() {
  await requireUser();
  const csv = "﻿구분,거래처,품목,수량,단가,납기,메모\n수주,건강한생활,비타민C,50,,2026-11-20,정기 주문\n발주,대한포장,SM-003,5000,350,2026-11-25,\n";
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename*=UTF-8''order-template.csv",
    },
  });
}
