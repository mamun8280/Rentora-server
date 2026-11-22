
import { createRemoteJWKSet, jwtVerify } from "jose";

let JWKS;

const getJWKS = () => {
  if (!JWKS) {
    const authUrl = process.env.CLIENT_URL;

    if (!authUrl) {
      throw new Error("CLIENT_URL is missing in .env");
    }

    JWKS = createRemoteJWKSet(
      new URL(`${authUrl}/api/auth/jwks`)
    );
  }

  return JWKS;
};

export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Token is required",
      });
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format",
      });
    }

    const { payload } = await jwtVerify(token, getJWKS(), {
      algorithms: ["EdDSA"],
    });

    if (!payload.sub || !payload.email) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
    };

    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);

    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or expired token",
    });
  }
};
