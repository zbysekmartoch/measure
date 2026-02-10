import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const authenticateToken = (req, res, next) => {
  // Accept token from Authorization header or from ?token= query param (for SSE/EventSource)
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query?.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};