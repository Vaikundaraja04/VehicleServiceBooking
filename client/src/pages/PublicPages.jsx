import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { ResourceState } from '../components/ResourceState';
import { useResource } from '../hooks/useResource';
import { useAuth } from '../auth/AuthContext';

export function AboutPage() {
  return <AppShell><section className="workspace-panel"><p className="eyebrow">About the service</p><h1>From booking to collection.</h1><p>Keep your vehicle details, appointments and service history together. Choose a service and an available appointment, then follow its progress from your account.</p><div className="service-grid"><article><h2>1. Choose a service</h2><p>Add your vehicle and select a service from the current catalogue.</p></article><article><h2>2. Reserve a time</h2><p>The workshop reviews your request before confirming it.</p></article><article><h2>3. Follow progress</h2><p>See approval, servicing and completion updates in your booking history, with Gmail notifications for status changes.</p></article></div><Link to="/services">Explore services</Link></section></AppShell>;
}
export function ServicesPage() {
  const resource = useResource('/public/services');
  const { user } = useAuth();
  return <AppShell><section><p className="eyebrow">Workshop catalogue</p><h1>Vehicle services</h1><p>Choose the care your vehicle needs. Available appointment times are shown when you book.</p><ResourceState resource={resource}>{resource.data && (resource.data.services.length ? <div className="service-grid">{resource.data.services.map(s => <article className="workspace-panel service-card" key={s.id}><p className="eyebrow">{s.category}</p><h2>{s.name}</h2><p>{s.description}</p><p><strong>{s.durationMinutes} minutes</strong></p><Link to={user?.role === 'customer' ? '/book-service' : user?.role === 'admin' ? '/admin/services' : '/login'}>{user?.role === 'admin' ? 'Manage catalogue' : 'Book a service'}</Link></article>)}</div> : <p>No services are available at the moment. Please check again later.</p>)}</ResourceState></section></AppShell>;
}
export function ContactPage() {
  const resource = useResource('/public/workshop');
  const shop = resource.data?.workshop;
  return <AppShell><section className="workspace-panel narrow-panel"><p className="eyebrow">Get in touch</p><h1>Contact the workshop</h1><ResourceState resource={resource}>{shop && <><h2>{shop.name}</h2><dl className="contact-list">{shop.phone && <><dt>Phone</dt><dd><a href={`tel:${shop.phone.replace(/[^+\d]/g, '')}`}>{shop.phone}</a></dd></>}{shop.email && <><dt>Email</dt><dd><a href={`mailto:${shop.email}`}>{shop.email}</a></dd></>}{shop.address && <><dt>Address</dt><dd>{shop.address}</dd></>}</dl>{!shop.email && !shop.phone && !shop.address && <p>Workshop contact details are not available yet. Check your appointment from your account.</p>}</>}</ResourceState><p>For an existing appointment, keep your booking reference ready.</p><Link to="/dashboard">Open my account</Link></section></AppShell>;
}
