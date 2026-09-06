import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { useAuth } from '../auth/AuthContext';
import { apiRequest } from '../api/authApi';
import { ProfilePage } from './ProfilePage';
import { ReportsPage } from './ReportsPage';
import { AdminCustomersPage } from './AdminCustomersPage';
import { EmailDeliveriesPage } from './EmailDeliveriesPage';
import { BookingAdminTools } from '../components/BookingAdminTools';
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../api/authApi', () => ({ apiRequest: vi.fn() }));
const customer = { id: '507f1f77bcf86cd799439011', username: 'customer_01', email: 'test@gmail.com', mobile: '9876543210', address: 'Chennai', role: 'customer' };
const refreshUser = vi.fn();
beforeEach(() => { useAuth.mockReturnValue({ user: customer, refreshUser, clearSession: vi.fn() }); });
afterEach(() => vi.clearAllMocks());
const show = element => render(<MemoryRouter>{element}</MemoryRouter>);
it('saves a profile to the API and refreshes the authenticated user', async () => {
  apiRequest.mockResolvedValue({ user: customer });
  show(<ProfilePage />); const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Address')); await user.type(screen.getByLabelText('Address'), 'Madurai');
  await user.click(screen.getByRole('button', { name: 'Save profile' }));
  await screen.findByText('Profile saved.');
  expect(apiRequest).toHaveBeenCalledWith('/profile', { method: 'PATCH', body: { username: customer.username, mobile: customer.mobile, address: 'Madurai' } });
  expect(refreshUser).toHaveBeenCalled();
});
it('keeps profile edits when the API rejects a save', async () => {
  apiRequest.mockRejectedValue(new Error('Username already exists'));
  show(<ProfilePage />); await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Username already exists');
  expect(screen.getByLabelText('Address')).toHaveValue('Chennai');
  expect(screen.queryByText('Profile saved.')).not.toBeInTheDocument();
});
it('limits customers to their own report types and handles empty results', async () => {
  apiRequest.mockResolvedValue({ report: { type: 'bookings', generatedAt: '2026-09-06T00:00:00Z', columns: [], rows: [], pagination: { total: 0 }, dateBasis: 'Appointment date' } });
  show(<ReportsPage />);
  expect(await screen.findByText('No records match this report.')).toBeInTheDocument();
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Booking history', 'Service history']);
});
it('updates customer access only after the admin explicitly saves', async () => {
  useAuth.mockReturnValue({ user: { ...customer, role: 'admin' }, clearSession: vi.fn() });
  apiRequest.mockImplementation((path, options) => options?.method === 'PATCH' ? Promise.resolve({ customer }) : Promise.resolve({ customers: [{ ...customer, isActive: true, isEmailVerified: true }], pagination: { total: 1, totalPages: 1, page: 1 } }));
  show(<AdminCustomersPage />); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Edit customer_01' }));
  await user.selectOptions(screen.getByLabelText('Account access'), 'false');
  expect(apiRequest.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Save customer' }));
  await screen.findByText('Customer updated.');
  expect(apiRequest).toHaveBeenCalledWith(`/admin/customers/${customer.id}`, { method: 'PATCH', body: { username: customer.username, mobile: customer.mobile, address: customer.address, isActive: false } });
});
it('requires confirmation and a reason before deleting a booking', async () => {
  apiRequest.mockResolvedValue({ message: 'Deleted' });
  show(<BookingAdminTools booking={{ id: customer.id, status: 'cancelled' }} />); const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Delete booking' }));
  expect(apiRequest).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Deletion reason'), 'Duplicate request');
  await user.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/admin/bookings/${customer.id}`, { method: 'DELETE', body: { reason: 'Duplicate request' } }));
});
it('shows failed Gmail delivery and allows an explicit retry', async () => {
  apiRequest.mockImplementation((_path, options) => Promise.resolve(options?.method ? { message: 'Queued' } : { deliveries: [{ _id: customer.id, bookingId: customer.id, to: customer.email, subject: 'Booking: approved', state: 'failed', attempts: 5, lastError: 'EAUTH' }] }));
  show(<EmailDeliveriesPage />); await userEvent.click(await screen.findByRole('button', { name: 'Retry delivery' }));
  await screen.findByText('Email queued for another attempt.');
  expect(apiRequest).toHaveBeenCalledWith(`/admin/email-deliveries/${customer.id}/retry`, { method: 'POST' });
});
