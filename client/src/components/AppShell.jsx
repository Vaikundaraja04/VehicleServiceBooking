import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

function navClassName({ isActive }) {
  return `app-nav__link${isActive ? " app-nav__link--active" : ""}`;
}

export function AppShell({ children }) {
  const user = useAuth()?.user;

  return (
    <div className="app-shell">
      <header className="app-header">
        <nav aria-label="Main navigation" className="app-nav">
          <NavLink
            className={({ isActive }) => `${navClassName({ isActive })} app-nav__brand`}
            end
            to="/"
          >
            Vehicle Service Booking
          </NavLink>
          {!user && <><NavLink className={navClassName} to="/services">Services</NavLink><NavLink className={navClassName} to="/about">About</NavLink><NavLink className={navClassName} to="/contact">Contact</NavLink><NavLink className={navClassName} to="/login">Sign in</NavLink><NavLink className={navClassName} to="/register">Register</NavLink></>}
          {user?.role === "customer" ? (
            <>
              <NavLink className={navClassName} end to="/dashboard">Dashboard</NavLink>
              <NavLink className={navClassName} end to="/vehicles">My vehicles</NavLink>
              <NavLink className={navClassName} end to="/book-service">Book service</NavLink>
              <NavLink className={navClassName} to="/bookings">My bookings</NavLink>
            </>
          ) : null}
          {user?.role === "admin" ? (
            <>
              <NavLink className={navClassName} end to="/dashboard">Dashboard</NavLink>
              <NavLink className={navClassName} to="/admin/bookings">Booking queue</NavLink>
              <NavLink className={navClassName} to="/admin/customers">Customers</NavLink>
              <NavLink className={navClassName} end to="/admin/services">Service catalogue</NavLink>
              <NavLink className={navClassName} end to="/admin/schedule">Workshop schedule</NavLink>
              <NavLink className={navClassName} end to="/admin/vehicles">Manage vehicles</NavLink>
              <NavLink className={navClassName} end to="/admin/invitations">
                Administrator invitations
              </NavLink>
            </>
          ) : null}
        </nav>
        {user && <nav className="app-nav" aria-label="Account navigation"><NavLink className={navClassName} to="/reports">Reports</NavLink><NavLink className={navClassName} to="/profile">My profile</NavLink>{user.role === 'admin' && <NavLink className={navClassName} to="/admin/email-deliveries">Email deliveries</NavLink>}</nav>}
      </header>
      <main className="app-content">{children}</main>
      <footer className="app-footer"><span>© {new Date().getFullYear()} Vehicle Service Booking</span><nav aria-label="Footer navigation"><NavLink to="/services">Services</NavLink><NavLink to="/about">About</NavLink><NavLink to="/contact">Contact</NavLink></nav></footer>
    </div>
  );
}
