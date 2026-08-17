// api/middleware/auth.js
// JWT verification middleware using jose. HS256 signed with JWT_SECRET.
// Token payload: { sub: <user_id>, username, role, iat, exp }.

const { jwtVerify, SignJWT } = require('jose');

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getSecret() {
  const raw = process.env.JWT_SECRET;
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

async function signToken({ id, username, role }) {
  const secret = getSecret();
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return await new SignJWT({ username, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(id))
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

// Verifies the Authorization header. Returns the user payload or throws.
// Used by both middleware (requireAuth) and the test suite.
async function verifyToken(token) {
  const secret = getSecret();
  if (!secret) {
    const err = new Error('JWT_SECRET is not configured');
    err.code = 'NO_SECRET';
    throw err;
  }
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return {
      id: Number(payload.sub),
      username: payload.username,
      role: payload.role,
    };
  } catch (err) {
    const e = new Error('Invalid or expired token');
    e.code = 'INVALID_TOKEN';
    e.cause = err;
    throw e;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return res.status(401).json({ error: 'Missing or invalid token' });

  verifyToken(match[1])
    .then(user => { req.user = user; next(); })
    .catch(err => {
      if (err.code === 'NO_SECRET') {
        return res.status(500).json({ error: 'Server auth misconfigured' });
      }
      return res.status(401).json({ error: 'Invalid or expired token' });
    });
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Missing or invalid token' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = {
  signToken,
  verifyToken,
  requireAuth,
  requireAdmin,
  TOKEN_TTL_SECONDS,
};