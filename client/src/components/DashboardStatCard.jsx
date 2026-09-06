import { useId } from "react";

export function DashboardStatCard({ description, label, value }) {
  const headingId = useId();

  return (
    <article aria-labelledby={headingId}>
      <h2 id={headingId}>{label}</h2>
      <p>{value}</p>
      {description ? <p>{description}</p> : null}
    </article>
  );
}
