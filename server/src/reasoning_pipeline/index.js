import dotenv from "dotenv";

dotenv.config();
import { runReasoning } from "./orchestrator.js";


const query = `
Company A sold goods on credit...
Country declared enemy...
How to recover payment?
`;


//reasoning_modes -----> lite/deep
runReasoning(query, "deep").then(console.log);   