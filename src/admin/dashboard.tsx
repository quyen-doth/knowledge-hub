import { AdminLayout } from './layout';

interface DashboardViewProps {
  model: string;
}

export function DashboardView({ model }: DashboardViewProps) {
  return (
    <AdminLayout title="Tổng quan">
      <h1>Tổng quan</h1>
      <p>Knowledge Hub đã sẵn sàng nhận các module phase 1 tiếp theo.</p>
      <dl>
        <dt>LLM model</dt>
        <dd>{model}</dd>
      </dl>
      <form method="post" action="/admin/logout">
        <button type="submit">Đăng xuất</button>
      </form>
    </AdminLayout>
  );
}
