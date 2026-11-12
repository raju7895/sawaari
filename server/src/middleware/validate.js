/* Zod-powered body validation middleware */
const { httpError } = require('../utils');

const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
    return next(httpError(400, `${where}${issue.message}`));
  }
  req.body = result.data;
  next();
};

const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    const issue = result.error.issues[0];
    return next(httpError(400, `${issue.path.join('.') || 'query'}: ${issue.message}`));
  }
  req.query = result.data;
  next();
};

module.exports = { validate, validateQuery };
