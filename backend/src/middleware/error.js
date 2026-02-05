// 404
export function notFound(req, res, _next) {
  res.status(404).json({ error: 'Not found' });
}

// Central error handler
export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const body = {
    error: err.message || 'Internal Server Error'
  };
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    body.stack = err.stack;
  }
  res.status(status).json(body);
}
