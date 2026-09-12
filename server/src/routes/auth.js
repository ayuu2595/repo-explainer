import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import passport from "../config/passport.js";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

dotenv.config();

const router = express.Router();

router.get(
  "/github",
  passport.authenticate("github", { session: false, scope: ["repo"] })
);

router.get(
  "/github/callback",
  passport.authenticate("github", { session: false, failureRedirect: `${process.env.CLIENT_URL}/login-failed` }),
  (req, res) => {
    const token = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect(process.env.CLIENT_URL);
  }
);

router.get("/me", requireAuth, async (req, res) => {
  const result = await pool.query(
    "SELECT id, username, created_at FROM users WHERE id = $1",
    [req.userId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({ user: result.rows[0] });
});

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

export default router;