// AI_Counsel_Convo.ts

import mongoose from "mongoose";

const AI_Counsel_Convo_Schema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default:null,
      required: false,  //make it true when auth middleware is set
      index: true,
    },

    case_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "cases",
      default: null,
      index: true,
    },

    title: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
    },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  }
);

export default mongoose.model(
  "AI_Counsel_Convo",
  AI_Counsel_Convo_Schema
);