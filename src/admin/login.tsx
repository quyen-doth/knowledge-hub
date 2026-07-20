import { AdminLayout } from './layout';

interface LoginViewProps {
  error?: string;
}

export function LoginView({ error }: LoginViewProps) {
  return (
    <AdminLayout title="Đăng nhập">
      <h1>Đăng nhập quản trị</h1>
      {error ? <p role="alert">{error}</p> : null}
      <form method="post" action="/admin/login">
        <label for="password">Mật khẩu</label>
        <input id="password" name="password" type="password" required autofocus />
        <button type="submit">Đăng nhập</button>
      </form>
    </AdminLayout>
  );
}
