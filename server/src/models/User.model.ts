import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
    {
        first_name: {
            type: String,
            required: true,
            trim: true,
        },

        last_name: {
            type: String,
            required: true,
            trim: true,
        },
       
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        password_hash: {
            type: String,
            default: null,
        },
        
       //-----------fields from google oauth-------------------

       //google OpenId connect subject identifier
        google_open_id: {
            type: String,
            unique: true,
            sparse: true,
            default: null,
        },

        profile_picture: {
            type: String,
            default: null,
        },

        email_verified: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

export default mongoose.model("User", UserSchema);