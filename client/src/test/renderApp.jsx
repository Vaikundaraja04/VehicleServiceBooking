import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

export function renderApp(ui, { route = "/" } = {}) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </StrictMode>,
  );
}
