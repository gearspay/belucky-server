// middleware/adminMiddleware.js
const adminMiddleware = (req, res, next) => {
  try {
    // Check if user exists and is admin (role = 1)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (req.user.userRole !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Error validating admin privileges'
    });
  }
};

module.exports = adminMiddleware;