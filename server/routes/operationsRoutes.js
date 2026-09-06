const express = require('express');
const { matchedData } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const asyncHandler = require('../utils/asyncHandler');
const { rejectUnknownFields, rejectUnknownQueryFields, validateRequest } = require('../middleware/validateRequest');
const v = require('../validators/operationsValidators');
const accounts = require('../services/accountService');
const { generateReport, toCsv } = require('../services/reportService');
const { deleteBooking } = require('../services/bookingDeletionService');
const Service = require('../models/Service');

function createOperationsRouter() {
  const router = express.Router();
  router.get('/public/workshop', (req, res) => res.json({ workshop: {
    name: process.env.WORKSHOP_NAME || 'Vehicle Service Booking',
    email: process.env.WORKSHOP_EMAIL || '', phone: process.env.WORKSHOP_PHONE || '',
    address: process.env.WORKSHOP_ADDRESS || '', timeZone: 'Asia/Kolkata',
  } }));
  router.get('/public/services', asyncHandler(async (req, res) => {
    const services = await Service.find({ isActive: true }).sort({ name: 1 }).select('name description category durationMinutes').lean();
    res.json({ services: services.map(s => ({ id: String(s._id), name: s.name, description: s.description, category: s.category, durationMinutes: s.durationMinutes })) });
  }));
  router.patch('/profile', asyncHandler(authenticate), rejectUnknownFields(v.profileFields), v.profileValidation, validateRequest, asyncHandler(async (req, res) => {
    res.json({ user: await accounts.updateProfile(req.user, req.validated) });
  }));
  router.get('/admin/customers', asyncHandler(authenticate), authorize('admin'), rejectUnknownQueryFields(['page', 'limit', 'search', 'status']), v.customerListValidation, validateRequest, asyncHandler(async (req, res) => {
    res.json(await accounts.listCustomers(matchedData(req, { locations: ['query'] })));
  }));
  router.patch('/admin/customers/:id', asyncHandler(authenticate), authorize('admin'), v.idValidation, rejectUnknownFields([...v.profileFields, 'isActive']), v.customerUpdateValidation, validateRequest, asyncHandler(async (req, res) => {
    res.json({ customer: await accounts.updateCustomer(req.params.id, req.validated) });
  }));
  router.delete('/admin/bookings/:id', asyncHandler(authenticate), authorize('admin'), v.idValidation, rejectUnknownFields(['reason']), v.deletionValidation, validateRequest, asyncHandler(async (req, res) => {
    await deleteBooking({ id: req.params.id, actor: req.user, reason: req.validated.reason });
    res.json({ message: 'Booking deleted. An administrator audit copy is retained.' });
  }));
  router.get('/reports', asyncHandler(authenticate), rejectUnknownQueryFields(['type', 'format', 'dateFrom', 'dateTo', 'page', 'limit']), v.reportValidation, validateRequest, asyncHandler(async (req, res) => {
    const options = matchedData(req, { locations: ['query'] });
    const report = await generateReport(req.user, options);
    res.set('Cache-Control', 'no-store');
    if (options.format === 'csv') return res.type('text/csv').attachment(`vehicle-service-${report.type}.csv`).send(toCsv(report.columns, report.rows));
    res.json({ report });
  }));
  return router;
}
module.exports = createOperationsRouter;
