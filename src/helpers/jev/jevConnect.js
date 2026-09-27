import { TypeSafeClient } from "@typesafe-ai/sdk";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.resolve(__dirname, "../../../.env"),
});

const client = new TypeSafeClient({ apiKey: process.env.JEV });

export const jev = (...args) => client.systemOne(...args);