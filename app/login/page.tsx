import { query } from "@/lib/db";
import { roleLabel, type User } from "@/lib/auth";
import { login } from "../actions";

export default async function LoginPage() {
  const users = await query<User>("select id, name, email, role from users order by id");
  return (
    <div style={{ maxWidth: 420, margin: "80px auto" }}>
      <div className="panel">
        <h1 style={{ marginBottom: 8 }}>휴럼 EDIS 수발주</h1>
        <p className="muted">데모용 로그인입니다. 역할을 골라 들어가 보세요.</p>
        {users.map((u) => (
          <form key={u.id} action={login} style={{ marginBottom: 8 }}>
            <input type="hidden" name="userId" value={u.id} />
            <input type="hidden" name="role" value={u.role} />
            <button style={{ width: "100%" }}>
              {u.name} · {roleLabel[u.role]}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
