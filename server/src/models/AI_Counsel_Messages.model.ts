// AI_Counsel_Messages.ts

import mongoose from "mongoose";

const AI_Counsel_Message_Schema = new mongoose.Schema(
  {
    convo_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AI_Counsel_Convo",
      required: true,
      index: true,
    },

    sender: {
      type: String,
      enum: ["AI", "User"],
      required: true,
    },

    content: {
      type: String,
      required: true,
      trim: true,
    },

    attachments: {
      type: [String], // IndexedDB attachment ids
      default: [],
      validate: {
        validator: function (arr: string[]) {
          return arr.length <= 3;
        },
        message: "Maximum 3 attachments allowed",
      },
    },

    discovered_laws: {
      type: [String], // chroma/vector-linked law ids,
      default: [],
    },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: false,
    },
  }
);

export default mongoose.model(
  "AI_Counsel_Messages",
  AI_Counsel_Message_Schema
);