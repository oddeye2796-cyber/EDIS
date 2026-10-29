import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new Response("로그인이 필요합니다.", { status: 401 });
  const row = await one<{ image: Buffer | null; image_type: string | null }>(
    "select image, image_type from order_inbox where id = $1",
    [Number((await params).id)],
  );
  if (!row?.image) return new Response("이미지가 없습니다.", { status: 404 });
  return new Response(new Uint8Array(row.image), {
    headers: { "content-type": row.image_type ?? "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
