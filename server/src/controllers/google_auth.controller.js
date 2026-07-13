import { OAuth2Client } from "google-auth-library";
import User from "../models/User.model";
import { generateToken } from "../utils/auth.util.js";

const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "postmessage"
);

export const GoogleAuth = async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({
                message: "Authorization code missing"
            });
        }

        // Exchange authorization code for google id tokens
        const { tokens } = await client.getToken(code);

        if (!tokens.id_token) {
            return res.status(400).json({
                message: "Failed to obtain ID token"
            });
        }

        // Verify Google's ID token
        const ticket = await client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        

        const {
            sub,
            email,
            email_verified,
            given_name,
            family_name,
            picture
        } = payload;

        let user = await User.findOne({
            $or: [
                { google_open_id: sub },
                { email }
            ]
        });

        // Create account
        if (!user) {
            user = await User.create({
                first_name: given_name,
                last_name: family_name ?? "",
                email,
                google_open_id: sub,
                profile_picture: picture,
                email_verified
            });

            console.log("Created:", user);
        }

        // Existing email/password account -> link Google
        else if (!user.google_open_id) {
            user.google_open_id = sub;
            user.profile_picture = picture;
            user.email_verified = email_verified;

            await user.save();
        }

        const token = generateToken(user._id);

        res.cookie("jwt", token, {
            maxAge: 7 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: "strict",
            secure: process.env.NODE_ENV !== "development"
        });

        return res.status(200).json({
            message: "Authentication successful",
            token,
            user: {
                _id: user._id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                profile_picture: user.profile_picture
            }
        });

    } catch (err) {
        console.error(err);

        return res.status(500).json({
            message: "Google authentication failed"
        });
    }
};