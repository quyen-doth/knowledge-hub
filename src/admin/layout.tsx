import type { Child } from 'hono/jsx';

interface AdminLayoutProps {
  title: string;
  children: Child;
}

export function AdminLayout({ title, children }: AdminLayoutProps) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · Knowledge Hub</title>
      </head>
      <body>
        <header>
          <strong>Smart Knowledge Hub</strong>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
