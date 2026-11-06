const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function optionalAuth(req, res, next) {
  try {
    const token = req.cookies.token;
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(payload.sub);
      if (user) req.user = user;
    }
  } catch (err) {
    // Invalid or expired token: treat the visitor as anonymous.
  }
  next();
}

module.exports = optionalAuth;