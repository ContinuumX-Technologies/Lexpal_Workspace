import dotenv from "dotenv";

dotenv.config();
import { runReasoning } from "./orchestrator.js";


const query = `
Company A sold goods on credit...
Country declared enemy...
How to recover payment?
`;

runReasoning(query, "high").then(console.log);