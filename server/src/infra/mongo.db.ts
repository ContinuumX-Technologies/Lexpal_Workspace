import mongoose from "mongoose";

const connectDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGO_CONNECTION_URL;

    if (!mongoUri) {
      throw new Error("MONGO_CONNECTION_URL is not defined");
    }

    const conn = await mongoose.connect(mongoUri);

    console.log(`✅ 🔗 Connected to MongoDB: ${conn.connection.host}`);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`⚠️ Failed to connect to MongoDB: ${error.message}`);
    } else {
      console.error("⚠️ Failed to connect to MongoDB:", error);
    }

    process.exit(1);
  }
};

export default connectDB;