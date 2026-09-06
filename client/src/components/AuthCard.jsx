export function AuthCard({ children, title }) {
  return (
    <section aria-labelledby="auth-card-title" className="auth-card">
      <h1 id="auth-card-title">{title}</h1>
      {children}
    </section>
  );
}
