const mongoose = require("mongoose");
const AI_Counsel_Message_Schema = new mongoose.Schema(
  {
    convo_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    sender: { type: String, enum: ["AI", "User"], required: true },
    client_message_id: { type: String, required: false, trim: true, index: true, sparse: true },
    content: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

AI_Counsel_Message_Schema.index({ convo_id: 1, sender: 1, client_message_id: 1 }, { unique: true, sparse: true });
const Model = mongoose.model("Test_AI_Counsel_Messages2", AI_Counsel_Message_Schema);

async function run() {
  await mongoose.connect("mongodb://127.0.0.1:27017/lexpal_test_2");
  await Model.deleteMany({});
  const convoId = new mongoose.Types.ObjectId();
  
  const m1 = await Model.create({ convo_id: convoId, sender: "AI", content: "A" });
  console.log("M1:", m1._id);
  
  try {
      const m2 = await Model.create({ convo_id: convoId, sender: "AI", content: "B" });
      console.log("M2:", m2._id);
  } catch (e) {
      console.log("M2 Error:", e.message);
  }
  
  const all = await Model.find({ convo_id: convoId }).lean();
  console.log("Found:", all.map(a => a.content));
  process.exit(0);
}
run();
