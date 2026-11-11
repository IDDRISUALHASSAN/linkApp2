const jwt = require("jsonwebtoken");
const User = require("../model/user");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res
        .status(401)
        .json({ success: false, message: "No token provided" });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("tokenVersion").lean();
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "Invalid token" });
    const tokenVersion = typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : 0;
    if ((user.tokenVersion || 0) !== tokenVersion) {
      return res
        .status(401)
        .json({ success: false, message: "Session expired" });
    }
    req.userId = decoded.id;
    req.tokenVersion = tokenVersion;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
};

module.exports = authMiddleware;
