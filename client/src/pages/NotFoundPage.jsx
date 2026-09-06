import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-title" className="not-found-page">
      <p>404</p>
      <h1 id="not-found-title">Page not found</h1>
      <p>The page you requested is not available.</p>
      <Link to="/login">Go to sign in</Link>
    </section>
  );
}
