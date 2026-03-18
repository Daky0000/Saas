import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";

export interface AuthRequest extends Request {
  userId?: string;
  agencyId?: string;
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  const decoded = AuthService.verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: "Invalid token" });
  }

  req.userId = decoded.userId;
  req.agencyId = decoded.agencyId;
  next();
};
