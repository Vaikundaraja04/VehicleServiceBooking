export function Message({ children, type = "status" }) {
  if (!children) return null;
  return <p className={`message${type === "error" ? " message--error" : ""}`} role={type === "error" ? "alert" : "status"}>{children}</p>;
}
