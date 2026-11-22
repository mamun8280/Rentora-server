
export const verifyRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.email) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized: Please login first",
        });
      }

      const user = await req.db.collection("user").findOne(
        { email: req.user.email },
        { projection: { role: 1 } }
      );

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User account not found",
        });
      }

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You do not have permission",
        });
      }

      req.user.role = user.role;
      next();
    } catch (error) {
      console.error("Role Verification Error:", error);

      return res.status(500).json({
        success: false,
        message: "Role verification failed",
      });
    }
  };
};
