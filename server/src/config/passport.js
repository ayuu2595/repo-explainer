import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import dotenv from "dotenv";
import { pool } from "./db.js";
import { encrypt } from "../utils/crypto.js";

dotenv.config();

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: `${process.env.SERVER_URL}/api/auth/github/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const githubId = profile.id;
        const username = profile.username;
        const encryptedToken = encrypt(accessToken);

        const existing = await pool.query(
          "SELECT * FROM users WHERE github_id = $1",
          [githubId]
        );

        let user;
        if (existing.rows.length > 0) {
          const updated = await pool.query(
            "UPDATE users SET access_token = $1, username = $2 WHERE github_id = $3 RETURNING *",
            [encryptedToken, username, githubId]
          );
          user = updated.rows[0];
        } else {
          const inserted = await pool.query(
            "INSERT INTO users (github_id, username, access_token) VALUES ($1, $2, $3) RETURNING *",
            [githubId, username, encryptedToken]
          );
          user = inserted.rows[0];
        }

        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

export default passport;