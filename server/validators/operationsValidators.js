const { body, query, param } = require('express-validator');
const { DateTime } = require('luxon');
const AppError = require('../utils/AppError');

const profileFields = ['username', 'mobile', 'address'];
const profileValidation = [
  (req, res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length === 0) return next(new AppError(400, 'Provide at least one field'));
    next();
  },
  body('username').optional().isString().bail().trim().toLowerCase().matches(/^[a-z0-9_]{3,30}$/).withMessage('Use 3–30 letters, numbers or underscores'),
  body('mobile').optional().isString().bail().matches(/^\d{10}$/).withMessage('Mobile must contain exactly 10 digits'),
  body('address').optional().isString().bail().trim().isLength({ min: 1, max: 500 }).withMessage('Address must contain 1–500 characters'),
];
const idValidation = [param('id').isMongoId().withMessage('Invalid record ID')];
const pageValidation = [
  query('page').optional().isInt({ min: 1, max: 10000 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];
const customerListValidation = [
  ...pageValidation,
  query('search').optional().isString().bail().trim().isLength({ max: 100 }),
  query('status').optional().isIn(['all', 'active', 'inactive']),
];
const customerUpdateValidation = [
  ...profileValidation,
  body('isActive').optional().custom(value => typeof value === 'boolean').withMessage('Account status must be true or false'),
];
const reportValidation = [
  ...pageValidation,
  query('type').optional().isIn(['bookings', 'service-history', 'customers', 'vehicles', 'pending', 'completed']),
  query('format').optional().isIn(['json', 'csv']),
  ...['dateFrom', 'dateTo'].map(field => query(field).optional().custom(value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = DateTime.fromISO(value);
    return date.isValid && date.toISODate() === value;
  }).withMessage('Use a real YYYY-MM-DD date')),
  query('dateTo').custom((value, { req }) => !value || !req.query.dateFrom || value >= req.query.dateFrom).withMessage('End date must be on or after start date'),
];
const deletionValidation = [body('reason').isString().bail().trim().isLength({ min: 3, max: 300 }).withMessage('Enter a deletion reason (3–300 characters)')];
module.exports = { profileFields, profileValidation, idValidation, customerListValidation, customerUpdateValidation, reportValidation, deletionValidation };
