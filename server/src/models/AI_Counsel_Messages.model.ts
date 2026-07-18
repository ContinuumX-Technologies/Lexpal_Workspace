// AI_Counsel_Messages.ts

import mongoose from "mongoose";

import { type WebResearch } from "../services/llm_websearch";



const DiscoveredLawSchema = new mongoose.Schema(
  {
    act_name: {
      type: String,
      required: false,
      trim: true,
    },
    section_no: {
      type: String,
      required: false,
      trim: true,
    },
    chapter_name: {
      type: String,
      required: false,
      trim: true,
      default: null,
    },
    chapter_code: {
      type: String,
      required: false,
      trim: true,
      default: null,
    },
    act_year: {
      type: String,
      required: false,
      trim: true,
      default: null,
    },
    chunk_id: {
      type: String,
      required: false,
      trim: true,
      default: null,
    },
    law_text: {
      type: String,
      required: false,
      default: "",
    },
    reasoning: {
      type: String,
      required: false,
      default: "",
    },
    relevance_score: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
      max: 10,
    },
  },


  { _id: false }// default mongodb object id ommited as this is a nested object schema 
);






const AttachmentMetadataSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      trim: true,
    },
    file_name: {
      type: String,
      required: true,
      trim: true,
    },
    size: {
      type: Number,
      required: false,
      min: 0,
      default: 0,
    },
    mime_type: {
      type: String,
      required: false,
      trim: true,
      default: "",
    },
  },

  { _id: false }// default mongodb object id ommited as this is a nested object schema
);







//web_research key schemas


const WebResearchSourceSchema = new mongoose.Schema(
  {
   
    title: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);


const WebResearchSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: true,
    },

    sources: {
      type: [WebResearchSourceSchema],
      default: [],
    },
  },
  { _id: false }
);




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


    //unnecessary
    client_message_id: {
      type: String,
      required: false,
      trim: true,
      index: true,
      sparse: true,
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

    attachment_metadata: {
      type: [AttachmentMetadataSchema],
      default: [],
    },

    discovered_laws: {
      type: [DiscoveredLawSchema],
      default: [],
    },

    web_research: {

      type: WebResearchSchema,

      default: null,

    },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: false,
    },
  }
);






AI_Counsel_Message_Schema.index(
  { convo_id: 1, sender: 1, client_message_id: 1 },
  {
    unique: true,
    sparse: true,
  }
);





export default mongoose.model(
  "AI_Counsel_Messages",
  AI_Counsel_Message_Schema
);
